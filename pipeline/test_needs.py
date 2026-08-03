"""Quick check of the needs param + overload uniqueness after apply_sql."""
from pathlib import Path
import time

import psycopg

dsn = [l.split("=", 1)[1].strip()
       for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
       if l.startswith("SUPABASE_DB_URL=")][0]

with psycopg.connect(dsn, prepare_threshold=None) as c:
    for i in range(3):
        t0 = time.time()
        n = c.execute(
            "select count(*) from search_places(null,31.418,73.079,5000,null,false,null,60,0,array['halal'])"
        ).fetchone()[0]
        print(f"halal-need browse ({i+1}): {n} rows in {time.time()-t0:.2f}s")

    t0 = time.time()
    n2 = c.execute("select count(*) from count_in_radii(null,31.418,73.079,array[5000])").fetchone()[0]
    print(f"count_in_radii unique: {n2} row in {time.time()-t0:.2f}s")

    top = c.execute(
        "select name from search_places(null,31.418,73.079,5000,null,false,null,5,0,array['halal'])"
    ).fetchall()
    print("top halal:", [r[0] for r in top])

    both = c.execute(
        "select count(*) from search_places(null,31.418,73.079,5000,null,false,null,60,0,array['halal','kids'])"
    ).fetchone()[0]
    print(f"halal+kids: {both} rows")
