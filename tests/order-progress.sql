-- ===========================================================================
-- AN ORDER'S PROGRESS, THE DATABASE SIDE, CHECKED (website build 78)
--
-- Load, in this order, into an empty database (as tests/pos-orders.sql is):
--   tests/pos-orders-fixture.sql, supabase-setup.sql, supabase-payments.sql,
--   tests/pos-orders-admins.sql, supabase-rewards.sql, supabase-pos-orders.sql,
--   supabase-payment-history.sql, tests/order-progress-fixture.sql,
--   supabase-order-progress.sql (twice: it is safe to run again),
-- then run this file. tests/order-progress-db.sh does all of that, and the
-- two refusals (the wrong database, and before supabase-pos-orders.sql).
--
-- The platform knocks with the public key and the door's own key; the
-- customer presses Confirm delivery or Ask for more time, signed in or behind
-- the private link; nobody else writes an order's progress.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon, authenticated, service_role;
grant usage on sequence checks_n_seq to anon, authenticated, service_role;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;

update public.pos_door_key set fingerprint = sha256(convert_to('k508-0123456789abcdef0123456789abcdef', 'UTF8'));
create or replace function k() returns text language sql immutable as $$ select 'k508-0123456789abcdef0123456789abcdef' $$;
grant execute on function k() to public;
-- About so many days from now, to the minute.
create or replace function days_on(p timestamptz, n numeric) returns boolean language sql stable as $$
  select abs(extract(epoch from (p - (now() + make_interval(secs => n * 86400))))) < 120 $$;
grant execute on function days_on(timestamptz, numeric) to public;

insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner');

-- 1) THE FILE, RUN TWICE ------------------------------------------------------------
select chk((select count(*) from pg_trigger where tgname = 'orders_progress_guard_t') = 1,
       'run twice, the file leaves exactly one guard');
select chk((select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'orders'
               and column_name in ('ship_note', 'dispatched_at', 'ready_at', 'delivered_at', 'delivered_by',
                                   'auto_deliver_at', 'extend_days', 'extend_max', 'extend_used', 'remind_days',
                                   'reminded_at', 'progress_token', 'dispatch_mailed_at', 'delivered_mailed_at',
                                   'refund_state', 'refund_amount', 'refund_ref', 'refund_note', 'refund_at',
                                   'refund_mailed_at')) = 20,
       'orders carries the twenty progress columns');
select chk((select status from public.orders where ref = 'VB-PRE01') = 'confirmed'
       and (select status from public.orders where ref = 'VB-PRE02') = 'completed'
       and (select pos_receipt_no from public.orders where ref = 'VB-PRE02') = 'R-OLD-1'
       and (select count(*) from public.orders where ref in ('VB-PRE01', 'VB-PRE02')
               and num_nonnulls(ship_note, dispatched_at, ready_at, delivered_at, auto_deliver_at, progress_token,
                                refund_state) > 0) = 0,
       'every order already recorded is as it was: running the file changes no order');
select chk(not has_function_privilege('anon', 'public.order_customer_step(uuid, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.order_customer_step(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.order_progress_out(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.order_progress_out(uuid)', 'execute'),
       'the parts cannot be called from outside');
select chk(not has_function_privilege('anon', 'public.order_confirm_delivery(uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.order_confirm_delivery(uuid)', 'execute')
       and has_function_privilege('anon', 'public.order_progress_link(text, text, text)', 'execute'),
       'Confirm delivery needs a signed-in customer; the private link needs nobody signed in');
select chk(public.pos_int('7') = 7 and public.pos_int('"3"') = 3 and public.pos_int('7.5') is null
       and public.pos_int('"x"') is null and public.pos_int(null) is null,
       'the platform''s days are read as whole numbers, or not at all');

-- 2) FOUR ORDERS RUNG UP: HANDED OVER, OR STILL TO GO ---------------------------------
set role service_role;
insert into public.orders (id, ref, customer_id, name, phone, email, address, total, currency, status, fulfilment)
values ('cccccccc-0000-0000-0000-000000000001', 'VB-DLV01', '22222222-2222-2222-2222-222222222222', 'Test Buyer',
        '0970000001', 'buyer@shop.test', 'Plot 9, Kabulonga', 1530, 'ZMW', 'pending', 'delivery'),
       ('cccccccc-0000-0000-0000-000000000002', 'VB-COL01', '22222222-2222-2222-2222-222222222222', 'Test Buyer',
        '0970000001', 'buyer@shop.test', null, 800, 'ZMW', 'pending', 'collection'),
       ('cccccccc-0000-0000-0000-000000000003', 'VB-SHOP1', null, 'Walk In', '0970000003', null, null,
        600, 'ZMW', 'pending', 'collection'),
       ('cccccccc-0000-0000-0000-000000000004', 'VB-DLV02', null, 'Guest Buyer', '0970000004', 'guest@shop.test',
        'Plot 4, Roma', 1200, 'ZMW', 'pending', 'delivery'),
       ('cccccccc-0000-0000-0000-000000000005', 'VB-OLD05', null, 'Old Platform', '0970000005', null, null,
        300, 'ZMW', 'pending', 'delivery'),
       ('cccccccc-0000-0000-0000-000000000006', 'VB-OPEN1', null, 'Still Open', '0970000006', null, null,
        200, 'ZMW', 'pending', 'delivery');
insert into public.order_items (order_id, sku, name, price, qty) values
  ('cccccccc-0000-0000-0000-000000000001', 'LD-9', 'Linen Dress', 1400, 1),
  ('cccccccc-0000-0000-0000-000000000002', 'TB-1', 'Tote Bag', 800, 1),
  ('cccccccc-0000-0000-0000-000000000004', 'SC-2', 'Silk Scarf', 600, 2);
-- Two are paid online, exactly as the payment service records it.
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = ref || '-0a1b2c3d4e',
       goods_total = total - case when fulfilment = 'delivery' then 130 else 0 end,
       delivery_fee = case when fulfilment = 'delivery' then 130 else 0 end, tax_total = 0
 where ref in ('VB-DLV01', 'VB-COL01');
insert into public.payments (order_id, tx_ref, mode, amount, currency, phone)
select id, pay_ref, 'test', total, 'ZMW', phone from public.orders where ref in ('VB-DLV01', 'VB-COL01');
update public.payments set status = 'paid', channel = 'mobilemoneyzambia' where tx_ref like 'VB-%-0a1b2c3d4e';
update public.orders set payment_status = 'paid', paid_amount = total, pay_channel = 'mobilemoneyzambia',
       paid_at = now() - interval '1 hour'
 where ref in ('VB-DLV01', 'VB-COL01');
reset role;

-- The platform, with the public key: claim, then the sale.
set role anon;
select public.vbp_pos_order_claim(k(), r, 'claim-' || lower(replace(r, '-', '')) || '-abcdef', 'Till 1')
  from unnest(array['VB-DLV01', 'VB-COL01', 'VB-SHOP1', 'VB-DLV02', 'VB-OLD05']) r;
select chk((public.vbp_pos_order_complete(k(), 'VB-DLV01', 'x',
         '{"saleId":"S-1","receiptNo":"R-1","invoiceNo":"I-1","handedOver":false,"receipt":{"lines":[]}}') ->> 'ok')::boolean
       and (public.vbp_pos_order_complete(k(), 'VB-COL01', 'x',
         '{"saleId":"S-2","receiptNo":"R-2","invoiceNo":"I-2","handedOver":false}') ->> 'ok')::boolean
       and (public.vbp_pos_order_complete(k(), 'VB-SHOP1', 'x',
         '{"saleId":"S-3","receiptNo":"R-3","invoiceNo":"I-3","handedOver":true}') ->> 'ok')::boolean
       and (public.vbp_pos_order_complete(k(), 'VB-DLV02', 'x',
         '{"saleId":"S-4","receiptNo":"R-4","invoiceNo":"I-4","handedOver":false}') ->> 'ok')::boolean
       and (public.vbp_pos_order_complete(k(), 'VB-OLD05', 'x',
         '{"saleId":"S-5","receiptNo":"R-5","invoiceNo":"I-5"}') ->> 'ok')::boolean,
       'the platform rings up five orders through the door');
reset role;
select chk((select status from public.orders where ref = 'VB-DLV01') = 'confirmed'
       and (select status from public.orders where ref = 'VB-COL01') = 'confirmed'
       and (select status from public.orders where ref = 'VB-DLV02') = 'confirmed',
       'goods still to go: the order says Preparing (confirmed), with its receipt');
select chk((select status from public.orders where ref = 'VB-SHOP1') = 'completed',
       'taken at the counter: Completed');
select chk((select status from public.orders where ref = 'VB-OLD05') = 'completed',
       'a platform from before 509, which does not say: Completed, exactly as before');

-- 3) THE LISTS AFTER THE TILL ---------------------------------------------------------
set role anon;
select chk((select string_agg(e ->> 'ref', ',' order by e ->> 'ref')
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'prepare') -> 'orders') e)
           = 'VB-COL01,VB-DLV01,VB-DLV02',
       'To prepare: the three rung up with their goods still to go, and nothing else');
select chk((select (e -> 'progress' ->> 'status') = 'confirmed' and (e -> 'progress' ->> 'rungUp')::boolean
                   and (e -> 'progress' ->> 'paidAt') is not null and (e ->> 'name') = 'Test Buyer'
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'prepare') -> 'orders') e
             where e ->> 'ref' = 'VB-DLV01'),
       'each comes with the order, as the till''s list has it, and its progress');
select chk((select (e -> 'progress' ->> 'paidAt') is not null
                   and (e -> 'progress' ->> 'paidAt') = (e -> 'progress' ->> 'preparingAt')
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'prepare') -> 'orders') e
             where e ->> 'ref' = 'VB-DLV02'),
       'paid at the till: the step Paid has the till''s date');
select chk((select (e -> 'progress' ->> 'paidAt') < (e -> 'progress' ->> 'preparingAt')
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'prepare') -> 'orders') e
             where e ->> 'ref' = 'VB-DLV01'),
       'paid online: the step Paid has the payment''s own date, before the till rang it up');
select chk(jsonb_array_length(public.vbp_pos_progress(k(), 'prepare', 'dlv01') -> 'orders') = 1
       and jsonb_array_length(public.vbp_pos_progress(k(), 'prepare', '0970000004') -> 'orders') = 1,
       'found by the order''s number or the phone');
select chk(jsonb_array_length(public.vbp_pos_progress(k(), 'onway') -> 'orders') = 0
       and jsonb_array_length(public.vbp_pos_progress(k(), 'ready') -> 'orders') = 0
       and jsonb_array_length(public.vbp_pos_progress(k(), 'delivered') -> 'orders') = 0,
       'nothing on its way, ready or delivered yet');
select chk(public.vbp_pos_progress('not-the-door-key-0123456789abcdef', 'prepare') ->> 'why' = 'refused'
       and public.vbp_pos_progress(k(), 'everything') ->> 'why' = 'unreadable',
       'the wrong key is refused, and a list that does not exist is not read');

-- 4) ON ITS WAY -------------------------------------------------------------------------
select chk((public.vbp_pos_order_progress(k(), 'VB-DLV01', 'dispatched', 'With Courier X',
             '{"autoDays":7,"extendDays":3,"extendMax":2,"remindDays":2}') ->> 'ok')::boolean,
       'On its way, with a note and the shop''s days');
reset role;
select chk((select status = 'dispatched' and ship_note = 'With Courier X' and dispatched_at is not null
                   and days_on(auto_deliver_at, 7) and extend_days = 3 and extend_max = 2 and extend_used = 0
                   and remind_days = 2 and reminded_at is null and dispatch_mailed_at is null
              from public.orders where ref = 'VB-DLV01'),
       'the order is on its way: the note, marked delivered in 7 days, 3 more days up to 2 times, the reminder 2 days before');
select chk((select progress_token ~ '^[0-9a-f]{40}$' from public.orders where ref = 'VB-DLV01'),
       'and it has its own private link key, 40 random figures and letters');
create temp table was as select dispatched_at, auto_deliver_at, progress_token from public.orders where ref = 'VB-DLV01';
grant select on was to anon;
set role anon;
select chk((public.vbp_pos_order_progress(k(), 'VB-DLV01', 'dispatched', 'Again',
             '{"autoDays":2}') ->> 'again')::boolean,
       'On its way twice: the second changes nothing');
reset role;
select chk((select o.dispatched_at = w.dispatched_at and o.auto_deliver_at = w.auto_deliver_at
                   and o.progress_token = w.progress_token and o.ship_note = 'With Courier X'
              from public.orders o, was w where o.ref = 'VB-DLV01'),
       'the date, the note and the link key are as they were');
set role anon;
select chk(public.vbp_pos_order_progress(k(), 'VB-COL01', 'dispatched') ->> 'why' = 'not_delivery',
       'a collection order is never sent on its way');
select chk(public.vbp_pos_order_progress(k(), 'VB-SHOP1', 'dispatched') ->> 'why' = 'handed_over',
       'an order taken at the counter has nowhere to go');
select chk(public.vbp_pos_order_progress(k(), 'VB-OPEN1', 'dispatched') ->> 'why' = 'not_rung_up',
       'an order the till has not rung up cannot be moved on');
select chk(public.vbp_pos_order_progress(k(), 'VB-DLV01', 'shipped') ->> 'why' = 'unreadable'
       and public.vbp_pos_order_progress('not-the-door-key-0123456789abcdef', 'VB-DLV01', 'delivered') ->> 'why' = 'refused',
       'a step that does not exist, and the wrong key, are refused');
select chk((public.vbp_pos_order_progress(k(), 'VB-DLV02', 'dispatched', null,
             '{"autoDays":"3","remindDays":9,"extendDays":3,"extendMax":2}') ->> 'ok')::boolean,
       'a second order on its way, with a reminder set past its date');
reset role;
select chk((select days_on(auto_deliver_at, 3) and remind_days = 2 and ship_note is null
              from public.orders where ref = 'VB-DLV02'),
       'its reminder is kept before the date: 3 days, the reminder 2 days before');
set role anon;
select chk((select count(*) = 2 and bool_and((e -> 'progress' -> 'extend' ->> 'can')::boolean)
                   and bool_and((e -> 'progress' -> 'extend' ->> 'left')::int = 2)
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'onway') -> 'orders') e),
       'On its way lists both, each with more time still to give');
select chk((select (e -> 'progress' ->> 'note') = 'With Courier X' and (e -> 'progress' ->> 'autoAt') is not null
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'onway') -> 'orders') e
             where e ->> 'ref' = 'VB-DLV01'),
       'with its note and the date it will be marked delivered');

-- 5) READY FOR COLLECTION, AND COLLECTED -------------------------------------------------
select chk(public.vbp_pos_order_progress(k(), 'VB-DLV01', 'ready') ->> 'why' = 'not_collection',
       'a delivery order is never ready for collection');
select chk((public.vbp_pos_order_progress(k(), 'VB-COL01', 'ready', 'At the shop from 10:00') ->> 'ok')::boolean,
       'Ready for collection, with a note');
reset role;
select chk((select status = 'ready' and ready_at is not null and ship_note = 'At the shop from 10:00'
                   and auto_deliver_at is null and progress_token is not null
              from public.orders where ref = 'VB-COL01'),
       'the order is ready, with the note, and never marked collected by itself');
set role anon;
select chk((select string_agg(e ->> 'ref', ',') from jsonb_array_elements(public.vbp_pos_progress(k(), 'ready') -> 'orders') e) = 'VB-COL01',
       'Ready for collection lists it');
select chk((public.vbp_pos_order_progress(k(), 'VB-COL01', 'delivered') ->> 'ok')::boolean,
       'Collected');
reset role;
select chk((select status = 'delivered' and delivered_by = 'shop' and delivered_at is not null
                   and delivered_mailed_at is null from public.orders where ref = 'VB-COL01'),
       'the order is collected, by the shop''s word');
set role anon;
select chk((public.vbp_pos_order_progress(k(), 'VB-COL01', 'delivered') ->> 'again')::boolean,
       'Collected twice: the second changes nothing');
select chk((select string_agg(e ->> 'ref', ',') from jsonb_array_elements(public.vbp_pos_progress(k(), 'delivered') -> 'orders') e) = 'VB-COL01',
       'Delivered lists it');

-- 6) GIVE MORE TIME (THE SHOP) -----------------------------------------------------------
select chk((public.vbp_pos_order_progress(k(), 'VB-DLV02', 'extend', null, '{"days":3}') ->> 'ok')::boolean,
       'Give more time');
reset role;
select chk((select days_on(auto_deliver_at, 6) and extend_used = 0 and reminded_at is null
              from public.orders where ref = 'VB-DLV02'),
       '3 days more (6 from now), and the customer''s own two times untouched');
set role anon;
select chk(public.vbp_pos_order_progress(k(), 'VB-COL01', 'extend') ->> 'why' = 'not_on_its_way',
       'more time only for an order on its way');

-- 7) THE CUSTOMER, SIGNED IN ---------------------------------------------------------------
reset role;
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.order_extend_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'ok')::boolean,
       'Ask for more time, on their own order');
reset role;
select chk((select days_on(auto_deliver_at, 10) and extend_used = 1 from public.orders where ref = 'VB-DLV01'),
       '3 days more (10 from now), once of twice');
set role authenticated;
select chk((public.order_extend_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'ok')::boolean
       and (public.order_extend_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'why') = 'no_more_time',
       'twice, and then no more');
reset role;
select chk((select days_on(auto_deliver_at, 13) and extend_used = 2 from public.orders where ref = 'VB-DLV01'),
       'the third time changes nothing');
set role authenticated;
select chk((select count(*) from public.orders
             where ref = 'VB-DLV01' and status = 'dispatched' and ship_note = 'With Courier X') = 1,
       'the customer reads their order''s progress on their account page');
do $$ begin
  update public.orders set extend_used = 0 where ref = 'VB-DLV01';
  perform chk((select extend_used from public.orders where ref = 'VB-DLV01') = 2,
              'a customer cannot write their order''s progress themselves');
exception when others then
  perform chk(true, 'a customer cannot write their order''s progress themselves');
end $$;
select chk((public.order_confirm_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'ok')::boolean,
       'Confirm delivery');
reset role;
select chk((select status = 'delivered' and delivered_by = 'customer' and delivered_at is not null
                   and delivered_mailed_at is not null from public.orders where ref = 'VB-DLV01'),
       'the order is delivered, by the customer''s word, and no email about what they said themselves');
set role authenticated;
select chk((public.order_confirm_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'again')::boolean
       and public.order_extend_delivery('cccccccc-0000-0000-0000-000000000001') ->> 'why' = 'not_on_its_way',
       'confirmed twice changes nothing; no more time once it is delivered');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
select chk(public.order_confirm_delivery('cccccccc-0000-0000-0000-000000000004') ->> 'why' = 'not_found'
       and public.order_extend_delivery('cccccccc-0000-0000-0000-000000000004') ->> 'why' = 'not_found',
       'another customer cannot touch somebody else''s order');
reset role;
delete from auth.whoami;
set role authenticated;
select chk(public.order_confirm_delivery('cccccccc-0000-0000-0000-000000000004') ->> 'why' = 'signin',
       'nobody signed in: sign in');
reset role;
set role anon;
do $$ begin
  perform public.order_confirm_delivery('cccccccc-0000-0000-0000-000000000004');
  perform chk(false, 'the public key alone cannot press Confirm delivery');
exception when insufficient_privilege then
  perform chk(true, 'the public key alone cannot press Confirm delivery');
end $$;
do $$ begin
  perform public.order_customer_step('cccccccc-0000-0000-0000-000000000004', 'confirm');
  perform chk(false, 'nor reach the step behind it');
exception when insufficient_privilege then
  perform chk(true, 'nor reach the step behind it');
end $$;
reset role;

-- 8) THE PRIVATE LINK ------------------------------------------------------------------------
create temp table tok as select progress_token as t from public.orders where ref = 'VB-DLV02';
grant select on tok to anon;
set role anon;
select chk((select (r ->> 'ok')::boolean and r -> 'order' ->> 'firstName' = 'Guest'
                   and r -> 'progress' ->> 'status' = 'dispatched'
                   and r -> 'order' -> 'items' -> 0 ->> 'name' = 'Silk Scarf'
                   and (r -> 'order' -> 'items' -> 0 ->> 'qty')::int = 2
                   and r -> 'order' ->> 'receiptNo' = 'R-4'
                   and not (r -> 'order' ? 'phone') and not (r -> 'order' ? 'address') and not (r -> 'order' ? 'email')
              from (select public.order_progress_link('VB-DLV02', (select t from tok)) r) x),
       'the private link shows that order alone: first name, pieces, receipt, progress; no phone, address or email');
select chk(public.order_progress_link('VB-DLV02', repeat('0', 40)) ->> 'why' = 'not_found'
       and public.order_progress_link('VB-DLV01', (select t from tok)) ->> 'why' = 'not_found'
       and public.order_progress_link('VB-DLV02', 'short') ->> 'why' = 'not_found'
       and public.order_progress_link('nonsense', (select t from tok)) ->> 'why' = 'not_found',
       'a wrong key, another order''s number, or a broken link: not found, and nothing else');
select chk(public.order_progress_link('VB-OPEN1', repeat('a', 40)) ->> 'why' = 'not_found',
       'an order never sent on its way has no link');
select chk(public.order_progress_link('VB-DLV02', (select t from tok), 'delete') ->> 'why' = 'unreadable',
       'the link does two things and nothing else');
select chk((select (r ->> 'ok')::boolean and r ->> 'done' = 'extend'
                   and (r -> 'progress' -> 'extend' ->> 'used')::int = 1
              from (select public.order_progress_link('VB-DLV02', (select t from tok), 'extend') r) x),
       'Ask for more time, behind the link');
select chk((select (r ->> 'ok')::boolean and r ->> 'done' = 'confirm' and r -> 'progress' ->> 'deliveredBy' = 'customer'
              from (select public.order_progress_link('VB-DLV02', (select t from tok), 'confirm') r) x),
       'Confirm delivery, behind the link');
reset role;
select chk((select status = 'delivered' and delivered_by = 'customer' from public.orders where ref = 'VB-DLV02'),
       'and the order is delivered');

-- 9) NOBODY ELSE WRITES IT --------------------------------------------------------------------
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ begin
  update public.orders set ship_note = 'typed by hand' where ref = 'VB-SHOP1';
  perform chk(false, 'an admin login cannot write an order''s progress');
exception when others then
  perform chk(sqlerrm like '%progress is set by the platform only%', 'an admin login cannot write an order''s progress');
end $$;
do $$ begin
  insert into public.orders (ref, name, status, delivered_at) values ('VB-FAKE1', 'Fake', 'pending', now());
  perform chk(false, 'nor file an order already delivered');
exception when others then
  perform chk(sqlerrm like '%progress is set by the platform only%', 'nor file an order already delivered');
end $$;
update public.orders set status = 'confirmed', updated_at = now() where ref = 'VB-OPEN1';
reset role;
delete from auth.whoami;
select chk((select status from public.orders where ref = 'VB-OPEN1') = 'confirmed',
       'the Orders tab still changes a status as it always has');

-- 10) A REFUND, RECORDED BY THE PLATFORM (510) ------------------------------------------------
set role anon;
select chk((public.vbp_pos_order_refund(k(), 'VB-DLV01', 'full', 1530, 'FLW-RF-1', 'Returned unworn', true) ->> 'ok')::boolean,
       'a refund recorded');
select chk((public.vbp_pos_order_refund(k(), 'VB-DLV01', 'full', 1530, 'FLW-RF-1', 'Returned unworn', true) ->> 'again')::boolean,
       'the same refund twice: the second changes nothing');
select chk(public.vbp_pos_order_refund(k(), 'VB-DLV01', 'full', 0, 'FLW-RF-2', null, true) ->> 'why' = 'unreadable'
       and public.vbp_pos_order_refund(k(), 'VB-DLV01', 'half', 10, 'FLW-RF-2', null, true) ->> 'why' = 'unreadable'
       and public.vbp_pos_order_refund(k(), 'VB-OPEN1', 'full', 10, 'FLW-RF-3', null, true) ->> 'why' = 'not_rung_up'
       and public.vbp_pos_order_refund('not-the-door-key-0123456789abcdef', 'VB-DLV01', 'full', 10, 'x', null, true) ->> 'why' = 'refused',
       'no amount, an unknown kind, an order not rung up, the wrong key: refused');
select chk((public.vbp_pos_order_refund(k(), 'VB-COL01', 'part', 300, 'FLW-RF-4', null, false) ->> 'ok')::boolean,
       'a part refund, without telling the customer');
reset role;
select chk((select refund_state = 'full' and refund_amount = 1530 and refund_ref = 'FLW-RF-1' and refund_note = 'Returned unworn'
                   and refund_at is not null and refund_mailed_at is null from public.orders where ref = 'VB-DLV01'),
       'the refund is on the order, and the customer will be told');
select chk((select refund_state = 'part' and refund_mailed_at is not null from public.orders where ref = 'VB-COL01'),
       'not to be told: nothing to send');
set role anon;
select chk((select e -> 'progress' -> 'refund' ->> 'ref' = 'FLW-RF-4'
              from jsonb_array_elements(public.vbp_pos_progress(k(), 'delivered') -> 'orders') e where e ->> 'ref' = 'VB-COL01'),
       'and the platform sees it');
reset role;

-- 11) NOTHING ELSE TOUCHED --------------------------------------------------------------------
select chk((select payment_status = 'paid' and paid_amount = 1530 and pay_ref = 'VB-DLV01-0a1b2c3d4e' and total = 1530
              from public.orders where ref = 'VB-DLV01')
       and (select count(*) from public.payments where status = 'paid') = 2
       and (select count(*) from public.order_items) = 3,
       'the payments, the totals and the pieces are as they were');
select chk(exists (select 1 from public.payment_events where order_id = 'cccccccc-0000-0000-0000-000000000001'
                    and what = 'order' and from_state = 'confirmed' and to_state = 'dispatched')
       and exists (select 1 from public.payment_events where order_id = 'cccccccc-0000-0000-0000-000000000001'
                    and what = 'order' and from_state = 'dispatched' and to_state = 'delivered'),
       'the payment history (website 77) records each step of an order paid online');
select chk((select status from public.orders where ref = 'VB-PRE01') = 'confirmed'
       and (select status from public.orders where ref = 'VB-PRE02') = 'completed',
       'the orders from before are still as they were');
select chk((select count(*) from public.pos_door_calls where kind = 'read') > 0
       and (select count(*) from public.pos_door_calls where kind = 'write') > 0,
       'the new doors count against the same hourly limits as the till''s');

-- The result ------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   order progress database: all ' || count(*) || ' checks passed'
            else '   order progress database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
