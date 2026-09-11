-- ===========================================================================
-- WEBSITE ANALYTICS — the database half, checked
--
-- Run against a scratch Postgres that has had tests/analytics-fixture.sql and
-- then supabase-analytics.sql applied:
--
--   psql -f tests/analytics-fixture.sql -f supabase-analytics.sql -f tests/analytics.sql
--
-- Every check prints a line. The last line says how many failed, and the
-- script exits non-zero if any did. Nothing here talks to Supabase and
-- nothing here needs a network.
--
-- WHAT IT IS ACTUALLY PROVING. Two things carry the whole feature and both
-- are easy to get wrong in a way that looks right: that a visit recorded by
-- the storefront, which holds only the public key, really does land in the
-- table; and that the same key cannot read a single row back out. The rest
-- is arithmetic, and the arithmetic is checked against days laid out by hand
-- so that a wrong answer is a wrong number and not a matter of opinion.
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create table checks (n serial, ok boolean, what text);

-- SECURITY DEFINER because half of these checks run as `anon`, which is
-- the whole point of them, and anon may not write to a table any more than
-- it may read the analytics.
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin
  insert into checks (ok, what) values (coalesce(p_ok, false), p_what);
end $$;

-- A heading. Kept in the same table as the checks so the report comes out
-- in the order the checks were actually made.
create or replace function hdr(p_text text) returns void
language plpgsql security definer as $$
begin
  insert into checks (ok, what) values (null, p_text);
end $$;
grant execute on function chk(boolean, text) to public;
grant execute on function hdr(text) to public;

-- Who is signed in, for the tests that care.
create or replace function be(p_who text) returns void language plpgsql as $$
begin
  delete from auth.whoami;
  if p_who = 'owner' then insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
  elsif p_who = 'admin' then insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
  elsif p_who = 'agent' then insert into auth.whoami values ('33333333-3333-3333-3333-333333333333');
  end if;
end $$;

select hdr('A visit is recorded by the storefront, which holds only the public key');

do $$
begin
  set local role anon;
  insert into public.site_events (kind, path, label, visitor, session, device, is_new, referrer)
  values ('page_view', '/', 'Home', 'v-alice-00001', 's-alice-day0', 'mobile', true, 'google.com');
  insert into public.site_events (kind, path, label, sku, visitor, session, device)
  values ('product_view', '/product/VB-DRS-001', 'Silk Wrap Dress', 'VB-DRS-001',
          'v-alice-00001', 's-alice-day0', 'mobile');
  insert into public.site_events (kind, path, label, sku, visitor, session, device)
  values ('add_to_cart', '/product/VB-DRS-001', 'Silk Wrap Dress', 'VB-DRS-001',
          'v-alice-00001', 's-alice-day0', 'mobile');
  insert into public.site_events (kind, path, label, visitor, session, device)
  values ('checkout_start', '/product/VB-DRS-001', 'Silk Wrap Dress',
          'v-alice-00001', 's-alice-day0', 'mobile');
  perform public.site_beat('s-alice-day0', 'mobile');
end $$;

select chk((select count(*) from public.site_events where visitor = 'v-alice-00001') = 4,
           'four events reach the table through the anon key');
select chk((select count(*) from public.site_presence where session = 's-alice-day0') = 1,
           'and the heartbeat leaves exactly one presence row');

do $$
begin
  set local role anon;
  perform public.site_beat('s-alice-day0', 'mobile');
  perform public.site_beat('s-alice-day0', 'mobile');
end $$;
select chk((select count(*) from public.site_presence where session = 's-alice-day0') = 1,
           'beating again moves the timestamp and does not add a row');

select hdr('And the storefront cannot read a single thing back');

do $$
begin
  set local role anon;
  perform chk((select count(*) from public.site_events) = 0,
              'the anon key reads no events at all, not even its own');
  perform chk((select count(*) from public.site_presence) = 0,
              'and no presence rows');
  perform chk((select count(*) from public.site_daily) = 0,
              'and no daily summaries');
end $$;

do $$
declare v_msg text;
begin
  set local role anon;
  begin
    update public.site_events set kind = 'page_view' where true;
    perform chk(false, 'a recorded visit cannot be edited afterwards');
  exception when others then
    perform chk(true, 'a recorded visit cannot be edited afterwards');
  end;
  begin
    delete from public.site_events where true;
    perform chk(false, 'and cannot be deleted');
  exception when others then
    perform chk(true, 'and cannot be deleted');
  end;
end $$;

select hdr('What the database refuses to record');

do $$
declare bad int := 0;
begin
  set local role anon;
  begin
    insert into public.site_events (kind, visitor, session)
    values ('password_typed', 'v-bad-00000001', 's-bad-00000001');
  exception when others then bad := bad + 1; end;
  begin
    insert into public.site_events (kind, visitor, session)
    values ('page_view', 'v', 's-bad-00000001');
  exception when others then bad := bad + 1; end;
  begin
    insert into public.site_events (kind, visitor, session, device)
    values ('page_view', 'v-bad-00000001', 's-bad-00000001', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
  exception when others then bad := bad + 1; end;
  begin
    insert into public.site_events (kind, visitor, session, at)
    values ('page_view', 'v-bad-00000001', 's-bad-00000001', now() - interval '400 days');
  exception when others then bad := bad + 1; end;
  perform chk(bad = 4,
    'a kind nobody defined, a token too short, a browser string in the device column and a back-dated row are all refused');
end $$;

select hdr('Who may read the numbers');

select be('agent');
do $$
begin
  perform chk(public.may_see_analytics() = false,
              'an agent, whose role has no analytics tick, may not');
  begin
    perform public.site_stats(current_date, current_date, 'UTC');
    perform chk(false, 'and asking anyway is refused rather than answered');
  exception when others then
    perform chk(true, 'and asking anyway is refused rather than answered');
  end;
end $$;

select be('admin');
select chk(public.may_see_analytics(), 'an administrator whose role has the tick may');
select be('owner');
select chk(public.may_see_analytics(), 'and the owner may, whatever the roles say');

-- The owner is never limited by a role: proved by taking the tick away.
update public.site_settings
   set data = jsonb_set(data, '{full,permissions,analytics}', 'false')
 where key = 'roles';
select be('owner');
select chk(public.may_see_analytics(), 'the owner keeps it even with every role switched off');
select be('admin');
select chk(public.may_see_analytics() = false, 'and the administrator loses it the moment it is unticked');
update public.site_settings
   set data = jsonb_set(data, '{full,permissions,analytics}', 'true')
 where key = 'roles';

select hdr('The numbers themselves');

-- Three days laid out by hand. Written as the table owner, because these
-- are days that have already happened and the insert policy quite rightly
-- refuses a back-dated row from the storefront.
--
--   two days ago  alice (mobile, home once and shop three times), bob (desktop, home)
--   yesterday     alice again (mobile, shop and home), carol (tablet, shop)
--   today         alice again (already recorded above, home + three product events)
--
-- So over the three days: 3 people, 2 of them first seen two days ago and one
-- the day after; 5 visits; 9 page views, of which the shop page is 5 and the
-- home page 4 — laid out with a clear winner on purpose, because a tie would
-- make "the most viewed page" a question the test could pass by luck.
insert into public.site_events (at, kind, path, label, visitor, session, device, is_new)
values
  (now() - interval '2 days', 'page_view', '/',      'Home', 'v-alice-00001', 's-alice-d2', 'mobile',  true),
  (now() - interval '2 days', 'page_view', '/shop',  'Shop', 'v-alice-00001', 's-alice-d2', 'mobile',  false),
  (now() - interval '2 days', 'page_view', '/shop',  'Shop', 'v-alice-00001', 's-alice-d2', 'mobile',  false),
  (now() - interval '2 days', 'page_view', '/shop',  'Shop', 'v-alice-00001', 's-alice-d2', 'mobile',  false),
  (now() - interval '2 days', 'page_view', '/',      'Home', 'v-bob-00000001', 's-bob-d2',  'desktop', true),
  (now() - interval '1 day',  'page_view', '/shop',  'Shop', 'v-alice-00001', 's-alice-d1', 'mobile',  false),
  (now() - interval '1 day',  'page_view', '/',      'Home', 'v-alice-00001', 's-alice-d1', 'mobile',  false),
  (now() - interval '1 day',  'page_view', '/shop',  'Shop', 'v-carol-000001', 's-carol-d1','tablet',  true);

select be('admin');

select hdr('  ...over the three days');
do $$
declare s json;
begin
  s := public.site_stats(current_date - 2, current_date, 'UTC');
  perform chk((s->>'visits')::int = 5,          'five visits');
  perform chk((s->>'visitors')::int = 3,        'three people, not five — alice is one person on three days');
  perform chk((s->>'page_views')::int = 9,      'nine page views');
  perform chk((s->>'product_views')::int = 1,   'one product view');
  perform chk((s->>'add_to_cart')::int = 1,     'one add to cart');
  perform chk((s->>'checkout_starts')::int = 1, 'one checkout start');
  perform chk((s->>'new_visitors')::int = 3,    'all three are new, because nobody was here before');
  perform chk((s->>'returning_visitors')::int = 0, 'and none returning');
  perform chk((s->>'mobile')::int = 3,          'three visits on a phone');
  perform chk((s->>'desktop')::int = 1,         'one on a desktop');
  perform chk((s->>'tablet')::int = 1,          'one on a tablet');
end $$;

select hdr('  ...and today on its own, which is read raw because it can still change');
do $$
declare s json;
begin
  s := public.site_stats(current_date, current_date, 'UTC');
  perform chk((s->>'visits')::int = 1,             'one visit today');
  perform chk((s->>'visitors')::int = 1,           'one person');
  perform chk((s->>'page_views')::int = 1,         'one page view');
  perform chk((s->>'new_visitors')::int = 0,       'who is not new: she was here two days ago');
  perform chk((s->>'returning_visitors')::int = 1, 'she is a returning visitor');
end $$;

select hdr('  ...and yesterday, which is a finished day and gets summed up once');
do $$
declare s json; n int;
begin
  s := public.site_stats(current_date - 1, current_date - 1, 'UTC');
  perform chk((s->>'visits')::int = 2,             'two visits yesterday');
  perform chk((s->>'visitors')::int = 2,           'two people');
  perform chk((s->>'new_visitors')::int = 1,       'one of them here for the first time');
  perform chk((s->>'returning_visitors')::int = 1, 'the other coming back');
  select count(*) into n from public.site_daily where day = current_date - 1;
  perform chk(n = 1, 'and a summary row now exists for it');
  select count(*) into n from public.site_daily where day = current_date;
  perform chk(n = 0, 'while today is never summed up, because today can still change');
end $$;

select hdr('The chart');
do $$
declare a json; b json;
begin
  a := public.site_series(current_date - 2, current_date, 'UTC', 'day');
  perform chk(json_array_length(a) = 3, 'three days, three points');
  perform chk((a->0->>'visits')::int = 2 and (a->2->>'visits')::int = 1,
              'in order, oldest first');
  b := public.site_series(current_date - 2, current_date, 'UTC', 'month');
  perform chk((select sum((x->>'visitors')::int) from json_array_elements(b) x) <= 3,
              'a month counts alice once however many days she came');
  perform chk(json_array_length(public.site_series(current_date - 2, current_date, 'UTC', 'drop table')) = 3,
              'a grain nobody defined falls back to days rather than reaching date_trunc');
end $$;

select hdr('Most looked at');
do $$
declare p json; q json;
begin
  p := public.site_top_pages(current_date - 2, current_date, 'UTC', 10);
  perform chk(p->0->>'path' = '/shop' and (p->0->>'views')::int = 5,
              'the shop page comes first, viewed five times');
  perform chk((select (x->>'views')::int from json_array_elements(p) x
                where x->>'path' = '/') = 4,
              'the home page second, four times');
  perform chk((select (x->>'visitors')::int from json_array_elements(p) x
                where x->>'path' = '/shop') = 2,
              'and its two viewers are counted apart from its five views');
  q := public.site_top_products(current_date - 2, current_date, 'UTC', 10);
  perform chk(q->0->>'sku' = 'VB-DRS-001' and (q->0->>'views')::int = 1,
              'the dress is the most viewed piece');
  perform chk((q->0->>'carts')::int = 1,
              'and its add-to-cart count is counted apart from its views');
end $$;

select hdr('Who is here right now');
do $$
begin
  perform chk(public.site_live() = 1, 'a tab beating right now is here now');

  -- NOBODY READING IS EVER DROPPED, which is the point of this pair and
  -- has not changed. What changed is the numbers: a tab beats every
  -- twenty seconds now rather than every sixty, so surviving one missed
  -- beat means surviving forty seconds rather than a hundred and twenty.
  -- Forty is comfortably inside the window; the window is what came
  -- down, not the tolerance.
  update public.site_presence set seen_at = now() - interval '40 seconds';
  perform chk(public.site_live() = 1,
              'and is still here forty seconds later, having missed a beat');

  -- The one that pins the window itself. It was five minutes, then two,
  -- and is forty-five seconds: the shop said somebody who had left
  -- lingered on the screen, and every second of that was a shop being
  -- told something untrue about its own shop.
  update public.site_presence set seen_at = now() - interval '50 seconds';
  perform chk(public.site_live() = 0,
              'but fifty seconds after the last beat they have gone');

  -- And they do not have to be waited for at all. A browser says when it
  -- is leaving, so the row goes at once rather than ageing out.
  update public.site_presence set seen_at = now();
  perform chk(public.site_live() = 1, 'a tab beating again is here again');
  perform public.site_gone((select session from public.site_presence limit 1));
  perform chk(public.site_live() = 0,
              'and saying goodbye takes them off the count immediately');
  perform chk((select count(*) from public.site_presence) = 0,
              'with no row left behind to age out');

  -- Put it back for the checks below, which are about ageing out.
  insert into public.site_presence (session, seen_at, device)
  values ('sess-here-again', now(), 'mobile');

  update public.site_presence set seen_at = now() - interval '20 minutes';
  perform chk(public.site_live() = 0, 'a tab that stopped beating twenty minutes ago is not here now');
  perform chk((select count(*) from public.site_presence) = 1,
              'though its row survives until it is half an hour stale');
  update public.site_presence set seen_at = now() - interval '40 minutes';
  perform public.site_live();
  perform chk((select count(*) from public.site_presence) = 0,
              'and is cleared out then, which is what keeps this table small');
end $$;

select hdr('Throwing away old raw rows never throws away the history');
do $$
declare gone int; before int;
begin
  select count(*) into before from public.site_events;
  -- Asked to prune everything: it must still refuse to go past the last
  -- day that has been summed up.
  gone := public.site_prune(30, 'UTC');
  perform chk(gone = 0, 'nothing 30 days old, so nothing goes');
  perform chk((select count(*) from public.site_events) = before, 'and the table is untouched');
  perform chk((select count(*) from public.site_daily) >= 1, 'the summaries are still there');
end $$;

select hdr('Days summed up out of order still say who was new');
do $$
declare s json;
begin
  /* The case this gets wrong if the rollup only ever looks at the day in
     front of it. An owner opens a recent range first, so a later day is summed
     before an earlier one, and a visitor who was already here reads as new. */
  delete from public.site_events;
  delete from public.site_visitor_days;
  delete from public.site_daily;

  insert into public.site_events (at, kind, path, visitor, session, device)
  values
    (now() - interval '9 days', 'page_view', '/', 'v-dora-00000001', 's-dora-d9', 'mobile'),
    (now() - interval '4 days', 'page_view', '/', 'v-dora-00000001', 's-dora-d4', 'mobile');

  -- The later day first, which is what asking for a recent range does.
  perform public.site_rollup(current_date - 4, 'UTC');
  perform chk((select is_first from public.site_visitor_days
                where day = current_date - 4 and visitor = 'v-dora-00000001'),
              'summed on its own, the later day calls her new — it has nothing else to go on');

  -- Then the earlier one, which is what asking for a wider range does next.
  perform public.site_rollup(current_date - 9, 'UTC');
  perform chk((select not is_first from public.site_visitor_days
                where day = current_date - 4 and visitor = 'v-dora-00000001'),
              'and summing the earlier day goes back and corrects it');
  perform chk((select is_first from public.site_visitor_days
                where day = current_date - 9 and visitor = 'v-dora-00000001'),
              'the earlier day is the one she was new on');

  s := public.site_stats(current_date - 6, current_date - 1, 'UTC');
  perform chk((s->>'new_visitors')::int = 0 and (s->>'returning_visitors')::int = 1,
              'so a range holding only the later day counts her as returning, which she was');

  perform chk((select new_visitors from public.site_daily where day = current_date - 4) = 0,
              'and the stored count for that day was corrected with it');
end $$;

select hdr('A day that has been pruned is never rebuilt as a day of noughts');
do $$
declare v int;
begin
  -- The worst case this design has: the raw rows for a day are gone, the
  -- summary is all that is left, and somebody asks for a range covering it.
  insert into public.site_events (at, kind, path, visitor, session, device)
  values (now() - interval '1 day', 'page_view', '/', 'v-eve-000000001', 's-eve-d1', 'mobile');
  perform public.site_rollup(current_date - 1, 'UTC');
  update public.site_daily set visits = 99 where day = current_date - 1;
  delete from public.site_events where at < now() - interval '12 hours';
  -- Yesterday alone, so the number under test is yesterday's and not a sum
  -- that a second day could have carried.
  v := ((public.site_stats(current_date - 1, current_date - 1, 'UTC'))->>'visits')::int;
  perform chk(v = 99, 'the summary answers, and is not overwritten from an empty table');
  perform chk((select count(*) from public.site_events
                where at < now() - interval '12 hours') = 0,
              'even though there is not one raw row left from that day');
end $$;

select hdr('Two timezones do not rewrite the table between them');
-- Audit W-4. site_daily was keyed on the day alone while every read filtered on
-- the timezone as well, so a read from a second zone matched nothing, re-summed
-- every day in the range and overwrote the lot -- and the first zone then did it
-- back. On a fortnight of data all fourteen rows were rewritten on the third
-- read. What is checked here is that a second read of a zone already summarised
-- rewrites nothing at all.
do $$
declare
  n_rewritten int;
  n_rows      int;
  lusaka      text;
  london      text;
begin
  delete from public.site_events;
  delete from public.site_daily;
  delete from public.site_visitor_days;

  insert into public.site_events (at, kind, path, visitor, session, device)
  select now() - (d || ' days')::interval, 'page_view', '/shop', 'v' || (d % 5),
         's' || d, 'mobile'
    from generate_series(1, 14) d;

  perform be('owner');
  perform public.site_stats((current_date - 14), current_date, 'Africa/Lusaka');
  perform public.site_stats((current_date - 14), current_date, 'Europe/London');

  create temp table _snap on commit drop as
    select day, tz, built_at from public.site_daily;

  select count(*) into n_rows from public.site_daily;
  perform chk(n_rows = 28,
    'each timezone keeps its own summary of each day (' || n_rows || ' rows)');

  perform pg_sleep(1.1);
  perform public.site_stats((current_date - 14), current_date, 'Africa/Lusaka');

  select count(*) filter (where a.built_at is distinct from b.built_at)
    into n_rewritten
    from public.site_daily a join _snap b using (day, tz);
  perform chk(n_rewritten = 0,
    'reading again from a timezone already summed rewrites nothing (' ||
    n_rewritten || ' rewritten)');

  perform public.site_stats((current_date - 14), current_date, 'Europe/London');
  select count(*) filter (where a.built_at is distinct from b.built_at)
    into n_rewritten
    from public.site_daily a join _snap b using (day, tz);
  perform chk(n_rewritten = 0,
    'and neither does reading from the other one (' || n_rewritten || ' rewritten)');

  select (public.site_stats((current_date - 14), current_date, 'Africa/Lusaka')::jsonb)->>'page_views',
         (public.site_stats((current_date - 14), current_date, 'Europe/London')::jsonb)->>'page_views'
    into lusaka, london;
  perform chk(lusaka = '14' and london = '14',
    'and both readers are told the same thing (' || lusaka || ' / ' || london || ')');
end $$;


select hdr('A ceiling on what one browser can record');
-- Audit W-6. The storefront records with the public key, which is public by
-- design, so the shape rules were the only thing standing between the figures
-- and anybody who viewed source. The ceiling is set far above a person on
-- purpose: the point is to stop a script, not to police a customer.
do $$
declare
  i      int;
  kept   int := 0;
  before int;
begin
  delete from public.site_events;
  delete from public.site_presence;

  insert into public.site_events (kind, path, visitor, session, device)
  select 'page_view', '/shop', 'real-person', 'sess-real', 'mobile'
    from generate_series(1, 12);
  select count(*) into before from public.site_events where visitor = 'real-person';
  perform chk(before = 12, 'a dozen events in a burst is an ordinary visit and is kept');

  for i in 1..200 loop
    begin
      insert into public.site_events (kind, path, visitor, session, device)
      values ('page_view', '/shop', 'a-script', 'sess-script', 'mobile');
      kept := kept + 1;
    exception when others then exit;
    end;
  end loop;
  perform chk(kept < 200 and kept >= 50,
    'a script asking two hundred times in a minute is stopped (' || kept || ' got in)');

  insert into public.site_events (kind, path, visitor, session, device)
  values ('page_view', '/shop', 'real-person', 'sess-real', 'mobile');
  select count(*) into before from public.site_events where visitor = 'real-person';
  perform chk(before = 13,
    'and the person browsing beside it is not affected at all');

  perform public.site_beat('sess-aaaaaaa', 'mobile');
  perform public.site_beat('sess-aaaaaaa', 'desktop');
  perform chk((select count(*) from public.site_presence) = 1,
    'a visit that beats twice is one row, not two');
  perform chk((select device from public.site_presence where session = 'sess-aaaaaaa') = 'desktop',
    'and the later beat is the one that counts');

  delete from public.site_events;
  delete from public.site_presence;
end $$;


select hdr('Orders and sales, which is what all the counting was for');
-- E-1. The count stopped at "checkout begun", so the shop could see twelve
-- people set off and never learn whether any of them finished. Counted from
-- the orders table rather than recorded in the browser, so no ad blocker can
-- hide one and a refreshed thank-you page cannot count one twice.
--
-- THE FIRST CHECK IS THE IMPORTANT ONE. This fixture has no orders table at
-- all -- it is the analytics schema on its own -- and site_stats must still
-- answer with every other figure intact. A shop whose orders table is absent,
-- renamed or refused must not lose its visits over it.
do $$
declare d jsonb;
begin
  -- Earlier sections clear the events, so this one puts back something to
  -- count -- otherwise "nothing else moved" would pass by being nought.
  insert into public.site_events (at, kind, path, visitor, session, device)
  select now() - interval '1 day', 'page_view', '/shop', 'ord-v1', 'ord-s1', 'mobile'
    from generate_series(1, 3);

  perform be('owner');
  d := public.site_stats(current_date - 2, current_date, 'UTC')::jsonb;
  perform chk(d is not null, 'with no orders table at all, the figures still come back');
  perform chk((d->>'page_views')::int > 0,
              'and the page views are still there, unaffected');
  perform chk(coalesce(d->>'orders', 'missing') = '0',
              'with orders shown as none rather than an error');
  perform chk(coalesce(d->>'sales', 'missing') = '0', 'and sales as nothing');
end $$;

-- And now with one, which is the shop's real case.
do $$
declare d jsonb;
begin
  create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    total numeric, currency text, status text default 'pending',
    created_at timestamptz default now());

  insert into public.orders (total, currency, status, created_at) values
    (1500, 'ZMW', 'confirmed', now() - interval '1 day'),
    (2500, 'ZMW', 'pending',   now() - interval '1 day'),
    ( 900, 'ZMW', 'cancelled', now() - interval '1 day'),
    (7000, 'ZMW', 'confirmed', now() - interval '40 days');

  perform be('owner');
  d := public.site_stats(current_date - 2, current_date, 'UTC')::jsonb;
  perform chk((d->>'orders')::int = 2,
              'two orders in the range, the cancelled one left out (' || (d->>'orders') || ')');
  perform chk((d->>'sales')::numeric = 4000,
              'and their total is what they came to (' || (d->>'sales') || ')');
  perform chk(d->>'currency' = 'ZMW', 'in the currency they were taken in');
  perform chk((d->>'page_views')::int > 0, 'and nothing else moved');

  d := public.site_stats(current_date - 60, current_date, 'UTC')::jsonb;
  perform chk((d->>'orders')::int = 3,
              'a wider range reaches the older one too (' || (d->>'orders') || ')');

  drop table public.orders;
end $$;

-- The report, in the order the checks were made.


select hdr('Starting the count again — and what that must not touch');
do $$
declare
  before_events int;
  before_rows   int;
  said          json;
  was_role      text;
begin
  -- Something to clear, and something that must survive it.
  perform public.site_beat('s-clear-1', 'mobile');
  insert into public.site_events (kind, path, session, visitor, device)
    values ('page_view', '/', 's-clear-1', 'v-clear-1', 'mobile'),
           ('product_view', '/product/X', 's-clear-1', 'v-clear-1', 'mobile');
  perform public.site_rollup(current_date - 1, 'UTC');

  select count(*) into before_events from public.site_events;
  select count(*) into before_rows   from public.site_settings;
  perform chk(before_events > 0, 'there is traffic on file to clear');
  perform chk(before_rows  > 0, 'and settings beside it that are not traffic');

  -- An administrator who is not the owner is refused. Reading the
  -- analytics is a right a role can be given; destroying them is not.
  select role into was_role from public.admins where id = auth.uid();
  update public.admins set role = 'full' where id = auth.uid();
  begin
    perform public.site_clear();
    perform chk(false, 'an administrator who is not the owner is refused');
  exception when others then
    perform chk(sqlerrm like '%owner%', 'an administrator who is not the owner is refused');
  end;
  perform chk((select count(*) from public.site_events) = before_events,
              'and nothing of theirs was removed on the way to being told no');

  -- The owner may.
  update public.admins set role = 'owner' where id = auth.uid();
  said := public.site_clear();
  perform chk((said->>'events')::int = before_events,
              'the owner may, and is told how much went');
  perform chk((select count(*) from public.site_events) = 0, 'the raw rows are gone');
  perform chk((select count(*) from public.site_daily) = 0, 'so are the summaries');
  perform chk((select count(*) from public.site_visitor_days) = 0, 'and who was seen when');
  perform chk((select count(*) from public.site_presence) = 0, 'and who was here now');

  -- THE ONE THAT MATTERS MOST. This clears traffic. A shop reaching for
  -- it is tidying up its own test visits, and must not find it has
  -- tidied away anything it actually sells or anybody it sold to.
  perform chk((select count(*) from public.site_settings) = before_rows,
              'while every setting the shop had saved is untouched');

  -- Emptied, not dropped: recording carries on with nothing re-run.
  insert into public.site_events (kind, path, session, visitor, device)
    values ('page_view', '/', 's-clear-2', 'v-clear-2', 'desktop');
  perform chk((select count(*) from public.site_events) = 1,
              'and the very next visitor is counted, with nothing to set up again');

  update public.admins set role = was_role where id = auth.uid();
end $$;

select case
         when ok is null then E'\n' || what
         when ok        then '  ✓ ' || what
         else                '  ✗ ' || what
       end as line
  from checks order by n;

select E'\n' || case when count(*) filter (where ok is false) = 0
            then 'analytics database: all ' || count(*) filter (where ok is not null) || ' checks passed'
            else count(*) filter (where ok is not null) || ' checks, '
                 || count(*) filter (where ok is false) || ' FAILED'
       end as line
  from checks;

-- Makes the script exit non-zero when anything failed, so it can be run from
-- something that cares about the answer. Written as a division rather than a
-- CASE holding one, because Postgres folds a constant 1/0 while it is still
-- planning the query and the script would then fail even when nothing had.
select 1 / (count(*) filter (where ok is false) = 0)::int as all_passed
  from checks;
