-- FIND IT — smart search (PRD §8)
--
-- One query blends text relevance, a Bayesian quality prior, proximity decay
-- and status. Keeping this in Postgres is the whole point: no sync problem
-- between a search engine's ranking and the DB's facts.

-- ------------------------------------------------------------- helper: hours
-- Compact format is "mo:9 AM-10 PM|tu:...". Returns true when the place is
-- open at the given local time. Unknown hours => null (never a false "closed").
--
-- Pure SQL on purpose. The original PL/pgSQL version wrapped to_timestamp in
-- an EXCEPTION block; every "9:30 PM"-style value missed the 'HH12 AM' format
-- and aborted a subtransaction — thousands of times per browse query, which
-- is what a "statement timeout" on search_places actually was. A regexp guard
-- costs microseconds and throws nothing.
create or replace function parse_ampm(s text)
returns time language sql immutable strict as $$
  -- normalise "9PM" / "9 PM" / "9:30PM" to a single-space form first:
  -- to_timestamp's AM field is strict about the space even when the regexp
  -- guard passes.
  with n as (
    select regexp_replace(upper(trim(s)), '\s*([AP]M)$', ' \1') as v
  )
  select case
    when v ~ '^\d{1,2}:\d{2} (AM|PM)$' then to_timestamp(v, 'HH12:MI AM')::time
    when v ~ '^\d{1,2} (AM|PM)$'       then to_timestamp(v, 'HH12 AM')::time
    else null
  end
  from n
$$;

create or replace function is_open_now(hours text, at_time timestamptz default now())
returns boolean language sql immutable as $$
  with d as (
    select lower(substr(to_char(at_time at time zone 'Asia/Karachi', 'Dy'), 1, 2)) as dow,
           (at_time at time zone 'Asia/Karachi')::time as t
  ),
  seg as (   -- today's segment, minus the "mo:" prefix
    select substr(s, 4) as part, d.t
    from d, unnest(string_to_array(hours, '|')) as s
    where split_part(s, ':', 1) = d.dow
    limit 1
  )
  select case
    when hours is null or hours = '' then null
    when not exists (select 1 from seg) then null
    when (select part from seg) ilike '%24 hours%' then true
    when (select part from seg) ilike '%closed%'   then false
    else (
      select case
        when o is null or c is null then null
        when c < o then (t >= o or t <= c)   -- wraps past midnight
        else t between o and c
      end
      from (
        select parse_ampm(split_part(part, '–', 1)) as o,
               parse_ampm(split_part(part, '–', 2)) as c,
               t
        from seg
      ) x
    )
  end
$$;

-- --------------------------------------------------------- helper: facets
-- Mirrors app/src/data/facets.ts (the allow-list is duplicated on purpose:
-- the app needs it offline, the DB needs it for cloud filtering — a drifted
-- label costs a weaker filter, not a wrong answer).
create or replace function has_facet(attrs jsonb, key text)
returns boolean language sql immutable as $$
  select case when attrs is null or jsonb_typeof(attrs) <> 'array' then false
  else exists (
    select 1
    from jsonb_array_elements(attrs) blk
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(blk->'options') = 'array'
           then blk->'options' else '[]'::jsonb end) o
    where coalesce((o->>'enabled')::boolean, false)
      and lower(o->>'name') = any (
        case key
          when 'cards'     then array['credit cards','debit cards']
          when 'cash'      then array['cash-only']
          when 'halal'     then array['halal food']
          when 'women'     then array['identifies as women-owned']
          when 'kids'      then array['good for kids']
          when 'delivery'  then array['delivery']
          when 'parking'   then array['free parking lot','free street parking','on-site parking']
          when 'wifi'      then array['wi-fi','free wi-fi']
          when 'outdoor'   then array['outdoor seating']
          when 'latenight' then array['late-night food']
          else array[]::text[]
        end)
  ) end
$$;

-- Facet keys, precomputed. Filtering by scanning the attributes jsonb per
-- candidate row blows the API role's statement_timeout (~2.3s for one dense
-- browse); as a stored generated column + GIN it's an index probe. The
-- column rewrites itself whenever `attributes` is upserted.
create or replace function extract_facet_keys(attrs jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(k), array[]::text[])
  from unnest(array['cards','cash','halal','women','kids','delivery',
                    'parking','wifi','outdoor','latenight']) k
  where has_facet(attrs, k)
$$;

alter table place add column if not exists facet_keys text[]
  generated always as (extract_facet_keys(attributes)) stored;
create index if not exists place_facet_gin on place using gin (facet_keys);

-- ------------------------------------------------------------ main: search
-- The pre-`needs` signature must go: CREATE OR REPLACE with an extra
-- parameter OVERLOADS rather than replaces, and then every 9-arg call
-- (count_in_radii's included) becomes "function is not unique".
drop function if exists search_places(
  text, double precision, double precision, integer, text[], boolean,
  numeric, integer, integer);

create or replace function search_places(
  q            text default null,
  lat          double precision default null,
  lng          double precision default null,
  radius_m     integer default 5000,
  cats         text[] default null,
  open_only    boolean default false,
  min_rating   numeric default null,
  lim          integer default 40,
  off          integer default 0,
  needs        text[] default null    -- facet keys, ALL must match (facets.ts)
)
returns table (
  id uuid, name text, category_bucket text, google_category text,
  address text, locality text, phone text, website text,
  lat_out double precision, lng_out double precision,
  distance_m double precision,
  rating numeric, rating_count integer,
  fi_rating numeric, fi_rating_count integer,
  price_range text, hours text, open_now boolean,
  photo_urls text[], cards_ok boolean, menu_url text,
  state text, score real
)
language sql stable as $$
  with params as (
    select
      nullif(trim(q), '')                                   as raw_q,
      lower(unaccent(coalesce(nullif(trim(q), ''), '')))    as nq,
      case when lat is null or lng is null then null
           else st_setsrid(st_makepoint(lng, lat), 4326)::geography end as origin
  ),
  candidates as (
    select p.*, pr.nq, pr.raw_q, pr.origin,
           case when pr.origin is null then null
                else st_distance(p.location, pr.origin) end as dist
    from place p, params pr
    where (pr.origin is null or st_dwithin(p.location, pr.origin, radius_m))
      and (cats is null or p.category_bucket = any(cats))
      and (min_rating is null or p.rating >= min_rating)
      -- needs: array containment against the precomputed keys. cards_ok is a
      -- separately-scraped boolean with far better coverage than the
      -- attributes blocks, so it satisfies 'cards' too (same rule as the app).
      and (needs is null or cardinality(needs) = 0 or
           needs <@ (p.facet_keys ||
                     case when p.cards_ok then array['cards']
                          else array[]::text[] end))
      -- NO google_status filter. The scraper misaligns that column: across
      -- 102k rows it holds 'Diesel gas', 'Brunch', 'PKR 5,000' — never a
      -- status. The old `not ilike '%permanently closed%'` guard therefore
      -- hid exactly 0 rows while costing an ILIKE on every row the geo index
      -- returned (18,823 for one Lahore search), and it was a landmine: the
      -- day that column fills with different garbage it would start hiding
      -- real businesses.
      --
      -- And there is no other closure signal to substitute: `state` is
      -- PROVENANCE (seed_only / google_only / google_matched), not status.
      -- User reports are the only closure signal this product has, which is
      -- why the report flow is one tap and why unverified rows say so
      -- ("From public map data · not yet verified") instead of implying
      -- they were checked.
      and (
        pr.raw_q is null
        or p.name_norm % pr.nq                              -- trigram (typos)
        or p.name_norm like '%' || pr.nq || '%'
        or p.search_tsv @@ websearch_to_tsquery('simple', pr.nq)
        -- Trigrams miss TRANSPOSITIONS ("birayni" vs "biryani" scores only
        -- 0.33), so back them with edit distance on the leading word. Guarded
        -- by length so it can't turn into a full-table scan of short names.
        or (length(pr.nq) >= 5
            and levenshtein_less_equal(
                  split_part(p.name_norm, ' ', 1), pr.nq, 2) <= 2)
      )
  ),
  scored as (
    select c.*,
      -- text relevance: best of trigram similarity and FTS rank
      case when c.raw_q is null then 0.5
           else greatest(
             similarity(c.name_norm, c.nq),
             ts_rank(c.search_tsv, websearch_to_tsquery('simple', c.nq)) * 4
           ) end as rel,
      -- Bayesian quality prior: 4.9 with 3 ratings must not beat 4.6 with 800
      case when c.rating is null then 0.55
           else ((coalesce(c.rating_count,0) * c.rating) + (20 * 3.9))
                / nullif(coalesce(c.rating_count,0) + 20, 0) / 5.0 end as quality,
      -- proximity decay over the requested radius
      case when c.dist is null then 0.5
           else exp(-(c.dist / greatest(radius_m, 1)::double precision) * 1.6) end as prox
    from candidates c
  ),
  -- Two-stage rank: the open-now flag (string parsing per row) is the one
  -- expensive term, so cut to a generous head on the cheap terms first. A
  -- dense browse has thousands of candidates; open-now can only move a row
  -- by ±0.10 of score, which the ×8 pool comfortably absorbs.
  pre as (
    select s.*
    from scored s
    order by (0.40 * s.rel + 0.25 * s.quality + 0.20 * s.prox) desc,
             s.dist asc nulls last
    limit greatest((greatest(lim, 1) + greatest(off, 0)) * 8, 320)
  ),
  flagged as (
    select p.*, is_open_now(p.hours) as open_flag from pre p
  )
  select
    s.id, s.name, s.category_bucket, s.google_category,
    s.address, s.locality, s.phone, s.website,
    st_y(s.location::geometry), st_x(s.location::geometry),
    s.dist,
    s.rating, s.rating_count, s.fi_rating, s.fi_rating_count,
    s.price_range, s.hours, s.open_flag,
    -- one photo, not five: result cards render a single thumbnail, and the
    -- extra URLs are ~60 KB per browse. The detail screen re-fetches the
    -- full row (getPlace) and gets the whole gallery.
    (s.photo_urls)[1:1], s.cards_ok, s.menu_url,
    s.state,
    (0.40 * s.rel
   + 0.25 * s.quality
   + 0.20 * s.prox
   + 0.10 * (case when s.open_flag then 1.0 when s.open_flag is null then 0.5 else 0.15 end)
   + 0.05 * least(ln(coalesce(s.rating_count,0) + 1) / 7.0, 1.0)
    )::real as score
  from flagged s
  where (not open_only or s.open_flag is not false)
  order by score desc, s.dist asc nulls last
  limit greatest(lim, 1) offset greatest(off, 0);
$$;

-- --------------------------------------------------- autosuggest (<50ms budget)
create or replace function suggest_places(
  q text, lat double precision default null, lng double precision default null,
  lim integer default 8
)
returns table (id uuid, name text, category_bucket text, locality text,
               rating numeric, distance_m double precision, kind text)
language sql stable as $$
  with pr as (
    select lower(unaccent(trim(q))) nq,
           case when lat is null or lng is null then null
                else st_setsrid(st_makepoint(lng, lat), 4326)::geography end origin
  )
  select p.id, p.name, p.category_bucket, p.locality, p.rating,
         case when pr.origin is null then null else st_distance(p.location, pr.origin) end,
         'place'
  from place p, pr
  where length(pr.nq) >= 2
    -- Suggest forgives the same typos search does; without the levenshtein
    -- arm, typo tolerance downstream is invisible (users type here first).
    and (p.name_norm like pr.nq || '%'
         or p.name_norm % pr.nq
         or (length(pr.nq) >= 5
             and levenshtein_less_equal(split_part(p.name_norm, ' ', 1), pr.nq, 2) <= 2))
  order by (p.name_norm like pr.nq || '%') desc,
           similarity(p.name_norm, pr.nq) desc,
           p.rating_count desc nulls last
  limit greatest(lim, 1);
$$;

-- ------------------------------------------- zero-result rescue: widen radius
-- Powers "Nothing within 2 km. 14 places within 10 km → Search wider".
create or replace function count_in_radii(
  q text, lat double precision, lng double precision,
  radii integer[] default array[2000, 5000, 10000, 25000]
)
returns table (radius_m integer, n integer)
language sql stable as $$
  -- No query -> count places directly: running it through search_places
  -- saturates at that function's LIMIT and the radius picker then lies
  -- ("500 places" at every radius). With a query the 2000 cap is fine —
  -- past that the exact number stops mattering to anyone.
  select r,
         case when q is null or trim(q) = ''
              then (select count(*)::int
                    from place p
                    where st_dwithin(p.location,
                          st_setsrid(st_makepoint(lng, lat), 4326)::geography, r))
              else (select count(*)::int
                    from search_places(q, lat, lng, r, null, false, null, 2000, 0))
         end
  from unnest(radii) r order by r;
$$;

-- ------------------------------------------------- nearby / "similar nearby"
create or replace function similar_nearby(
  p_id uuid, radius_m integer default 3000, lim integer default 10
)
returns table (id uuid, name text, category_bucket text, rating numeric,
               rating_count integer, distance_m double precision, photo_urls text[])
language sql stable as $$
  select o.id, o.name, o.category_bucket, o.rating, o.rating_count,
         st_distance(o.location, p.location), o.photo_urls
  from place p
  join place o
    on o.id <> p.id
   and o.category_bucket is not distinct from p.category_bucket
   and st_dwithin(o.location, p.location, radius_m)
  where p.id = p_id
  order by (coalesce(o.rating,0) * ln(coalesce(o.rating_count,0) + 2)) desc,
           st_distance(o.location, p.location) asc
  limit greatest(lim, 1);
$$;

-- --------------------------------------- PostgREST computed columns: lat/lng
-- The client reads a single place with `select=*,lat,lng` — PostgREST resolves
-- these functions as virtual columns of `place`. (Function-call syntax inside
-- a select string is NOT a thing PostgREST supports; this is the mechanism.)
create or replace function lat(p place) returns double precision
language sql immutable as $$ select st_y(p.location::geometry) $$;

create or replace function lng(p place) returns double precision
language sql immutable as $$ select st_x(p.location::geometry) $$;
