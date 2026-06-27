"""Fetch a playable stream for a highlight and extract frames for CV pipelines."""
import os
import subprocess
from pathlib import Path
import requests


def _ffmpeg_bin() -> str:
    # FFMPEG_BIN override -> imageio-ffmpeg's bundled binary -> ffmpeg on PATH.
    if os.environ.get("FFMPEG_BIN"):
        return os.environ["FFMPEG_BIN"]
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def get_play_url(api_base: str, video_id: str) -> str:
    """API /playback returns a short-lived Uplynk preplay JSON URL; resolve it to the .m3u8 playURL."""
    pb = requests.get(f"{api_base}/videos/{video_id}/playback", timeout=20).json()
    stream = pb.get("streamUrl")
    if not stream:
        raise RuntimeError("playback returned no streamUrl")
    try:
        pre = requests.get(stream, timeout=20).json()
        return pre.get("playURL") or pre.get("playUrl") or stream
    except Exception:
        return stream  # last resort: hand the preplay URL straight to ffmpeg


def extract_frames(
    play_url: str, out_dir: str, fps: float = 2, max_seconds: int | None = None, start_seconds: float | None = None
) -> list[str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    args = [_ffmpeg_bin(), "-y", "-nostdin", "-loglevel", "error"]
    if start_seconds:  # fast input seek (before -i) to skip intro/ad cards
        args += ["-ss", str(start_seconds)]
    args += ["-i", play_url, "-vf", f"fps={fps}"]
    if max_seconds:  # -t AFTER -i (output duration); before -i it breaks HLS reads
        args += ["-t", str(max_seconds)]
    args += [str(out / "%05d.jpg")]
    try:
        subprocess.run(args, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg failed ({e.returncode}): {(e.stderr or '')[-500:]}") from e
    return sorted(str(p) for p in out.glob("*.jpg"))
