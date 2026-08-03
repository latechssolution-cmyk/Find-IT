"""Resumable Pakistan-wide harvest of Foursquare OS Places.

Strategy for hostile connections: process the release's ~90 parquet files ONE
AT A TIME, extracting only country='PK' rows into out/_pk/parts/<file>.parquet.
Each part is atomic (tmp + rename) and skipped once done, so any crash or
network corruption costs one file, not the run. Outer passes loop until every
file is harvested, then parts are combined into raw_fsq_pk.parquet and the
seeded cities are rebuilt so FSQ folds into their canonicals automatically.

Run detached:  python -u fsq_pk_harvest.py >> out/_pk/harvest.log 2>&1
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import duckdb

DT = "2026-07-09"
API = ("https://huggingface.co/api/datasets/foursquare/fsq-os-places/"
       f"tree/main/release/dt%3D{DT}/places/parquet")
HF_FILE = "hf://datasets/foursquare/fsq-os-places/{path}"

OUT = Path(__file__).parent / "out"
PK_DIR = OUT / "_pk"
PARTS = PK_DIR / "parts"
CACHE = PK_DIR / "raw_fsq_pk.parquet"

CITIES_TO_REBUILD = ("faisalabad", "lahore", "islamabad-rawalpindi")
MAX_HOURS = 12

from slice_fsq import COLUMNS  # single source of truth for the column list


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def list_release_files() -> list[str]:
    """File paths within the dataset repo, via the HF tree API (curl: it
    retries and has proven the most robust client on this connection)."""
    for attempt in range(1, 21):
        try:
            r = subprocess.run(
                ["curl.exe", "-sS", "--max-time", "60", "--retry", "5",
                 "--retry-all-errors", API],
                capture_output=True, text=True, timeout=120,
            )
            items = json.loads(r.stdout)
            paths = [it["path"] for it in items
                     if it.get("path", "").endswith(".parquet")]
            if paths:
                return sorted(paths)
        except (json.JSONDecodeError, subprocess.TimeoutExpired) as e:
            log(f"file-list attempt {attempt} failed: {e}")
        time.sleep(min(60, 5 * attempt))
    raise RuntimeError("could not fetch release file list")


def harvest_one(path: str) -> bool:
    stem = Path(path).stem
    part = PARTS / f"{stem}.parquet"
    if part.exists():
        return True
    tmp = part.with_suffix(".parquet.tmp")
    con = duckdb.connect()
    try:
        con.execute("LOAD httpfs;")
        for pragma in ("SET http_retries=8;", "SET http_retry_wait_ms=2000;",
                       "SET http_timeout=120000;"):
            try:
                con.execute(pragma)
            except duckdb.Error:
                pass
        src = HF_FILE.format(path=path)
        con.execute(f"""
            COPY (SELECT {COLUMNS} FROM read_parquet('{src}')
                  WHERE country = 'PK')
            TO '{tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        n = con.execute(
            f"SELECT count(*) FROM read_parquet('{tmp.as_posix()}')"
        ).fetchone()[0]
        tmp.replace(part)
        log(f"  {stem}: {n:,} PK rows")
        return True
    except duckdb.Error as e:
        log(f"  {stem}: FAILED ({str(e)[:160]})")
        tmp.unlink(missing_ok=True)
        return False
    finally:
        con.close()


def main() -> None:
    PARTS.mkdir(parents=True, exist_ok=True)
    if CACHE.exists():
        log(f"cache already complete: {CACHE}")
    else:
        files = list_release_files()
        log(f"release dt={DT}: {len(files)} parquet files to harvest")
        deadline = time.time() + MAX_HOURS * 3600
        rounds = 0
        while time.time() < deadline:
            rounds += 1
            pending = [p for p in files
                       if not (PARTS / f"{Path(p).stem}.parquet").exists()]
            if not pending:
                break
            log(f"pass {rounds}: {len(pending)}/{len(files)} files remaining")
            for p in pending:
                harvest_one(p)
                if time.time() > deadline:
                    break
            time.sleep(10)
        pending = [p for p in files
                   if not (PARTS / f"{Path(p).stem}.parquet").exists()]
        if pending:
            log(f"GAVE UP with {len(pending)} files unharvested "
                f"(rerun this script to resume)")
            return

        con = duckdb.connect()
        tmp = CACHE.with_suffix(".parquet.tmp")
        con.execute(f"""
            COPY (SELECT * FROM read_parquet('{(PARTS / '*.parquet').as_posix()}'))
            TO '{tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        n = con.execute(
            f"SELECT count(*) FROM read_parquet('{tmp.as_posix()}')"
        ).fetchone()[0]
        con.close()
        tmp.replace(CACHE)
        log(f"HARVEST COMPLETE: {n:,} Pakistan places -> {CACHE}")

    if "--no-rebuild" in sys.argv:
        # Harvest only. run_city.main() REWRITES canonical.parquet, and the
        # sweep's ingest reads that same file every ten batches — rebuilding a
        # city mid-sweep races a live reader against a partial write. With
        # this flag the download can run alongside the sweep, and the folds
        # happen later at a quiet moment:
        #     python fsq_pk_harvest.py            (rebuilds everything)
        #     python run_city.py <slug>           (one city, when it is idle)
        log("harvest complete; skipping city rebuilds (--no-rebuild)")
        return

    import run_city
    for slug in CITIES_TO_REBUILD:
        overture_raw = OUT / slug / "raw_overture.parquet"
        if overture_raw.exists():
            log(f"rebuilding canonical for {slug} with FSQ folded in...")
            try:
                run_city.main(slug)
            except Exception as e:  # keep going; a city rebuild can be rerun
                log(f"  {slug} rebuild failed: {e}")
    log("ALL DONE")


if __name__ == "__main__":
    main()
