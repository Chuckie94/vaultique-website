-- ===========================================================================
-- THE FRAUD CHECK AND THE SEALED RECORD, THE DATABASE SIDE, CHECKED (build 91)
--
-- Load, in this order, into an empty database (tools/sql-tests.sh, chain
-- "risk"): tests/pos-orders-fixture.sql, supabase-setup.sql,
-- supabase-payments.sql, tests/pos-orders-admins.sql, supabase-rewards.sql,
-- supabase-pos-orders.sql, supabase-payment-history.sql,
-- tests/order-progress-fixture.sql, supabase-order-progress.sql,
-- supabase-online-refund.sql, supabase-lenco.sql, then supabase-risk.sql
-- twice (it is safe to run again), then this file.
--
-- The cases are the server's to write and the team's to read and answer; the
-- record is the database's own, and shows any entry changed or taken out.
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
create table said (k text primary key, v jsonb);
grant all on said to anon, authenticated, service_role;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
                                          ('22222222-2222-2222-2222-222222222222', 'customer@shop.test'),
                                          ('33333333-3333-3333-3333-333333333333', 'clerk@shop.test')
on conflict do nothing;
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict do nothing;

-- The server's writes carry the service role, as PostgREST says it.
create or replace function as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
$$;
create or replace function as_nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', false);
$$;

-- 1) WHAT IS THERE --------------------------------------------------------------------------------
select chk(to_regclass('public.risk_cases') is not null and to_regclass('public.audit_chain') is not null
           and to_regclass('public.audit_anchors') is not null,
       'the cases, the sealed record and its anchors are there');
select chk((select relrowsecurity from pg_class where oid = 'public.risk_cases'::regclass)
           and (select relrowsecurity from pg_class where oid = 'public.audit_chain'::regclass)
           and (select relrowsecurity from pg_class where oid = 'public.audit_anchors'::regclass),
       'all three have row level security on');
select chk(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                    and column_name = 'risk_level'),
       'an order can carry the level the check gave it');
select chk(err($q$update public.orders set risk_level = 'extreme' where ref = 'nothing'$q$) = ''
           and err($q$insert into public.orders (id, ref, name, total, status, risk_level)
                       values ('dddddddd-0000-0000-0000-00000000000f', 'VB-BAD01', 'x', 1, 'pending', 'extreme')$q$) <> '',
       'and only Low, Medium, High or Critical');
select chk((select count(*) from pg_trigger where tgname like 'zz_audit_%') = 7,
       'the record is kept for orders, payments, refunds, the team, both settings tables and the cases');
select chk(to_regprocedure('public.two_factor_required()') is null,
       'without supabase-hardening.sql, two-factor is left alone (the file adds Fraud & Risk to it only when it is there)');

-- 2) THE SCORE'S COUNTS, FROM WHAT IS ALREADY KEPT -----------------------------------------------
insert into public.orders (id, ref, name, phone, email, address, total, currency, status, fulfilment, created_at,
                           payment_method, payment_status, pay_ref)
values ('dddddddd-0000-0000-0000-000000000001', 'VB-RK001', 'Many Orders', '0977 123 456', 'many@shop.test', 'Plot 1',
        300, 'ZMW', 'pending', 'delivery', now() - interval '3 hours', 'online', 'awaiting', 'VB-RK001-aaaaaaaaaa'),
       ('dddddddd-0000-0000-0000-000000000002', 'VB-RK002', 'Many Orders', '+260977123456', 'MANY@shop.test', 'Plot 1',
        300, 'ZMW', 'pending', 'delivery', now() - interval '2 hours', null, null, null),
       ('dddddddd-0000-0000-0000-000000000003', 'VB-RK003', 'Many Orders', '0977123456', 'many@shop.test', 'Plot 1',
        300, 'ZMW', 'pending', 'delivery', now() - interval '1 hour', null, null, null),
       ('dddddddd-0000-0000-0000-000000000004', 'VB-RK004', 'Old Order', '0977123456', 'many@shop.test', 'Plot 1',
        300, 'ZMW', 'completed', 'delivery', now() - interval '3 days', null, null, null);
set role service_role;
insert into public.payments (order_id, tx_ref, provider, mode, status, amount, currency, phone, created_at)
values ('dddddddd-0000-0000-0000-000000000001', 'VB-RK001-0000000001', 'lenco', 'live', 'failed', 300, 'ZMW', '0977123456', now() - interval '3 hours'),
       ('dddddddd-0000-0000-0000-000000000001', 'VB-RK001-0000000002', 'lenco', 'live', 'failed', 300, 'ZMW', '0977123456', now() - interval '2 hours'),
       ('dddddddd-0000-0000-0000-000000000001', 'VB-RK001-aaaaaaaaaa', 'lenco', 'live', 'started', 300, 'ZMW', '0977123456', now() - interval '1 hour');
insert into said values ('facts', public.risk_facts(jsonb_build_object('phone', '0977123456', 'email', 'Many@Shop.test',
                                                                       'order_id', 'dddddddd-0000-0000-0000-000000000001')));
reset role;
select chk((select (v ->> 'ordersPhone')::int = 3 from said where k = 'facts'),
       'orders from one phone in a day are counted, however the number is written (and not one from three days ago)');
select chk((select (v ->> 'ordersEmail')::int = 3 from said where k = 'facts'), 'orders from one email in a day, in any capitals');
select chk((select (v ->> 'failedPhone')::int = 2 from said where k = 'facts'), 'failed payments from that phone in a day');
select chk((select (v ->> 'paymentRefs')::int = 3 and (v ->> 'failedOrder')::int = 2 from said where k = 'facts'),
       'payment attempts on one order, and how many failed');
select chk((select v ? 'usualTotal' and v ? 'usualOf' from said where k = 'facts'), 'and the shop''s usual order, with how many it is from');
select chk(not has_function_privilege('anon', 'public.risk_facts(jsonb)', 'execute')
           and not has_function_privilege('authenticated', 'public.risk_facts(jsonb)', 'execute')
           and has_function_privilege('service_role', 'public.risk_facts(jsonb)', 'execute'),
       'only the server can ask for the counts');

-- 3) THE CASES: THE SERVER WRITES, THE TEAM READS ------------------------------------------------
select as_service();
set role service_role;
insert into public.risk_cases (id, moment, order_id, order_ref, tx_ref, score, level, reasons, mode, action, would, review_state)
values ('cccccccc-0000-0000-0000-000000000001', 'payment_paid', 'dddddddd-0000-0000-0000-000000000001', 'VB-RK001',
        'VB-RK001-aaaaaaaaaa', 75, 'high', '[{"signal":"ordersPhone","points":15,"said":"3 orders from this phone number in a day"}]',
        'act', 'held', 'held', 'open'),
       ('cccccccc-0000-0000-0000-000000000002', 'order_placed', 'dddddddd-0000-0000-0000-000000000002', 'VB-RK002',
        null, 35, 'medium', '[]', 'watch', 'none', 'shown', 'none'),
       ('cccccccc-0000-0000-0000-000000000003', 'payment_start', 'dddddddd-0000-0000-0000-000000000003', 'VB-RK003',
        'VB-RK003-cccccccccc', 95, 'critical', '[]', 'watch', 'none', 'refused', 'open');
select chk(err($q$insert into public.risk_cases (moment, tx_ref, score, level, reasons, mode, action)
                  values ('payment_paid', 'VB-RK001-aaaaaaaaaa', 10, 'low', '[]', 'watch', 'none')$q$) ~ 'duplicate|unique',
       'one case for each payment''s confirmation: a second message about the same payment shares the first one''s decision');
select chk(err($q$insert into public.risk_cases (moment, tx_ref, score, level, reasons, mode, action)
                  values ('payment_start', 'VB-RK003-cccccccccc', 10, 'low', '[]', 'watch', 'none')$q$) ~ 'duplicate|unique',
       'and one for each payment''s start');
select chk(err($q$insert into public.risk_cases (moment, score, level, reasons, mode, action)
                  values ('payment_paid', 10, 'extreme', '[]', 'watch', 'none')$q$) <> ''
           and err($q$insert into public.risk_cases (moment, score, level, reasons, mode, action)
                      values ('payment_paid', 10, 'low', '{}', 'watch', 'none')$q$) <> '',
       'a case is only ever a known level, with its reasons as a list');
reset role;
select as_nobody();

set role anon;
select chk(err('select count(*) from public.risk_cases') ~ 'permission denied',
       'a visitor reads no case');
select chk(err($q$insert into public.risk_cases (moment, score, level, reasons, mode) values ('staff', 1, 'low', '[]', 'watch')$q$) <> '',
       'and writes none');
reset role;
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select count(*) from public.risk_cases) = 0, 'a signed-in customer reads no case, not even one about their own order');
select chk((public.risk_decide('cccccccc-0000-0000-0000-000000000001', 'approve', null) ->> 'why') = 'not_allowed',
       'and cannot answer one');
select chk((public.risk_summary(7) ->> 'why') = 'not_allowed', 'or read the totals');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((select count(*) from public.risk_cases) = 3, 'the owner reads every case');
select chk(err($q$update public.risk_cases set review_state = 'approved' where id = 'cccccccc-0000-0000-0000-000000000001'$q$) <> ''
           and err($q$delete from public.risk_cases where id = 'cccccccc-0000-0000-0000-000000000002'$q$) <> ''
           and err($q$insert into public.risk_cases (moment, score, level, reasons, mode) values ('staff', 1, 'low', '[]', 'watch')$q$) <> '',
       'even the owner changes a case only by answering it: no direct write, no deletion');
insert into said values ('summary', public.risk_summary(7));
reset role;
select chk((select (v ->> 'ok')::boolean and (v ->> 'assessed')::int = 3 and (v -> 'levels' ->> 'critical')::int = 1
                   and (v ->> 'held')::int = 1 and (v ->> 'wouldRefuse')::int = 1 and (v ->> 'open')::int = 2
                   and jsonb_array_length(v -> 'histogram') = 10 and v ? 'trend' and v ? 'refunds' and v ->> 'mode' = 'watch'
              from said where k = 'summary'),
       'the totals: scored, by level, held, what watching would have refused, waiting, the spread of scores, the trend, refunds, the mode');
select chk((select (v ->> 'failedPayments')::int >= 2 and (v ->> 'duplicateAttempts')::int >= 1 from said where k = 'summary'),
       'failed payments and orders tried more than once, from the payments kept since build 88');

-- 4) THE ANSWERS ------------------------------------------------------------------------------------
set role service_role;
update public.payments set status = 'review', detail = '{"risk_hold":{"case":"cccccccc-0000-0000-0000-000000000001","level":"high","score":75}}'
 where tx_ref = 'VB-RK001-aaaaaaaaaa';
reset role;
set role authenticated;
select chk((public.risk_decide('cccccccc-0000-0000-0000-000000000001', 'reject', '  ') ->> 'why') = 'say_why',
       'rejecting needs a reason');
select chk((public.risk_decide('cccccccc-0000-0000-0000-000000000001', 'maybe', null) ->> 'why') = 'unreadable',
       'only approve, reject or escalate');
insert into said values ('approve', public.risk_decide('cccccccc-0000-0000-0000-000000000001', 'approve', null));
select chk((public.risk_decide('cccccccc-0000-0000-0000-000000000001', 'reject', 'too late') ->> 'why') = 'answered',
       'a case is answered once');
select chk((public.risk_decide('cccccccc-0000-0000-0000-000000000003', 'escalate', 'Please look') ->> 'state') = 'escalated'
           and (public.risk_decide('cccccccc-0000-0000-0000-000000000003', 'reject', 'Not our customer') ->> 'state') = 'rejected',
       'an escalated case can still be answered');
reset role;
select chk((select (v ->> 'ok')::boolean and v ->> 'state' = 'approved' and (v ->> 'release')::boolean from said where k = 'approve'),
       'approving a held payment says it is to be released');
select chk((select status from public.payments where tx_ref = 'VB-RK001-aaaaaaaaaa') = 'review'
           and (select payment_status from public.orders where ref = 'VB-RK001') = 'awaiting',
       'but marks nothing paid: that waits for the gateway''s own word, asked by the server');
select chk((select review_state = 'approved' and reviewed_by = '11111111-1111-1111-1111-111111111111' and reviewed_at is not null
              from public.risk_cases where id = 'cccccccc-0000-0000-0000-000000000001')
           and (select review_note from public.risk_cases where id = 'cccccccc-0000-0000-0000-000000000003') = 'Not our customer',
       'each answer keeps who gave it, when, and why');

-- 5) THE SEALED RECORD ------------------------------------------------------------------------------------
select chk((select count(*) from public.audit_chain where tbl = 'risk_cases' and action = 'decision') = 3
           and (select count(*) from public.audit_chain where tbl = 'risk_cases' and action = 'review') = 3,
       'every decision of the check, and every answer to one, is in the record');
select chk(exists (select 1 from public.audit_chain where tbl = 'risk_cases' and action = 'review'
                    and actor = '11111111-1111-1111-1111-111111111111' and via = 'staff'),
       'with who answered');
select chk(exists (select 1 from public.audit_chain where tbl = 'risk_cases' and action = 'decision' and via = 'service'),
       'and the check''s own decisions marked as the server''s');
update public.orders set phone = '0966000000', status = 'confirmed' where ref = 'VB-RK002';
select chk(exists (select 1 from public.audit_chain where tbl = 'orders' and row_ref = 'VB-RK002' and action = 'update'
                    and detail -> 'status' ->> 1 = 'confirmed')
           and not exists (select 1 from public.audit_chain where detail::text like '%0966000000%'),
       'a change to an order is recorded; a customer''s phone is named as changed, never written down');
select chk(exists (select 1 from public.audit_chain where tbl = 'orders' and row_ref = 'VB-RK002' and detail::text like '%phone%'),
       'but that it changed is');
select count(*) as before_quiet from public.audit_chain \gset
set role service_role;
update public.payments set updated_at = now() where tx_ref = 'VB-RK001-0000000001';
reset role;
select chk((select count(*) from public.audit_chain) = :before_quiet,
       'a payment checked again, with nothing about it changed, adds nothing to the record');
insert into public.site_settings (key, data) values ('risk', '{}') on conflict (key) do nothing;
update public.site_settings set data = '{"x":1}' where key = 'risk';
select chk(exists (select 1 from public.audit_chain where tbl = 'site_settings' and row_ref = 'risk'
                    and detail -> 'changed' = '["x"]'::jsonb and detail::text not like '%: 1%'),
       'a settings change records which settings changed, not their values');

set role anon;
select chk(err('select count(*) from public.audit_chain') ~ 'permission denied'
           and err('select count(*) from public.audit_anchors') ~ 'permission denied',
       'a visitor reads nothing of the record');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select count(*) from public.audit_chain) = 0, 'nor does a signed-in customer');
select chk((public.audit_verify(100) ->> 'why') = 'not_allowed', 'who cannot check it either');
reset role;
delete from auth.whoami;

set role service_role;
select chk(err('update public.audit_chain set action = ''nothing'' where id = 1') <> ''
           and err('delete from public.audit_chain where id = 1') <> ''
           and err('truncate public.audit_chain') <> '',
       'the server cannot change, take out or empty the record');
reset role;
select chk(err('update public.audit_chain set action = ''nothing'' where id = 1') ~ 'cannot be changed|record'
           and err('delete from public.audit_chain where id = 1') ~ 'cannot be changed|record'
           and err('truncate public.audit_chain') ~ 'cannot be changed|record',
       'nor can the database''s owner, without first taking its protection off');

select chk((public.audit_verify(100000) ->> 'ok')::boolean, 'the record checks out: every entry follows the one before it and its seal is right');
set role service_role;
insert into said values ('anchor', public.audit_anchor());
reset role;
select chk((select (v ->> 'anchored')::boolean from said where k = 'anchor') and (select count(*) from public.audit_anchors) = 1,
       'the server anchors where the record stood');
select chk(not has_function_privilege('anon', 'public.audit_anchor()', 'execute')
           and not has_function_privilege('authenticated', 'public.audit_anchor()', 'execute'),
       'and only the server');

-- Drills: each kind of tampering, by somebody with the owner's password.
insert into public.audit_chain (at, via, tbl, row_ref, action, detail, prev_hash, hash)
values (now(), 'staff', 'orders', 'VB-FAKE', 'update', '{}', repeat('0', 64), repeat('0', 64));
select chk((public.audit_verify(100000) ->> 'why') in ('link', 'seal'), 'DRILL: a line added by hand does not check out');
alter table public.audit_chain disable trigger audit_chain_frozen;
delete from public.audit_chain where row_ref = 'VB-FAKE';
select chk((public.audit_verify(100000) ->> 'ok')::boolean, 'taken out again, the record checks out');
update public.audit_chain set detail = detail || '{"amount":1}'::jsonb
 where id = (select min(id) from public.audit_chain where tbl = 'orders');
select chk((public.audit_verify(100000) ->> 'why') = 'seal', 'DRILL: an entry changed afterwards is caught (its seal)');
update public.audit_chain set detail = detail - 'amount'
 where id = (select min(id) from public.audit_chain where tbl = 'orders');
select chk((public.audit_verify(100000) ->> 'ok')::boolean, 'put back, it checks out again');
select id as gone from public.audit_chain order by id offset 2 limit 1 \gset
create temp table kept as select * from public.audit_chain where id = :gone;
delete from public.audit_chain where id = :gone;
select chk((public.audit_verify(100000) ->> 'why') = 'link', 'DRILL: an entry taken out is caught (the next one no longer follows)');
insert into public.audit_chain select * from kept;
select chk((public.audit_verify(100000) ->> 'ok')::boolean, 'put back, it checks out again');
select max(id) as last from public.audit_chain \gset
create temp table tail as select * from public.audit_chain where id = :last;
delete from public.audit_chain where id = :last;
select chk((public.audit_verify(100000) ->> 'why') = 'anchor',
       'DRILL: the latest entries cut off the end are caught (the anchor no longer matches)');
insert into public.audit_chain select * from tail;
alter table public.audit_chain enable trigger audit_chain_frozen;
select chk((public.audit_verify(100000) ->> 'ok')::boolean, 'put back, it checks out again, and the protection is back on');

-- 6) THE TEAM'S OWN ACTIVITY ------------------------------------------------------------------------
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
delete from public.orders where ref = 'VB-RK004';
delete from auth.whoami;
set role service_role;
insert into said values ('staff', public.risk_staff_facts(now() - interval '1 hour'));
reset role;
select chk((select (x ->> 'deletes')::int >= 1 and (x ->> 'changes')::int >= 2
              from said, jsonb_array_elements(v) x where k = 'staff' and x ->> 'actor' = '11111111-1111-1111-1111-111111111111'),
       'the team''s deletions and changes in the last hour are counted per person, from the record');
select chk(not has_function_privilege('authenticated', 'public.risk_staff_facts(timestamptz)', 'execute'),
       'and only the server can count them');

-- 7) A REFUND'S OWN FACTS ------------------------------------------------------------------------------
set role service_role;
update public.payments set confirmed_at = now() - interval '30 minutes' where tx_ref = 'VB-RK001-0000000002';
reset role;
insert into public.refunds (id, request_key, order_id, order_ref, tx_ref, provider_tx_id, mode, currency, amount, whole, reason, by_name)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'rk-req-1', 'dddddddd-0000-0000-0000-000000000001', 'VB-RK001',
        'VB-RK001-0000000002', '999', 'live', 'ZMW', 300, true, 'Asked', 'Clerk One');
set role service_role;
insert into said values ('refund', public.risk_refund_facts('bbbbbbbb-0000-0000-0000-000000000001'));
reset role;
select chk((select (v ->> 'hoursSincePaid')::numeric between 0 and 1 and (v ->> 'refundsByStaffToday')::int = 1
                   and (v ->> 'amount')::numeric = 300 from said where k = 'refund'),
       'how soon after its payment a refund was asked, and how many the same person asked today');
select chk(exists (select 1 from public.audit_chain where tbl = 'refunds' and action = 'insert'),
       'and the refund itself is in the record');

-- The result ------------------------------------------------------------------------------------------------
select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   risk database: all ' || count(*) || ' checks passed'
            else '   risk database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
