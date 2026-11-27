-- =====================================================================
-- Vaultique Boutique Point: PAYMENTS AND FRAUD (website build 91)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, refund, setting or
-- key: it only adds. Run in the wrong project, it stops at step 1 and
-- creates nothing.
--
-- WHAT IT IS FOR (the enterprise plan, build 91)
--
--   The fraud check     every order placed, payment started, payment
--                       confirmed and refund asked for is given a score by
--                       the website's server (netlify/functions/_risk.js),
--                       from records the website already keeps. Each score
--                       is kept here with its reasons (risk_cases). The
--                       ones that would be held or refused wait in a review
--                       queue, answered in Admin > Fraud & Risk: Approve,
--                       Reject or Escalate. It starts by watching only
--                       (decision D5: fourteen days): it scores and records,
--                       and never holds or refuses, until you switch it to
--                       act in Settings > Fraud & Risk. Approving a held
--                       payment marks nothing paid here: the website asks
--                       the gateway again, and marks it paid on its word.
--   The sealed record   every change to orders, payments, refunds, the staff
--                       and their roles, and the settings, and every fraud
--                       decision, written by the database itself
--                       (audit_chain), each entry sealed with the one before
--                       it, so changing or removing one afterwards shows.
--                       What a customer gave (a name, a phone, an address)
--                       is recorded only as "changed", never its value; a
--                       private setting only by its name.
--
-- WHAT IT CHANGES
--
--   * New tables: risk_cases, audit_chain, audit_anchors. Read only by the
--     owner and roles with the new Fraud & Risk right (before
--     supabase-hardening.sql, by every administrator); written only by the
--     database's own functions and the website's server. Closed to visitors.
--   * orders: one new column, risk_level.
--   * Triggers that write the record, after each change to orders,
--     payments, refunds, admins, site_settings, site_settings_private and
--     risk_cases. They never stop the change they record.
--   * Two-factor: a role with the Fraud & Risk right must use it (it can
--     release held payments), as one with Settings, Orders or Subscribers
--     already must. The same change is in supabase-hardening.sql.
-- =====================================================================


-- 1) THE RIGHT DATABASE? -------------------------------------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.payments') is null
     or to_regclass('public.admins') is null or to_regclass('public.site_settings') is null then
    raise exception 'This is not the website''s database, or supabase-payments.sql has not been run here (no orders or payments). Nothing was created.';
  end if;
end
$guard$;


-- 2) WHO MAY SEE AND ANSWER ------------------------------------------------------
-- The owner, and any role with the Fraud & Risk right (Settings > Users &
-- Roles). Before supabase-hardening.sql, every administrator.
create or replace function public.may_risk()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $mr$
declare v boolean;
begin
  if to_regprocedure('public.may(text)') is not null then
    execute 'select public.may(''risk'')' into v;
    return coalesce(v, false);
  end if;
  return public.is_admin();
end
$mr$;


-- 3) THE CASES ---------------------------------------------------------------------
create table if not exists public.risk_cases (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  moment       text not null,          -- order_placed | payment_start | payment_paid | refund | staff
  order_id     uuid references public.orders(id) on delete set null,
  order_ref    text,
  tx_ref       text,                   -- the payment's reference, when there is one
  refund_id    uuid,
  actor        text,                   -- staff: whose activity (an admin's id)
  score        integer not null,
  level        text not null,          -- low | medium | high | critical
  reasons      jsonb not null default '[]'::jsonb,   -- [{ signal, points, said }]
  mode         text not null,          -- watch | act
  action       text not null default 'none',          -- what was done: none | shown | held | refused
  would        text,                   -- what acting would have done (kept in watch mode too)
  review_state text not null default 'none',          -- none | open | approved | rejected | escalated
  review_note  text,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  alerted_at   timestamptz,
  escalated_mailed_at timestamptz,
  released_at  timestamptz            -- a held payment approved, then confirmed paid by its gateway
);
do $c$ begin
  alter table public.risk_cases add constraint risk_cases_shape check (
    moment in ('order_placed', 'payment_start', 'payment_paid', 'refund', 'staff')
    and level in ('low', 'medium', 'high', 'critical')
    and mode in ('watch', 'act')
    and action in ('none', 'shown', 'held', 'refused')
    and (would is null or would in ('none', 'shown', 'held', 'refused'))
    and review_state in ('none', 'open', 'approved', 'rejected', 'escalated')
    and score between 0 and 10000
    and jsonb_typeof(reasons) = 'array'
    and (review_note is null or char_length(review_note) <= 500));
exception when duplicate_object then null; end $c$;
create index if not exists risk_cases_at on public.risk_cases (at desc);
create index if not exists risk_cases_order on public.risk_cases (order_id);
create index if not exists risk_cases_open on public.risk_cases (review_state) where review_state in ('open', 'escalated');
-- One case for each payment's start, each payment's confirmation, each refund
-- and each WhatsApp order: several messages about one payment at the same
-- moment (the webhook, the customer's page, the check-up) share one decision.
create unique index if not exists risk_cases_one_start on public.risk_cases (tx_ref)
  where moment = 'payment_start' and tx_ref is not null;
create unique index if not exists risk_cases_one_paid on public.risk_cases (tx_ref)
  where moment = 'payment_paid' and tx_ref is not null;
create unique index if not exists risk_cases_one_refund on public.risk_cases (refund_id)
  where moment = 'refund' and refund_id is not null;
create unique index if not exists risk_cases_one_order on public.risk_cases (order_id)
  where moment = 'order_placed' and order_id is not null;
alter table public.risk_cases enable row level security;
drop policy if exists rc_read on public.risk_cases;
create policy rc_read on public.risk_cases for select using (public.may_risk());
revoke insert, update, delete, truncate on public.risk_cases from anon, authenticated;
revoke all on public.risk_cases from anon;   -- a visitor has no business here at all

alter table public.orders add column if not exists risk_level text;
do $c$ begin
  alter table public.orders add constraint orders_risk_level_shape
    check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical'));
exception when duplicate_object then null; end $c$;


-- 4) THE SEALED RECORD -----------------------------------------------------------
-- Each entry carries the seal (hash) of the one before it, and its own:
-- SHA-256 of the previous seal and everything in the entry. Change an entry
-- afterwards, or take one out, and the seals after it no longer agree.
-- The latest seal is copied every fifteen minutes into audit_anchors, so
-- removing the newest entries shows too.
create table if not exists public.audit_chain (
  id        bigserial primary key,
  at        timestamptz not null,
  actor     uuid,                     -- the signed-in person, when there is one
  via       text not null,            -- staff | customer | service | database
  tbl       text not null,
  row_ref   text,
  action    text not null,            -- insert | update | delete | decision
  detail    jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash      text not null
);
create index if not exists audit_chain_actor_at on public.audit_chain (actor, at);
create table if not exists public.audit_anchors (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  last_id   bigint not null,
  last_hash text not null
);
alter table public.audit_chain enable row level security;
alter table public.audit_anchors enable row level security;
drop policy if exists ac_read on public.audit_chain;
drop policy if exists aa_read on public.audit_anchors;
create policy ac_read on public.audit_chain for select using (public.may_risk());
create policy aa_read on public.audit_anchors for select using (public.may_risk());
revoke insert, update, delete, truncate on public.audit_chain, public.audit_anchors from anon, authenticated, service_role;
revoke all on public.audit_chain, public.audit_anchors from anon;

-- Nothing may change or remove an entry, whoever asks.
create or replace function public.audit_frozen()
returns trigger
language plpgsql
as $af$
begin
  raise exception 'The sealed record cannot be changed or removed.';
end
$af$;
drop trigger if exists audit_chain_frozen on public.audit_chain;
create trigger audit_chain_frozen before update or delete on public.audit_chain
  for each row execute function public.audit_frozen();
drop trigger if exists audit_chain_no_truncate on public.audit_chain;
create trigger audit_chain_no_truncate before truncate on public.audit_chain
  for each statement execute function public.audit_frozen();
drop trigger if exists audit_anchors_frozen on public.audit_anchors;
create trigger audit_anchors_frozen before update or delete on public.audit_anchors
  for each row execute function public.audit_frozen();
drop trigger if exists audit_anchors_no_truncate on public.audit_anchors;
create trigger audit_anchors_no_truncate before truncate on public.audit_anchors
  for each statement execute function public.audit_frozen();

-- The seal of one entry, from its parts. The same text, read back later,
-- gives the same seal.
create or replace function public.audit_hash(p_prev text, p_at timestamptz, p_actor uuid, p_via text, p_tbl text,
                                             p_ref text, p_action text, p_detail jsonb)
returns text
language sql
immutable
set search_path = ''
as $ah$
  select encode(sha256(convert_to(
           p_prev || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
           coalesce(p_actor::text, '') || '|' || p_via || '|' || p_tbl || '|' || coalesce(p_ref, '') || '|' ||
           p_action || '|' || coalesce(p_detail, '{}'::jsonb)::text, 'UTF8')), 'hex');
$ah$;

-- One entry, sealed. One at a time (a lock), so two changes at once never
-- seal against the same previous entry.
create or replace function public.audit_seal(p_tbl text, p_ref text, p_action text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $as$
declare
  v_prev  text;
  v_at    timestamptz := clock_timestamp();
  v_actor uuid;
  v_role  text;
  v_via   text;
begin
  perform pg_advisory_xact_lock(hashtext('vbp_audit_chain'));
  select c.hash into v_prev from public.audit_chain c order by c.id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  begin v_actor := auth.uid(); exception when others then v_actor := null; end;
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_via := case
    when v_actor is not null and exists (select 1 from public.admins a where a.id = v_actor) then 'staff'
    when v_actor is not null then 'customer'
    when v_role = 'service_role' then 'service'
    else 'database' end;
  insert into public.audit_chain (at, actor, via, tbl, row_ref, action, detail, prev_hash, hash)
  values (v_at, v_actor, v_via, p_tbl, p_ref, p_action, coalesce(p_detail, '{}'::jsonb), v_prev,
          public.audit_hash(v_prev, v_at, v_actor, v_via, p_tbl, p_ref, p_action, coalesce(p_detail, '{}'::jsonb)));
end
$as$;

-- What changed in a row: the columns asked for, with their values where
-- they are not a customer's own details (`said`), and only their names
-- where they are (`named`). Nothing, when none of them changed.
create or replace function public.audit_changes(p_old jsonb, p_new jsonb, said text[], named text[])
returns jsonb
language sql
immutable
set search_path = ''
as $ac$
  select coalesce(
    (select jsonb_object_agg(k, jsonb_build_array(p_old -> k, p_new -> k))
       from unnest(said) k where (p_old -> k) is distinct from (p_new -> k)), '{}'::jsonb)
  || case when exists (select 1 from unnest(named) k where (p_old -> k) is distinct from (p_new -> k))
          then jsonb_build_object('changed', (select jsonb_agg(k) from unnest(named) k
                                              where (p_old -> k) is distinct from (p_new -> k)))
          else '{}'::jsonb end;
$ac$;

-- The trigger, for every table recorded. It never stops the change itself:
-- a record that cannot be written is a warning in the database's log.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $ar$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  t text := tg_table_name;
  d jsonb;
  ref text;
begin
  begin
    if t = 'orders' then
      ref := r ->> 'ref';
      if tg_op = 'UPDATE' then
        d := public.audit_changes(o, n,
          array['status', 'payment_status', 'payment_method', 'total', 'paid_amount', 'pos_sale_id', 'refund_state',
                'refund_amount', 'dispatched_at', 'delivered_at', 'customer_id', 'pay_mode', 'risk_level'],
          array['name', 'phone', 'email', 'address', 'notes', 'delivery_instructions']);
        if d = '{}'::jsonb then return null; end if;
      else
        d := jsonb_build_object('status', r -> 'status', 'total', r -> 'total', 'payment_status', r -> 'payment_status');
      end if;
    elsif t = 'payments' then
      ref := r ->> 'tx_ref';
      if tg_op = 'UPDATE' then
        -- What a payment is: not the bookkeeping of each time it is checked.
        d := public.audit_changes(o, n,
          array['status', 'amount', 'currency', 'mode', 'order_id', 'provider', 'provider_ref', 'provider_tx_id',
                'confirmed_at', 'failure_reason', 'method', 'network'],
          array['phone']);
        if d = '{}'::jsonb then return null; end if;
      else
        d := jsonb_build_object('status', r -> 'status', 'amount', r -> 'amount', 'mode', r -> 'mode',
                                'provider', coalesce(r -> 'provider', '"flutterwave"'::jsonb), 'order', r -> 'order_id');
      end if;
    elsif t = 'refunds' then
      ref := coalesce(r ->> 'platform_ref', r ->> 'order_ref');
      if tg_op = 'UPDATE' then
        d := public.audit_changes(o, n, array['state', 'amount', 'whole', 'by_name', 'completed_at', 'failed_at'], array[]::text[]);
        if d = '{}'::jsonb then return null; end if;
      else
        d := jsonb_build_object('order', r -> 'order_ref', 'amount', r -> 'amount', 'state', r -> 'state', 'by', r -> 'by_name');
      end if;
    elsif t = 'admins' then
      ref := r ->> 'id';
      if tg_op = 'UPDATE' then
        d := public.audit_changes(o, n, array['role', 'active'], array['email', 'display_name']);
        if d = '{}'::jsonb then return null; end if;
      else
        d := jsonb_build_object('role', r -> 'role', 'active', r -> 'active');
      end if;
    elsif t in ('site_settings', 'site_settings_private') then
      ref := r ->> 'key';
      d := jsonb_build_object('changed', coalesce((
             select jsonb_agg(k order by k) from (
               select k from jsonb_object_keys(coalesce(n -> 'data', '{}'::jsonb)) k
                where (coalesce(o -> 'data', '{}'::jsonb) -> k) is distinct from (n -> 'data' -> k)
               union
               select k from jsonb_object_keys(coalesce(o -> 'data', '{}'::jsonb)) k
                where not (coalesce(n -> 'data', '{}'::jsonb) ? k)) x), '[]'::jsonb));
      if tg_op = 'UPDATE' and d -> 'changed' = '[]'::jsonb then return null; end if;
    elsif t = 'risk_cases' then
      ref := coalesce(r ->> 'order_ref', r ->> 'actor', r ->> 'id');
      if tg_op = 'UPDATE' then
        d := public.audit_changes(o, n, array['review_state', 'review_note', 'action'], array[]::text[]);
        if d = '{}'::jsonb then return null; end if;
        d := d || jsonb_build_object('case', r -> 'id', 'moment', r -> 'moment', 'level', r -> 'level');
      else
        d := jsonb_build_object('case', r -> 'id', 'moment', r -> 'moment', 'level', r -> 'level', 'score', r -> 'score',
                                'action', r -> 'action', 'would', r -> 'would');
      end if;
      perform public.audit_seal(t, ref, case when tg_op = 'INSERT' then 'decision' else 'review' end, d);
      return null;
    else
      ref := r ->> 'id';
      d := '{}'::jsonb;
    end if;
    perform public.audit_seal(t, ref, lower(tg_op), d);
  exception when others then
    raise warning 'The sealed record could not be written for % (%): %', t, tg_op, sqlerrm;
  end;
  return null;
end
$ar$;

do $t$
declare tbl text;
begin
  foreach tbl in array array['orders', 'payments', 'refunds', 'admins', 'site_settings', 'site_settings_private', 'risk_cases'] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists %I on public.%I', 'zz_audit_' || tbl, tbl);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                     'zz_audit_' || tbl, tbl);
    end if;
  end loop;
end
$t$;

-- Checking the record: each entry's seal, from the one before it, over the
-- last p_limit entries (all of them with a large number), and every anchor
-- against the entry it names.
create or replace function public.audit_verify(p_limit integer default 5000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $av$
declare
  c       record;
  v_prev  text;
  v_first bigint;
  v_n     integer := 0;
  v_total bigint;
  v_last  public.audit_chain;
  a       record;
begin
  if not (public.may_risk() or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
          or (session_user in ('postgres', 'supabase_admin') and current_setting('role') = 'none')) then
    -- (the last: the database's owner in the SQL Editor, not a sign-in that
    -- PostgREST has switched to a role)
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  select count(*) into v_total from public.audit_chain;
  select * into v_last from public.audit_chain order by id desc limit 1;
  select min(id) into v_first from (select id from public.audit_chain order by id desc limit greatest(1, coalesce(p_limit, 5000))) x;
  if v_first is null then
    return jsonb_build_object('ok', true, 'checked', 0, 'entries', 0);
  end if;
  select hash into v_prev from public.audit_chain where id < v_first order by id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  for c in select * from public.audit_chain where id >= v_first order by id loop
    v_n := v_n + 1;
    if c.prev_hash <> v_prev then
      return jsonb_build_object('ok', false, 'why', 'link', 'at', c.id, 'checked', v_n, 'entries', v_total,
                                'said', 'Entry ' || c.id || ' does not follow the one before it: an entry before it was changed or removed.');
    end if;
    if c.hash <> public.audit_hash(c.prev_hash, c.at, c.actor, c.via, c.tbl, c.row_ref, c.action, c.detail) then
      return jsonb_build_object('ok', false, 'why', 'seal', 'at', c.id, 'checked', v_n, 'entries', v_total,
                                'said', 'Entry ' || c.id || ' was changed after it was written.');
    end if;
    v_prev := c.hash;
  end loop;
  for a in select * from public.audit_anchors order by id loop
    if not exists (select 1 from public.audit_chain x where x.id = a.last_id and x.hash = a.last_hash) then
      return jsonb_build_object('ok', false, 'why', 'anchor', 'at', a.last_id, 'checked', v_n, 'entries', v_total,
                                'said', 'Entry ' || a.last_id || ', copied aside at ' || to_char(a.at, 'YYYY-MM-DD HH24:MI') ||
                                        ' UTC, is missing or different now.');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'checked', v_n, 'entries', v_total, 'lastId', v_last.id, 'lastHash', v_last.hash,
                            'lastAt', v_last.at, 'anchors', (select count(*) from public.audit_anchors));
end
$av$;

-- The latest seal, copied aside (the fifteen-minute job), when it moved.
create or replace function public.audit_anchor()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $aa$
declare v public.audit_chain; l public.audit_anchors;
begin
  select * into v from public.audit_chain order by id desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'anchored', false); end if;
  select * into l from public.audit_anchors order by id desc limit 1;
  if found and l.last_id = v.id then return jsonb_build_object('ok', true, 'anchored', false, 'lastId', v.id); end if;
  insert into public.audit_anchors (last_id, last_hash) values (v.id, v.hash);
  return jsonb_build_object('ok', true, 'anchored', true, 'lastId', v.id);
end
$aa$;


-- 5) WHAT THE SCORE IS MADE FROM ------------------------------------------------
-- Counts from records the website already keeps, for the server's fraud
-- check, in one question. Nothing new is kept about anybody to answer it.
--   p: { phone, email, client, customer, order_id, total, since_hours }
create or replace function public.risk_facts(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $rf$
declare
  v_digits text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 9);
  v_email  text := lower(btrim(coalesce(p ->> 'email', '')));
  v_client text := nullif(btrim(coalesce(p ->> 'client', '')), '');
  v_cust   uuid := nullif(p ->> 'customer', '')::uuid;
  v_order  uuid := nullif(p ->> 'order_id', '')::uuid;
  v_day    timestamptz := now() - interval '1 day';
  out      jsonb := '{}'::jsonb;
  v        bigint;
  m        numeric;
  k        bigint;
begin
  if length(v_digits) >= 7 then
    select count(*) into v from public.orders o
     where o.created_at > v_day and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 9) = v_digits;
    out := out || jsonb_build_object('ordersPhone', v);
    select count(*) into v from public.payments y
     where y.created_at > v_day and y.status = 'failed' and right(regexp_replace(coalesce(y.phone, ''), '\D', '', 'g'), 9) = v_digits;
    out := out || jsonb_build_object('failedPhone', v);
    if to_regclass('public.refunds') is not null then
      execute 'select count(*) from public.refunds f join public.orders o on o.id = f.order_id
                where f.requested_at > now() - interval ''90 days'' and f.state not in (''refused'', ''failed'')
                  and right(regexp_replace(coalesce(o.phone, ''''), ''\D'', '''', ''g''), 9) = $1'
        into v using v_digits;
      out := out || jsonb_build_object('refundsPhone90', v);
    end if;
  end if;
  if v_email like '%@%' then
    select count(*) into v from public.orders o where o.created_at > v_day and lower(btrim(coalesce(o.email, ''))) = v_email;
    out := out || jsonb_build_object('ordersEmail', v);
  end if;
  if v_client is not null and to_regclass('public.rate_events') is not null then
    execute 'select count(*) from public.rate_events where bucket = ''order'' and key = $1 and at > $2' into v using v_client, v_day;
    out := out || jsonb_build_object('ordersClient', v);
    execute 'select count(*) from public.rate_events where bucket = ''refused'' and key = $1 and at > $2' into v using v_client, v_day;
    out := out || jsonb_build_object('refusedClient', v);
  end if;
  if v_cust is not null then
    select count(*) into v from public.orders o where o.created_at > v_day and o.customer_id = v_cust;
    out := out || jsonb_build_object('ordersAccount', v);
    if to_regclass('public.customer_addresses') is not null then
      execute 'select count(*) from public.customer_addresses a where a.customer_id = $1 and a.created_at > now() - interval ''30 minutes'''
        into v using v_cust;
      out := out || jsonb_build_object('addressNew', v);
    end if;
  end if;
  if v_order is not null then
    select count(*) into v from public.payments y where y.order_id = v_order;
    out := out || jsonb_build_object('paymentRefs', v);
    select count(*) into v from public.payments y where y.order_id = v_order and y.status = 'failed';
    out := out || jsonb_build_object('failedOrder', v);
  end if;
  -- The shop's usual: the middle order value of the last 90 days.
  select percentile_cont(0.5) within group (order by o.total), count(*) into m, k
    from public.orders o
   where o.created_at > now() - interval '90 days' and o.total > 0 and coalesce(o.status, '') <> 'cancelled';
  out := out || jsonb_build_object('usualTotal', m, 'usualOf', k);
  return out;
end
$rf$;

-- A refund's own facts: how soon after the payment, and how many refunds the
-- same person in the team asked for today.
create or replace function public.risk_refund_facts(p_refund uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $rr$
declare r record; v bigint; v_paid timestamptz;
begin
  if to_regclass('public.refunds') is null then return '{}'::jsonb; end if;
  execute 'select * from public.refunds where id = $1' into r using p_refund;
  if r.id is null then return '{}'::jsonb; end if;
  select coalesce(y.confirmed_at, y.updated_at) into v_paid from public.payments y
   where (r.payment_id is not null and y.id = r.payment_id) or (r.payment_id is null and y.tx_ref = r.tx_ref) limit 1;
  execute 'select count(*) from public.refunds where by_name = $1 and requested_at > now() - interval ''1 day''' into v using r.by_name;
  return jsonb_build_object('hoursSincePaid', case when v_paid is null then null
                                                   else round(extract(epoch from (r.requested_at - v_paid)) / 3600.0, 2) end,
                            'refundsByStaffToday', v, 'amount', r.amount, 'orderId', r.order_id, 'orderRef', r.order_ref,
                            'whole', r.whole);
end
$rr$;

-- The team's own activity in the record: per person, since then.
create or replace function public.risk_staff_facts(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $rs$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select c.actor::text as actor,
           count(*) filter (where c.action = 'delete') as deletes,
           count(*) filter (where c.tbl = 'admins') as roles,
           count(*) filter (where c.tbl in ('site_settings', 'site_settings_private')) as settings,
           count(*) as changes
      from public.audit_chain c
     where c.at > p_since and c.via = 'staff' and c.actor is not null
     group by c.actor) x;
$rs$;


-- 6) THE REVIEW QUEUE ------------------------------------------------------------
-- Approve, Reject or Escalate a case (Admin > Fraud & Risk). Nothing here
-- moves money or marks anything paid. Approving a payment the check held
-- lets it through: the website then asks the gateway about it once more, as
-- for any payment, and marks it paid on the gateway's word, with the
-- customer's confirmation email (risk-release, and the fifteen-minute
-- check-up). Approving a refund the check held lets the platform ask for it
-- again. Rejecting leaves it held, for the shop to refund from the gateway's
-- account. Escalating leaves it held, and the owner is emailed.
create or replace function public.risk_decide(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rd$
declare
  c      public.risk_cases;
  v_d    text := lower(btrim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
  v_state text;
begin
  if not public.may_risk() then
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  if v_d not in ('approve', 'reject', 'escalate') then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  select * into c from public.risk_cases where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  if c.review_state in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'why', 'answered', 'state', c.review_state);
  end if;
  if v_d = 'reject' and v_note is null then
    return jsonb_build_object('ok', false, 'why', 'say_why');
  end if;
  v_state := case v_d when 'approve' then 'approved' when 'reject' then 'rejected' else 'escalated' end;
  update public.risk_cases
     set review_state = v_state, review_note = coalesce(v_note, review_note), reviewed_by = auth.uid(), reviewed_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'state', v_state,
                            'release', v_d = 'approve' and c.moment = 'payment_paid' and c.action = 'held');
end
$rd$;

-- What Admin > Fraud & Risk shows, for the last p_days days.
create or replace function public.risk_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $rsu$
declare
  v_days  integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  out jsonb;
  v_ref jsonb;
  v_mode text;
begin
  if not public.may_risk() then
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  -- The mode as Settings > Fraud & Risk has it (watch until it is changed).
  if to_regclass('public.site_settings_private') is not null then
    execute 'select data ->> ''mode'' from public.site_settings_private where key = ''risk''' into v_mode;
  end if;
  select jsonb_build_object(
    'ok', true,
    'days', v_days,
    'assessed', (select count(*) from public.risk_cases where at > v_since),
    'levels', (select jsonb_build_object(
                 'low', count(*) filter (where level = 'low'), 'medium', count(*) filter (where level = 'medium'),
                 'high', count(*) filter (where level = 'high'), 'critical', count(*) filter (where level = 'critical'))
               from public.risk_cases where at > v_since),
    'held', (select count(*) from public.risk_cases where at > v_since and action = 'held'),
    'refused', (select count(*) from public.risk_cases where at > v_since and action = 'refused'),
    'released', (select count(*) from public.risk_cases where at > v_since and released_at is not null),
    'wouldHold', (select count(*) from public.risk_cases where at > v_since and mode = 'watch' and would = 'held'),
    'wouldRefuse', (select count(*) from public.risk_cases where at > v_since and mode = 'watch' and would = 'refused'),
    'open', (select count(*) from public.risk_cases where review_state in ('open', 'escalated')),
    'failedPayments', (select count(*) from public.payments where created_at > v_since and status = 'failed'),
    'duplicateAttempts', (select count(*) from (select order_id from public.payments
                                                 where created_at > v_since and order_id is not null
                                                 group by order_id having count(*) > 1) d),
    'paidTwice', (select count(*) from public.payments where created_at > v_since and status = 'review'
                                                   and (detail ->> 'duplicate') = 'true'),
    'histogram', (select jsonb_agg(coalesce(h.n, 0) order by b.b) from generate_series(0, 9) b(b)
                    left join (select least(score / 10, 9) as b, count(*) as n from public.risk_cases
                                where at > v_since group by 1) h on h.b = b.b),
    'trend', (select jsonb_agg(jsonb_build_object('day', d.day, 'low', coalesce(t.low, 0), 'medium', coalesce(t.medium, 0),
                                                  'high', coalesce(t.high, 0), 'critical', coalesce(t.critical, 0)) order by d.day)
                from (select generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day')::date as day) d
                left join (select date_trunc('day', at)::date as day,
                                  count(*) filter (where level = 'low') as low, count(*) filter (where level = 'medium') as medium,
                                  count(*) filter (where level = 'high') as high, count(*) filter (where level = 'critical') as critical
                             from public.risk_cases where at > v_since group by 1) t on t.day = d.day),
    'record', (select jsonb_build_object('entries', count(*), 'lastAt', max(at)) from public.audit_chain),
    'watchSince', (select min(at) from public.risk_cases where mode = 'watch')
  ) into out;
  -- The refunds asked for (supabase-online-refund.sql), when that file is there.
  if to_regclass('public.refunds') is not null then
    execute 'select jsonb_build_object(''count'', count(*), ''amount'', coalesce(sum(amount), 0))
               from public.refunds where requested_at > $1 and state not in (''refused'', ''failed'')'
      into v_ref using v_since;
  end if;
  return out || jsonb_build_object('refunds', v_ref,
                                   'mode', case when v_mode in ('off', 'watch', 'act') then v_mode else 'watch' end);
end
$rsu$;


-- 7) TWO-FACTOR FOR THE FRAUD & RISK RIGHT --------------------------------------
-- As supabase-hardening.sql has it, with one right more. Only when that file
-- has been run (the function is its own).
do $tf$
begin
  if to_regprocedure('public.two_factor_required()') is not null then
    execute $f$
      create or replace function public.two_factor_required()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $$
        select coalesce((
          select a.role = 'owner'
              or (r.data -> a.role -> 'permissions' ->> 'settings')    = 'true'
              or (r.data -> a.role -> 'permissions' ->> 'orders')      = 'true'
              or (r.data -> a.role -> 'permissions' ->> 'subscribers') = 'true'
              or (r.data -> a.role -> 'permissions' ->> 'risk')        = 'true'
            from public.admins a
            left join public.site_settings r on r.key = 'roles'
           where a.id = auth.uid()), false);
      $$ $f$;
  end if;
end
$tf$;


-- 8) WHO MAY CALL WHAT --------------------------------------------------------------
revoke all on function public.audit_seal(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.audit_frozen() from public, anon, authenticated;
revoke all on function public.audit_changes(jsonb, jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.audit_anchor() from public, anon, authenticated;
revoke all on function public.risk_facts(jsonb) from public, anon, authenticated;
revoke all on function public.risk_refund_facts(uuid) from public, anon, authenticated;
revoke all on function public.risk_staff_facts(timestamptz) from public, anon, authenticated;
grant execute on function public.audit_anchor() to service_role;
grant execute on function public.risk_facts(jsonb) to service_role;
grant execute on function public.risk_refund_facts(uuid) to service_role;
grant execute on function public.risk_staff_facts(timestamptz) to service_role;
revoke all on function public.audit_verify(integer) from public, anon;
revoke all on function public.risk_decide(uuid, text, text) from public, anon;
revoke all on function public.risk_summary(integer) from public, anon;
revoke all on function public.may_risk() from public, anon;
grant execute on function public.audit_verify(integer) to authenticated, service_role;
grant execute on function public.risk_decide(uuid, text, text) to authenticated;
grant execute on function public.risk_summary(integer) to authenticated;
grant execute on function public.may_risk() to authenticated, service_role;

notify pgrst, 'reload schema';


-- 9) CHECK -------------------------------------------------------------------------
-- One row:
--   risk     OK · the fraud check can record
--   record   OK · the record is sealed
select case when to_regclass('public.risk_cases') is not null
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'orders' and column_name = 'risk_level')
             and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('risk_facts', 'risk_decide', 'risk_summary', 'risk_refund_facts',
                                                                 'risk_staff_facts', 'may_risk')) = 6
            then 'OK · the fraud check can record' else 'NOT DONE' end as risk,
       case when to_regclass('public.audit_chain') is not null
             and (select count(*) from pg_trigger where tgname like 'zz_audit_%') >= 6
             and exists (select 1 from pg_trigger where tgname = 'audit_chain_frozen')
            then 'OK · the record is sealed' else 'NOT DONE' end as record;


-- =================================================================================
-- THE UNDO
--
-- Takes the check and the record away. Orders keep their risk_level column
-- (empty is harmless). The record itself can only be removed by the
-- database's owner, by taking its protection off first:
--
--   do $u$ declare t text; begin
--     foreach t in array array['orders','payments','refunds','admins','site_settings','site_settings_private','risk_cases'] loop
--       if to_regclass('public.' || t) is not null then
--         execute format('drop trigger if exists %I on public.%I', 'zz_audit_' || t, t);
--       end if;
--     end loop; end $u$;
--   drop function if exists public.risk_decide(uuid, text, text);
--   drop function if exists public.risk_summary(integer);
--   drop function if exists public.risk_facts(jsonb);
--   drop function if exists public.risk_refund_facts(uuid);
--   drop function if exists public.risk_staff_facts(timestamptz);
--   drop table if exists public.risk_cases;
--   (and, to remove the record too: drop the four audit_* triggers, then
--    drop table public.audit_anchors, public.audit_chain)
-- =================================================================================
