-- ===========================================================================
-- LIVE ANALYTICS, THE GOODBYE AND THE MAP -- the database half
--
--   psql -f tests/analytics-fixture.sql -f supabase-analytics.sql \
--        -f tests/analytics-live-fixture.sql -f supabase-analytics-live.sql \
--        -f tests/analytics-live.sql
--
-- Also run on its own against an old table with no sku column:
--   psql -f tests/analytics-live-fixture.sql -f supabase-analytics-live.sql
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temp table lc (n serial, ok boolean, what text);
grant all on lc to public; grant all on sequence lc_n_seq to public;

insert into lc (ok, what) values
  ((select count(*) = 0 from (values
     (exists (select 1 from information_schema.columns where table_name = 'site_events' and column_name = 'sku')),
     (exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'site_events')),
     (exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'site_presence'))
   ) v(x) where not x), 'sku column, and both tables published for Realtime');

-- Three visits today: two placed in Zambia, one never placed.
insert into public.site_events (kind, path, visitor, session, device) values
  ('page_view', '/', 'visitor-aaaa', 'session-aaaa', 'mobile'),
  ('page_view', '/shop', 'visitor-aaaa', 'session-aaaa', 'mobile'),
  ('page_view', '/', 'visitor-bbbb', 'session-bbbb', 'desktop'),
  ('product_view', '/product/A1', 'visitor-bbbb', 'session-bbbb', 'desktop'),
  ('page_view', '/', 'visitor-cccc', 'session-cccc', 'mobile');
insert into public.site_places (session, country, country_name, region, city, lat, lon) values
  ('session-aaaa', 'ZM', 'Zambia', 'Lusaka Province', 'Lusaka', -15.42, 28.28),
  ('session-bbbb', 'ZM', 'Zambia', 'Copperbelt', 'Kitwe', -12.80, 28.21);

-- The owner reads the map.
delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$
declare r json;
begin
  r := public.site_places_report(current_date, current_date, 'UTC');
  insert into lc (ok, what) values
    ((r->>'visits')::int = (select count(distinct session) from public.site_events
                             where at >= current_date::timestamp at time zone 'UTC'),
       'the map counts every visit in the range, placed or not'),
    ((r->>'located')::int = 2, 'and says how many of them were placed: 2'),
    (json_array_length(r->'countries') = 1 and r->'countries'->0->>'code' = 'ZM'
       and (r->'countries'->0->>'visits')::int = 2, 'Zambia, 2 visits'),
    ((r->'countries'->0->>'page_views')::int = 3, 'with their 3 page views'),
    (json_array_length(r->'cities') = 2, 'two towns'),
    ((select count(*) from json_array_elements(r->'cities') c
       where c->>'name' = 'Kitwe' and (c->>'lat')::numeric = -12.80) = 1, 'Kitwe, at Kitwe');
end $$;
reset role;

-- Nobody else reads it.
delete from auth.whoami;
set role anon;
do $$
begin
  begin
    perform public.site_places_report(current_date, current_date, 'UTC');
    insert into lc (ok, what) values (false, 'a visitor cannot read the map');
  exception when others then
    insert into lc (ok, what) values (true, 'a visitor cannot read the map');
  end;
  begin
    perform 1 from public.site_places limit 1;
    insert into lc (ok, what) values (false, 'nor the places table');
  exception when others then
    insert into lc (ok, what) values (true, 'nor the places table');
  end;
  begin
    insert into public.site_places (session, country) values ('session-dddd', 'US');
    insert into lc (ok, what) values (false, 'nor write a place of their own choosing');
  exception when others then
    insert into lc (ok, what) values (true, 'nor write a place of their own choosing');
  end;
end $$;

-- The plain text goodbye, as a visitor.
reset role;
insert into public.site_presence (session, seen_at) values ('session-byebye1', now()), ('session-stale01', now() - interval '40 seconds')
  on conflict (session) do update set seen_at = excluded.seen_at;
set role anon;
select public.site_bye('session-byebye1');
reset role;
insert into lc (ok, what) values
  (not exists (select 1 from public.site_presence where session = 'session-byebye1'), 'site_bye removes the visit that said goodbye');

-- Here now is 35 seconds.
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into lc (ok, what) values
  (not (public.site_here()::jsonb ? 'session-stale01'), 'somebody silent for 40 seconds is no longer here'),
  (public.site_live() = (select count(*) from public.site_presence where seen_at > now() - interval '35 seconds'),
   'and the other counter agrees');
reset role;

select case when ok then '  ✓ ' else '  ✗ ' end || what from lc order by n;
select case when count(*) filter (where not ok) = 0
            then '  live analytics and the map: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from lc;
