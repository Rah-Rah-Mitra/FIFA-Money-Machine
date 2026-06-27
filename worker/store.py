"""Supabase access for the worker: claim queued jobs, write results."""
import os
from datetime import datetime, timezone
from supabase import create_client, Client


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    # service-role key preferred (bypasses RLS); falls back to publishable for dev setups w/ policies.
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
    return create_client(url, key)


def claim_next(sb: Client) -> dict | None:
    """Grab the oldest queued job and optimistically mark it running.
    ponytail: single-worker optimistic claim. Ceiling: use SELECT ... FOR UPDATE SKIP LOCKED
    (via an RPC) if multiple workers race for jobs."""
    res = sb.table("analysis_jobs").select("*").eq("status", "queued").order("created_at").limit(1).execute()
    rows = res.data or []
    if not rows:
        return None
    job = rows[0]
    upd = (
        sb.table("analysis_jobs")
        .update({"status": "running", "updated_at": _now()})
        .eq("id", job["id"])
        .eq("status", "queued")
        .execute()
    )
    return job if upd.data else None  # empty => lost the race (or RLS blocked the write)


def finish(sb: Client, job_id: str, result: dict, confidence: float | None) -> None:
    sb.table("analysis_jobs").update(
        {"status": "done", "result": result, "confidence": confidence, "updated_at": _now()}
    ).eq("id", job_id).execute()


def fail(sb: Client, job_id: str, err: object) -> None:
    sb.table("analysis_jobs").update(
        {"status": "error", "error": str(err)[:2000], "updated_at": _now()}
    ).eq("id", job_id).execute()
