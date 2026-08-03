"""Slice the Overture Maps `places` theme for one city bbox.

Two stages, deliberately separated:
  raw   : SELECT * with bbox predicate pushdown -> out/<city>/raw_overture.parquet
          (this is the R2-bound "raw dump"; re-transformable forever)
  clean : nested-schema extraction -> list[Place]
          Field extraction is schema-defensive: every optional expression is
          probed with a LIMIT-0 query first, so monthly Overture schema drift
          (e.g. the categories -> taxonomy migration) degrades to NULLs
          instead of crashing the slice.

Usage: python slice_overture.py <city-slug> [release]
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import duckdb

from cities import get_city
from match import Place

DEFAULT_RELEASE = "2026-07-22.0"
S3_GLOB = "s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"

OUT = Path(__file__).parent / "out"


def _connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    # http retries help on flaky links; harmless otherwise
    for pragma in (
        "SET http_retries=10;",
        "SET http_retry_wait_ms=2000;",
        "SET http_timeout=120000;",
    ):
        try:
            con.execute(pragma)
        except duckdb.Error:
            pass
    return con


def slice_raw(city: dict, release: str = DEFAULT_RELEASE, attempts: int = 5) -> Path:
    out_dir = OUT / city["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / "raw_overture.parquet"
    if raw_path.exists() and raw_path.stat().st_size > 0:
        print(f"[overture] raw slice exists, skipping: {raw_path}")
        return raw_path

    min_lon, min_lat, max_lon, max_lat = city["bbox"]
    src = S3_GLOB.format(release=release)
    tmp_path = raw_path.with_suffix(".parquet.tmp")
    sql = f"""
        COPY (
            SELECT * FROM read_parquet('{src}', hive_partitioning=1)
            WHERE bbox.xmin BETWEEN {min_lon} AND {max_lon}
              AND bbox.ymin BETWEEN {min_lat} AND {max_lat}
        ) TO '{tmp_path.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """
    for attempt in range(1, attempts + 1):
        con = _connect()
        try:
            t0 = time.time()
            print(f"[overture] slicing {city['name']} from {release} (attempt {attempt})...", flush=True)
            con.execute(sql)
            n = con.execute(
                f"SELECT count(*) FROM read_parquet('{tmp_path.as_posix()}')"
            ).fetchone()[0]
            tmp_path.replace(raw_path)
            print(f"[overture] {n:,} rows in {time.time() - t0:.0f}s -> {raw_path}", flush=True)
            return raw_path
        except duckdb.Error as e:
            print(f"[overture] attempt {attempt} failed: {str(e)[:300]}", flush=True)
            tmp_path.unlink(missing_ok=True)
            time.sleep(min(30, 5 * attempt))
        finally:
            con.close()
    raise RuntimeError(f"Overture slice failed after {attempts} attempts")


def _probe(con, raw: str, expr: str) -> bool:
    try:
        con.execute(f"SELECT {expr} FROM read_parquet('{raw}') LIMIT 0")
        return True
    except duckdb.Error:
        return False


def load_places(raw_path: Path) -> list[Place]:
    con = duckdb.connect()
    raw = raw_path.as_posix()

    fields = {
        "source_id": ["id"],
        "name": ["names.primary", "names['primary']"],
        "cat_primary": ["categories.primary", "basic_category"],
        "cat_alternate": ["categories.alternate", "NULL"],
        "confidence": ["confidence", "NULL"],
        "address": ["addresses[1].freeform", "NULL"],
        "locality": ["addresses[1].locality", "NULL"],
        "postcode": ["addresses[1].postcode", "NULL"],
        "phone": ["phones[1]", "NULL"],
        "website": ["websites[1]", "NULL"],
        "email": ["emails[1]", "NULL"],
        "socials": ["socials", "NULL"],
        "status": ["operating_status", "NULL"],
        # For point geometries the bbox degenerates to the point itself —
        # avoids needing the spatial extension for WKB decoding.
        "lon": ["bbox.xmin"],
        "lat": ["bbox.ymin"],
    }
    select_parts = []
    for alias, candidates in fields.items():
        chosen = next((c for c in candidates if _probe(con, raw, c)), "NULL")
        select_parts.append(f"{chosen} AS {alias}")

    rows = con.execute(
        f"SELECT {', '.join(select_parts)} FROM read_parquet('{raw}')"
    ).fetchall()
    cols = [d[0] for d in con.description]
    con.close()

    places: list[Place] = []
    skipped = 0
    for row in rows:
        r = dict(zip(cols, row))
        if not r["name"] or r["lat"] is None or r["lon"] is None:
            skipped += 1
            continue
        if r["status"] and str(r["status"]) != "open":
            skipped += 1
            continue
        cats = [c for c in [r["cat_primary"], *(r["cat_alternate"] or [])] if c]
        places.append(Place(
            source="overture",
            source_id=str(r["source_id"]),
            name=str(r["name"]),
            lat=float(r["lat"]),
            lon=float(r["lon"]),
            categories=[str(c) for c in cats],
            address=r["address"],
            locality=r["locality"],
            postcode=r["postcode"],
            phone=r["phone"],
            website=r["website"],
            email=r["email"],
            socials=[str(s) for s in (r["socials"] or [])],
            confidence=float(r["confidence"]) if r["confidence"] is not None else None,
        ))
    print(f"[overture] {len(places):,} usable places ({skipped:,} skipped: unnamed/closed)")
    return places


if __name__ == "__main__":
    city = get_city(sys.argv[1] if len(sys.argv) > 1 else "faisalabad")
    release = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_RELEASE
    load_places(slice_raw(city, release))
