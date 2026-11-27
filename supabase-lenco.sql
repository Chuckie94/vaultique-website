-- =====================================================================
-- Vaultique Boutique Point: LENCO PAYMENTS (website build 88)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, refund, setting or key
-- already recorded: it adds columns, two tables and two locks, and replaces
-- two functions with the same ones and one rule more. Run in the wrong
-- project, or before the files it stands on, it stops at step 1 and
-- changes nothing.
--
-- WHAT IT ADDS
--
--   * On every payment: the way of paying (method: mobile or card), the
--     mobile money network, the gateway's own reference (provider_ref) and
--     its own last word (provider_status), why it failed (failure_reason),
--     when the gateway confirmed it (confirmed_at), when it was last asked
--     (verified_at), what it said (provider_response), and the key of the
--     press of Pay that made it (client_key). Earlier payments keep what
--     they have; Flutterwave's are untouched.
--
--   * ONE PRESS OF PAY, ONE PAYMENT: two payments can never share a
--     client_key, so a double tap or a repeated request is the same payment.
--
--   * AN ORDER IS PAID ONCE: the database refuses a second paid payment for
--     one order. A customer may try an order again after a failed payment;
--     if two tries were ever both paid, the second is held for the shop to
--     refund, never counted. (If this project already has an order with two
--     paid payments, which should never happen, this lock is not added and
--     the result line names how many orders to look at.)
--
--   * payment_webhooks: every signed notice a gateway sent (Lenco's, from
--     build 88): when, which event, which payment, and what the website did
--     with it. Nobody changes or deletes a line; administrators who may see
--     orders can read them (Settings > Payments). Unsigned calls are not
--     kept here, only counted.
--
--   * payment_settings_audit: every change to Settings > Payments, written
--     by the database itself, whoever made it and however: who, when, and
--     what changed (for the public settings, from what to what; for the
--     private ones, the bank and mobile money accounts, only which).
--     Nobody changes or deletes a line; administrators who may open
--     Settings can read them.
--
--   * pay_expire_stale: an order is closed as walked away from three hours
--     after its latest try, not its first, so a try made late is not cut
--     short.
--
--   * refund_state_of (the platform's Online Refund): a payment made through
--     a gateway this website cannot send a refund to (Lenco: its API has no
--     refund) says so (why: no_refund_api), and no refund is written down.
--     The shop refunds it from its Lenco account. The same rule is in
--     supabase-online-refund.sql from build 88, so running that file again
--     keeps it.
--
-- Until this is run, Lenco is not offered to customers (the website asks
-- the database whether these columns are there), and Flutterwave works
-- exactly as before.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH WHAT THIS STANDS ON? ----------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was changed.';
  end if;
  if to_regclass('public.payments') is null or to_regclass('public.orders') is null then
    raise exception 'This website has no payments table yet. Run supabase-payments.sql first, in the website''s Supabase. Nothing was changed.';
  end if;
  if to_regclass('public.payment_events') is null then
    raise exception 'The payment history is not here yet. Run supabase-payment-history.sql first (website 77). Nothing was changed.';
  end if;
  if to_regclass('public.refunds') is null or to_regprocedure('public.refund_state_of(uuid)') is null then
    raise exception 'Online refunds are not here yet. Run supabase-online-refund.sql first (website 81). Nothing was changed.';
  end if;
  if to_regclass('public.site_settings_private') is null then
    raise exception 'The private settings table is not here yet. Run supabase-setup.sql and the files after it first. Nothing was changed.';
  end if;
end
$guard$;


-- 2) WHAT EVERY PAYMENT CARRIES -------------------------------------------------------
alter table public.payments add column if not exists method            text;   -- mobile | card (bank: none yet)
alter table public.payments add column if not exists network           text;   -- airtel | mtn | zamtel
alter table public.payments add column if not exists provider_ref      text;   -- the gateway's own reference (Lenco: lencoReference)
alter table public.payments add column if not exists provider_status   text;   -- the gateway's own last word (pay-offline, pending...)
alter table public.payments add column if not exists failure_reason    text;
alter table public.payments add column if not exists confirmed_at      timestamptz;
alter table public.payments add column if not exists verified_at       timestamptz;
alter table public.payments add column if not exists provider_response jsonb;
alter table public.payments add column if not exists client_key        text;

create unique index if not exists payments_client_key on public.payments (client_key) where client_key is not null;
create index if not exists payments_provider_recent on public.payments (provider, created_at desc);
create index if not exists payments_order on public.payments (order_id, created_at desc);
create index if not exists payments_open on public.payments (status, created_at desc) where status in ('started', 'review');


-- 3) AN ORDER IS PAID ONCE --------------------------------------------------------------
do $once$
declare
  n integer;
begin
  select count(*) into n from (
    select order_id from public.payments
     where status = 'paid' and order_id is not null
     group by order_id having count(*) > 1) x;
  if n = 0 then
    create unique index if not exists payments_one_paid on public.payments (order_id)
      where status = 'paid' and order_id is not null;
  else
    raise notice 'payments_one_paid not added: % order(s) already have two paid payments. Look at them in Admin > Orders.', n;
  end if;
end
$once$;


-- 4) THE GATEWAYS' NOTICES ----------------------------------------------------------------
create table if not exists public.payment_webhooks (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  provider  text not null,          -- lenco
  event     text not null,          -- collection.successful, collection.failed, ...
  reference text,                   -- our payment reference (VB-XXXXX-...)
  mode      text,                   -- test | live: which key signed it
  outcome   text,                   -- what the website did: paid, failed, pending, ignored...
  note      jsonb
);
create index if not exists payment_webhooks_at  on public.payment_webhooks (at desc);
create index if not exists payment_webhooks_ref on public.payment_webhooks (reference, at);

alter table public.payment_webhooks enable row level security;
revoke all on table public.payment_webhooks from public, anon, authenticated;
grant select on table public.payment_webhooks to authenticated;
grant select, insert on table public.payment_webhooks to service_role;

create or replace function public.payment_webhooks_frozen()
returns trigger
language plpgsql
set search_path = ''
as $fz$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'the record of payment notices cannot be changed';
end
$fz$;
drop trigger if exists payment_webhooks_frozen_t on public.payment_webhooks;
create trigger payment_webhooks_frozen_t
  before update or delete on public.payment_webhooks
  for each row execute function public.payment_webhooks_frozen();


-- 5) EVERY CHANGE TO SETTINGS > PAYMENTS ---------------------------------------------------
create table if not exists public.payment_settings_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  by_id     uuid,
  by_email  text,
  which     text not null,          -- public | private
  changed   jsonb not null          -- public: { setting: [from, to] }; private: [setting, ...]
);
create index if not exists payment_settings_audit_at on public.payment_settings_audit (at desc);

alter table public.payment_settings_audit enable row level security;
revoke all on table public.payment_settings_audit from public, anon, authenticated, service_role;
grant select on table public.payment_settings_audit to authenticated;

create or replace function public.payment_settings_audit_frozen()
returns trigger
language plpgsql
set search_path = ''
as $fz$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'the record of payment settings changes cannot be changed';
end
$fz$;
drop trigger if exists payment_settings_audit_frozen_t on public.payment_settings_audit;
create trigger payment_settings_audit_frozen_t
  before update or delete on public.payment_settings_audit
  for each row execute function public.payment_settings_audit_frozen();

-- Runs as its owner, so the line is written whoever made the change, and a
-- line that cannot be written never stops the settings being saved.
create or replace function public.payment_settings_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $al$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_public  jsonb := '{}'::jsonb;
  v_private text[] := '{}';
  k         text;
  v_uid     uuid;
  v_email   text;
begin
  begin
    if new.key is distinct from 'payments' then
      return null;
    end if;
    v_old := case when tg_op = 'UPDATE' then coalesce(old.data, '{}'::jsonb) else '{}'::jsonb end;
    v_new := coalesce(new.data, '{}'::jsonb);
    for k in select jsonb_object_keys(v_old || v_new) loop
      if (v_old -> k) is distinct from (v_new -> k) then
        if tg_table_name = 'site_settings' then
          v_public := v_public || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
        else
          v_private := v_private || k;
        end if;
      end if;
    end loop;
    if v_public = '{}'::jsonb and coalesce(array_length(v_private, 1), 0) = 0 then
      return null;
    end if;
    begin
      v_uid := auth.uid();
      select u.email into v_email from auth.users u where u.id = v_uid;
    exception when others then
      v_uid := null;
    end;
    insert into public.payment_settings_audit (by_id, by_email, which, changed)
    values (v_uid, v_email,
            case when tg_table_name = 'site_settings' then 'public' else 'private' end,
            case when tg_table_name = 'site_settings' then v_public else to_jsonb(v_private) end);
  exception when others then
    null;
  end;
  return null;
end
$al$;

drop trigger if exists payment_settings_audit_t on public.site_settings;
create trigger payment_settings_audit_t
  after insert or update on public.site_settings
  for each row execute function public.payment_settings_audit_log();
drop trigger if exists payment_settings_audit_private_t on public.site_settings_private;
create trigger payment_settings_audit_private_t
  after insert or update on public.site_settings_private
  for each row execute function public.payment_settings_audit_log();


-- 6) WHO MAY READ THEM ---------------------------------------------------------------------
-- The same people as the payments themselves (orders), and for the settings
-- record those who may open Settings. Before supabase-hardening.sql there
-- are no role ticks: every administrator.
do $pol$
declare
  has_may boolean := to_regprocedure('public.may(text)') is not null;
begin
  drop policy if exists payment_webhooks_admin_read on public.payment_webhooks;
  drop policy if exists payment_settings_audit_read on public.payment_settings_audit;
  if has_may then
    create policy payment_webhooks_admin_read on public.payment_webhooks
      for select to authenticated using ((select public.may('orders')));
    create policy payment_settings_audit_read on public.payment_settings_audit
      for select to authenticated using ((select public.may('settings')));
  else
    create policy payment_webhooks_admin_read on public.payment_webhooks
      for select to authenticated using ((select public.is_admin()));
    create policy payment_settings_audit_read on public.payment_settings_audit
      for select to authenticated using ((select public.is_admin()));
  end if;
end
$pol$;


-- 7) WALKED AWAY FROM: THREE HOURS AFTER THE LATEST TRY ------------------------------------
create or replace function public.pay_expire_stale()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.payments
     set status = 'expired', updated_at = now()
   where status = 'started' and created_at < now() - interval '3 hours';
  get diagnostics n = row_count;

  -- An order is closed only when no try of it is younger than three hours.
  update public.orders o
     set payment_status = 'expired', status = 'cancelled', updated_at = now()
   where o.payment_method = 'online' and o.payment_status = 'awaiting'
     and o.created_at < now() - interval '3 hours'
     and not exists (select 1 from public.payments p
                      where p.order_id = o.id and p.status = 'started'
                        and p.created_at >= now() - interval '3 hours');
  return n;
end;
$$;
revoke all on function public.pay_expire_stale() from public, anon, authenticated;
grant execute on function public.pay_expire_stale() to service_role;


-- 8) A REFUND ONLY THROUGH THE GATEWAY THAT TOOK THE MONEY -----------------------------------
-- As supabase-online-refund.sql (website 81) made it, with one rule more:
--   no_refund_api  paid through a gateway this website cannot send a refund
--                  to (Lenco). Refund it from the gateway's own account.
create or replace function public.refund_state_of(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $rs$
declare
  o        public.orders;
  pay      public.payments;
  v_acc    numeric := 0;
  v_open   integer := 0;
  v_paid   numeric;
  v_left   numeric;
  v_why    text := null;
begin
  select * into o from public.orders where id = p_id;
  if not found then
    return null;
  end if;
  select * into pay from public.payments p
   where p.order_id = o.id and p.status = 'paid'
   order by p.updated_at desc limit 1;
  select coalesce(sum(r.amount) filter (where r.state in ('pending', 'completed')), 0),
         count(*) filter (where r.state in ('new', 'sending', 'unknown'))
    into v_acc, v_open
    from public.refunds r where r.order_id = o.id;
  v_paid := round(coalesce(o.paid_amount, pay.amount, 0), 2);
  v_left := greatest(0, round(v_paid - v_acc, 2));

  if coalesce(o.payment_method, '') <> 'online' then v_why := 'not_online';
  elsif o.payment_status = 'review' then v_why := 'review';
  elsif o.payment_status is distinct from 'paid' or pay.id is null then v_why := 'not_paid';
  elsif coalesce(pay.provider, 'flutterwave') <> 'flutterwave' then v_why := 'no_refund_api';
  elsif coalesce(btrim(pay.provider_tx_id), '') = '' then v_why := 'no_tx';
  elsif v_open > 0 then v_why := 'in_flight';
  elsif v_left <= 0.004 then v_why := 'refunded';
  elsif o.pos_sale_id is null and o.status = 'completed' then v_why := 'old_sale';
  elsif o.pos_sale_id is null and o.pos_claim_id is not null then v_why := 'being_rung_up';
  end if;

  return jsonb_build_object(
    'pay', case when pay.id is null then null else jsonb_build_object(
        'txRef', pay.tx_ref, 'flwTxId', pay.provider_tx_id, 'flwRef', pay.detail ->> 'flw_ref',
        'amount', pay.amount, 'currency', pay.currency, 'channel', pay.channel, 'mode', pay.mode,
        'test', pay.mode = 'test', 'paidAt', coalesce(o.paid_at, pay.updated_at),
        'gateway', coalesce(pay.provider, 'flutterwave')) end,
    'paid', v_paid, 'refunded', round(v_acc, 2), 'left', v_left,
    'rungUp', o.pos_sale_id is not null, 'wholeOnly', o.pos_sale_id is null,
    'canRefund', v_why is null, 'why', v_why,
    'refunds', coalesce((select jsonb_agg(public.refund_out(r) order by r.requested_at)
                           from public.refunds r where r.order_id = o.id), '[]'::jsonb));
end
$rs$;
revoke all on function public.refund_state_of(uuid) from public, anon, authenticated;


-- 9) NOBODY BUT THE DATABASE CALLS THESE ------------------------------------------------------
revoke all on function public.payment_webhooks_frozen() from public, anon, authenticated;
revoke all on function public.payment_settings_audit_frozen() from public, anon, authenticated;
revoke all on function public.payment_settings_audit_log() from public, anon, authenticated;

notify pgrst, 'reload schema';


-- 10) THE RESULT ---------------------------------------------------------------------------------
-- One row. The last box says OK · Lenco payments can be recorded when all is in.
select case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'payments'
                     and column_name in ('method', 'network', 'provider_ref', 'provider_status', 'failure_reason',
                                         'confirmed_at', 'verified_at', 'provider_response', 'client_key')) = 9
            then 'OK' else 'NOT DONE' end as payments,
       case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'payments_one_paid')
            then 'OK · an order is paid once'
            else 'NOT ADDED · ' || (select count(*) from (select order_id from public.payments
                                      where status = 'paid' and order_id is not null
                                      group by order_id having count(*) > 1) x) || ' order(s) have two paid payments'
       end as paid_once,
       case when to_regclass('public.payment_webhooks') is not null then 'OK' else 'NOT DONE' end as notices,
       case when (select count(*) from pg_trigger
                   where tgname in ('payment_settings_audit_t', 'payment_settings_audit_private_t')) = 2
            then 'OK' else 'NOT DONE' end as settings_record,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'payments'
                     and column_name in ('method', 'network', 'provider_ref', 'provider_status', 'failure_reason',
                                         'confirmed_at', 'verified_at', 'provider_response', 'client_key')) = 9
             and to_regclass('public.payment_webhooks') is not null
             and to_regclass('public.payment_settings_audit') is not null
            then 'OK · Lenco payments can be recorded' else 'NOT DONE' end as lenco;


-- =================================================================================
-- THE UNDO (only if asked; it takes the record of notices and of settings
-- changes with it, and the locks; payments and orders keep what they have)
--
--   drop trigger if exists payment_settings_audit_t on public.site_settings;
--   drop trigger if exists payment_settings_audit_private_t on public.site_settings_private;
--   drop table if exists public.payment_settings_audit;
--   drop table if exists public.payment_webhooks;
--   drop index if exists public.payments_one_paid;
--   drop index if exists public.payments_client_key;
-- The columns are left: they hold what each gateway said about each payment.
-- =================================================================================
