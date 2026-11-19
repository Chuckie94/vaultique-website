-- ===========================================================================
-- ONLINE REFUND, THE DATABASE SIDE, CHECKED (website build 81)
--
-- Load, in this order, into an empty database:
--   tests/pos-orders-fixture.sql, supabase-setup.sql, supabase-payments.sql,
--   tests/pos-orders-admins.sql, supabase-rewards.sql, supabase-pos-orders.sql,
--   supabase-payment-history.sql, tests/order-progress-fixture.sql,
--   supabase-order-progress.sql, supabase-online-refund.sql (twice: it is
--   safe to run again),
-- then run this file. tests/online-refund-db.sh does all of that, a third
-- run with refunds in it, and the two refusals (the platform's database,
-- and a website without supabase-order-progress.sql).
--
-- The platform knocks with the public key and the door's own key. The
-- payment service writes what Flutterwave said, with the service key, and is
-- held to the same rules as anybody: a refund is never deleted, what it asked
-- never changes, and where it stands only moves forward.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon, authenticated, service_role;
grant usage on sequence checks_n_seq to anon, authenticated, service_role;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;
-- The error a statement raises, or '' when it runs.
create or replace function err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return ''; exception when others then return sqlerrm; end $$;
grant execute on function err(text) to public;

update public.pos_door_key set fingerprint = sha256(convert_to('k508-0123456789abcdef0123456789abcdef', 'UTF8'));
create or replace function k() returns text language sql immutable as $$ select 'k508-0123456789abcdef0123456789abcdef' $$;
grant execute on function k() to public;
-- the refund's id from a door's answer
create or replace function rid(p jsonb) returns uuid language sql immutable as $$ select (p -> 'refund' ->> 'id')::uuid $$;
grant execute on function rid(jsonb) to public;

insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict do nothing;

-- Orders paid online, and others, made the way the website makes them.
insert into public.orders (id, ref, name, phone, email, address, total, currency, status, fulfilment, created_at,
                           payment_method, payment_status, pay_ref, pay_channel, goods_total, delivery_fee, paid_amount, paid_at)
values
  ('dddddddd-0000-0000-0000-000000000001', 'VB-RF001', 'Refund Buyer', '0970000201', 'buyer@shop.test', 'Plot 1, Lusaka',
   1500, 'ZMW', 'completed', 'delivery', now() - interval '5 days', 'online', 'paid', 'VB-RF001-aaaa', 'card', 1400, 100, 1500, now() - interval '5 days'),
  ('dddddddd-0000-0000-0000-000000000002', 'VB-RF002', 'Waiting Buyer', '0970000202', 'wait@shop.test', 'Plot 2, Lusaka',
   800, 'ZMW', 'confirmed', 'collection', now() - interval '1 day', 'online', 'paid', 'VB-RF002-bbbb', 'mobilemoneyzambia', 800, 0, 800, now() - interval '1 day'),
  ('dddddddd-0000-0000-0000-000000000003', 'VB-RF003', 'Held Buyer', '0970000203', null, 'Plot 3, Lusaka',
   600, 'ZMW', 'confirmed', 'delivery', now() - interval '1 hour', 'online', 'paid', 'VB-RF003-cccc', 'card', 550, 50, 600, now() - interval '1 hour'),
  ('dddddddd-0000-0000-0000-000000000004', 'VB-RF004', 'WhatsApp Buyer', '0970000204', null, null,
   300, 'ZMW', 'confirmed', 'collection', now() - interval '2 days', null, null, null, null, null, null, null, null),
  ('dddddddd-0000-0000-0000-000000000005', 'VB-RF005', 'Review Buyer', '0970000205', null, null,
   400, 'ZMW', 'pending', 'delivery', now() - interval '2 days', 'online', 'review', 'VB-RF005-eeee', 'card', 400, 0, null, null),
  ('dddddddd-0000-0000-0000-000000000006', 'VB-RF006', 'No Number Buyer', '0970000206', null, null,
   500, 'ZMW', 'completed', 'delivery', now() - interval '2 days', 'online', 'paid', 'VB-RF006-ffff', 'card', 500, 0, 500, now() - interval '2 days'),
  ('dddddddd-0000-0000-0000-000000000007', 'VB-RF007', 'Old Way Buyer', '0970000207', null, null,
   700, 'ZMW', 'completed', 'collection', now() - interval '9 days', 'online', 'paid', 'VB-RF007-gggg', 'card', 700, 0, 700, now() - interval '9 days'),
  ('dddddddd-0000-0000-0000-000000000008', 'VB-RF008', 'Paying Buyer', '0970000208', null, null,
   900, 'ZMW', 'pending', 'delivery', now() - interval '10 minutes', 'online', 'awaiting', 'VB-RF008-hhhh', null, 900, 0, null, null),
  ('dddddddd-0000-0000-0000-000000000009', 'VB-RF009', 'Second Buyer', '0970000209', 'second@shop.test', 'Plot 9, Lusaka',
   1000, 'ZMW', 'completed', 'delivery', now() - interval '3 days', 'online', 'paid', 'VB-RF009-iiii', 'card', 1000, 0, 1000, now() - interval '3 days');
update public.orders set pos_sale_id = 'S-RF1', pos_receipt_no = 'R-0001', pos_invoice_no = 'INV-0001', pos_completed_at = now() - interval '5 days'
 where ref = 'VB-RF001';
update public.orders set pos_sale_id = 'S-RF6', pos_receipt_no = 'R-0006', pos_completed_at = now() - interval '2 days' where ref = 'VB-RF006';
update public.orders set pos_sale_id = 'S-RF9', pos_receipt_no = 'R-0009', pos_completed_at = now() - interval '3 days' where ref = 'VB-RF009';
update public.orders set pos_claim_id = 'claim-rf003-abcdef', pos_claimed_by = 'Till 1', pos_claimed_at = now() where ref = 'VB-RF003';
insert into public.order_items (order_id, sku, name, price, qty) values
  ('dddddddd-0000-0000-0000-000000000001', 'RF-1', 'Linen Dress', 900, 1),
  ('dddddddd-0000-0000-0000-000000000001', 'RF-2', 'Silk Scarf', 250, 2),
  ('dddddddd-0000-0000-0000-000000000002', 'RF-3', 'Leather Bag', 800, 1),
  ('dddddddd-0000-0000-0000-000000000009', 'RF-4', 'Cotton Shirt', 1000, 1);
insert into public.payments (order_id, tx_ref, mode, status, amount, currency, phone, provider_tx_id, channel, detail) values
  ('dddddddd-0000-0000-0000-000000000001', 'VB-RF001-aaaa', 'live', 'paid', 1500, 'ZMW', '0970000201', '900001', 'card',
   '{"flw_ref":"FLW-REF-1","amount":1500}'),
  ('dddddddd-0000-0000-0000-000000000001', 'VB-RF001-a000', 'live', 'failed', 1500, 'ZMW', '0970000201', '899999', 'card', '{}'),
  ('dddddddd-0000-0000-0000-000000000002', 'VB-RF002-bbbb', 'test', 'paid', 800, 'ZMW', '0970000202', '900002', 'mobilemoneyzambia',
   '{"flw_ref":"FLW-REF-2","amount":800}'),
  ('dddddddd-0000-0000-0000-000000000003', 'VB-RF003-cccc', 'live', 'paid', 600, 'ZMW', '0970000203', '900003', 'card', '{}'),
  ('dddddddd-0000-0000-0000-000000000005', 'VB-RF005-eeee', 'live', 'review', 400, 'ZMW', '0970000205', '900005', 'card', '{}'),
  ('dddddddd-0000-0000-0000-000000000006', 'VB-RF006-ffff', 'live', 'paid', 500, 'ZMW', '0970000206', null, 'card', '{}'),
  ('dddddddd-0000-0000-0000-000000000007', 'VB-RF007-gggg', 'live', 'paid', 700, 'ZMW', '0970000207', '900007', 'card', '{}'),
  ('dddddddd-0000-0000-0000-000000000008', 'VB-RF008-hhhh', 'live', 'started', 900, 'ZMW', '0970000208', null, null, null),
  ('dddddddd-0000-0000-0000-000000000009', 'VB-RF009-iiii', 'live', 'paid', 1000, 'ZMW', '0970000209', '900009', 'card',
   '{"flw_ref":"FLW-REF-9","amount":1000}');

-- 1) THE FILE, RUN TWICE --------------------------------------------------------------------
select chk((select count(*) from pg_trigger where tgname = 'refunds_guard_t') = 1
       and (select count(*) from pg_trigger where tgname = 'refunds_to_order_t') = 1,
       'run twice, the file leaves exactly one guard and one recorder');
select chk((select relrowsecurity from pg_class where oid = 'public.refunds'::regclass)
       and exists (select 1 from pg_policies where tablename = 'refunds' and policyname = 'refunds_admin_read'),
       'the refunds have row level security, and administrators'' reading is the only rule');
select chk(not has_table_privilege('anon', 'public.refunds', 'select')
       and not has_table_privilege('anon', 'public.refunds', 'insert')
       and not has_table_privilege('anon', 'public.refunds', 'update')
       and not has_table_privilege('authenticated', 'public.refunds', 'insert')
       and not has_table_privilege('authenticated', 'public.refunds', 'update')
       and not has_table_privilege('authenticated', 'public.refunds', 'delete')
       and has_table_privilege('service_role', 'public.refunds', 'update')
       and not has_table_privilege('service_role', 'public.refunds', 'insert')
       and not has_table_privilege('service_role', 'public.refunds', 'delete'),
       'visitors cannot touch the refunds; the payment service can only bring them up to date');
select chk(not has_function_privilege('anon', 'public.refund_out(public.refunds)', 'execute')
       and not has_function_privilege('authenticated', 'public.refund_out(public.refunds)', 'execute')
       and not has_function_privilege('anon', 'public.refund_state_of(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.refund_state_of(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.refunds_guard()', 'execute')
       and not has_function_privilege('anon', 'public.refunds_to_order()', 'execute'),
       'the parts cannot be called from outside');
select chk(has_function_privilege('anon', 'public.vbp_pos_refund_find(text, text)', 'execute')
       and has_function_privilege('anon', 'public.vbp_pos_refund_request(text, text, numeric, boolean, text, text, text, text, text, boolean)', 'execute')
       and has_function_privilege('anon', 'public.vbp_pos_refunds(text, text[], timestamptz)', 'execute'),
       'the three doors are open to the platform''s public key');
select chk((select status from public.orders where ref = 'VB-PRE01') = 'confirmed'
       and (select status from public.orders where ref = 'VB-PRE02') = 'completed'
       and (select count(*) from public.orders where refund_state is not null) = 0,
       'every order already recorded is as it was: running the file changes no order');

-- 2) A WRONG KEY -----------------------------------------------------------------------------
set role anon;
select chk(public.vbp_pos_refund_find('k508-0123456789abcdef0123456789abcdeX', 'VB-RF001') ->> 'why' = 'refused'
       and public.vbp_pos_refund_request('k508-0123456789abcdef0123456789abcdeX', 'VB-RF001', 100, false, 'Wrong size',
             'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true) ->> 'why' = 'refused'
       and public.vbp_pos_refunds('k508-0123456789abcdef0123456789abcdeX') ->> 'why' = 'refused'
       and public.vbp_pos_refund_find('', 'VB-RF001') ->> 'why' = 'refused',
       'a wrong key, or none, is refused at all three doors');
select chk(err('select * from public.refunds') like '%permission denied%',
       'the public key cannot read the refunds');

-- 3) FIND THE PAYMENT --------------------------------------------------------------------------
select chk(bool_and(coalesce(public.vbp_pos_refund_find(k(), q) -> 'order' ->> 'ref' = 'VB-RF001', false)) and count(*) = 7,
       'found by the order number (any capitals), the receipt or invoice number, our payment reference, '
       || 'or Flutterwave''s transaction number or reference')
  from unnest(array['VB-RF001', 'vb-rf001', 'R-0001', 'INV-0001', 'VB-RF001-aaaa', '900001', 'FLW-REF-1']) q;
select chk((public.vbp_pos_refund_find(k(), 'VB-NONE1') ->> 'found')::boolean = false
       and public.vbp_pos_refund_find(k(), 'ab') ->> 'why' = 'unreadable',
       'nothing found says so; a search too short is not asked');
select chk(f -> 'order' ->> 'name' = 'Refund Buyer' and f -> 'order' ->> 'phone' = '0970000201'
       and f -> 'order' ->> 'email' = 'buyer@shop.test' and f -> 'order' ->> 'address' = 'Plot 1, Lusaka'
       and jsonb_array_length(f -> 'order' -> 'items') = 2
       and f -> 'order' -> 'till' ->> 'receiptNo' = 'R-0001',
       'the customer''s details, the pieces and the till''s receipt come with it')
  from (select public.vbp_pos_refund_find(k(), 'VB-RF001') as f) x;
select chk(f -> 'refund' -> 'pay' ->> 'flwTxId' = '900001' and f -> 'refund' -> 'pay' ->> 'flwRef' = 'FLW-REF-1'
       and f -> 'refund' -> 'pay' ->> 'channel' = 'card' and (f -> 'refund' -> 'pay' ->> 'test')::boolean = false
       and (f -> 'refund' ->> 'paid')::numeric = 1500 and (f -> 'refund' ->> 'left')::numeric = 1500
       and (f -> 'refund' ->> 'canRefund')::boolean and (f -> 'refund' ->> 'rungUp')::boolean
       and not (f -> 'refund' ->> 'wholeOnly')::boolean and jsonb_array_length(f -> 'refund' -> 'refunds') = 0,
       'the payment Flutterwave said was paid (not the failed try before it), what was paid, and all of it to refund')
  from (select public.vbp_pos_refund_find(k(), 'VB-RF001') as f) x;
select chk(public.vbp_pos_refund_find(k(), 'VB-RF004') -> 'refund' ->> 'why' = 'not_online'
       and public.vbp_pos_refund_find(k(), 'VB-RF005') -> 'refund' ->> 'why' = 'review'
       and public.vbp_pos_refund_find(k(), 'VB-RF006') -> 'refund' ->> 'why' = 'no_tx'
       and public.vbp_pos_refund_find(k(), 'VB-RF007') -> 'refund' ->> 'why' = 'old_sale'
       and public.vbp_pos_refund_find(k(), 'VB-RF008') -> 'refund' ->> 'why' = 'not_paid'
       and public.vbp_pos_refund_find(k(), 'VB-RF003') -> 'refund' ->> 'why' = 'being_rung_up',
       'it says why one cannot be refunded: not paid online, needs attention, no Flutterwave number, '
       || 'sold the old way, not paid yet, being rung up');
select chk((f -> 'refund' -> 'pay' ->> 'test')::boolean and (f -> 'refund' ->> 'wholeOnly')::boolean
       and (f -> 'refund' ->> 'canRefund')::boolean and not (f -> 'refund' ->> 'rungUp')::boolean,
       'a test payment says so; an order not rung up yet can be refunded only whole')
  from (select public.vbp_pos_refund_find(k(), 'VB-RF002') as f) x;

-- 4) "REFUND THIS": WHAT IS REFUSED ------------------------------------------------------------
select chk(bool_and(coalesce(r ->> 'why' = 'unreadable', false)) and count(*) = 7,
       'refused unread: no order number, a short request key, nothing to refund, no reason, nobody named, a strange refund number')
  from (select public.vbp_pos_refund_request(k(), 'RF001', 100, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true) r
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', 100, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'short', true)
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', 0, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true)
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', -5, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true)
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', 100, false, '  ', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true)
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', 100, false, 'Wrong size', ' ', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true)
        union all select public.vbp_pos_refund_request(k(), 'VB-RF001', 100, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF 2026 0001', 'orf-key-000000000001', true)) x;
select chk(public.vbp_pos_refund_request(k(), 'VB-NONE1', 100, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true) ->> 'why' = 'not_found',
       'an order that is not there');
select chk(r ->> 'why' = 'too_much' and (r ->> 'left')::numeric = 1500,
       'never more than was paid: K2,000 of K1,500 is refused, and it says how much is left')
  from (select public.vbp_pos_refund_request(k(), 'VB-RF001', 2000, false, 'Wrong size', 'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true) r) x;
select chk(public.vbp_pos_refund_request(k(), 'VB-RF004', 100, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000041', true) ->> 'why' = 'not_online'
       and public.vbp_pos_refund_request(k(), 'VB-RF005', 400, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000051', true) ->> 'why' = 'review'
       and public.vbp_pos_refund_request(k(), 'VB-RF006', 500, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000061', true) ->> 'why' = 'no_tx'
       and public.vbp_pos_refund_request(k(), 'VB-RF007', 700, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000071', true) ->> 'why' = 'old_sale'
       and public.vbp_pos_refund_request(k(), 'VB-RF008', 900, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000081', true) ->> 'why' = 'not_paid'
       and public.vbp_pos_refund_request(k(), 'VB-RF003', 600, true, 'Wrong size', 'A. Manager', 'Store Manager', null, 'orf-key-000000000031', true) ->> 'why' = 'being_rung_up',
       'and each one that cannot be refunded is refused, for the same reason the search gave');
reset role;
select chk((select count(*) from public.refunds) = 0, 'nothing refused was written down');

-- 5) "REFUND THIS": WRITTEN DOWN, ONCE --------------------------------------------------------------
set role anon;
reset role;
create table public.got (name text primary key, a jsonb);
grant all on public.got to anon, authenticated, service_role;
set role anon;
insert into got values ('first', public.vbp_pos_refund_request(k(), 'VB-RF001', 400.004, false, '  Wrong   size ',
  'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true));
select chk((a ->> 'ok')::boolean and not (a ->> 'again')::boolean and a -> 'refund' ->> 'state' = 'new'
       and (a -> 'refund' ->> 'amount')::numeric = 400 and a -> 'refund' ->> 'by' = 'A. Manager'
       and a -> 'refund' ->> 'byRole' = 'Store Manager' and a -> 'refund' ->> 'reason' = 'Wrong size'
       and a -> 'refund' ->> 'platformRef' = 'ORF-2026-0001' and a -> 'refund' ->> 'flwTxId' = '900001'
       and not (a -> 'refund' ->> 'whole')::boolean and (a -> 'refund' ->> 'rungUp')::boolean,
       'K400 of a sale rung up: written down as new, to the ngwee, with who asked, their role, the reason and the platform''s number')
  from got where name = 'first';
insert into got values ('again', public.vbp_pos_refund_request(k(), 'VB-RF001', 400, false, 'Wrong size',
  'A. Manager', 'Store Manager', 'ORF-2026-0001', 'orf-key-000000000001', true));
select chk((g.a ->> 'again')::boolean and rid(g.a) = rid(f.a),
       'the same request again (a double press, a second try after a lost answer) is the same refund')
  from got g, got f where g.name = 'again' and f.name = 'first';
select chk(public.vbp_pos_refund_request(k(), 'VB-RF001', 100, false, 'Another', 'A. Manager', 'Store Manager', 'ORF-2026-0002',
             'orf-key-000000000002', true) ->> 'why' = 'in_flight',
       'a second refund of the same order waits until the first has Flutterwave''s answer');
reset role;
select chk((select count(*) from public.refunds where order_ref = 'VB-RF001') = 1
       and (select status from public.orders where ref = 'VB-RF001') = 'completed',
       'one refund written down, and a sale already rung up stays as it is');

-- 6) THE PAYMENT SERVICE RECORDS WHAT FLUTTERWAVE SAID ------------------------------------------------
set role service_role;
with u as (update public.refunds set state = 'sending', sent_at = now()
            where id = (select rid(a) from got where name = 'first') and state = 'new' returning 1)
insert into got select 'take1', to_jsonb(count(*)) from u;
with u as (update public.refunds set state = 'sending', sent_at = now()
            where id = (select rid(a) from got where name = 'first') and state = 'new' returning 1)
insert into got select 'take2', to_jsonb(count(*)) from u;
select chk((select a::text from got where name = 'take1') = '1' and (select a::text from got where name = 'take2') = '0',
       'sending: of two at once, exactly one takes it');
update public.refunds set state = 'pending', flw_refund_id = 'RF-1', flw_status = 'pending', accepted_at = now(),
       detail = '{"flw_ref":"URF_1"}' where id = (select rid(a) from got where name = 'first');
reset role;
select chk(refund_state = 'part' and refund_amount = 400 and refund_ref = 'URF_1' and refund_note = 'Wrong size'
       and refund_at is not null and refund_mailed_at is null,
       'accepted: the order says Part refunded K400, with Flutterwave''s reference, and the customer is to be told')
  from public.orders where ref = 'VB-RF001';
set role anon;
select chk((f -> 'refund' ->> 'refunded')::numeric = 400 and (f -> 'refund' ->> 'left')::numeric = 1100
       and (f -> 'refund' ->> 'canRefund')::boolean
       and f -> 'refund' -> 'refunds' -> 0 ->> 'state' = 'pending' and f -> 'refund' -> 'refunds' -> 0 ->> 'flwRefundId' = 'RF-1',
       'the search now shows the refund, K400 refunded and K1,100 left')
  from (select public.vbp_pos_refund_find(k(), 'VB-RF001') as f) x;
select chk(public.vbp_pos_refund_request(k(), 'VB-RF001', 1100.01, false, 'The rest', 'A. Manager', 'Store Manager', 'ORF-2026-0002',
             'orf-key-000000000002', true) ->> 'why' = 'too_much',
       'with K400 accepted, a ngwee more than the K1,100 left is refused');
insert into got values ('rest', public.vbp_pos_refund_request(k(), 'VB-RF001', 1100, true, 'Not delivered',
  'B. Director', 'Managing Director', 'ORF-2026-0002', 'orf-key-000000000002', true));
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where id = (select rid(a) from got where name = 'rest');
update public.refunds set state = 'completed', flw_refund_id = 'RF-2', flw_status = 'completed', accepted_at = now(),
       completed_at = now(), detail = '{"flw_ref":"URF_2"}' where id = (select rid(a) from got where name = 'rest');
reset role;
select chk(refund_state = 'full' and refund_amount = 1500 and refund_ref = 'URF_2',
       'the rest accepted and completed at once: the order says Refunded K1,500')
  from public.orders where ref = 'VB-RF001';
set role anon;
select chk(public.vbp_pos_refund_find(k(), 'VB-RF001') -> 'refund' ->> 'why' = 'refunded'
       and public.vbp_pos_refund_request(k(), 'VB-RF001', 1, false, 'Once more', 'A. Manager', 'Store Manager', null,
             'orf-key-000000000003', true) ->> 'why' = 'refunded',
       'refunded in full: nothing more can be refunded');
reset role;

-- 7) NOTHING GOES BACK, NOTHING CHANGES WHAT WAS ASKED, NOTHING IS DELETED -----------------------------
set role service_role;
select chk(err($q$update public.refunds set state = 'pending' where order_ref = 'VB-RF001' and flw_refund_id = 'RF-2'$q$) like '%cannot go from completed to pending%'
       and err($q$update public.refunds set state = 'new' where flw_refund_id = 'RF-1'$q$) like '%cannot go from pending to new%',
       'where a refund stands only moves forward');
select chk(err($q$update public.refunds set amount = 1 where flw_refund_id = 'RF-1'$q$) like '%never changes%'
       and err($q$update public.refunds set reason = 'something else' where flw_refund_id = 'RF-1'$q$) like '%never changes%'
       and err($q$update public.refunds set by_name = 'Somebody Else' where flw_refund_id = 'RF-1'$q$) like '%never changes%'
       and err($q$update public.refunds set provider_tx_id = '1' where flw_refund_id = 'RF-1'$q$) like '%never changes%',
       'what it asked (the amount, the reason, who, the payment) never changes, even for the payment service');
select chk(err($q$update public.refunds set flw_refund_id = 'RF-OTHER' where flw_refund_id = 'RF-1'$q$) like '%never changes%'
       and err($q$update public.refunds set accepted_at = now() - interval '1 day' where flw_refund_id = 'RF-1'$q$) like '%never change%',
       'Flutterwave''s reference and the times, once written, never change');
select chk(err($q$delete from public.refunds$q$) like '%permission denied%'
       and err($q$insert into public.refunds (request_key, order_ref, provider_tx_id, mode, currency, amount, reason, by_name)
                  values ('orf-key-0000000000zz', 'VB-RF009', '900009', 'live', 'ZMW', 5, 'x', 'y')$q$) like '%permission denied%',
       'the payment service cannot delete a refund, or make one');
reset role;
select chk(err($q$delete from public.refunds where flw_refund_id = 'RF-1'$q$) like '%never deleted%'
       and err($q$insert into public.refunds (request_key, order_ref, provider_tx_id, mode, currency, amount, reason, by_name)
                  values ('orf-key-0000000000zz', 'VB-RF009', '900009', 'live', 'ZMW', 5, 'x', 'y')$q$) = '',
       'not even the database''s owner deletes one; a refund made by the owner, by hand, is still a new one');
set vq.refund_upkeep = 'yes';
delete from public.refunds where request_key = 'orf-key-0000000000zz';
reset vq.refund_upkeep;
set role authenticated;
select chk(err($q$update public.refunds set state = 'failed'$q$) like '%permission denied%'
       and (select count(*) from public.refunds) = 0,
       'a customer signed in can neither change nor see any refund');
reset role;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((select count(*) from public.refunds) = 2, 'an administrator can read them all');
reset role;
delete from auth.whoami;

-- 8) BEFORE THE TILL: WHOLE ONLY, CANCELLED AT ONCE, PUT BACK IF FLUTTERWAVE SAYS NO ------------------------
set role anon;
select chk(public.vbp_pos_refund_request(k(), 'VB-RF002', 300, false, 'Out of stock', 'A. Manager', 'Store Manager', null,
             'orf-key-000000000020', true) ->> 'why' = 'whole_only'
       and public.vbp_pos_refund_request(k(), 'VB-RF002', 800, false, 'Out of stock', 'A. Manager', 'Store Manager', null,
             'orf-key-000000000021', true) ->> 'why' = 'whole_only'
       and public.vbp_pos_refund_request(k(), 'VB-RF002', 300, true, 'Out of stock', 'A. Manager', 'Store Manager', null,
             'orf-key-000000000022', true) ->> 'why' = 'whole_only',
       'not rung up yet: part of it is refused, and so is the whole of it not asked for as the whole');
insert into got values ('before', public.vbp_pos_refund_request(k(), 'VB-RF002', 800, true, 'Out of stock',
  'A. Manager', 'Store Manager', 'ORF-2026-0003', 'orf-key-000000000023', true));
reset role;
select chk((select status from public.orders where ref = 'VB-RF002') = 'cancelled'
       and (select prev_status = 'confirmed' and mode = 'test' and not rung_up and whole from public.refunds
             where id = (select rid(a) from got where name = 'before')),
       'the whole of it: written down (a test payment, refunded in test mode), and the order cancelled at once');
set role anon;
select chk(public.vbp_pos_order_claim(k(), 'VB-RF002', 'claim-rf002-abcdef', 'Till 1') ->> 'why' = 'cancelled',
       'so no till can ring it up while its money goes back');
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where id = (select rid(a) from got where name = 'before');
update public.refunds set state = 'refused', flw_message = 'Insufficient balance', detail = '{"status":"error"}'
 where id = (select rid(a) from got where name = 'before');
reset role;
select chk(status = 'confirmed' and refund_state is null, 'Flutterwave said no: the order is put back as it was, and says nothing was refunded')
  from public.orders where ref = 'VB-RF002';
set role anon;
select chk((f -> 'refund' ->> 'canRefund')::boolean and (f -> 'refund' ->> 'left')::numeric = 800
       and f -> 'refund' -> 'refunds' -> 0 ->> 'state' = 'refused' and f -> 'refund' -> 'refunds' -> 0 ->> 'message' = 'Insufficient balance',
       'and it can be refunded again; the refusal stays in its history, with Flutterwave''s words')
  from (select public.vbp_pos_refund_find(k(), 'VB-RF002') as f) x;
reset role;
-- An order the shop had cancelled already, paid: refunded whole, it stays cancelled whatever Flutterwave says.
update public.orders set status = 'cancelled' where ref = 'VB-RF002';
set role anon;
insert into got values ('cancelled', public.vbp_pos_refund_request(k(), 'VB-RF002', 800, true, 'Shop cancelled',
  'A. Manager', 'Store Manager', 'ORF-2026-0004', 'orf-key-000000000024', true));
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where id = (select rid(a) from got where name = 'cancelled');
update public.refunds set state = 'refused', flw_message = 'Below the minimum' where id = (select rid(a) from got where name = 'cancelled');
reset role;
select chk((select status from public.orders where ref = 'VB-RF002') = 'cancelled',
       'an order the shop had cancelled itself stays cancelled when Flutterwave says no');

-- 9) ACCEPTED, THEN FAILED; NOT TOLD; AN ANSWER LOST ON THE LINE ------------------------------------------
set role anon;
insert into got values ('fails', public.vbp_pos_refund_request(k(), 'VB-RF009', 1000, true, 'Faulty zip',
  'A. Manager', 'Store Manager', 'ORF-2026-0005', 'orf-key-000000000090', false));
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where id = (select rid(a) from got where name = 'fails');
update public.refunds set state = 'pending', flw_refund_id = 'RF-9', accepted_at = now() where id = (select rid(a) from got where name = 'fails');
reset role;
select chk(refund_state = 'full' and refund_mailed_at is not null,
       'not to be told: the order says Refunded, and no email waits for it')
  from public.orders where ref = 'VB-RF009';
set role service_role;
update public.refunds set state = 'failed', flw_status = 'failed', failed_at = now() where id = (select rid(a) from got where name = 'fails');
reset role;
select chk(refund_state is null and refund_amount is null, 'failed after it was accepted: the order no longer says refunded, because it was not')
  from public.orders where ref = 'VB-RF009';
set role anon;
select chk((public.vbp_pos_refund_find(k(), 'VB-RF009') -> 'refund' ->> 'left')::numeric = 1000,
       'and the whole K1,000 can be refunded again (Try again on the platform)');
insert into got values ('lost', public.vbp_pos_refund_request(k(), 'VB-RF009', 1000, true, 'Faulty zip',
  'A. Manager', 'Store Manager', 'ORF-2026-0006', 'orf-key-000000000091', true));
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where id = (select rid(a) from got where name = 'lost');
update public.refunds set state = 'unknown', flw_message = 'no answer' where id = (select rid(a) from got where name = 'lost');
reset role;
set role anon;
select chk(public.vbp_pos_refund_request(k(), 'VB-RF009', 1000, true, 'Faulty zip', 'A. Manager', 'Store Manager', 'ORF-2026-0007',
             'orf-key-000000000092', true) ->> 'why' = 'in_flight',
       'an answer lost on the line: nothing more is sent until Flutterwave has been asked what happened');
reset role;
set role service_role;
select chk(err($q$update public.refunds set state = 'new' where request_key = 'orf-key-000000000091'$q$) like '%cannot go from unknown to new%',
       'and a lost answer can never be sent again: it cannot go back to new');
update public.refunds set state = 'pending', flw_refund_id = 'RF-10', accepted_at = now() where id = (select rid(a) from got where name = 'lost');
update public.refunds set state = 'completed', completed_at = now() where id = (select rid(a) from got where name = 'lost');
reset role;
select chk(refund_state = 'full' and refund_amount = 1000, 'found at Flutterwave and completed: the order says Refunded')
  from public.orders where ref = 'VB-RF009';

-- 10) THE PLATFORM'S LIST -------------------------------------------------------------------------------
set role anon;
select chk(jsonb_array_length(r -> 'refunds') = 1 and r -> 'refunds' -> 0 ->> 'flwRefundId' = 'RF-1'
       and r -> 'refunds' -> 0 ->> 'state' = 'pending' and r -> 'refunds' -> 0 ->> 'acceptedAt' is not null,
       'by their ids: only those (a strange id is passed over)')
  from (select public.vbp_pos_refunds(k(), array[(select rid(a) from got where name = 'first')::text, 'not-a-uuid']) as r) x;
select chk(jsonb_array_length(public.vbp_pos_refunds(k(), null, now() - interval '1 hour') -> 'refunds') = 6
       and jsonb_array_length(public.vbp_pos_refunds(k(), null, now() + interval '1 hour') -> 'refunds') = 0
       and jsonb_array_length(public.vbp_pos_refunds(k()) -> 'refunds') = 6
       and public.vbp_pos_refunds(k()) ->> 'at' is not null,
       'changed since a time, or the latest: every refund, with the time of the answer');
select chk((select bool_and(e ? 'by' and e ? 'byRole' and e ? 'reason' and e ? 'requestedAt' and e ? 'completedAt'
                            and e ? 'platformRef' and e ? 'amount' and e ? 'state' and e ? 'test')
              from jsonb_array_elements(public.vbp_pos_refunds(k()) -> 'refunds') e),
       'each with who, their role, the reason, the amount, where it is and every date and time');
reset role;

-- 11) THE PAYMENT HISTORY (website 77) ------------------------------------------------------------------
select chk((select count(*) from public.payment_events where what = 'refund' and order_id = 'dddddddd-0000-0000-0000-000000000001') = 6
       and exists (select 1 from public.payment_events where what = 'refund' and from_state is null and to_state = 'new'
                    and note ->> 'by' = 'A. Manager' and (note ->> 'amount')::numeric = 400)
       and exists (select 1 from public.payment_events where what = 'refund' and from_state = 'sending' and to_state = 'completed'
                    and note ->> 'flwRefundId' = 'RF-2' and note ->> 'role' = 'Managing Director'),
       'each step of each refund is a line in the payment history, with who and how much');
select chk(exists (select 1 from public.payment_events where what = 'refund' and to_state = 'refused'
                    and note ->> 'message' = 'Insufficient balance' and (note ->> 'test')::boolean),
       'a refusal too, with Flutterwave''s words, and marked TEST for a test payment');

-- 12) NOTHING ELSE TOUCHED -------------------------------------------------------------------------------
select chk((select count(*) from public.payments where status = 'paid') = 6
       and (select amount from public.payments where tx_ref = 'VB-RF001-aaaa') = 1500
       and (select payment_status = 'paid' and paid_amount = 1500 and total = 1500 from public.orders where ref = 'VB-RF001')
       and (select count(*) from public.order_items where order_id = 'dddddddd-0000-0000-0000-000000000001') = 2,
       'the payments, the totals and the pieces are as they were');
select chk((select count(*) from public.pos_door_calls where kind = 'read') > 0
       and (select count(*) from public.pos_door_calls where kind = 'write') > 0,
       'the refund doors count against the same hourly limits as the till''s');

-- The result ------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   online refund database: all ' || count(*) || ' checks passed'
            else '   online refund database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
