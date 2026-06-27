"""PEAR human-mesh recovery per detected player -> camera-space kinematics.

Runs PEAR in ITS OWN env ($PEAR_PYTHON, cwd=$PEAR_DIR) via pear_adapter.py, which returns
per-detection SMPLX joints. We then greedily link detections across frames (IoU) into tracks and
derive coarse kinematics. EXPERIMENTAL + GPU-gated: highlights are cut/zoomed and there is no pitch
homography, so outputs are low-confidence.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    ua = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / ua if ua > 0 else 0.0


def link_iou(dets: list[dict], iou_thresh: float = 0.3) -> dict[int, list[dict]]:
    """dets: [{frame, bbox:[x1,y1,x2,y2], cam:[x,y,z], joints_body:[[x,y,z]..]}]. Greedy nearest-IoU."""
    tracks: dict[int, list[dict]] = {}
    last: dict[int, list[float]] = {}  # track_id -> last bbox
    next_id = 0
    by_frame: dict[int, list[dict]] = {}
    for d in dets:
        by_frame.setdefault(d["frame"], []).append(d)
    for frame in sorted(by_frame):
        for d in by_frame[frame]:
            best_id, best_iou = None, iou_thresh
            for tid, bbox in last.items():
                v = _iou(bbox, d["bbox"])
                if v >= best_iou:
                    best_iou, best_id = v, tid
            if best_id is None:
                best_id = next_id
                next_id += 1
                tracks[best_id] = []
            tracks[best_id].append(d)
            last[best_id] = d["bbox"]
    return tracks


def kinematics(tracks: dict[int, list[dict]], fps: float) -> list[dict]:
    out = []
    for tid, seq in tracks.items():
        if len(seq) < 2:
            continue
        cams = [s.get("cam") for s in seq if s.get("cam")]
        dist = 0.0
        for i in range(1, len(cams)):
            dx = cams[i][0] - cams[i - 1][0]
            dy = cams[i][1] - cams[i - 1][1]
            dz = cams[i][2] - cams[i - 1][2]
            dist += (dx * dx + dy * dy + dz * dz) ** 0.5
        seconds = (seq[-1]["frame"] - seq[0]["frame"]) / fps or 1.0
        out.append({
            "trackId": tid,
            "framesSeen": len(seq),
            "camPathLength": round(dist, 3),       # camera-space units, NOT metres
            "camSpeed": round(dist / seconds, 3),
            "hasMesh": bool(seq[-1].get("joints_body")),
        })
    return sorted(out, key=lambda r: -r["framesSeen"])


def run(ctx):
    import ingest
    pear_dir = os.environ.get("PEAR_DIR")
    pear_py = os.environ.get("PEAR_PYTHON")
    if not pear_dir or not pear_py or not os.path.exists(pear_py):
        return {"result": {"status": "unavailable", "reason": "set PEAR_DIR and PEAR_PYTHON"}, "confidence": None}

    # GPU gate (PEAR is hard-wired to CUDA)
    gpu = subprocess.run([pear_py, "-c", "import torch;print(torch.cuda.is_available())"], capture_output=True, text=True)
    if "True" not in (gpu.stdout or ""):
        return {"result": {"status": "gpu_required", "detail": (gpu.stdout + gpu.stderr).strip()[:500]}, "confidence": None}

    cfg = ctx.config or {}
    fps = cfg.get("fps", 2)
    frames_dir = os.path.abspath(f"{ctx.work_dir}/frames")
    ingest.frames_for(ctx.api_base, ctx.video_id, frames_dir, fps=fps, max_seconds=cfg.get("maxSeconds", 30), start_seconds=cfg.get("startSeconds"))

    out_json = os.path.abspath(f"{ctx.work_dir}/pear.json")
    adapter = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "pear_adapter.py"))
    cmd = [pear_py, adapter, "--frames", frames_dir, "--out", out_json,
           "--min-bbox", str(cfg.get("minBboxPx", 50)), "--fps", str(fps)]

    render = bool(cfg.get("render"))
    overlay_local = os.path.abspath(f"{ctx.work_dir}/overlay.mp4")
    if render:
        cmd += ["--render-out", overlay_local]

    subprocess.run(cmd, cwd=pear_dir, check=True)
    dets = json.load(open(out_json))
    tracks = link_iou(dets)
    stats = kinematics(tracks, fps=fps)

    overlay_url = None
    if render and os.path.exists(overlay_local) and ctx.job_id:
        out_dir = os.environ.get("ANALYSIS_OUT_DIR") or str(Path(__file__).resolve().parents[2] / "public" / "analysis")
        os.makedirs(out_dir, exist_ok=True)
        shutil.copy(overlay_local, os.path.join(out_dir, f"{ctx.job_id}.mp4"))
        overlay_url = f"/analysis/{ctx.job_id}.mp4"  # served by the API's static public/

    return {
        "result": {
            "detections": len(dets),
            "trackCount": len(tracks),
            "tracks": stats[: cfg.get("maxTracks", 30)],
            "overlayUrl": overlay_url,
            "note": "PEAR SMPLX camera-space kinematics. No pitch homography or player ID; cut highlights => low confidence.",
        },
        "confidence": 0.3,
    }
