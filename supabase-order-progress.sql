-- =====================================================================
-- Vaultique Boutique Point: AN ORDER'S PROGRESS, FROM THE TILL TO THE
-- CUSTOMER'S DOOR (website build 78, platform build 509)
-- Run once in this WEBSITE's Supabase SQL Editor, after
-- supabase-pos-orders.sql. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. In the wrong database it stops at step 1 and creates
-- nothing.
--
-- WHAT IT IS FOR
--
-- Once the platform's till has rung an order up, the goods may still have
-- to go. The order then says Preparing, and the shop moves it on from the
-- platform's Online Orders:
--
--   On its way              (delivery) with the shop's note, the courier
--                           for example. The customer is emailed, with a
--                           private link to the order.
--   Ready for collection    (collection) with the shop's note.
--   Delivered / Collected   by the shop, or by the customer pressing
--                           Confirm delivery, or by this website once the
--                           days run out (delivery only: collection
--                           orders are never marked delivered by
--                           themselves).
--   Give more time          the shop moves the date on.
--
-- While an order is on its way the customer has two buttons, on their
-- account page or behind the private link: Confirm delivery, and Ask for
-- more time (so many days, so many times, as the shop set). A reminder goes
-- a set number of days before the date. A refund the platform records
-- (build 510) is shown on the order too.
--
-- WHAT IT CHANGES
--
--   * orders: twenty columns for the progress (none of them touches an
--     order already recorded: running this changes no order's status).
--   * Only the platform's door, the customer's two buttons and the
--     website's own 15-minute check may write them. Not an admin login,
--     not the public key, not a customer on anybody else's order.
--   * Three doors for the platform, behind the same key as the till's
--     (vbp_pos_progress, vbp_pos_order_progress, vbp_pos_order_refund),
--     and three for the customer (order_confirm_delivery,
--     order_extend_delivery, order_progress_link).
--
-- ALSO CHANGED: the door's "sale is done" (vbp_pos_order_complete). Once rung
-- up, an order whose goods are still to be sent or collected says Preparing
-- (status confirmed), not Completed; one the customer took at the counter
-- says Completed, as before. A platform from before build 509 does not say
-- which, and its sales say Completed exactly as they did. The same change is
-- in supabase-pos-orders.sql, so running that file again keeps it.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH THE TILL'S DOOR ALREADY IN IT? ------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.order_items') is null then
    raise exception 'This is not the website''s database: there is no orders table here. Nothing was created.';
  end if;
  if to_regclass('public.pos_door_key') is null or to_regprocedure('public.pos_door_key_ok(text)') is null
     or to_regprocedure('public.pos_order_out(uuid, boolean)') is null then
    raise exception 'Run supabase-pos-orders.sql first, in this database (website 76). Nothing was created.';
  end if;
end
$guard$;


-- 2) WHAT AN ORDER CARRIES NOW ---------------------------------------------------
alter table public.orders add column if not exists ship_note           text;          -- the shop's note: courier, collection time
alter table public.orders add column if not exists dispatched_at       timestamptz;   -- on its way
alter table public.orders add column if not exists ready_at            timestamptz;   -- ready for collection
alter table public.orders add column if not exists delivered_at        timestamptz;   -- delivered, or collected
alter table public.orders add column if not exists delivered_by        text;          -- customer | shop | auto
alter table public.orders add column if not exists auto_deliver_at     timestamptz;   -- marked delivered then, unless confirmed first
alter table public.orders add column if not exists extend_days         integer;       -- days added when more time is asked
alter table public.orders add column if not exists extend_max          integer;       -- times the customer may ask
alter table public.orders add column if not exists extend_used         integer;       -- times asked
alter table public.orders add column if not exists remind_days         integer;       -- the reminder, so many days before
alter table public.orders add column if not exists reminded_at         timestamptz;
alter table public.orders add column if not exists progress_token      text;          -- the customer's private link
alter table public.orders add column if not exists dispatch_mailed_at  timestamptz;
alter table public.orders add column if not exists delivered_mailed_at timestamptz;
alter table public.orders add column if not exists refund_state        text;          -- full | part (build 510)
alter table public.orders add column if not exists refund_amount       numeric;
alter table public.orders add column if not exists refund_ref          text;
alter table public.orders add column if not exists refund_note         text;
alter table public.orders add column if not exists refund_at           timestamptz;
alter table public.orders add column if not exists refund_mailed_at    timestamptz;
create unique index if not exists orders_progress_token on public.orders (progress_token) where progress_token is not null;
create index if not exists or_progress_due on public.orders (auto_deliver_at) where status = 'dispatched';


-- 3) ONLY THE DOOR, THE CUSTOMER'S BUTTONS AND THE CHECK WRITE THE PROGRESS -------
-- Runs as whoever made the change. The functions below run as their owner,
-- and the 15-minute check uses the service key; everybody else is refused.
create or replace function public.orders_progress_guard()
returns trigger
language plpgsql
set search_path = ''
as $pg$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if num_nonnulls(new.ship_note, new.dispatched_at, new.ready_at, new.delivered_at, new.delivered_by,
                    new.auto_deliver_at, new.extend_days, new.extend_max, new.extend_used, new.remind_days,
                    new.reminded_at, new.progress_token, new.dispatch_mailed_at, new.delivered_mailed_at,
                    new.refund_state, new.refund_amount, new.refund_ref, new.refund_note, new.refund_at,
                    new.refund_mailed_at) > 0 then
      raise exception 'the order''s progress is set by the platform only';
    end if;
  elsif (new.ship_note, new.dispatched_at, new.ready_at, new.delivered_at, new.delivered_by,
         new.auto_deliver_at, new.extend_days, new.extend_max, new.extend_used, new.remind_days,
         new.reminded_at, new.progress_token, new.dispatch_mailed_at, new.delivered_mailed_at,
         new.refund_state, new.refund_amount, new.refund_ref, new.refund_note, new.refund_at,
         new.refund_mailed_at)
        is distinct from
        (old.ship_note, old.dispatched_at, old.ready_at, old.delivered_at, old.delivered_by,
         old.auto_deliver_at, old.extend_days, old.extend_max, old.extend_used, old.remind_days,
         old.reminded_at, old.progress_token, old.dispatch_mailed_at, old.delivered_mailed_at,
         old.refund_state, old.refund_amount, old.refund_ref, old.refund_note, old.refund_at,
         old.refund_mailed_at) then
    raise exception 'the order''s progress is set by the platform only';
  end if;
  return new;
end;
$pg$;

drop trigger if exists orders_progress_guard_t on public.orders;
create trigger orders_progress_guard_t
  before insert or update on public.orders
  for each row execute function public.orders_progress_guard();


-- 4) TWO SMALL PARTS --------------------------------------------------------------
-- A whole number from the platform's rules, or nothing.
create or replace function public.pos_int(p jsonb)
returns integer
language sql
immutable
set search_path = ''
as $int$
  select case
    when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,6}$' then (p #>> '{}')::integer
    when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^-?[0-9]{1,6}$' then btrim(p #>> '{}')::integer
    else null end
$int$;

-- Whether the customer may still ask for more time, and how much.
create or replace function public.order_extend_window(o public.orders)
returns jsonb
language sql
stable
set search_path = ''
as $win$
  select jsonb_build_object(
    'days', coalesce(o.extend_days, 3),
    'max',  coalesce(o.extend_max, 2),
    'used', coalesce(o.extend_used, 0),
    'left', greatest(0, coalesce(o.extend_max, 2) - coalesce(o.extend_used, 0)),
    'can',  coalesce(o.status, '') = 'dispatched' and o.auto_deliver_at is not null and o.delivered_at is null
            and coalesce(o.extend_used, 0) < coalesce(o.extend_max, 2) and coalesce(o.extend_days, 3) > 0)
$win$;


-- 5) AN ORDER'S PROGRESS, AS IT IS HANDED OUT --------------------------------------
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


-- 6) THE LISTS AFTER THE TILL (the platform's Online Orders) -----------------------
-- p_scope: prepare (rung up, the goods still to go), onway, ready, delivered.
-- Only orders the till has rung up. The newest step first.
create or replace function public.vbp_pos_progress(p_key text, p_scope text default 'prepare', p_search text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $pl$
declare
  d       text := 'vbp_pos_progress';
  v_scope text := lower(btrim(coalesce(p_scope, 'prepare')));
  q       text := btrim(left(coalesce(p_search, ''), 60));
  qlike   text;
  digits  text;
  v_out   jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_scope not in ('prepare', 'onway', 'ready', 'delivered') then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  qlike  := '%' || replace(replace(replace(upper(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');

  select coalesce(jsonb_agg(public.pos_order_out(x.id, false)
                            || jsonb_build_object('progress', public.order_progress_out(x.id))
                            order by x.at desc), '[]'::jsonb)
    into v_out
    from (
      select o.id, coalesce(o.delivered_at, o.dispatched_at, o.ready_at, o.pos_completed_at, o.created_at) as at
        from public.orders o
       where o.pos_sale_id is not null
         and case v_scope
               when 'prepare'   then coalesce(o.status, '') = 'confirmed'
               when 'onway'     then coalesce(o.status, '') = 'dispatched'
               when 'ready'     then coalesce(o.status, '') = 'ready'
               when 'delivered' then coalesce(o.status, '') = 'delivered'
             end
         and (q = ''
              or upper(coalesce(o.ref, '')) like qlike
              or upper(coalesce(o.name, '')) like qlike
              or (length(digits) >= 4
                  and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%'))
       order by 2 desc
       limit 100
    ) x;

  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'scope', v_scope, 'orders', v_out);
end
$pl$;


-- 7) THE SHOP MOVES IT ON (the platform's buttons) ---------------------------------
-- p_step: dispatched (on its way), ready (ready for collection), delivered
-- (delivered, or collected), extend (give more time).
-- p_rules, with dispatched: { autoDays, extendDays, extendMax, remindDays },
-- the platform's Settings, kept on the order so a later change of setting
-- never changes an order already on its way. With extend: { days }.
-- A step that does not fit the order is refused and named.
create or replace function public.vbp_pos_order_progress(p_key text, p_ref text, p_step text,
                                                        p_note text default null, p_rules jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $pp$
declare
  d      text := 'vbp_pos_order_progress';
  v_ref  text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_step text := lower(btrim(coalesce(p_step, '')));
  v_note text := nullif(btrim(left(coalesce(p_note, ''), 300)), '');
  v_rule jsonb := case when jsonb_typeof(p_rules) = 'object' then p_rules else '{}'::jsonb end;
  o      public.orders;
  v_auto integer;
  v_ext  integer;
  v_max  integer;
  v_rem  integer;
  v_days integer;
  v_tok  text;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_step not in ('dispatched', 'ready', 'delivered', 'extend') then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  select * into o from public.orders where upper(ref) = v_ref for update;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  if o.pos_sale_id is null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_rung_up');
  end if;
  if coalesce(o.status, '') = 'cancelled' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'cancelled');
  end if;
  if coalesce(o.status, '') = 'completed' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'handed_over');
  end if;

  v_tok := coalesce(o.progress_token, left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 40));

  if v_step = 'dispatched' then
    if coalesce(o.fulfilment, 'delivery') <> 'delivery' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_delivery');
    end if;
    if o.status = 'delivered' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'delivered');
    end if;
    if o.status = 'dispatched' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true,
        'order', public.pos_order_out(o.id, false) || jsonb_build_object('progress', public.order_progress_out(o.id)));
    end if;
    v_auto := least(60, greatest(1, coalesce(public.pos_int(v_rule -> 'autoDays'), 7)));
    v_ext  := least(30, greatest(0, coalesce(public.pos_int(v_rule -> 'extendDays'), 3)));
    v_max  := least(10, greatest(0, coalesce(public.pos_int(v_rule -> 'extendMax'), 2)));
    v_rem  := least(v_auto - 1, greatest(0, coalesce(public.pos_int(v_rule -> 'remindDays'), 2)));
    update public.orders
       set status = 'dispatched', updated_at = now(), dispatched_at = now(),
           ship_note = coalesce(v_note, ship_note),
           auto_deliver_at = now() + make_interval(days => v_auto),
           extend_days = v_ext, extend_max = v_max, extend_used = 0,
           remind_days = v_rem, reminded_at = null, dispatch_mailed_at = null,
           progress_token = v_tok
     where id = o.id;

  elsif v_step = 'ready' then
    if coalesce(o.fulfilment, 'delivery') <> 'collection' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_collection');
    end if;
    if o.status = 'delivered' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'delivered');
    end if;
    if o.status = 'ready' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true,
        'order', public.pos_order_out(o.id, false) || jsonb_build_object('progress', public.order_progress_out(o.id)));
    end if;
    update public.orders
       set status = 'ready', updated_at = now(), ready_at = now(),
           ship_note = coalesce(v_note, ship_note), progress_token = v_tok
     where id = o.id;

  elsif v_step = 'delivered' then
    if o.status = 'delivered' then
      return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true,
        'order', public.pos_order_out(o.id, false) || jsonb_build_object('progress', public.order_progress_out(o.id)));
    end if;
    update public.orders
       set status = 'delivered', updated_at = now(), delivered_at = now(), delivered_by = 'shop',
           delivered_mailed_at = null, progress_token = v_tok
     where id = o.id;

  else  -- extend
    if coalesce(o.status, '') <> 'dispatched' or o.auto_deliver_at is null then
      return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_on_its_way');
    end if;
    v_days := least(30, greatest(1, coalesce(public.pos_int(v_rule -> 'days'), o.extend_days, 3)));
    update public.orders
       set auto_deliver_at = greatest(auto_deliver_at, now()) + make_interval(days => v_days),
           reminded_at = null, updated_at = now()
     where id = o.id;
  end if;

  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', false,
    'order', public.pos_order_out(o.id, false) || jsonb_build_object('progress', public.order_progress_out(o.id)));
end
$pp$;


-- 8) A REFUND, RECORDED BY THE PLATFORM (build 510) --------------------------------
-- p_state: full or part. p_amount: what went back. p_refund_ref: Flutterwave's
-- reference for it. p_tell: email the customer (the 15-minute check sends it).
-- The same refund sent again changes nothing.
create or replace function public.vbp_pos_order_refund(p_key text, p_ref text, p_state text, p_amount numeric,
                                                      p_refund_ref text, p_note text, p_tell boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rf$
declare
  d       text := 'vbp_pos_order_refund';
  v_ref   text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_state text := lower(btrim(coalesce(p_state, '')));
  v_rref  text := nullif(btrim(left(coalesce(p_refund_ref, ''), 80)), '');
  v_note  text := nullif(btrim(left(coalesce(p_note, ''), 300)), '');
  o       public.orders;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_state not in ('full', 'part')
     or p_amount is null or p_amount <= 0 or p_amount >= 10000000 then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  select * into o from public.orders where upper(ref) = v_ref for update;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  if o.pos_sale_id is null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_rung_up');
  end if;
  if o.refund_state is not null and o.refund_ref is not distinct from v_rref
     and o.refund_amount = round(p_amount, 2) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true, 'progress', public.order_progress_out(o.id));
  end if;
  update public.orders
     set refund_state = v_state, refund_amount = round(p_amount, 2), refund_ref = v_rref,
         refund_note = v_note, refund_at = now(), updated_at = now(),
         refund_mailed_at = case when coalesce(p_tell, true) then null else now() end
   where id = o.id;
  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', false, 'progress', public.order_progress_out(o.id));
end
$rf$;


-- 9) THE CUSTOMER'S TWO BUTTONS --------------------------------------------------
-- One step, used by both ways in (signed in, or the private link).
create or replace function public.order_customer_step(p_id uuid, p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $cs$
declare
  o public.orders;
  w jsonb;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  if p_action = 'confirm' then
    if o.status = 'delivered' then
      return jsonb_build_object('ok', true, 'again', true, 'progress', public.order_progress_out(o.id));
    end if;
    if coalesce(o.status, '') <> 'dispatched' then
      return jsonb_build_object('ok', false, 'why', 'not_on_its_way', 'progress', public.order_progress_out(o.id));
    end if;
    update public.orders
       set status = 'delivered', updated_at = now(), delivered_at = now(), delivered_by = 'customer',
           delivered_mailed_at = now()          -- they said so themselves: no email about it
     where id = o.id;
  elsif p_action = 'extend' then
    w := public.order_extend_window(o);
    if not coalesce((w ->> 'can')::boolean, false) then
      return jsonb_build_object('ok', false,
        'why', case when coalesce(o.status, '') <> 'dispatched' then 'not_on_its_way' else 'no_more_time' end,
        'progress', public.order_progress_out(o.id));
    end if;
    update public.orders
       set auto_deliver_at = greatest(auto_deliver_at, now()) + make_interval(days => coalesce(extend_days, 3)),
           extend_used = coalesce(extend_used, 0) + 1, reminded_at = null, updated_at = now()
     where id = o.id;
  else
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  return jsonb_build_object('ok', true, 'again', false, 'progress', public.order_progress_out(o.id));
end
$cs$;

-- Signed in, on their own order.
create or replace function public.order_confirm_delivery(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $cd$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  if not exists (select 1 from public.orders o where o.id = p_id and o.customer_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  return public.order_customer_step(p_id, 'confirm');
end
$cd$;

create or replace function public.order_extend_delivery(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $ed$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  if not exists (select 1 from public.orders o where o.id = p_id and o.customer_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  return public.order_customer_step(p_id, 'extend');
end
$ed$;


-- 10) THE PRIVATE LINK: THE ORDER ALONE, AND THE SAME TWO BUTTONS --------------------
-- For a customer who ordered without an account. The link carries the order's
-- number and its own long random key; either wrong is "not found", and nothing
-- else. p_action: nothing (just look), confirm, or extend.
create or replace function public.order_progress_link(p_ref text, p_token text, p_action text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $lk$
declare
  v_ref text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_tok text := lower(btrim(left(coalesce(p_token, ''), 80)));
  v_act text := lower(btrim(coalesce(p_action, '')));
  v_id  uuid;
  r     jsonb := null;
  o     public.orders;
begin
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_tok !~ '^[0-9a-f]{32,64}$' then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  select x.id into v_id from public.orders x where upper(x.ref) = v_ref and x.progress_token = v_tok;
  if v_id is null then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  if v_act in ('confirm', 'extend') then
    r := public.order_customer_step(v_id, v_act);
  elsif v_act <> '' then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  select * into o from public.orders where id = v_id;
  return jsonb_build_object(
    'ok', coalesce((r ->> 'ok')::boolean, true),
    'why', r ->> 'why',
    'done', case when r is not null and coalesce((r ->> 'ok')::boolean, false) then v_act end,
    'order', jsonb_build_object(
      'ref', o.ref, 'createdAt', o.created_at,
      'firstName', nullif(split_part(btrim(coalesce(o.name, '')), ' ', 1), ''),
      'total', o.total, 'currency', o.currency, 'receiptNo', o.pos_receipt_no,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.name, i.sku), 'qty', coalesce(i.qty, 1))
                                          order by i.ctid), '[]'::jsonb)
                  from public.order_items i where i.order_id = o.id)),
    'progress', public.order_progress_out(v_id));
end
$lk$;


-- 11) THE SALE IS DONE: HANDED OVER, OR STILL TO GO -----------------------------------
-- From supabase-pos-orders.sql (website 76), with one change.
-- p_sale: { saleId, receiptNo, invoiceNo, pointsUsed, handedOver, receipt: {...} }.
-- BUILD 78 · handedOver: true, the customer took the goods at the counter,
-- and the order says Completed; false, the goods are still to be sent or
-- collected, and the order says Preparing (status 'confirmed') and carries on
-- through this file; not said at all (a platform from before build 509),
-- Completed, exactly as in build 76.
create or replace function public.vbp_pos_order_complete(p_key text, p_ref text, p_claim text, p_sale jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $done$
declare
  v_ref     text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_sale    text;
  v_rcpt    text;
  v_inv     text;
  v_pts     numeric := 0;
  v_receipt jsonb;
  v_status  text;
  o         public.orders;
  d         text := 'vbp_pos_order_complete';
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if p_sale is null or jsonb_typeof(p_sale) <> 'object' then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  v_sale := btrim(left(coalesce(p_sale ->> 'saleId', ''), 64));
  v_rcpt := nullif(btrim(left(coalesce(p_sale ->> 'receiptNo', ''), 40)), '');
  v_inv  := nullif(btrim(left(coalesce(p_sale ->> 'invoiceNo', ''), 40)), '');
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_sale = '' or coalesce(v_rcpt, v_inv) is null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if jsonb_typeof(p_sale -> 'pointsUsed') = 'number' then
    v_pts := greatest(0, (p_sale ->> 'pointsUsed')::numeric);
  end if;
  v_receipt := public.pos_receipt_clean(p_sale -> 'receipt');
  if v_receipt is not null and length(v_receipt::text) > 32000 then
    v_receipt := null;
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  select * into o from public.orders where upper(ref) = v_ref for update;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  if o.pos_sale_id is not null then
    if o.pos_sale_id = v_sale then
      return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true,
                                'receiptNo', o.pos_receipt_no);
    end if;
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'rung_up',
                              'receiptNo', o.pos_receipt_no, 'saleId', o.pos_sale_id);
  end if;

  v_status := case when jsonb_typeof(p_sale -> 'handedOver') = 'boolean'
                        and not (p_sale ->> 'handedOver')::boolean
                   then 'confirmed' else 'completed' end;
  update public.orders
     set status = v_status, updated_at = now(),
         pos_sale_id = v_sale, pos_receipt_no = v_rcpt, pos_invoice_no = v_inv,
         pos_receipt = v_receipt, pos_completed_at = now(),
         pos_claim_id = null, pos_claimed_by = null, pos_claimed_at = null
   where id = o.id;

  -- Points promised on it, by the account that placed it: rung up when the
  -- till took them, let go when it did not.
  if o.customer_id is not null and to_regclass('public.rewards_holds') is not null then
    execute 'update public.rewards_holds
                set status = case when $3 > 0 then ''rung_up'' else ''released'' end,
                    decided_at = now()
              where order_ref = $1 and user_id = $2 and status = ''promised'''
      using o.ref, o.customer_id, v_pts;
  end if;

  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', false, 'receiptNo', v_rcpt);
end
$done$;


-- 12) WHO MAY USE THEM -----------------------------------------------------------------
-- The platform knocks with this website's public key; only the door's key opens
-- its three. The customer's two need a signed-in customer, on their own order;
-- the link needs the order's own key. The rest are parts, called from inside.
revoke all on function public.orders_progress_guard() from public, anon, authenticated;
revoke all on function public.pos_int(jsonb) from public, anon, authenticated;
revoke all on function public.order_progress_out(uuid) from public, anon, authenticated;
revoke all on function public.order_extend_window(public.orders) from public, anon, authenticated;
revoke all on function public.order_customer_step(uuid, text) from public, anon, authenticated;
revoke all on function public.vbp_pos_order_progress(text, text, text, text, jsonb) from public;
revoke all on function public.vbp_pos_progress(text, text, text) from public;
revoke all on function public.vbp_pos_order_refund(text, text, text, numeric, text, text, boolean) from public;
revoke all on function public.vbp_pos_order_complete(text, text, text, jsonb) from public;
revoke all on function public.order_confirm_delivery(uuid) from public, anon;
revoke all on function public.order_extend_delivery(uuid) from public, anon;
revoke all on function public.order_progress_link(text, text, text) from public;
grant execute on function public.vbp_pos_order_progress(text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_progress(text, text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_refund(text, text, text, numeric, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_complete(text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.order_confirm_delivery(uuid) to authenticated;
grant execute on function public.order_extend_delivery(uuid) to authenticated;
grant execute on function public.order_progress_link(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';


-- 13) CHECK -------------------------------------------------------------------------------
-- One row, each box OK. And who may open the admin: every login on the
-- administrators list, its email shortened, with its role. Find your own
-- login there before you upload website 78; if it is not there, the admin
-- will not open for it (see the notes for website 78).
select case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'orders'
                     and column_name in ('ship_note', 'dispatched_at', 'ready_at', 'delivered_at', 'delivered_by',
                                         'auto_deliver_at', 'extend_days', 'extend_max', 'extend_used', 'remind_days',
                                         'reminded_at', 'progress_token', 'dispatch_mailed_at', 'delivered_mailed_at',
                                         'refund_state', 'refund_amount', 'refund_ref', 'refund_note', 'refund_at',
                                         'refund_mailed_at')) = 20
            then 'OK' else 'NOT DONE' end as progress_columns,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('vbp_pos_order_progress', 'vbp_pos_progress', 'vbp_pos_order_refund')) = 3
            then 'OK' else 'NOT DONE' end as doors,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('order_confirm_delivery', 'order_extend_delivery', 'order_progress_link')) = 3
            then 'OK' else 'NOT DONE' end as customer_buttons,
       case when exists (select 1 from pg_trigger where tgname = 'orders_progress_guard_t')
            then 'OK' else 'NOT DONE' end as guard,
       coalesce((select string_agg(left(u.email, 2) || '…@' || split_part(u.email, '@', 2)
                                   || coalesce(' (' || (to_jsonb(a) ->> 'role') || ')', ''), ', '
                                   order by (to_jsonb(a) ->> 'role') = 'owner' desc, u.email)
                   from public.admins a join auth.users u on u.id = a.id),
                'NOBODY: the admin will not open for anyone') as administrators;


-- =================================================================================
-- THE UNDO
--
-- Takes the new doors and buttons away. Orders keep what they recorded; the
-- platform's Online Orders then cannot move an order on, and the customer's
-- page shows the status only.
--
--   drop function if exists public.vbp_pos_order_progress(text, text, text, text, jsonb);
--   drop function if exists public.vbp_pos_progress(text, text, text);
--   drop function if exists public.vbp_pos_order_refund(text, text, text, numeric, text, text, boolean);
--   drop function if exists public.order_confirm_delivery(uuid);
--   drop function if exists public.order_extend_delivery(uuid);
--   drop function if exists public.order_progress_link(text, text, text);
--   drop trigger if exists orders_progress_guard_t on public.orders;
-- =================================================================================
