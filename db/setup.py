"""Apply db/schema.sql (and optionally db/policies_dev.sql) to the Supabase Postgres.

  python db/setup.py                # tables + RLS
  python db/setup.py --dev-policies # also add anon read/write policies (publishable-key setups)

Reads SUPABASE_DB_URL from .env (percent-encode the password).
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def statements(sql: str):
    # naive splitter — fine here: no semicolons inside string literals or function bodies.
    for s in sql.split(";"):
        s = s.strip()
        if s and not s.startswith("--"):
            yield s


def main():
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL not set in .env")
    files = [ROOT / "db" / "schema.sql"]
    if "--dev-policies" in sys.argv:
        files.append(ROOT / "db" / "policies_dev.sql")
    with psycopg.connect(url, autocommit=True) as conn:
        for f in files:
            for stmt in statements(f.read_text()):
                conn.execute(stmt)
            print(f"applied {f.name}")
    print("done")


if __name__ == "__main__":
    main()
