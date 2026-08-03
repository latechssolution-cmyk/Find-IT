"""Apply supabase/*.sql to the project DB (DSN from .env.supabase, never argv).

Usage: python apply_sql.py [search.sql schema.sql ...]   (default: both)
"""

from pathlib import Path
import sys

import psycopg

ROOT = Path(__file__).parent
SQL_DIR = ROOT.parent / "supabase"


def dsn() -> str:
    for line in (ROOT / ".env.supabase").read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("SUPABASE_DB_URL missing from .env.supabase")


def main(files: list[str]) -> None:
    with psycopg.connect(dsn()) as conn:
        for f in files or ["schema.sql", "search.sql"]:
            print(f"applying {f}...")
            conn.execute((SQL_DIR / f).read_text(encoding="utf-8"))
        conn.commit()
    print("done")


if __name__ == "__main__":
    main(sys.argv[1:])
