"""Print one cloud place carrying mined prices (for live verification)."""
from pathlib import Path

import psycopg

dsn = [l.split("=", 1)[1].strip()
       for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
       if l.startswith("SUPABASE_DB_URL=")][0]

with psycopg.connect(dsn, prepare_threshold=None) as c:
    row = c.execute("""
        select id, name, price_mentions from place
        where price_mentions is not null
          and city_id = (select id from city where slug = 'lahore')
        limit 1
    """).fetchone()
    print(row[0], "|", row[1], "|", row[2])
