"""End-to-end seed for one city (PRD §7.2 steps 1-4).

  slice Overture + FSQ  ->  dedupe within each  ->  merge across
  ->  conform  ->  out/<city>/canonical.parquet (+ review queue CSV + stats)

Usage: python run_city.py <city-slug>
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

import slice_fsq
import slice_overture
from cities import get_city
from conform import to_canonical_rows
from match import dedupe_within, match_across

OUT = Path(__file__).parent / "out"


def main(slug: str) -> None:
    city = get_city(slug)
    out_dir = OUT / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    stats: dict = {"city": slug, "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    # 1. slice (FSQ comes from the PK-wide cache; empty until harvested)
    ov_places = slice_overture.load_places(slice_overture.slice_raw(city))
    fsq_places = slice_fsq.load_places(city)
    stats["overture_usable"] = len(ov_places)
    stats["fsq_usable"] = len(fsq_places)
    stats["fsq_pending"] = not slice_fsq.PK_CACHE.exists()

    # 2. intra-source dedupe
    ov_places = dedupe_within(ov_places)
    fsq_places = dedupe_within(fsq_places)
    stats["overture_after_dedupe"] = len(ov_places)
    stats["fsq_after_dedupe"] = len(fsq_places)
    print(f"[dedupe] overture {stats['overture_usable']:,} -> {len(ov_places):,} | "
          f"fsq {stats['fsq_usable']:,} -> {len(fsq_places):,}")

    # 3. merge FSQ into the Overture-led canonical set
    canonical, review_queue = match_across(ov_places, fsq_places)
    matched = len(ov_places) + len(fsq_places) - len(canonical)
    stats["cross_matched"] = matched
    stats["canonical_places"] = len(canonical)
    stats["review_queue"] = len(review_queue)
    print(f"[merge] {matched:,} FSQ records matched into Overture places; "
          f"{len(canonical):,} canonical places; {len(review_queue):,} for review")

    # 4. conform + write
    rows = to_canonical_rows(canonical, slug)
    table = pa.Table.from_pylist(rows)
    canonical_path = out_dir / "canonical.parquet"
    pq.write_table(table, canonical_path, compression="zstd")

    if review_queue:
        with open(out_dir / "review_queue.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(review_queue[0].keys()))
            w.writeheader()
            w.writerows(review_queue)

    by_bucket: dict[str, int] = {}
    with_phone = with_website = 0
    for r in rows:
        by_bucket[r["category_bucket"]] = by_bucket.get(r["category_bucket"], 0) + 1
        with_phone += bool(r["phone"])
        with_website += bool(r["website"])
    stats["by_bucket"] = dict(sorted(by_bucket.items(), key=lambda kv: -kv[1]))
    stats["pct_with_phone"] = round(100 * with_phone / max(len(rows), 1), 1)
    stats["pct_with_website"] = round(100 * with_website / max(len(rows), 1), 1)
    stats["elapsed_s"] = round(time.time() - t0)
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    print(f"\n=== {city['name']} seeded ===")
    print(f"canonical places : {len(rows):,}")
    print(f"with phone       : {stats['pct_with_phone']}%   with website: {stats['pct_with_website']}%")
    print("top buckets      :", ", ".join(f"{k} {v:,}" for k, v in list(stats["by_bucket"].items())[:8]))
    print(f"review queue     : {len(review_queue):,} borderline pairs -> review_queue.csv")
    print(f"output           : {canonical_path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "faisalabad")
