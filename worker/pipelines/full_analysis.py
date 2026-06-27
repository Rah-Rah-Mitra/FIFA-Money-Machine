"""Full demo scene: fast pose_scene (YOLO-pose, all players) + a PEAR 'ultrazoom' mesh of the key
moment — the highest work-rate player's busiest window, cropped + low-res so PEAR runs at high fps and
stays smooth. Gives the dense mesh detail for that moment without the cost of meshing the whole frame."""
import glob
import json
import os
import subprocess
from pathlib import Path


def _out_dir():
    return os.environ.get("ANALYSIS_OUT_DIR") or str(Path(__file__).resolve().parents[2] / "public" / "analysis")


def run(ctx):
    import cv2
    import pose_engine
    import ingest

    cfg = ctx.config or {}
    res = pose_engine.analyze(ctx.api_base, ctx.video_id, ctx.work_dir, cfg)
    kp = res.pop("keypoints", {})
    out_dir = _out_dir()
    os.makedirs(out_dir, exist_ok=True)
    if ctx.job_id:
        json.dump(kp, open(os.path.join(out_dir, f"{ctx.job_id}.kp.json"), "w"))
        res["keypointsUrl"] = f"/analysis/{ctx.job_id}.kp.json"
    res["kind"] = "full_analysis"

    key = None
    players = res["players"]
    pear_dir, pear_py = os.environ.get("PEAR_DIR"), os.environ.get("PEAR_PYTHON")
    gpu_ok = bool(pear_dir and pear_py and os.path.exists(pear_py)) and "True" in (
        subprocess.run([pear_py, "-c", "import torch;print(torch.cuda.is_available())"], capture_output=True, text=True).stdout or "" if pear_py else "")

    if players and gpu_ok:
        kpl = max(players, key=lambda p: p["metrics"].get("workRate", 0))
        track = kp.get(str(kpl["trackId"]), [])
        if track:
            fps0, start0 = res["fps"], res["startSeconds"]
            fs = [t["f"] for t in track]
            wf0, wf1 = min(fs), max(fs)
            if (wf1 - wf0) / fps0 > 5:        # cap ultrazoom to ~5s
                wf1 = wf0 + int(5 * fps0)
            win_start = start0 + wf0 / fps0
            win_dur = max(2, (wf1 - wf0) / fps0)
            xs, ys = [], []
            for t in track:
                if wf0 <= t["f"] <= wf1:
                    for x, y, c in t["k"]:
                        if c > 0.3:
                            xs.append(x); ys.append(y)
            if xs:
                cx0, cx1, cy0, cy1 = min(xs), max(xs), min(ys), max(ys)
                mx, my = (cx1 - cx0) * 0.4 + 0.02, (cy1 - cy0) * 0.25 + 0.02   # expand crop a bit
                cx0, cx1 = max(0, cx0 - mx), min(1, cx1 + mx)
                cy0, cy1 = max(0, cy0 - my), min(1, cy1 + my)
                km_fps = cfg.get("keyFps", 12)
                frames = ingest.frames_for(ctx.api_base, ctx.video_id, os.path.abspath(f"{ctx.work_dir}/kwin"),
                                           fps=km_fps, max_seconds=int(win_dur) + 1, start_seconds=win_start, height=720)
                cropdir = os.path.abspath(f"{ctx.work_dir}/kcrop")
                os.makedirs(cropdir, exist_ok=True)
                for i, fp in enumerate(frames):
                    im = cv2.imread(fp)
                    if im is None:
                        continue
                    H, W = im.shape[:2]
                    c = im[int(cy0 * H):int(cy1 * H), int(cx0 * W):int(cx1 * W)]
                    if c.size:
                        cv2.imwrite(os.path.join(cropdir, f"{i:05d}.jpg"), c)
                render_dir = os.path.abspath(f"{ctx.work_dir}/kmesh")
                out_json = os.path.abspath(f"{ctx.work_dir}/kpear.json")
                adapter = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "pear_adapter.py"))
                subprocess.run([pear_py, adapter, "--frames", cropdir, "--out", out_json, "--min-bbox", "20", "--render-dir", render_dir], cwd=pear_dir, check=True)
                webm = os.path.join(out_dir, f"{ctx.job_id}.mesh.webm")
                ff = ingest._ffmpeg_bin()
                subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(km_fps),
                                "-i", os.path.join(render_dir, "mesh_%05d.png"),
                                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", webm], check=True)
                dets = json.load(open(out_json)) if os.path.exists(out_json) else []
                key = {
                    "trackId": kpl["trackId"], "tag": kpl["tag"],
                    "startSeconds": round(win_start, 1), "durationSeconds": round(win_dur, 1), "fps": km_fps,
                    "meshUrl": f"/analysis/{ctx.job_id}.mesh.webm",
                    "meshFrames": len(glob.glob(os.path.join(render_dir, "*.png"))), "meshDetections": len(dets),
                }
    res["keyMoment"] = key
    return {"result": res, "confidence": 0.4 if key else 0.25}
