-- =====================================================================
-- Vaultique Boutique Point: DELIVERY (website build 89, platform build 512)
-- Run once in this WEBSITE's Supabase SQL Editor, after
-- supabase-order-progress.sql (website 78). Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, setting or key. Run in
-- the wrong project, or before the files it stands on, it stops at step 1
-- and creates nothing.
--
-- WHAT IT IS FOR
--
--   Delivery instructions   the customer's own words for the courier (a
--                           landmark, the gate, the best time to come),
--                           given at checkout, either way, and changed on
--                           their order in their account until it is on
--                           its way. The shop is emailed when they change.
--   The courier and the     recorded when the order is sent: by the
--   tracking number         business platform's Online Orders (platform
--                           build 512), through a door behind the same key
--                           as the till's; or, until then and whenever it
--                           suits, by an administrator in Admin > Orders.
--                           With the courier's tracking link, if it has one,
--                           and short updates ("left Lusaka this morning").
--                           The customer sees them on their order, behind
--                           the private link, and in their emails.
--   The invoice             nothing new here: the invoice number and the
--                           receipt the till already writes (website 76)
--                           are what the customer's invoice is made from.
--
-- WHAT IT CHANGES
--
--   * orders: nine new columns (none of them touches an order already
--     recorded): delivery_instructions, instructions_at,
--     instructions_told_at, ship_courier, ship_tracking, ship_tracking_url,
--     ship_updates, ship_set_at, ship_mailed_at.
--   * Only the website's own server (at checkout, and its 15-minute
--     check), the customer's own button (their order, before it is on its
--     way), the platform's door and an administrator with the orders
--     permission may write them. Not the public key; not an admin's login
--     writing the table directly.
--   * What the platform's door hands out about an order (pos_order_out)
--     now carries the instructions and the courier; what the private link
--     and the platform see of an order's progress (order_progress_out), the
--     courier and tracking only, never the instructions. The same change is
--     in supabase-pos-orders.sql, supabase-test-orders.sql and
--     supabase-order-progress.sql, so running any of those again keeps it.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH WHAT THIS STANDS ON? ----------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.order_items') is null then
    raise exception 'This is not the website''s database: there is no orders table here. Nothing was created.';
  end if;
  if to_regprocedure('public.pos_door_key_ok(text)') is null or to_regprocedure('public.pos_order_out(uuid,boolean)') is null then
    raise exception 'The platform''s door is not here yet. Run supabase-pos-orders.sql first (website 76). Nothing was created.';
  end if;
  if to_regprocedure('public.order_progress_out(uuid)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'orders' and column_name = 'dispatched_at') then
    raise exception 'An order''s progress is not here yet. Run supabase-order-progress.sql first (website 78). Nothing was created.';
  end if;
end
$guard$;


-- 2) WHAT AN ORDER CARRIES NOW ---------------------------------------------------
alter table public.orders add column if not exists delivery_instructions text;         -- the customer's, for the courier
alter table public.orders add column if not exists instructions_at      timestamptz;   -- when they were last given or changed
alter table public.orders add column if not exists instructions_told_at timestamptz;   -- when the shop was last told of them
alter table public.orders add column if not exists ship_courier         text;          -- who is taking it
alter table public.orders add column if not exists ship_tracking        text;          -- the courier's tracking number
alter table public.orders add column if not exists ship_tracking_url    text;          -- the courier's own tracking page (https only)
alter table public.orders add column if not exists ship_updates         jsonb;         -- [{ at, text }], the newest last, at most 20
alter table public.orders add column if not exists ship_set_at          timestamptz;   -- when the courier or tracking last changed
alter table public.orders add column if not exists ship_mailed_at       timestamptz;   -- when the customer was last emailed them

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_instructions_short') then
    alter table public.orders add constraint orders_instructions_short
      check (delivery_instructions is null or char_length(delivery_instructions) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_ship_short') then
    alter table public.orders add constraint orders_ship_short
      check ((ship_courier is null or char_length(ship_courier) <= 60)
         and (ship_tracking is null or char_length(ship_tracking) <= 60));
  end if;
  -- A link the customer will press: only a courier's own https page.
  if not exists (select 1 from pg_constraint where conname = 'orders_ship_link_https') then
    alter table public.orders add constraint orders_ship_link_https
      check (ship_tracking_url is null
             or (char_length(ship_tracking_url) <= 300
                 and ship_tracking_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"''`\\]*)?$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_ship_updates_list') then
    alter table public.orders add constraint orders_ship_updates_list
      check (ship_updates is null or (jsonb_typeof(ship_updates) = 'array' and jsonb_array_length(ship_updates) <= 20));
  end if;
end
$c$;


-- 3) ONLY THE WEBSITE, THE CUSTOMER'S BUTTON, THE DOOR AND THE ADMIN'S FUNCTION ---
-- Runs as whoever made the change. The functions below run as their owner,
-- and the website's server uses the service key; everybody else is refused,
-- an administrator writing the table directly included (Admin > Orders uses
-- order_shipping_admin, below).
create or replace function public.orders_delivery_guard()
returns trigger
language plpgsql
set search_path = ''
as $dg$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if num_nonnulls(new.delivery_instructions, new.instructions_at, new.instructions_told_at, new.ship_courier,
                    new.ship_tracking, new.ship_tracking_url, new.ship_updates, new.ship_set_at,
                    new.ship_mailed_at) > 0 then
      raise exception 'an order''s delivery details are set by the website and the platform only';
    end if;
  elsif (new.delivery_instructions, new.instructions_at, new.instructions_told_at, new.ship_courier,
         new.ship_tracking, new.ship_tracking_url, new.ship_updates, new.ship_set_at, new.ship_mailed_at)
        is distinct from
        (old.delivery_instructions, old.instructions_at, old.instructions_told_at, old.ship_courier,
         old.ship_tracking, old.ship_tracking_url, old.ship_updates, old.ship_set_at, old.ship_mailed_at) then
    raise exception 'an order''s delivery details are set by the website and the platform only';
  end if;
  return new;
end
$dg$;

drop trigger if exists orders_delivery_guard_t on public.orders;
create trigger orders_delivery_guard_t
  before insert or update on public.orders
  for each row execute function public.orders_delivery_guard();


-- 4) ONE SMALL PART ---------------------------------------------------------------
-- Words as they are kept: one line (line breaks, tabs and runs of spaces
-- made one space, no control characters), trimmed, at most n letters, or
-- nothing.
create or replace function public.delivery_text(p text, n integer)
returns text
language sql
immutable
set search_path = ''
as $dt$
  select nullif(btrim(left(btrim(regexp_replace(coalesce(p, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), n)), '')
$dt$;


-- 5) THE CUSTOMER'S INSTRUCTIONS, ON THEIR OWN ORDER ------------------------------
-- A signed-in customer, on their own order for delivery, until it is on its
-- way: after that the courier has it, and the shop is the one to talk to.
-- Empty clears them. The shop is told by the 15-minute check.
create or replace function public.order_set_instructions(p_id uuid, p_text text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $si$
declare
  o      public.orders;
  v_raw  text := btrim(regexp_replace(coalesce(p_text, ''), '[[:space:][:cntrl:]]+', ' ', 'g'));
  v_text text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  if char_length(btrim(v_raw)) > 300 then
    return jsonb_build_object('ok', false, 'why', 'too_long');
  end if;
  v_text := public.delivery_text(v_raw, 300);
  -- Twenty an hour for each customer (supabase-hardening.sql's counter).
  if to_regprocedure('public.throttle(text,text,integer,interval)') is not null then
    begin
      execute 'select public.throttle($1, $2, 20, interval ''1 hour'')' using 'order_instructions', auth.uid()::text;
    exception when others then
      return jsonb_build_object('ok', false, 'why', 'busy');
    end;
  end if;

  select * into o from public.orders where id = p_id and customer_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  if coalesce(o.fulfilment, 'delivery') <> 'delivery' then
    return jsonb_build_object('ok', false, 'why', 'collection');
  end if;
  if coalesce(o.status, 'pending') = 'cancelled' then
    return jsonb_build_object('ok', false, 'why', 'cancelled');
  end if;
  if coalesce(o.status, 'pending') not in ('pending', 'confirmed') or o.dispatched_at is not null then
    return jsonb_build_object('ok', false, 'why', 'on_its_way');
  end if;
  if v_text is not distinct from o.delivery_instructions then
    return jsonb_build_object('ok', true, 'again', true, 'instructions', o.delivery_instructions, 'at', o.instructions_at);
  end if;
  update public.orders
     set delivery_instructions = v_text, instructions_at = now(), updated_at = now()
   where id = o.id;
  return jsonb_build_object('ok', true, 'again', false, 'instructions', v_text, 'at', now());
end
$si$;


-- 6) THE COURIER AND THE TRACKING NUMBER ---------------------------------------------
-- One way in for both who may record them, the platform's door and an
-- administrator. p_courier, p_tracking, p_url: nothing leaves it as it is,
-- '' clears it. p_update: a short line added to the order's updates (the
-- newest 20 kept). Only an order for delivery that the shop has confirmed,
-- is sending or has delivered; never one cancelled, collected, or handed
-- over at the counter.
create or replace function public.order_ship_set(p_id uuid, p_courier text, p_tracking text, p_url text, p_update text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $ss$
declare
  o       public.orders;
  v_cour  text;
  v_track text;
  v_url   text;
  v_upd   text := public.delivery_text(p_update, 200);
  v_list  jsonb;
  v_ship  boolean;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  if coalesce(o.fulfilment, 'delivery') <> 'delivery' then
    return jsonb_build_object('ok', false, 'why', 'not_delivery');
  end if;
  if coalesce(o.status, 'pending') = 'cancelled' then
    return jsonb_build_object('ok', false, 'why', 'cancelled');
  end if;
  if coalesce(o.status, 'pending') = 'completed' then
    return jsonb_build_object('ok', false, 'why', 'handed_over');
  end if;
  if coalesce(o.status, 'pending') not in ('confirmed', 'dispatched', 'delivered') then
    return jsonb_build_object('ok', false, 'why', 'not_confirmed');
  end if;

  v_cour  := case when p_courier is null then o.ship_courier else public.delivery_text(p_courier, 60) end;
  v_track := case when p_tracking is null then o.ship_tracking else public.delivery_text(p_tracking, 60) end;
  v_url   := case when p_url is null then o.ship_tracking_url else public.delivery_text(p_url, 300) end;
  if (p_courier is not null and char_length(btrim(p_courier)) > 60)
     or (p_tracking is not null and char_length(btrim(p_tracking)) > 60)
     or (p_update is not null and char_length(btrim(p_update)) > 200) then
    return jsonb_build_object('ok', false, 'why', 'too_long');
  end if;
  if v_track is not null and v_track !~ '^[A-Za-z0-9][A-Za-z0-9 ./#_-]*$' then
    return jsonb_build_object('ok', false, 'why', 'bad_tracking');
  end if;
  if v_url is not null and (char_length(v_url) > 300
     or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"''`\\]*)?$') then
    return jsonb_build_object('ok', false, 'why', 'bad_link');
  end if;

  v_ship := (v_cour, v_track, v_url) is distinct from (o.ship_courier, o.ship_tracking, o.ship_tracking_url);
  if not v_ship and v_upd is null then
    return jsonb_build_object('ok', true, 'again', true, 'delivery', public.pos_order_out(o.id, false) -> 'delivery');
  end if;
  v_list := case when jsonb_typeof(o.ship_updates) = 'array' then o.ship_updates else '[]'::jsonb end;
  if v_upd is not null then
    v_list := v_list || jsonb_build_array(jsonb_build_object('at', now(), 'text', v_upd));
    if jsonb_array_length(v_list) > 20 then
      select coalesce(jsonb_agg(e.value order by e.i), '[]'::jsonb) into v_list
        from jsonb_array_elements(v_list) with ordinality e(value, i)
       where e.i > jsonb_array_length(v_list) - 20;
    end if;
  end if;
  update public.orders
     set ship_courier = v_cour, ship_tracking = v_track, ship_tracking_url = v_url,
         ship_updates = case when jsonb_array_length(v_list) = 0 then null else v_list end,
         ship_set_at = case when v_ship then now() else ship_set_at end,
         updated_at = now()
   where id = o.id;
  return jsonb_build_object('ok', true, 'again', false, 'delivery', public.pos_order_out(o.id, false) -> 'delivery');
end
$ss$;

-- The platform's door (platform build 512), behind the till's key. Only an
-- order the till has rung up, as with the rest of the progress.
create or replace function public.vbp_pos_order_shipping(p_key text, p_ref text, p_courier text default null,
                                                        p_tracking text default null, p_url text default null,
                                                        p_update text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $ps$
declare
  d     text := 'vbp_pos_order_shipping';
  v_ref text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  o     public.orders;
  r     jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  select * into o from public.orders where upper(ref) = v_ref;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  if o.pos_sale_id is null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_rung_up');
  end if;
  r := public.order_ship_set(o.id, p_courier, p_tracking, p_url, p_update);
  return jsonb_build_object('door', d, 'v', 1) || r
         || case when coalesce((r ->> 'ok')::boolean, false)
                 then jsonb_build_object('order', public.pos_order_out(o.id, false)
                                                  || jsonb_build_object('progress', public.order_progress_out(o.id)))
                 else '{}'::jsonb end;
end
$ps$;

-- Admin > Orders, for an administrator with the orders permission (and,
-- since build 76, their second step at sign-in).
create or replace function public.order_shipping_admin(p_id uuid, p_courier text default null, p_tracking text default null,
                                                      p_url text default null, p_update text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $sa$
declare
  v_ok boolean := false;
begin
  if to_regprocedure('public.may(text)') is not null then
    execute 'select public.may(''orders'')' into v_ok;
  else
    v_ok := public.is_admin();
  end if;
  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  return public.order_ship_set(p_id, p_courier, p_tracking, p_url, p_update);
end
$sa$;


-- 7) WHAT THE PLATFORM AND THE PRIVATE LINK SEE ----------------------------------------
-- From supabase-pos-orders.sql (website 76) and supabase-order-progress.sql
-- (website 78), with the delivery details added (the same in those files).


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

create or replace function public.order_progress_out(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $po$
declare
  o     public.orders;
  v_row jsonb;
begin
  select * into o from public.orders where id = p_id;
  if not found then
    return null;
  end if;
  -- BUILD 89 · read by name (supabase-delivery.sql may not be run yet).
  v_row := to_jsonb(o);
  return jsonb_build_object(
    'ref', o.ref,
    'status', coalesce(o.status, 'pending'),
    'fulfilment', coalesce(o.fulfilment, 'delivery'),
    'rungUp', o.pos_sale_id is not null,
    'paidAt', coalesce(o.paid_at, o.pos_completed_at),
    'preparingAt', o.pos_completed_at,
    'dispatchedAt', o.dispatched_at,
    'readyAt', o.ready_at,
    'deliveredAt', o.delivered_at,
    'deliveredBy', o.delivered_by,
    'note', o.ship_note,
    'autoAt', o.auto_deliver_at,
    'remindDays', o.remind_days,
    'remindedAt', o.reminded_at,
    'extend', public.order_extend_window(o),
    'refund', case when o.refund_state is null then null else jsonb_build_object(
        'state', o.refund_state, 'amount', o.refund_amount, 'ref', o.refund_ref,
        'note', o.refund_note, 'at', o.refund_at) end,
    -- BUILD 89 · the courier, the tracking number and its link, and the
    -- shop's short updates (supabase-delivery.sql). Never the customer's
    -- delivery instructions: the private link shows no address either.
    'ship', case when coalesce(v_row ->> 'ship_courier', v_row ->> 'ship_tracking', v_row ->> 'ship_tracking_url') is null
                  and coalesce(jsonb_array_length(case when jsonb_typeof(v_row -> 'ship_updates') = 'array'
                                                       then v_row -> 'ship_updates' end), 0) = 0
             then null
             else jsonb_build_object(
               'courier', v_row ->> 'ship_courier',
               'tracking', v_row ->> 'ship_tracking',
               'url', v_row ->> 'ship_tracking_url',
               'updates', case when jsonb_typeof(v_row -> 'ship_updates') = 'array'
                               then v_row -> 'ship_updates' else '[]'::jsonb end) end
  );
end
$po$;


-- 8) WHO MAY USE THEM ---------------------------------------------------------------
-- The customer's needs a signed-in customer, on their own order; the
-- platform's needs the door's key; the admin's needs the orders
-- permission. The rest are parts, called from inside.
revoke all on function public.delivery_text(text, integer) from public, anon, authenticated;
revoke all on function public.orders_delivery_guard() from public, anon, authenticated;
revoke all on function public.order_ship_set(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.pos_order_out(uuid, boolean) from public, anon, authenticated;
revoke all on function public.order_progress_out(uuid) from public, anon, authenticated;
revoke all on function public.order_set_instructions(uuid, text) from public, anon;
revoke all on function public.order_shipping_admin(uuid, text, text, text, text) from public, anon;
revoke all on function public.vbp_pos_order_shipping(text, text, text, text, text, text) from public;
grant execute on function public.order_set_instructions(uuid, text) to authenticated;
grant execute on function public.order_shipping_admin(uuid, text, text, text, text) to authenticated;
grant execute on function public.vbp_pos_order_shipping(text, text, text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 9) CHECK -------------------------------------------------------------------------
-- One row:
--   delivery   OK · delivery details can be recorded
--   doors      OK
select case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'orders'
                     and column_name in ('delivery_instructions', 'instructions_at', 'instructions_told_at',
                                         'ship_courier', 'ship_tracking', 'ship_tracking_url', 'ship_updates',
                                         'ship_set_at', 'ship_mailed_at')) = 9
             and exists (select 1 from pg_trigger where tgname = 'orders_delivery_guard_t')
            then 'OK · delivery details can be recorded' else 'NOT DONE' end as delivery,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('order_set_instructions', 'vbp_pos_order_shipping', 'order_shipping_admin')) = 3
            then 'OK' else 'NOT DONE' end as doors;


-- =================================================================================
-- THE UNDO
--
-- Takes the new doors and buttons away. Orders keep what they recorded; the
-- website then shows no instructions, courier or tracking number, and the
-- checkout's instructions go in the WhatsApp message only.
--
--   drop function if exists public.order_set_instructions(uuid, text);
--   drop function if exists public.order_shipping_admin(uuid, text, text, text, text);
--   drop function if exists public.vbp_pos_order_shipping(text, text, text, text, text, text);
--   drop function if exists public.order_ship_set(uuid, text, text, text, text);
--   drop trigger if exists orders_delivery_guard_t on public.orders;
-- =================================================================================
