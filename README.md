# FIND IT

Local business discovery for Pakistan — a big, self-owned database, forgiving
search, and a map-first UI. Runs on free infrastructure until scale demands
otherwise.

```
find-it/
├── pipeline/     data engine: open-data slicing, dedupe, scrape ingest, exports
├── scraper/      the sweep supervisor + gosom binary (city-by-city enrichment)
├── supabase/     schema.sql + search.sql (the hot tier and its ranking)
└── app/          the Expo app (SDK 57, New Architecture)
```

## Current state

| | |
|---|---|
| Backend | **Live** — Supabase `ap-south-1` (Mumbai, 68 ms from Pakistan): **109,510 places**, 33,138 with cached reviews |
| Scraped | Faisalabad ✅ 14,809 · Islamabad/Rawalpindi ✅ 41,158 · Lahore ✅ 53,557 (+13,923 discovered) · **Karachi in progress** · Multan/Peshawar/Gujranwala seeded, 8 more queued |
| App bundles | 3 cities × 6,000 places; home city eager, others lazy-load by proximity |
| App | 10 screens (3 feed screens flag-gated off), typechecks clean, 24/24 data checks pass |
| Search | typos · synonyms · Urdu script · Urdu/English **voice** · **AI questions** (Edge Function; keyless until launch) |
| App payload | 36.5 MB of city data → 39.9 MB Android bundle (was 77 MB / 47 MB) |
| Ship it | [docs/GO-LIVE.md](docs/GO-LIVE.md) (Play Store path) · [docs/HANDOVER.md](docs/HANDOVER.md) (system transfer) |

### Screens

| Route | What it is |
|---|---|
| `/onboarding` | Two panes; pre-permission priming before the OS dialog |
| `/` | Explore — persistent map + three-snap bottom sheet, category chips |
| `/search` | Debounced suggest, typo tolerance, zero-result rescue ladder |
| `/place/[id]` | Hero gallery, open-now, actions, dual review shelves, similar nearby |
| `/location` | Fixed-centre-pin picker, radius slider, live count, one-tap city hops |
| `/review/[id]` | Stars → tag chips → optional text (30-second target) |
| `/saved` | Saved places (offline) + appearance toggle (light/dark/auto) |
| `/feed` `/gallery` `/post/[placeId]` | Photo feed + gallery + composer — **built, flag-gated off** (`src/features.ts`) |

## Running the app

```bash
cd app
npx expo start          # dev build required for maps — Expo Go cannot render them
```

The app ships with a real 6,000-place Faisalabad bundle, so it works with **no
backend at all**. Point it at Supabase by setting:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Nothing else changes — `src/data/index.ts` picks the source, and both
implement the same `DataSource` contract and the same ranking.

> **Expo Go will not work for the map screens.** Google Maps was removed from
> Expo Go in SDK 53 and `expo-maps`/MapLibre need native code. Use a
> development build (`npx expo run:android`), which behaves identically to
> Expo Go otherwise.

## The data engine

```bash
cd pipeline
python run_city.py <city>          # slice open data -> dedupe -> canonical.parquet
python ingest_scrape.py <city>     # fold scraper output in -> enriched.parquet
python export_app_data.py <city>   # compact bundle for the app
python load_supabase.py <city>     # push to Supabase (needs SUPABASE_DB_URL)
```

Sources: **Overture Maps** (CDLA-Permissive 2.0) and **Foursquare OS Places**
(Apache 2.0) for the seed; a self-hosted **gosom/google-maps-scraper** sweep for
ratings, hours, photos, menus and reviews.

### Scraper sweep

```bash
cd scraper
powershell -ExecutionPolicy Bypass -File restart_sweep.ps1   # the ONLY safe restart
Get-Content sweeps\progress.log -Tail 5 -Wait                # watch
```

The supervisor walks every city in `cities.SWEEP_ORDER`, checkpoints each batch,
and retries failures on later cycles. It holds a PID lock: **never launch it
directly** — two supervisors racing on the same files corrupts state.

Each sweep does three jobs at once (see PRD §7.6): enriches matched places,
*verifies* that seeded places still exist, and *discovers* businesses that open
data never had (~60% of results, in practice).

## Design decisions worth knowing

- **Our map, not Google's.** MapLibre + OpenFreeMap tiles: free, unlimited, no
  key, no billing account. Rendering our own database on a Google map would
  import their terms for no benefit. "Directions" deep-links to Google Maps,
  which is free, legal, and better for navigation anyway.
- **Two review shelves, never blended.** FIND IT's own reviews and Google's sit
  side by side, each labelled, each with its own rating. The Google cache is
  bounded (~10/place) and *replaced* on refresh, so deletions self-correct.
- **Ranking is one formula, in two places — with one caveat.** `search_places()`
  in SQL and `scorePlace()` in TypeScript use **identical weights**: relevance
  0.40, Bayesian quality prior 0.25, proximity decay 0.20 (same 1.6 constant),
  open-now 0.10, rating volume 0.05, and the same prior
  `(n·r + 20·3.9)/(n+20)/5`. A 4.9★ with 3 ratings must not outrank a 4.6★
  with 800 — there's a test for it.
  **The relevance term itself is computed differently**, though: TypeScript
  uses tiered exact/prefix/word matching (1.0 / 0.95 / 0.85 / 0.8), SQL uses
  `greatest(similarity(), ts_rank())`. Identical inputs can therefore order
  slightly differently online vs offline. Both are defensible; they are not
  the same function, and the weight parity does not imply result parity.
- **Typo tolerance needs both measures.** Trigrams catch insertions and
  deletions; edit distance catches transpositions ("birayni" → "biryani",
  which scores only 0.33 on trigrams). Both paths implement both.
- **Hard radius.** Results never exceed the circle and the count shown is the
  count delivered. A soft radius destroys trust in the control.
- **Facets are an allow-list.** Google emits ~163 attribute names, mostly
  noise; `app/src/data/facets.ts` keeps the ~25 that change a decision,
  warnings first (Cash only), accessibility never truncated. Queries extract
  needs too ("halal biryani" filters halal, searches biryani).
- **Scraped photo URLs are signed.** `gps-cs-s` links 404 if the size
  directive is touched — serve exactly what was scraped. And `google_status`
  from the scraper is misaligned junk ('Diesel gas', 'Brunch', 'PKR 5,000'
  across 102k rows); `state` is provenance, not status. **User reports are
  the only closure signal**, which is why reporting is one tap.
- **The bundle is a safety net, not a mirror.** It ships 6,000 quality-ranked
  places per city with 2 reviews and 2 photo URLs each — deliberately not the
  full hot tier. Cached reviews alone were 40 MB of a 77 MB payload for a
  screen that shows ONE review by default, and bundled photo URLs are remote
  fetches that resolve to nothing when the user is actually offline.
- **A `catch` is not a timeout.** On a saturated mobile network the common
  failure is not an error — it is *nothing at all*, forever. Three separate
  places here assumed failure means rejection and so never fired: the cloud
  fallback (`ResilientSource` degrades in a `.catch` a hang never reaches),
  the GPS fix (whose comment literally claimed it could not block the UI, on
  the code path the onboarding button awaits), and the place screen's
  skeleton. Every await that can touch a network or a radio now races a
  deadline. `scripts/test-hanging-cloud.mjs` covers the case the offline test
  cannot: requests accepted and never answered, rather than severed.
- **Graceful fallback hides outages — verify against the DB, not the screen.**
  `ResilientSource` degrades to the bundle so silently that three separate
  bugs looked like a working app: the radius picker counting the bundle while
  Explore searched the cloud (548 shown vs 12,180 actual in Lahore),
  landmarks never resolving for cloud places because lookup was by bundled
  id, and transient timeouts dropping users to bundle data. Anything claiming
  a count or a match is checked against `count_in_radii` / the DB directly.
- **The free tier's CPU is the latency, not the SQL.** The *same* query varies
  3–10× run to run (`biryani` measured at 0.30s, 2.08s and 2.94s within
  minutes), and when it drifts past PostgREST's statement timeout the call
  fails outright. Ruled out, with evidence: stale statistics (`ANALYZE` runs
  after every load and timeouts still recur), table bloat (`n_dead_tup = 0`),
  and the query shape itself — every individual predicate is 0.12–0.45s, and
  rewriting the OR-filter as a UNION *helped* one query 3.6× while *hurting*
  another 3.5×, so it was not adopted. The app-side answer is the only
  reliable one: retry once, then serve the bundle. `ANALYZE` after bulk loads
  stays as hygiene, not as a fix.
- **Nothing renders in a font we don't control.** A bare `★` in a `Text` run
  has no font family and falls through to the system face (22 of ~200 nodes);
  `⯨` is missing from most Android fonts and draws as tofu. Stars are icon
  glyphs. Scraped names get PUA codepoints stripped (U+F8FF is the Apple
  logo, tofu everywhere but Apple) — emoji are kept, they're merchant
  branding and render natively.

## Verification

```bash
cd app
npx tsc --noEmit                    # types
node scripts/verify-search.mjs      # 19 checks: typos, vocabulary, ranking, richness
node scripts/test-offline.mjs       # 5 checks with the network severed
node scripts/test-hanging-cloud.mjs # cloud accepted but never answered
npx expo export --platform android  # proves it bundles, and prints the real size
```

The last two need the dev server running and drive it through Playwright.
Store assets regenerate from the design tokens:

```bash
python scripts/make-icons.py            # adaptive/mono/square/splash/favicon
python scripts/make-feature-graphic.py  # 1024x500, in the app's own typefaces
node scripts/capture-screenshots.mjs    # 4 phone shots at 1080x2340
```

The cloud tier has its own two:

```bash
cd pipeline
python db_status.py     # live inventory per city — places, rated, with-reviews
python analyze_now.py   # refresh planner stats (load_supabase.py does this too)
```
