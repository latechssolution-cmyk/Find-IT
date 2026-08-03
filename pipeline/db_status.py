"""Live inventory of the hot tier — what the app actually serves."""
import os
from pathlib import Path

import psycopg

dsn = os.environ.get("SUPABASE_DB_URL") or [
    l.split("=", 1)[1].strip()
    for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
    if l.startswith("SUPABASE_DB_URL=")
][0]

with psycopg.connect(dsn, prepare_threshold=None) as c:
    rows = c.execute("""
        select c.name, c.place_count,
               (select count(*) from google_review_cache g
                  join place p2 on p2.id = g.place_id where p2.city_id = c.id) as revs,
               (select count(*) from place p3
                  where p3.city_id = c.id and p3.rating is not null) as rated
        from city c order by c.place_count desc
    """).fetchall()
    for name, n, revs, rated in rows:
        print(f"{name:<26} {n:>7,} places  {rated:>7,} rated  {revs:>7,} w/reviews")
    total = c.execute("select count(*) from place").fetchone()[0]
    trev = c.execute("select count(*) from google_review_cache").fetchone()[0]
    print(f"{'TOTAL':<26} {total:>7,} places  {'':>7}         {trev:>7,} w/reviews")
