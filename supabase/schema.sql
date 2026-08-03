-- FIND IT — hot-tier schema (PRD §7.4, §8)
-- Target: Supabase free tier (500 MB). ~1 KB/row all-in, so 200–300k places.
-- Run in the Supabase SQL editor, or: psql "$SUPABASE_DB_URL" -f schema.sql

create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists postgis;
create extension if not exists fuzzystrmatch;   -- levenshtein: transposition typos

-- unaccent() is only STABLE (the dictionary is resolved at call time), which
-- disqualifies it from generated columns and expression indexes. Pinning the
-- dictionary and declaring IMMUTABLE is the accepted workaround — safe unless
-- the unaccent rules file itself is edited, which we never do.
create or replace function immutable_unaccent(text)
returns text
language sql immutable parallel safe strict
return public.unaccent('public.unaccent'::regdictionary, $1);

-- array_to_string(anyarray, text) is likewise only STABLE (element output
-- casts could in theory vary); for text[] joined for a tsvector it is
-- deterministic, so the same pin-and-declare trick applies.
create or replace function immutable_join(text[])
returns text
language sql immutable parallel safe strict
return array_to_string($1, ' ');

-- ---------------------------------------------------------------- categories
create table if not exists category (
  id          smallint primary key,
  slug        text not null unique,
  name        text not null,
  name_ur     text,
  parent_id   smallint references category(id),
  synonyms    text[] default '{}'      -- query-expansion (PRD §8: no FTS thesaurus on hosted PG)
);

-- -------------------------------------------------------------------- cities
create table if not exists city (
  id          smallserial primary key,
  slug        text not null unique,
  name        text not null,
  name_ur     text,
  center      geography(Point, 4326) not null,
  bbox        geometry(Polygon, 4326),
  place_count integer default 0,
  is_live     boolean default false     -- hot in Postgres vs cold on R2
);

-- -------------------------------------------------------------------- places
create table if not exists place (
  id                uuid primary key default gen_random_uuid(),
  ext_id            text not null unique,        -- pipeline canonical id
  gers_id           text,
  fsq_id            text,
  google_place_id   text,
  google_cid        text,

  name              text not null,
  name_norm         text generated always as (lower(immutable_unaccent(name))) stored,
  category_bucket   text,
  categories_raw    text[] default '{}',
  google_category   text,
  description       text,

  address           text,
  locality          text,
  postcode          text,
  city_id           smallint references city(id),

  phone             text,
  website           text,
  email             text,
  socials           text[] default '{}',

  location          geography(Point, 4326) not null,
  h3_9              text,

  -- Google-sourced facts (safe to store: uncopyrightable)
  rating            numeric(2,1),
  rating_count      integer,
  rating_histogram  jsonb,
  price_range       text,
  hours             text,                        -- compact "mo:9 AM-10 PM|..."
  popular_times     jsonb,
  attributes        jsonb,                       -- service options, accessibility…
  cards_ok          boolean default false,
  menu_url          text,
  order_online_url  text,
  reservations_url  text,
  reviews_link      text,
  maps_link         text,
  street_view_url   text,
  plus_code         text,
  photo_urls        text[] default '{}',

  -- FIND IT native ratings (become the headline at >= 5 reviews)
  fi_rating         numeric(2,1),
  fi_rating_count   integer default 0,

  state             text not null default 'seed_only',   -- see PRD §7.6
  confidence        real,
  sources           text[] default '{}',
  google_status     text,
  enriched_at       timestamptz,
  seen_at           timestamptz,
  created_at        timestamptz default now(),

  search_tsv        tsvector generated always as (
                      to_tsvector('simple',
                        immutable_unaccent(coalesce(name, '')) || ' ' ||
                        immutable_unaccent(coalesce(category_bucket, '')) || ' ' ||
                        immutable_unaccent(coalesce(google_category, '')) || ' ' ||
                        immutable_unaccent(coalesce(immutable_join(categories_raw), '')) || ' ' ||
                        immutable_unaccent(coalesce(locality, ''))
                      )
                    ) stored
);

create index if not exists place_location_gix on place using gist (location);
create index if not exists place_name_trgm    on place using gin (name_norm gin_trgm_ops);
create index if not exists place_tsv_gin      on place using gin (search_tsv);
create index if not exists place_city_cat     on place (city_id, category_bucket);
create index if not exists place_rating       on place (rating desc nulls last);
create index if not exists place_google_pid   on place (google_place_id) where google_place_id is not null;

-- ------------------------------------------------- Google reviews (bounded!)
-- PRD §2.4: max ~10 per place, REPLACED on refresh so deletions self-correct.
create table if not exists google_review_cache (
  place_id    uuid primary key references place(id) on delete cascade,
  reviews     jsonb not null,
  fetched_at  timestamptz not null default now()
);

-- ------------------------------------------------------- FIND IT own reviews
create table if not exists review (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references place(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  tags        text[] default '{}',
  body        text,
  photo_urls  text[] default '{}',
  status      text not null default 'published',
  created_at  timestamptz default now(),
  unique (place_id, user_id)                    -- one review per place per user
);
create index if not exists review_place on review (place_id, created_at desc);

-- ------------------------------------------------------------- user activity
create table if not exists list (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  emoji      text default '📍',
  is_public  boolean default false,
  created_at timestamptz default now()
);

create table if not exists saved_place (
  user_id   uuid not null references auth.users(id) on delete cascade,
  place_id  uuid not null references place(id) on delete cascade,
  list_id   uuid references list(id) on delete set null,
  saved_at  timestamptz default now(),
  primary key (user_id, place_id)
);

create table if not exists edit_suggestion (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references place(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  field      text not null,
  value      text,
  note       text,
  status     text default 'pending',
  created_at timestamptz default now()
);

-- ------------------------------------------------------------------ triggers
create or replace function bump_fi_rating() returns trigger language plpgsql as $$
begin
  update place p set
    fi_rating = sub.avg_stars,
    fi_rating_count = sub.n
  from (
    select place_id, round(avg(stars)::numeric, 1) avg_stars, count(*) n
    from review
    where place_id = coalesce(new.place_id, old.place_id) and status = 'published'
    group by place_id
  ) sub
  where p.id = sub.place_id;
  return null;
end $$;

drop trigger if exists review_rollup on review;
create trigger review_rollup after insert or update or delete on review
for each row execute function bump_fi_rating();

-- ---------------------------------------------------------------------- RLS
alter table place                enable row level security;
alter table google_review_cache  enable row level security;
alter table review               enable row level security;
alter table list                 enable row level security;
alter table saved_place          enable row level security;
alter table edit_suggestion      enable row level security;
alter table category             enable row level security;
alter table city                 enable row level security;

-- Public read for the catalogue; writes only through the service role.
do $$ begin
  create policy place_read   on place               for select using (true);
  create policy grc_read     on google_review_cache for select using (true);
  create policy cat_read     on category            for select using (true);
  create policy city_read    on city                for select using (true);
  create policy review_read  on review              for select using (status = 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy review_write on review for insert with check (auth.uid() = user_id);
  create policy review_edit  on review for update using (auth.uid() = user_id);
  create policy review_del   on review for delete using (auth.uid() = user_id);
  create policy list_own     on list   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy saved_own    on saved_place for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy edit_write   on edit_suggestion for insert with check (true);
exception when duplicate_object then null; end $$;
