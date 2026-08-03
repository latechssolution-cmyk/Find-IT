"""Foursquare OS Places -> Place records, from a Pakistan-wide local cache.

The FSQ global release is a single unsorted ~11 GB parquet dump — per-city
remote queries scan the whole planet and die on flaky connections. So FSQ is
harvested ONCE for all of Pakistan by `fsq_pk_harvest.py` (file-by-file,
resumable) into out/_pk/raw_fsq_pk.parquet; this module just filters that
cache by city bbox.

If the cache doesn't exist yet, load_places() returns [] and the city seeds
from Overture alone — re-running run_city.py after the harvest folds FSQ in
(canonical ids are deterministic, so it's a clean upsert downstream).
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

from cities import get_city
from match import Place

OUT = Path(__file__).parent / "out"
PK_CACHE = OUT / "_pk" / "raw_fsq_pk.parquet"

# FSQ's own guidance is date_refreshed >= now - 1y; that is brutal for a
# market like PK. We take a 5-year window and let scraper verification
# (PRD §7.6) do the real liveness filtering.
MIN_REFRESHED = "2021-07-01"

COLUMNS = (
    "fsq_place_id, name, latitude, longitude, address, locality, region, "
    "postcode, country, tel, website, email, facebook_id, instagram, twitter, "
    "fsq_category_labels, date_created, date_refreshed, date_closed"
)


def load_places(city: dict) -> list[Place]:
    if not PK_CACHE.exists():
        print(f"[fsq] PK cache missing ({PK_CACHE}) — run fsq_pk_harvest.py; "
              f"seeding from Overture only for now")
        return []

    min_lon, min_lat, max_lon, max_lat = city["bbox"]
    con = duckdb.connect()
    rows = con.execute(f"""
        SELECT fsq_place_id, name, latitude, longitude, address, locality,
               postcode, tel, website, email, facebook_id, instagram, twitter,
               fsq_category_labels
        FROM read_parquet('{PK_CACHE.as_posix()}')
        WHERE latitude BETWEEN {min_lat} AND {max_lat}
          AND longitude BETWEEN {min_lon} AND {max_lon}
          AND date_closed IS NULL
          AND name IS NOT NULL
          AND coalesce(date_refreshed, date_created) >= '{MIN_REFRESHED}'
    """).fetchall()
    con.close()

    places: list[Place] = []
    for (fsq_id, name, lat, lon, address, locality, postcode, tel, website,
         email, fb, ig, tw, cat_labels) in rows:
        socials = []
        if fb:
            socials.append(f"https://facebook.com/{fb}")
        if ig:
            socials.append(f"https://instagram.com/{ig}")
        if tw:
            socials.append(f"https://x.com/{tw}")
        places.append(Place(
            source="fsq",
            source_id=str(fsq_id),
            name=str(name),
            lat=float(lat),
            lon=float(lon),
            categories=[str(c) for c in (cat_labels or [])],
            address=address,
            locality=locality,
            postcode=postcode,
            phone=tel,
            website=website,
            email=email,
            socials=socials,
        ))
    print(f"[fsq] {len(places):,} usable places from PK cache "
          f"(open, named, refreshed >= {MIN_REFRESHED})")
    return places


if __name__ == "__main__":
    load_places(get_city(sys.argv[1] if len(sys.argv) > 1 else "faisalabad"))
