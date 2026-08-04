-- Photo feed — schema, policies and the moderation state machine.
--
-- Built but NOT surfaced: the app ships this behind a flag (features.ts) so
-- it can be finished, reviewed and switched on later without a migration.
--
-- Two rules the design enforces rather than trusts:
--
--   1. A post is invisible until moderation has PASSED. The default status
--      is 'pending' and the read policy filters on 'live', so a client that
--      skips the checks — or a modified one that lies — still publishes
--      nothing. Moderation is a gate, not a suggestion.
--   2. A post always belongs to a place. The feed exists to improve the
--      database, not to float beside it; a photo of a shopfront is worth
--      more attached to that shop than in a stream.

create extension if not exists pgcrypto;

/* ─────────────────────────────── posts ─────────────────────────────── */

create table if not exists post (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references auth.users(id) on delete cascade,
  place_id        uuid not null references place(id) on delete cascade,

  -- R2 object key, not a URL: the bucket and CDN host can change without a
  -- rewrite, and a signed URL would be stale the moment it is stored.
  photo_key       text not null,
  width           integer,
  height          integer,

  caption         text check (char_length(caption) <= 280),
  -- Optional: a post can carry the author's rating so the feed and the
  -- review shelf agree instead of drifting apart.
  stars           smallint check (stars between 1 and 5),
  tags            text[] default '{}',

  /* moderation ------------------------------------------------------- */
  status          text not null default 'pending'
                  check (status in ('pending', 'live', 'rejected', 'hidden')),
  -- Why it was rejected, in our words, so the author can be told something
  -- better than "no". 'faces' | 'nsfw' | 'text' | 'spam' | 'reported'
  reject_reason   text,
  -- Raw scores kept for tuning thresholds later. Never shown to users.
  moderation      jsonb,

  report_count    integer not null default 0,

  created_at      timestamptz not null default now(),
  moderated_at    timestamptz
);

create index if not exists post_live_recent
  on post (created_at desc) where status = 'live';
create index if not exists post_place on post (place_id) where status = 'live';
create index if not exists post_author on post (author_id, created_at desc);
-- The moderation worker's queue.
create index if not exists post_pending on post (created_at) where status = 'pending';

/* ─────────────────────────────── reports ───────────────────────────── */

create table if not exists post_report (
  post_id     uuid not null references post(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  -- One report per person per post: without this, one angry user can bury
  -- anything by tapping repeatedly.
  primary key (post_id, reporter_id)
);

/* Auto-hide on the SECOND independent report. One report is often a
   disagreement; two strangers agreeing is worth acting on immediately and
   reviewing afterwards. Cheaper and faster than pre-moderating everything. */
create or replace function bump_report_count() returns trigger
language plpgsql security definer as $$
begin
  update post
     set report_count = report_count + 1,
         status = case when report_count + 1 >= 2 and status = 'live'
                       then 'hidden' else status end,
         reject_reason = case when report_count + 1 >= 2 and status = 'live'
                              then 'reported' else reject_reason end
   where id = new.post_id;
  return new;
end $$;

drop trigger if exists post_report_ins on post_report;
create trigger post_report_ins after insert on post_report
  for each row execute function bump_report_count();

/* ──────────────────────────── row level security ───────────────────── */

alter table post enable row level security;
alter table post_report enable row level security;

-- Everyone reads LIVE posts only. 'pending' and 'rejected' are invisible to
-- the public even though the row exists.
drop policy if exists post_read_live on post;
create policy post_read_live on post for select
  using (status = 'live');

-- Authors see their own, whatever the status — otherwise a rejected post
-- vanishes with no explanation and the user simply posts it again.
drop policy if exists post_read_own on post;
create policy post_read_own on post for select
  using (auth.uid() = author_id);

-- Insert as yourself, and only as 'pending'. The WITH CHECK is the actual
-- enforcement of "moderation cannot be skipped": a client cannot insert a
-- row that is already live.
drop policy if exists post_insert_own on post;
create policy post_insert_own on post for insert
  with check (auth.uid() = author_id and status = 'pending');

-- Authors may edit the caption, never the status. Status transitions belong
-- to the moderation function, which uses the service role and bypasses RLS.
drop policy if exists post_update_own on post;
create policy post_update_own on post for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id and status = 'pending');

drop policy if exists post_delete_own on post;
create policy post_delete_own on post for delete
  using (auth.uid() = author_id);

drop policy if exists report_insert on post_report;
create policy report_insert on post_report for insert
  with check (auth.uid() = reporter_id);

/* ───────────────────────────── read helpers ────────────────────────── */

-- The feed. City-scoped by proximity rather than a city_id join, so it keeps
-- working for someone between cities.
create or replace function feed_nearby(
  lat double precision, lng double precision,
  radius_m integer default 25000,
  lim integer default 30, off integer default 0
)
returns table (
  id uuid, place_id uuid, place_name text, photo_key text,
  caption text, stars smallint, tags text[],
  created_at timestamptz, distance_m double precision
)
language sql stable as $$
  select p.id, p.place_id, pl.name, p.photo_key,
         p.caption, p.stars, p.tags, p.created_at,
         st_distance(pl.location, st_setsrid(st_makepoint(lng, lat), 4326)::geography)
  from post p
  join place pl on pl.id = p.place_id
  where p.status = 'live'
    and st_dwithin(pl.location,
        st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)
  order by p.created_at desc
  limit least(lim, 60) offset off;
$$;

-- One place's photos, for the place screen once the feed is switched on.
create or replace function place_posts(pid uuid, lim integer default 12)
returns table (
  id uuid, photo_key text, caption text, stars smallint, created_at timestamptz
)
language sql stable as $$
  select id, photo_key, caption, stars, created_at
  from post where place_id = pid and status = 'live'
  order by created_at desc limit least(lim, 30);
$$;

grant execute on function feed_nearby to anon, authenticated;
grant execute on function place_posts to anon, authenticated;
