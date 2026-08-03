"""Is the grid leaving holes?

A sweep can look healthy batch-by-batch and still miss ground: if the search
viewport (zoom) is tighter than the grid cell, each cell's corners go
unscraped and the gaps are invisible in row counts. This bins scraped places
onto a coarse lattice and reports the empty and thin cells inside the city
footprint, which is where a hole would show.
"""
from pathlib import Path

import psycopg

dsn = [l.split("=", 1)[1].strip()
       for l in (Path(__file__).parent / ".env.supabase").read_text().splitlines()
       if l.startswith("SUPABASE_DB_URL=")][0]

# Only meaningful on a COMPLETED city. Run mid-sweep and every not-yet-reached
# batch looks like a hole — the first version of this pointed at Lahore at
# 33/60 and "found" 102 unscraped bins that were simply still queued.
import sys
CITY = sys.argv[1] if len(sys.argv) > 1 else "Faisalabad"

with psycopg.connect(dsn, prepare_threshold=None) as c:
    c.execute("set statement_timeout = '180s'")
    rows = c.execute("""
        select
          floor(st_y(p.location::geometry) * 50) as gy,   -- ~2.2 km bins
          floor(st_x(p.location::geometry) * 50) as gx,
          count(*)                                   as n,
          count(*) filter (where p.state <> 'seed_only') as scraped
        from place p join city ct on ct.id = p.city_id
        where ct.name = %s
        group by 1, 2
    """, (CITY,)).fetchall()

if not rows:
    print("no data"); raise SystemExit

tot = sum(r[2] for r in rows)
scraped_tot = sum(r[3] for r in rows)
print(f"{CITY}: {tot:,} places across {len(rows)} bins (~2.2 km each)")
print(f"   {scraped_tot:,} confirmed by a scrape ({scraped_tot / tot * 100:.0f}%)\n")

# Interior bins only: edge bins are legitimately sparse (city boundary).
ys = sorted({r[0] for r in rows}); xs = sorted({r[1] for r in rows})
by = {(r[0], r[1]): r for r in rows}
interior = [
    (y, x) for y in ys[1:-1] for x in xs[1:-1]
    if any((y + dy, x + dx) in by for dy in (-1, 0, 1) for dx in (-1, 0, 1))
]

holes = [(y, x) for (y, x) in interior if (y, x) not in by]
thin = [by[(y, x)] for (y, x) in interior if (y, x) in by and by[(y, x)][3] == 0]

print(f"interior bins checked:        {len(interior)}")
print(f"  with NO places at all:      {len(holes)}")
print(f"  with places but NONE scraped: {len(thin)}")
if thin[:5]:
    print("\n  sample unscraped-but-populated bins (seed data only):")
    for r in sorted(thin, key=lambda r: -r[2])[:5]:
        print(f"    {r[2]:>5} seed places, 0 scraped  @ lat {r[0]/50:.2f} lng {r[1]/50:.2f}")
