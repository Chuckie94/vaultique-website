-- ===========================================================================
-- WEBSITE ORDERS AT THE TILL, THE DATABASE SIDE, CHECKED
-- (see tests/pos-orders-fixture.sql for how to run it)
--
-- The door the platform's till uses: only its key opens it; it hands out
-- only what it says; one order is rung up once; two tills cannot ring up
-- the same order; an order waiting for its online payment, cancelled or
-- completed cannot be rung up; a completed order carries its receipt, which
-- its customer can read and nobody can forge.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon, authenticated, service_role;
grant usage on sequence checks_n_seq to anon, authenticated, service_role;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;

-- A known key for the test, in place of the one the file made (the file
-- keeps only a fingerprint, so the test cannot read that one back).
update public.pos_door_key set fingerprint = sha256(convert_to('k508-0123456789abcdef0123456789abcdef', 'UTF8'));
create or replace function k() returns text language sql immutable as $$ select 'k508-0123456789abcdef0123456789abcdef' $$;
grant execute on function k() to public;

-- People: an owner (admin), a customer with a linked rewards number, another
-- customer, and a guest (nobody signed in).
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@shop.test'),
  ('33333333-3333-3333-3333-333333333333', 'other@shop.test');
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner');
insert into public.customers (id, name) values
  ('22222222-2222-2222-2222-222222222222', 'Test Buyer'),
  ('33333333-3333-3333-3333-333333333333', 'Other Buyer');
insert into public.rewards_links (user_id, cust_no, how) values
  ('22222222-2222-2222-2222-222222222222', 'VBCUS0006', 'code'),
  ('33333333-3333-3333-3333-333333333333', 'VBCUS0009', 'code');

-- An order from before the door was set up (the key was made "now", so a
-- day earlier is before it).
insert into public.orders (ref, name, phone, total, currency, status, created_at)
values ('VB-OLD22', 'Before Link', '0977000001', 300, 'ZMW', 'confirmed', now() - interval '1 day');
insert into public.order_items (order_id, sku, name, price, qty)
select id, 'SKU-OLD', 'Old piece', 300, 1 from public.orders where ref = 'VB-OLD22';

-- 1) WITHOUT THE KEY, NOTHING ----------------------------------------------------
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_orders(null, null, 'open');
  perform chk(r->>'why' = 'refused' and r->'orders' is null, 'no key: the list is refused, and says nothing else');
  r := public.vbp_pos_orders('k508-0123456789abcdef0123456789abcdeX', null, 'all');
  perform chk(r->>'why' = 'refused', 'a wrong key: refused');
  r := public.vbp_pos_orders('short', null, 'all');
  perform chk(r->>'why' = 'refused', 'a short key: refused');
  r := public.vbp_pos_order('nope-nope-nope-nope-nope-nope-nope-nope', 'VB-OLD22');
  perform chk(r->>'why' = 'refused' and r->'order' is null, 'no key: one order is refused');
  r := public.vbp_pos_order_claim('nope-nope-nope-nope-nope-nope-nope-nope', 'VB-OLD22', 'till-aaaa-0001', 'X');
  perform chk(r->>'why' = 'refused', 'no key: a claim is refused');
  r := public.vbp_pos_order_complete('nope-nope-nope-nope-nope-nope-nope-nope', 'VB-OLD22', 'till-aaaa-0001',
                                     '{"saleId":"s1","receiptNo":"R1"}');
  perform chk(r->>'why' = 'refused', 'no key: completing is refused');
  r := public.vbp_pos_order_release('nope-nope-nope-nope-nope-nope-nope-nope', 'VB-OLD22', 'till-aaaa-0001');
  perform chk(r->>'why' = 'refused', 'no key: releasing is refused');
end $$;
-- The door's parts cannot be called from outside, and its tables cannot be read.
do $$ declare e text; begin
  begin perform public.pos_order_out((select id from public.orders limit 1), true); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like '%permission denied%', 'the order reader inside the door cannot be called from outside: ' || e);
  begin perform public.pos_door_key_ok('x'); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like '%permission denied%', 'nor can the key check');
  begin perform count(*) from public.pos_door_key; e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like '%permission denied%', 'the key''s fingerprint cannot be read');
end $$;
reset role;
select chk((select count(*) from public.pos_door_calls) = 0,
           'questions without the key are not counted, so they cannot use up the hour');

-- 2) ORDERS PLACED THE WAY THE WEBSITE PLACES THEM ---------------------------------
-- A guest on WhatsApp.
set role anon;
select chk((public.place_order(
  '{"name":"Guest Shopper","phone":"+260 977 123 456","fulfilment":"collection","total":450,"currency":"ZMW"}',
  '[{"sku":"SCF-01","name":"Silk scarf","price":450,"qty":1}]', null) ->> 'ref') like 'VB-%',
  'a guest''s WhatsApp order is placed as before');
reset role;
-- A customer with an account, two pieces, points promised on it.
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
create temp table placed as
select public.place_order(
  '{"name":"Test Buyer","phone":"0966 555 444","address":"Plot 1, Lusaka","fulfilment":"delivery","total":1300,"currency":"ZMW"}',
  '[{"sku":"BAG-02","name":"Leather bag","price":1000,"qty":1},{"sku":"BLT-03","name":"Belt","price":150,"qty":2}]',
  null) as r;
reset role;
delete from auth.whoami;
create or replace function myref() returns text language sql stable as $$ select r->>'ref' from placed $$;
grant select on placed to public;
grant execute on function myref() to public;
-- The points, promised the way the rewards function promises them, on the
-- order's own number. And a promise by somebody else on a number that is
-- not theirs, which must never reach the till.
insert into public.rewards_holds (user_id, cust_no, order_ref, points, value)
values ('22222222-2222-2222-2222-222222222222', 'VBCUS0006', myref(), 500, 50);
insert into public.orders (ref, customer_id, name, total, currency)
values ('VB-HOLD9', '22222222-2222-2222-2222-222222222222', 'Test Buyer', 200, 'ZMW');
insert into public.rewards_holds (user_id, cust_no, order_ref, points, value)
values ('33333333-3333-3333-3333-333333333333', 'VBCUS0009', 'VB-HOLD9', 100, 10);

-- An order paid online, one still waiting for its payment, a cancelled one,
-- one completed by hand on the website, and one delivered by hand.
insert into public.orders (ref, name, phone, total, currency, status) values
  ('VB-PAID1', 'Paid Online', '0955111222', 1530, 'ZMW', 'pending'),
  ('VB-WAIT1', 'Waiting Payer', '0955333444', 700, 'ZMW', 'pending'),
  ('VB-CANC1', 'Cancelled One', '0955000000', 100, 'ZMW', 'cancelled'),
  ('VB-DONE1', 'Hand Completed', '0955000001', 100, 'ZMW', 'completed'),
  ('VB-DELV1', 'Delivered One', '0955000002', 250, 'ZMW', 'delivered');
insert into public.order_items (order_id, sku, name, price, qty)
select id, 'DRS-04', 'Dress', 1400, 1 from public.orders where ref = 'VB-PAID1';
set role service_role;
update public.orders set payment_method = 'online', payment_status = 'paid', pay_ref = 'VB-PAID1-0a1b2c3d4e',
       pay_channel = 'mobilemoneyzambia', goods_total = 1400, delivery_fee = 130, tax_total = 0,
       paid_amount = 1530, paid_at = now() where ref = 'VB-PAID1';
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-WAIT1-0a1b2c3d4e',
       goods_total = 700, delivery_fee = 0, tax_total = 0 where ref = 'VB-WAIT1';
-- the payment service's own records of the two payments. VB-PAID1 is paid in
-- LIVE mode (build 85: only a Live payment is paid at the till; until then
-- this was a Test-mode payment, and counted).
insert into public.payments (order_id, tx_ref, mode, status, amount, currency, phone)
select id, 'VB-PAID1-0a1b2c3d4e', 'live', 'paid', 1530, 'ZMW', '0955111222' from public.orders where ref = 'VB-PAID1';
insert into public.payments (order_id, tx_ref, mode, status, amount, currency, phone)
select id, 'VB-WAIT1-0a1b2c3d4e', 'live', 'started', 700, 'ZMW', '0955333444' from public.orders where ref = 'VB-WAIT1';
reset role;
-- BUILD 85 · the shop trying online payment in Test mode: paid, with
-- Flutterwave's test card, and no money moved.
insert into public.orders (ref, name, phone, total, currency, status) values ('VB-TEST1', 'Shop Trying', '0955000777', 500, 'ZMW', 'pending');
set role service_role;
update public.orders set payment_method = 'online', payment_status = 'paid', pay_ref = 'VB-TEST1-0a1b2c3d4e',
       pay_channel = 'card', goods_total = 500, delivery_fee = 0, tax_total = 0, paid_amount = 500, paid_at = now()
 where ref = 'VB-TEST1';
insert into public.payments (order_id, tx_ref, mode, status, amount, currency, phone)
select id, 'VB-TEST1-0a1b2c3d4e', 'test', 'paid', 500, 'ZMW', '0955000777' from public.orders where ref = 'VB-TEST1';
reset role;
-- An order that says paid with no payment behind it (as if typed in by hand).
insert into public.orders (ref, name, phone, total, currency, status) values ('VB-FORG1', 'Says Paid', '0955000009', 900, 'ZMW', 'pending');
alter table public.orders disable trigger orders_payment_guard_t;
update public.orders set payment_method = 'online', payment_status = 'paid', paid_amount = 900 where ref = 'VB-FORG1';
alter table public.orders enable trigger orders_payment_guard_t;

-- 3) THE LIST AND ONE ORDER ---------------------------------------------------------
set role anon;
do $$ declare r jsonb; o jsonb; refs text; begin
  r := public.vbp_pos_orders(k(), null, 'open');
  select string_agg(x->>'ref', ' ' order by x.i) into refs
    from jsonb_array_elements(r->'orders') with ordinality x(x, i);
  perform chk(r->>'ok' = 'true', 'with the key, the list answers');
  perform chk(refs not like '%VB-CANC1%' and refs not like '%VB-DONE1%',
              'open orders leave out the cancelled and the completed: ' || refs);
  perform chk(refs like '%VB-DELV1%', 'a delivered order is still open for the till (delivered is a step of the delivery, not a sale)');
  perform chk(refs like '%VB-WAIT1%' and refs like '%VB-PAID1%',
              'an order waiting for its payment shows, and so does one paid');
  perform chk(refs not like '%VB-TEST1%',
              'build 85: an order paid in Test mode is not on the list of orders to ring up: ' || refs);
  perform chk(split_part(refs, ' ', jsonb_array_length(r->'orders')) = 'VB-OLD22',
              'newest first: the order from yesterday is last');
  o := (select x from jsonb_array_elements(r->'orders') x where x->>'ref' = 'VB-OLD22');
  perform chk((o->>'beforeLink')::boolean, 'an order placed before the door was set up says so');
  o := (select x from jsonb_array_elements(r->'orders') x where x->>'ref' = myref());
  perform chk(not (o->>'beforeLink')::boolean, 'an order placed since does not');
  perform chk(o->'items' = 'null'::jsonb and (o->>'pieces')::int = 3 and o->>'summary' = 'Leather bag, Belt',
              'the list gives the number of pieces and their names, not the lines: ' || coalesce(o->>'summary', '?'));
  -- Build 89 adds one part, delivery (the customer's instructions, the
  -- courier and the tracking number), read by name so it is there, empty,
  -- before supabase-delivery.sql is run.
  perform chk(o ?& array['ref', 'createdAt', 'status', 'name', 'phone', 'email', 'address', 'notes', 'fulfilment',
                         'total', 'currency', 'payment', 'account', 'points', 'till', 'pieces', 'summary', 'items', 'beforeLink',
                         'delivery']
              and (select count(*) from jsonb_object_keys(o)) = 20
              and o->'delivery' ?& array['instructions', 'instructionsAt', 'courier', 'tracking', 'trackingUrl', 'updates']
              and (select count(*) from jsonb_object_keys(o->'delivery')) = 6,
              'each order hands out the closed list of parts and nothing else');
  perform chk(not (o::text ~ '22222222-2222') , 'never the account''s id');

  r := public.vbp_pos_orders(k(), null, 'done');
  select string_agg(x->>'ref', ' ') into refs from jsonb_array_elements(r->'orders') x;
  perform chk(refs like '%VB-CANC1%' and refs like '%VB-DONE1%' and refs not like '%VB-PAID1%',
              'done: the cancelled and the completed: ' || refs);
  r := public.vbp_pos_orders(k(), null, 'all');
  perform chk(jsonb_array_length(r->'orders') = 11, 'all: every order, the test one too (' || jsonb_array_length(r->'orders') || ')');

  -- search
  r := public.vbp_pos_orders(k(), 'paid1', 'open');
  perform chk(jsonb_array_length(r->'orders') = 1 and r->'orders'->0->>'ref' = 'VB-PAID1', 'search: by part of the order number, any case');
  r := public.vbp_pos_orders(k(), 'hand comp', 'open');
  perform chk(jsonb_array_length(r->'orders') = 1 and r->'orders'->0->>'ref' = 'VB-DONE1',
              'search: by name, and it looks at every order, completed ones too');
  r := public.vbp_pos_orders(k(), '977 123', 'open');
  perform chk(jsonb_array_length(r->'orders') = 1 and r->'orders'->0->>'name' = 'Guest Shopper',
              'search: by phone, however it was typed (+260 977 123 456 found by "977 123")');
  r := public.vbp_pos_orders(k(), '50%_', 'all');
  perform chk(jsonb_array_length(r->'orders') = 0, 'search: % and _ are letters, not wildcards');

  -- one order
  r := public.vbp_pos_order(k(), lower(myref()));
  o := r->'order';
  perform chk(r->>'found' = 'true' and o->>'ref' = myref(), 'one order, by its number in any case');
  perform chk(jsonb_array_length(o->'items') = 2
              and o->'items'->0 = '{"sku":"BAG-02","name":"Leather bag","price":1000,"qty":1}'::jsonb
              and o->'items'->1 = '{"sku":"BLT-03","name":"Belt","price":150,"qty":2}'::jsonb,
              'with its pieces, in the order they were placed, at the price shown: ' || (o->'items')::text);
  perform chk(o->'account' = '{"has":true,"custNo":"VBCUS0006"}'::jsonb,
              'placed from an account, with its customer number: ' || (o->'account')::text);
  perform chk(o->'points' = '{"points":500,"value":50.00,"custNo":"VBCUS0006","status":"promised"}'::jsonb,
              'with the points promised on it: ' || coalesce((o->'points')::text, 'none'));
  perform chk(o->'payment' = '{"online":false}'::jsonb, 'a WhatsApp order: not paid online');
  r := public.vbp_pos_order(k(), 'VB-HOLD9');
  perform chk(r->'order'->'points' = 'null'::jsonb,
              'points promised by somebody else on an order that is not theirs never reach the till');
  r := public.vbp_pos_order(k(), 'VB-PAID1');
  perform chk(r->'order'->'payment' @> '{"online":true,"status":"paid","channel":"mobilemoneyzambia","goods":1400,"delivery":130,"paid":1530,"verified":true}'::jsonb,
              'paid online: how much, how, the goods and the delivery, and the payment service''s record agrees: ' || (r->'order'->'payment')::text);
  perform chk(r->'order'->'payment' @> '{"test":false}'::jsonb, 'and it is no test: ' || (r->'order'->'payment')::text);
  r := public.vbp_pos_order(k(), 'VB-TEST1');
  perform chk(r->'order'->'payment' @> '{"online":true,"status":"paid","verified":false,"test":true}'::jsonb,
              'build 85: paid in Test mode: not taken as paid, and said to be a test: ' || (r->'order'->'payment')::text);
  r := public.vbp_pos_orders(k(), 'VB-TEST1', 'open');
  perform chk(jsonb_array_length(r->'orders') = 1 and r->'orders'->0->'payment' @> '{"test":true,"verified":false}'::jsonb,
              'a search by its number still finds it, marked a test');
  r := public.vbp_pos_order(k(), 'VB-FORG1');
  perform chk(r->'order'->'payment' @> '{"online":true,"status":"paid","verified":false}'::jsonb,
              'an order that only says paid, with no payment behind it, is not taken as paid');
  perform chk(r->'order'->'account' = '{"has":false,"custNo":null}'::jsonb, 'a guest''s order: no account');
  r := public.vbp_pos_order(k(), 'VB-NOPE9');
  perform chk(r->>'ok' = 'true' and r->>'found' = 'false', 'a number nobody has: not found');
  r := public.vbp_pos_order(k(), 'x'' or 1=1 --');
  perform chk(r->>'found' = 'false', 'something that is not an order number: not found, and not counted');
end $$;
reset role;

-- 4) CLAIMING: ONE TILL AT A TIME -----------------------------------------------------
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_order_claim(k(), myref(), 'till-aaaa-0001', 'Mary (Till 1)');
  perform chk(r->>'ok' = 'true' and r->'order'->>'ref' = myref() and jsonb_array_length(r->'order'->'items') = 2,
              'a till claims the order and gets it whole');
  perform chk(r->'order'->'till'->>'claimedBy' = 'Mary (Till 1)' and r->'order'->'till'->>'claimId' = 'till-aaaa-0001',
              'the claim says which till and who');
  r := public.vbp_pos_order_claim(k(), myref(), 'till-bbbb-0002', 'John (Till 2)');
  perform chk(r->>'ok' = 'false' and r->>'why' = 'claimed' and r->>'claimedBy' = 'Mary (Till 1)' and r->>'claimedAt' is not null,
              'a second till is refused, and told who has it and since when');
  r := public.vbp_pos_order_claim(k(), myref(), 'till-aaaa-0001', 'Mary (Till 1)');
  perform chk(r->>'ok' = 'true', 'the same till asking again is fine');
  r := public.vbp_pos_order_release(k(), myref(), 'till-bbbb-0002');
  perform chk(r->>'released' = 'false', 'another till cannot release a claim that is not its own');
  r := public.vbp_pos_order_release(k(), myref(), 'till-aaaa-0001');
  perform chk(r->>'released' = 'true', 'the till that claimed it can let it go');
  r := public.vbp_pos_order_claim(k(), myref(), 'till-bbbb-0002', 'John (Till 2)');
  perform chk(r->>'ok' = 'true', 'and then the other till can claim it');
  r := public.vbp_pos_order_claim(k(), myref(), 'till-aaaa-0001', 'Mary (Till 1)', true);
  perform chk(r->>'ok' = 'true' and r->'order'->'till'->>'claimedBy' = 'Mary (Till 1)',
              'taking over a claim works only when the till asks for it (after somebody confirmed)');

  r := public.vbp_pos_order_claim(k(), 'VB-CANC1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'cancelled', 'a cancelled order cannot be rung up');
  r := public.vbp_pos_order_claim(k(), 'VB-DONE1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'completed', 'an order completed on the website cannot be rung up');
  r := public.vbp_pos_order_claim(k(), 'VB-WAIT1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'awaiting_payment' and r->>'payment' = 'awaiting',
              'an order still waiting for its online payment cannot be rung up, so nobody pays twice');
  r := public.vbp_pos_order_claim(k(), 'VB-PAID1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'ok' = 'true', 'once paid online, it can');
  r := public.vbp_pos_order_claim(k(), 'VB-TEST1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'awaiting_payment' and r->>'test' = 'true',
              'build 85: paid in Test mode, it cannot be rung up, and the till is told it is a test: ' || r::text);
  r := public.vbp_pos_order_claim(k(), 'VB-FORG1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'awaiting_payment',
              'an order that only says paid, with no payment behind it, cannot be rung up as paid');
  r := public.vbp_pos_order_claim(k(), 'VB-DELV1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'ok' = 'true', 'a delivered order can be rung up');
  r := public.vbp_pos_order_claim(k(), 'VB-NOPE9', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'not_found', 'a number nobody has: not found');
  r := public.vbp_pos_order_claim(k(), myref(), 'bad claim!', 'Mary');
  perform chk(r->>'why' = 'unreadable', 'a claim reference that is not one: unreadable');
end $$;
reset role;

-- 5) COMPLETED, WITH ITS RECEIPT ----------------------------------------------------------
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_order_complete(k(), myref(), 'till-aaaa-0001', jsonb_build_object(
    'saleId', 'S-1001', 'receiptNo', 'RCT-000123', 'invoiceNo', 'INV-2026-0456', 'pointsUsed', 500,
    'receipt', jsonb_build_object(
      'shop', jsonb_build_object('name', 'VAULTIQUE BOUTIQUE', 'address', 'Lusaka', 'contact', '+260 97x', 'secret', 'dropped'),
      'receiptNo', 'RCT-000123', 'invoiceNo', 'INV-2026-0456', 'date', '2026-11-15T10:42:00.000Z',
      'cashier', 'Mary', 'customer', 'Test Buyer', 'currency', 'ZMW',
      'lines', jsonb_build_array(
        jsonb_build_object('sku', 'BAG-02', 'name', 'Leather bag', 'qty', 1, 'unit', 1000, 'total', 1000, 'cost', 400),
        jsonb_build_object('sku', 'BLT-03', 'name', repeat('B', 400), 'qty', 2, 'unit', 150, 'total', 300)),
      'delivery', 0, 'total', 1300, 'points', jsonb_build_object('points', 500, 'value', 50),
      'amountPaid', 1250, 'payments', jsonb_build_array(jsonb_build_object('method', 'Mobile Money', 'amount', 1250, 'ref', 'MM123')),
      'footer', 'Thank you', 'margin', 999)));
  perform chk(r->>'ok' = 'true' and r->>'again' = 'false' and r->>'receiptNo' = 'RCT-000123', 'the sale completes the order');
  r := public.vbp_pos_order_complete(k(), myref(), 'till-aaaa-0001', '{"saleId":"S-1001","receiptNo":"RCT-000123"}');
  perform chk(r->>'ok' = 'true' and r->>'again' = 'true',
              'the same sale sent again (an answer lost on the way back) is fine and changes nothing');
  r := public.vbp_pos_order_complete(k(), myref(), 'till-bbbb-0002', '{"saleId":"S-2002","receiptNo":"RCT-000124"}');
  perform chk(r->>'ok' = 'false' and r->>'why' = 'rung_up' and r->>'receiptNo' = 'RCT-000123' and r->>'saleId' = 'S-1001',
              'a second sale for the same order is refused, and the first one named');
  r := public.vbp_pos_order_claim(k(), myref(), 'till-cccc-0003', 'Ann', true);
  perform chk(r->>'why' = 'rung_up' and r->>'receiptNo' = 'RCT-000123',
              'an order already rung up cannot be claimed again, even by taking over');
  r := public.vbp_pos_order(k(), myref());
  perform chk(r->'order'->>'status' = 'completed' and r->'order'->'till'->>'receiptNo' = 'RCT-000123'
              and r->'order'->'till'->>'invoiceNo' = 'INV-2026-0456' and r->'order'->'till'->>'saleId' = 'S-1001'
              and r->'order'->'till'->>'completedAt' is not null and r->'order'->'till'->>'claimId' is null,
              'the order says completed, with the sale, and no claim left on it');
  perform chk(r->'order'->'points'->>'status' = 'rung_up', 'the points promised on it are settled as rung up');
  -- an order completed with no points taken lets its promise go
  r := public.vbp_pos_order_complete(k(), 'VB-PAID1', 'till-aaaa-0001', '{"saleId":"S-1002","receiptNo":"RCT-000125","pointsUsed":0}');
  perform chk(r->>'ok' = 'true', 'the paid-online order completes');
  r := public.vbp_pos_order_complete(k(), 'VB-NOPE9', 'till-aaaa-0001', '{"saleId":"S-1","receiptNo":"R"}');
  perform chk(r->>'why' = 'not_found', 'completing a number nobody has: not found');
  r := public.vbp_pos_order_complete(k(), 'VB-DELV1', 'till-aaaa-0001', '{"receiptNo":"R"}');
  perform chk(r->>'why' = 'unreadable', 'completing with no sale: unreadable');
  r := public.vbp_pos_order_complete(k(), 'VB-DELV1', 'till-aaaa-0001', '"S-1"');
  perform chk(r->>'why' = 'unreadable', 'completing with something that is not a sale: unreadable');
end $$;
reset role;
-- what was kept of the receipt
select chk((select pos_receipt -> 'shop' from public.orders where ref = myref())
           = '{"name":"VAULTIQUE BOUTIQUE","address":"Lusaka","contact":"+260 97x"}'::jsonb,
           'the receipt keeps only what a receipt says: an unknown part of the shop is dropped');
select chk((select not (pos_receipt ? 'margin') and not (pos_receipt -> 'lines' -> 0 ? 'cost')
                   and length(pos_receipt -> 'lines' -> 1 ->> 'name') = 200
              from public.orders where ref = myref()),
           'nothing it does not know (no margin, no cost) and every part cut to its length');
select chk((select pos_receipt -> 'points' = '{"points":500,"value":50}'::jsonb
                   and pos_receipt ->> 'amountPaid' = '1250' and pos_receipt -> 'payments' -> 0 ->> 'method' = 'Mobile Money'
              from public.orders where ref = myref()),
           'the points used, what was paid and how are kept');
select chk((select status from public.rewards_holds where order_ref = myref()) = 'rung_up'
           and (select decided_at from public.rewards_holds where order_ref = myref()) is not null,
           'the rewards promise is marked rung up');
select chk((select payment_status = 'paid' and paid_amount = 1530 and status = 'completed'
              from public.orders where ref = 'VB-PAID1'),
           'a paid-online order completed by the till keeps its payment exactly as it was');

-- 6) NOBODY ELSE WRITES THE TILL'S PART -------------------------------------------------
-- The owner, signed in to the website's admin.
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ declare e text; begin
  begin update public.orders set pos_receipt_no = 'FAKE' where ref = 'VB-DELV1'; e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'the till''s details are set by the platform only%', 'an admin cannot write a receipt number: ' || e);
  begin update public.orders set pos_sale_id = null where ref = myref(); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'the till''s details are set by the platform only%', 'nor take the sale off an order to ring it up again');
  begin update public.orders set pos_claim_id = null where ref = 'VB-DELV1'; e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'the till''s details are set by the platform only%', 'nor clear a till''s claim');
  begin update public.orders set status = 'confirmed', updated_at = now() where ref = 'VB-OLD22'; e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'none', 'the Orders tab still changes a status, exactly as before');
end $$;
reset role;
delete from auth.whoami;
-- A guest cannot file an order that already carries a receipt.
set role anon;
do $$ declare e text; begin
  begin insert into public.orders (ref, name, status, pos_receipt_no) values ('VB-FAKE1', 'x', 'pending', 'R'); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'the till''s details are set by the platform only%', 'nobody can file an order already rung up');
end $$;
reset role;
-- The customer reads their own receipt; another customer cannot.
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select pos_receipt ->> 'receiptNo' from public.orders where ref = myref()) = 'RCT-000123',
           'the customer who placed it reads its receipt (for the download)');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
select chk((select count(*) from public.orders where ref = myref()) = 0, 'another customer cannot see it at all');
reset role;
delete from auth.whoami;

-- 7) THE HOUR'S ALLOWANCE -------------------------------------------------------------------
insert into public.pos_door_calls (kind) select 'read' from generate_series(1, 2000);
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_orders(k(), null, 'open');
  perform chk(r->>'why' = 'busy', 'past 2,000 readings in an hour: busy');
  r := public.vbp_pos_order_claim(k(), 'VB-DELV1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'ok' = 'true', 'claiming and completing have an allowance of their own');
end $$;
reset role;
insert into public.pos_door_calls (kind) select 'write' from generate_series(1, 600);
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_order_complete(k(), 'VB-DELV1', 'till-aaaa-0001', '{"saleId":"S-9","receiptNo":"R9"}');
  perform chk(r->>'why' = 'busy', 'past 600 claims and completions in an hour: busy');
end $$;
reset role;
select chk((select pos_sale_id from public.orders where ref = 'VB-DELV1') is null, 'and nothing was done while busy');
delete from public.pos_door_calls;
update public.pos_door_calls set at = now() - interval '2 days';

-- 8) A NEW KEY ----------------------------------------------------------------------------
-- The way the file's notes say to make a new one: the old one stops working.
update public.pos_door_key set fingerprint = sha256(convert_to('k508-new-key-0123456789abcdef0123456789', 'UTF8'));
set role anon;
select chk((public.vbp_pos_orders(k(), null, 'open') ->> 'why') = 'refused', 'after a new key is made, the old one is refused');
select chk((public.vbp_pos_orders('k508-new-key-0123456789abcdef0123456789', null, 'open') ->> 'ok') = 'true', 'and the new one opens the door');
reset role;

-- The result ---------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   pos orders database: all ' || count(*) || ' checks passed'
            else '   pos orders database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
