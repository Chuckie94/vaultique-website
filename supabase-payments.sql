-- =====================================================================
-- Vaultique Boutique Point: ONLINE PAYMENT (card and mobile money)
-- Run once in this website's Supabase SQL Editor. Safe to run again.
--
-- WhatsApp checkout is untouched by everything below. An order sent on
-- WhatsApp has these new columns empty and behaves exactly as before.
--
-- WHO MAY SAY AN ORDER IS PAID: only the payment functions on Netlify,
-- which use the service key and have checked with Flutterwave first.
-- Not a customer, not the anon key, and not an admin login either: a
-- "paid" badge that anybody signed in could set would mean nothing. The
-- guard at the bottom of this file enforces that in the database itself.
-- =====================================================================

-- 1) What an order paid online carries ------------------------------------
alter table public.orders add column if not exists payment_method text;   -- 'online' | null (WhatsApp)
alter table public.orders add column if not exists payment_status text;   -- awaiting | paid | failed | expired
alter table public.orders add column if not exists pay_ref        text;   -- our reference sent to Flutterwave
alter table public.orders add column if not exists pay_channel    text;   -- card | mobilemoneyzambia | ...
alter table public.orders add column if not exists goods_total    numeric;
alter table public.orders add column if not exists delivery_fee   numeric;
alter table public.orders add column if not exists tax_total      numeric;
alter table public.orders add column if not exists paid_amount    numeric;
alter table public.orders add column if not exists paid_at        timestamptz;
create unique index if not exists orders_pay_ref on public.orders (pay_ref) where pay_ref is not null;


-- 2) Every payment attempt -------------------------------------------------
-- One row per trip to Flutterwave. Read by the admin; written only by the
-- payment functions (there is deliberately no insert or update policy).
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references public.orders(id) on delete set null,
  tx_ref          text unique not null,
  provider        text not null default 'flutterwave',
  mode            text not null default 'test',          -- test | live
  status          text not null default 'started',       -- started | paid | failed | expired
  amount          numeric not null check (amount > 0),
  currency        text not null,
  phone           text,
  provider_tx_id  text,
  channel         text,
  detail          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists payments_recent on public.payments (created_at desc);
create index if not exists payments_phone  on public.payments (phone, created_at desc);

alter table public.payments enable row level security;
drop policy if exists pay_admin_read on public.payments;
create policy pay_admin_read on public.payments for select using (public.is_admin());


-- 3) Only the payment service may touch the payment columns ---------------
-- Runs as whoever made the change. The service key arrives as the role
-- service_role; place_order and the other functions in this schema run as
-- their owner, and never set these columns.
create or replace function public.orders_payment_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.payment_method is not null or new.payment_status is not null
       or new.pay_ref is not null or new.pay_channel is not null
       or new.paid_amount is not null or new.paid_at is not null
       or new.goods_total is not null or new.delivery_fee is not null
       or new.tax_total is not null then
      raise exception 'payment details are set by the payment service only';
    end if;
  else
    if new.payment_method is distinct from old.payment_method
       or new.payment_status is distinct from old.payment_status
       or new.pay_ref       is distinct from old.pay_ref
       or new.pay_channel   is distinct from old.pay_channel
       or new.paid_amount   is distinct from old.paid_amount
       or new.paid_at       is distinct from old.paid_at
       or new.goods_total   is distinct from old.goods_total
       or new.delivery_fee  is distinct from old.delivery_fee
       or new.tax_total     is distinct from old.tax_total then
      raise exception 'payment details are set by the payment service only';
    end if;
    -- The total of an order paid online is what was paid for.
    if old.payment_method = 'online' and new.total is distinct from old.total then
      raise exception 'the total of an order paid online cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_payment_guard_t on public.orders;
create trigger orders_payment_guard_t
  before insert or update on public.orders
  for each row execute function public.orders_payment_guard();


-- 4) Payments nobody finished ----------------------------------------------
-- Somebody opened the payment page and walked away. After three hours the
-- attempt is marked expired and its order cancelled, so it stops counting
-- as an order anywhere. Called by the payment functions as they work.
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

  update public.orders o
     set payment_status = 'expired', status = 'cancelled', updated_at = now()
   where o.payment_method = 'online' and o.payment_status = 'awaiting'
     and o.created_at < now() - interval '3 hours';
  return n;
end;
$$;
revoke all on function public.pay_expire_stale() from public, anon, authenticated;
grant execute on function public.pay_expire_stale() to service_role;



-- 5) How orders were paid, for the Analytics tab ---------------------------
-- The same date range and time zone as site_stats (supabase-analytics.sql),
-- and the same rule that a cancelled order is not a sale. One more rule:
-- an order sent to pay online is a sale only once it is PAID. One still
-- awaiting payment, or never finished, is counted apart, not as a sale.
-- Administrators only.
create or replace function public.pay_sales_split(p_from date, p_to date, p_tz text default 'UTC')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_out   json;
begin
  if not public.is_admin() then
    raise exception 'administrators only';
  end if;
  v_start := (p_from::timestamp) at time zone coalesce(nullif(p_tz, ''), 'UTC');
  v_end   := ((p_to + 1)::timestamp) at time zone coalesce(nullif(p_tz, ''), 'UTC');

  select json_build_object(
    'whatsapp_orders', count(*) filter (where o.payment_method is distinct from 'online'
                                          and coalesce(o.status, '') <> 'cancelled'),
    'whatsapp_sales',  coalesce(sum(o.total) filter (where o.payment_method is distinct from 'online'
                                          and coalesce(o.status, '') <> 'cancelled'), 0),
    'online_orders',   count(*) filter (where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled'),
    'online_sales',    coalesce(sum(coalesce(o.paid_amount, o.total)) filter (
                                          where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled'), 0),
    'card_orders',     count(*) filter (where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled' and o.pay_channel = 'card'),
    'card_sales',      coalesce(sum(coalesce(o.paid_amount, o.total)) filter (
                                          where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled' and o.pay_channel = 'card'), 0),
    'mobile_orders',   count(*) filter (where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled'
                                          and coalesce(o.pay_channel, '') <> 'card'),
    'mobile_sales',    coalesce(sum(coalesce(o.paid_amount, o.total)) filter (
                                          where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled'
                                          and coalesce(o.pay_channel, '') <> 'card'), 0),
    'delivery_paid',   coalesce(sum(o.delivery_fee) filter (
                                          where o.payment_method = 'online' and o.payment_status = 'paid'
                                          and coalesce(o.status, '') <> 'cancelled'), 0),
    'online_waiting',  count(*) filter (where o.payment_method = 'online' and o.payment_status = 'awaiting'),
    'online_unfinished', count(*) filter (where o.payment_method = 'online'
                                            and o.payment_status in ('failed', 'expired')),
    'currency',        max(o.currency)
  )
    into v_out
    from public.orders o
   where o.created_at >= v_start and o.created_at < v_end;
  return v_out;
end;
$$;
revoke all on function public.pay_sales_split(date, date, text) from public, anon;
grant execute on function public.pay_sales_split(date, date, text) to authenticated;

-- Checking: select count(*) from public.payments;   -- 0 on a new shop
