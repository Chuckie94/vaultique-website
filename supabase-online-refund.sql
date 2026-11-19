-- =====================================================================
-- Vaultique Boutique Point: ONLINE REFUND (website build 81)
-- Run once in this WEBSITE's Supabase SQL Editor, after
-- supabase-order-progress.sql. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment or setting already
-- recorded. Run in the wrong project, or before the files it stands on,
-- it stops at step 1 and creates nothing.
--
-- WHAT IT ADDS
--
--   * refunds: every refund the platform sends to Flutterwave through
--     this website. What was asked (the order, the amount, the reason, who
--     asked and their role, the platform's own refund number), and what
--     happened (Flutterwave's answer and references, and the date and time
--     it was asked, sent, accepted, completed or failed).
--       - Nobody deletes a refund, and nobody changes what one asked for.
--         Where it stands only moves forward: new, sending, then pending,
--         completed, failed or refused (or unknown, while an answer lost
--         on the line is looked for).
--       - Administrators can read it. Nobody else can.
--
--   * Three doors for the platform, behind the platform's own door key,
--     like the till's (supabase-pos-orders.sql):
--       vbp_pos_refund_find     everything about one payment: the order,
--                               the customer, the pieces, the payment,
--                               the refunds so far, and what can still be
--                               refunded
--       vbp_pos_refund_request  "refund this": written down here before
--                               anything is sent, so a refund is never
--                               sent twice, and never more than was paid
--       vbp_pos_refunds         the refunds, and where each one is now
--
--   * The order's refund lines (website 78), kept up to date from the
--     refunds: the customer's page, the email and Admin > Orders show
--     Refunded or Part refunded, with Flutterwave's reference.
--
--   * Each refund in the payment history (website 77, once that is run).
--
-- WHO SENDS IT. The website's own function (pay-refund), with the
-- Flutterwave key that stays in the website's Netlify. It sends only a
-- refund written down here through the platform's door.
--
-- BEFORE THE TILL. An order paid online that the platform has not rung up
-- yet can be refunded only whole, and is then cancelled, so it can never
-- be rung up afterwards. If Flutterwave says no, it is put back as it was.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH WHAT THIS STANDS ON? ----------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.payments') is null then
    raise exception 'This website has no payments table yet. Run supabase-payments.sql first, in the website''s Supabase. Nothing was created.';
  end if;
  if to_regprocedure('public.pos_door_key_ok(text)') is null or to_regprocedure('public.pos_order_out(uuid,boolean)') is null then
    raise exception 'The platform''s door is not here yet. Run supabase-pos-orders.sql first (website 76). Nothing was created.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'refund_state') then
    raise exception 'An order''s progress is not here yet. Run supabase-order-progress.sql first (website 78). Nothing was created.';
  end if;
end
$guard$;


-- 2) THE REFUNDS -----------------------------------------------------------------
create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),
  request_key    text not null unique,      -- the platform's, so the same request twice is one refund
  order_id       uuid references public.orders(id) on delete set null,
  order_ref      text not null,
  payment_id     uuid references public.payments(id) on delete set null,
  tx_ref         text,                      -- our reference for the payment
  provider_tx_id text not null,             -- Flutterwave's transaction number for it
  mode           text not null check (mode in ('test', 'live')),
  currency       text not null,
  amount         numeric(12,2) not null check (amount > 0),
  whole          boolean not null default false,
  rung_up        boolean not null default false,   -- the platform had rung the order up when this was asked
  prev_status    text,                      -- the order's status, when a refund before the till cancelled it
  reason         text not null,
  by_name        text not null,             -- who asked, as the platform's server knows them
  by_role        text,
  platform_ref   text,                      -- the platform's own number for it (ORF-2026-0001)
  tell           boolean not null default true,    -- email the customer
  state          text not null default 'new'
                 check (state in ('new', 'sending', 'pending', 'completed', 'failed', 'refused', 'unknown')),
  flw_refund_id  text,
  flw_status     text,
  flw_message    text,
  detail         jsonb,
  requested_at   timestamptz not null default now(),
  sent_at        timestamptz,
  accepted_at    timestamptz,
  completed_at   timestamptz,
  failed_at      timestamptz,
  asked_at       timestamptz,               -- when Flutterwave was last asked about it
  asks           integer not null default 0,
  quiet          integer not null default 0,       -- unknown: looks in Flutterwave's list that found nothing
  updated_at     timestamptz not null default now()
);
create index if not exists refunds_order on public.refunds (order_id, requested_at);
create index if not exists refunds_open  on public.refunds (state, updated_at)
  where state in ('new', 'sending', 'pending', 'unknown');
create index if not exists refunds_flw   on public.refunds (flw_refund_id);
create index if not exists refunds_tx    on public.refunds (provider_tx_id);

-- Read by administrators only. Written by the platform's door (a new
-- refund) and by the payment service (what Flutterwave said), never
-- deleted.
alter table public.refunds enable row level security;
revoke all on table public.refunds from public, anon, authenticated, service_role;
grant select on table public.refunds to authenticated;
grant select, update on table public.refunds to service_role;
drop policy if exists refunds_admin_read on public.refunds;
create policy refunds_admin_read on public.refunds
  for select to authenticated using (public.is_admin());


-- 3) WHAT A REFUND ASKED NEVER CHANGES, AND IT ONLY MOVES FORWARD -------------------
-- Runs as whoever made the change. The door runs as its owner; the payment
-- service uses the service key and is held to the same rules as anybody.
-- The SQL Editor can set vq.refund_upkeep = 'yes' for the database's own
-- upkeep, and nothing else can.
create or replace function public.refunds_guard()
returns trigger
language plpgsql
set search_path = ''
as $rg$
begin
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       and coalesce(current_setting('vq.refund_upkeep', true), '') = 'yes' then
      return old;
    end if;
    raise exception 'a refund is never deleted';
  end if;
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'supabase_admin') then
      new.state := 'new';
      new.requested_at := now();
      new.updated_at := now();
      return new;
    end if;
    raise exception 'a refund is asked for through the platform''s door only';
  end if;
  if current_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('vq.refund_upkeep', true), '') = 'yes' then
    return new;
  end if;
  if (new.id, new.request_key, new.order_ref, new.tx_ref, new.provider_tx_id, new.mode, new.currency,
      new.amount, new.whole, new.rung_up, new.prev_status, new.reason, new.by_name, new.by_role,
      new.platform_ref, new.tell, new.requested_at)
     is distinct from
     (old.id, old.request_key, old.order_ref, old.tx_ref, old.provider_tx_id, old.mode, old.currency,
      old.amount, old.whole, old.rung_up, old.prev_status, old.reason, old.by_name, old.by_role,
      old.platform_ref, old.tell, old.requested_at) then
    raise exception 'what a refund asked for never changes';
  end if;
  -- (order_id and payment_id may only be emptied, by their rows being removed)
  if (new.order_id is distinct from old.order_id and new.order_id is not null)
     or (new.payment_id is distinct from old.payment_id and new.payment_id is not null) then
    raise exception 'what a refund asked for never changes';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'new'     and new.state = 'sending')
    or (old.state = 'sending' and new.state in ('pending', 'completed', 'failed', 'refused', 'unknown'))
    or (old.state = 'unknown' and new.state in ('pending', 'completed', 'failed', 'refused'))
    or (old.state = 'pending' and new.state in ('completed', 'failed'))) then
    raise exception 'a refund cannot go from % to %', old.state, new.state;
  end if;
  if old.flw_refund_id is not null and new.flw_refund_id is distinct from old.flw_refund_id then
    raise exception 'Flutterwave''s reference for a refund never changes';
  end if;
  if (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
     or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
     or (old.failed_at is not null and new.failed_at is distinct from old.failed_at) then
    raise exception 'the times of a refund, once written, never change';
  end if;
  new.updated_at := now();
  return new;
end
$rg$;

drop trigger if exists refunds_guard_t on public.refunds;
create trigger refunds_guard_t
  before insert or update or delete on public.refunds
  for each row execute function public.refunds_guard();


-- 4) ONE REFUND, AS THE DOOR HANDS IT OUT ---------------------------------------------
create or replace function public.refund_out(r public.refunds)
returns jsonb
language sql
stable
set search_path = ''
as $ro$
  select jsonb_build_object(
    'id', r.id, 'ref', r.order_ref, 'platformRef', r.platform_ref,
    'amount', r.amount, 'currency', r.currency, 'whole', r.whole, 'rungUp', r.rung_up,
    'reason', r.reason, 'by', r.by_name, 'byRole', r.by_role, 'tell', r.tell,
    'state', r.state, 'test', r.mode = 'test',
    'flwRefundId', r.flw_refund_id, 'flwRef', r.detail ->> 'flw_ref', 'flwStatus', r.flw_status,
    'message', r.flw_message, 'txRef', r.tx_ref, 'flwTxId', r.provider_tx_id,
    'requestedAt', r.requested_at, 'sentAt', r.sent_at, 'acceptedAt', r.accepted_at,
    'completedAt', r.completed_at, 'failedAt', r.failed_at, 'updatedAt', r.updated_at)
$ro$;


-- 5) THE ORDER, AND THE PAYMENT HISTORY, KEPT UP TO DATE ---------------------------------
-- The order's refund lines say what Flutterwave has accepted (pending or
-- completed): Refunded when it is all that was paid, Part refunded
-- otherwise. A refund Flutterwave refused puts back an order it cancelled
-- before the till. Each change is a line in the payment history. Nothing
-- here ever stops a refund being recorded.
create or replace function public.refunds_to_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $rt$
declare
  o      public.orders;
  v_sum  numeric;
  v_paid numeric;
  v_last public.refunds;
  v_was  text := null;          -- where it stood before (nothing, for a new one)
begin
  if tg_op = 'UPDATE' then
    v_was := old.state;
  end if;
  begin
    if to_regclass('public.payment_events') is not null
       and (tg_op = 'INSERT' or new.state is distinct from v_was) then
      execute 'insert into public.payment_events (order_id, tx_ref, what, from_state, to_state, note)
               values ($1, $2, ''refund'', $3, $4, $5)'
        using new.order_id, new.tx_ref, v_was, new.state,
              jsonb_strip_nulls(jsonb_build_object('amount', new.amount, 'currency', new.currency,
                'by', new.by_name, 'role', new.by_role, 'reason', left(new.reason, 120),
                'platformRef', new.platform_ref, 'flwRefundId', new.flw_refund_id,
                'flwRef', new.detail ->> 'flw_ref', 'flwStatus', new.flw_status,
                'message', left(new.flw_message, 200), 'test', case when new.mode = 'test' then true end));
    end if;
  exception when others then
    null;
  end;

  if new.order_id is null then
    return null;
  end if;
  begin
    select * into o from public.orders where id = new.order_id for update;
    if not found then
      return null;
    end if;

    -- Refused (or never reached Flutterwave): an order cancelled for it, before
    -- the till, is put back, unless another refund of it still stands.
    if tg_op = 'UPDATE' and new.state = 'refused' and v_was is distinct from 'refused'
       and new.prev_status is not null and o.status = 'cancelled' and o.pos_sale_id is null
       and not exists (select 1 from public.refunds r
                        where r.order_id = o.id and r.id <> new.id
                          and r.state in ('new', 'sending', 'unknown', 'pending', 'completed')) then
      update public.orders set status = new.prev_status, updated_at = now() where id = o.id;
    end if;

    -- What Flutterwave has accepted, on the order.
    if tg_op = 'UPDATE' and (new.state in ('pending', 'completed')) <> (v_was in ('pending', 'completed')) then
      select coalesce(sum(r.amount), 0) into v_sum
        from public.refunds r where r.order_id = o.id and r.state in ('pending', 'completed');
      select * into v_last
        from public.refunds r where r.order_id = o.id and r.state in ('pending', 'completed')
       order by r.accepted_at desc nulls last, r.requested_at desc limit 1;
      v_paid := coalesce(o.paid_amount, o.total, 0);
      if v_sum > 0 then
        update public.orders
           set refund_state = case when v_sum >= v_paid - 0.005 then 'full' else 'part' end,
               refund_amount = round(v_sum, 2),
               refund_ref = left(coalesce(v_last.detail ->> 'flw_ref', v_last.flw_refund_id, v_last.platform_ref), 80),
               refund_note = left(v_last.reason, 300),
               refund_at = coalesce(v_last.accepted_at, now()),
               -- the customer is told of each refund accepted, when the shop ticked it
               refund_mailed_at = case when new.state in ('pending', 'completed') and new.tell then null
                                       when new.state in ('pending', 'completed') then now()
                                       else o.refund_mailed_at end,
               updated_at = now()
         where id = o.id;
      else
        -- Accepted, then failed, and nothing else accepted: the order says
        -- nothing was refunded, because nothing was.
        update public.orders
           set refund_state = null, refund_amount = null, refund_ref = null, refund_note = null,
               refund_at = null, refund_mailed_at = null, updated_at = now()
         where id = o.id;
      end if;
    end if;
  exception when others then
    -- The refund itself is recorded whatever happens here.
    raise warning 'online refund: the order % was not brought up to date: %', new.order_ref, sqlerrm;
  end;
  return null;
end
$rt$;

drop trigger if exists refunds_to_order_t on public.refunds;
create trigger refunds_to_order_t
  after insert or update on public.refunds
  for each row execute function public.refunds_to_order();


-- 6) ITS PAYMENT, AND WHAT CAN STILL BE REFUNDED -------------------------------------------
-- The payment Flutterwave said was paid. What can still be refunded is what
-- was paid less what Flutterwave has accepted. why, when it cannot be:
--   not_online     not paid online (a refund at the counter, in Returns)
--   review         the payment needs attention: not paid as asked
--   not_paid       not paid (yet)
--   no_tx          paid, but Flutterwave's transaction number was never kept
--   in_flight      a refund of it is being sent right now
--   refunded       refunded in full already
--   being_rung_up  not rung up yet, and a till is ringing it up now
--   old_sale       completed before the platform's door existed
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
        'test', pay.mode = 'test', 'paidAt', coalesce(o.paid_at, pay.updated_at)) end,
    'paid', v_paid, 'refunded', round(v_acc, 2), 'left', v_left,
    'rungUp', o.pos_sale_id is not null, 'wholeOnly', o.pos_sale_id is null,
    'canRefund', v_why is null, 'why', v_why,
    'refunds', coalesce((select jsonb_agg(public.refund_out(r) order by r.requested_at)
                           from public.refunds r where r.order_id = o.id), '[]'::jsonb));
end
$rs$;


-- 7) THE PLATFORM'S FIRST DOOR: FIND THE PAYMENT --------------------------------------------
-- By the website's order number (VB-...), the receipt or invoice number the
-- platform gave the sale, our payment reference, or Flutterwave's
-- transaction number or reference.
create or replace function public.vbp_pos_refund_find(p_key text, p_search text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rf$
declare
  d    text := 'vbp_pos_refund_find';
  q    text := btrim(left(coalesce(p_search, ''), 80));
  v_id uuid;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if length(q) < 3 then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  select o.id into v_id from public.orders o where upper(o.ref) = upper(q) limit 1;
  if v_id is null then
    select o.id into v_id from public.orders o
     where o.pos_receipt_no = q or o.pos_invoice_no = q
     order by o.created_at desc limit 1;
  end if;
  if v_id is null then
    select p.order_id into v_id from public.payments p
     where p.order_id is not null
       and (p.tx_ref = q or p.provider_tx_id = q or p.detail ->> 'flw_ref' = q)
     order by (p.status = 'paid') desc, p.created_at desc limit 1;
  end if;
  if v_id is null then
    select o.id into v_id from public.orders o where o.pay_ref = q limit 1;
  end if;
  if v_id is null then
    return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'found', false);
  end if;

  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'found', true,
                            'order', public.pos_order_out(v_id, true),
                            'refund', public.refund_state_of(v_id));
end
$rf$;


-- 8) THE PLATFORM'S SECOND DOOR: "REFUND THIS" -------------------------------------------------
-- Written down before anything is sent. The same request (p_request_key)
-- again is the same refund, answered again. Refused, with why, when it
-- cannot be: as refund_state_of above, and
--   too_much      more than can still be refunded (left says how much)
--   whole_only    not rung up yet: only the whole of what is left
-- p_by is who asked, as the platform's server knows them, never as typed.
create or replace function public.vbp_pos_refund_request(p_key text, p_ref text, p_amount numeric, p_whole boolean,
                                                         p_reason text, p_by text, p_by_role text,
                                                         p_platform_ref text, p_request_key text,
                                                         p_tell boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rr$
declare
  d        text := 'vbp_pos_refund_request';
  v_ref    text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_rkey   text := btrim(left(coalesce(p_request_key, ''), 64));
  v_reason text := btrim(left(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'), 300));
  v_by     text := btrim(left(coalesce(p_by, ''), 80));
  v_role   text := nullif(btrim(left(coalesce(p_by_role, ''), 60)), '');
  v_pref   text := nullif(btrim(left(coalesce(p_platform_ref, ''), 40)), '');
  v_amount numeric;
  o        public.orders;
  pay      public.payments;
  r        public.refunds;
  st       jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' or v_rkey !~ '^[0-9A-Za-z-]{16,64}$'
     or p_amount is null or p_amount <= 0 or p_amount >= 10000000
     or length(v_reason) < 3 or v_by = ''
     or (v_pref is not null and v_pref !~ '^[0-9A-Za-z/-]{3,40}$') then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'unreadable');
  end if;
  v_amount := round(p_amount, 2);

  -- The same request again: the refund it made, wherever it is now.
  select * into r from public.refunds x where x.request_key = v_rkey;
  if found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true, 'refund', public.refund_out(r));
  end if;
  if not public.pos_door_count('write', 600) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;

  select * into o from public.orders x where upper(x.ref) = v_ref for update;
  if not found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'not_found');
  end if;
  -- Asked twice at the same moment: the second waited for the first.
  select * into r from public.refunds x where x.request_key = v_rkey;
  if found then
    return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', true, 'refund', public.refund_out(r));
  end if;

  st := public.refund_state_of(o.id);
  if not coalesce((st ->> 'canRefund')::boolean, false) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', st ->> 'why', 'left', st -> 'left');
  end if;
  if v_amount > (st ->> 'left')::numeric + 0.004 then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'too_much', 'left', st -> 'left');
  end if;
  if o.pos_sale_id is null and (not coalesce(p_whole, false)
                                or abs(v_amount - (st ->> 'left')::numeric) > 0.004) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'whole_only', 'left', st -> 'left');
  end if;

  select * into pay from public.payments p
   where p.order_id = o.id and p.status = 'paid'
   order by p.updated_at desc limit 1;

  insert into public.refunds (request_key, order_id, order_ref, payment_id, tx_ref, provider_tx_id, mode,
                              currency, amount, whole, rung_up, prev_status, reason, by_name, by_role,
                              platform_ref, tell)
  values (v_rkey, o.id, o.ref, pay.id, pay.tx_ref, btrim(pay.provider_tx_id), pay.mode,
          upper(coalesce(pay.currency, o.currency, 'ZMW')), v_amount, coalesce(p_whole, false),
          o.pos_sale_id is not null, case when o.pos_sale_id is null then o.status end,
          v_reason, v_by, v_role, v_pref, coalesce(p_tell, true))
  returning * into r;

  -- Before the till: the order is cancelled now, so no till can ring it up
  -- while its money goes back. Put back if Flutterwave says no.
  if o.pos_sale_id is null and o.status is distinct from 'cancelled' then
    update public.orders set status = 'cancelled', updated_at = now() where id = o.id;
  end if;

  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'again', false, 'refund', public.refund_out(r));
end
$rr$;


-- 9) THE PLATFORM'S THIRD DOOR: THE REFUNDS, AND WHERE EACH ONE IS -------------------------------
-- p_ids: these refunds (up to 100). Otherwise p_since: those changed since
-- then. Otherwise the latest 200.
create or replace function public.vbp_pos_refunds(p_key text, p_ids text[] default null,
                                                  p_since timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rl$
declare
  d     text := 'vbp_pos_refunds';
  v_ids uuid[];
  v_out jsonb;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', d, 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  if p_ids is not null then
    select coalesce(array_agg(x::uuid), '{}') into v_ids
      from (select x from unnest(p_ids[1:100]) as x
             where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') s;
    select coalesce(jsonb_agg(public.refund_out(r) order by r.requested_at desc), '[]'::jsonb) into v_out
      from public.refunds r where r.id = any (v_ids);
  elsif p_since is not null then
    select coalesce(jsonb_agg(public.refund_out(r) order by r.updated_at), '[]'::jsonb) into v_out
      from public.refunds r
     where r.id in (select x.id from public.refunds x where x.updated_at > p_since order by x.updated_at limit 200);
  else
    select coalesce(jsonb_agg(public.refund_out(r) order by r.requested_at desc), '[]'::jsonb) into v_out
      from public.refunds r
     where r.id in (select x.id from public.refunds x order by x.requested_at desc limit 200);
  end if;
  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'at', now(), 'refunds', v_out);
end
$rl$;


-- 10) WHO MAY CALL WHAT -------------------------------------------------------------------------
-- The three doors, with the platform's key (a wrong key is refused inside
-- each). Everything else only from inside the database.
revoke all on function public.refunds_guard() from public, anon, authenticated;
revoke all on function public.refunds_to_order() from public, anon, authenticated;
revoke all on function public.refund_out(public.refunds) from public, anon, authenticated;
revoke all on function public.refund_state_of(uuid) from public, anon, authenticated;
revoke all on function public.vbp_pos_refund_find(text, text) from public;
revoke all on function public.vbp_pos_refund_request(text, text, numeric, boolean, text, text, text, text, text, boolean) from public;
revoke all on function public.vbp_pos_refunds(text, text[], timestamptz) from public;
grant execute on function public.vbp_pos_refund_find(text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_refund_request(text, text, numeric, boolean, text, text, text, text, text, boolean)
  to anon, authenticated, service_role;
grant execute on function public.vbp_pos_refunds(text, text[], timestamptz) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 11) THE RESULT ----------------------------------------------------------------------------------
select case when to_regclass('public.refunds') is not null then 'OK' else 'MISSING' end as refunds,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('vbp_pos_refund_find', 'vbp_pos_refund_request', 'vbp_pos_refunds')
                     and has_function_privilege('anon', p.oid, 'execute')) = 3
            then 'OK · the platform can reach them with its own key' else 'CLOSED to the platform' end as doors,
       (select count(*) from public.refunds) as refunds_recorded;
