"""Reference pipeline: snapshot the deterministic playback analytics for the video."""


def run(ctx):
    import requests
    a = requests.get(f"{ctx.api_base}/videos/{ctx.video_id}/analytics", timeout=20).json()
    return {"result": {"analytics": a}, "confidence": 1.0}
