-- psql -f tests/analytics-fixture.sql -f supabase-analytics.sql \
--      -f supabase-analytics-sources.sql -f tests/analytics-sources.sql
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temp table sc (n serial, ok boolean, what text);
grant all on sc to public; grant all on sequence sc_n_seq to public;

insert into public.site_events (kind, path, visitor, session, referrer, at) values
  ('page_view', '/', 'visitor-f1', 'session-f1', 'l.facebook.com', now() - interval '3 minutes'),
  ('page_view', '/shop', 'visitor-f1', 'session-f1', null, now() - interval '2 minutes'),
  ('page_view', '/', 'visitor-f2', 'session-f2', 'facebook.com', now()),
  ('page_view', '/', 'visitor-f3', 'session-f3', 'm.facebook.com', now()),
  ('page_view', '/', 'visitor-i1', 'session-i1', 'l.instagram.com', now()),
  ('page_view', '/', 'visitor-w1', 'session-w1', 'wa.me', now()),
  ('page_view', '/', 'visitor-g1', 'session-g1', 'google.co.zm', now()),
  ('page_view', '/', 'visitor-d1', 'session-d1', null, now()),
  ('page_view', '/', 'visitor-d1', 'session-d2', null, now()),
  ('page_view', '/', 'visitor-o1', 'session-o1', 'zambiashops.com', now());

insert into sc (ok, what) values
  (public.site_source_name('lm.facebook.com') = 'Facebook', 'lm.facebook.com is Facebook'),
  (public.site_source_name('notfacebook.com') = 'notfacebook.com', 'a site merely ending in "facebook.com" is not Facebook');

delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$
declare r json; f int; d int; i int; w int; g int; o int;
begin
  r := public.site_sources(current_date - 1, current_date + 1, 'UTC');
  select (x->>'visits')::int into f from json_array_elements(r) x where x->>'source' = 'Facebook';
  select (x->>'visits')::int into i from json_array_elements(r) x where x->>'source' = 'Instagram';
  select (x->>'visits')::int into w from json_array_elements(r) x where x->>'source' = 'WhatsApp';
  select (x->>'visits')::int into g from json_array_elements(r) x where x->>'source' = 'Google';
  select (x->>'visits')::int into d from json_array_elements(r) x where x->>'source' = 'Direct';
  select (x->>'visits')::int into o from json_array_elements(r) x where x->>'source' = 'zambiashops.com';
  insert into sc (ok, what) values
    (f = 3, 'three visits from Facebook, however the link was dressed, each counted once'),
    (i = 1 and w = 1 and g = 1, 'Instagram, WhatsApp and Google each named'),
    (d >= 2, 'visits with no source counted as Direct'),
    (o = 1, 'any other site shown by its own name'),
    (r->0->>'source' = 'Facebook', 'the biggest source first');
end $$;
reset role;

delete from auth.whoami;
set role anon;
do $$ begin
  begin
    perform public.site_sources(current_date, current_date, 'UTC');
    insert into sc (ok, what) values (false, 'a visitor cannot read where visits came from');
  exception when others then
    insert into sc (ok, what) values (true, 'a visitor cannot read where visits came from');
  end;
end $$;
reset role;

select case when ok then '  ✓ ' else '  ✗ ' end || what from sc order by n;
select case when count(*) filter (where not ok) = 0
            then '  where visitors came from: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end from sc;
