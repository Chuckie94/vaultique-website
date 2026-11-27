-- ===========================================================================
-- THE BACKUPS' RECORDS, THE DATABASE SIDE, CHECKED (website build 92)
--
-- Load, in this order, into an empty database (tools/sql-tests.sh, chain
-- "backup"): tests/pos-orders-fixture.sql, supabase-setup.sql,
-- supabase-payments.sql, tests/pos-orders-admins.sql, supabase-rewards.sql,
-- supabase-pos-orders.sql, then supabase-backup.sql twice (it is safe to run
-- again), then this file.
--
-- The backup writes one line for each copy with the service key; the team
-- with Settings reads them; nobody signed in writes them.
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

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
                                          ('22222222-2222-2222-2222-222222222222', 'customer@shop.test')
on conflict do nothing;
insert into public.admins (id, email, role) values ('11111111-1111-1111-1111-111111111111', 'owner@shop.test', 'owner')
on conflict do nothing;

select chk(to_regclass('public.backup_runs') is not null and to_regclass('public.restore_findings') is not null,
       'the two records are there');
select chk((select relrowsecurity from pg_class where oid = 'public.backup_runs'::regclass)
           and (select relrowsecurity from pg_class where oid = 'public.restore_findings'::regclass),
       'both with row level security on');

set role service_role;
insert into public.backup_runs (kind, ok, checked, copy_id, size_bytes, tables, rows, logins, pictures_new, pictures_total, copies_kept, seconds)
values ('copy', true, true, '2026-11-27T0117Z', 560000, 53, 357, 9, 2, 2, 1, 21),
       ('drill', true, true, '2026-11-27T0117Z', 560000, 53, 357, 9, 0, 0, 0, 30);
select chk(err($q$insert into public.backup_runs (kind) values ('restore')$q$) <> ''
           and err($q$insert into public.backup_runs (kind, copy_id) values ('copy', 'yesterday')$q$) <> '',
       'a line is only ever a copy or a drill, named by its time');
insert into public.restore_findings (restored_from, kind, gateway, mode, reference, amount, currency)
values ('2026-11-27T01:17:00Z', 'payment_not_in_copy', 'lenco', 'live', 'VB-LOST1-0000000003', 1200, 'ZMW');
select chk(err($q$insert into public.restore_findings (restored_from, kind, gateway, mode, reference)
                  values ('2026-11-27T01:17:00Z', 'payment_not_in_copy', 'lenco', 'live', 'VB-LOST1-0000000003')$q$) ~ 'duplicate|unique',
       'each thing found after a restore is kept once, however often the check runs');
reset role;

set role anon;
select chk(err('select count(*) from public.backup_runs') ~ 'permission denied'
           and err('select count(*) from public.restore_findings') ~ 'permission denied',
       'a visitor reads neither');
reset role;
insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((select count(*) from public.backup_runs) = 0 and (select count(*) from public.restore_findings) = 0,
       'a signed-in customer reads neither');
reset role;
delete from auth.whoami;
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select chk((select count(*) from public.backup_runs) = 2 and (select count(*) from public.restore_findings) = 1,
       'the owner reads both');
select chk(err($q$insert into public.backup_runs (kind) values ('copy')$q$) <> ''
           and err($q$update public.backup_runs set ok = false$q$) <> ''
           and err($q$delete from public.restore_findings$q$) <> '',
       'and writes neither: only the backup and the server do');
reset role;
delete from auth.whoami;
select chk(not has_function_privilege('anon', 'public.may_backups()', 'execute'), 'its one function is not a visitor''s');

select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   backup database: all ' || count(*) || ' checks passed'
            else '   backup database: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
