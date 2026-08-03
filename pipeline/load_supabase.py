"""Load a city's enriched data into the Supabase hot tier (PRD §7.2 step 4).

Schema lives in ../supabase/schema.sql + search.sql (single source of truth);
this applies them, then upserts places and the bounded Google-review cache.

Requires:
  pip install "psycopg[binary]"
  set SUPABASE_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres

Idempotent: upserts on the pipeline's deterministic ext_id, so re-running after
a re-scrape updates rather than duplicates.

Usage: python load_supabase.py <city-slug> [--schema-only]
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pyarrow.parquet as pq

from cities import get_city

ROOT = Path(__file__).parent
SQL_DIR = ROOT.parent / "supabase"

PLACE_COLS = [
    "ext_id", "gers_id", "fsq_id", "google_place_id", "google_cid",
    "name", "category_bucket", "categories_raw", "google_category", "description",
    "address", "locality", "postcode", "phone", "website", "email", "socials",
    "h3_9", "rating", "rating_count", "rating_histogram", "price_range", "hours",
    "popular_times", "attributes", "cards_ok", "menu_url", "order_online_url",
    "reservations_url", "reviews_link", "maps_link", "street_view_url",
    "plus_code", "photo_urls", "state", "confidence", "sources", "google_status",
    "enriched_at", "seen_at",
]

UPSERT = f"""
INSERT INTO place ({", ".join(PLACE_COLS)}, city_id, location)
VALUES ({", ".join("%(" + c + ")s" for c in PLACE_COLS)}, %(city_id)s,
        ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography)
ON CONFLICT (ext_id) DO UPDATE SET
  google_place_id = COALESCE(EXCLUDED.google_place_id, place.google_place_id),
  google_cid      = COALESCE(EXCLUDED.google_cid, place.google_cid),
  name            = EXCLUDED.name,
  category_bucket = EXCLUDED.category_bucket,
  categories_raw  = EXCLUDED.categories_raw,
  google_category = COALESCE(EXCLUDED.google_category, place.google_category),
  description     = COALESCE(EXCLUDED.description, place.description),
  address         = COALESCE(EXCLUDED.address, place.address),
  locality        = COALESCE(EXCLUDED.locality, place.locality),
  phone           = COALESCE(EXCLUDED.phone, place.phone),
  website         = COALESCE(EXCLUDED.website, place.website),
  email           = COALESCE(EXCLUDED.email, place.email),
  location        = EXCLUDED.location,
  rating          = COALESCE(EXCLUDED.rating, place.rating),
  rating_count    = COALESCE(EXCLUDED.rating_count, place.rating_count),
  rating_histogram= COALESCE(EXCLUDED.rating_histogram, place.rating_histogram),
  price_range     = COALESCE(EXCLUDED.price_range, place.price_range),
  hours           = COALESCE(EXCLUDED.hours, place.hours),
  popular_times   = COALESCE(EXCLUDED.popular_times, place.popular_times),
  attributes      = COALESCE(EXCLUDED.attributes, place.attributes),
  cards_ok        = EXCLUDED.cards_ok OR place.cards_ok,
  menu_url        = COALESCE(EXCLUDED.menu_url, place.menu_url),
  order_online_url= COALESCE(EXCLUDED.order_online_url, place.order_online_url),
  reservations_url= COALESCE(EXCLUDED.reservations_url, place.reservations_url),
  reviews_link    = COALESCE(EXCLUDED.reviews_link, place.reviews_link),
  maps_link       = COALESCE(EXCLUDED.maps_link, place.maps_link),
  photo_urls      = CASE WHEN cardinality(EXCLUDED.photo_urls) > 0
                         THEN EXCLUDED.photo_urls ELSE place.photo_urls END,
  state           = EXCLUDED.state,
  google_status   = EXCLUDED.google_status,
  enriched_at     = COALESCE(EXCLUDED.enriched_at, place.enriched_at),
  seen_at         = COALESCE(EXCLUDED.seen_at, place.seen_at);
"""

REVIEW_UPSERT = """
INSERT INTO google_review_cache (place_id, reviews, fetched_at)
SELECT p.id, %(reviews)s::jsonb, %(fetched_at)s
FROM place p WHERE p.ext_id = %(ext_id)s
ON CONFLICT (place_id) DO UPDATE SET
  reviews = EXCLUDED.reviews, fetched_at = EXCLUDED.fetched_at;
"""


def _row(r: dict, city_id: int) -> dict:
    """Parquet row -> psycopg params. JSON-ish columns are already compact
    strings from ingest_scrape; empty strings must become NULL for jsonb."""
    out = {c: r.get(c) for c in PLACE_COLS}
    out["ext_id"] = r["id"]
    for j in ("rating_histogram", "popular_times", "attributes"):
        v = out.get(j)
        out[j] = v if (v and str(v).strip()) else None
    for a in ("categories_raw", "socials", "photo_urls", "sources"):
        out[a] = list(r.get(a) or [])
    out["cards_ok"] = bool(r.get("cards_ok"))
    out["city_id"] = city_id
    out["lat"], out["lng"] = r["lat"], r["lng"]
    return out


def main(slug: str, schema_only: bool = False) -> None:
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg missing: pip install "psycopg[binary]"')

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("Set SUPABASE_DB_URL (Supabase dashboard -> Connect -> Direct connection)")

    city = get_city(slug)
    city_dir = ROOT / "out" / slug
    src = city_dir / "enriched.parquet"
    if not src.exists():
        src = city_dir / "canonical.parquet"
    if not src.exists():
        sys.exit(f"no parquet for '{slug}' — run: python run_city.py {slug}")

    with psycopg.connect(dsn) as conn:
        for f in ("schema.sql", "search.sql"):
            print(f"applying {f}...")
            conn.execute((SQL_DIR / f).read_text(encoding="utf-8"))
        conn.commit()
        if schema_only:
            print("schema applied; skipping data load")
            return

        lon, lat = city["center"]
        city_id = conn.execute(
            """INSERT INTO city (slug, name, center, is_live)
               VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, true)
               ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_live = true
               RETURNING id""",
            (slug, city["name"], lon, lat),
        ).fetchone()[0]

        rows = pq.read_table(src).to_pylist()
        print(f"loading {len(rows):,} places for '{slug}' from {src.name}...")
        with conn.cursor() as cur:
            for i in range(0, len(rows), 500):
                cur.executemany(UPSERT, [_row(r, city_id) for r in rows[i:i + 500]])
                conn.commit()
                print(f"  {min(i + 500, len(rows)):,}/{len(rows):,}")

        rp = city_dir / "google_reviews.parquet"
        if rp.exists():
            revs = pq.read_table(rp).to_pylist()
            print(f"loading google reviews for {len(revs):,} places...")
            with conn.cursor() as cur:
                for i in range(0, len(revs), 500):
                    cur.executemany(REVIEW_UPSERT, [
                        {"ext_id": r["place_id"], "reviews": r["reviews"],
                         "fetched_at": r["fetched_at"]}
                        for r in revs[i:i + 500]
                    ])
                    conn.commit()

        conn.execute(
            "UPDATE city SET place_count = (SELECT count(*) FROM place WHERE city_id = %s) WHERE id = %s",
            (city_id, city_id))
        conn.commit()
        n = conn.execute("SELECT count(*) FROM place WHERE city_id = %s", (city_id,)).fetchone()[0]
    print(f"done — {n:,} places live in Supabase for '{slug}'")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else "faisalabad", "--schema-only" in sys.argv)
