-- =====================================================================
-- Vaultique Boutique Point: BACKUPS AND RECOVERY (website build 92)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, refund, setting or
-- key: it only adds two tables, and the function that says who may read
-- them.
--
-- WHAT IT IS FOR
--
--   backup_runs        one line for each copy GitHub makes of this database
--                      (.github/workflows/backup.yml), and each drill: when,
--                      whether it checked out by restoring it, its size, its
--                      tables and rows, the pictures copied. Read by Admin >
--                      Settings > Backups. Written only by the backup itself,
--                      with the service key.
--   restore_findings   what the check after a restore found on the payment
--                      gateways' own word: a payment made after the copy, a
--                      refund made after the copy (netlify/functions/
--                      after-restore.js). Written only by the server.
--
-- Read by the owner and by any role with Settings ticked (Settings > Users
-- & Roles); before supabase-hardening.sql, by every administrator. Nobody
-- signed in can write either table.
-- =====================================================================


-- 1) THE RIGHT DATABASE? -------------------------------------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.site_settings') is null then
    raise exception 'This is not the website''s database (no orders or site_settings). Nothing was created.';
  end if;
end
$guard$;


-- 2) WHO MAY READ --------------------------------------------------------------
create or replace function public.may_backups()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $mb$
declare v boolean;
begin
  if to_regprocedure('public.may(text)') is not null then
    execute 'select public.may(''settings'')' into v;
    return coalesce(v, false);
  end if;
  return public.is_admin();
end
$mb$;


-- 3) THE RUNS ------------------------------------------------------------------
create table if not exists public.backup_runs (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  kind           text not null,                 -- copy | drill
  ok             boolean not null default false,
  checked        boolean not null default false, -- restored into an empty database, every table and row back
  copy_id        text,                          -- 2026-11-27T0117Z: the copy's name in the storage account
  size_bytes     bigint not null default 0,
  tables         integer not null default 0,
  rows           bigint not null default 0,
  logins         integer not null default 0,
  pictures_new   integer not null default 0,
  pictures_total integer not null default 0,
  copies_kept    integer not null default 0,
  seconds        integer not null default 0,
  problems       jsonb not null default '[]'::jsonb,
  detail         jsonb not null default '{}'::jsonb
);
do $c$ begin
  alter table public.backup_runs add constraint backup_runs_shape check (
    kind in ('copy', 'drill') and jsonb_typeof(problems) = 'array' and jsonb_typeof(detail) = 'object'
    and (copy_id is null or copy_id ~ '^\d{4}-\d\d-\d\dT\d{4}Z$'));
exception when duplicate_object then null; end $c$;
create index if not exists backup_runs_at on public.backup_runs (at desc);
alter table public.backup_runs enable row level security;
drop policy if exists br_read on public.backup_runs;
create policy br_read on public.backup_runs for select using (public.may_backups());
revoke insert, update, delete, truncate on public.backup_runs from anon, authenticated;
revoke all on public.backup_runs from anon;


-- 4) WHAT THE CHECK AFTER A RESTORE FOUND -------------------------------------
create table if not exists public.restore_findings (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  restored_from timestamptz not null,           -- when the copy that was restored had been made
  kind         text not null,                   -- payment_not_in_copy | refund_not_in_copy | payment_settled
  gateway      text not null,                   -- lenco | flutterwave
  mode         text,                            -- test | live
  reference    text,                            -- our reference (VB-...), or the gateway's
  amount       numeric,
  currency     text,
  happened_at  timestamptz,
  detail       jsonb not null default '{}'::jsonb,
  resolved_at  timestamptz
);
do $c$ begin
  alter table public.restore_findings add constraint restore_findings_shape check (
    kind in ('payment_not_in_copy', 'refund_not_in_copy', 'payment_settled')
    and gateway in ('lenco', 'flutterwave') and (mode is null or mode in ('test', 'live'))
    and jsonb_typeof(detail) = 'object');
exception when duplicate_object then null; end $c$;
create unique index if not exists restore_findings_once on public.restore_findings (restored_from, kind, gateway, reference);
alter table public.restore_findings enable row level security;
drop policy if exists rf_read on public.restore_findings;
create policy rf_read on public.restore_findings for select using (public.may_backups());
revoke insert, update, delete, truncate on public.restore_findings from anon, authenticated;
revoke all on public.restore_findings from anon;


-- 5) WHO MAY CALL WHAT ---------------------------------------------------------
revoke all on function public.may_backups() from public, anon;
grant execute on function public.may_backups() to authenticated, service_role;

notify pgrst, 'reload schema';


-- 6) CHECK ---------------------------------------------------------------------
-- One row:  OK · backups can be recorded
select case when to_regclass('public.backup_runs') is not null and to_regclass('public.restore_findings') is not null
             and (select relrowsecurity from pg_class where oid = 'public.backup_runs'::regclass)
             and (select relrowsecurity from pg_class where oid = 'public.restore_findings'::regclass)
            then 'OK · backups can be recorded' else 'NOT DONE' end as backups;


-- =================================================================================
-- THE UNDO (only the records; the copies themselves are in your storage account)
--   drop table if exists public.restore_findings;
--   drop table if exists public.backup_runs;
--   drop function if exists public.may_backups();
-- =================================================================================
