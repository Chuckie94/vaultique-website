-- ===========================================================================
-- ONLINE PAYMENT, ITS HISTORY, THE DATABASE SIDE, CHECKED (website build 77)
--
-- Load, in this order, into an empty database (as tests/pos-orders.sql is):
--   tests/pos-orders-fixture.sql, supabase-setup.sql, supabase-payments.sql,
--   tests/pos-orders-admins.sql, supabase-rewards.sql, supabase-pos-orders.sql,
--   supabase-payment-history.sql (twice: it is safe to run again),
-- then run this file.
--
-- The history is written by the database itself, whoever makes the change,
-- and never stands in the way of the change; nobody can alter it; only
-- administrators can read it. The three-hour tidy-up leaves a payment that
-- needs attention alone, and the platform's till cannot ring one up.
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

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@shop.test');
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner');
insert into public.customers (id, name) values ('22222222-2222-2222-2222-222222222222', 'Test Buyer');

-- 1) THE FILE, RUN TWICE --------------------------------------------------------
select chk((select count(*) from pg_trigger where tgname = 'payment_events_payment_t') = 1
       and (select count(*) from pg_trigger where tgname = 'payment_events_order_t') = 1
       and (select count(*) from pg_trigger where tgname = 'payment_events_frozen_t') = 1,
       'run twice, the file leaves exactly one of each recorder and the lock');
select chk(exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'payments' and column_name = 'asked_at'),
       'payments has asked_at, for the status page');

-- 2) A PAYMENT, AS THE PAYMENT SERVICE MAKES IT -----------------------------------
set role service_role;
insert into public.orders (id, ref, name, phone, email, total, currency, status, fulfilment)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'VB-HIST1', 'Test Buyer', '0970000001', 'buyer@shop.test', 300, 'ZMW', 'pending', 'collection');
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-HIST1-0123456789',
       goods_total = 300, delivery_fee = 0, tax_total = 0
 where ref = 'VB-HIST1';
insert into public.payments (order_id, tx_ref, mode, amount, currency, phone)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'VB-HIST1-0123456789', 'test', 300, 'ZMW', '0970000001');
update public.payments set asked_at = now() where tx_ref = 'VB-HIST1-0123456789';
update public.payments set status = 'paid', provider_tx_id = '9001', channel = 'card',
       detail = '{"flw_ref": "FLW-9001", "amount": 300, "charged": 300, "app_fee": 4.2}'::jsonb
 where tx_ref = 'VB-HIST1-0123456789';
update public.orders set payment_status = 'paid', paid_amount = 300, pay_channel = 'card', paid_at = now()
 where ref = 'VB-HIST1';
reset role;

select chk((select count(*) from public.payment_events
             where tx_ref = 'VB-HIST1-0123456789' and what = 'payment' and from_state is null
               and to_state = 'started' and (note ->> 'amount')::numeric = 300 and note ->> 'mode' = 'test') = 1,
       'a payment started is recorded, with its amount and mode');
select chk((select count(*) from public.payment_events
             where tx_ref = 'VB-HIST1-0123456789' and what = 'payment' and from_state = 'started'
               and to_state = 'paid' and note ->> 'flw_ref' = 'FLW-9001') = 1,
       'paid is recorded, with what Flutterwave said');
select chk((select count(*) from public.payment_events where tx_ref = 'VB-HIST1-0123456789' and what = 'payment') = 2,
       'the status page asking Flutterwave (asked_at) is not a change of the payment: no line for it');
select chk((select count(*) from public.payment_events
             where order_id = 'aaaaaaaa-0000-0000-0000-000000000001' and what = 'order-payment'
               and from_state is null and to_state = 'awaiting') = 1,
       'the order sent to pay online is recorded');
select chk((select count(*) from public.payment_events
             where order_id = 'aaaaaaaa-0000-0000-0000-000000000001' and what = 'order-payment'
               and to_state = 'paid' and (note ->> 'paid')::numeric = 300 and note ->> 'channel' = 'card') = 1,
       'the order marked paid is recorded, with what was paid and how');
select chk((select min(at) from public.payment_events where tx_ref = 'VB-HIST1-0123456789') <= now(),
       'every line carries its time');

-- 3) AN ADMIN CHANGES THE ORDER'S STATUS, AS THE ORDERS TAB DOES -------------------
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
update public.orders set status = 'confirmed', updated_at = now() where ref = 'VB-HIST1';
reset role;
delete from auth.whoami;
select chk((select status from public.orders where ref = 'VB-HIST1') = 'confirmed',
       'an admin''s change of an online order is saved (the recorder runs as its owner, not as the admin)');
select chk(exists (select 1 from public.payment_events
                    where order_id = 'aaaaaaaa-0000-0000-0000-000000000001' and what = 'order'
                      and from_state = 'pending' and to_state = 'confirmed'),
       'and recorded');

-- 4) WHO CAN READ IT, AND NOBODY CAN CHANGE IT -------------------------------------
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select count(*) from public.payment_events) = 0, 'a signed-in customer reads none of it');
reset role;
delete from auth.whoami;

set role anon;
do $$ begin
  perform 1 from public.payment_events;
  perform chk(false, 'the public key cannot read it');
exception when insufficient_privilege then
  perform chk(true, 'the public key cannot read it');
end $$;
reset role;

insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((select count(*) from public.payment_events where order_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 5,
       'an administrator reads it');
do $$ begin
  insert into public.payment_events (what) values ('forged');
  perform chk(false, 'an administrator cannot add a line');
exception when insufficient_privilege then
  perform chk(true, 'an administrator cannot add a line');
end $$;
do $$ begin
  delete from public.payment_events;
  perform chk(false, 'nor delete one');
exception when insufficient_privilege then
  perform chk(true, 'nor delete one');
end $$;
reset role;
delete from auth.whoami;

set role service_role;
do $$ begin
  insert into public.payment_events (what) values ('forged');
  perform chk(false, 'the payment service cannot write a line by hand');
exception when insufficient_privilege then
  perform chk(true, 'the payment service cannot write a line by hand');
end $$;
do $$ begin
  update public.payment_events set to_state = 'paid';
  perform chk(false, 'nor change one');
exception when insufficient_privilege then
  perform chk(true, 'nor change one');
end $$;
do $$ begin
  delete from public.payment_events;
  perform chk(false, 'nor delete one');
exception when insufficient_privilege then
  perform chk(true, 'nor delete one');
end $$;
do $$ begin
  truncate public.payment_events;
  perform chk(false, 'nor empty the table');
exception when insufficient_privilege then
  perform chk(true, 'nor empty the table');
end $$;
reset role;

-- The second lock: even given the rights by mistake, a line cannot be changed.
grant update, delete on public.payment_events to service_role;
set role service_role;
do $$ begin
  update public.payment_events set to_state = 'paid';
  perform chk(false, 'given the rights by mistake, a line still cannot be changed');
exception when others then
  perform chk(sqlerrm like '%payment history cannot be changed%', 'given the rights by mistake, a line still cannot be changed');
end $$;
do $$ begin
  delete from public.payment_events;
  perform chk(false, 'or deleted');
exception when others then
  perform chk(sqlerrm like '%payment history cannot be changed%', 'or deleted');
end $$;
reset role;
revoke update, delete on public.payment_events from service_role;

-- 5) THE HISTORY NEVER STANDS IN THE WAY ---------------------------------------------
set role service_role;
insert into public.orders (id, ref, name, total, currency, status)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'VB-HIST2', 'Test Buyer', 300, 'ZMW', 'pending');
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-HIST2-0123456789' where ref = 'VB-HIST2';
insert into public.payments (order_id, tx_ref, mode, amount, currency)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'VB-HIST2-0123456789', 'test', 300, 'ZMW');
reset role;
alter table public.payment_events rename to payment_events_away;
set role service_role;
update public.payments set status = 'failed', detail = '{"reason": "failed"}'::jsonb where tx_ref = 'VB-HIST2-0123456789';
update public.orders set payment_status = 'failed', status = 'cancelled' where ref = 'VB-HIST2';
reset role;
alter table public.payment_events_away rename to payment_events;
select chk((select status from public.payments where tx_ref = 'VB-HIST2-0123456789') = 'failed'
       and (select status from public.orders where ref = 'VB-HIST2') = 'cancelled',
       'if a line cannot be written, the payment and the order are saved anyway');

-- 6) THE THREE-HOUR TIDY-UP, AND A PAYMENT THAT NEEDS ATTENTION -----------------------
set role service_role;
insert into public.orders (id, ref, name, total, currency, status, created_at)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'VB-REV01', 'Test Buyer', 300, 'ZMW', 'pending', now() - interval '5 hours'),
       ('aaaaaaaa-0000-0000-0000-000000000004', 'VB-OLD01', 'Test Buyer', 300, 'ZMW', 'pending', now() - interval '5 hours');
update public.orders set payment_method = 'online', payment_status = 'review', pay_ref = 'VB-REV01-0123456789' where ref = 'VB-REV01';
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-OLD01-0123456789' where ref = 'VB-OLD01';
insert into public.payments (order_id, tx_ref, mode, amount, currency, status, created_at, detail)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'VB-REV01-0123456789', 'test', 300, 'ZMW', 'review', now() - interval '5 hours',
        '{"mismatch": true, "amount": 360, "currency": "ZMW", "expected": 300}'::jsonb),
       ('aaaaaaaa-0000-0000-0000-000000000004', 'VB-OLD01-0123456789', 'test', 300, 'ZMW', 'started', now() - interval '5 hours', null);
select public.pay_expire_stale();
reset role;
select chk((select status from public.payments where tx_ref = 'VB-REV01-0123456789') = 'review'
       and (select status from public.orders where ref = 'VB-REV01') = 'pending'
       and (select payment_status from public.orders where ref = 'VB-REV01') = 'review',
       'the three-hour tidy-up leaves a payment that needs attention, and its order, alone');
select chk((select status from public.payments where tx_ref = 'VB-OLD01-0123456789') = 'expired'
       and (select status from public.orders where ref = 'VB-OLD01') = 'cancelled',
       'and still tidies away one nobody paid for');
select chk(exists (select 1 from public.payment_events
                    where tx_ref = 'VB-OLD01-0123456789' and what = 'payment'
                      and from_state = 'started' and to_state = 'expired')
       and exists (select 1 from public.payment_events
                    where order_id = 'aaaaaaaa-0000-0000-0000-000000000004' and what = 'order'
                      and from_state = 'pending' and to_state = 'cancelled'),
       'the tidy-up''s changes are recorded too');

set role anon;
select chk((public.vbp_pos_order_claim(k(), 'VB-REV01', 'claim-0001-abcdef', 'Till 1') ->> 'why') = 'awaiting_payment',
       'the platform''s till cannot ring up an order whose payment needs attention');
reset role;

-- 7) A WHATSAPP ORDER IS NOT RECORDED HERE ---------------------------------------------
set role service_role;
insert into public.orders (id, ref, name, total, currency, status)
values ('aaaaaaaa-0000-0000-0000-000000000005', 'VB-WA001', 'Test Buyer', 500, 'ZMW', 'pending');
update public.orders set status = 'confirmed' where ref = 'VB-WA001';
reset role;
select chk(not exists (select 1 from public.payment_events where order_id = 'aaaaaaaa-0000-0000-0000-000000000005'),
       'a WhatsApp order''s changes are not recorded in the payment history');

-- The result ------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   payment history database: all ' || count(*) || ' checks passed'
            else '   payment history database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
