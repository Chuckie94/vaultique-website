-- =====================================================================
-- Website Analytics: LIVE FIGURES, INSTANT "HERE NOW", and THE MAP
-- Run once, after supabase-analytics.sql. Safe to run again.
-- The last thing it shows is a report: every line must say OK.
--
-- 1. REPAIR. A site_events table made before the sku column existed
--    refuses any visit that mentions it. The column is added if missing.
-- 2. LIVE. Both analytics tables are published to Realtime, so the
--    Analytics page hears every visit and every departure at once. A
--    failure here is a WARNING and shows as NOT DONE in the report,
--    rather than disappearing behind "Success".
-- 3. GOODBYE. site_bye takes the visit's token as plain text, which a
--    browser will deliver as the page closes.
-- 4. HERE NOW. Somebody is on the site if heard from in the last 35
--    seconds (heartbeats come every 15).
-- 5. THE MAP. site_places holds the country, province and town of each
--    visit, written only by the shop's own Netlify function, and read
--    only through site_places_report by administrators who may see
--    analytics. No internet address is kept anywhere.
-- =====================================================================

-- 1) Repair ------------------------------------------------------------
alter table public.site_events add column if not exists sku text;


-- 2) Live --------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_events') then
    alter publication supabase_realtime add table public.site_events;
  end if;
exception when others then
  raise warning 'site_events NOT added to the realtime publication: %', sqlerrm;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_presence') then
    alter publication supabase_realtime add table public.site_presence;
  end if;
exception when others then
  raise warning 'site_presence NOT added to the realtime publication: %', sqlerrm;
end $$;


-- 3) Goodbye in plain text ----------------------------------------------
-- One unnamed text argument, which is what lets the database take a plain
-- text body. Anybody may call it, as with site_gone: it can only remove
-- the one visit whose random token it is given.
create or replace function public.site_bye(text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_session text := btrim($1);
begin
  if v_session is null or length(v_session) not between 8 and 64 then return; end if;
  delete from public.site_presence where session = v_session;
end;
$$;
revoke all on function public.site_bye(text) from public;
grant execute on function public.site_bye(text) to anon, authenticated;


-- 4) Here now: 35 seconds -----------------------------------------------
create or replace function public.site_here()
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.may_see_analytics() then
    raise exception 'You do not have permission to read the website analytics.';
  end if;
  delete from public.site_presence where seen_at < now() - interval '30 minutes';
  return coalesce((
    select json_agg(p.session)
      from public.site_presence p
     where p.seen_at > now() - interval '35 seconds'
  ), '[]'::json);
end;
$$;

create or replace function public.site_live()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.may_see_analytics() then
    raise exception 'You do not have permission to read the website analytics.';
  end if;
  delete from public.site_presence where seen_at < now() - interval '30 minutes';
  select count(*) into v_count
    from public.site_presence
   where seen_at > now() - interval '35 seconds';
  return coalesce(v_count, 0);
end;
$$;


-- 5) The map -------------------------------------------------------------
create table if not exists public.site_places (
  session      text primary key,           -- the visit's random token, as in site_events
  at           timestamptz not null default now(),
  country      text not null check (country ~ '^[A-Z]{2}$'),
  country_name text check (length(country_name) <= 80),
  region       text check (length(region) <= 80),
  city         text check (length(city) <= 80),
  lat          numeric(6,2) check (lat between -90 and 90),
  lon          numeric(6,2) check (lon between -180 and 180)
);
create index if not exists spl_at on public.site_places (at desc);

comment on table public.site_places is
  'Country, province and town of a website visit, from Netlify''s reading of the connection. No internet address. Written by the visit-where function only.';

-- Nobody reads or writes this table directly: the function uses the
-- service key, and administrators read it through the report below.
alter table public.site_places enable row level security;
revoke all on public.site_places from anon, authenticated;

-- Countries and towns for a date range, in the shop's time zone.
-- A visit is counted where it was placed; visits with no place are
-- counted too, as "not known", so the numbers add up to the Visits card.
create or replace function public.site_places_report(p_from date, p_to date, p_tz text default 'UTC')
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_out   json;
begin
  if not public.may_see_analytics() then
    raise exception 'You do not have permission to read the website analytics.';
  end if;
  p_tz    := coalesce(nullif(p_tz, ''), 'UTC');
  v_start := (p_from::timestamp) at time zone p_tz;
  v_end   := ((p_to + 1)::timestamp) at time zone p_tz;

  -- Kept as long as the raw visits are.
  delete from public.site_places where at < now() - interval '400 days';

  with visits as (
    select e.session,
           min(e.visitor)                                 as visitor,
           count(*) filter (where e.kind = 'page_view')   as pages
      from public.site_events e
     where e.at >= v_start and e.at < v_end
     group by e.session
  ),
  placed as (
    select v.*, p.country, p.country_name, p.region, p.city, p.lat, p.lon
      from visits v left join public.site_places p on p.session = v.session
  )
  select json_build_object(
    'visits',  (select count(*) from placed),
    'located', (select count(*) from placed where country is not null),
    'countries', coalesce((
      select json_agg(c order by c.visits desc, c.name)
        from (select country as code, max(country_name) as name,
                     count(*) as visits, count(distinct visitor) as visitors,
                     sum(pages) as page_views
                from placed where country is not null
               group by country) c), '[]'::json),
    'cities', coalesce((
      select json_agg(t order by t.visits desc, t.name)
        from (select country, max(country_name) as country_name, region, city as name,
                     round(avg(lat), 2) as lat, round(avg(lon), 2) as lon,
                     count(*) as visits, count(distinct visitor) as visitors,
                     sum(pages) as page_views
                from placed where country is not null
               group by country, region, city
               limit 300) t), '[]'::json)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.site_places_report(date, date, text) from public, anon;
grant execute on function public.site_places_report(date, date, text) to authenticated;


notify pgrst, 'reload schema';


-- The report. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('site_events has its sku column',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'site_events' and column_name = 'sku')),
    ('site_events published (live figures)',
       exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_events')),
    ('site_presence published (instant here now)',
       exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_presence')),
    ('site_bye exists (plain text goodbye)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'site_bye')),
    ('site_places exists (the map)',
       exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = 'site_places')),
    ('site_places_report exists (the map)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'site_places_report'))
  ) as t(part, done);
