"""Refresh planner statistics — run after any bulk load."""
import time
from pathlib import Path

import psycopg

dsn = [l.split("=", 1)[1].strip()
       for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
       if l.startswith("SUPABASE_DB_URL=")][0]

with psycopg.connect(dsn, prepare_threshold=None) as c:
    c.execute("set statement_timeout = '180s'")
    t0 = time.time()
    c.execute("ANALYZE place")
    c.execute("ANALYZE google_review_cache")
    c.commit()
    print(f"ANALYZE took {time.time() - t0:.1f}s")
