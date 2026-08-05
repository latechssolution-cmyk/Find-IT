# Handing over FIND IT — the complete transfer

Written for the person taking this system over. After following this page you
will run everything the previous operator ran, with nothing left behind on
their machine. Written 4 Aug 2026, while Lahore batch 45/60 was scraping.

The system is three things, and each transfers differently:

| Part | Where it lives | How it transfers |
|---|---|---|
| **Code** | github.com/latechssolution-cmyk/Find-IT | clone |
| **Live database** | Supabase cloud (Mumbai) | nothing to move — you take over the account |
| **Local working state** | the current machine only | one folder copy + a few secrets |

---

## 1. What you copy off the old machine

The repo deliberately excludes secrets and bulk data. Copy these, keeping the
same relative paths inside your clone:

| Path | Size | What it is | If you skip it |
|---|---|---|---|
| `scraper/sweeps/` | ~1.2 GB | every raw scrape + **checkpoint state** (`state.json` per city, `progress.log`) | the sweep restarts each city from scratch — days of re-scraping |
| `pipeline/out/` | ~100 MB | canonical + enriched parquet per city | regenerable with `run_city.py` + re-ingest, ~an hour per city |
| `scraper/gmaps.exe` | 59 MB | the scraper binary ([gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) release, Windows build) | re-download it |
| `app/.env` | 1 KB | Supabase URL + publishable key for the app | recreate from §3 |
| `pipeline/.env.supabase` | 1 KB | DB connection string (pooler) for pipeline scripts | recreate from §3 |

Do **not** copy `supervisor.lock` if it comes along — delete it on the new
machine before first start, it holds the old machine's PID.

Everything else (node_modules, .expo caches) reinstalls itself.

---

## 2. Accounts to transfer ownership of

These are the system. Whoever controls them controls the product — transfer
each to a company email, don't share passwords informally.

| Account | Holds | Used for |
|---|---|---|
| **Supabase** — project `tppfsqrnyknvabrslxdk` (Mumbai) | 105k places, search RPCs, Edge Functions | the entire cloud tier |
| **GitHub** — `latechssolution-cmyk/Find-IT` | all code | everything |
| Groq / Gemini / OpenAI (when created) | AI key | the ask feature |
| Cloudflare (when created) | R2 bucket + Workers AI | photo feed, if enabled |
| Hugging Face (when created) | read token | Foursquare seed harvest |
| Google Play (when created) | the app listing | publishing |
| Sentry, Expo/EAS (when created) | crash reporting, builds | operations |

Secrets that exist today and must move through a **private channel** (they
are in no repo, by design):

- Supabase DB password, service-role key, publishable key
  (the two `.env` files in §1 carry the ones scripts need)
- nothing else — AI/CF/HF keys don't exist yet

---

## 3. Standing the system up on the new machine

Prereqs: git, Node 20+, Python 3.12+ (`pip install duckdb pyarrow psycopg[binary] h3`).

```bash
git clone git@github.com:latechssolution-cmyk/Find-IT.git find-it
cd find-it
# copy in the §1 folders/files now
cd app && npm install
```

**Run the app:** `npx expo start --web` → http://localhost:8081. It works
with zero backend (bundled data), and reads `app/.env` for the cloud tier.

**Resume the scrape** (Windows):

```powershell
cd find-it\scraper
Remove-Item sweeps\supervisor.lock -ErrorAction SilentlyContinue   # old PID
powershell -ExecutionPolicy Bypass -File restart_sweep.ps1
Get-Content sweeps\progress.log -Tail 5 -Wait                      # watch
```

`restart_sweep.ps1` is the **only** correct way to start/restart it — it
kills strays and proves zero remain before launching. Two supervisors racing
corrupt the checkpoint files. It resumes exactly where the copied
`state.json` files left off and walks the remaining city queue by itself.

**Push a city to the cloud after its sweep finishes:**

```powershell
cd find-it\pipeline
python ingest_scrape.py <slug>      # fold raw scrape into enriched.parquet
python load_supabase.py <slug>      # upsert to Mumbai (reads .env.supabase)
python export_app_data.py <slug>    # refresh the app bundle if it's a bundled city
```

The supervisor already does ingest automatically every ~10 batches; the
manual cycle is for when you want the cloud updated mid-city.

---

## 4. State of the world at handover

- **Cloud (Mumbai):** 109,510 places — Lahore 53,546 · Islamabad/Rawalpindi
  41,155 · Faisalabad 14,809 — 33,138 with cached Google reviews, 139 with
  review-mined price ranges
- **Scrape:** Faisalabad ✅, Islamabad ✅, **Lahore ✅** (53,557; +13,923
  discovered); **Karachi in progress**; Multan, Peshawar, Gujranwala seeded
  and queued; 8 more cities in `pipeline/cities.py` SWEEP_ORDER
- **App:** feature-complete for v1 — including Urdu/English voice search,
  AI question answering (keyless until launch), review-mined prices,
  Jummah/Ramadan awareness, bike-time estimates, one-tap open-confirms;
  photo feed fully built but OFF (`app/src/features.ts` — read the comment
  there before flipping it)
- **Known gaps:** Foursquare seed never harvested (needs an HF token —
  see the docstring in `pipeline/fsq_pk_harvest.py`); AI search built but
  keyless; crash reporting wired but DSN-less; never built as a release
  binary

## 5. What to read next, in order

1. [GO-LIVE.md](GO-LIVE.md) — the path to the Play Store, including the
   six decisions that need a business owner, not an engineer
2. [PLAY-STORE-AUDIT.md](PLAY-STORE-AUDIT.md) — why each of those matters
3. [SETUP-SUPABASE.md](SETUP-SUPABASE.md) — cloud tier details and the
   connection gotchas that cost real time (IPv6, pooler, key types)
4. `pipeline/README.md` — how the data engine fits together
5. [PRODUCT-IDEAS.md](PRODUCT-IDEAS.md) — the researched roadmap

## 6. The five operational rules that aren't written anywhere else

1. **Never start `sweep.py` directly** — always `restart_sweep.ps1`.
2. **Never run two ingests of the same city at once**, and don't rebuild a
   city's canonical (`run_city.py`) while the sweep is mid-city on it.
3. **After any bulk `load_supabase.py`, ANALYZE runs automatically** — if
   you write your own loader, keep that, or search times out for everyone.
4. The scraped Google photo URLs are **signed** — never rewrite their size
   parameters, and `google_status` from the scraper is junk — never filter
   on it.
5. The app must always work with the cloud OFF. Anything you add, ask:
   what does this do on a dead connection? The fallback architecture in
   `app/src/data/index.ts` is the pattern to copy.
