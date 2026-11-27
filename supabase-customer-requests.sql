-- =====================================================================
-- Vaultique Boutique Point: CUSTOMER REQUESTS (website build 87,
-- platform build 512)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, setting or key. Run in
-- the wrong project, or before the files it stands on, it stops at step 1
-- and creates nothing.
--
-- WHAT IT IS FOR
--
-- A signed-in customer asks, from their own order in their account:
--
--   cancel     before the shop has started preparing it
--   return     within so many days of receiving it (Settings > Customer
--              Accounts: "Days after delivery to ask for a return or
--              exchange", 7 unless set)
--   exchange   the same, for something else instead
--   problem    something missing, damaged or wrong, once it is on its way,
--              and up to 30 days after
--
-- Each is a REQUEST: the shop accepts or declines it, with a word for the
-- customer, and marks it done when it is done. The business platform does
-- that in its Online Orders (platform build 512), through a door behind the
-- same key as the till's (supabase-pos-orders.sql); until then an
-- administrator can, in Admin > Orders. Nothing is asked of the customer
-- twice: one open request of each kind per order.
--
-- Switched off until Settings > Customer Accounts says "Let customers ask to
-- cancel, return or exchange, or report a problem": before that, nobody can
-- make one, whatever a browser sends.
--
-- WHAT IT CHANGES
--
--   * order_requests: new. Every request: what was asked, why, which
--     pieces, and where it stands. Nobody deletes one.
--   * Accepting a CANCEL of an order that is not paid online and not rung up
--     at the till cancels the order, as Admin > Orders would, and the
--     request is done. An order paid online is cancelled by its refund
--     (Online Refund, website 81), never here. A return or an exchange is
--     handled by the shop, at the till and through Online Refund, as now.
--     Nothing else about any order changes.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH WHAT THIS STANDS ON? ----------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.customers') is null
     or to_regclass('public.site_settings') is null then
    raise exception 'This is not the website''s Supabase: run this in the WEBSITE''s project. Nothing was created.';
  end if;
  if to_regprocedure('public.pos_door_key_ok(text)') is null or to_regprocedure('public.pos_order_out(uuid,boolean)') is null then
    raise exception 'The platform''s door is not here yet. Run supabase-pos-orders.sql first (website 76). Nothing was created.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'delivered_at') then
    raise exception 'An order''s progress is not here yet. Run supabase-order-progress.sql first (website 78). Nothing was created.';
  end if;
end
$guard$;


-- 2) THE REQUESTS --------------------------------------------------------------
create table if not exists public.order_requests (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique
                default ('RQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  order_id      uuid references public.orders(id) on delete set null,
  order_ref     text not null,
  customer_id   uuid references public.customers(id) on delete set null,
  kind          text not null check (kind in ('cancel', 'return', 'exchange', 'problem')),
  reason        text not null check (reason in ('changed_mind', 'ordered_by_mistake', 'too_slow', 'wrong_size',
                                                'not_as_shown', 'damaged', 'quality', 'wrong_item', 'missing', 'other')),
  detail        text check (detail is null or char_length(detail) <= 1000),
  wants         text check (wants is null or char_length(wants) <= 300),      -- an exchange: what instead
  items         jsonb not null default '[]'::jsonb,                           -- [{sku, name, qty}]
  status        text not null default 'requested'
                check (status in ('requested', 'accepted', 'declined', 'done', 'withdrawn')),
  answer        text check (answer is null or char_length(answer) <= 1000),  -- the shop's word to the customer
  decided_at    timestamptz,
  decided_by    text,                                     -- who, as the platform or the admin knows them
  decided_from  text check (decided_from is null or decided_from in ('platform', 'admin')),
  platform_ref  text check (platform_ref is null or char_length(platform_ref) <= 60),
  done_at       timestamptz,
  shop_told_at  timestamptz,                              -- the shop emailed that it arrived
  customer_told text,                                     -- the last status the customer was emailed about
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists order_requests_order    on public.order_requests (order_id, created_at);
create index if not exists order_requests_customer on public.order_requests (customer_id, created_at desc);
create index if not exists order_requests_open     on public.order_requests (status, created_at)
  where status in ('requested', 'accepted');

-- Read by the shop's administrators with the orders permission; written only
-- by the functions below, and the emails' two columns by the website's own
-- 15-minute check (service key). A customer reads their own through
-- requests_mine(), which leaves out who in the team decided.
alter table public.order_requests enable row level security;
revoke all on table public.order_requests from public, anon, authenticated, service_role;
grant select on table public.order_requests to authenticated;
grant select, update (shop_told_at, customer_told) on table public.order_requests to service_role;
do $pol$
begin
  drop policy if exists oreq_admin_read on public.order_requests;
  if to_regprocedure('public.may(text)') is not null then
    create policy oreq_admin_read on public.order_requests for select using ((select public.may('orders')));
  else
    create policy oreq_admin_read on public.order_requests for select using ((select public.is_admin()));
  end if;
end
$pol$;


-- 3) A REQUEST, AS IT IS HANDED OUT ----------------------------------------------
-- To the customer: what they asked and where it stands. Never who decided.
create or replace function public.request_out(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $out$
  select jsonb_build_object(
    'id', r.id, 'ref', r.ref, 'orderRef', r.order_ref, 'kind', r.kind, 'reason', r.reason,
    'detail', r.detail, 'wants', r.wants, 'items', r.items, 'status', r.status, 'answer', r.answer,
    'createdAt', r.created_at, 'decidedAt', r.decided_at, 'doneAt', r.done_at)
    from public.order_requests r where r.id = p_id;
$out$;

-- To the platform and the admin: the same, who decided, and the order.
create or replace function public.request_out_full(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $full$
  select public.request_out(r.id) || jsonb_build_object(
    'decidedBy', r.decided_by, 'decidedFrom', r.decided_from, 'platformRef', r.platform_ref,
    'updatedAt', r.updated_at,
    'order', case when r.order_id is null then null else public.pos_order_out(r.order_id, true) end)
    from public.order_requests r where r.id = p_id;
$full$;


-- 4) WHAT MAY BE ASKED, AND WHEN ---------------------------------------------------
-- The reasons each kind may give, and whether the order is at a point where
-- it may be asked. Both used by the customer's request and shown to them.
create or replace function public.request_reasons(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $rs$
  select case p_kind
    when 'cancel'   then array['changed_mind', 'ordered_by_mistake', 'too_slow', 'other']
    when 'return'   then array['wrong_size', 'not_as_shown', 'damaged', 'quality', 'changed_mind', 'other']
    when 'exchange' then array['wrong_size', 'not_as_shown', 'damaged', 'quality', 'other']
    when 'problem'  then array['missing', 'damaged', 'wrong_item', 'quality', 'other']
    else array[]::text[] end;
$rs$;

create or replace function public.request_window(o public.orders, p_kind text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $win$
declare
  s      jsonb;
  v_days integer := 7;
  v_got  timestamptz;
  st     text := coalesce(o.status, 'pending');
begin
  if st = 'cancelled' then return 'cancelled'; end if;
  if p_kind = 'cancel' then
    -- Before the shop has started on it: not rung up at the till, not sent.
    if o.pos_sale_id is not null or st not in ('pending', 'confirmed') then return 'too_late'; end if;
    return 'open';
  end if;
  select data into s from public.site_settings where key = 'customer-accounts';
  if coalesce(s ->> 'returnDays', '') ~ '^[0-9]{1,3}$' then
    v_days := least(90, greatest(1, (s ->> 'returnDays')::integer));
  end if;
  v_got := coalesce(o.delivered_at, case when st = 'completed' then coalesce(o.pos_completed_at, o.updated_at) end);
  if p_kind in ('return', 'exchange') then
    if st not in ('delivered', 'completed') then return 'not_yet'; end if;
    if v_got is not null and v_got < now() - make_interval(days => v_days) then return 'too_late'; end if;
    return 'open';
  end if;
  if p_kind = 'problem' then
    if st not in ('dispatched', 'ready', 'delivered', 'completed') then return 'not_yet'; end if;
    if v_got is not null and v_got < now() - interval '30 days' then return 'too_late'; end if;
    return 'open';
  end if;
  return 'unreadable';
end
$win$;


-- 5) THE CUSTOMER: ASK, SEE, WITHDRAW ---------------------------------------------
create or replace function public.request_open(p_order uuid, p_kind text, p_reason text,
                                               p_detail text default null, p_items jsonb default '[]'::jsonb,
                                               p_wants text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $op$
declare
  s        jsonb;
  o        public.orders;
  r        public.order_requests;
  v_win    text;
  v_detail text := nullif(btrim(left(coalesce(p_detail, ''), 1000)), '');
  v_wants  text := nullif(btrim(left(coalesce(p_wants, ''), 300)), '');
  v_items  jsonb := '[]'::jsonb;
  v_ask    jsonb;
  v_line   record;
  v_qty    integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  select data into s from public.site_settings where key = 'customer-accounts';
  if not coalesce((s ->> 'customerRequests')::boolean, false) then
    return jsonb_build_object('ok', false, 'why', 'off');
  end if;
  if p_kind is null or p_kind not in ('cancel', 'return', 'exchange', 'problem')
     or p_reason is null or not (p_reason = any (public.request_reasons(p_kind))) then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  if p_reason = 'other' and v_detail is null then
    return jsonb_build_object('ok', false, 'why', 'say_more');
  end if;
  if p_kind = 'exchange' and v_wants is null then
    return jsonb_build_object('ok', false, 'why', 'say_instead');
  end if;
  -- A few an hour for each customer (supabase-hardening.sql's counter).
  if to_regprocedure('public.throttle(text,text,integer,interval)') is not null then
    execute 'select public.throttle($1, $2, 10, interval ''1 hour'')' using 'order_request', auth.uid()::text;
  end if;

  select * into o from public.orders where id = p_order and customer_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  v_win := public.request_window(o, p_kind);
  if v_win <> 'open' then
    return jsonb_build_object('ok', false, 'why', v_win);
  end if;

  -- Which pieces: only ones on this order, never more than were ordered. A
  -- cancel is the whole order; a return or an exchange names at least one.
  if p_kind <> 'cancel' then
    v_ask := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
    for v_line in
      select i.sku, i.name, coalesce(i.qty, 1) as qty from public.order_items i where i.order_id = o.id
    loop
      select least(v_line.qty, greatest(0, coalesce(max(case when (a ->> 'qty') ~ '^[0-9]{1,3}$'
                                                             then (a ->> 'qty')::integer end), 0)))
        into v_qty
        from jsonb_array_elements(v_ask) a
       where a ->> 'sku' = v_line.sku;
      if coalesce(v_qty, 0) > 0 then
        v_items := v_items || jsonb_build_array(jsonb_build_object('sku', v_line.sku, 'name', v_line.name, 'qty', v_qty));
      end if;
    end loop;
    if p_kind in ('return', 'exchange') and jsonb_array_length(v_items) = 0 then
      return jsonb_build_object('ok', false, 'why', 'which_pieces');
    end if;
  end if;

  -- One open request of each kind per order: asked twice, the first stands.
  select * into r from public.order_requests
   where order_id = o.id and kind = p_kind and status in ('requested', 'accepted')
   order by created_at limit 1;
  if found then
    return jsonb_build_object('ok', true, 'again', true, 'request', public.request_out(r.id));
  end if;

  insert into public.order_requests (order_id, order_ref, customer_id, kind, reason, detail, wants, items)
  values (o.id, o.ref, auth.uid(), p_kind, p_reason, v_detail, v_wants, v_items)
  returning * into r;
  return jsonb_build_object('ok', true, 'again', false, 'request', public.request_out(r.id));
end
$op$;

-- Every request of the signed-in customer, newest first.
create or replace function public.requests_mine()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $mine$
  select coalesce(jsonb_agg(public.request_out(r.id) order by r.created_at desc), '[]'::jsonb)
    from public.order_requests r
   where auth.uid() is not null and r.customer_id = auth.uid();
$mine$;

-- What the customer may ask of one of their orders now, and why not.
create or replace function public.request_choices(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $ch$
declare
  s jsonb;
  o public.orders;
  out jsonb := '{}'::jsonb;
  k text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  select data into s from public.site_settings where key = 'customer-accounts';
  if not coalesce((s ->> 'customerRequests')::boolean, false) then
    return jsonb_build_object('ok', false, 'why', 'off');
  end if;
  select * into o from public.orders where id = p_order and customer_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  foreach k in array array['cancel', 'return', 'exchange', 'problem'] loop
    out := out || jsonb_build_object(k, jsonb_build_object(
      'can', public.request_window(o, k) = 'open', 'why', public.request_window(o, k),
      'reasons', to_jsonb(public.request_reasons(k))));
  end loop;
  return jsonb_build_object('ok', true, 'choices', out);
end
$ch$;

-- Withdrawn by the customer, while the shop has not answered yet.
create or replace function public.request_withdraw(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $wd$
declare
  r public.order_requests;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  select * into r from public.order_requests where id = p_id and customer_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  if r.status = 'withdrawn' then
    return jsonb_build_object('ok', true, 'again', true, 'request', public.request_out(r.id));
  end if;
  if r.status <> 'requested' then
    return jsonb_build_object('ok', false, 'why', 'answered', 'request', public.request_out(r.id));
  end if;
  update public.order_requests set status = 'withdrawn', updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'again', false, 'request', public.request_out(r.id));
end
$wd$;


-- 6) THE SHOP DECIDES: THE PLATFORM, OR AN ADMINISTRATOR ---------------------------
-- accept   a request not answered yet
-- decline  one not answered yet, or accepted and not done; the customer is
--          told why, so a word for them is needed
-- done     an accepted one, once it is done
create or replace function public.request_decide(p_id uuid, p_decision text, p_answer text, p_by text,
                                                 p_from text, p_platform_ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $dc$
declare
  r          public.order_requests;
  o          public.orders;
  v_answer   text := nullif(btrim(left(coalesce(p_answer, ''), 1000)), '');
  v_to       text;
  v_cancelled boolean := false;
  v_refund   boolean := false;
begin
  if p_decision not in ('accept', 'decline', 'done') then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  select * into r from public.order_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  v_to := case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' else 'done' end;
  if r.status = v_to then
    return jsonb_build_object('ok', true, 'again', true, 'request', public.request_out_full(r.id));
  end if;
  if not ((p_decision = 'accept' and r.status = 'requested')
       or (p_decision = 'decline' and r.status in ('requested', 'accepted'))
       or (p_decision = 'done' and r.status = 'accepted')) then
    return jsonb_build_object('ok', false, 'why', 'not_now', 'status', r.status);
  end if;
  if p_decision = 'decline' and v_answer is null then
    return jsonb_build_object('ok', false, 'why', 'answer_needed');
  end if;

  update public.order_requests
     set status = v_to,
         answer = coalesce(v_answer, answer),
         decided_at = case when p_decision in ('accept', 'decline') then now() else decided_at end,
         decided_by = coalesce(nullif(btrim(left(coalesce(p_by, ''), 80)), ''), decided_by),
         decided_from = p_from,
         platform_ref = coalesce(nullif(btrim(left(coalesce(p_platform_ref, ''), 60)), ''), platform_ref),
         done_at = case when p_decision = 'done' then now() else done_at end,
         updated_at = now()
   where id = r.id;

  -- A cancel accepted: an order nobody has paid for online and the till has
  -- not rung up is cancelled now, and nothing is left to do. One paid online
  -- is cancelled by its refund (Online Refund), never here.
  if p_decision = 'accept' and r.kind = 'cancel' and r.order_id is not null then
    select * into o from public.orders where id = r.order_id for update;
    if found then
      if o.payment_method = 'online' and coalesce(o.payment_status, '') = 'paid' then
        v_refund := true;
      elsif o.pos_sale_id is null and coalesce(o.status, 'pending') in ('pending', 'confirmed') then
        update public.orders set status = 'cancelled', updated_at = now() where id = o.id;
        update public.order_requests set status = 'done', done_at = now() where id = r.id;
        v_cancelled := true;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'again', false, 'orderCancelled', v_cancelled, 'refundFirst', v_refund,
                            'request', public.request_out_full(r.id));
end
$dc$;

-- The platform's door (its Online Orders, platform build 512), behind the
-- till's own key, counted like the till's questions.
create or replace function public.vbp_pos_requests(p_key text, p_scope text default 'open')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $list$
declare
  d     text := 'vbp_pos_requests';
  v_out jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  select coalesce(jsonb_agg(public.request_out_full(x.id) order by x.created_at desc), '[]'::jsonb)
    into v_out
    from (select r.id, r.created_at from public.order_requests r
           where case when p_scope = 'open' then r.status in ('requested', 'accepted') else true end
           order by r.created_at desc limit 100) x;
  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'requests', v_out);
end
$list$;

create or replace function public.vbp_pos_request_decide(p_key text, p_id uuid, p_decision text, p_answer text,
                                                         p_by text, p_platform_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $pd$
declare
  d text := 'vbp_pos_request_decide';
  r jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  r := public.request_decide(p_id, p_decision, p_answer, p_by, 'platform', p_platform_ref);
  return jsonb_build_object('door', d, 'v', 1) || r;
end
$pd$;

-- An administrator with the orders permission, in Admin > Orders.
create or replace function public.request_decide_admin(p_id uuid, p_decision text, p_answer text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $ad$
declare
  v_ok boolean := false;
  v_by text;
begin
  if to_regprocedure('public.may(text)') is not null then
    execute 'select public.may(''orders'')' into v_ok;
  else
    v_ok := public.is_admin();
  end if;
  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  select u.email into v_by from auth.users u where u.id = auth.uid();
  return public.request_decide(p_id, p_decision, p_answer, coalesce(v_by, 'an administrator'), 'admin', null);
end
$ad$;


-- 7) WHO MAY USE THEM -----------------------------------------------------------
-- The customer's four need a signed-in customer, on their own orders; the
-- platform's two need the door's key; the admin's needs the orders
-- permission. The rest are parts, called from inside.
revoke all on function public.request_out(uuid) from public, anon, authenticated;
revoke all on function public.request_out_full(uuid) from public, anon, authenticated;
revoke all on function public.request_window(public.orders, text) from public, anon, authenticated;
revoke all on function public.request_decide(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.request_open(uuid, text, text, text, jsonb, text) from public, anon;
revoke all on function public.requests_mine() from public, anon;
revoke all on function public.request_choices(uuid) from public, anon;
revoke all on function public.request_withdraw(uuid) from public, anon;
revoke all on function public.request_decide_admin(uuid, text, text) from public, anon;
revoke all on function public.vbp_pos_requests(text, text) from public;
revoke all on function public.vbp_pos_request_decide(text, uuid, text, text, text, text) from public;
revoke all on function public.request_reasons(text) from public, anon;
grant execute on function public.request_reasons(text) to authenticated, service_role;
grant execute on function public.request_open(uuid, text, text, text, jsonb, text) to authenticated;
grant execute on function public.requests_mine() to authenticated;
grant execute on function public.request_choices(uuid) to authenticated;
grant execute on function public.request_withdraw(uuid) to authenticated;
grant execute on function public.request_decide_admin(uuid, text, text) to authenticated;
grant execute on function public.vbp_pos_requests(text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_request_decide(text, uuid, text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 8) CHECK -------------------------------------------------------------------------
-- One row:
--   requests   OK · customers can ask, the shop decides
--   doors      OK
select case when to_regclass('public.order_requests') is not null
             and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('request_open', 'requests_mine', 'request_choices', 'request_withdraw',
                                       'request_decide_admin')) = 5
            then 'OK · customers can ask, the shop decides' else 'NOT DONE' end as requests,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('vbp_pos_requests', 'vbp_pos_request_decide')) = 2
            then 'OK' else 'NOT DONE' end as doors;


-- =================================================================================
-- THE UNDO
--
-- Takes the requests away from the account and the platform. The requests
-- already made stay in their table for the shop's records.
--
--   drop function if exists public.request_open(uuid, text, text, text, jsonb, text);
--   drop function if exists public.request_choices(uuid);
--   drop function if exists public.request_withdraw(uuid);
--   drop function if exists public.request_decide_admin(uuid, text, text);
--   drop function if exists public.vbp_pos_requests(text, text);
--   drop function if exists public.vbp_pos_request_decide(text, uuid, text, text, text, text);
-- =================================================================================
