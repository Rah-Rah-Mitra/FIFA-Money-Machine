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
    play_url: str, out_dir: str, fps: float = 2, max_seconds: int | None = None,
    start_seconds: float | None = None, height: int | None = None,
) -> list[str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # Uplynk 403s ffmpeg's default "Lavf" UA — present as a browser.
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
    args = [_ffmpeg_bin(), "-y", "-nostdin", "-loglevel", "error", "-user_agent", ua]
    if start_seconds:  # fast input seek (before -i) to skip intro/ad cards
        args += ["-ss", str(start_seconds)]
    vf = f"fps={fps}" + (f",scale=-2:{height}" if height else "")  # downscale for speed
    args += ["-i", play_url, "-vf", vf]
    if max_seconds:  # -t AFTER -i (output duration); before -i it breaks HLS reads
        args += ["-t", str(max_seconds)]
    args += [str(out / "%05d.jpg")]
    try:
        subprocess.run(args, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg failed ({e.returncode}): {(e.stderr or '')[-500:]}") from e
    return sorted(str(p) for p in out.glob("*.jpg"))


def frames_for(api_base, video_id, out_dir, fps=2, max_seconds=None, start_seconds=None, height=None, retries=3):
    """Resolve a fresh stream + extract frames, retrying on transient Uplynk 403s (token/edge hiccups)."""
    last = None
    for _ in range(retries):
        try:
            play = get_play_url(api_base, video_id)
            frames = extract_frames(play, out_dir, fps=fps, max_seconds=max_seconds, start_seconds=start_seconds, height=height)
            if frames:
                return frames
            last = RuntimeError("no frames extracted")
        except Exception as e:  # noqa: BLE001
            last = e
    raise last
