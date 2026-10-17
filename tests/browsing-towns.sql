-- ===========================================================================
-- WHERE VISITORS SAY THEY ARE -- the database half
--
--   psql -f tests/analytics-fixture.sql -f supabase-analytics.sql \
--        -f tests/analytics-live-fixture.sql -f supabase-analytics-live.sql \
--        -f supabase-browsing-towns.sql -f tests/browsing-towns.sql
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temp table bt (n serial, ok boolean, what text);
grant all on bt to public; grant all on sequence bt_n_seq to public;

-- Four visits today:
--   w1  on mobile data in Livingstone: the network said Lusaka, the visitor said Livingstone
--   w2  in Lusaka, said nothing: the network's Lusaka stands
--   w3  in Lusaka, said Lusaka
--   w4  said "somewhere else in Southern Province"
insert into public.site_events (kind, path, visitor, session, device) values
  ('page_view', '/', 'v-w1', 'sess-w1', 'mobile'),
  ('page_view', '/', 'v-w2', 'sess-w2', 'mobile'),
  ('page_view', '/', 'v-w3', 'sess-w3', 'desktop'),
  ('page_view', '/', 'v-w4', 'sess-w4', 'mobile');
insert into public.site_places (session, country, country_name, region, city, lat, lon) values
  ('sess-w1', 'ZM', 'Zambia', 'Lusaka Province', 'Lusaka', -15.42, 28.28),
  ('sess-w2', 'ZM', 'Zambia', 'Lusaka Province', 'Lusaka', -15.42, 28.28);
-- what visit-where does when the visitor answers: the guess is replaced
insert into public.site_places (session, country, country_name, region, city, lat, lon, how) values
  ('sess-w1', 'ZM', 'Zambia', 'Southern Province', 'Livingstone', -17.84, 25.85, 'told'),
  ('sess-w3', 'ZM', 'Zambia', 'Lusaka Province', 'Lusaka', -15.41, 28.29, 'told'),
  ('sess-w4', 'ZM', 'Zambia', 'Southern Province', null, -16.7, 27.0, 'told')
  on conflict (session) do update set country = excluded.country, country_name = excluded.country_name,
    region = excluded.region, city = excluded.city, lat = excluded.lat, lon = excluded.lon, how = excluded.how;

insert into bt (ok, what) values
  ((select how = 'connection' from public.site_places where session = 'sess-w2'),
   'a visitor who says nothing is recorded as before, from the connection'),
  ((select city = 'Livingstone' and how = 'told' from public.site_places where session = 'sess-w1'),
   'what the visitor says replaces the network''s guess for that visit');

-- An administrator reads the report.
delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
create temp table r as select public.site_places_report(current_date - 1, current_date + 1, 'UTC')::jsonb as j;
reset role;

insert into bt (ok, what) values
  ((select (j->>'told')::int = 3 and (j->>'told_visitors')::int = 3 from r), 'three visits were told, by three people'),
  ((select (c->>'visits')::int = 2 and (c->>'told')::int = 1
      from r, jsonb_array_elements(j->'cities') c where c->>'name' = 'Lusaka'),
   'Lusaka is one town: two visits, one told and one guessed'),
  ((select (c->>'told')::int = 1 and c->>'region' = 'Southern Province' and (c->>'lat')::numeric = -17.84
      from r, jsonb_array_elements(j->'cities') c where c->>'name' = 'Livingstone'),
   'Livingstone appears, told, in Southern Province, at its own position'),
  ((select count(*) = 1 from r, jsonb_array_elements(j->'cities') c
     where c->>'name' is null and c->>'region' = 'Southern Province' and (c->>'told')::int = 1),
   '"somewhere else in Southern Province" is counted under the province'),
  ((select (c->>'told')::int = 3 from r, jsonb_array_elements(j->'countries') c where c->>'code' = 'ZM'),
   'and Zambia shows three told visits');

-- Nobody but an administrator can read it, as before.
delete from auth.whoami;
insert into auth.whoami values ('00000000-0000-0000-0000-000000000000');
set role authenticated;
do $$ begin
  begin
    perform public.site_places_report(current_date, current_date, 'UTC');
    insert into bt (ok, what) values (false, 'a stranger is refused the report');
  exception when others then
    insert into bt (ok, what) values (true, 'a stranger is refused the report');
  end;
end $$;
reset role;

select n, case when ok then '  ✓ ' else '  ✗ ' end || what as result from bt order by n;
select case when bool_and(ok) then '  where visitors say they are: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end as summary from bt;
