"""Default fast scene: GPU YOLO-pose multi-person keypoints + rich metrics + a heatmap, plus a compact
keypoints file for the client-side skeleton overlay. No PEAR (real-time-ish)."""
import json
import os
from pathlib import Path


def run(ctx):
    import pose_engine

    cfg = ctx.config or {}
    res = pose_engine.analyze(ctx.api_base, ctx.video_id, ctx.work_dir, cfg)
    kp = res.pop("keypoints", {})

    out_dir = os.environ.get("ANALYSIS_OUT_DIR") or str(Path(__file__).resolve().parents[2] / "public" / "analysis")
    os.makedirs(out_dir, exist_ok=True)
    if ctx.job_id:
        with open(os.path.join(out_dir, f"{ctx.job_id}.kp.json"), "w") as f:
            json.dump(kp, f)
        res["keypointsUrl"] = f"/analysis/{ctx.job_id}.kp.json"

    res["kind"] = "pose_scene"
    players = res["players"]
    conf = round(min(1.0, sum(p["framesSeen"] for p in players) / max(1, len(players)) / max(1, res["frameCount"])), 2) if players else 0.0
    return {"result": res, "confidence": conf}
