-- FIND IT — smart search (PRD §8)
--
-- One query blends text relevance, a Bayesian quality prior, proximity decay
-- and status. Keeping this in Postgres is the whole point: no sync problem
-- between a search engine's ranking and the DB's facts.

-- ------------------------------------------------------------- helper: hours
-- Compact format is "mo:9 AM-10 PM|tu:...". Returns true when the place is
-- open at the given local time. Unknown hours => null (never a false "closed").
create or replace function is_open_now(hours text, at_time timestamptz default now())
returns boolean language plpgsql immutable as $$
declare
  dow text; seg text; part text; o time; c time; t time;
begin
  if hours is null or hours = '' then return null; end if;
  dow := lower(substr(to_char(at_time at time zone 'Asia/Karachi', 'Dy'), 1, 2));
  t   := (at_time at time zone 'Asia/Karachi')::time;
  foreach seg in array string_to_array(hours, '|') loop
    if split_part(seg, ':', 1) = dow then
      part := substr(seg, length(dow) + 2);
      if part ilike '%24 hours%' then return true; end if;
      if part ilike '%closed%'   then return false; end if;
      begin
        o := to_timestamp(trim(split_part(part, '–', 1)), 'HH12 AM')::time;
        c := to_timestamp(trim(split_part(part, '–', 2)), 'HH12 AM')::time;
      exception when others then return null; end;
      if c < o then return t >= o or t <= c;   -- wraps past midnight
      else          return t between o and c; end if;
    end if;
  end loop;
  return null;
end $$;

-- ------------------------------------------------------------ main: search
create or replace function search_places(
  q            text default null,
  lat          double precision default null,
  lng          double precision default null,
  radius_m     integer default 5000,
  cats         text[] default null,
  open_only    boolean default false,
  min_rating   numeric default null,
  lim          integer default 40,
  off          integer default 0
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
      and coalesce(p.google_status, '') not ilike '%permanently closed%'
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
           else exp(-(c.dist / greatest(radius_m, 1)::double precision) * 1.6) end as prox,
      is_open_now(c.hours) as open_flag
    from candidates c
  )
  select
    s.id, s.name, s.category_bucket, s.google_category,
    s.address, s.locality, s.phone, s.website,
    st_y(s.location::geometry), st_x(s.location::geometry),
    s.dist,
    s.rating, s.rating_count, s.fi_rating, s.fi_rating_count,
    s.price_range, s.hours, s.open_flag,
    s.photo_urls, s.cards_ok, s.menu_url,
    s.state,
    (0.40 * s.rel
   + 0.25 * s.quality
   + 0.20 * s.prox
   + 0.10 * (case when s.open_flag then 1.0 when s.open_flag is null then 0.5 else 0.15 end)
   + 0.05 * least(ln(coalesce(s.rating_count,0) + 1) / 7.0, 1.0)
    )::real as score
  from scored s
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
  select r, (select count(*)::int from search_places(q, lat, lng, r, null, false, null, 500, 0))
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
