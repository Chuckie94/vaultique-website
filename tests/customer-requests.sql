-- ===========================================================================
-- CUSTOMER REQUESTS, THE DATABASE SIDE, CHECKED (website build 87)
--
-- Loaded by tools/sql-tests.sh after: the till's chain (tests/pos-orders-
-- fixture.sql, supabase-setup.sql, supabase-payments.sql, tests/pos-orders-
-- admins.sql, supabase-rewards.sql, supabase-pos-orders.sql),
-- supabase-payment-history.sql, tests/order-progress-fixture.sql,
-- supabase-order-progress.sql, then supabase-customer-requests.sql TWICE (it
-- is safe to run again). Then this file.
--
-- A signed-in customer asks, on their own order only, at the right moment
-- only; the platform answers with the door's key, an administrator with the
-- orders permission; nobody else; and the customer never reads who decided.
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
create or replace function who(p uuid) returns void language plpgsql security definer as $$
begin delete from auth.whoami; if p is not null then insert into auth.whoami values (p); end if; end $$;
grant execute on function who(uuid) to public;
create or replace function setting(p jsonb) returns void language plpgsql security definer as $$
begin
  insert into public.site_settings (key, data) values ('customer-accounts', p)
  on conflict (key) do update set data = excluded.data;
end $$;
grant execute on function setting(jsonb) to public;
-- The id of a request by its order and kind, for the checks to use.
create or replace function rq(p_ref text, p_kind text) returns uuid language sql security definer as $$
  select id from public.order_requests where order_ref = p_ref and kind = p_kind order by created_at desc limit 1 $$;
grant execute on function rq(text, text) to public;
create or replace function oid_of(p_ref text) returns uuid language sql security definer as $$
  select id from public.orders where ref = p_ref $$;
grant execute on function oid_of(text) to public;

insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict (id) do nothing;

-- 1) THE FILE, RUN TWICE -----------------------------------------------------------------
select chk(to_regclass('public.order_requests') is not null
       and (select count(*) from pg_policies where tablename = 'order_requests') = 1,
       'run twice: the requests table, with one rule for reading it');
select chk(not has_function_privilege('anon', 'public.request_open(uuid, text, text, text, jsonb, text)', 'execute')
       and has_function_privilege('authenticated', 'public.request_open(uuid, text, text, text, jsonb, text)', 'execute')
       and not has_function_privilege('anon', 'public.requests_mine()', 'execute')
       and not has_function_privilege('anon', 'public.request_decide_admin(uuid, text, text)', 'execute'),
       'asking, seeing and the admin''s answer need somebody signed in');
select chk(not has_function_privilege('authenticated', 'public.request_decide(uuid, text, text, text, text, text)', 'execute')
       and not has_function_privilege('anon', 'public.request_decide(uuid, text, text, text, text, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.request_out_full(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.request_window(public.orders, text)', 'execute'),
       'the parts that decide, and that say who decided, cannot be called from outside');
select chk(has_function_privilege('anon', 'public.vbp_pos_requests(text, text)', 'execute')
       and has_function_privilege('anon', 'public.vbp_pos_request_decide(text, uuid, text, text, text, text)', 'execute'),
       'the platform''s two doors are knocked on with the public key (the door''s own key opens them)');

-- 2) THE ORDERS --------------------------------------------------------------------------
set role service_role;
insert into public.orders (id, ref, customer_id, name, phone, email, total, currency, status, fulfilment, created_at)
values ('dddddddd-0000-0000-0000-000000000001', 'VB-RQP01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 2000, 'ZMW', 'pending', 'delivery', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000002', 'VB-RQR01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 900, 'ZMW', 'pending', 'delivery', now() - interval '2 days'),
       ('dddddddd-0000-0000-0000-000000000003', 'VB-RQD01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 3400, 'ZMW', 'pending', 'delivery', now() - interval '6 days'),
       ('dddddddd-0000-0000-0000-000000000004', 'VB-RQD02', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 600, 'ZMW', 'pending', 'delivery', now() - interval '14 days'),
       ('dddddddd-0000-0000-0000-000000000005', 'VB-RQW01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 800, 'ZMW', 'pending', 'delivery', now() - interval '3 days'),
       ('dddddddd-0000-0000-0000-000000000006', 'VB-RQO01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 1530, 'ZMW', 'pending', 'delivery', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000007', 'VB-RQX01', '33333333-3333-3333-3333-333333333333', 'Other Buyer', '0970000003', 'other@shop.test', 500, 'ZMW', 'pending', 'delivery', now() - interval '1 hour'),
       ('dddddddd-0000-0000-0000-000000000008', 'VB-RQC01', '22222222-2222-2222-2222-222222222222', 'Test Buyer', '0970000001', 'buyer@shop.test', 700, 'ZMW', 'completed', 'collection', now() - interval '2 days');
insert into public.order_items (order_id, sku, name, price, qty) values
  ('dddddddd-0000-0000-0000-000000000001', 'LD-9', 'Linen Dress', 1400, 1),
  ('dddddddd-0000-0000-0000-000000000001', 'SC-2', 'Silk Scarf', 300, 2),
  ('dddddddd-0000-0000-0000-000000000003', 'LD-9', 'Linen Dress', 1400, 2),
  ('dddddddd-0000-0000-0000-000000000003', 'SC-2', 'Silk Scarf', 600, 1),
  ('dddddddd-0000-0000-0000-000000000004', 'SC-2', 'Silk Scarf', 600, 1),
  ('dddddddd-0000-0000-0000-000000000005', 'TB-1', 'Tote Bag', 800, 1),
  ('dddddddd-0000-0000-0000-000000000006', 'LD-9', 'Linen Dress', 1400, 1),
  ('dddddddd-0000-0000-0000-000000000007', 'TB-1', 'Tote Bag', 500, 1),
  ('dddddddd-0000-0000-0000-000000000008', 'BL-4', 'Blouse', 700, 1);
-- Rung up at the till; delivered 3 and 10 days ago; on its way; taken at the counter.
update public.orders set pos_sale_id = 'S-R1', pos_receipt_no = 'R-1', pos_completed_at = now() - interval '1 day', status = 'confirmed'
 where ref = 'VB-RQR01';
update public.orders set pos_sale_id = 'S-D1', pos_completed_at = now() - interval '5 days', status = 'delivered',
       dispatched_at = now() - interval '4 days', delivered_at = now() - interval '3 days', delivered_by = 'customer'
 where ref = 'VB-RQD01';
update public.orders set pos_sale_id = 'S-D2', pos_completed_at = now() - interval '12 days', status = 'delivered',
       dispatched_at = now() - interval '11 days', delivered_at = now() - interval '10 days', delivered_by = 'auto'
 where ref = 'VB-RQD02';
update public.orders set pos_sale_id = 'S-W1', pos_completed_at = now() - interval '2 days', status = 'dispatched',
       dispatched_at = now() - interval '1 day'
 where ref = 'VB-RQW01';
update public.orders set pos_sale_id = 'S-C1', pos_receipt_no = 'R-C1', pos_completed_at = now() - interval '2 days'
 where ref = 'VB-RQC01';
-- Paid online, not rung up yet.
update public.orders set payment_method = 'online', payment_status = 'paid', pay_ref = 'VB-RQO01-0a1b2c3d4e',
       paid_amount = 1530, paid_at = now() - interval '50 minutes'
 where ref = 'VB-RQO01';
insert into public.payments (order_id, tx_ref, mode, status, amount, currency)
values ('dddddddd-0000-0000-0000-000000000006', 'VB-RQO01-0a1b2c3d4e', 'live', 'paid', 1530, 'ZMW');
reset role;
create temp table before_orders as
  select ref, status from public.orders where ref in ('VB-PRE01', 'VB-PRE02');

-- 3) SWITCHED OFF, NOBODY CAN ASK -------------------------------------------------------
select setting('{"accountsEnabled": true}'::jsonb);
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_open(oid_of('VB-RQP01'), 'cancel', 'changed_mind') ->> 'why') = 'off'
       and (public.request_choices(oid_of('VB-RQP01')) ->> 'why') = 'off',
       'until Settings > Customer Accounts switches it on, nobody can ask, whatever a browser sends');
reset role;
select chk((select count(*) from public.order_requests) = 0, 'and nothing is written');

select setting('{"accountsEnabled": true, "customerRequests": true}'::jsonb);

-- 4) WHO MAY ASK -------------------------------------------------------------------------
select who(null);
set role authenticated;
select chk((public.request_open(oid_of('VB-RQP01'), 'cancel', 'changed_mind') ->> 'why') = 'signin',
       'nobody signed in: asked to sign in');
reset role;
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_open(oid_of('VB-RQX01'), 'cancel', 'changed_mind') ->> 'why') = 'not_found',
       'another customer''s order: not found, as if it were not there');
select chk((public.request_open(oid_of('VB-RQP01'), 'refund', 'changed_mind') ->> 'why') = 'unreadable'
       and (public.request_open(oid_of('VB-RQP01'), 'cancel', 'damaged') ->> 'why') = 'unreadable',
       'a kind that does not exist, or a reason that is not one of that kind''s: refused');
select chk((public.request_open(oid_of('VB-RQP01'), 'cancel', 'other') ->> 'why') = 'say_more',
       '"Other" with nothing said: asked to say more');

-- 5) CANCEL: BEFORE THE SHOP HAS STARTED ON IT ---------------------------------------------
select chk((public.request_open(oid_of('VB-RQR01'), 'cancel', 'changed_mind') ->> 'why') = 'too_late'
       and (public.request_open(oid_of('VB-RQW01'), 'cancel', 'changed_mind') ->> 'why') = 'too_late',
       'rung up at the till, or on its way: too late to cancel');
select chk((public.request_open(oid_of('VB-RQP01'), 'cancel', 'changed_mind', 'Ordered twice by mistake', '[{"sku": "LD-9", "qty": 1}]') ->> 'ok')::boolean
       and (public.request_open(oid_of('VB-RQP01'), 'cancel', 'changed_mind') ->> 'again')::boolean,
       'not started on yet: the request is made, and asked again the first one stands');
reset role;
select chk((select jsonb_array_length(items) from public.order_requests where id = rq('VB-RQP01', 'cancel')) = 0
       and (select status from public.order_requests where id = rq('VB-RQP01', 'cancel')) = 'requested',
       'a cancel is the whole order, waiting for the shop');
set role authenticated;

-- 6) RETURN AND EXCHANGE: WITHIN THE SHOP'S DAYS ---------------------------------------------
select chk((public.request_open(oid_of('VB-RQW01'), 'return', 'wrong_size', null, '[{"sku": "TB-1", "qty": 1}]') ->> 'why') = 'not_yet',
       'on its way: too soon for a return');
select chk((public.request_open(oid_of('VB-RQD01'), 'return', 'wrong_size') ->> 'why') = 'which_pieces',
       'a return names the pieces');
select chk((public.request_open(oid_of('VB-RQD01'), 'return', 'wrong_size', 'Too small',
            '[{"sku": "LD-9", "qty": 5}, {"sku": "XX-0", "qty": 1}, {"sku": "SC-2", "qty": 0}]') ->> 'ok')::boolean,
       'a return of a delivered order, three days on: made');
reset role;
select chk((select items from public.order_requests where id = rq('VB-RQD01', 'return'))
           = '[{"sku": "LD-9", "qty": 2, "name": "Linen Dress"}]'::jsonb,
       'only pieces on the order, never more than were ordered: five asked, two returned; a stranger''s piece left out');
set role authenticated;
select chk((public.request_open(oid_of('VB-RQD02'), 'return', 'wrong_size', null, '[{"sku": "SC-2", "qty": 1}]') ->> 'why') = 'too_late',
       'delivered ten days ago, with seven days to ask: too late');
reset role;
select setting('{"accountsEnabled": true, "customerRequests": true, "returnDays": 14}'::jsonb);
set role authenticated;
select chk((public.request_open(oid_of('VB-RQD02'), 'return', 'wrong_size', null, '[{"sku": "SC-2", "qty": 1}]') ->> 'ok')::boolean,
       'with fourteen days set in Settings: in time');
select chk((public.request_open(oid_of('VB-RQC01'), 'exchange', 'wrong_size', null, '[{"sku": "BL-4", "qty": 1}]') ->> 'why') = 'say_instead'
       and (public.request_open(oid_of('VB-RQC01'), 'exchange', 'wrong_size', null, '[{"sku": "BL-4", "qty": 1}]', 'The same in a 14') ->> 'ok')::boolean,
       'an exchange says what instead; taken at the counter two days ago, it is in time');

-- 7) A PROBLEM: ONCE IT IS ON ITS WAY --------------------------------------------------------
select chk((public.request_open(oid_of('VB-RQP01'), 'problem', 'missing') ->> 'why') = 'not_yet'
       and (public.request_open(oid_of('VB-RQW01'), 'problem', 'damaged', 'The strap is torn') ->> 'ok')::boolean,
       'a problem: not before it is on its way; on its way, yes, the pieces optional');

-- 8) WHAT THE CUSTOMER SEES --------------------------------------------------------------------
select chk((public.request_choices(oid_of('VB-RQD01')) -> 'choices' -> 'return' ->> 'can')::boolean
       and not (public.request_choices(oid_of('VB-RQD01')) -> 'choices' -> 'cancel' ->> 'can')::boolean
       and (public.request_choices(oid_of('VB-RQD01')) -> 'choices' -> 'cancel' ->> 'why') = 'too_late'
       and (public.request_choices(oid_of('VB-RQX01')) ->> 'why') = 'not_found',
       'what may be asked of an order now, and why not; nothing about another customer''s');
select chk(jsonb_array_length(public.requests_mine()) = 5
       and not (public.requests_mine()::text ~ 'decided_?[bB]y|RQX01'),
       'their own five requests, newest first, never who decided, never another customer''s');
select chk((select count(*) from public.order_requests) = 0,
       'the table itself shows a customer nothing: only through their own list');
reset role;

-- 9) WITHDRAWN BY THE CUSTOMER --------------------------------------------------------------
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_withdraw(rq('VB-RQW01', 'problem')) ->> 'ok')::boolean
       and (public.request_withdraw(rq('VB-RQW01', 'problem')) ->> 'again')::boolean,
       'withdrawn while the shop has not answered; twice is once');
reset role;
select who('33333333-3333-3333-3333-333333333333');
set role authenticated;
select chk((public.request_withdraw(rq('VB-RQD01', 'return')) ->> 'why') = 'not_found',
       'another customer cannot withdraw it');
reset role;

-- 10) THE PLATFORM DECIDES, WITH THE DOOR'S KEY ----------------------------------------------
select who(null);
set role anon;
select chk((public.vbp_pos_requests('wrong-key-0123456789abcdef0123456789') ->> 'why') = 'refused'
       and (public.vbp_pos_request_decide('wrong-key-0123456789abcdef0123456789', rq('VB-RQP01', 'cancel'), 'accept', null, 'Till 1') ->> 'why') = 'refused',
       'without the door''s key: refused');
select chk(jsonb_array_length(public.vbp_pos_requests(k()) -> 'requests') = 4
       and (select bool_and((x -> 'order' ->> 'ref') = (x ->> 'orderRef') and (x -> 'order' -> 'items') is not null)
              from jsonb_array_elements(public.vbp_pos_requests(k()) -> 'requests') x),
       'the open ones (not the withdrawn), each with its order and pieces, as the till sees them');
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQD01', 'return'), 'decline', '', 'Till 1') ->> 'why') = 'answer_needed',
       'declined without a word for the customer: refused, so they are always told why');
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQD01', 'return'), 'done', null, 'Till 1') ->> 'why') = 'not_now',
       'done before it was accepted: refused');
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQD01', 'return'), 'accept', 'Bring it to the shop, with the receipt.', 'Till 1', 'RET-2026-0007') ->> 'ok')::boolean
       and (public.vbp_pos_request_decide(k(), rq('VB-RQD01', 'return'), 'done', null, 'Till 1') ->> 'ok')::boolean,
       'a return accepted, with a word and the platform''s own number, then done');
reset role;
select chk((select status || '|' || answer || '|' || decided_from || '|' || platform_ref from public.order_requests where id = rq('VB-RQD01', 'return'))
           = 'done|Bring it to the shop, with the receipt.|platform|RET-2026-0007'
       and (select status from public.orders where ref = 'VB-RQD01') = 'delivered',
       'recorded as the platform said; the order itself unchanged');
set role anon;
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQD02', 'return'), 'decline', 'Past our return window.', 'Till 1') ->> 'ok')::boolean
       and (public.vbp_pos_request_decide(k(), rq('VB-RQD02', 'return'), 'accept', null, 'Till 1') ->> 'why') = 'not_now',
       'declined, with the reason; then it cannot be accepted');
reset role;

-- 11) A CANCEL ACCEPTED ------------------------------------------------------------------------
set role anon;
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQP01', 'cancel'), 'accept', null, 'Till 1') ->> 'orderCancelled')::boolean,
       'an order not paid online and not rung up: accepted, the order is cancelled');
reset role;
select chk((select status from public.orders where ref = 'VB-RQP01') = 'cancelled'
       and (select status from public.order_requests where id = rq('VB-RQP01', 'cancel')) = 'done',
       'and the request is done: nothing left to do');
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_open(oid_of('VB-RQO01'), 'cancel', 'ordered_by_mistake') ->> 'ok')::boolean,
       'an order paid online, not rung up yet: a cancel can be asked');
reset role;
set role anon;
select chk((public.vbp_pos_request_decide(k(), rq('VB-RQO01', 'cancel'), 'accept', 'We are refunding you now.', 'Till 1') ->> 'refundFirst')::boolean,
       'accepted: the platform is told to refund it first (Online Refund)');
reset role;
select chk((select status from public.orders where ref = 'VB-RQO01') = 'pending'
       and (select status from public.order_requests where id = rq('VB-RQO01', 'cancel')) = 'accepted',
       'the paid order is not cancelled here: its refund does that');

-- 12) AN ADMINISTRATOR, BY HAND --------------------------------------------------------------
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_decide_admin(rq('VB-RQC01', 'exchange'), 'accept') ->> 'why') = 'not_allowed',
       'a customer cannot answer requests');
reset role;
select who('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((public.request_decide_admin(rq('VB-RQC01', 'exchange'), 'accept', 'We have a 14: come in any day.') ->> 'ok')::boolean,
       'the owner, in Admin > Orders: accepted');
select chk((select count(*) from public.order_requests) = 6,
       'an administrator reads every request (all six)');
reset role;
select chk((select decided_from || '|' || decided_by from public.order_requests where id = rq('VB-RQC01', 'exchange'))
           = 'admin|owner@shop.test',
       'recorded as decided in the admin, by whom');
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.request_withdraw(rq('VB-RQC01', 'exchange')) ->> 'why') = 'answered',
       'once answered, the customer cannot withdraw it');
select chk((select r ->> 'answer' from jsonb_array_elements(public.requests_mine()) r where r ->> 'kind' = 'exchange')
           = 'We have a 14: come in any day.',
       'and they see the shop''s word');
reset role;

-- 13) THE EMAILS' TWO COLUMNS, AND NOTHING ELSE ------------------------------------------------
set role service_role;
do $$ declare e text; begin
  begin update public.order_requests set status = 'done' where order_ref = 'VB-RQD02'; e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'the website''s key cannot change a request''s answer');
end $$;
update public.order_requests set shop_told_at = now(), customer_told = status where order_ref = 'VB-RQD02';
reset role;
select chk((select shop_told_at is not null and customer_told = 'declined' from public.order_requests where order_ref = 'VB-RQD02'),
       'only whether the shop and the customer were emailed');

-- 14) A FEW AN HOUR, WHERE THE COUNTER IS THERE -------------------------------------------------
-- supabase-hardening.sql's counter, as it is written there, for this check.
create table if not exists public.rate_events (bucket text, key text, at timestamptz default now());
create or replace function public.throttle(p_bucket text, p_key text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public, pg_temp as $t$
declare v_n integer;
begin
  if p_key is null or p_key = 'unknown' then return; end if;
  select count(*) into v_n from public.rate_events where bucket = p_bucket and key = p_key and at > now() - p_window;
  if v_n >= p_max then
    raise exception 'Too many tries just now. Please wait a little and try again.' using errcode = 'P0429', hint = p_bucket;
  end if;
  insert into public.rate_events (bucket, key) values (p_bucket, p_key);
end $t$;
select who('22222222-2222-2222-2222-222222222222');
set role authenticated;
do $$ declare e text := 'none'; i integer; begin
  for i in 1..11 loop
    begin perform public.request_open(oid_of('VB-RQW01'), 'problem', 'missing');
    exception when others then e := sqlerrm; end;
  end loop;
  perform chk(e ~ 'Too many tries', 'ten an hour for each customer; the eleventh is refused');
end $$;
reset role;

-- 15) NOTHING ELSE CHANGED -----------------------------------------------------------------------
select chk((select bool_and(o.status = b.status) from public.orders o join before_orders b using (ref)),
       'the orders from before are as they were');
select chk((select count(*) from public.pos_door_calls where kind = 'read') > 0
       and (select count(*) from public.pos_door_calls where kind = 'write') > 0,
       'the platform''s two doors count against the till''s hourly limits');

-- The result ------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   customer requests database: all ' || count(*) || ' checks passed'
            else '   customer requests database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
