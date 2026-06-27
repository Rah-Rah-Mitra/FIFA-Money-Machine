"""One-off: use a Supabase Personal Access Token (Management API) to apply db/schema.sql and
write the project's service_role key into .env. Run:  SUPABASE_PAT=sbp_... python db/provision.py
The PAT is used transiently and never stored."""
import os
import re
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PAT = os.environ["SUPABASE_PAT"]
REF = os.environ.get("SUPABASE_REF", "wijetunpfvklttzpgogn")
H = {"Authorization": f"Bearer {PAT}", "Content-Type": "application/json"}

# 1) apply schema (tables + indexes + RLS on). Idempotent.
sql = (ROOT / "db" / "schema.sql").read_text()
r = requests.post(f"https://api.supabase.com/v1/projects/{REF}/database/query", headers=H, json={"query": sql})
print("schema apply:", r.status_code, (r.text or "")[:200])
r.raise_for_status()

# 2) fetch the service_role key
r = requests.get(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", headers=H)
r.raise_for_status()
keys = {k.get("name"): k.get("api_key") for k in r.json()}
svc = keys.get("service_role")
if not svc:
    raise SystemExit(f"no service_role key in response; got names={list(keys)}")

# 3) write it into .env (replace the placeholder line; never print it)
env_path = ROOT / ".env"
env = env_path.read_text()
env = re.sub(r"^SUPABASE_SERVICE_KEY=.*$", f"SUPABASE_SERVICE_KEY={svc}", env, flags=re.M)
env_path.write_text(env)
print(f"service_role key written to .env (length={len(svc)})")
