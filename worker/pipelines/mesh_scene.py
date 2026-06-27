"""Full scene generation: per-player body-part usage (MediaPipe) + a TRANSPARENT PEAR mesh-overlay
video (.webm, alpha) that can be layered back over the highlight. This is what powers the
'analytics available' tag, the mesh overlay, and the stock-market UI."""
import os
import subprocess
from pathlib import Path


def run(ctx):
    import ingest
    import analyze_players

    cfg = ctx.config or {}
    fps = cfg.get("fps", 2)
    start = cfg.get("startSeconds")

    frames_dir = os.path.abspath(f"{ctx.work_dir}/frames")
    frames = ingest.frames_for(ctx.api_base, ctx.video_id, frames_dir, fps=fps, max_seconds=cfg.get("maxSeconds", 8), start_seconds=start)

    # 1) fast per-player usage stats (MediaPipe)
    stats = analyze_players.analyze_frames(frames, fps=fps, start_seconds=start or 0, cfg=cfg)

    # 2) transparent PEAR mesh overlay (GPU)
    overlay_url = None
    pear_dir, pear_py = os.environ.get("PEAR_DIR"), os.environ.get("PEAR_PYTHON")
    if pear_dir and pear_py and os.path.exists(pear_py):
        gpu = subprocess.run([pear_py, "-c", "import torch;print(torch.cuda.is_available())"], capture_output=True, text=True)
        if "True" in (gpu.stdout or ""):
            render_dir = os.path.abspath(f"{ctx.work_dir}/mesh_png")
            out_json = os.path.abspath(f"{ctx.work_dir}/pear.json")
            adapter = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "pear_adapter.py"))
            subprocess.run(
                [pear_py, adapter, "--frames", frames_dir, "--out", out_json,
                 "--min-bbox", str(cfg.get("minBboxPx", 40)), "--render-dir", render_dir],
                cwd=pear_dir, check=True,
            )
            out_dir = os.environ.get("ANALYSIS_OUT_DIR") or str(Path(__file__).resolve().parents[2] / "public" / "analysis")
            os.makedirs(out_dir, exist_ok=True)
            webm = os.path.join(out_dir, f"{ctx.job_id}.webm")
            ff = ingest._ffmpeg_bin()
            # VP9 with alpha so the overlay is transparent where there's no mesh.
            subprocess.run(
                [ff, "-y", "-loglevel", "error", "-framerate", str(fps),
                 "-i", os.path.join(render_dir, "mesh_%05d.png"),
                 "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", webm],
                check=True,
            )
            overlay_url = f"/analysis/{ctx.job_id}.webm"
        else:
            stats["meshNote"] = "gpu_required for mesh overlay"

    return {
        "result": {**stats, "kind": "mesh_scene", "overlayUrl": overlay_url, "maxSeconds": cfg.get("maxSeconds", 8)},
        "confidence": 0.3 if overlay_url else 0.2,
    }
