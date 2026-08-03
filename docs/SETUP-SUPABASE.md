# Going cloud: Supabase in ~10 minutes

Everything below is already built and waiting on two environment variables.
The app runs identically either way — `DataSource` is the seam — so this is
a config flip, not a migration.

## What you get by doing this

| Today (bundled JSON) | After (Supabase free tier) |
|---|---|
| 3 cities, 6k places each | every scraped place (40k+/city), all 14 cities |
| data frozen at export time | re-ingest updates live, no app release |
| saves/reviews/reports queue locally | they sync (the queue code already drains) |
| no accounts | phone OTP sign-in unlocked |

## Steps (all free tier)

1. **Create the project** at [database.new](https://database.new)
   - Region: `ap-south-1` (Mumbai) — closest to Pakistan
   - Save the database password it generates

2. **Run the schema** — open the SQL editor, paste and run in order:
   - `supabase/schema.sql`   (tables, PostGIS, pg_trgm, fuzzystrmatch)
   - `supabase/search.sql`   (search RPC: trigram + levenshtein + distance)

3. **Load the data** (from this repo):
   ```bash
   cd pipeline
   set SUPABASE_DB_URL=postgresql://postgres:<PASSWORD>@db.<REF>.supabase.co:5432/postgres
   python load_supabase.py faisalabad
   python load_supabase.py islamabad-rawalpindi
   python load_supabase.py lahore
   ```
   Re-run any time after an ingest; it upserts by `ext_id`.

4. **Point the app at it** — create `app/.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<REF>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from Project Settings → API>
   ```
   Restart Expo. `hasSupabase` flips true; bundles become the offline tier.

5. **(Optional) Phone OTP** — Authentication → Providers → Phone.
   Free path: enable the built-in test provider first; real SMS later needs
   Twilio/MessageBird credits, so defer until launch.

## Free-tier ceilings to respect

- 500 MB database — ~1 KB/place all-in → 200–300k places fits; photos stay
  URLs (never stored), reviews capped at 10/place (already enforced in
  `ingest_scrape.py`)
- 5 GB egress/month — the app's search payloads are ~2 KB/result, fine;
  photos load from Google's CDN, not Supabase
- Projects pause after 7 days without traffic on free tier — the weekly
  ingest/load run doubles as the keep-alive

## What I could NOT do for you

Creating the account/project and pasting keys are the only manual steps —
credentials shouldn't pass through an agent. Everything else in this list is
scripted or already merged.
