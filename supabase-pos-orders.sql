-- =====================================================================
-- Vaultique Boutique Point: WEBSITE ORDERS AT THE TILL (website build 76,
-- platform build 508)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. If it is run in the wrong project it stops at step 1
-- and creates nothing.
--
-- WHAT IT IS FOR
--
-- The platform's till rings up a website order by its number (VB-3F9K2).
-- To do that it asks this database, through a locked door, five things
-- and nothing else:
--
--   vbp_pos_orders          the orders, newest first, or the ones a search
--                           finds (order number, name or phone)
--   vbp_pos_order           one order, with its pieces
--   vbp_pos_order_claim     "this till is ringing it up": refused when the
--                           order is cancelled, completed, still waiting
--                           for its online payment, already rung up, or
--                           being rung up on another till. Delivered is a
--                           step of the delivery, not a sale, so a
--                           delivered order can still be rung up.
--   vbp_pos_order_release   the till stopped without ringing it up
--   vbp_pos_order_complete  the sale is done: the order says Completed (or,
--                           build 78, Preparing when its goods are still to
--                           be sent or collected),
--                           with the receipt the customer can download
--
-- WHO MAY ASK
--
-- Only somebody holding the door's own key. This SQL makes it the first
-- time it runs and shows it ONCE, in its last result. It goes into the
-- PLATFORM's Netlify as VBP_WEB_ORDERS_KEY. This database keeps only its
-- fingerprint, so the key cannot be read back out of it by anybody. A
-- stranger without it gets "refused" and nothing else.
--
-- AND EVEN WITH THE KEY, ONLY SO MUCH. It counts what it is asked:
--   reading     at most 2,000 an hour
--   claiming and completing   at most 600 an hour
-- Past that it answers "busy" for the rest of the hour.
--
-- WHAT IT HANDS OUT
--
-- For each order: its number, date, status, the name, phone, email,
-- address and notes the customer gave, delivery or collection, the
-- total, how it is paid (paid online or not, and the payment's
-- reference; paid online counts only when the payment service's own
-- record of the payment says paid), its pieces (code, name, price,
-- quantity), whether it was
-- placed from an account and that account's customer number, points
-- promised on it, whether it was placed before this door was set up
-- (so it may have been rung up the old way), and what the till has done
-- with it. Nothing else of
-- this website: no other table, no setting, no key.
--
-- WHAT IT CHANGES
--
--   * orders: nine columns for online payment, the same ones
--     supabase-payments.sql adds (nothing happens if they are there
--     already), and eight for the till: who is ringing it up, and the
--     sale's receipt once it is done.
--   * Only this door may write the till's columns. Not a customer, not
--     the anon key, not an admin login: a receipt that anybody signed in
--     could write would mean nothing.
--   * Two small tables of its own, locked to everybody: the key's
--     fingerprint, and the count of questions behind the limits (kept a
--     day).
--   * Points promised on an order (rewards_holds) are settled when the
--     order is completed: rung up if the till took them, let go if not.
--
-- WhatsApp ordering, online payment and the Orders tab work exactly as
-- before.
-- =====================================================================


-- 1) THE RIGHT DATABASE? ---------------------------------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.order_items') is null then
    raise exception 'This is not the website''s database: there is no orders table here. Run supabase-setup.sql first, in the website''s Supabase. Nothing was created.';
  end if;
end
$guard$;


-- 2) WHAT AN ORDER CARRIES ---------------------------------------------------
-- Online payment: exactly as supabase-payments.sql adds them, so the door
-- reads the same whether or not online payment has been set up.
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists payment_status text;
alter table public.orders add column if not exists pay_ref        text;
alter table public.orders add column if not exists pay_channel    text;
alter table public.orders add column if not exists goods_total    numeric;
alter table public.orders add column if not exists delivery_fee   numeric;
alter table public.orders add column if not exists tax_total      numeric;
alter table public.orders add column if not exists paid_amount    numeric;
alter table public.orders add column if not exists paid_at        timestamptz;

-- The till.
alter table public.orders add column if not exists pos_claim_id     text;          -- the till ringing it up now
alter table public.orders add column if not exists pos_claimed_by   text;          -- who, as the platform names them
alter table public.orders add column if not exists pos_claimed_at   timestamptz;
alter table public.orders add column if not exists pos_sale_id      text;          -- the platform's sale
alter table public.orders add column if not exists pos_receipt_no   text;
alter table public.orders add column if not exists pos_invoice_no   text;
alter table public.orders add column if not exists pos_receipt      jsonb;         -- what the receipt says, for the download
alter table public.orders add column if not exists pos_completed_at timestamptz;
create index if not exists or_pos_open on public.orders (created_at desc) where pos_sale_id is null;


-- 3) ONLY THE DOOR WRITES THE TILL'S COLUMNS ---------------------------------
-- Runs as whoever made the change. The door's functions run as their
-- owner; a customer, the anon key and an admin login are refused.
create or replace function public.orders_pos_guard()
returns trigger
language plpgsql
set search_path = ''
as $pg$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.pos_claim_id is not null or new.pos_claimed_by is not null or new.pos_claimed_at is not null
       or new.pos_sale_id is not null or new.pos_receipt_no is not null or new.pos_invoice_no is not null
       or new.pos_receipt is not null or new.pos_completed_at is not null then
      raise exception 'the till''s details are set by the platform only';
    end if;
  elsif new.pos_claim_id     is distinct from old.pos_claim_id
     or new.pos_claimed_by   is distinct from old.pos_claimed_by
     or new.pos_claimed_at   is distinct from old.pos_claimed_at
     or new.pos_sale_id      is distinct from old.pos_sale_id
     or new.pos_receipt_no   is distinct from old.pos_receipt_no
     or new.pos_invoice_no   is distinct from old.pos_invoice_no
     or new.pos_receipt      is distinct from old.pos_receipt
     or new.pos_completed_at is distinct from old.pos_completed_at then
    raise exception 'the till''s details are set by the platform only';
  end if;
  return new;
end;
$pg$;

drop trigger if exists orders_pos_guard_t on public.orders;
create trigger orders_pos_guard_t
  before insert or update on public.orders
  for each row execute function public.orders_pos_guard();


-- 4) THE DOOR'S OWN TWO TABLES, LOCKED TO EVERYBODY ---------------------------
create table if not exists public.pos_door_key (
  id          integer     primary key check (id = 1),
  fingerprint bytea       not null,
  made_at     timestamptz not null default now()
);
create table if not exists public.pos_door_calls (
  at    timestamptz not null default clock_timestamp(),
  kind  text        not null
);
create index if not exists pos_door_calls_kind_at on public.pos_door_calls (kind, at);

alter table public.pos_door_key   enable row level security;
alter table public.pos_door_calls enable row level security;
revoke all on table public.pos_door_key   from public, anon, authenticated, service_role;
revoke all on table public.pos_door_calls from public, anon, authenticated, service_role;


-- 5) IS THIS THE DOOR'S KEY? --------------------------------------------------
-- Compared by fingerprint. The key itself is not in the database.
create or replace function public.pos_door_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $ok$
  select coalesce(length(p_key), 0) >= 32
     and exists (select 1 from public.pos_door_key k
                  where k.id = 1
                    and k.fingerprint = sha256(convert_to(p_key, 'UTF8')));
$ok$;

-- One question counted. False when the hour's allowance is used up.
create or replace function public.pos_door_count(p_kind text, p_limit integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $cnt$
begin
  if (select count(*) from public.pos_door_calls q
       where q.kind = p_kind and q.at > clock_timestamp() - interval '1 hour') >= p_limit then
    return false;
  end if;
  insert into public.pos_door_calls (kind) values (p_kind);
  delete from public.pos_door_calls where at < clock_timestamp() - interval '1 day';
  return true;
end
$cnt$;


-- 6) PAID ONLINE, FOR CERTAIN -------------------------------------------------
-- An order counts as paid online only when the payment service's own record
-- of the payment says paid. Only the payment service writes that table
-- (supabase-payments.sql gives nobody else a way in), so a "paid" typed onto
-- an order by anybody else, or on a website where online payment was never
-- set up, never lets goods leave the shop unpaid.
--
-- BUILD 85 · AND PAID IN LIVE MODE. A payment made in Test mode moved no
-- money (Flutterwave's test cards and numbers), so it never counts as paid
-- at the till: the till's automatic ring-up leaves it alone, ringing it up
-- by hand is refused, and it is never prepared or sent. Until build 85 a
-- Test-mode payment counted, and the platform (since its build 509) rang a
-- paid order up by itself within two minutes: a sale that never happened.
-- The same in supabase-test-orders.sql, for a shop already running.
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

-- BUILD 85 · an order paid, or being paid, in Test mode: the shop trying
-- the website's payment. It is shown to the till as a test, and kept off
-- its list of orders to ring up; a search still finds it.
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


-- 7) ONE ORDER, AS THE DOOR HANDS IT OUT --------------------------------------
-- The list above, and nothing else. p_items: the pieces too.
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
begin
  select * into o from public.orders where id = p_id;
  if not found then
    return null;
  end if;

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
    'items', case when p_items then v_items else null end
  );
end
$out$;


-- 8) THE LIST ------------------------------------------------------------------
-- p_scope: 'open' (still to be rung up), 'done' (completed or cancelled),
-- anything else: all. A search looks at every order, whatever the scope:
-- the order number, the name, or (four figures or more) the phone.
-- Newest first, at most 100.
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


-- 9) ONE ORDER -----------------------------------------------------------------
create or replace function public.vbp_pos_order(p_key text, p_ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $one$
declare
  v_ref text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_id  uuid;
begin
  if not public.pos_door_key_ok(p_key) then
    return jsonb_build_object('door', 'vbp_pos_order', 'v', 1, 'ok', false, 'why', 'refused');
  end if;
  if v_ref !~ '^VB-[0-9A-Z]{3,10}$' then
    return jsonb_build_object('door', 'vbp_pos_order', 'v', 1, 'ok', true, 'found', false);
  end if;
  if not public.pos_door_count('read', 2000) then
    return jsonb_build_object('door', 'vbp_pos_order', 'v', 1, 'ok', false, 'why', 'busy');
  end if;
  select o.id into v_id from public.orders o where upper(o.ref) = v_ref;
  if v_id is null then
    return jsonb_build_object('door', 'vbp_pos_order', 'v', 1, 'ok', true, 'found', false);
  end if;
  return jsonb_build_object('door', 'vbp_pos_order', 'v', 1, 'ok', true, 'found', true,
                            'order', public.pos_order_out(v_id, true));
end
$one$;


-- 10) "THIS TILL IS RINGING IT UP" ----------------------------------------------
-- p_claim: the till's own reference for this attempt (8 to 64 letters,
-- figures or dashes). p_by: who, as the platform names them. A claim held
-- by another till is refused unless p_take_over, which the till asks for
-- only once somebody has confirmed that till is not ringing it up.
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


-- 11) THE TILL STOPPED WITHOUT RINGING IT UP ------------------------------------
-- Only that till's own claim, and only before the order is completed.
create or replace function public.vbp_pos_order_release(p_key text, p_ref text, p_claim text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rel$
declare
  v_ref   text := upper(btrim(left(coalesce(p_ref, ''), 20)));
  v_claim text := btrim(left(coalesce(p_claim, ''), 64));
  d       text := 'vbp_pos_order_release';
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
  update public.orders
     set pos_claim_id = null, pos_claimed_by = null, pos_claimed_at = null
   where upper(ref) = v_ref and pos_claim_id = v_claim and pos_sale_id is null;
  return jsonb_build_object('door', d, 'v', 1, 'ok', true, 'released', found);
end
$rel$;


-- 12) A RECEIPT, KEPT TO WHAT A RECEIPT SAYS -------------------------------------
-- The platform sends what its receipt printed. Only these parts are kept,
-- each cut to a sensible length; anything else sent is dropped.
create or replace function public.pos_text(v jsonb, n integer)
returns jsonb
language sql
immutable
set search_path = ''
as $t$
  select case when jsonb_typeof(v) in ('string', 'number') then to_jsonb(left(v #>> '{}', n)) else null end;
$t$;

create or replace function public.pos_num(v jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $n$
declare x numeric;
begin
  if jsonb_typeof(v) = 'number' then
    x := (v #>> '{}')::numeric;
  elsif jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]{1,9}([.][0-9]{1,4})?$' then
    x := (v #>> '{}')::numeric;
  else
    return null;
  end if;
  if x <= -100000000 or x >= 100000000 then
    return null;
  end if;
  return to_jsonb(trim_scale(round(x, 2)));   -- 1250, not 1250.00
end
$n$;

create or replace function public.pos_receipt_clean(r jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $rc$
declare
  shop  jsonb := '{}'::jsonb;
  lines jsonb := '[]'::jsonb;
  pays  jsonb := '[]'::jsonb;
  pts   jsonb := null;
begin
  if r is null or jsonb_typeof(r) <> 'object' then
    return null;
  end if;
  if jsonb_typeof(r -> 'shop') = 'object' then
    shop := jsonb_strip_nulls(jsonb_build_object(
      'name',    public.pos_text(r -> 'shop' -> 'name', 120),
      'slogan',  public.pos_text(r -> 'shop' -> 'slogan', 160),
      'address', public.pos_text(r -> 'shop' -> 'address', 240),
      'contact', public.pos_text(r -> 'shop' -> 'contact', 240),
      'taxId',   public.pos_text(r -> 'shop' -> 'taxId', 40),
      'regNo',   public.pos_text(r -> 'shop' -> 'regNo', 40)));
  end if;
  if jsonb_typeof(r -> 'lines') = 'array' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'sku',   public.pos_text(e.value -> 'sku', 60),
             'name',  public.pos_text(e.value -> 'name', 200),
             'qty',   public.pos_num(e.value -> 'qty'),
             'unit',  public.pos_num(e.value -> 'unit'),
             'total', public.pos_num(e.value -> 'total'))) order by e.i), '[]'::jsonb)
      into lines
      from jsonb_array_elements(r -> 'lines') with ordinality e(value, i)
     where e.i <= 200 and jsonb_typeof(e.value) = 'object';
  end if;
  if jsonb_typeof(r -> 'payments') = 'array' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'method', public.pos_text(e.value -> 'method', 40),
             'amount', public.pos_num(e.value -> 'amount'),
             'ref',    public.pos_text(e.value -> 'ref', 80))) order by e.i), '[]'::jsonb)
      into pays
      from jsonb_array_elements(r -> 'payments') with ordinality e(value, i)
     where e.i <= 12 and jsonb_typeof(e.value) = 'object';
  end if;
  if jsonb_typeof(r -> 'points') = 'object' then
    pts := jsonb_strip_nulls(jsonb_build_object(
      'points', public.pos_num(r -> 'points' -> 'points'),
      'value',  public.pos_num(r -> 'points' -> 'value')));
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'v', 1,
    'shop', shop,
    'receiptNo', public.pos_text(r -> 'receiptNo', 40),
    'invoiceNo', public.pos_text(r -> 'invoiceNo', 40),
    'txnId',     public.pos_text(r -> 'txnId', 60),
    'date',      public.pos_text(r -> 'date', 40),
    'cashier',   public.pos_text(r -> 'cashier', 80),
    'customer',  public.pos_text(r -> 'customer', 120),
    'currency',  public.pos_text(r -> 'currency', 8),
    'lines',     lines,
    'subtotalNet', public.pos_num(r -> 'subtotalNet'),
    'vatRate',   public.pos_num(r -> 'vatRate'),
    'vat',       public.pos_num(r -> 'vat'),
    'discount',  public.pos_num(r -> 'discount'),
    'delivery',  public.pos_num(r -> 'delivery'),
    'total',     public.pos_num(r -> 'total'),
    'points',    pts,
    'amountPaid', public.pos_num(r -> 'amountPaid'),
    'payments',  pays,
    'paidOnline', case when jsonb_typeof(r -> 'paidOnline') = 'boolean' then r -> 'paidOnline' else null end,
    'footer',    public.pos_text(r -> 'footer', 300)));
end
$rc$;


-- 13) THE SALE IS DONE ------------------------------------------------------------
-- p_sale: { saleId, receiptNo, invoiceNo, pointsUsed, handedOver, receipt: {...} }.
-- BUILD 78 · handedOver: true, the customer took the goods at the counter,
-- and the order says Completed; false, the goods are still to be sent or
-- collected, and the order says Preparing (status 'confirmed') and carries on
-- through supabase-order-progress.sql; not said at all (a platform from
-- before build 509), Completed, exactly as in build 76.
-- Done once. The same sale sent again (an answer that went missing on the
-- way back) is "done" again and changes nothing. A different sale for an
-- order already rung up is refused and named, so the platform can show the
-- second one for somebody to look at.
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


-- 14) WHO MAY USE THEM ----------------------------------------------------------
-- Anybody may knock, which is how the platform reaches the doors with this
-- website's public key; only the door's key opens them. The rest are parts
-- of the doors and nobody calls them from outside.
revoke all on function public.orders_pos_guard() from public, anon, authenticated;
revoke all on function public.pos_door_key_ok(text) from public, anon, authenticated;
revoke all on function public.pos_door_count(text, integer) from public, anon, authenticated;
revoke all on function public.pos_order_out(uuid, boolean) from public, anon, authenticated;
revoke all on function public.pos_paid_online(uuid) from public, anon, authenticated;
revoke all on function public.pos_test_payment(uuid) from public, anon, authenticated;
revoke all on function public.pos_text(jsonb, integer) from public, anon, authenticated;
revoke all on function public.pos_num(jsonb) from public, anon, authenticated;
revoke all on function public.pos_receipt_clean(jsonb) from public, anon, authenticated;
revoke all on function public.vbp_pos_orders(text, text, text) from public;
revoke all on function public.vbp_pos_order(text, text) from public;
revoke all on function public.vbp_pos_order_claim(text, text, text, text, boolean) from public;
revoke all on function public.vbp_pos_order_release(text, text, text) from public;
revoke all on function public.vbp_pos_order_complete(text, text, text, jsonb) from public;
grant execute on function public.vbp_pos_orders(text, text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order(text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_claim(text, text, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_release(text, text, text) to anon, authenticated, service_role;
grant execute on function public.vbp_pos_order_complete(text, text, text, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 15) THE DOOR'S KEY, MADE THE FIRST TIME -----------------------------------------
-- Made only if there is none yet, so running this again keeps the key the
-- platform already has. Shown once, in the result below.
do $make$
declare
  k text;
begin
  if not exists (select 1 from public.pos_door_key) then
    k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.pos_door_key (id, fingerprint) values (1, sha256(convert_to(k, 'UTF8')));
    perform set_config('vbp.pos_new_key', k, false);
  else
    perform set_config('vbp.pos_new_key', '', false);
  end if;
end
$make$;


-- 16) CHECK ------------------------------------------------------------------------
-- One row.
--   door_key_for_platform   the key, the first time: copy it into the
--                           PLATFORM's Netlify as VBP_WEB_ORDERS_KEY.
--                           Afterwards it says the key was made before.
--   orders_columns          OK
--   doors                   OK
--   guard                   OK
select coalesce(nullif(current_setting('vbp.pos_new_key', true), ''),
                'made before: use the one you saved') as door_key_for_platform,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'orders'
                     and column_name in ('payment_method', 'payment_status', 'pay_ref', 'pay_channel',
                                         'goods_total', 'delivery_fee', 'tax_total', 'paid_amount', 'paid_at',
                                         'pos_claim_id', 'pos_claimed_by', 'pos_claimed_at', 'pos_sale_id',
                                         'pos_receipt_no', 'pos_invoice_no', 'pos_receipt', 'pos_completed_at')) = 17
            then 'OK' else 'NOT DONE' end as orders_columns,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('vbp_pos_orders', 'vbp_pos_order', 'vbp_pos_order_claim',
                                       'vbp_pos_order_release', 'vbp_pos_order_complete')) = 5
            then 'OK' else 'NOT DONE' end as doors,
       case when exists (select 1 from pg_trigger where tgname = 'orders_pos_guard_t')
            then 'OK' else 'NOT DONE' end as guard;


-- =================================================================================
-- IF THE KEY IS EVER LOST, OR MAY HAVE BEEN SEEN BY SOMEBODY IT SHOULD NOT HAVE
--
-- Run this on its own. It makes a new key and shows it once; the old one stops
-- working at that moment. Put the new one into the PLATFORM's Netlify as
-- VBP_WEB_ORDERS_KEY.
--
--   with k as (select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as key),
--   made as (insert into public.pos_door_key (id, fingerprint)
--            select 1, sha256(convert_to(k.key, 'UTF8')) from k
--            on conflict (id) do update set fingerprint = excluded.fingerprint, made_at = now()
--            returning 1)
--   select k.key as new_door_key_for_platform from k, made;
-- =================================================================================

-- =================================================================================
-- THE UNDO
--
-- Takes the doors away. The platform's Online Orders then says the website
-- cannot be reached; nothing else on either side changes. Orders already
-- completed keep their receipts.
--
--   drop function if exists public.vbp_pos_orders(text, text, text);
--   drop function if exists public.vbp_pos_order(text, text);
--   drop function if exists public.vbp_pos_order_claim(text, text, text, text, boolean);
--   drop function if exists public.vbp_pos_order_release(text, text, text);
--   drop function if exists public.vbp_pos_order_complete(text, text, text, jsonb);
-- =================================================================================
