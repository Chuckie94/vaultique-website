-- ===========================================================================
-- LENCO PAYMENTS, THE DATABASE SIDE, CHECKED (website build 88)
--
-- Load, in this order, into an empty database (tools/sql-tests.sh, chain
-- "lenco"): tests/pos-orders-fixture.sql, supabase-setup.sql,
-- supabase-payments.sql, tests/pos-orders-admins.sql, supabase-rewards.sql,
-- supabase-pos-orders.sql, supabase-payment-history.sql,
-- tests/order-progress-fixture.sql, supabase-order-progress.sql,
-- supabase-online-refund.sql, then supabase-lenco.sql twice (it is safe to
-- run again), then this file.
--
-- The payment service writes with the service key and is held to the same
-- rules as anybody: one payment per press of Pay, an order paid once, a
-- record of notices and of settings changes nobody can change, and no refund
-- written down for a payment whose gateway cannot take one.
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

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
                                          ('22222222-2222-2222-2222-222222222222', 'customer@shop.test')
on conflict do nothing;
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict do nothing;

-- Orders paid online: one through Lenco, one through Flutterwave; and one
-- waiting, with a first try four hours old and a second ten minutes old.
insert into public.orders (id, ref, name, phone, email, address, total, currency, status, fulfilment, created_at,
                           payment_method, payment_status, pay_ref, pay_channel, goods_total, delivery_fee, paid_amount, paid_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'VB-LN001', 'Lenco Buyer', '0971111111', 'l@shop.test', 'Plot 1, Lusaka',
   300, 'ZMW', 'confirmed', 'delivery', now() - interval '1 day', 'online', 'paid', 'VB-LN001-aaaaaaaaaa', 'mobile-money', 300, 0, 300, now() - interval '1 day'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'VB-FW001', 'Flutterwave Buyer', '0970000002', 'f@shop.test', 'Plot 2, Lusaka',
   500, 'ZMW', 'confirmed', 'collection', now() - interval '1 day', 'online', 'paid', 'VB-FW001-bbbbbbbbbb', 'card', 500, 0, 500, now() - interval '1 day'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'VB-LN002', 'Second Try Buyer', '0961111111', 's@shop.test', 'Plot 3, Lusaka',
   200, 'ZMW', 'pending', 'collection', now() - interval '4 hours', 'online', 'awaiting', 'VB-LN002-cccccccccc', null, 200, 0, null, null),
  ('eeeeeeee-0000-0000-0000-000000000004', 'VB-LN003', 'Walked Away', '0961111112', 'w@shop.test', 'Plot 4, Lusaka',
   250, 'ZMW', 'pending', 'collection', now() - interval '4 hours', 'online', 'awaiting', 'VB-LN003-dddddddddd', null, 250, 0, null, null);

set role service_role;
insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency, phone, provider_tx_id, channel,
                             method, network, provider_ref, provider_status, confirmed_at, verified_at, provider_response, client_key, detail)
values ('eeeeeeee-0000-0000-0000-000000000001', 'VB-LN001-aaaaaaaaaa', 'lenco', 'live', 'paid', 300, 'ZMW', '0971111111',
        'd7bd9ccb-0737-4e72-a387-d00454341f21', 'mobile-money', 'mobile', 'airtel', '240720004', 'successful', now(), now(),
        '{"operator":"airtel","lencoReference":"240720004"}', 'press-0000000000000001', '{"provider":"lenco","lenco_ref":"240720004"}');
insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency, provider_tx_id, channel)
values ('eeeeeeee-0000-0000-0000-000000000002', 'VB-FW001-bbbbbbbbbb', 'flutterwave', 'live', 'paid', 500, 'ZMW', '4440001', 'card');
insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency, created_at, method, network)
values ('eeeeeeee-0000-0000-0000-000000000003', 'VB-LN002-0000000001', 'lenco', 'live', 'started', 200, 'ZMW', now() - interval '4 hours', 'mobile', 'mtn'),
       ('eeeeeeee-0000-0000-0000-000000000003', 'VB-LN002-cccccccccc', 'lenco', 'live', 'started', 200, 'ZMW', now() - interval '10 minutes', 'mobile', 'mtn'),
       ('eeeeeeee-0000-0000-0000-000000000004', 'VB-LN003-dddddddddd', 'lenco', 'live', 'started', 250, 'ZMW', now() - interval '4 hours', 'mobile', 'mtn');
reset role;

-- 1) WHAT EVERY PAYMENT CARRIES ---------------------------------------------------------------
select chk((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payments'
             and column_name in ('method', 'network', 'provider_ref', 'provider_status', 'failure_reason',
                                 'confirmed_at', 'verified_at', 'provider_response', 'client_key')) = 9,
       'every payment can carry the way of paying, the network, the gateway''s reference and word, why it failed, when it was confirmed and last asked, and what the gateway said');
select chk((select provider = 'lenco' and method = 'mobile' and network = 'airtel' and provider_ref = '240720004'
                   and provider_response ->> 'operator' = 'airtel'
              from public.payments where tx_ref = 'VB-LN001-aaaaaaaaaa'),
       'a Lenco payment keeps them, beside the columns every payment had');
select chk((select provider = 'flutterwave' and method is null and client_key is null
              from public.payments where tx_ref = 'VB-FW001-bbbbbbbbbb'),
       'a Flutterwave payment is as it was');

-- 2) ONE PRESS OF PAY, ONE PAYMENT --------------------------------------------------------------
set role service_role;
select chk(err($q$insert into public.payments (order_id, tx_ref, provider, mode, amount, currency, client_key)
                  values ('eeeeeeee-0000-0000-0000-000000000003', 'VB-LN002-eeeeeeeeee', 'lenco', 'live', 200, 'ZMW',
                          'press-0000000000000001')$q$) like '%payments_client_key%',
       'the same press of Pay twice cannot make a second payment, even with the service key');
reset role;

-- 3) AN ORDER IS PAID ONCE ------------------------------------------------------------------------
set role service_role;
select chk(err($q$insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency)
                  values ('eeeeeeee-0000-0000-0000-000000000001', 'VB-LN001-ffffffffff', 'lenco', 'live', 'paid', 300, 'ZMW')$q$)
           like '%payments_one_paid%',
       'a second paid payment for an order already paid is refused by the database itself');
insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency)
values ('eeeeeeee-0000-0000-0000-000000000001', 'VB-LN001-gggggggggg', 'lenco', 'live', 'started', 300, 'ZMW');
select chk(err($q$update public.payments set status = 'paid' where tx_ref = 'VB-LN001-gggggggggg'$q$) like '%payments_one_paid%',
       'and so is marking a second try of it paid');
select chk(err($q$update public.payments set status = 'review', detail = '{"duplicate":true}' where tx_ref = 'VB-LN001-gggggggggg'$q$) = '',
       'held as a second payment ("needs attention") instead, it is kept');
reset role;
select chk((select count(*) from public.payments where order_id = 'eeeeeeee-0000-0000-0000-000000000001' and status = 'paid') = 1,
       'the order has exactly one paid payment');

-- 4) THE GATEWAYS' NOTICES -----------------------------------------------------------------------
set role service_role;
select chk(err($q$insert into public.payment_webhooks (provider, event, reference, mode, outcome, note)
                  values ('lenco', 'collection.successful', 'VB-LN001-aaaaaaaaaa', 'live', 'paid', '{"said":"successful"}')$q$) = '',
       'the payment service writes down a notice');
select chk(err($q$update public.payment_webhooks set outcome = 'failed'$q$) like '%cannot be changed%'
       and err($q$delete from public.payment_webhooks$q$) like '%cannot be changed%',
       'and nobody changes or deletes one, the service key included');
reset role;
set role anon;
select chk(err($q$select * from public.payment_webhooks$q$) like '%permission denied%',
       'a visitor reads none');
select chk(err($q$insert into public.payment_webhooks (provider, event) values ('lenco', 'forged')$q$) <> '',
       'and writes none');
reset role;
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select count(*) from public.payment_webhooks) = 0, 'a signed-in customer reads none');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((select count(*) from public.payment_webhooks) = 1, 'an administrator reads them');
reset role;
delete from auth.whoami;

-- 5) EVERY CHANGE TO SETTINGS > PAYMENTS ------------------------------------------------------------
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
insert into public.site_settings (key, data) values ('payments', '{"onlineEnabled":false,"lencoEnabled":false}')
on conflict (key) do update set data = excluded.data;
update public.site_settings set data = data || '{"lencoEnabled":true,"lencoAirtel":true}' where key = 'payments';
select chk(exists (select 1 from public.payment_settings_audit
                    where which = 'public' and by_id = '11111111-1111-1111-1111-111111111111' and by_email = 'owner@shop.test'
                      and changed -> 'lencoEnabled' = '[false, true]'::jsonb and changed -> 'lencoAirtel' = '[null, true]'::jsonb),
       'switching Lenco on is written down by the database: who, and each setting from what to what');
insert into public.site_settings_private (key, data) values ('payments', '{"bankAccountNumber":"1234567890123"}')
on conflict (key) do update set data = excluded.data;
update public.site_settings_private set data = '{"bankAccountNumber":"9999999999999"}' where key = 'payments';
select chk(exists (select 1 from public.payment_settings_audit where which = 'private' and changed = '["bankAccountNumber"]'::jsonb)
       and not exists (select 1 from public.payment_settings_audit where changed::text like '%9999999999999%' or changed::text like '%1234567890123%'),
       'a private detail changed: only its name is written down, never the account number');
update public.site_settings set data = coalesce(data, '{}'::jsonb) || '{"businessName":"Vaultique"}' where key = 'general';
insert into public.site_settings (key, data) values ('general', '{"businessName":"Vaultique"}') on conflict (key) do nothing;
select chk(not exists (select 1 from public.payment_settings_audit where changed ? 'businessName'),
       'another section''s settings are not its business');
update public.site_settings set data = data where key = 'payments';
select chk((select count(*) from public.payment_settings_audit where which = 'public') = 2,
       'a save that changes nothing writes nothing (the first line is the section''s first save)');
delete from auth.whoami;
set role service_role;
-- The service key has no right to it at all; the database's own guard is
-- the second lock, for anybody given one by mistake.
select chk(err($q$update public.payment_settings_audit set by_email = 'someone@else'$q$) <> ''
       and err($q$delete from public.payment_settings_audit$q$) <> '',
       'nobody changes or deletes a line of it');
reset role;
grant update, delete on public.payment_settings_audit to authenticated;
set role authenticated;
select chk(err($q$update public.payment_settings_audit set by_email = 'someone@else'$q$) like '%cannot be changed%'
       or err($q$update public.payment_settings_audit set by_email = 'someone@else'$q$) like '%permission denied%'
       or (select count(*) from public.payment_settings_audit where by_email = 'someone@else') = 0,
       'and with a right given by mistake, the guard still refuses');
reset role;
revoke update, delete on public.payment_settings_audit from authenticated;
set role service_role;
reset role;
set role anon;
select chk(err($q$select count(*) from public.payment_settings_audit$q$) like '%permission denied%',
       'a visitor reads none of it');
reset role;

-- 6) WALKED AWAY FROM: THREE HOURS AFTER THE LATEST TRY ---------------------------------------------
set role service_role;
select public.pay_expire_stale();
reset role;
select chk((select status from public.payments where tx_ref = 'VB-LN002-0000000001') = 'expired'
       and (select status from public.payments where tx_ref = 'VB-LN002-cccccccccc') = 'started'
       and (select payment_status = 'awaiting' and status = 'pending' from public.orders where ref = 'VB-LN002'),
       'an order whose second try is ten minutes old stays open, though the order is four hours old');
select chk((select payment_status = 'expired' and status = 'cancelled' from public.orders where ref = 'VB-LN003')
       and (select status from public.payments where tx_ref = 'VB-LN003-dddddddddd') = 'expired',
       'one whose only try is four hours old is closed, as before');
select chk(not has_function_privilege('anon', 'public.pay_expire_stale()', 'execute')
       and not has_function_privilege('authenticated', 'public.pay_expire_stale()', 'execute')
       and has_function_privilege('service_role', 'public.pay_expire_stale()', 'execute'),
       'and it is still the service key''s alone');

-- 7) A REFUND ONLY THROUGH THE GATEWAY THAT TOOK THE MONEY ----------------------------------------------
select chk((public.refund_state_of('eeeeeeee-0000-0000-0000-000000000001') ->> 'why') = 'no_refund_api'
       and not (public.refund_state_of('eeeeeeee-0000-0000-0000-000000000001') ->> 'canRefund')::boolean
       and (public.refund_state_of('eeeeeeee-0000-0000-0000-000000000001') -> 'pay' ->> 'gateway') = 'lenco',
       'a payment made through Lenco: no refund can be sent from here (no_refund_api), and it says which gateway');
select chk((public.refund_state_of('eeeeeeee-0000-0000-0000-000000000002') ->> 'canRefund')::boolean
       and (public.refund_state_of('eeeeeeee-0000-0000-0000-000000000002') -> 'pay' ->> 'gateway') = 'flutterwave',
       'one made through Flutterwave can be refunded, as before');
set role anon;
select chk((public.vbp_pos_refund_request(k(), 'VB-LN001', 300, true, 'Changed mind', 'A. Manager', 'Store Manager',
                                           'ORF-2026-0100', 'req-lenco-000000000001') ->> 'why') = 'no_refund_api',
       'the platform''s Online Refund for it is refused, saying why');
reset role;
select chk(not exists (select 1 from public.refunds where request_key = 'req-lenco-000000000001'),
       'and no refund is written down for it');

-- 8) THE PAYMENT HISTORY KEEPS LENCO'S WORDS ------------------------------------------------------------
set role service_role;
update public.payments set status = 'failed', failure_reason = 'Not enough funds',
       detail = '{"reason":"failed","provider":"lenco","why":"Not enough funds"}'
 where tx_ref = 'VB-LN002-cccccccccc';
reset role;
select chk(exists (select 1 from public.payment_events where tx_ref = 'VB-LN002-cccccccccc' and to_state = 'failed'
                    and note ->> 'why' = 'Not enough funds' and note ->> 'provider' = 'lenco'),
       'a failed try is a line in the payment history, with Lenco''s own reason');

-- 9) NOTHING ELSE OPEN -------------------------------------------------------------------------------------
select chk(not has_function_privilege('anon', 'public.payment_webhooks_frozen()', 'execute')
       and not has_function_privilege('anon', 'public.payment_settings_audit_log()', 'execute')
       and not has_function_privilege('authenticated', 'public.payment_settings_audit_log()', 'execute'),
       'the new functions are the database''s own: nobody calls them');
select chk((select relrowsecurity from pg_class where oid = 'public.payment_webhooks'::regclass)
       and (select relrowsecurity from pg_class where oid = 'public.payment_settings_audit'::regclass),
       'both new tables have row level security on');

-- The result ------------------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   lenco database: all ' || count(*) || ' checks passed'
            else '   lenco database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
