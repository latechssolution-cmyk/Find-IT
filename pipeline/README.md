# FIND IT — data pipeline

Seeds a city's business database from open data (PRD §7.2, steps 1–4):
Overture Maps `places` (CDLA-Permissive 2.0) + Foursquare OS Places (Apache 2.0)
→ dedupe (H3 + trigram) → cross-source merge → canonical parquet.

## Setup

```bash
pip install -r requirements.txt
```

## Seed a city

```bash
python run_city.py faisalabad
```

Outputs in `out/<city>/`:

| File | What |
|---|---|
| `raw_overture.parquet` | untouched Overture slice (upload to R2 — system of record) |
| `raw_fsq.parquet` | untouched FSQ slice (same) |
| `canonical.parquet` | merged, deduped, serving-shaped places (`state = seed_only`) |
| `review_queue.csv` | borderline match pairs for weekly human review |
| `stats.json` | run metrics (counts, dedupe rates, category mix, field coverage) |

Slices are cached — delete the `raw_*.parquet` to re-download. Both slicers
retry aggressively and are safe to rerun on flaky connections.

Add cities in `cities.py` (bbox + center).

## Release pinning

- Overture: `slice_overture.py <city> <release>` (default pinned in file; new
  releases are monthly — check https://docs.overturemaps.org)
- FSQ: `slice_fsq.py <city> <dt>` (monthly `dt=` partitions on Hugging Face)

## Matching rules (shared with the scraper stage later)

- Candidates: same H3 res-9 cell + 6 neighbors (~300 m)
- Phone exact (normalized +92) → match
- trigram(name) ≥ 0.55 & ≤ 300 m → match
- token-set ≥ 90 & ≤ 150 m → match
- trigram 0.40–0.55 → `review_queue.csv`, kept distinct until reviewed

Thresholds live in `match.py`; `trigram_similarity` mirrors pg_trgm semantics
so tuning transfers directly to the Postgres serving layer.

## Next stages (not in this repo yet)

- `load_supabase.py` — upsert canonical.parquet into the hot DB (needs
  `SUPABASE_DB_URL`)
- scraper ingest — gosom output matched via the same `match.py` machinery
  (enrich / verify / discover, PRD §7.6)
