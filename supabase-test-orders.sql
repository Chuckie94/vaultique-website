-- =====================================================================
-- Vaultique Boutique Point: A TEST PAYMENT IS NEVER RUNG UP (website build 85)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, setting or key: it
-- replaces five of the platform's door functions with the same ones and
-- one rule more. If supabase-pos-orders.sql has never been run here (no
-- door for the platform's till), it stops at step 1 and changes nothing.
--
-- WHAT IT IS FOR
--
-- Online payment has a Test mode, for the shop to try it with
-- Flutterwave's test cards and numbers: no money moves. Until now a
-- payment made in Test mode counted as paid at the till, and the platform
-- (since its build 509) rings a paid order up by itself within two
-- minutes: a sale that never happened in the books, and the stock taken
-- off. From now on:
--
--   * only a payment made in LIVE mode counts as paid at the till: the
--     automatic ring-up leaves a Test-mode one alone, and ringing it up by
--     hand is refused ("still waiting for its online payment");
--   * a Test-mode order is kept off the till's list of orders to ring up,
--     and is never prepared or sent; a search by its number still finds
--     it, marked "test";
--   * everything else the doors do, and every live order, exactly as
--     before.
--
-- The same definitions are in supabase-pos-orders.sql (build 85), so
-- running that file again keeps this rule.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH THE TILL'S DOOR? ------------------------------------
do $guard$
begin
  if to_regclass('public.orders') is null or to_regclass('public.site_settings') is null then
    raise exception 'This is not the website''s Supabase: run this in the WEBSITE''s project, not the platform''s. Nothing was changed.';
  end if;
  if to_regclass('public.pos_door_key') is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'pos_door_key_ok') then
    raise exception 'The platform''s till has no door here yet (supabase-pos-orders.sql has not been run). Nothing was changed: there is nothing for this file to do.';
  end if;
end
$guard$;


-- 2) THE DOORS, WITH THE RULE -----------------------------------------------------
-- Exactly as supabase-pos-orders.sql (build 85) makes them.

create or replace function public.pos_paid_online(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $paid$
declare
  yes boolean := false;
begin
  if to_regclass('public.payments') is null then
    return false;
  end if;
  execute 'select exists (select 1 from public.payments p where p.order_id = $1 and p.status = ''paid''
                                                    and p.mode = ''live'')'
     into yes using p_id;
  return coalesce(yes, false);
end
$paid$;


create or replace function public.pos_test_payment(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $tst$
declare
  yes boolean := false;
begin
  if to_regclass('public.payments') is null then
    return false;
  end if;
  execute 'select exists (select 1 from public.payments p where p.order_id = $1 and p.mode = ''test'')
           and not exists (select 1 from public.payments p where p.order_id = $1 and p.mode = ''live'')'
     into yes using p_id;
  return coalesce(yes, false);
end
$tst$;


create or replace function public.pos_order_out(p_id uuid, p_items boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $out$
declare
  o      public.orders;
  v_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_names text := '';
  v_cust  text;
  v_hold  jsonb;
  v_since timestamptz;
  v_row   jsonb;
begin
  select * into o from public.orders where id = p_id;
  if not found then
    return null;
  end if;
  -- BUILD 89 · the order as JSON, so the delivery details below are read by
  -- name and the door answers the same before supabase-delivery.sql is run.
  v_row := to_jsonb(o);

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', i.sku, 'name', i.name, 'price', i.price, 'qty', coalesce(i.qty, 1))
           order by i.ctid), '[]'::jsonb),
         coalesce(sum(coalesce(i.qty, 1)), 0),
         coalesce(string_agg(coalesce(i.name, i.sku, ''), ', ' order by i.ctid), '')
    into v_items, v_count, v_names
    from public.order_items i
   where i.order_id = o.id;

  -- The account it was placed from, and its customer number, when it has one.
  if o.customer_id is not null and to_regclass('public.rewards_links') is not null then
    execute 'select l.cust_no from public.rewards_links l where l.user_id = $1'
       into v_cust using o.customer_id;
  end if;
  -- Points promised on this order, by the same account that placed it.
  if o.customer_id is not null and o.ref is not null and to_regclass('public.rewards_holds') is not null then
    execute 'select jsonb_build_object(''points'', h.points, ''value'', h.value, ''custNo'', h.cust_no, ''status'', h.status)
               from public.rewards_holds h
              where h.order_ref = $1 and h.user_id = $2'
       into v_hold using o.ref, o.customer_id;
  end if;

  -- Placed before this door existed, so before the till could know about
  -- it: it may have been rung up the old way, as an ordinary sale.
  select k.made_at into v_since from public.pos_door_key k where k.id = 1;

  return jsonb_build_object(
    'ref', o.ref,
    'createdAt', o.created_at,
    'beforeLink', coalesce(o.created_at < v_since, false),
    'status', coalesce(o.status, 'pending'),
    'name', o.name, 'phone', o.phone, 'email', o.email,
    'address', o.address, 'notes', o.notes,
    'fulfilment', coalesce(o.fulfilment, 'delivery'),
    'total', o.total, 'currency', o.currency,
    'payment', case when o.payment_method = 'online' then jsonb_build_object(
        'online', true, 'status', o.payment_status, 'channel', o.pay_channel, 'ref', o.pay_ref,
        'goods', o.goods_total, 'delivery', o.delivery_fee, 'tax', o.tax_total,
        'paid', o.paid_amount, 'paidAt', o.paid_at,
        'verified', o.payment_status = 'paid' and public.pos_paid_online(o.id),
        'test', public.pos_test_payment(o.id))
      else jsonb_build_object('online', false) end,
    'account', jsonb_build_object('has', o.customer_id is not null, 'custNo', v_cust),
    'points', v_hold,
    'till', jsonb_build_object(
        'claimId', o.pos_claim_id, 'claimedBy', o.pos_claimed_by, 'claimedAt', o.pos_claimed_at,
        'saleId', o.pos_sale_id, 'receiptNo', o.pos_receipt_no, 'invoiceNo', o.pos_invoice_no,
        'completedAt', o.pos_completed_at),
    'pieces', v_count,
    'summary', left(v_names, 160),
    'items', case when p_items then v_items else null end,
    -- BUILD 89 · delivery (supabase-delivery.sql): the customer's instructions
    -- for the courier, and the courier, tracking number and link, and the
    -- shop's short updates, once recorded.
    'delivery', jsonb_build_object(
        'instructions', v_row ->> 'delivery_instructions',
        'instructionsAt', v_row ->> 'instructions_at',
        'courier', v_row ->> 'ship_courier',
        'tracking', v_row ->> 'ship_tracking',
        'trackingUrl', v_row ->> 'ship_tracking_url',
        'updates', case when jsonb_typeof(v_row -> 'ship_updates') = 'array' then v_row -> 'ship_updates' else '[]'::jsonb end)
  );
end
$out$;


create or replace function public.vbp_pos_orders(p_key text, p_search text default null, p_scope text default 'open')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $list$
declare
  q      text := btrim(left(coalesce(p_search, ''), 60));
  qlike  text;
  digits text;
  v_out  jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', 'vbp_pos_orders', 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', 'vbp_pos_orders', 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  qlike  := '%' || replace(replace(replace(upper(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');

  select coalesce(jsonb_agg(public.pos_order_out(x.id, false) order by x.created_at desc), '[]'::jsonb)
    into v_out
    from (
      select o.id, o.created_at
        from public.orders o
       where case
               when q <> '' then
                    upper(coalesce(o.ref, '')) like qlike
                 or upper(coalesce(o.name, '')) like qlike
                 or (length(digits) >= 4
                     and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%')
               when p_scope = 'open' then
                    o.pos_sale_id is null
                and coalesce(o.status, 'pending') not in ('cancelled', 'completed')
                and not (o.payment_method = 'online' and coalesce(o.payment_status, '') in ('failed', 'expired'))
                and not (o.payment_method = 'online' and public.pos_test_payment(o.id))   -- build 85: a test is no order to ring up
               when p_scope = 'done' then
                    o.pos_sale_id is not null or coalesce(o.status, '') in ('cancelled', 'completed')
               else true
             end
       order by o.created_at desc
       limit 100
    ) x;

  return jsonb_build_object('door', 'vbp_pos_orders', 'v', 1, 'ok', true, 'orders', v_out);
end
$list$;


create or replace function public.vbp_pos_order_claim(p_key text, p_ref text, p_claim text, p_by text,
                                                     p_take_over boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $claim$
declare
  v_ref   text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_claim text := btrim(left(coalesce(p_claim, ''), 64));
  v_by    text := nullif(btrim(left(coalesce(p_by, ''), 80)), '');
  o       public.orders;
  d       text := 'vbp_pos_order_claim';
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_claim !~ '^[0-9A-Za-z-]{8,64}$' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  -- One at a time: a second till asking at the same moment waits here,
  -- then finds the first one's claim.
  select * into o from public.orders where upper(ref) = v_ref for update;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  if o.pos_sale_id is not null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'rung_up',
                              'receiptNo', o.pos_receipt_no, 'saleId', o.pos_sale_id);
  end if;
  if coalesce(o.status, 'pending') = 'cancelled' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'cancelled');
  end if;
  if coalesce(o.status, 'pending') = 'completed' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'completed');
  end if;
  if o.payment_method = 'online'
     and not (coalesce(o.payment_status, '') = 'paid' and public.pos_paid_online(o.id)) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'awaiting_payment',
                              'payment', coalesce(o.payment_status, 'awaiting'),
                              'test', public.pos_test_payment(o.id));    -- build 85: paid in Test mode, no money
  end if;
  if o.pos_claim_id is not null and o.pos_claim_id <> v_claim and not coalesce(p_take_over, false) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'claimed',
                              'claimedBy', o.pos_claimed_by, 'claimedAt', o.pos_claimed_at);
  end if;

  update public.orders
     set pos_claim_id = v_claim, pos_claimed_by = v_by, pos_claimed_at = now()
   where id = o.id;
  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'order', public.pos_order_out(o.id, true));
end
$claim$;


-- 3) WHO MAY USE THEM (as supabase-pos-orders.sql says) ---------------------------
revoke all on function public.pos_paid_online(uuid) from public, anon, authenticated;
revoke all on function public.pos_test_payment(uuid) from public, anon, authenticated;
revoke all on function public.pos_order_out(uuid, boolean) from public, anon, authenticated;
revoke all on function public.vbp_pos_orders(text, text, text) from public;
revoke all on function public.vbp_pos_order_claim(text, text, text, text, boolean) from public;
grant execute on function public.vbp_pos_orders(text, text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_claim(text, text, text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 4) CHECK ------------------------------------------------------------------------
-- One row:
--   test_payments   OK · a test payment is never rung up
--   doors           OK
select case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'pos_test_payment')
             and pg_get_functiondef('public.pos_paid_online(uuid)'::regprocedure) like '%p.mode = __live__%'
            then 'OK · a test payment is never rung up' else 'NOT DONE' end as test_payments,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('vbp_pos_orders', 'vbp_pos_order', 'vbp_pos_order_claim',
                                       'vbp_pos_order_release', 'vbp_pos_order_complete')) = 5
            then 'OK' else 'NOT DONE' end as doors;
