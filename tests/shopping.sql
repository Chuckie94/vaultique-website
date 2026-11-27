-- ===========================================================================
-- SHOPPING, THE DATABASE SIDE, CHECKED (website build 90)
--
-- Load, in this order, into an empty database (tools/sql-tests.sh, chain
-- "shopping"): tests/pos-orders-fixture.sql, supabase-setup.sql,
-- supabase-payments.sql, tests/pos-orders-admins.sql, supabase-rewards.sql,
-- supabase-pos-orders.sql, supabase-payment-history.sql,
-- tests/order-progress-fixture.sql, supabase-order-progress.sql,
-- supabase-online-refund.sql, then supabase-shopping.sql twice (it is safe
-- to run again), then this file.
--
-- A review of a piece: from a customer who bought it, once, marked; from
-- anyone else only while the shop lets anyone. Alerts: the customer's own,
-- with the account's own address. A gift list: the link shows the pieces and
-- a first name, nothing more, until it is stopped. Preferences: small. The
-- policies' order: in one step, for a sign-in that may change policies.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon, authenticated, service_role;
grant usage on sequence checks_n_seq to anon, authenticated, service_role;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;
create or replace function err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return ''; exception when others then return sqlerrm; end $$;
grant execute on function err(text) to public;
create or replace function who(p uuid) returns void language plpgsql security definer as $$
begin delete from auth.whoami; if p is not null then insert into auth.whoami values (p); end if; end $$;
grant execute on function who(uuid) to public;
-- Counts as whoever is asking, so the tables' own rules apply.
create or replace function n_of(p_sql text) returns bigint language plpgsql security invoker as $$
declare v bigint; begin execute p_sql into v; return v; end $$;
grant execute on function n_of(text) to public;

-- Two customers and the owner.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'buyer@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'browser@example.com'),
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.test') on conflict do nothing;
insert into public.customers (id, name, phone, wishlist) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Chanda Banda', '0977000001', '["LS-1","SC-2"]'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Mwila Phiri', '0977000002', '[]'::jsonb) on conflict do nothing;
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict (id) do nothing;

-- The buyer's orders: LS-1 delivered; SC-2 on an order still pending; HT-3 on a
-- cancelled one; BG-4 rung up at the till.
insert into public.orders (id, ref, customer_id, name, phone, total, currency, status, fulfilment, created_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'VB-SHP01', 'aaaaaaaa-0000-0000-0000-000000000001', 'Chanda Banda', '0977000001', 500, 'ZMW', 'delivered', 'delivery', now() - interval '9 days'),
  ('cccccccc-0000-0000-0000-000000000002', 'VB-SHP02', 'aaaaaaaa-0000-0000-0000-000000000001', 'Chanda Banda', '0977000001', 250, 'ZMW', 'pending', 'delivery', now() - interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000003', 'VB-SHP03', 'aaaaaaaa-0000-0000-0000-000000000001', 'Chanda Banda', '0977000001', 300, 'ZMW', 'cancelled', 'delivery', now() - interval '5 days'),
  ('cccccccc-0000-0000-0000-000000000004', 'VB-SHP04', 'aaaaaaaa-0000-0000-0000-000000000001', 'Chanda Banda', '0977000001', 800, 'ZMW', 'confirmed', 'collection', now() - interval '4 days');
update public.orders set pos_sale_id = 'S-9001' where ref = 'VB-SHP04';
insert into public.order_items (order_id, sku, name, price, qty) values
  ('cccccccc-0000-0000-0000-000000000001', 'LS-1', 'Leather Satchel', 500, 1),
  ('cccccccc-0000-0000-0000-000000000002', 'SC-2', 'Silk Scarf', 250, 1),
  ('cccccccc-0000-0000-0000-000000000003', 'HT-3', 'Straw Hat', 300, 1),
  ('cccccccc-0000-0000-0000-000000000004', 'BG-4', 'Beaded Bag', 800, 1);

-- 1) THE FILE, RUN TWICE -------------------------------------------------------------------
select chk(to_regclass('public.product_alerts') is not null and to_regclass('public.product_questions') is not null
       and to_regclass('public.gift_lists') is not null and to_regclass('public.review_owners') is not null
       and (select count(*) from pg_constraint where conname in ('product_alerts_shape', 'product_questions_sizes',
            'gift_lists_shape', 'customers_preferences_shape')) = 4,
       'run twice: the four tables and their limits, once each');
select chk((select count(*) from public.orders where ref like 'VB-SHP%') = 4 and (select count(*) from public.reviews) = 0,
       'nothing already there is changed');

-- 2) REVIEWS FROM BUYERS ---------------------------------------------------------------------
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk((public.review_can('LS-1')) ->> 'can' = 'true' and (public.review_can('BG-4')) ->> 'can' = 'true',
       'bought: delivered (LS-1), or rung up at the till (BG-4)');
select chk((public.review_can('SC-2')) ->> 'why' = 'not_bought' and (public.review_can('HT-3')) ->> 'why' = 'not_bought'
       and (public.review_can('ZZ-9')) ->> 'why' = 'not_bought',
       'not bought: still pending (SC-2), cancelled (HT-3), never ordered');
select chk((public.review_by_buyer('LS-1', 5, 'Beautiful leather.', '')) ->> 'ok' = 'true', 'the buyer reviews LS-1');
reset role;
select chk((select verified from public.reviews where sku = 'LS-1') = true
       and (select name from public.reviews where sku = 'LS-1') = 'Chanda'
       and (select count(*) from public.review_owners where sku = 'LS-1' and customer_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1,
       'marked verified, under their first name, and whose it is kept apart');
set role authenticated;
select chk((public.review_by_buyer('LS-1', 4, 'Again', 'C')) ->> 'why' = 'already' and (public.review_can('LS-1')) ->> 'why' = 'already',
       'once for each piece');
select chk((public.review_by_buyer('SC-2', 5, 'Lovely', 'C')) ->> 'why' = 'not_bought'
       and (public.review_by_buyer('BG-4', 9, 'x', 'C')) ->> 'why' = 'unreadable'
       and (public.review_by_buyer('BG-4', 5, repeat('x', 1001), 'C')) ->> 'why' = 'too_long',
       'not bought, a rating out of 1 to 5, or too long: refused');
reset role;
select who('aaaaaaaa-0000-0000-0000-000000000002');
set role authenticated;
select chk((public.review_by_buyer('LS-1', 5, 'Looks nice', 'M')) ->> 'why' = 'not_bought', 'another customer who did not buy it: refused');
reset role;
select who(null);
set role anon;
select chk(not has_function_privilege('anon', 'public.review_can(text)', 'execute')
       and not has_function_privilege('anon', 'public.review_by_buyer(text, integer, text, text)', 'execute'),
       'signed out: neither the question nor the buyer''s door is open');
-- Straight from a browser: a piece only while anyone may review; the shop as before.
select chk(err($$insert into public.reviews (sku, name, rating, comment, approved) values ('LS-1', 'Anon', 5, 'Hi', false)$$) <> '',
       'a visitor''s review of a piece, while only buyers may: refused');
select chk(err($$insert into public.reviews (sku, name, rating, comment, approved) values (null, 'Anon', 5, 'Good shop', false)$$) = '',
       'a review of the whole shop: as before');
reset role;
insert into public.site_settings (key, data) values ('reviews', '{"whoReviews":"anyone"}'::jsonb)
on conflict (key) do update set data = public.site_settings.data || '{"whoReviews":"anyone"}'::jsonb;
set role anon;
select chk(err($$insert into public.reviews (sku, name, rating, comment, approved) values ('LS-1', 'Anon', 5, 'Hi', false)$$) = ''
       and err($$insert into public.reviews (sku, name, rating, comment, approved, verified) values ('LS-1', 'Anon', 5, 'Hi', false, true)$$) <> '',
       'Settings > Reviews "anyone": a visitor may review a piece again, but never arrive marked verified');
reset role;
update public.site_settings set data = data - 'whoReviews' where key = 'reviews';

-- 3) QUESTIONS AND ANSWERS -------------------------------------------------------------------
insert into public.product_questions (sku, question, answer, published) values
  ('LS-1', 'Does it fit a laptop?', 'Yes, up to 14 inches.', true),
  ('LS-1', 'Is it waterproof?', 'Not yet answered publicly.', false);
set role anon;
select chk(n_of($$select count(*) from public.product_questions$$) = 1, 'a visitor reads only the published answers');
select chk(err($$insert into public.product_questions (sku, question, answer) values ('LS-1', 'Spam?', 'Yes')$$) <> ''
       and err($$update public.product_questions set answer = 'changed'$$) = ''
       and n_of($$select count(*) from public.product_questions where answer = 'changed'$$) = 0,
       'and cannot write one or change one');
reset role;
select chk(err($$insert into public.product_questions (sku, question, answer) values ('LS-1', 'x', 'y')$$) <> '',
       'a question of fewer than three letters is refused, even by the shop');

-- 4) PRODUCT ALERTS --------------------------------------------------------------------------
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk((public.alert_set('SC-2', 'back', 'Silk Scarf', null)) ->> 'ok' = 'true'
       and (public.alert_set('LS-1', 'price', 'Leather Satchel', 500)) ->> 'ok' = 'true',
       'back in stock, and a price drop from 500');
select chk((public.alert_set('LS-1', 'price', 'Leather Satchel', null)) ->> 'why' = 'no_price'
       and (public.alert_set('LS-1', 'soon', 'x', 1)) ->> 'why' = 'unreadable',
       'a price drop needs the price; only the two kinds');
select chk(n_of($$select count(*) from public.product_alerts$$) = 2
       and n_of($$select count(*) from public.product_alerts where email = 'buyer@example.com'$$) = 2,
       'the customer sees their own, with their account''s own address');
select chk(err($$insert into public.product_alerts (customer_id, email, sku, kind) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x@y.z', 'A', 'back')$$) <> ''
       and err($$update public.product_alerts set email = 'other@example.com'$$) <> '',
       'and cannot write one directly, or change the address');
reset role;
update public.product_alerts set sent_at = now(), sent_price = 450 where sku = 'LS-1';
set role authenticated;
select chk((public.alert_set('LS-1', 'price', 'Leather Satchel', 450)) ->> 'ok' = 'true', 'asked again after it was sent');
reset role;
select chk((select sent_at is null and price_at = 450 from public.product_alerts where sku = 'LS-1' and kind = 'price')
       and (select count(*) from public.product_alerts where sku = 'LS-1') = 1,
       'waiting again, from the new price, one row');
select who('aaaaaaaa-0000-0000-0000-000000000002');
set role authenticated;
select chk(n_of($$select count(*) from public.product_alerts$$) = 0
       and err($$delete from public.product_alerts$$) = ''
       and (select count(*) from public.product_alerts) = 0, 'another customer sees none of them');
reset role;
select chk((select count(*) from public.product_alerts) = 2, 'and deleted none');
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk(err($$delete from public.product_alerts where sku = 'SC-2'$$) = '', 'the customer stops one of their own');
reset role;
select chk((select count(*) from public.product_alerts) = 1, 'gone');
select who(null);
set role anon;
select chk(err($$select public.alert_set('SC-2', 'back', 'x', null)$$) <> '', 'signed out: no alert');
reset role;

-- 5) GIFT LISTS ------------------------------------------------------------------------------
create temp table g (r jsonb);
grant all on g to public;
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into g select public.gift_list_share('Chanda''s birthday', 'Any of these!');
reset role;
select who(null);
select chk((select (r ->> 'ok') = 'true' and char_length(r ->> 'token') = 64 from g), 'shared: a link with a 64-character key');
set role anon;
select chk((select (public.gift_list_get(r ->> 'token')) ->> 'firstName' from g) = 'Chanda'
       and (select (public.gift_list_get(r ->> 'token')) -> 'skus' from g) = '["LS-1","SC-2"]'::jsonb
       and (select (public.gift_list_get(r ->> 'token')) ->> 'title' from g) = 'Chanda''s birthday',
       'anyone with the link: the first name, the title and the pieces');
select chk((select (public.gift_list_get(r ->> 'token'))::text from g) !~ '(Banda|0977|buyer@)',
       'never the last name, the phone or the email');
select chk((public.gift_list_get('not-a-real-key-at-all-000000000')) ->> 'why' = 'not_found'
       and (public.gift_list_get('<script>')) ->> 'why' = 'not_found', 'a wrong key: nothing');
select chk(n_of($$select count(*) from public.gift_lists$$) = 0, 'visitors cannot list the gift lists');
reset role;
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk((select (public.gift_list_share('New title', null)) ->> 'token' = (r ->> 'token') from g),
       'shared again: the same link, the title changed');
select chk((public.gift_list_stop()) ->> 'ok' = 'true', 'stopped');
reset role;
set role anon;
select chk((select (public.gift_list_get(r ->> 'token')) ->> 'why' from g) = 'not_found', 'the old link shows nothing');
reset role;

-- 6) SHOPPING PREFERENCES --------------------------------------------------------------------
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk(err($$update public.customers set preferences = '{"sizes":["M","L"],"categories":["Bags"]}'::jsonb where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) = '',
       'the customer saves their sizes and categories');
select chk(err($$update public.customers set preferences = jsonb_build_object('sizes', to_jsonb(array_fill('XXXXXXXX'::text, array[400]))) where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) <> ''
       and err($$update public.customers set preferences = '"just text"'::jsonb where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) <> '',
       'but nothing large, and nothing but an object');
reset role;
select chk((select preferences -> 'sizes' from public.customers where id = 'aaaaaaaa-0000-0000-0000-000000000001') = '["M","L"]'::jsonb,
       'kept as saved');

-- 7) THE POLICIES' ORDER ---------------------------------------------------------------------
delete from public.policies;
insert into public.policies (id, section, title, body, sort) values
  ('dddddddd-0000-0000-0000-000000000001', 'A', 'One', '', 10),
  ('dddddddd-0000-0000-0000-000000000002', 'A', 'Two', '', 20),
  ('dddddddd-0000-0000-0000-000000000003', 'A', 'Three', '', 30);
select who('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((public.policies_set_order(array['dddddddd-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
                                            'dddddddd-0000-0000-0000-000000000002']::uuid[])) ->> 'changed' = '3',
       'the owner: the whole order in one step');
reset role;
select chk((select string_agg(title || ':' || sort, ' ' order by sort) from public.policies) = 'Three:10 One:20 Two:30',
       'numbered 10, 20, 30 in that order');
set role authenticated;
select chk((public.policies_set_order(array['dddddddd-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001']::uuid[])) ->> 'why' = 'stale'
       and (public.policies_set_order(array['dddddddd-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003',
                                            'dddddddd-0000-0000-0000-000000000001']::uuid[])) ->> 'why' = 'stale',
       'a list missing one, or naming one twice: refused, nothing guessed');
reset role;
select who('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select chk((public.policies_set_order(array['dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002',
                                            'dddddddd-0000-0000-0000-000000000003']::uuid[])) ->> 'why' = 'not_allowed',
       'a customer: not allowed');
reset role;
select chk((select string_agg(title, ' ' order by sort) from public.policies) = 'Three One Two', 'the order as the owner left it');
select who(null);

-- 8) NOTHING ELSE OPEN -------------------------------------------------------------------------
select chk(not has_function_privilege('anon', 'public.policies_set_order(uuid[])', 'execute')
       and not has_function_privilege('anon', 'public.alert_set(text, text, text, numeric)', 'execute')
       and not has_function_privilege('anon', 'public.gift_list_share(text, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.shop_bought(uuid, text)', 'execute')
       and has_function_privilege('anon', 'public.gift_list_get(text)', 'execute')
       and has_function_privilege('anon', 'public.reviews_open_to_all()', 'execute'),
       'visitors: the gift list link and the review rule only');
set role anon;
select chk(err($$select * from public.review_owners$$) <> '' or n_of($$select count(*) from public.review_owners$$) = 0,
       'whose review is whose: nobody reads it');
reset role;

-- The result ------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   shopping database: all ' || count(*) || ' checks passed'
            else '   shopping database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
