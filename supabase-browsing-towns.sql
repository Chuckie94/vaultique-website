-- =====================================================================
-- Where visitors browse from: the town they say, beside the network's guess
-- Run once in this WEBSITE's Supabase SQL Editor. Safe to run again.
--
-- "Where are you browsing from?" (assets/where.js) lets a visitor pick
-- their town. The visit-where function records it for that visit in place
-- of Netlify's guess from the connection, and marks it how = 'told'. A
-- visitor who does not answer is recorded exactly as before
-- (how = 'connection').
--
-- The map's report now says, for every town, how many visits were told
-- and how many were guessed, so Admin > Analytics can show the two apart.
-- =====================================================================

-- ---------------------------------------------------------------------
-- NOT AFTER BUILD 76'S HARDENING. Once supabase-hardening.sql has been
-- run on this project it holds the newer version of everything this
-- file sets up, and running this one again would quietly put back an
-- older, weaker one. So it stops here, before changing anything.
-- ---------------------------------------------------------------------
do $$
declare
  v_done boolean := false;
begin
  -- Asked through EXECUTE because on a project that has never run the
  -- hardening the table does not exist, and a plain query naming it
  -- would stop this file before it started.
  if to_regclass('public.schema_migrations') is not null then
    execute 'select exists (select 1 from public.schema_migrations where version >= ''076'')' into v_done;
  end if;
  if v_done then
    raise exception using
      message = 'Not run, and nothing was changed: supabase-hardening.sql (build 76 or later) has already been run on this project and replaces this file. If you were running this file again because older instructions said it was safe to, you do not need to: run supabase-hardening.sql again instead.',
      hint = 'Only if this file has never been run on this project and you need it: run  delete from public.schema_migrations where version >= ''076'';  then this file, then supabase-hardening.sql again.';
  end if;
end $$;

alter table public.site_places add column if not exists how text not null default 'connection';
do $$ begin
  alter table public.site_places add constraint site_places_how check (how in ('connection', 'told'));
exception when duplicate_object then null; end $$;

-- Countries and towns for a date range, in the shop's time zone.
-- A visit is counted where it was placed; visits with no place are
-- counted too, as "not known", so the numbers add up to the Visits card.
-- A town is one row whether its visits were told or guessed: "Lusaka" from
-- the network and "Lusaka" from a visitor are the same town.
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
    select v.*, p.country, p.country_name, p.region, p.city, p.lat, p.lon,
           coalesce(p.how, 'connection') as how
      from visits v left join public.site_places p on p.session = v.session
  )
  select json_build_object(
    'visits',        (select count(*) from placed),
    'located',       (select count(*) from placed where country is not null),
    'told',          (select count(*) from placed where how = 'told'),
    'told_visitors', (select count(distinct visitor) from placed where how = 'told'),
    'countries', coalesce((
      select json_agg(c order by c.visits desc, c.name)
        from (select country as code, max(country_name) as name,
                     count(*) as visits, count(distinct visitor) as visitors,
                     sum(pages) as page_views,
                     count(*) filter (where how = 'told') as told,
                     count(distinct visitor) filter (where how = 'told') as told_visitors
                from placed where country is not null
               group by country) c), '[]'::json),
    'cities', coalesce((
      select json_agg(t order by t.visits desc, t.name)
        from (select country, max(country_name) as country_name, max(region) as region, city as name,
                     round(avg(lat), 2) as lat, round(avg(lon), 2) as lon,
                     count(*) as visits, count(distinct visitor) as visitors,
                     sum(pages) as page_views,
                     count(*) filter (where how = 'told') as told,
                     count(distinct visitor) filter (where how = 'told') as told_visitors
                from placed where country is not null
               group by country, city, case when city is null then region end
               limit 300) t), '[]'::json)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.site_places_report(date, date, text) from public, anon;
grant execute on function public.site_places_report(date, date, text) to authenticated;

comment on table public.site_places is
  'Country, province and town of a website visit: the town the visitor picked (how = told), or Netlify''s reading of the connection (how = connection). No internet address. Written by the visit-where function only.';

notify pgrst, 'reload schema';

-- The check. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('site_places.how (told or guessed)',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'site_places' and column_name = 'how')),
    ('site_places_report counts told towns',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'site_places_report'
                  and pg_get_functiondef(p.oid) like '%told_visitors%'))
  ) t(part, done);
