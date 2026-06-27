"""Runs INSIDE the PEAR env ($PEAR_PYTHON, cwd=$PEAR_DIR). Mirrors PEAR's inference_images.py
detect->crop->EHM flow. Always writes per-detection SMPLX joints as JSON (--out); optionally also
renders a mesh-overlay video (--render-out) by compositing PEAR's rendered mesh back onto each frame.

Usage (invoked by worker/pipelines/mesh_pose.py):
    python pear_adapter.py --frames <dir> --out <json> [--min-bbox 50] [--fps 2] [--render-out <mp4>]
"""
import argparse
import json
import os
import sys

# Invoked with cwd=$PEAR_DIR; put it on sys.path so PEAR's modules import.
sys.path.insert(0, os.getcwd())

import numpy as np
import cv2
import torch
import torchvision.transforms as transforms
import lightning
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

from models.modules.ehm import EHM_v2
from models.pipeline.ehm_pipeline import Ehm_Pipeline
from utils.general_utils import ConfigDict, add_extra_cfgs

# reuse PEAR's patch/transform/render helpers (module-level, __main__-guarded)
import inference_images as inf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--config_name", default="infer")
    ap.add_argument("--min-bbox", type=float, default=50.0, help="min bbox height in ORIGINAL pixels")
    ap.add_argument("--fps", type=int, default=2)
    ap.add_argument("--render-out", default=None, help="if set, write a mesh-overlay mp4 here")
    args = ap.parse_args()
    render = bool(args.render_out)

    meta_cfg = add_extra_cfgs(ConfigDict(model_config_path=os.path.join("configs", f"{args.config_name}.yaml")))
    lightning.fabric.seed_everything(10)
    torch.set_float32_matmul_precision("high")

    ckpt = hf_hub_download(repo_id="BestWJH/PEAR_models", filename="ehm_model_stage1.pt")
    ehm_model = Ehm_Pipeline(meta_cfg)
    state = torch.load(ckpt, map_location="cpu", weights_only=True)
    ehm_model.backbone.load_state_dict(state["backbone"], strict=False)
    ehm_model.head.load_state_dict(state["head"], strict=False)
    ehm_model = ehm_model.cuda().eval()

    ehm = EHM_v2("assets/FLAME", "assets/SMPLX").cuda().eval()
    detector = YOLO("./model_zoo/yolov8x.pt")
    to_tensor = transforms.ToTensor()

    body_renderer = lights = render_dir = None
    if render:
        body_renderer = inf.BodyRenderer("assets/SMPLX", 1024, focal_length=24.0).cuda()
        lights = inf.PointLights(device="cuda:0", location=[[0.0, -1.0, -10.0]])
        render_dir = args.out + "_frames"
        os.makedirs(render_dir, exist_ok=True)

    names = sorted(f for f in os.listdir(args.frames) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    dets = []
    for idx, name in enumerate(names):
        img = inf.load_img(os.path.join(args.frames, name))  # RGB float, upscaled x2 by PEAR's loader
        h2, w2 = img.shape[:2]
        vis = cv2.cvtColor(img.copy(), cv2.COLOR_RGB2BGR) if render else None

        boxes = detector.predict(img, device="cuda", classes=0, conf=0.5, save=False, verbose=False)[0]
        boxes = boxes.boxes.xyxy.detach().cpu().numpy()
        for b in boxes:
            x1, y1, x2, y2 = (float(v) for v in b)
            if (y2 - y1) < args.min_bbox * 2:  # img is 2x; threshold given in original px
                continue
            xywh = np.array([x1, y1, abs(x2 - x1), abs(y2 - y1)])
            bbox = inf.process_bbox(bbox=xywh, img_width=w2, img_height=h2, input_img_shape=[256, 256], ratio=1.25)
            if bbox is None:
                continue
            patch, trans, inv_trans = inf.generate_patch_image(cvimg=img, bbox=bbox, scale=1.0, rot=0.0, do_flip=False, out_shape=[256, 256])
            t = (to_tensor(patch.astype(np.float32)) / 255).unsqueeze(0).cuda()
            with torch.no_grad():
                outputs = ehm_model(t)
                smplx = ehm(outputs["body_param"], outputs["flame_param"], pose_type="aa")
            dets.append({
                "frame": idx,
                "bbox": [x1 / 2, y1 / 2, x2 / 2, y2 / 2],  # back to original-frame coords
                "cam": outputs["pd_cam"][0, :3, 3].detach().cpu().numpy().round(4).tolist(),
                "joints_body": smplx["joints"][0, :22].detach().cpu().numpy().round(4).tolist(),
            })

            if render:
                cam = inf.GS_Camera(**inf.build_cameras_kwargs(1, 24), R=outputs["pd_cam"][0:1, :3, :3], T=outputs["pd_cam"][0:1, :3, 3])
                mesh_img = body_renderer.render_mesh(smplx["vertices"][None, 0, ...], cam, lights=lights)
                mesh_img = (mesh_img[:, :3].detach().cpu().numpy()).clip(0, 255).astype(np.uint8)[0].transpose(1, 2, 0)
                mesh_img = cv2.cvtColor(mesh_img, cv2.COLOR_RGB2BGR)
                mesh_img = cv2.resize(mesh_img, (256, 256), interpolation=cv2.INTER_AREA)
                mesh_on_orig = cv2.warpAffine(mesh_img, inv_trans, (w2, h2), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
                mask = np.any(mesh_on_orig > 0, axis=-1)
                vis[mask] = mesh_on_orig[mask]

        if render:
            out_frame = cv2.resize(np.clip(vis, 0, 255).astype(np.uint8), (w2 // 2, h2 // 2))  # back to ~original size
            cv2.imwrite(os.path.join(render_dir, f"mesh_{idx:05d}.jpg"), out_frame)

    with open(args.out, "w") as f:
        json.dump(dets, f)
    print(f"pear_adapter: wrote {len(dets)} detections from {len(names)} frames")

    if render:
        inf.images_to_video(render_dir, args.render_out, fps=args.fps)
        print(f"pear_adapter: rendered overlay -> {args.render_out}")


if __name__ == "__main__":
    main()
