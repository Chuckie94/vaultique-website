-- ===========================================================================
-- AFTER THE HARDENING: THE PLATFORM'S TILL, AN ORDER'S PROGRESS, REFUNDS (builds 80, 81)
--
-- Runs on the database tools/db-check.sh has built: the 28 setup files, the
-- hardening, the four files made after it (supabase-pos-orders.sql,
-- supabase-payment-history.sql, supabase-order-progress.sql and, from build
-- 81, supabase-online-refund.sql), the hardening
-- once more, and tests/hardening.sql. Everything the hardening closed must
-- stay closed, and what the platform and the customers use must still work:
-- the till's door with its own key, an order's steps, the customer's two
-- buttons, the private link, and the payment history for the admin only.
-- One line per check.
-- ===========================================================================
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
reset role;

create table if not exists after_checks (n serial, ok boolean, what text);
create or replace function achk(p_ok boolean, p_what text) returns void
language plpgsql security definer set search_path = public as $$
begin insert into after_checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function achk(boolean, text) to anon, authenticated, service_role;

create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', false),
         set_config('request.headers', '', false); $$;
create or replace function pg_temp.as_user(u text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false),
         set_config('request.headers', '', false); $$;

-- A known key for the till's door, in place of the one the file made (the
-- file keeps only a fingerprint of it).
insert into public.pos_door_key (id, fingerprint)
values (1, sha256(convert_to('k80-0123456789abcdef0123456789abcdef', 'UTF8')))
on conflict (id) do update set fingerprint = excluded.fingerprint;
create or replace function ak() returns text language sql immutable as $$ select 'k80-0123456789abcdef0123456789abcdef' $$;
grant execute on function ak() to anon, authenticated;

-- People: the owner (0a1), an Administrator with two-factor (0f6) and a
-- customer (0c3) come from tests/hardening.sql; one more customer here.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'other@mail.test') on conflict do nothing;
insert into public.customers (id, name) values ('00000000-0000-0000-0000-0000000000c9', 'Other Customer') on conflict do nothing;

-- Two orders placed after the door was set up: one to deliver, for the
-- customer 0c3, and one a walk-in collects at the counter.
insert into public.orders (id, ref, customer_id, name, phone, total, currency, status, fulfilment, created_at)
values ('aaaaaaaa-8080-0000-0000-000000000001', 'VB-AH801', '00000000-0000-0000-0000-0000000000c3', 'Real Customer',
        '0970000801', 700, 'ZMW', 'pending', 'delivery', now() + interval '1 minute'),
       ('aaaaaaaa-8080-0000-0000-000000000002', 'VB-AH802', null, 'Walk In', '0970000802', 250, 'ZMW', 'pending',
        'collection', now() + interval '1 minute')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, name, price, qty) values
  ('aaaaaaaa-8080-0000-0000-000000000001', 'AH-1', 'Linen Shirt', 700, 1),
  ('aaaaaaaa-8080-0000-0000-000000000002', 'AH-2', 'Belt', 250, 1);

-- ================================================ 1. still closed
select achk(not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('authenticated', p.oid, 'execute')
            and has_function_privilege('service_role', p.oid, 'execute'),
  'orders: place_order is still the website''s server''s alone (' || p.oid::regprocedure || ')')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'place_order';
select achk(pg_get_functiondef('public.is_admin()'::regprocedure) like '%mfa_ok()%',
  'admin: the administrator rule still asks for the code (the files after the hardening left it alone)');
select achk(count(*) = 0, 'the till''s own helpers are closed to visitors and signed-in people'
            || coalesce(' — open: ' || string_agg(p.proname, ', '), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('pos_door_key_ok', 'pos_door_count', 'pos_order_out', 'pos_paid_online', 'pos_text', 'pos_num',
                     'pos_receipt_clean', 'orders_pos_guard', 'orders_progress_guard', 'pos_int',
                     'order_progress_out', 'order_extend_window', 'order_customer_step',
                     'payment_events_frozen', 'payment_events_log_payment', 'payment_events_log_order')
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
select achk(not has_table_privilege('anon', 'public.pos_door_key', 'select')
            and not has_table_privilege('authenticated', 'public.pos_door_key', 'select')
            and not has_table_privilege('service_role', 'public.pos_door_key', 'select'),
  'the door''s key: nobody can read even its fingerprint');
select achk(exists (select 1 from public.schema_migrations where version = '083-hardening'),
  'the record: this build''s hardening (083-hardening) is written down');

-- ================================================ 2. the till's door
select achk(count(*) = 9, 'the door: open to the platform''s public key (' || count(*) || ' of 9 doors)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('vbp_pos_orders', 'vbp_pos_order', 'vbp_pos_order_claim', 'vbp_pos_order_release',
                     'vbp_pos_order_complete', 'vbp_pos_progress', 'vbp_pos_order_progress', 'vbp_pos_order_refund',
                     'order_progress_link')
   and has_function_privilege('anon', p.oid, 'execute');

set role anon;
select pg_temp.as_anon();
select achk(public.vbp_pos_orders('k80-0123456789abcdef0123456789abcdeX', null, 'open') ->> 'why' = 'refused',
  'the door: a wrong key is refused');
select achk((select bool_or(o ->> 'ref' = 'VB-AH801')
               from jsonb_array_elements(public.vbp_pos_orders(ak(), null, 'open') -> 'orders') o),
  'the door: with its key, the till lists the open orders');
select achk((public.vbp_pos_order_claim(ak(), 'VB-AH801', 'claim-ah801-abcdef', 'Till 1') ->> 'ok')::boolean
            and (public.vbp_pos_order_claim(ak(), 'VB-AH802', 'claim-ah802-abcdef', 'Till 1') ->> 'ok')::boolean,
  'the door: the till holds both orders while it rings them up');
select achk((public.vbp_pos_order_complete(ak(), 'VB-AH801', 'claim-ah801-abcdef',
               '{"saleId":"S-801","receiptNo":"R-801","invoiceNo":"I-801","handedOver":false}') ->> 'ok')::boolean
            and (public.vbp_pos_order_complete(ak(), 'VB-AH802', 'claim-ah802-abcdef',
               '{"saleId":"S-802","receiptNo":"R-802","invoiceNo":"I-802","handedOver":true}') ->> 'ok')::boolean,
  'the door: both are rung up');
reset role;
select achk((select status from public.orders where ref = 'VB-AH801') = 'confirmed'
            and (select status from public.orders where ref = 'VB-AH802') = 'completed',
  'the door: the one still to go says Preparing, the one handed over says Completed');

set role anon;
select pg_temp.as_anon();
select achk((public.vbp_pos_order_progress(ak(), 'VB-AH801', 'dispatched', 'With the courier') ->> 'ok')::boolean,
  'progress: On its way, through the door');
reset role;
select achk(o.status = 'dispatched' and o.ship_note = 'With the courier' and o.progress_token ~ '^[0-9a-f]{32,64}$'
            and o.auto_deliver_at > now(),
  'progress: the order is on its way, with the note, its private link and the day it is marked delivered')
  from public.orders o where o.ref = 'VB-AH801';

-- ================================================ 3. the customer's buttons
set role anon;
select pg_temp.as_anon();
select achk(pg_temp.err($q$select public.order_confirm_delivery('aaaaaaaa-8080-0000-0000-000000000001')$q$) like '%permission denied%',
  'Confirm delivery: nobody signed in cannot press it');
select achk(public.order_progress_link('VB-AH801', 'ffffffffffffffffffffffffffffffff') ->> 'why' = 'not_found',
  'the private link: a wrong key finds nothing');
reset role;
select set_config('ah.tok', (select progress_token from public.orders where ref = 'VB-AH801'), false);
set role anon;
select pg_temp.as_anon();
select achk(r ->> 'ok' = 'true' and r -> 'order' ->> 'ref' = 'VB-AH801' and r -> 'order' ->> 'firstName' = 'Real'
            and r -> 'order' ->> 'phone' is null,
  'the private link: opened without signing in, it shows that order alone, without the phone number')
  from (select public.order_progress_link('VB-AH801', current_setting('ah.tok')) as r) x;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c9', 'aal1');
select achk(public.order_confirm_delivery('aaaaaaaa-8080-0000-0000-000000000001') ->> 'why' = 'not_found',
  'Confirm delivery: another customer cannot press it on this order');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3', 'aal1');
select achk(pg_temp.err($q$select pos_receipt_no, pos_receipt, ship_note, dispatched_at, auto_deliver_at, delivered_by,
                               extend_used, refund_state, refund_amount from public.orders where ref = 'VB-AH801'$q$) = ''
            and (select count(*) from public.orders where ref = 'VB-AH801') = 1
            and (select count(*) from public.orders where ref = 'VB-AH802') = 0,
  'the account page: the customer reads their own order with its receipt and its steps, and nobody else''s');
select achk((public.order_extend_delivery('aaaaaaaa-8080-0000-0000-000000000001') ->> 'ok')::boolean,
  'Ask for more time: the customer, signed in, on their own order');
select achk((public.order_confirm_delivery('aaaaaaaa-8080-0000-0000-000000000001') ->> 'ok')::boolean,
  'Confirm delivery: the customer, signed in, on their own order');
reset role;
select achk(o.status = 'delivered' and o.delivered_by = 'customer' and o.extend_used = 1,
  'Confirm delivery: the order says Delivered, by the customer''s word')
  from public.orders o where o.ref = 'VB-AH801';

-- ================================================ 4. the payment history
-- One payment begun for the order, as the payment service records it: the
-- history writes its line by itself.
insert into public.payments (order_id, tx_ref, mode, amount, currency, phone)
values ('aaaaaaaa-8080-0000-0000-000000000001', 'VB-AH801-0a1b2c3d4e', 'test', 700, 'ZMW', '0970000801');
select achk((select count(*) from public.payment_events where tx_ref = 'VB-AH801-0a1b2c3d4e') = 1,
  'payment history: the payment wrote its own line');
set role anon;
select pg_temp.as_anon();
select achk(pg_temp.err('select count(*) from public.payment_events') like '%permission denied%',
  'payment history: closed to visitors');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3', 'aal1');
select achk((select count(*) from public.payment_events) = 0, 'payment history: a customer sees none of it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal1');
select achk((select count(*) from public.payment_events) = 0,
  'payment history: an Administrator with the password alone sees none of it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select achk((select count(*) from public.payment_events where tx_ref = 'VB-AH801-0a1b2c3d4e') = 1,
  'payment history: the same Administrator after the code reads it');

-- ================================================ 5. closing an account (build 80)
-- netlify/functions/account-delete.js removes the login (auth.users) with
-- the website's own key. The database must then take the profile, the
-- saved addresses and the rewards link with it, keep the orders without
-- their owner, and leave the admin list alone.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c8', 'leaving@mail.test') on conflict do nothing;
insert into public.customers (id, name) values ('00000000-0000-0000-0000-0000000000c8', 'Leaving Customer') on conflict do nothing;
insert into public.customer_addresses (customer_id, label, address)
values ('00000000-0000-0000-0000-0000000000c8', 'Home', 'Plot 1, Roma');
insert into public.rewards_links (user_id, cust_no, how) values ('00000000-0000-0000-0000-0000000000c8', 'VBCUS0808', 'code')
  on conflict do nothing;
insert into public.orders (id, ref, customer_id, name, phone, total, currency, status, fulfilment)
values ('aaaaaaaa-8080-0000-0000-000000000008', 'VB-AH808', '00000000-0000-0000-0000-0000000000c8', 'Leaving Customer',
        '0970000808', 300, 'ZMW', 'pending', 'delivery');
select set_config('ah.admins', (select count(*)::text from public.admins), false);
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c8';
select achk(not exists (select 1 from public.customers where id = '00000000-0000-0000-0000-0000000000c8')
            and not exists (select 1 from public.customer_addresses where customer_id = '00000000-0000-0000-0000-0000000000c8')
            and not exists (select 1 from public.rewards_links where user_id = '00000000-0000-0000-0000-0000000000c8'),
  'closing an account: with the login go the profile, the saved addresses and the rewards link');
select achk(exists (select 1 from public.orders where ref = 'VB-AH808' and customer_id is null and total = 300),
  'closing an account: the order stays, without its owner');
select achk((select count(*)::text from public.admins) = current_setting('ah.admins'),
  'closing an account: the admin list is untouched');

-- ================================================ 6. online refunds (build 81)
-- An order paid online and rung up by the platform; the platform asks for
-- part of it back through its door, and the payment service records what
-- Flutterwave said, with the service key.
reset role;
insert into public.orders (id, ref, name, phone, email, total, currency, status, fulfilment, created_at,
                           payment_method, payment_status, pay_ref, paid_amount, paid_at)
values ('aaaaaaaa-8181-0000-0000-000000000001', 'VB-AH811', 'Refund Customer', '0970000811', 'refund@mail.test', 500, 'ZMW',
        'completed', 'delivery', now(), 'online', 'paid', 'VB-AH811-0a1b2c3d4e', 500, now())
on conflict (id) do nothing;
update public.orders set pos_sale_id = 'S-AH811', pos_receipt_no = 'R-AH811', pos_completed_at = now() where ref = 'VB-AH811';
insert into public.payments (order_id, tx_ref, mode, status, amount, currency, phone, provider_tx_id, channel, detail)
values ('aaaaaaaa-8181-0000-0000-000000000001', 'VB-AH811-0a1b2c3d4e', 'live', 'paid', 500, 'ZMW', '0970000811', '811811', 'card',
        '{"flw_ref":"FLW-AH811"}');
select achk(count(*) = 3, 'online refunds: the three doors are open to the platform''s public key (' || count(*) || ' of 3)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('vbp_pos_refund_find', 'vbp_pos_refund_request', 'vbp_pos_refunds')
   and has_function_privilege('anon', p.oid, 'execute');
select achk(count(*) = 0, 'online refunds: their own helpers are closed to visitors and signed-in people'
            || coalesce(' — open: ' || string_agg(p.proname, ', '), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('refund_out', 'refund_state_of', 'refunds_guard', 'refunds_to_order')
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
set role anon;
select pg_temp.as_anon();
select achk(public.vbp_pos_refund_find('k80-0123456789abcdef0123456789abcdeX', 'VB-AH811') ->> 'why' = 'refused',
  'online refunds: a wrong key is refused');
select achk((public.vbp_pos_refund_find(ak(), 'R-AH811') -> 'refund' ->> 'left')::numeric = 500,
  'online refunds: with its key, the platform finds the payment by its receipt, and all K500 to refund');
select achk(public.vbp_pos_refund_request(ak(), 'VB-AH811', 200, false, 'Wrong size', 'A. Manager', 'Store Manager',
              'ORF-2026-0001', 'orf-ah811-0000000001', true) -> 'refund' ->> 'state' = 'new',
  'online refunds: "refund this" is written down');
select achk(pg_temp.err('select count(*) from public.refunds') like '%permission denied%',
  'online refunds: the refunds are closed to visitors');
reset role;
set role service_role;
update public.refunds set state = 'sending', sent_at = now() where request_key = 'orf-ah811-0000000001';
update public.refunds set state = 'pending', flw_refund_id = 'RF-AH811', accepted_at = now() where request_key = 'orf-ah811-0000000001';
reset role;
select achk(refund_state = 'part' and refund_amount = 200,
  'online refunds: the payment service records Flutterwave''s answer, and the order says Part refunded')
  from public.orders where ref = 'VB-AH811';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3', 'aal1');
select achk((select count(*) from public.refunds) = 0, 'online refunds: a customer sees none of them');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal1');
select achk((select count(*) from public.refunds) = 0,
  'online refunds: an Administrator with the password alone sees none of them');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select achk((select count(*) from public.refunds where order_ref = 'VB-AH811') = 1
            and (select count(*) from public.payment_events where what = 'refund' and tx_ref = 'VB-AH811-0a1b2c3d4e') = 3,
  'online refunds: the same Administrator after the code reads them, and each step is in the payment history');

-- ================================================ build 83: a customer told the shop has replied
-- supabase-chat-reply-push.sql. A recorder in place of pg_net, so what the
-- database would post can be read back.
reset role;
create schema if not exists net;
create table if not exists net.posted83 (url text, body jsonb);
create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
returns bigint language sql as $p$ insert into net.posted83 (url, body) values (url, body); select 1::bigint $p$;
insert into public.site_settings_private (key, data)
values ('chat_push', '{"siteUrl":"https://shop.test","secret":"s83","vapidPublic":"BPub83-0123456789abcdef0123456789abcdef"}')
on conflict (key) do update
  set data = public.site_settings_private.data
             || '{"siteUrl":"https://shop.test","secret":"s83","vapidPublic":"BPub83-0123456789abcdef0123456789abcdef"}'::jsonb;
insert into public.chat_conversations (id, token, name, status)
values ('cccccccc-8383-0000-0000-000000000001', 'tok83-a-0123456789abcdef', 'Reply Test', 'open'),
       ('cccccccc-8383-0000-0000-000000000002', 'tok83-b-0123456789abcdef', 'No Notify', 'open')
on conflict (id) do nothing;

select achk((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('chat_reply_push_key', 'chat_reply_push_save', 'chat_reply_push_has', 'chat_reply_push_drop')
                and has_function_privilege('anon', p.oid, 'execute')) = 4,
  'reply notifications: the chat window''s four doors are still open after the hardening ran again');
select achk(not has_function_privilege('anon', 'public.chat_nudge_reply()', 'execute'),
  'reply notifications: the nudge cannot be called from outside the database');

set role anon;
select pg_temp.as_anon();
select achk(public.chat_reply_push_key() = 'BPub83-0123456789abcdef0123456789abcdef',
  'reply notifications: a visitor''s chat window can read the public notification key');
select achk(public.chat_reply_push_save('tok83-a-0123456789abcdef', 'https://push.example/abc', 'p256dh-0123456789', 'auth-0123') = true,
  'reply notifications: with its own conversation''s token, a browser goes on the list');
select achk(public.chat_reply_push_save('tok83-wrong-0123456789', 'https://push.example/zzz', 'p256dh-0123456789', 'auth-0123') = false
            and public.chat_reply_push_save('tok83-a-0123456789abcdef', 'http://push.example/plain', 'p256dh-0123456789', 'auth-0123') = false,
  'reply notifications: a wrong token, or an address that is not https, puts nothing on the list');
select achk(public.chat_reply_push_has('tok83-a-0123456789abcdef', 'https://push.example/abc')
            and not public.chat_reply_push_has('tok83-b-0123456789abcdef', 'https://push.example/abc'),
  'reply notifications: a browser can ask whether it is on the list, for its own conversation only');
select achk(pg_temp.err('select count(*) from public.chat_reply_push') like '%permission denied%',
  'reply notifications: the list itself cannot be read by a visitor');

-- The owner replies, as the admin does (only somebody in the shop speaks as the shop).
reset role;
delete from net.posted83;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into public.chat_messages (conversation_id, sender, body)
values ('cccccccc-8383-0000-0000-000000000001', 'shop', 'Yes, we have it in a 38.');
reset role;
select achk((select count(*) from net.posted83 where body->>'kind' = 'reply'
              and body->>'conversation' = 'cccccccc-8383-0000-0000-000000000001'
              and url = 'https://shop.test/.netlify/functions/chat-push') = 1,
  'reply notifications: a reply from the shop tells the notification function, for that conversation');
delete from net.posted83;
insert into public.chat_messages (conversation_id, sender, body)
values ('cccccccc-8383-0000-0000-000000000001', 'customer', 'Thank you!');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into public.chat_messages (conversation_id, sender, body)
values ('cccccccc-8383-0000-0000-000000000002', 'shop', 'Hello there');
reset role;
select achk((select count(*) from net.posted83 where body->>'kind' = 'reply') = 0,
  'reply notifications: nothing for the customer''s own message, or for a conversation nobody asked about');

set role anon;
select pg_temp.as_anon();
select public.chat_reply_push_drop('tok83-a-0123456789abcdef', 'https://push.example/abc');
select achk(not public.chat_reply_push_has('tok83-a-0123456789abcdef', 'https://push.example/abc'),
  'reply notifications: "Turn off" takes the browser off the list');

-- When the chat ends there is nobody left to tell: its browsers go at once,
-- whether the customer pressed End (chat_end) or the shop closed it.
select public.chat_reply_push_save('tok83-a-0123456789abcdef', 'https://push.example/end1', 'p256dh-0123456789', 'auth-0123');
select public.chat_reply_push_save('tok83-b-0123456789abcdef', 'https://push.example/end2', 'p256dh-0123456789', 'auth-0123');
select public.chat_end('tok83-a-0123456789abcdef');
reset role;
select achk((select count(*) from public.chat_reply_push where conversation_id = 'cccccccc-8383-0000-0000-000000000001') = 0
            and (select count(*) from public.chat_reply_push where conversation_id = 'cccccccc-8383-0000-0000-000000000002') = 1,
  'reply notifications: the customer ending the chat takes its browsers off the list at once, and nobody else''s');
update public.chat_conversations set status = 'closed' where id = 'cccccccc-8383-0000-0000-000000000002';
select achk((select count(*) from public.chat_reply_push where conversation_id = 'cccccccc-8383-0000-0000-000000000002') = 0,
  'reply notifications: and so does the shop closing it');
select achk(not has_function_privilege('anon', 'public.chat_reply_push_forget()', 'execute'),
  'reply notifications: what does that cannot be called from outside the database');

-- And a browser asked more than a week ago goes whenever another is saved,
-- so a conversation nobody ended does not keep its browsers for ever.
update public.chat_conversations set status = 'open' where id = 'cccccccc-8383-0000-0000-000000000002';
insert into public.chat_reply_push (conversation_id, endpoint, p256dh, auth, created_at)
values ('cccccccc-8383-0000-0000-000000000002', 'https://push.example/old', 'p256dh-0123456789', 'auth-0123', now() - interval '8 days');
set role anon;
select pg_temp.as_anon();
select public.chat_reply_push_save('tok83-b-0123456789abcdef', 'https://push.example/new', 'p256dh-0123456789', 'auth-0123');
reset role;
select achk(not exists (select 1 from public.chat_reply_push where endpoint = 'https://push.example/old')
            and exists (select 1 from public.chat_reply_push where endpoint = 'https://push.example/new'),
  'reply notifications: a browser asked more than a week ago is let go when another is saved');
reset role;
delete from public.chat_conversations where id = 'cccccccc-8383-0000-0000-000000000001';
select achk((select count(*) from public.chat_reply_push where conversation_id = 'cccccccc-8383-0000-0000-000000000001') = 0,
  'reply notifications: a deleted conversation leaves nothing on the list');

-- ================================================ build 87: customers' requests
-- The platform's two doors open to its own key; the customer's for a
-- signed-in customer on their own order; an administrator with the orders
-- permission answers by hand (the hardening's may('orders')); the parts
-- that decide closed to everybody.
reset role;
select achk(count(*) = 2, 'requests: the platform''s two doors are open to its public key (' || count(*) || ' of 2)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('vbp_pos_requests', 'vbp_pos_request_decide')
   and has_function_privilege('anon', p.oid, 'execute');
select achk(count(*) = 0, 'requests: the customer''s and the admin''s are closed to visitors'
            || coalesce(' — open: ' || string_agg(p.proname, ', '), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('request_open', 'requests_mine', 'request_choices', 'request_withdraw', 'request_decide_admin', 'request_reasons')
   and has_function_privilege('anon', p.oid, 'execute');
select achk(count(*) = 0, 'requests: the parts that decide are closed to everybody'
            || coalesce(' — open: ' || string_agg(p.proname, ', '), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('request_decide', 'request_out', 'request_out_full', 'request_window')
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
insert into public.orders (id, ref, customer_id, name, phone, total, currency, status, fulfilment, created_at)
values ('aaaaaaaa-8787-0000-0000-000000000001', 'VB-AH871', '00000000-0000-0000-0000-0000000000c3', 'Real Customer',
        '0970000871', 300, 'ZMW', 'pending', 'delivery', now())
on conflict (id) do nothing;
insert into public.site_settings (key, data) values ('customer-accounts', '{"accountsEnabled": true, "customerRequests": true}')
on conflict (key) do update set data = public.site_settings.data || '{"customerRequests": true}'::jsonb;
set role anon;
select pg_temp.as_anon();
select achk(pg_temp.err($q$select public.request_open('aaaaaaaa-8787-0000-0000-000000000001', 'cancel', 'changed_mind')$q$) like '%permission denied%',
  'requests: nobody signed in cannot ask');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c9', 'aal1');
select achk(public.request_open('aaaaaaaa-8787-0000-0000-000000000001', 'cancel', 'changed_mind') ->> 'why' = 'not_found',
  'requests: another customer cannot ask about this order');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3', 'aal1');
select achk((public.request_open('aaaaaaaa-8787-0000-0000-000000000001', 'cancel', 'changed_mind') ->> 'ok')::boolean,
  'requests: the customer asks to cancel their own order, the hardening''s counter in place');
select achk((select count(*) from public.order_requests) = 0 and jsonb_array_length(public.requests_mine()) = 1,
  'requests: the table shows the customer nothing; their own list shows theirs');
select achk(public.request_decide_admin((public.requests_mine() -> 0 ->> 'id')::uuid, 'accept') ->> 'why' = 'not_allowed',
  'requests: a customer cannot answer one');
set role anon;
select pg_temp.as_anon();
select achk((public.vbp_pos_requests(ak()) ->> 'ok')::boolean
            and exists (select 1 from jsonb_array_elements(public.vbp_pos_requests(ak()) -> 'requests') x
                         where x ->> 'orderRef' = 'VB-AH871'),
  'requests: the platform lists it with its own key');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select achk((public.request_decide_admin((select id from public.order_requests where order_ref = 'VB-AH871'), 'accept') ->> 'orderCancelled')::boolean,
  'requests: the owner answers by hand; an order not paid and not rung up is cancelled');
reset role;
select achk((select status from public.orders where ref = 'VB-AH871') = 'cancelled'
            and (select status || '|' || decided_from from public.order_requests where order_ref = 'VB-AH871') = 'done|admin',
  'requests: the order cancelled, the request done, decided in the admin');

reset role;
select case when ok then '  ✓ ' else '  ✗ ' end || what from after_checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  after the hardening: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from after_checks;
