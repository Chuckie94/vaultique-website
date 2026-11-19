-- =====================================================================
-- Vaultique Boutique Point: ONLINE PAYMENT, ITS HISTORY (website build 77)
-- Run once in this WEBSITE's Supabase SQL Editor, after supabase-payments.sql.
-- Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes nothing already recorded. Run in the wrong
-- project, it stops at step 1 and creates nothing.
--
-- WHAT IT ADDS
--
--   * payments.asked_at: when the payment status page last asked
--     Flutterwave about a payment. With it the page asks about one payment
--     at most once every five seconds, however often a browser asks it.
--
--   * payment_events: the history of every online payment and its order,
--     written by the database itself as things happen. A payment started,
--     paid, failed, cancelled, not finished within three hours, needing
--     attention; its order sent to pay, paid, cancelled, brought back,
--     completed. Each line says when, from what, to what, and what
--     Flutterwave said.
--
--       - Nobody can change or delete a line: not a customer, not an admin
--         login, not the payment service. (Only the SQL Editor itself can,
--         for the database's own upkeep.)
--       - Administrators can read it: Admin > Orders, "Payment history" on
--         an order paid online. Nobody else can.
--       - Writing it never stands in the way of a payment or an order: if a
--         line cannot be written, the payment or the order is saved anyway.
--
-- Until this is run, website 77 works exactly as 76 did on these two
-- points: the status page asks Flutterwave every time, and there is no
-- history. Everything else in 77 works without it.
--
-- The history starts when this is run. Payments from before have no lines.
-- =====================================================================


-- 1) THE RIGHT DATABASE? ---------------------------------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.payments') is null or to_regclass('public.orders') is null then
    raise exception 'This website has no payments table yet. Run supabase-payments.sql first, in the website''s Supabase. Nothing was created.';
  end if;
end
$guard$;


-- 2) WHEN THE STATUS PAGE LAST ASKED FLUTTERWAVE -----------------------------
alter table public.payments add column if not exists asked_at timestamptz;


-- 3) THE HISTORY ----------------------------------------------------------------
create table if not exists public.payment_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  order_id   uuid,
  tx_ref     text,
  what       text not null,      -- 'payment' | 'order' | 'order-payment'
  from_state text,
  to_state   text,
  note       jsonb               -- what Flutterwave said, or the amount
);
create index if not exists payment_events_order on public.payment_events (order_id, at);
create index if not exists payment_events_tx    on public.payment_events (tx_ref, at);

-- Read by administrators only; written only by the two recorders below.
alter table public.payment_events enable row level security;
revoke all on table public.payment_events from public, anon, authenticated, service_role;
grant select on table public.payment_events to authenticated;
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events
  for select to authenticated using (public.is_admin());

-- Nobody changes or deletes a line.
create or replace function public.payment_events_frozen()
returns trigger
language plpgsql
set search_path = ''
as $fz$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'the payment history cannot be changed';
end
$fz$;

drop trigger if exists payment_events_frozen_t on public.payment_events;
create trigger payment_events_frozen_t
  before update or delete on public.payment_events
  for each row execute function public.payment_events_frozen();


-- 4) THE TWO RECORDERS ------------------------------------------------------------
-- They run as their owner, so a line is written whoever made the change (the
-- payment service, the tidy-up, an admin changing an order's status), and
-- any failure to write one is swallowed: the history never stops a payment
-- or an order being saved.

-- A payment: started, and every change of its status.
create or replace function public.payment_events_log_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lp$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.payment_events (order_id, tx_ref, what, from_state, to_state, note)
      values (new.order_id, new.tx_ref, 'payment', null, new.status,
              jsonb_build_object('amount', new.amount, 'currency', new.currency, 'mode', new.mode));
    elsif new.status is distinct from old.status then
      insert into public.payment_events (order_id, tx_ref, what, from_state, to_state, note)
      values (new.order_id, new.tx_ref, 'payment', old.status, new.status, new.detail);
    end if;
  exception when others then
    null;
  end;
  return null;
end
$lp$;

drop trigger if exists payment_events_payment_t on public.payments;
create trigger payment_events_payment_t
  after insert or update on public.payments
  for each row execute function public.payment_events_log_payment();

-- An order paid online: every change of its payment status and its status.
-- WhatsApp orders are not recorded here.
create or replace function public.payment_events_log_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lo$
begin
  begin
    if coalesce(new.payment_method, old.payment_method) = 'online' then
      if new.payment_status is distinct from old.payment_status then
        insert into public.payment_events (order_id, tx_ref, what, from_state, to_state, note)
        values (new.id, new.pay_ref, 'order-payment', old.payment_status, new.payment_status,
                case when new.payment_status = 'paid'
                     then jsonb_build_object('paid', new.paid_amount, 'channel', new.pay_channel)
                     else null end);
      end if;
      if new.status is distinct from old.status then
        insert into public.payment_events (order_id, tx_ref, what, from_state, to_state, note)
        values (new.id, new.pay_ref, 'order', old.status, new.status, null);
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end
$lo$;

drop trigger if exists payment_events_order_t on public.orders;
create trigger payment_events_order_t
  after update on public.orders
  for each row execute function public.payment_events_log_order();

revoke all on function public.payment_events_frozen() from public, anon, authenticated;
revoke all on function public.payment_events_log_payment() from public, anon, authenticated;
revoke all on function public.payment_events_log_order() from public, anon, authenticated;

notify pgrst, 'reload schema';


-- 5) CHECK -------------------------------------------------------------------------
-- One row, each box OK.
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'payments'
                            and column_name = 'asked_at')
            then 'OK' else 'NOT DONE' end as asked_at,
       case when to_regclass('public.payment_events') is not null
            then 'OK' else 'NOT DONE' end as history,
       case when (select count(*) from pg_trigger
                   where tgname in ('payment_events_payment_t', 'payment_events_order_t',
                                    'payment_events_frozen_t')) = 3
            then 'OK' else 'NOT DONE' end as recorders;


-- =================================================================================
-- THE UNDO
--
-- Takes the recorders and the history away (the history's lines go with it),
-- and the status page goes back to asking Flutterwave every time. Payments and
-- orders are not touched.
--
--   drop trigger if exists payment_events_payment_t on public.payments;
--   drop trigger if exists payment_events_order_t on public.orders;
--   drop table if exists public.payment_events;
--   alter table public.payments drop column if exists asked_at;
-- =================================================================================
