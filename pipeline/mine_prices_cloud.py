"""Mine review-mentioned prices into the cloud tier.

The bundle export already mines prices for its 6,000 places per city; this
runs the SAME miner (imported, not duplicated — the quality gates live in
one place) across every city's full review cache and writes the result to
place.price_mentions in Supabase, so cloud users get the feature for all
~33k reviewed places, not just the bundled slice.

Idempotent: recomputes and overwrites on each run. Run after a city's
reviews change (i.e. after load_supabase.py).

Usage: python mine_prices_cloud.py [slug ...]   (default: all cities present)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg
import pyarrow.parquet as pq

from export_app_data import mine_prices

ROOT = Path(__file__).parent
OUT = ROOT / "out"


def dsn() -> str:
    import os
    v = os.environ.get("SUPABASE_DB_URL")
    if v:
        return v
    for line in (ROOT / ".env.supabase").read_text().splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("SUPABASE_DB_URL not set")


def mine_city(slug: str) -> dict[str, list[int]]:
    rp = OUT / slug / "google_reviews.parquet"
    if not rp.exists():
        print(f"[{slug}] no review cache — skipped")
        return {}
    found: dict[str, list[int]] = {}
    for r in pq.read_table(rp).to_pylist():
        try:
            pm = mine_prices(json.loads(r["reviews"]))
        except (json.JSONDecodeError, TypeError):
            continue
        if pm:
            found[r["place_id"]] = pm
    print(f"[{slug}] {len(found):,} places with credible price ranges")
    return found


def main(slugs: list[str]) -> None:
    if not slugs:
        slugs = sorted(p.name for p in OUT.iterdir()
                       if (p / "google_reviews.parquet").exists())

    mined: dict[str, list[int]] = {}
    for slug in slugs:
        mined.update(mine_city(slug))
    if not mined:
        print("nothing mined")
        return

    with psycopg.connect(dsn(), prepare_threshold=None) as conn:
        conn.execute(
            "ALTER TABLE place ADD COLUMN IF NOT EXISTS price_mentions jsonb")
        # Clear stale values first: a place whose range no longer passes the
        # quality gates must lose it, not keep an old claim forever.
        conn.execute("UPDATE place SET price_mentions = NULL "
                     "WHERE price_mentions IS NOT NULL")
        with conn.cursor() as cur:
            items = list(mined.items())
            for i in range(0, len(items), 500):
                cur.executemany(
                    "UPDATE place SET price_mentions = %s::jsonb WHERE ext_id = %s",
                    [(json.dumps(pm), ext_id) for ext_id, pm in items[i:i + 500]],
                )
                conn.commit()
        n = conn.execute(
            "SELECT count(*) FROM place WHERE price_mentions IS NOT NULL"
        ).fetchone()[0]
    print(f"done — {n:,} places carry mined prices in the cloud")


if __name__ == "__main__":
    main(sys.argv[1:])
