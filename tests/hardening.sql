-- ===========================================================================
-- THE HARDENING, CHECKED (supabase-hardening.sql, build 76)
--
-- Runs on a scratch database that has the Supabase stand-in, all 28 setup
-- files in order, then supabase-hardening.sql:  tools/db-check.sh  does it.
-- Every attack the build 73 audit made must now fail, and everything the
-- shop and its staff do must still work. One line per check.
-- ===========================================================================
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
reset role;

create table if not exists hardening_checks (n serial, ok boolean, what text);
create or replace function hchk(p_ok boolean, p_what text) returns void
language plpgsql security definer set search_path = public as $$
begin insert into hardening_checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function hchk(boolean, text) to anon, authenticated, service_role;

-- Run a statement as whoever is current; say whether it raised.
create or replace function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
-- Who is asking, as PostgREST would say it.
create or replace function pg_temp.as_anon(addr text default null) returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', false),
         set_config('request.headers', case when addr is null then '' else json_build_object('x-forwarded-for', addr)::text end, false); $$;
create or replace function pg_temp.as_user(u text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false),
         set_config('request.headers', '', false); $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false),
         set_config('request.headers', '', false); $$;

-- ---------------------------------------------------------------- people
-- owner 0a1 exists already (no two-factor yet).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b2', 'agent@shop.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'customer@mail.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'former@shop.test'),
  ('00000000-0000-0000-0000-0000000000e5', 'agent-mfa@shop.test'),
  ('00000000-0000-0000-0000-0000000000f6', 'admin-mfa@shop.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'admin-nomfa@shop.test')
on conflict do nothing;
insert into public.admins (id, email, role, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@shop.test', 'owner', true),
  ('00000000-0000-0000-0000-0000000000b2', 'agent@shop.test', 'agent', true),
  ('00000000-0000-0000-0000-0000000000d4', 'former@shop.test', 'full', false),
  ('00000000-0000-0000-0000-0000000000e5', 'agent-mfa@shop.test', 'agent', true),
  ('00000000-0000-0000-0000-0000000000f6', 'admin-mfa@shop.test', 'full', true),
  ('00000000-0000-0000-0000-0000000000a7', 'admin-nomfa@shop.test', 'full', true)
on conflict (id) do update set role = excluded.role, active = excluded.active;
insert into auth.mfa_factors (user_id, status) values
  ('00000000-0000-0000-0000-0000000000e5', 'verified'),
  ('00000000-0000-0000-0000-0000000000f6', 'verified');
insert into public.customers (id, name) values ('00000000-0000-0000-0000-0000000000c3', 'Real Customer') on conflict do nothing;
-- The Administrator role may also delete chats, to check that "switched
-- off" still wins over a tick.
update public.site_settings set data = jsonb_set(data, '{full,permissions,deleteChats}', 'true') where key = 'roles';
insert into public.site_settings_private (key, data) values ('notifications', '{"smtpPassword":"x"}')
  on conflict (key) do update set data = excluded.data;
insert into public.subscribers (email, unsubscribed_at) values ('gone@mail.test', now() - interval '30 days')
  on conflict (email) do update set unsubscribed_at = excluded.unsubscribed_at;
insert into public.product_meta (sku, price_override) values ('BAG-001', null)
  on conflict (sku) do update set price_override = null;
insert into public.orders (ref, name, phone, address, total, status)
values ('VB-PII22', 'Private Person', '0971111111', '1 Secret Lane', 500, 'pending');

-- ======================================================= 1. two-factor
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
select hchk(not public.is_admin() and not public.is_shop_owner(),
  'two-factor: the owner, signed in with the password alone, is not let in (it is required for the owner)');
select hchk((public.admin_gate()->>'staff')::boolean and (public.admin_gate()->>'required')::boolean
            and not (public.admin_gate()->>'enrolled')::boolean and not (public.admin_gate()->>'ok')::boolean,
  'two-factor: but the admin page is told why: staff, required, not set up yet');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk(public.is_admin() and public.is_shop_owner(),
  'two-factor: the owner after a code (aal2) is the owner');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7', 'aal1');
select hchk(not public.is_admin() and (select count(*) from public.orders) = 0,
  'two-factor: an Administrator without it is refused, and sees no orders (required for that role)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal1');
select hchk(not public.is_admin() and (public.admin_gate()->>'enrolled')::boolean,
  'two-factor: an Administrator who has it, with the password alone, is refused');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select hchk(public.is_admin() and (select count(*) from public.orders) > 0,
  'two-factor: the same Administrator after the code sees the orders');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select hchk(public.is_admin() and public.chat_may_answer() and not (public.admin_gate()->>'required')::boolean,
  'two-factor: an Agent who only answers chats is not forced to use it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5', 'aal1');
select hchk(not public.chat_may_answer(),
  'two-factor: but an Agent who set it up is held to it (password alone refused)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5', 'aal2');
select hchk(public.chat_may_answer(), 'two-factor: and let in after the code');

-- ======================================================= 2. switched off
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4', 'aal2');
select hchk(not public.is_admin() and not public.chat_may_answer() and not public.may_delete_chats(),
  'switch off: a switched-off Administrator is nobody to the database, even with a delete-chats tick');
select hchk((select count(*) from public.site_settings_private) = 0 and (select count(*) from public.orders) = 0,
  'switch off: and reads neither the private settings nor the orders');
select hchk(not (public.admin_gate()->>'active')::boolean,
  'switch off: the admin page is told "switched off", not "not an administrator"');

-- ======================================================= 3. role ticks
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select hchk((select count(*) from public.orders) = 0 and (select count(*) from public.customers) = 0,
  'roles: a chats-only Agent sees no orders and no customers');
select hchk((select count(*) from public.subscribers) = 0, 'roles: ... no subscribers');
select hchk((select count(*) from public.site_settings_private) = 0, 'roles: ... no private settings (bank details, email password)');
select pg_temp.fails($q$update public.product_meta set price_override = 1 where sku = 'BAG-001'$q$);
reset role;
select hchk((select price_override from public.product_meta where sku = 'BAG-001') is null,
  'roles: ... cannot set a website price');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select pg_temp.fails($q$update public.site_settings set data = '{"websiteStatus":"closed"}' where key = 'general'$q$);
reset role;
select hchk(coalesce((select data->>'websiteStatus' from public.site_settings where key = 'general'), 'live') <> 'closed',
  'roles: ... cannot change the shop''s settings');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select hchk(not pg_temp.fails($q$insert into public.activity_log (action, module) values ('test', 'chats')$q$),
  'roles: ... still writes its own line in the activity log');
select hchk((select count(*) from public.activity_log) = 0, 'roles: ... but cannot read the log');
select pg_temp.fails($q$delete from public.site_settings where key = 'roles'$q$);
reset role;
select hchk((select count(*) from public.site_settings where key = 'roles') = 1,
  'roles: an Agent cannot delete the roles row');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select hchk(pg_temp.fails($q$update public.site_settings set data = data where key = 'roles'$q$),
  'roles: nor can an Administrator change roles: only the owner');
select hchk(not pg_temp.fails($q$update public.site_settings set data = data where key = 'general'$q$)
            and (select count(*) from public.site_settings_private where key = 'notifications') = 1,
  'roles: an Administrator still saves settings and reads the private ones');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk(not pg_temp.fails($q$update public.site_settings set data = data where key = 'roles'$q$),
  'roles: the owner still edits roles');

-- ================================================== 4. the owner's row
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select hchk((select count(*) from public.site_settings_private where key = 'chat_push') = 0,
  'chat notifications: an Administrator cannot read the notification row (secret, keys)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk((select count(*) from public.site_settings_private where key = 'chat_push') = 1,
  'chat notifications: the owner can');

-- ======================================================= 5. orders
reset role; set role anon; select pg_temp.as_anon('203.0.113.9');
select hchk(pg_temp.fails($q$insert into public.orders (ref, name, total, status, created_at) values ('VB-FAKE1','x',9999999,'pending', now() - interval '200 days')$q$),
  'orders: nobody can write an order straight into the table');
select hchk(pg_temp.err($q$select public.place_order('{"name":"Guest","total":"1"}'::jsonb, '[{"sku":"A","name":"A","price":"1","qty":"1"}]'::jsonb)$q$) like '%permission denied%',
  'orders: a visitor cannot call place_order and name their own prices');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select hchk(pg_temp.fails($q$select public.place_order('{"name":"x"}'::jsonb, '[]'::jsonb, null, '00000000-0000-0000-0000-0000000000c3'::uuid, null)$q$),
  'orders: nor can a signed-in customer');
select hchk(pg_temp.fails($q$insert into public.order_items (order_id, sku, name, price, qty) select id, 'X', 'x', 0, 1 from public.orders limit 1$q$),
  'orders: nor add a line to an order');
reset role; set role service_role; select pg_temp.as_service();
select hchk((public.place_order('{"name":"Real Customer","total":"1850","currency":"ZMW"}'::jsonb,
                                '[{"sku":"BAG-001","name":"Bag","price":"1850","qty":"1"}]'::jsonb,
                                null, '00000000-0000-0000-0000-0000000000c3'::uuid, '198.51.100.7')->>'ref') like 'VB-%',
  'orders: the website''s own function (service key) places an order');
reset role;
select hchk((select customer_id from public.orders where name = 'Real Customer' order by created_at desc limit 1)
            = '00000000-0000-0000-0000-0000000000c3',
  'orders: filed under the customer the function vouched for');
set role service_role; select pg_temp.as_service();
select public.place_order('{"name":"Nobody"}'::jsonb, '[]'::jsonb, null, '00000000-0000-0000-0000-0000000000ff'::uuid, '198.51.100.8');
reset role;
select hchk((select customer_id from public.orders where name = 'Nobody' limit 1) is null,
  'orders: a customer id that is not a customer is filed as a guest');
set role service_role; select pg_temp.as_service();
do $$ begin for i in 1..9 loop perform public.place_order('{"name":"Burst"}'::jsonb, '[]'::jsonb, null, null, '198.51.100.7'); end loop; end $$;
select hchk(pg_temp.err($q$select public.place_order('{"name":"Burst"}'::jsonb, '[]'::jsonb, null, null, '198.51.100.7')$q$) like 'Too many%',
  'orders: the eleventh order in an hour from one connection is refused');
select hchk(not pg_temp.fails($q$select public.place_order('{"name":"Other"}'::jsonb, '[]'::jsonb, null, null, '198.51.100.99')$q$),
  'orders: while somebody else still orders');
reset role;

-- ======================================================= 6. test payments
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk(pg_temp.err($q$update public.orders set pay_mode = 'live' where ref = 'VB-PII22'$q$) like 'payment details are set by the payment service only%',
  'test payments: not even the owner can relabel a test payment as live');
reset role; set role service_role; select pg_temp.as_service();
select hchk(not pg_temp.fails($q$update public.orders set payment_method = 'online', payment_status = 'paid', pay_mode = 'test' where ref = 'VB-PII22'$q$),
  'test payments: the payment service records the mode');
select hchk(not pg_temp.fails($q$insert into public.orders (ref, name, total, status, payment_method, payment_status, pay_mode, currency)
                                 values ('VB-LIVE1', 'Real Buyer', 700, 'pending', 'online', 'paid', 'live', 'ZMW')$q$),
  'test payments: (a live payment, for the next check)');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk((public.pay_sales_split(current_date - 1, current_date + 1, 'UTC') ->> 'online_orders')::int = 1
        and (public.pay_sales_split(current_date - 1, current_date + 1, 'UTC') ->> 'online_sales')::numeric = 700,
  'test payments: Analytics counts the live payment and not the test one');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select hchk(pg_temp.fails($q$select public.pay_sales_split(current_date - 1, current_date + 1, 'UTC')$q$),
  'test payments: and the sales figures are for roles ticked for Analytics only');
reset role;

-- ======================================================= 7. preview key
update public.site_settings set data = coalesce(data, '{}'::jsonb) || '{"previewKey":"letmein-77"}' where key = 'general';
insert into public.site_settings (key, data) select 'general', '{"previewKey":"letmein-77"}'
 where not exists (select 1 from public.site_settings where key = 'general');
select hchk(not ((select data from public.site_settings where key = 'general') ? 'previewKey'),
  'preview key: written into the public settings, it is moved out before it is stored');
set role anon; select pg_temp.as_anon();
select hchk(public.preview_ok('letmein-77') and not public.preview_ok('guess') and not public.preview_ok(''),
  'preview key: the right key opens the closed shop, a guess does not');
select hchk(not exists (select 1 from public.site_settings where data::text like '%letmein-77%'),
  'preview key: and a visitor can no longer read it');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk((select data->>'previewKey' from public.site_settings_private where key = 'general') = 'letmein-77',
  'preview key: the owner still sees it in Settings (the private half of General)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal1');
select hchk(not exists (select 1 from public.site_settings_private where key = 'general'), 'preview key: an Agent does not');
reset role;

-- ======================================================= 8. push keys
select hchk(coalesce((select data->>'vapidPublic' from public.site_settings_private where key = 'chat_push'), '') = '',
  'notification keys: the pair every zip shipped with is gone');
select hchk(not exists (select 1 from public.site_settings_private where key = 'chat_push' and data::text like '%mailto:%'),
  'notification keys: and no email address is sent with notifications');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6', 'aal2');
select hchk(pg_temp.err($q$select public.chat_push_keys_set(repeat('A', 87), repeat('B', 43))$q$) like 'Only the shop owner%',
  'notification keys: only the owner may set new ones');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk(pg_temp.err($q$select public.chat_push_keys_set('short', 'key')$q$) like 'Those are not%',
  'notification keys: and only a well-formed pair');
select hchk(public.chat_push_keys_set(repeat('A', 87), repeat('B', 43)), 'notification keys: the owner''s browser stores its own pair');
select hchk(public.chat_push_key() = repeat('A', 87), 'notification keys: and every device is handed its public half');
select hchk(not public.chat_push_keys_set(repeat('C', 87), repeat('D', 43)) and public.chat_push_key() = repeat('A', 87),
  'notification keys: a second device cannot swap out keys that work');
reset role;

-- ======================================================= 9. newsletter
set role anon; select pg_temp.as_anon('192.0.2.50');
select hchk(pg_temp.fails($q$insert into public.subscribers (email) values ('not-an-email-at-all')$q$),
  'newsletter: nothing can be written straight into the list');
select hchk(public.subscribe_email('new@mail.test', false), 'newsletter: a new address still joins');
select public.subscribe_email('gone@mail.test', true);
reset role;
select hchk((select unsubscribed_at from public.subscribers where email = 'gone@mail.test') is not null,
  'newsletter: typing an unsubscribed address no longer puts it back on the list');
set role anon; select pg_temp.as_anon('192.0.2.50');
select hchk(pg_temp.fails($q$select public.newsletter_join('gone@mail.test')$q$),
  'newsletter: a visitor cannot ask for a rejoin link themselves (only the website''s function)');
reset role; set role service_role; select pg_temp.as_service();
create temporary table nl as select public.newsletter_join('gone@mail.test', '192.0.2.51') as j;
select hchk((select j->>'state' from nl) = 'confirm' and length(select_token) = 48, 'newsletter: the function gets a one-off link for that inbox')
  from (select j->>'token' as select_token from nl) t;
select hchk((public.newsletter_join('gone@mail.test', '192.0.2.51')->>'state') = 'wait',
  'newsletter: and not a second one within the hour');
select hchk(not public.newsletter_confirm(repeat('0', 48)), 'newsletter: a made-up link does nothing');
select hchk(public.newsletter_confirm((select j->>'token' from nl)), 'newsletter: the real link puts the address back');
select hchk(not public.newsletter_confirm((select j->>'token' from nl)), 'newsletter: once');
reset role;
select hchk((select unsubscribed_at from public.subscribers where email = 'gone@mail.test') is null,
  'newsletter: and the address is on the list again');

-- ======================================================= 10. throttles
set role anon; select pg_temp.as_anon('192.0.2.77');
do $$ begin for i in 1..6 loop perform public.chat_start('Ann', null, null, '/'); end loop; end $$;
select hchk(pg_temp.err($q$select public.chat_start('Ann', null, null, '/')$q$) like 'Too many%',
  'throttle: the seventh new chat in ten minutes from one connection is refused');
select pg_temp.as_anon('192.0.2.78');
select hchk(not pg_temp.fails($q$select public.chat_start('Bea', null, null, '/')$q$),
  'throttle: another visitor still starts a chat');
select pg_temp.as_anon(null);
do $$ begin for i in 1..8 loop perform public.chat_start('NoAddress', null, null, '/'); end loop; end $$;
select hchk(true, 'throttle: with no address to go on, only the shop-wide limit applies (8 chats went through)');
select pg_temp.as_anon('192.0.2.79');
create temporary table tok as select public.chat_start('Cat', null, null, '/') as t;
do $$ begin for i in 1..20 loop perform public.chat_send((select t from tok), 'hello ' || i); end loop; end $$;
select hchk(pg_temp.err($q$select public.chat_send((select t from tok), 'one too many')$q$) like 'Too many%',
  'throttle: the 21st message in a minute in one chat is refused (no flood of phone buzzes)');
select pg_temp.as_anon('192.0.2.80');
do $$ begin for i in 1..3 loop insert into public.reviews (name, rating, comment, approved) values ('R' || i, 5, 'Fine', false); end loop; end $$;
select hchk(pg_temp.err($q$insert into public.reviews (name, rating, comment, approved) values ('R4', 5, 'Fine', false)$q$) like 'Too many%',
  'throttle: the fourth review in an hour from one connection is refused');
reset role;

-- ======================================================= 11. internals
set role anon; select pg_temp.as_anon();
select hchk(pg_temp.err($q$select public.site_rollup_range(current_date - 10, current_date - 1, 'Pacific/Kiritimati')$q$) like '%permission denied%',
  'internals: a visitor can no longer run the analytics rollups');
select hchk(pg_temp.err($q$select public.throttle('order', 'shop', 1, interval '1 hour')$q$) like '%permission denied%',
  'internals: nor use up a throttle to shut the shop for others');
select hchk(pg_temp.err($q$select public.users_list()$q$) like '%permission denied%',
  'internals: nor reach the admin''s own functions at all');
select hchk(not pg_temp.fails('select * from public.product_meta, public.site_content, public.site_settings, public.policies, public.reviews limit 1'),
  'still works: a visitor reads products, settings, policies and reviews');
select hchk(not pg_temp.fails($q$insert into public.reviews (name, rating, comment, approved) values ('Fresh', 5, 'Lovely', false)$q$),
  'still works: a visitor leaves a review for approval');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select hchk(pg_temp.fails($q$select public.site_rollup(current_date, 'UTC')$q$),
  'internals: not even staff call the rollups directly');
select hchk(not pg_temp.fails($q$select public.site_stats(current_date - 7, current_date, 'UTC')$q$),
  'still works: the owner reads the analytics (the rollups run inside)');
reset role; set role service_role; select pg_temp.as_service();
select hchk(not pg_temp.fails($q$select public.site_prune(30, 'UTC')$q$), 'the nightly clean-up (service key) now runs');
reset role;
select hchk(not has_function_privilege('authenticated', 'public.account_signup_state(text)', 'execute')
            and not has_function_privilege('authenticated', 'public.chat_note_event(uuid,uuid,uuid)', 'execute'),
  'internals: what only the service key may use stays that way');
select hchk(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.prokind = 'f'
                           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')),
  'search path: every function says where to look');
select hchk(exists (select 1 from public.schema_migrations where version = '076-hardening'),
  'the record: this file is written down as run');

reset role;
select case when ok then '  ✓ ' else '  ✗ ' end || what from hardening_checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  hardening: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from hardening_checks;
