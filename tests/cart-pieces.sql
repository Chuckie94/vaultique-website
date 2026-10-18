-- ===========================================================================
-- WHICH PIECES WERE ADDED TO CARTS -- the database half
--
--   psql -f tests/analytics-fixture.sql -f supabase-analytics.sql \
--        -f supabase-cart-pieces.sql -f tests/cart-pieces.sql
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temp table cp (n serial, ok boolean, what text);
grant all on cp to public; grant all on sequence cp_n_seq to public;

-- Today: the tote added three times by two people, viewed five times; the
-- belt added once; the scarf only viewed (and viewed a lot); a page view.
insert into public.site_events (kind, path, visitor, session, device, sku, label) values
  ('product_view', '/product/BG-1', 'v1', 's1', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('product_view', '/product/BG-1', 'v2', 's2', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('product_view', '/product/BG-1', 'v3', 's3', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('product_view', '/product/BG-1', 'v1', 's1', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('product_view', '/product/BG-1', 'v2', 's2', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('add_to_cart',  '/product/BG-1', 'v1', 's1', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('add_to_cart',  '/product/BG-1', 'v1', 's1', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('add_to_cart',  '/product/BG-1', 'v2', 's2', 'mobile', 'BG-1', 'Crossbody Tote Sling'),
  ('add_to_cart',  '/shop',         'v3', 's3', 'mobile', 'AC-2', 'Heritage Suede Belt'),
  ('product_view', '/product/AC-9', 'v1', 's1', 'mobile', 'AC-9', 'Silk Scarf'),
  ('product_view', '/product/AC-9', 'v2', 's2', 'mobile', 'AC-9', 'Silk Scarf'),
  ('product_view', '/product/AC-9', 'v3', 's3', 'mobile', 'AC-9', 'Silk Scarf'),
  ('page_view',    '/',             'v1', 's1', 'mobile', null, null);
-- Last week: something added that today's range must leave out.
insert into public.site_events (kind, path, visitor, session, device, sku, label, at) values
  ('add_to_cart', '/product/OLD-1', 'v9', 's9', 'mobile', 'OLD-1', 'Last Week Piece', now() - interval '9 days');

delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
create temp table r as select public.site_cart_products(current_date, current_date, 'UTC', 20)::jsonb as j;
reset role;

insert into cp (ok, what) values
  ((select jsonb_array_length(j) = 2 from r), 'only the pieces added to a cart: the tote and the belt, not the scarf that was only viewed'),
  ((select j->0->>'sku' = 'BG-1' and (j->0->>'carts')::int = 3 and (j->0->>'people')::int = 2 and (j->0->>'views')::int = 5 from r),
   'the tote first: added 3 times, by 2 people, viewed 5 times'),
  ((select j->0->>'label' = 'Crossbody Tote Sling' and (j->0->>'last_at') is not null from r), 'by its name, with when it was last added'),
  ((select j->1->>'sku' = 'AC-2' and (j->1->>'carts')::int = 1 and (j->1->>'views')::int = 0 from r),
   'the belt, added from the shop page without its own page being opened'),
  ((select not (j::text like '%OLD-1%') from r), 'nothing from outside the dates asked for');

-- Nobody but those who may see the analytics.
delete from auth.whoami;
insert into auth.whoami values ('00000000-0000-0000-0000-000000000000');
set role authenticated;
do $$ begin
  begin
    perform public.site_cart_products(current_date, current_date, 'UTC', 20);
    insert into cp (ok, what) values (false, 'a stranger is refused');
  exception when others then
    insert into cp (ok, what) values (true, 'a stranger is refused');
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.site_cart_products(current_date, current_date, 'UTC', 20);
    insert into cp (ok, what) values (false, 'and the shop front cannot ask at all');
  exception when others then
    insert into cp (ok, what) values (true, 'and the shop front cannot ask at all');
  end;
end $$;
reset role;

select n, case when ok then '  ✓ ' else '  ✗ ' end || what as result from cp order by n;
select case when bool_and(ok) then '  which pieces were added to carts: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end as summary from cp;
