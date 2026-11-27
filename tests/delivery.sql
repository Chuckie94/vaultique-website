-- ===========================================================================
-- DELIVERY, THE DATABASE SIDE, CHECKED (website build 89)
--
-- Load, in this order, into an empty database (tools/sql-tests.sh, chain
-- "delivery"): tests/pos-orders-fixture.sql, supabase-setup.sql,
-- supabase-payments.sql, tests/pos-orders-admins.sql, supabase-rewards.sql,
-- supabase-pos-orders.sql, supabase-payment-history.sql,
-- tests/order-progress-fixture.sql, supabase-order-progress.sql, then
-- supabase-delivery.sql twice (it is safe to run again), then this file.
--
-- The customer changes their own instructions, on their own order, until it
-- is on its way; the platform records the courier and tracking number with
-- the door's key, an administrator with the orders permission; nobody else,
-- and nobody by writing the table directly. The private link shows the
-- courier and tracking, never the instructions.
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

update public.pos_door_key set fingerprint = sha256(convert_to('k508-0123456789abcdef0123456789abcdef', 'UTF8'));
create or replace function k() returns text language sql immutable as $$ select 'k508-0123456789abcdef0123456789abcdef' $$;
grant execute on function k() to public;
create or replace function who(p uuid) returns void language plpgsql security definer as $$
begin delete from auth.whoami; if p is not null then insert into auth.whoami values (p); end if; end $$;
grant execute on function who(uuid) to public;
create or replace function ord(p_ref text) returns public.orders language sql security definer as $$
  select * from public.orders where ref = p_ref $$;
grant execute on function ord(text) to public;
create or replace function oid_of(p_ref text) returns uuid language sql security definer as $$
  select id from public.orders where ref = p_ref $$;
grant execute on function oid_of(text) to public;

insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict (id) do nothing;

-- 1) THE FILE, RUN TWICE -----------------------------------------------------------------
select chk((select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'orders'
               and column_name in ('delivery_instructions', 'instructions_at', 'instructions_told_at', 'ship_courier',
                                   'ship_tracking', 'ship_tracking_url', 'ship_updates', 'ship_set_at', 'ship_mailed_at')) = 9
       and (select count(*) from pg_trigger where tgname = 'orders_delivery_guard_t') = 1,
       'run twice: the nine columns, and one guard');
select chk((select ord('VB-PRE01')).delivery_instructions is null and (select ord('VB-PRE02')).ship_courier is null
       and (select ord('VB-PRE01')).status = 'confirmed' and (select ord('VB-PRE02')).status = 'completed',
       'orders already there are left exactly as they were');
select chk(has_function_privilege('authenticated', 'public.order_set_instructions(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.order_set_instructions(uuid, text)', 'execute')
       and has_function_privilege('authenticated', 'public.order_shipping_admin(uuid, text, text, text, text)', 'execute')
       and not has_function_privilege('anon', 'public.order_shipping_admin(uuid, text, text, text, text)', 'execute'),
       'the customer''s button and the admin''s need somebody signed in');
select chk(not has_function_privilege('authenticated', 'public.order_ship_set(uuid, text, text, text, text)', 'execute')
       and not has_function_privilege('anon', 'public.order_ship_set(uuid, text, text, text, text)', 'execute')
       and not has_function_privilege('anon', 'public.delivery_text(text, integer)', 'execute'),
       'the part that writes the courier cannot be called from outside');
select chk(has_function_privilege('anon', 'public.vbp_pos_order_shipping(text, text, text, text, text, text)', 'execute'),
       'the platform''s door is knocked on with the public key (the door''s own key opens it)');

-- 2) THE ORDERS --------------------------------------------------------------------------
set role service_role;
insert into public.orders (id, ref, customer_id, name, phone, email, address, total, currency, status, fulfilment, created_at)
values ('dddddddd-0000-0000-0000-000000000011', 'VB-DLV01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001',
        'buyer@shop.test', 'Plot 9, Lusaka', 2000, 'ZMW', 'pending', 'delivery', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000012', 'VB-DLC01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001',
        'buyer@shop.test', null, 900, 'ZMW', 'pending', 'collection', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000013', 'VB-DLX01', '33333333-3333-3333-3333-333333333333', 'Other Buyer', '0970000003',
        'other@shop.test', 'Plot 3, Kitwe', 500, 'ZMW', 'pending', 'delivery', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000014', 'VB-DLW01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001',
        'buyer@shop.test', 'Plot 9, Lusaka', 700, 'ZMW', 'pending', 'delivery', now() - interval '2 hours'),
       ('dddddddd-0000-0000-0000-000000000015', 'VB-DLK01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001',
        'buyer@shop.test', 'Plot 9, Lusaka', 300, 'ZMW', 'cancelled', 'delivery', now() - interval '3 hours');
-- What the website's server does at checkout: the instructions with the order.
select chk(err($q$update public.orders set delivery_instructions = 'Blue gate, call on arrival', instructions_at = now(),
                     instructions_told_at = now() where ref = 'VB-DLV01'$q$) = '',
       'the website''s server (the service key) writes the instructions given at checkout');
reset role;

-- 3) THE CUSTOMER'S INSTRUCTIONS ------------------------------------------------------------
select who(null);
set role anon;
select chk(err($q$select public.order_set_instructions('dddddddd-0000-0000-0000-000000000011', 'x')$q$) like '%permission denied%',
       'nobody signed in cannot even ask');
reset role;
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.order_set_instructions(oid_of('VB-DLV01'), '  Green gate,
    ask for Mary  ')) ->> 'instructions' = 'Green gate, ask for Mary',
       'the customer changes their own: kept on one line, trimmed');
reset role;
select chk((select ord('VB-DLV01')).delivery_instructions = 'Green gate, ask for Mary'
       and (select ord('VB-DLV01')).instructions_at > (select ord('VB-DLV01')).instructions_told_at,
       'and the change is newer than the shop was told of: the 15-minute check will tell it');
set role authenticated;
select chk((public.order_set_instructions(oid_of('VB-DLV01'), 'Green gate, ask for Mary')) ->> 'again' = 'true',
       'the same words again change nothing');
select chk((public.order_set_instructions(oid_of('VB-DLV01'), repeat('x', 301))) ->> 'why' = 'too_long'
       and (public.order_set_instructions(oid_of('VB-DLC01'), 'At the door')) ->> 'why' = 'collection'
       and (public.order_set_instructions(oid_of('VB-DLX01'), 'Mine now')) ->> 'why' = 'not_found'
       and (public.order_set_instructions(oid_of('VB-DLK01'), 'Too late')) ->> 'why' = 'cancelled',
       'too long, an order being collected, somebody else''s order, a cancelled one: each refused and named');
select chk((public.order_set_instructions(oid_of('VB-DLW01'), '')) ->> 'ok' = 'true',
       'empty words clear them');
reset role;
select chk((select ord('VB-DLX01')).delivery_instructions is null and (select ord('VB-DLW01')).delivery_instructions is null,
       'nothing written on the other customer''s order');
set role authenticated;
select err($q$update public.orders set delivery_instructions = 'Typed into the table' where ref = 'VB-DLV01'$q$);
reset role;
select chk((select ord('VB-DLV01')).delivery_instructions = 'Green gate, ask for Mary',
       'a customer writing the table directly: nothing changes');

-- 4) THE COURIER AND THE TRACKING NUMBER: THE PLATFORM'S DOOR ---------------------------------
-- The till rings VB-DLV01 up, still to go (Preparing); then it goes out.
set role service_role;
update public.orders set pos_sale_id = 'S-DLV-1', pos_receipt_no = 'R-DLV-1', pos_invoice_no = 'INV-DLV-1',
       pos_completed_at = now(), status = 'confirmed' where ref = 'VB-DLV01';
reset role;
set role anon;
select chk((public.vbp_pos_order_shipping('not-the-key', 'VB-DLV01', 'Yango', 'YG12345')) ->> 'why' = 'refused',
       'the door without its key: refused');
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLX01', 'Yango', 'YG12345')) ->> 'why' = 'not_rung_up',
       'an order the till has not rung up: not yet');
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLV01', 'Zampost', 'ZP 778/19',
                                          'https://track.zampost.example/?n=ZP778-19', 'Handed to Zampost in Lusaka')) ->> 'ok' = 'true',
       'the platform records the courier, the tracking number, its link and an update');
reset role;
select chk((select ord('VB-DLV01')).ship_courier = 'Zampost' and (select ord('VB-DLV01')).ship_tracking = 'ZP 778/19'
       and (select ord('VB-DLV01')).ship_tracking_url = 'https://track.zampost.example/?n=ZP778-19'
       and jsonb_array_length((select ord('VB-DLV01')).ship_updates) = 1
       and (select ord('VB-DLV01')).ship_set_at is not null,
       'all kept on the order, with when they were set');
set role anon;
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLV01', null, null, 'javascript:alert(1)')) ->> 'why' = 'bad_link'
       and (public.vbp_pos_order_shipping(k(), 'VB-DLV01', null, null, 'http://track.example/1')) ->> 'why' = 'bad_link'
       and (public.vbp_pos_order_shipping(k(), 'VB-DLV01', null, null, 'https://track.example/"><script>')) ->> 'why' = 'bad_link',
       'a link that is not a plain https page (a script, plain http, markup in it): refused');
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLV01', null, '<b>x</b>')) ->> 'why' = 'bad_tracking'
       and (public.vbp_pos_order_shipping(k(), 'VB-DLV01', repeat('c', 61))) ->> 'why' = 'too_long',
       'a tracking number with markup in it, a courier''s name too long: refused');
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLV01', 'Zampost', 'ZP 778/19')) ->> 'again' = 'true',
       'the same again changes nothing');
reset role;
select chk((select ord('VB-DLV01')).ship_tracking_url = 'https://track.zampost.example/?n=ZP778-19',
       'and the refused ones changed nothing');
set role anon;
-- Twenty-two updates: the newest twenty kept.
select count(*) from generate_series(1, 22) g, lateral public.vbp_pos_order_shipping(k(), 'VB-DLV01', null, null, null, 'Update ' || g) x;
reset role;
select chk(jsonb_array_length((select ord('VB-DLV01')).ship_updates) = 20
       and (select ord('VB-DLV01')).ship_updates -> 19 ->> 'text' = 'Update 22'
       and (select ord('VB-DLV01')).ship_updates -> 0 ->> 'text' = 'Update 3',
       'updates: the newest twenty kept, in order');
set role anon;
select chk((public.vbp_pos_order_shipping(k(), 'VB-DLV01', '', '', '')) ->> 'ok' = 'true',
       'empty words clear the courier, the number and the link');
reset role;
select chk((select ord('VB-DLV01')).ship_courier is null and (select ord('VB-DLV01')).ship_tracking is null
       and (select ord('VB-DLV01')).ship_tracking_url is null and jsonb_array_length((select ord('VB-DLV01')).ship_updates) = 20,
       'cleared, the updates kept');

-- 5) THE ADMIN ------------------------------------------------------------------------------
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.order_shipping_admin(oid_of('VB-DLV01'), 'Yango', 'YG1')) ->> 'why' = 'not_allowed',
       'a customer is not an administrator');
reset role;
select who('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((public.order_shipping_admin(oid_of('VB-DLV01'), 'Yango Delivery', 'YG-55091', 'https://yango.example/t/YG-55091')) ->> 'ok' = 'true',
       'an administrator records them in Admin > Orders');
select chk((public.order_shipping_admin(oid_of('VB-DLW01'), 'Yango', 'YG1')) ->> 'why' = 'not_confirmed'
       and (public.order_shipping_admin(oid_of('VB-DLC01'), 'Yango', 'YG1')) ->> 'why' = 'not_delivery'
       and (public.order_shipping_admin(oid_of('VB-DLK01'), 'Yango', 'YG1')) ->> 'why' = 'cancelled',
       'not before the shop has confirmed it, never for collection, never on a cancelled order');
select chk(err($q$update public.orders set ship_courier = 'Typed in' where ref = 'VB-DLV01'$q$) like '%set by the website and the platform only%',
       'even an administrator writing the table directly: refused (Admin > Orders uses its function)');
reset role;

-- 6) WHAT THE PLATFORM AND THE PRIVATE LINK SEE -----------------------------------------------
select chk((public.pos_order_out(oid_of('VB-DLV01'), false) -> 'delivery' ->> 'instructions') = 'Green gate, ask for Mary'
       and (public.pos_order_out(oid_of('VB-DLV01'), false) -> 'delivery' ->> 'courier') = 'Yango Delivery'
       and (public.pos_order_out(oid_of('VB-DLV01'), false) -> 'delivery' ->> 'tracking') = 'YG-55091',
       'the platform''s door hands out the instructions, the courier and the number, for the till');
select chk((public.order_progress_out(oid_of('VB-DLV01')) -> 'ship' ->> 'courier') = 'Yango Delivery'
       and (public.order_progress_out(oid_of('VB-DLV01')) -> 'ship' ->> 'url') = 'https://yango.example/t/YG-55091'
       and (public.order_progress_out(oid_of('VB-DLV01'))::text not like '%Green gate%'),
       'an order''s progress (the private link) carries the courier and tracking, never the instructions');
select chk(public.order_progress_out(oid_of('VB-DLX01')) -> 'ship' = 'null'::jsonb
       and (public.pos_order_out(oid_of('VB-DLX01'), false) -> 'delivery' ->> 'courier') is null,
       'an order with nothing recorded says nothing');
-- On its way: then the customer can no longer change the instructions.
set role anon;
select (public.vbp_pos_order_progress(k(), 'VB-DLV01', 'dispatched', 'Going out today', '{}'::jsonb)) ->> 'ok';
reset role;
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.order_set_instructions(oid_of('VB-DLV01'), 'Back gate instead')) ->> 'why' = 'on_its_way',
       'once it is on its way, the instructions stay as the courier has them');
reset role;
select who(null);

-- 7) NOTHING ELSE OPEN -----------------------------------------------------------------------
select chk(not has_function_privilege('anon', 'public.orders_delivery_guard()', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_order_out(uuid, boolean)', 'execute')
       and not has_function_privilege('authenticated', 'public.order_progress_out(uuid)', 'execute'),
       'the guard and the two outputs are the database''s own: nobody calls them');

-- The result ------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   delivery database: all ' || count(*) || ' checks passed'
            else '   delivery database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
