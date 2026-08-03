"""Time the full row-producing query exactly as PostgREST runs it."""
from pathlib import Path
import time

import psycopg

dsn = [l.split("=", 1)[1].strip()
       for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
       if l.startswith("SUPABASE_DB_URL=")][0]

with psycopg.connect(dsn, prepare_threshold=None) as c:
    for i in range(3):
        t0 = time.time()
        rows = c.execute(
            "select * from search_places(null,31.418,73.079,5000,null,false,null,60,0,null)"
        ).fetchall()
        print(f"select * ({i+1}): {len(rows)} rows in {time.time()-t0:.2f}s")

    for lim in (5, 20, 60):
        t0 = time.time()
        rows = c.execute(
            f"select * from search_places(null,31.418,73.079,5000,null,false,null,{lim},0,null)"
        ).fetchall()
        print(f"lim={lim}: {time.time()-t0:.2f}s")
    t0 = time.time()
    rows = c.execute(
        "select id,name,rating from search_places(null,31.418,73.079,5000,null,false,null,60,0,null)"
    ).fetchall()
    print(f"3 cols only, lim=60: {time.time()-t0:.2f}s")
