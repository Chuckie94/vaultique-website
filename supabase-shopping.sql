-- =====================================================================
-- Vaultique Boutique Point: SHOPPING (website build 90)
-- Run once in this WEBSITE's Supabase SQL Editor. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- Safe to run again. It changes no order, payment, review, policy,
-- setting or key. Run in the wrong project, it stops at step 1 and
-- creates nothing.
--
-- WHAT IT IS FOR (the customer portal's shopping build)
--
--   Reviews from buyers     a signed-in customer who bought a piece can
--                           review it, and the review says so ("Verified
--                           buyer"). Settings > Reviews decides whether
--                           anyone else may review a piece; until it is
--                           saved, only buyers may.
--   Questions and answers   the shop's answers to customers' questions,
--                           published on the piece's page. The questions
--                           themselves come in the live chat.
--   Product alerts          "Email me when it's back" and "Email me if the
--                           price drops", for a signed-in customer; the
--                           website's product-alerts job sends each one,
--                           once.
--   Gift lists              a customer shares their wishlist as a link;
--                           whoever has the link sees the pieces and their
--                           first name, nothing else, until they stop it.
--   Shopping preferences    sizes and categories, kept on the account.
--   The policies' order     Admin > Policies numbers them 1, 2, 3 ... and
--                           writes the whole order in one step.
--
-- WHAT IT CHANGES
--
--   * New tables: product_alerts, product_questions, gift_lists,
--     review_owners (which review is whose, never shown to anyone).
--   * customers: one new column, preferences.
--   * reviews: the rule for a review sent straight from a browser gains
--     one condition: a review of a piece only when Settings > Reviews
--     lets anyone review. A buyer's review goes through
--     review_by_buyer(), which checks the purchase itself.
--   * New functions, each checking who is asking.
-- =====================================================================


-- 1) THE RIGHT DATABASE? -------------------------------------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.order_items') is null
     or to_regclass('public.customers') is null or to_regclass('public.reviews') is null
     or to_regclass('public.policies') is null or to_regclass('public.site_settings') is null then
    raise exception 'This is not the website''s database (no orders, customers, reviews or policies here). Nothing was created.';
  end if;
end
$guard$;


-- 2) THE POLICIES' ORDER ----------------------------------------------------------
-- Admin > Policies sends the whole list, in order; each is numbered 10, 20,
-- 30 ... in one statement, so the order is never half written. Only for a
-- sign-in that may change policies, and only with every policy named once:
-- a list someone else changed meanwhile is refused (stale), never guessed.
create or replace function public.policies_set_order(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $po$
declare
  v_ok      boolean;
  v_have    integer;
  v_given   integer;
  v_changed integer;
begin
  if to_regprocedure('public.may(text)') is not null then
    execute 'select public.may(''policies'')' into v_ok;
  else
    v_ok := public.is_admin();
  end if;
  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'why', 'not_allowed');
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', false, 'why', 'empty');
  end if;
  select count(*) into v_have from public.policies;
  select count(distinct x) into v_given from unnest(p_ids) as t(x) where x is not null;
  if v_given <> cardinality(p_ids) or v_given <> v_have
     or exists (select 1 from unnest(p_ids) as t(x) where not exists (select 1 from public.policies p where p.id = t.x)) then
    return jsonb_build_object('ok', false, 'why', 'stale');
  end if;
  with o as (select t.x as id, t.n from unnest(p_ids) with ordinality as t(x, n)),
       u as (update public.policies p set sort = (o.n * 10)::integer
               from o where p.id = o.id and p.sort is distinct from (o.n * 10)::integer
             returning 1)
  select count(*) into v_changed from u;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end
$po$;


-- 3) REVIEWS FROM BUYERS ------------------------------------------------------------
-- Which review is whose. Never shown to anyone: the reviews table is read
-- by every visitor, so who wrote a review is kept here instead.
create table if not exists public.review_owners (
  review_id   uuid primary key references public.reviews(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sku         text not null,
  created_at  timestamptz not null default now(),
  unique (customer_id, sku)
);
alter table public.review_owners enable row level security;
revoke all on public.review_owners from public, anon, authenticated;

-- Settings > Reviews, "Who can review a piece": 'buyers' (the default) or
-- 'anyone'. Asked by the rule below while a visitor writes, so visitors
-- may call it (the hardening's list keeps it so).
create or replace function public.reviews_open_to_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $ro$
  select coalesce((select s.data ->> 'whoReviews' from public.site_settings s where s.key = 'reviews'), 'buyers') = 'anyone';
$ro$;

-- The rule for a review sent straight from a browser, as supabase-fixes.sql
-- left it, with one condition more: a review of a piece (sku given) only
-- while anyone may review. A review of the whole shop is as before.
drop policy if exists rv_insert on public.reviews;
create policy rv_insert on public.reviews for insert with check (
  rating between 1 and 5
  and char_length(name) between 1 and 60
  and (comment is null or char_length(comment) <= 1000)
  and (approved = false or public.review_auto_publish(rating))
  and verified is not true
  and (created_at is null or created_at <= now())
  and (sku is null or public.reviews_open_to_all())
);

-- What counts as having bought a piece: one of the customer's own orders
-- with it, not cancelled, not refunded in full, and rung up at the till or
-- sent or delivered or completed.
create or replace function public.shop_bought(p_customer uuid, p_sku text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $sb$
  select exists (
    select 1
      from public.orders o
      join public.order_items i on i.order_id = o.id
     where o.customer_id = p_customer
       and i.sku = p_sku
       and coalesce(o.status, 'pending') <> 'cancelled'
       and coalesce(to_jsonb(o) ->> 'refund_state', '') <> 'full'
       and (to_jsonb(o) ->> 'pos_sale_id' is not null
            or coalesce(o.status, 'pending') in ('dispatched', 'delivered', 'completed')));
$sb$;

-- May this customer review this piece? signin, not_bought, already, or can.
create or replace function public.review_can(p_sku text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $rc$
declare
  v_sku text := btrim(left(coalesce(p_sku, ''), 60));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', true, 'can', false, 'why', 'signin');
  end if;
  if v_sku = '' then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  if exists (select 1 from public.review_owners r where r.customer_id = auth.uid() and r.sku = v_sku) then
    return jsonb_build_object('ok', true, 'can', false, 'why', 'already');
  end if;
  if not public.shop_bought(auth.uid(), v_sku) then
    return jsonb_build_object('ok', true, 'can', false, 'why', 'not_bought');
  end if;
  return jsonb_build_object('ok', true, 'can', true);
end
$rc$;

-- A buyer's review: checked here, marked verified, one for each piece.
-- Published at once or kept to be read, by the shop's own rule
-- (review_auto_publish, Settings > Reviews), exactly as any review.
create or replace function public.review_by_buyer(p_sku text, p_rating integer, p_comment text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $rb$
declare
  v_sku     text := btrim(left(coalesce(p_sku, ''), 60));
  v_comment text := nullif(btrim(regexp_replace(coalesce(p_comment, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  v_name    text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g'));
  v_live    boolean;
  v_id      uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  if v_sku = '' or p_rating is null or p_rating not between 1 and 5 then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    return jsonb_build_object('ok', false, 'why', 'too_long');
  end if;
  if v_name = '' then
    select split_part(btrim(coalesce(c.name, '')), ' ', 1) into v_name from public.customers c where c.id = auth.uid();
    v_name := coalesce(nullif(btrim(v_name), ''), 'A customer');
  end if;
  v_name := left(v_name, 60);
  if exists (select 1 from public.review_owners r where r.customer_id = auth.uid() and r.sku = v_sku) then
    return jsonb_build_object('ok', false, 'why', 'already');
  end if;
  if not public.shop_bought(auth.uid(), v_sku) then
    return jsonb_build_object('ok', false, 'why', 'not_bought');
  end if;
  if not exists (select 1 from public.customers c where c.id = auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  v_live := coalesce(public.review_auto_publish(p_rating), false);
  insert into public.reviews (sku, name, rating, comment, verified, approved)
  values (v_sku, v_name, p_rating, v_comment, true, v_live)
  returning id into v_id;
  insert into public.review_owners (review_id, customer_id, sku) values (v_id, auth.uid(), v_sku);
  return jsonb_build_object('ok', true, 'id', v_id, 'published', v_live, 'name', v_name);
end
$rb$;


-- 4) QUESTIONS AND ANSWERS ---------------------------------------------------------
-- Customers ask in the live chat; the shop publishes the answers worth
-- keeping on the piece's page (Admin > Reviews, Questions & answers).
create table if not exists public.product_questions (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null,
  question   text not null,
  answer     text not null,
  published  boolean not null default true,
  sort       integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $c$ begin
  alter table public.product_questions add constraint product_questions_sizes
    check (char_length(btrim(sku)) between 1 and 60 and char_length(btrim(question)) between 3 and 500
           and char_length(btrim(answer)) between 1 and 2000);
exception when duplicate_object then null; end $c$;
create index if not exists product_questions_sku on public.product_questions (sku);
alter table public.product_questions enable row level security;
drop policy if exists pq_read on public.product_questions;
drop policy if exists pq_admin on public.product_questions;
create policy pq_read on public.product_questions for select using (published = true);
do $p$ begin
  if to_regprocedure('public.may(text)') is not null then
    execute $q$create policy pq_admin on public.product_questions for all
                 using ((select public.may('reviews'))) with check ((select public.may('reviews')))$q$;
  else
    execute $q$create policy pq_admin on public.product_questions for all
                 using (public.is_admin()) with check (public.is_admin())$q$;
  end if;
end $p$;


-- 5) PRODUCT ALERTS ----------------------------------------------------------------
-- One row for each piece a customer asked to hear about: 'back' (in stock
-- again) or 'price' (cheaper than when they asked). The product-alerts job
-- sends each once (sent_at), with the service key; a customer sees and
-- stops their own.
create table if not exists public.product_alerts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  email       text not null,
  sku         text not null,
  kind        text not null,
  name        text,
  price_at    numeric(12,2),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_price  numeric(12,2),
  unique (customer_id, sku, kind)
);
do $c$ begin
  alter table public.product_alerts add constraint product_alerts_shape
    check (kind in ('back', 'price') and char_length(sku) between 1 and 60
           and (name is null or char_length(name) <= 160) and char_length(email) between 3 and 320
           and (price_at is null or price_at between 0 and 100000000));
exception when duplicate_object then null; end $c$;
create index if not exists product_alerts_waiting on public.product_alerts (sent_at, sku);
alter table public.product_alerts enable row level security;
drop policy if exists pa_own_read on public.product_alerts;
drop policy if exists pa_own_stop on public.product_alerts;
create policy pa_own_read on public.product_alerts for select using (customer_id = auth.uid());
create policy pa_own_stop on public.product_alerts for delete using (customer_id = auth.uid());
revoke insert, update on public.product_alerts from anon, authenticated;

-- Asked from the piece's page. The address is the account's own, never one
-- typed. Asked again after it was sent: waiting again, from now.
create or replace function public.alert_set(p_sku text, p_kind text, p_name text, p_price numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $as$
declare
  v_sku   text := btrim(left(coalesce(p_sku, ''), 60));
  v_kind  text := lower(btrim(coalesce(p_kind, '')));
  v_name  text := nullif(btrim(regexp_replace(left(coalesce(p_name, ''), 160), '[[:space:][:cntrl:]]+', ' ', 'g')), '');
  v_email text;
  v_id    uuid;
  v_n     integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  if v_sku = '' or v_kind not in ('back', 'price') then
    return jsonb_build_object('ok', false, 'why', 'unreadable');
  end if;
  if v_kind = 'price' and (p_price is null or p_price <= 0 or p_price > 100000000) then
    return jsonb_build_object('ok', false, 'why', 'no_price');
  end if;
  if not exists (select 1 from public.customers c where c.id = auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or position('@' in v_email) < 2 then
    return jsonb_build_object('ok', false, 'why', 'no_email');
  end if;
  -- Thirty an hour for each customer (supabase-hardening.sql's counter).
  if to_regprocedure('public.throttle(text,text,integer,interval)') is not null then
    begin
      execute 'select public.throttle($1, $2, 30, interval ''1 hour'')' using 'product_alerts', auth.uid()::text;
    exception when others then
      return jsonb_build_object('ok', false, 'why', 'busy');
    end;
  end if;
  select count(*) into v_n from public.product_alerts a
   where a.customer_id = auth.uid() and a.sent_at is null and not (a.sku = v_sku and a.kind = v_kind);
  if v_n >= 60 then
    return jsonb_build_object('ok', false, 'why', 'too_many');
  end if;
  insert into public.product_alerts as a (customer_id, email, sku, kind, name, price_at)
  values (auth.uid(), v_email, v_sku, v_kind, v_name,
          case when v_kind = 'price' then round(p_price, 2) end)
  on conflict (customer_id, sku, kind) do update
     set email = excluded.email, name = coalesce(excluded.name, a.name),
         price_at = excluded.price_at, created_at = now(), sent_at = null, sent_price = null
  returning a.id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind);
end
$as$;


-- 6) GIFT LISTS ----------------------------------------------------------------------
-- A customer's wishlist (customers.wishlist), shared as a link. The link
-- carries a long random key; whoever has it sees the pieces, the list's
-- title and note, and the customer's first name. Stopping it deletes the
-- key, and the old link shows nothing.
create table if not exists public.gift_lists (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  token       text not null unique,
  title       text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
do $c$ begin
  alter table public.gift_lists add constraint gift_lists_shape
    check (token ~ '^[A-Za-z0-9_-]{24,64}$' and (title is null or char_length(title) <= 80)
           and (note is null or char_length(note) <= 300));
exception when duplicate_object then null; end $c$;
alter table public.gift_lists enable row level security;
drop policy if exists gl_own_read on public.gift_lists;
create policy gl_own_read on public.gift_lists for select using (customer_id = auth.uid());
revoke insert, update, delete on public.gift_lists from anon, authenticated;

create or replace function public.gift_list_share(p_title text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $gs$
declare
  v_title text := nullif(btrim(regexp_replace(left(coalesce(p_title, ''), 80), '[[:space:][:cntrl:]]+', ' ', 'g')), '');
  v_note  text := nullif(btrim(regexp_replace(left(coalesce(p_note, ''), 300), '[[:cntrl:]]+', ' ', 'g')), '');
  v_tok   text;
  g       public.gift_lists;
begin
  if auth.uid() is null or not exists (select 1 from public.customers c where c.id = auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  select * into g from public.gift_lists where customer_id = auth.uid();
  if found then
    update public.gift_lists set title = v_title, note = v_note, updated_at = now() where customer_id = auth.uid();
    return jsonb_build_object('ok', true, 'token', g.token, 'title', v_title, 'note', v_note, 'again', true);
  end if;
  -- Two random UUIDs (built into Postgres 13 and later, so nothing depends
  -- on where an extension is installed): 64 characters, 244 random bits.
  v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.gift_lists (customer_id, token, title, note) values (auth.uid(), v_tok, v_title, v_note);
  return jsonb_build_object('ok', true, 'token', v_tok, 'title', v_title, 'note', v_note, 'again', false);
end
$gs$;

create or replace function public.gift_list_stop()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $gx$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'signin');
  end if;
  delete from public.gift_lists where customer_id = auth.uid();
  return jsonb_build_object('ok', true);
end
$gx$;

-- The link, opened by anyone who has it. The first name only, and the
-- pieces; never the email, the phone or the last name.
create or replace function public.gift_list_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $gg$
declare
  v_tok text := btrim(coalesce(p_token, ''));
  g     public.gift_lists;
  c     public.customers;
begin
  if v_tok !~ '^[A-Za-z0-9_-]{24,64}$' then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  select * into g from public.gift_lists where token = v_tok;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  select * into c from public.customers where id = g.customer_id;
  return jsonb_build_object(
    'ok', true,
    'title', g.title,
    'note', g.note,
    'firstName', nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
    'skus', case when jsonb_typeof(c.wishlist) = 'array' then c.wishlist else '[]'::jsonb end,
    'updatedAt', greatest(g.updated_at, c.updated_at));
end
$gg$;


-- 7) SHOPPING PREFERENCES ---------------------------------------------------------
-- { "sizes": [...], "categories": [...] }, written by the customer on their
-- own row (the existing rule, cu_own), held to a small object here.
alter table public.customers add column if not exists preferences jsonb;
do $c$ begin
  alter table public.customers add constraint customers_preferences_shape
    check (preferences is null or (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 2000));
exception when duplicate_object then null; end $c$;


-- 8) WHO MAY CALL WHAT --------------------------------------------------------------
revoke all on function public.policies_set_order(uuid[]) from public, anon;
grant execute on function public.policies_set_order(uuid[]) to authenticated;
revoke all on function public.shop_bought(uuid, text) from public, anon, authenticated;
revoke all on function public.review_can(text) from public, anon;
grant execute on function public.review_can(text) to authenticated;
revoke all on function public.review_by_buyer(text, integer, text, text) from public, anon;
grant execute on function public.review_by_buyer(text, integer, text, text) to authenticated;
grant execute on function public.reviews_open_to_all() to anon, authenticated;
revoke all on function public.alert_set(text, text, text, numeric) from public, anon;
grant execute on function public.alert_set(text, text, text, numeric) to authenticated;
revoke all on function public.gift_list_share(text, text) from public, anon;
revoke all on function public.gift_list_stop() from public, anon;
grant execute on function public.gift_list_share(text, text) to authenticated;
grant execute on function public.gift_list_stop() to authenticated;
grant execute on function public.gift_list_get(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- 9) CHECK -------------------------------------------------------------------------
-- One row:
--   shopping   OK · shopping can be recorded
--   doors      OK
select case when to_regclass('public.product_alerts') is not null and to_regclass('public.product_questions') is not null
             and to_regclass('public.gift_lists') is not null and to_regclass('public.review_owners') is not null
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'customers' and column_name = 'preferences')
            then 'OK · shopping can be recorded' else 'NOT DONE' end as shopping,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('policies_set_order', 'reviews_open_to_all', 'shop_bought', 'review_can',
                                       'review_by_buyer', 'alert_set', 'gift_list_share', 'gift_list_stop',
                                       'gift_list_get')) = 9
            then 'OK' else 'NOT DONE' end as doors;


-- =================================================================================
-- THE UNDO
--
-- Takes the new tables and functions away, and puts the review rule back
-- as supabase-fixes.sql left it. Reviews already written stay, marked as
-- they are.
--
--   drop policy if exists rv_insert on public.reviews;
--   create policy rv_insert on public.reviews for insert with check (
--     rating between 1 and 5 and char_length(name) between 1 and 60
--     and (comment is null or char_length(comment) <= 1000)
--     and (approved = false or public.review_auto_publish(rating))
--     and verified is not true and (created_at is null or created_at <= now()));
--   drop function if exists public.review_by_buyer(text, integer, text, text);
--   drop function if exists public.review_can(text);
--   drop function if exists public.shop_bought(uuid, text);
--   drop function if exists public.reviews_open_to_all();
--   drop function if exists public.alert_set(text, text, text, numeric);
--   drop function if exists public.gift_list_share(text, text);
--   drop function if exists public.gift_list_stop();
--   drop function if exists public.gift_list_get(text);
--   drop function if exists public.policies_set_order(uuid[]);
--   drop table if exists public.review_owners;
--   drop table if exists public.product_alerts;
--   drop table if exists public.product_questions;
--   drop table if exists public.gift_lists;
--   alter table public.customers drop constraint if exists customers_preferences_shape;
--   alter table public.customers drop column if exists preferences;
-- =================================================================================
