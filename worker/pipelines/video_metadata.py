"""Reference pipeline: echo the normalized FIFA metadata. Proves the job contract end-to-end."""


def run(ctx):
    import requests
    d = requests.get(f"{ctx.api_base}/videos/{ctx.video_id}", timeout=20).json()
    return {"result": {"metadata": d}, "confidence": 1.0}
