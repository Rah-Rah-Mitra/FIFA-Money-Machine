"""Polls Supabase analysis_jobs, runs the requested pipeline, writes results back.

  python worker.py            # loop forever
  python worker.py --once     # process a single job then exit (handy for testing)
"""
import argparse
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))  # so `import store`, `import ingest`, `import pipelines` resolve
load_dotenv(ROOT.parent / ".env")

import store
from pipelines import REGISTRY, Ctx

API_BASE = os.environ.get("API_BASE", "http://localhost:3000")


def process(sb, job):
    fn = REGISTRY.get(job["pipeline"])
    if not fn:
        store.fail(sb, job["id"], f"unknown pipeline {job['pipeline']}")
        return
    with tempfile.TemporaryDirectory(prefix="fifa_") as wd:
        ctx = Ctx(video_id=job["video_id"], config=job.get("config") or {}, api_base=API_BASE, work_dir=wd, job_id=job["id"])
        out = fn(ctx)
    store.finish(sb, job["id"], out.get("result"), out.get("confidence"))
    print(f"[done] {job['pipeline']} {job['video_id']} conf={out.get('confidence')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process one job then exit")
    ap.add_argument("--interval", type=float, default=3.0)
    args = ap.parse_args()

    sb = store.get_client()
    print(f"worker up; api={API_BASE}; pipelines={list(REGISTRY)}")
    while True:
        job = store.claim_next(sb)
        if job:
            print(f"[claim] {job['pipeline']} {job['video_id']} {job['id']}")
            try:
                process(sb, job)
            except Exception as e:  # noqa: BLE001 — mark the job failed, keep the worker alive
                traceback.print_exc()
                store.fail(sb, job["id"], e)
        if args.once:
            if not job:
                print("no queued jobs")
            break
        if not job:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
