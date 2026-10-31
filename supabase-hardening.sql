-- =====================================================================
-- Vaultique Boutique Point — website database HARDENING (builds 76 to 78)
-- ---------------------------------------------------------------------
-- UPLOAD THE WEBSITE FIRST (build 78 or later), AND WAIT UNTIL NETLIFY
-- SAYS "PUBLISHED". The admin and the shop need their own new pages to
-- work with what this file changes. An admin page from before build 76
-- would take the database's new questions for a refusal and sign people
-- out.
--
-- Then run in THIS WEBSITE's Supabase (not the platform's):
--   SQL Editor > New query > paste all of this > Run
--
-- Safe to run again, as often as you like: it changes nothing that is
-- already as it should be, and the result is always a fresh report.
-- After it has run once, the older supabase-*.sql files refuse to run
-- again (see section 14), because each of them would quietly put back
-- something this file took away.
--
-- Build 77 added item 14 below and raised two shop-wide limits; build 78
-- adds item 15. A project that ran an earlier version runs this one too:
-- it is the same file, grown, and is safe to run over the old one.
--
-- WHAT IT DOES. Each line is a finding from the build 73 audit.
--    1. Two-factor is checked by the database, not only by the page,
--       and is REQUIRED for the owner and for every role that can open
--       Settings, Orders or Subscribers. (W-01, decision Q6)
--    2. "Switch off" really switches somebody off. (W-02)
--    3. A role's ticks are rules, not just which tabs show. (W-02, Q1)
--    4. Only the owner can change roles; only the owner can read or
--       repoint the chat-notification settings. (W-02, W-03)
--    5. Orders are written only by the website's own function, which
--       prices them from the catalogue; nobody can write one straight
--       into the table. (W-05, Q2)
--    6. Chats, reviews, the newsletter and orders are throttled. (W-11)
--    7. An order paid online records whether it was a TEST, and a test
--       payment is not counted as a sale. (W-04)
--    8. The preview key is no longer in the public settings. (W-16)
--    9. The shipped notification keys are retired. (W-03)
--   10. Somebody who unsubscribed can only rejoin from their own inbox.
--       (W-15)
--   11. Visitors can no longer call the database's internal functions,
--       and the daily clean-up can run. (W-08, W-09)
--   12. Every function's search path is pinned. (Security Advisor)
--   13. A record of what has been run, so old files cannot undo this.
--       (W-07)
--   14. The email password can be replaced but never read back, not
--       even by the owner: only the website's own functions read it.
--       (W-12, build 77)
--   15. A sale, on the Dashboard and in Analytics, is an order the shop
--       has confirmed or one paid online; orders still "Received" are
--       shown on their own. (W-05, W-21, decision Q4, build 78)
--
-- The report at the end says, line by line, what it found and what to
-- do. It never shows a key, a password or a bank detail.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Before anything changes
--
-- Two things this file depends on. If either is missing it stops here,
-- and because the SQL Editor runs a paste as one piece, nothing at all
-- will have changed.
-- ---------------------------------------------------------------------
do $$
begin
  -- Phase 10 gave every member of staff a role. Everything below reads it.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'admins'
                    and column_name = 'role') then
    raise exception 'Run supabase-chat-phase10.sql first: staff roles are not set up in this project yet. Nothing was changed.';
  end if;
  -- Two-factor lives in Supabase's own auth schema. If the database
  -- cannot read it, the rules below could not tell who has a code, and
  -- the safest thing is not to start.
  begin
    perform 1 from auth.mfa_factors limit 1;
  exception when others then
    raise exception 'This project does not let the database read two-factor (auth.mfa_factors): %. Nothing was changed. Send this message to whoever looks after the website.', sqlerrm;
  end;
end $$;


-- ---------------------------------------------------------------------
-- 1. Two-factor, and "Switch off" (W-01, W-02, Q6)
--
-- Supabase hands out a working sign-in (level aal1) the moment a
-- password is right. Only entering the code from the authenticator app
-- lifts it to aal2. Until now only the admin PAGE asked for the code:
-- somebody with a password could skip the page and use the sign-in on
-- the database directly, and the database never asked.
--
-- WHO MUST USE TWO-FACTOR. The owner, and anybody whose role can open
-- Settings (bank details, the email password), Orders (customers'
-- names, phones and addresses) or Subscribers (the mailing list). The
-- built-in Administrator role has all three. A role that only answers
-- chats is not forced, but if one of them sets it up anyway, it is
-- honoured: their password alone is no longer enough either.
--
-- Nobody is locked out by this. Build 76's admin page asks anybody who
-- must have it, and has not set it up, to do so at their next sign-in.
-- ---------------------------------------------------------------------
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
      from public.admins a
      left join public.site_settings r on r.key = 'roles'
     where a.id = auth.uid()), false);
$$;

create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not public.two_factor_required()
          and not exists (select 1 from auth.mfa_factors f
                           where f.user_id = auth.uid() and f.status = 'verified'));
$$;

-- The test every rule in the database asks. Now: on the staff list, not
-- switched off (an owner cannot be), and past two-factor where it applies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a
                  where a.id = auth.uid()
                    and (a.role = 'owner' or coalesce(a.active, true)))
     and public.mfa_ok();
$$;

create or replace function public.is_shop_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a
                  where a.id = auth.uid() and a.role = 'owner')
     and public.mfa_ok();
$$;

-- What the admin page asks first, before anything else can answer: who
-- is this, and what do they still owe? It answers at level aal1 on
-- purpose — that is exactly when the page needs to know whether to ask
-- for a code, offer to set one up, or say "switched off". It says
-- nothing about anybody but the person asking.
create or replace function public.admin_gate()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select json_build_object(
    'staff',    a.id is not null,
    'owner',    coalesce(a.role = 'owner', false),
    'active',   a.id is not null and (a.role = 'owner' or coalesce(a.active, true)),
    'required', public.two_factor_required(),
    'enrolled', exists (select 1 from auth.mfa_factors f
                         where f.user_id = auth.uid() and f.status = 'verified'),
    'aal',      coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'ok',       public.is_admin())
    from (select auth.uid() as uid) me
    left join public.admins a on a.id = me.uid;
$$;


-- ---------------------------------------------------------------------
-- 2. A role's ticks are rules (W-02, Q1)
--
-- Until now the ticks in Settings > Users & Roles decided which tabs the
-- admin DREW. In the database every member of staff could read and
-- change everything: an Agent with only Live Chats ticked could read the
-- bank details and change prices through the API. Rewards already did
-- it properly (may_handle_rewards); now everything does.
--
-- may('orders') is true for the owner always, and for anybody else only
-- when their role has that tick, they are not switched off, and they
-- are past two-factor. The ticks are the admin's own tabs: dashboard,
-- analytics, products, orders, chats, reviews, subscribers, policies,
-- settings, activity and deleteChats.
--
-- A tick is read as the word true. Anything else, including a roles row
-- somebody broke by hand, is a no — never an error that would take the
-- whole admin down with it.
-- ---------------------------------------------------------------------
create or replace function public.may(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
     and (public.is_shop_owner()
          or coalesce((select (s.data -> a.role -> 'permissions' ->> p_perm) = 'true'
                         from public.admins a
                         join public.site_settings s on s.key = 'roles'
                        where a.id = auth.uid()), false));
$$;

-- The four that already existed become the same test under their old
-- names, so every rule and function that asks them is covered at once.
create or replace function public.chat_may_answer()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.may('chats'); $$;

create or replace function public.may_see_analytics()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.may('analytics'); $$;

create or replace function public.may_handle_rewards()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.may('orders'); $$;

-- This one used to skip "switched off" and two-factor altogether.
create or replace function public.may_delete_chats()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.may('deleteChats'); $$;

-- The rules, table by table. Each is for signed-in people only (TO
-- authenticated): a visitor never needs any of them, and that way the
-- shop's own reading — products, settings, policies, reviews — never
-- has to ask who the visitor is.
--
-- A rule is only made for a table this project has; a project that never
-- ran a later file (payments, say) is not stopped by its absence.
create or replace function pg_temp.rule(p_table text, p_name text, p_cmd text,
                                        p_using text, p_check text default null)
returns void
language plpgsql
as $$
begin
  if to_regclass(p_table) is null then return; end if;
  execute format('drop policy if exists %I on %s', p_name, p_table);
  execute format('create policy %I on %s for %s to authenticated', p_name, p_table, p_cmd)
       || case when p_using is not null then ' using (' || p_using || ')' else '' end
       || case when p_check is not null then ' with check (' || p_check || ')' else '' end;
end;
$$;

do $$
begin
  perform pg_temp.rule('public.product_meta',          'pm_write',       'all',    $q$(select public.may('products'))$q$,    $q$(select public.may('products'))$q$);
  perform pg_temp.rule('public.site_content',          'sc_write',       'all',    $q$(select public.may('settings'))$q$,    $q$(select public.may('settings'))$q$);
  perform pg_temp.rule('public.site_settings',         'ss_admin',       'all',    $q$(select public.may('settings'))$q$,    $q$(select public.may('settings'))$q$);
  perform pg_temp.rule('public.site_settings_private', 'ssp_admin',      'all',    $q$(select public.may('settings'))$q$,    $q$(select public.may('settings'))$q$);
  perform pg_temp.rule('public.reviews',               'rv_admin',       'all',    $q$(select public.may('reviews'))$q$,     $q$(select public.may('reviews'))$q$);
  perform pg_temp.rule('public.subscribers',           'sub_admin',      'all',    $q$(select public.may('subscribers'))$q$, $q$(select public.may('subscribers'))$q$);
  perform pg_temp.rule('public.policies',              'pol_admin',      'all',    $q$(select public.may('policies'))$q$,    $q$(select public.may('policies'))$q$);
  perform pg_temp.rule('public.customers',             'cu_admin',       'select', $q$(select public.may('orders'))$q$);
  perform pg_temp.rule('public.customer_addresses',    'ca_admin',       'select', $q$(select public.may('orders'))$q$);
  perform pg_temp.rule('public.orders',                'or_admin',       'all',    $q$(select public.may('orders'))$q$,      $q$(select public.may('orders'))$q$);
  perform pg_temp.rule('public.order_items',           'oi_admin',       'all',    $q$(select public.may('orders'))$q$,      $q$(select public.may('orders'))$q$);
  perform pg_temp.rule('public.payments',              'pay_admin_read', 'select', $q$(select public.may('orders'))$q$);
  perform pg_temp.rule('public.activity_log',          'al_read',        'select', $q$(select public.may('activity'))$q$);
end $$;
-- Every tab writes its own line in the activity log, so writing one
-- needs only to be staff; reading the log needs the tick.
do $$
begin
  perform pg_temp.rule('public.activity_log',          'al_write',       'insert', null,                           $q$(select public.is_admin())$q$);
  perform pg_temp.rule('public.admins',                'adm_read',       'select', $q$(select public.is_admin())$q$);
  perform pg_temp.rule('public.chat_canned',           'cq_write',       'all',    $q$(select public.may('settings'))$q$,    $q$(select public.may('settings'))$q$);
  perform pg_temp.rule('public.chat_photo_slots',      'cps_admin',      'select', $q$(select public.may('chats'))$q$);
end $$;

-- The photo bucket: product photos and the shop's own logos both live
-- here, so either tick may upload. Chat photos are deleted with a chat.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists vbp_img_write  on storage.objects;
  drop policy if exists vbp_img_update on storage.objects;
  drop policy if exists vbp_img_delete on storage.objects;
  create policy vbp_img_write on storage.objects for insert to authenticated
    with check (bucket_id = 'product-images' and ((select public.may('products')) or (select public.may('settings'))));
  create policy vbp_img_update on storage.objects for update to authenticated
    using (bucket_id = 'product-images' and ((select public.may('products')) or (select public.may('settings'))));
  create policy vbp_img_delete on storage.objects for delete to authenticated
    using (bucket_id = 'product-images' and ((select public.may('products')) or (select public.may('settings'))));
  drop policy if exists cu_delete on storage.objects;
  create policy cu_delete on storage.objects for delete to authenticated
    using (bucket_id = 'chat-uploads' and (select public.may('deleteChats')));
end $$;


-- ---------------------------------------------------------------------
-- 3. The owner's own things (W-02, W-03)
--
-- ROLES. Only the owner may change what a role can do. The guard covered
-- adding and changing the row but not deleting it, and it let through
-- any request with nobody signed in. The request's own credentials now
-- say which it is: the SQL Editor and the website's service key are
-- trusted; a browser, signed in or not, must be the owner.
--
-- THE CHAT-NOTIFICATION ROW holds the secret every nudge carries and the
-- private half of the notification keys. Any member of staff could read
-- it and point the nudges at an address of their own. It is the owner's
-- alone now; the function that sends notifications reads it with the
-- service key, which these rules do not apply to.
-- ---------------------------------------------------------------------
create or replace function public.roles_row_is_owners()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.key, old.key) = 'roles'
     and coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated')
     and not public.is_shop_owner() then
    raise exception 'Only the shop owner can change roles.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists site_settings_roles_guard on public.site_settings;
create trigger site_settings_roles_guard
  before insert or update or delete on public.site_settings
  for each row execute function public.roles_row_is_owners();

drop policy if exists ssp_chat_push_owner on public.site_settings_private;
create policy ssp_chat_push_owner on public.site_settings_private
  as restrictive for all to authenticated
  using (key <> 'chat_push' or (select public.is_shop_owner()))
  with check (key <> 'chat_push' or (select public.is_shop_owner()));


-- ---------------------------------------------------------------------
-- 4. Throttles (W-11)
--
-- Starting a chat, sending a chat message, leaving a review, joining the
-- newsletter and placing an order had no limit at all. A script could
-- fill the tables, and every customer message buzzes every phone that
-- has notifications on.
--
-- Each limit is counted per connection (the visitor's internet address,
-- as the request arrived) and, as a backstop, for the whole shop. The
-- numbers are far above anything one real customer does. Where no
-- address can be read, only the shop-wide limit applies, so a missing
-- header can never shut everybody out at once.
--
-- rate_events keeps nothing but the kind of thing, the address it came
-- from and when. The daily clean-up (section 10) removes it after two
-- days. Nobody can read it through the website.
-- ---------------------------------------------------------------------
create table if not exists public.rate_events (
  bucket text        not null,
  key    text        not null,
  at     timestamptz not null default now()
);
create index if not exists rate_events_lookup on public.rate_events (bucket, key, at);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- The address the request came from, as Supabase passes it on.
create or replace function public.client_addr()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  h json;
  v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  if h is null then return 'unknown'; end if;
  v := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                nullif(btrim(h ->> 'x-real-ip'), ''),
                nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''));
  return coalesce(left(v, 64), 'unknown');
end;
$$;

-- Counts one more of p_bucket for p_key and refuses when the count in
-- the last p_window has reached p_max. p_key 'unknown' is not counted:
-- see above.
create or replace function public.throttle(p_bucket text, p_key text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if p_key is null or p_key = 'unknown' then return; end if;
  select count(*) into v_n from public.rate_events
   where bucket = p_bucket and key = p_key and at > now() - p_window;
  if v_n >= p_max then
    raise exception 'Too many tries just now. Please wait a little and try again.'
      using errcode = 'P0429', hint = p_bucket;
  end if;
  insert into public.rate_events (bucket, key) values (p_bucket, p_key);
end;
$$;

-- A new chat: 6 every 10 minutes from one connection, 500 an hour for
-- the whole shop. The shop-wide figure is a backstop against a flood from
-- many connections at once, set high enough (build 77; it was 120) that
-- it takes a great many of them to shut real customers out for the hour.
create or replace function public.chat_start_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.throttle('chat_start', public.client_addr(), 6, interval '10 minutes');
  perform public.throttle('chat_start', 'shop', 500, interval '1 hour');
  return new;
end;
$$;
do $$
begin
  if to_regclass('public.chat_conversations') is null then return; end if;
  drop trigger if exists chat_conv_aa_throttle on public.chat_conversations;
  create trigger chat_conv_aa_throttle before insert on public.chat_conversations
    for each row execute function public.chat_start_throttle();
end $$;

-- A customer's chat message: 20 a minute in one conversation, 60 a
-- minute from one connection. The shop's own replies are not counted.
create or replace function public.chat_send_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sender = 'customer' then
    perform public.throttle('chat_send', new.conversation_id::text, 20, interval '1 minute');
    perform public.throttle('chat_send_addr', public.client_addr(), 60, interval '1 minute');
  end if;
  return new;
end;
$$;
do $$
begin
  if to_regclass('public.chat_messages') is null then return; end if;
  drop trigger if exists chat_msg_aa_throttle on public.chat_messages;
  create trigger chat_msg_aa_throttle before insert on public.chat_messages
    for each row execute function public.chat_send_throttle();
end $$;

-- A review: 3 an hour from one connection, 30 an hour for the shop.
-- Staff adding or moving reviews in the admin are not counted.
create or replace function public.review_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.may('reviews') then return new; end if;
  perform public.throttle('review', public.client_addr(), 3, interval '1 hour');
  perform public.throttle('review', 'shop', 30, interval '1 hour');
  return new;
end;
$$;
drop trigger if exists reviews_aa_throttle on public.reviews;
create trigger reviews_aa_throttle before insert on public.reviews
  for each row execute function public.review_throttle();


-- ---------------------------------------------------------------------
-- 5. Orders: written by the website, priced by the website (W-05, Q2)
--
-- Two ways around the checkout are closed.
--
-- WRITING STRAIGHT INTO THE TABLE. Anyone could insert an order directly,
-- skipping every check the checkout makes: the shop being closed, the
-- generated reference, the date — the audit backdated one by 200 days.
-- A customer could also add lines to an order after placing it. Both
-- rules are gone; only the database's own place_order writes orders.
--
-- THE PRICES. place_order took the prices and total the browser sent, so
-- a WhatsApp order could arrive saying K1 for anything, and the Dashboard
-- counted it. Now only the website's place-order function may call it,
-- with the service key, and that function prices every line from the
-- catalogue with the very rules online payment uses. Whoever placed the
-- order is passed in by that function after it has checked their sign-in
-- with Supabase, which is the one thing a browser could otherwise claim.
-- ---------------------------------------------------------------------
drop policy if exists or_insert on public.orders;
drop policy if exists oi_insert on public.order_items;
revoke insert on public.orders, public.order_items from anon, authenticated;

drop function if exists public.place_order(jsonb, jsonb);
drop function if exists public.place_order(jsonb, jsonb, text);
create or replace function public.place_order(
  p_order    jsonb,
  p_items    jsonb default '[]'::jsonb,
  p_preview  text  default null,
  p_customer uuid  default null,
  p_client   text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_ref      text;
  v_customer uuid;
  v_pool     text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- no O/0, no I/1
  v_try      int;
  v_i        int;
  v_item     jsonb;
  v_count    int;
  v_name     text := nullif(p_order->>'name', '');
  v_phone    text := nullif(p_order->>'phone', '');
  v_email    text := nullif(p_order->>'email', '');
  v_address  text := nullif(p_order->>'address', '');
  v_notes    text := nullif(p_order->>'notes', '');
  v_fulfil   text := coalesce(nullif(p_order->>'fulfilment', ''), 'delivery');
  v_total    numeric := nullif(p_order->>'total', '')::numeric;
  v_currency text := nullif(p_order->>'currency', '');
begin
  -- Granted to the service role only, and asked again here: if a later
  -- file ever granted it wider by mistake, a browser still could not use
  -- it to name somebody else as the customer.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Orders are placed through the website.';
  end if;
  v_customer := case when p_customer is not null
                      and exists (select 1 from public.customers c where c.id = p_customer)
                     then p_customer end;

  -- A shop that has told its customers it is shut must not quietly take
  -- their order anyway. The preview key is the owner's way past it.
  if public.shop_is_closed() and not public.preview_ok(p_preview) then
    raise exception 'the shop is not taking orders at the moment';
  end if;

  -- 10 an hour from one connection; 1,000 an hour for the shop, as a
  -- backstop only (build 77; it was 200, few enough that a handful of
  -- connections could have stopped every order for an hour).
  perform public.throttle('order', coalesce(nullif(btrim(p_client), ''), 'unknown'), 10, interval '1 hour');
  perform public.throttle('order', 'shop', 1000, interval '1 hour');

  if v_name    is not null and char_length(v_name)    > 120 then raise exception 'name is too long'; end if;
  if v_phone   is not null and char_length(v_phone)   > 40  then raise exception 'phone is too long'; end if;
  if v_email   is not null and char_length(v_email)   > 160 then raise exception 'email is too long'; end if;
  if v_address is not null and char_length(v_address) > 400 then raise exception 'address is too long'; end if;
  if v_notes   is not null and char_length(v_notes)   > 600 then raise exception 'notes are too long'; end if;
  if v_total   is not null and (v_total < 0 or v_total >= 10000000) then raise exception 'total is out of range'; end if;
  if v_fulfil not in ('delivery', 'collection') then v_fulfil := 'delivery'; end if;

  if jsonb_typeof(p_items) <> 'array' then p_items := '[]'::jsonb; end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 200 then raise exception 'too many lines in one order'; end if;

  for v_try in 1..12 loop
    v_ref := 'VB-';
    for v_i in 1..5 loop
      v_ref := v_ref || substr(v_pool, 1 + floor(random() * char_length(v_pool))::int, 1);
    end loop;
    begin
      insert into public.orders
        (ref, customer_id, name, phone, email, address, notes, fulfilment, total, currency, status)
      values
        (v_ref, v_customer, v_name, v_phone, v_email, v_address, v_notes, v_fulfil, v_total, v_currency, 'pending')
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;   -- that reference was taken; try another
    end;
  end loop;

  if v_id is null then raise exception 'could not allocate an order reference'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'name', '') is not null and char_length(v_item->>'name') > 200 then
      raise exception 'a line name is too long';
    end if;
    if nullif(v_item->>'sku', '') is not null and char_length(v_item->>'sku') > 60 then
      raise exception 'a line sku is too long';
    end if;
    if nullif(v_item->>'price', '') is not null
       and ((v_item->>'price')::numeric < 0 or (v_item->>'price')::numeric >= 10000000) then
      raise exception 'a line price is out of range';
    end if;
    if nullif(v_item->>'qty', '') is not null
       and ((v_item->>'qty')::int <= 0 or (v_item->>'qty')::int > 999) then
      raise exception 'a line quantity is out of range';
    end if;

    insert into public.order_items (order_id, sku, name, price, qty)
    values (
      v_id,
      nullif(v_item->>'sku', ''),
      nullif(v_item->>'name', ''),
      nullif(v_item->>'price', '')::numeric,
      coalesce(nullif(v_item->>'qty', '')::int, 1)
    );
  end loop;

  return jsonb_build_object('id', v_id, 'ref', v_ref);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.place_order(jsonb, jsonb, text, uuid, text) to service_role;


-- ---------------------------------------------------------------------
-- 6. Test payments say so (W-04), and what counts as a sale (Q4, build 78)
--
-- The payment mode lived only in the payments settings, so an order paid
-- with a test card looked exactly like a real one in the Orders tab. The
-- payment function now writes the mode onto the order, and like every
-- other payment detail it can only be set by the payment service.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_method') then
    return;   -- supabase-payments.sql has not been run: nothing to mark
  end if;
  alter table public.orders add column if not exists pay_mode text;
  if not exists (select 1 from pg_constraint where conname = 'orders_pay_mode_known') then
    alter table public.orders add constraint orders_pay_mode_known
      check (pay_mode is null or pay_mode in ('test', 'live'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'pay_mode') then
    return;
  end if;
  create or replace function public.orders_payment_guard()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
  as $f$
  begin
    if current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;
    if tg_op = 'INSERT' then
      if new.payment_method is not null or new.payment_status is not null
         or new.pay_ref is not null or new.pay_channel is not null
         or new.paid_amount is not null or new.paid_at is not null
         or new.goods_total is not null or new.delivery_fee is not null
         or new.tax_total is not null or new.pay_mode is not null then
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
         or new.tax_total     is distinct from old.tax_total
         or new.pay_mode      is distinct from old.pay_mode then
        raise exception 'payment details are set by the payment service only';
      end if;
      -- The total of an order paid online is what was paid for.
      if old.payment_method = 'online' and new.total is distinct from old.total then
        raise exception 'the total of an order paid online cannot be changed';
      end if;
    end if;
    return new;
  end;
  $f$;
end $$;

-- WHAT COUNTS AS A SALE (decision Q4, build 78; W-05, W-21). The
-- Dashboard and Analytics counted every order that was not cancelled as a
-- sale, so an order nobody had confirmed, or one made up, added to "Sales"
-- the moment it was placed. A sale is now an order the shop has confirmed
-- (Confirmed, Ready, On its way, Delivered, or the older Completed), or
-- one paid online for real. A WhatsApp order still "Received" is shown on
-- its own, as waiting to be confirmed. A cancelled order, a test payment
-- and an order still on the payment page are not counted at all.
--
-- One rule, here, answered for one order at a time: 'sale', 'waiting' or
-- 'none'. The order is read as JSON so that a project without the
-- payment columns is answered too. The Dashboard, which reads the orders
-- itself, applies the same rule (assets/admin/dashboard.js).
create or replace function public.order_counts_as(p_order jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_order ->> 'status', '') = 'cancelled' then 'none'
    when p_order ->> 'payment_method' = 'online' then
      case when p_order ->> 'payment_status' = 'paid'
                and coalesce(p_order ->> 'pay_mode', '') <> 'test' then 'sale'
           else 'none' end
    when coalesce(nullif(p_order ->> 'status', ''), 'pending') = 'pending' then 'waiting'
    when p_order ->> 'status' in ('confirmed', 'ready', 'dispatched', 'delivered', 'completed') then 'sale'
    else 'none'
  end;
$$;

-- And Analytics > How orders were paid counts no test payment as money.
-- The same figures as supabase-payments.sql gave, with two changes: an
-- order paid in Test mode is left out, and only somebody whose role is
-- ticked for Analytics may see them (Q1).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'pay_mode') then
    return;
  end if;
  create or replace function public.pay_sales_split(p_from date, p_to date, p_tz text default 'UTC')
  returns json
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $f$
  declare
    v_start timestamptz;
    v_end   timestamptz;
    v_out   json;
  begin
    if not public.may('analytics') then
      raise exception 'administrators only';
    end if;
    v_start := (p_from::timestamp) at time zone coalesce(nullif(p_tz, ''), 'UTC');
    v_end   := ((p_to + 1)::timestamp) at time zone coalesce(nullif(p_tz, ''), 'UTC');

    select json_build_object(
      -- A WhatsApp order is a sale once the shop has confirmed it, and one
      -- still "Received" is counted on its own (decision Q4, build 78:
      -- order_counts_as, above).
      'whatsapp_orders', count(*) filter (where o.payment_method is distinct from 'online'
                                            and public.order_counts_as(to_jsonb(o)) = 'sale'),
      'whatsapp_sales',  coalesce(sum(o.total) filter (where o.payment_method is distinct from 'online'
                                            and public.order_counts_as(to_jsonb(o)) = 'sale'), 0),
      'whatsapp_waiting', count(*) filter (where o.payment_method is distinct from 'online'
                                            and public.order_counts_as(to_jsonb(o)) = 'waiting'),
      'whatsapp_waiting_value', coalesce(sum(o.total) filter (where o.payment_method is distinct from 'online'
                                            and public.order_counts_as(to_jsonb(o)) = 'waiting'), 0),
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
     where o.created_at >= v_start and o.created_at < v_end
       and coalesce(o.pay_mode, '') <> 'test';
    return v_out;
  end;
  $f$;
end $$;


-- Analytics' own Orders and Sales (supabase-analytics.sql's site_stats),
-- by the same rule, and the orders waiting to be confirmed beside them.
-- Everything else it counts is exactly as that file has it.
do $$
begin
  if to_regclass('public.site_events') is null or to_regclass('public.site_daily') is null
     or to_regclass('public.site_visitor_days') is null then return; end if;
  create or replace function public.site_stats(p_from date, p_to date, p_tz text)
  returns json
  language plpgsql
  volatile
  security definer
  set search_path = public, pg_temp
  as $f$
  declare
    v_today   date;
    v_to      date;
    v_last    date;
    v_partial boolean;
    v_ps      timestamptz;
    v_pe      timestamptz;
    r_sum     record;
    r_now     record;
    v_people  integer := 0;
    v_new     integer := 0;
    v_orders  integer := 0;
    v_sales   numeric := 0;
    v_wait    integer := 0;
    v_wait_v  numeric := 0;
    v_cur     text;
    v_oe      timestamptz;
  begin
    if not public.may_see_analytics() then
      raise exception 'You do not have permission to read the website analytics.';
    end if;
    if p_from is null or p_to is null then return null; end if;
    p_tz := coalesce(nullif(p_tz, ''), 'UTC');

    v_today   := (now() at time zone p_tz)::date;
    v_to      := least(p_to, v_today);
    v_last    := least(v_to, v_today - 1);
    v_partial := (v_to >= v_today and p_from <= v_today);
    v_ps      := (v_today::timestamp) at time zone p_tz;
    v_pe      := now();

    perform public.site_rollup_range(p_from, v_last, p_tz);

    select coalesce(sum(visits), 0)          as visits,
           coalesce(sum(page_views), 0)      as page_views,
           coalesce(sum(product_views), 0)   as product_views,
           coalesce(sum(add_to_cart), 0)     as add_to_cart,
           coalesce(sum(checkout_starts), 0) as checkout_starts,
           coalesce(sum(mobile), 0)          as mobile,
           coalesce(sum(desktop), 0)         as desktop,
           coalesce(sum(tablet), 0)          as tablet
      into r_sum
      from public.site_daily
     where tz = p_tz and day >= p_from and day <= v_last;

    select count(distinct e.session)                                             as visits,
           count(*) filter (where e.kind = 'page_view')                          as page_views,
           count(*) filter (where e.kind = 'product_view')                       as product_views,
           count(*) filter (where e.kind = 'add_to_cart')                        as add_to_cart,
           count(*) filter (where e.kind = 'checkout_start')                     as checkout_starts,
           count(distinct e.session) filter (where e.device = 'mobile')          as mobile,
           count(distinct e.session) filter (where e.device = 'desktop')         as desktop,
           count(distinct e.session) filter (where e.device = 'tablet')          as tablet
      into r_now
      from public.site_events e
     where v_partial and e.at >= v_ps and e.at < v_pe;

    select count(*), count(*) filter (where m.is_first)
      into v_people, v_new
      from (
        select u.visitor, bool_or(u.is_first) as is_first
          from (
              select d.visitor, d.is_first
                from public.site_visitor_days d
               where d.day >= p_from and d.day <= v_last
            union all
              select e.visitor,
                     not exists (select 1 from public.site_visitor_days x
                                  where x.visitor = e.visitor)
                from public.site_events e
               where v_partial and e.at >= v_ps and e.at < v_pe
               group by e.visitor
          ) u
         group by u.visitor
      ) m;

    -- The orders: a sale is what order_counts_as says it is, worth what
    -- was paid when it was paid online. Caught, as before, so that a
    -- project whose orders cannot be read still gets its visits.
    v_oe := ((v_to + 1)::timestamp) at time zone p_tz;
    begin
      select count(*) filter (where k.kind = 'sale'),
             coalesce(sum(k.worth) filter (where k.kind = 'sale'), 0),
             count(*) filter (where k.kind = 'waiting'),
             coalesce(sum(k.worth) filter (where k.kind = 'waiting'), 0),
             max(o.currency)
        into v_orders, v_sales, v_wait, v_wait_v, v_cur
        from public.orders o
        cross join lateral (
          select public.order_counts_as(to_jsonb(o)) as kind,
                 coalesce(case when to_jsonb(o) ->> 'payment_method' = 'online'
                               then nullif(to_jsonb(o) ->> 'paid_amount', '')::numeric end,
                          o.total, 0) as worth) k
       where o.created_at >= ((p_from::timestamp) at time zone p_tz)
         and o.created_at <  v_oe;
    exception when others then
      v_orders := 0; v_sales := 0; v_wait := 0; v_wait_v := 0; v_cur := null;
    end;

    return json_build_object(
      'from',            p_from,
      'to',              v_to,
      'tz',              p_tz,
      'visits',          r_sum.visits          + coalesce(r_now.visits, 0),
      'page_views',      r_sum.page_views      + coalesce(r_now.page_views, 0),
      'product_views',   r_sum.product_views   + coalesce(r_now.product_views, 0),
      'add_to_cart',     r_sum.add_to_cart     + coalesce(r_now.add_to_cart, 0),
      'checkout_starts', r_sum.checkout_starts + coalesce(r_now.checkout_starts, 0),
      'visitors',        v_people,
      'new_visitors',    v_new,
      'returning_visitors', greatest(v_people - v_new, 0),
      'mobile',          r_sum.mobile  + coalesce(r_now.mobile, 0),
      'desktop',         r_sum.desktop + coalesce(r_now.desktop, 0),
      'tablet',          r_sum.tablet  + coalesce(r_now.tablet, 0),
      'orders',          coalesce(v_orders, 0),
      'sales',           coalesce(v_sales, 0),
      'waiting_orders',  coalesce(v_wait, 0),
      'waiting_value',   coalesce(v_wait_v, 0),
      'currency',        v_cur
    );
  end;
  $f$;
end $$;


-- ---------------------------------------------------------------------
-- 7. The preview key leaves the public settings (W-16)
--
-- The key that lets the owner see the shop while it is closed sat in the
-- settings every visitor's browser downloads, so "closed" was closed to
-- anybody who did not look. It now lives in the private settings (the
-- private half of 'general'), and the shop asks the database whether a
-- key is right instead of comparing it in the browser.
--
-- A trigger keeps it there: if anything ever writes a preview key into
-- the public settings again — an old admin page still open in a tab,
-- say — it is moved across before it is stored.
-- ---------------------------------------------------------------------
create or replace function public.preview_key_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if new.key <> 'general' or not (coalesce(new.data, '{}'::jsonb) ? 'previewKey') then
    return new;
  end if;
  v_key := btrim(coalesce(new.data ->> 'previewKey', ''));
  insert into public.site_settings_private (key, data)
  values ('general', jsonb_build_object('previewKey', v_key))
  on conflict (key) do update
    set data = coalesce(public.site_settings_private.data, '{}'::jsonb) || jsonb_build_object('previewKey', v_key),
        updated_at = now();
  new.data := new.data - 'previewKey';
  return new;
end;
$$;

drop trigger if exists site_settings_preview_private on public.site_settings;
create trigger site_settings_preview_private
  before insert or update on public.site_settings
  for each row execute function public.preview_key_private();

-- Move any key that is there now (the trigger above does the moving).
update public.site_settings set data = data
 where key = 'general' and data ? 'previewKey';

create or replace function public.preview_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(btrim(coalesce(data->>'previewKey', '')), '') is not null
        and nullif(btrim(coalesce(data->>'previewKey', '')), '') = btrim(coalesce(p_key, ''))
       from public.site_settings_private where key = 'general'),
    false);
$$;

-- Settings > General keeps reading and saving the key as before (build 76's
-- admin page files it with the private settings, the way the bank details
-- already are), so only somebody who may open Settings ever sees it.


-- ---------------------------------------------------------------------
-- 8. The notification keys and secret (W-03)
--
-- Every copy of the website up to build 75 carried the same key pair for
-- phone notifications, the same secret, and the owner's own email
-- address, written into supabase-chat-phase7.sql. Build 74's safety check
-- replaced the secret. This retires the key pair and the address:
--
--   * If this project still has the shipped key pair, it is removed. The
--     owner's browser makes a new pair of its own the next time the
--     owner opens Live Chats, and stores it here through
--     chat_push_keys_set below. Phones must then be switched on again
--     with "Notify me here": a phone signed up to the old key would
--     never hear from the new one, so those sign-ups are cleared too.
--   * The secret is replaced if build 74's check never did it.
--   * The contact address sent with each notification becomes the
--     website's own address instead of a person's email.
--
-- The shipped pair is recognised by a fingerprint of its PUBLIC half,
-- which every browser was given anyway; nothing secret is in this file.
-- ---------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  if to_regclass('public.site_settings_private') is null then return; end if;
  select data into v from public.site_settings_private where key = 'chat_push';
  if v is null then return; end if;

  if encode(extensions.digest(coalesce(v->>'vapidPublic', ''), 'sha256'), 'hex')
     = '4bbb345b15b9ff7e0a3f2538a9f73f01d63dc131ca2c7088ab9e6353bcd6f3b9' then
    v := (v - 'vapidPublic' - 'vapidPrivate') || jsonb_build_object('keysRetiredAt', now());
    if to_regclass('public.chat_push') is not null then
      delete from public.chat_push;
    end if;
  end if;

  if not (v ? 'secretRotatedAt') then
    v := jsonb_set(v, '{secret}', to_jsonb(encode(extensions.gen_random_bytes(32), 'hex')))
         || jsonb_build_object('secretRotatedAt', now());
  end if;

  if coalesce(v->>'subject', '') like 'mailto:%' or not (v ? 'subject') then
    v := v - 'subject';
    if coalesce(v->>'siteUrl', '') <> '' then
      v := v || jsonb_build_object('subject', v->>'siteUrl');
    end if;
  end if;

  update public.site_settings_private set data = v where key = 'chat_push';
end $$;

-- The owner's browser storing the pair it made. Only the owner, only a
-- well-formed pair (a P-256 public key and private key, in the form
-- browsers use), and only while there is none: a second device must not
-- swap out keys that already work.
create or replace function public.chat_push_keys_set(p_public text, p_private text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can set up the notification keys.';
  end if;
  if coalesce(p_public, '') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_private, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Those are not notification keys.';
  end if;

  select data into v from public.site_settings_private where key = 'chat_push' for update;
  if v is null then
    insert into public.site_settings_private (key, data)
    values ('chat_push', jsonb_build_object(
      'vapidPublic', p_public, 'vapidPrivate', p_private, 'keysMadeAt', now(),
      'secret', encode(gen_random_bytes(32), 'hex'), 'secretRotatedAt', now()));
    return true;
  end if;
  if coalesce(v->>'vapidPublic', '') <> '' then
    return false;   -- already set: the caller reads chat_push_key() again
  end if;
  update public.site_settings_private
     set data = v || jsonb_build_object('vapidPublic', p_public, 'vapidPrivate', p_private, 'keysMadeAt', now())
   where key = 'chat_push';
  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. The newsletter (W-15)
--
-- Two doors are closed.
--
-- Anybody could write an address straight into the subscribers table,
-- any string of 3 to 200 characters. Joining now goes only through
-- subscribe_email, which checks the address and is throttled.
--
-- Anybody could put an address that had unsubscribed back on the list,
-- by typing it into the form. Somebody's wish to be left alone should
-- outlive a stranger's whim, so the form no longer does that by itself:
-- the website's newsletter function emails a link to that address, and
-- only following the link from that inbox puts it back.
-- ---------------------------------------------------------------------
drop policy if exists sub_insert on public.subscribers;
alter table public.subscribers add column if not exists rejoin_hash text;
alter table public.subscribers add column if not exists rejoin_at timestamptz;

create or replace function public.subscribe_email(
  p_email  text,
  p_rejoin boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := btrim(coalesce(p_email, ''));
begin
  if char_length(v_email) < 3 or char_length(v_email) > 200
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;
  perform public.throttle('subscribe', public.client_addr(), 5, interval '1 hour');
  perform public.throttle('subscribe', 'shop', 100, interval '1 hour');

  -- An address already known stays exactly as it is: on the list, or off
  -- it. p_rejoin no longer puts anybody back; see newsletter_join.
  if not exists (select 1 from public.subscribers s where lower(s.email) = lower(v_email)) then
    insert into public.subscribers (email) values (v_email)
    on conflict (email) do nothing;
  end if;
  return true;
end;
$$;

-- For the newsletter function only (service key). Says what happened:
--   joined    a new address, now on the list
--   already   on the list already
--   confirm   unsubscribed earlier: a link must go to that inbox; the
--             token comes back for the function to put in it
--   wait      a link went to that address in the last hour already
create or replace function public.newsletter_join(p_email text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := btrim(coalesce(p_email, ''));
  r       record;
  v_token text;
begin
  if char_length(v_email) < 3 or char_length(v_email) > 200
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;
  perform public.throttle('subscribe', coalesce(nullif(btrim(p_client), ''), 'unknown'), 5, interval '1 hour');
  perform public.throttle('subscribe', 'shop', 100, interval '1 hour');

  select * into r from public.subscribers s where lower(s.email) = lower(v_email) limit 1;
  if not found then
    insert into public.subscribers (email) values (v_email) on conflict (email) do nothing;
    return jsonb_build_object('state', 'joined');
  end if;
  if r.unsubscribed_at is null then
    return jsonb_build_object('state', 'already');
  end if;
  if r.rejoin_at is not null and r.rejoin_at > now() - interval '1 hour' then
    return jsonb_build_object('state', 'wait');
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  update public.subscribers
     set rejoin_hash = encode(digest(v_token, 'sha256'), 'hex'), rejoin_at = now()
   where email = r.email;
  return jsonb_build_object('state', 'confirm', 'token', v_token, 'email', r.email);
end;
$$;

-- The link from that inbox. Good for three days, once.
create or replace function public.newsletter_confirm(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{48}$' then return false; end if;
  update public.subscribers
     set unsubscribed_at = null, rejoin_hash = null, rejoin_at = null
   where rejoin_hash = encode(digest(p_token, 'sha256'), 'hex')
     and rejoin_at > now() - interval '3 days';
  return found;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. The daily clean-up can run (W-09)
--
-- netlify/functions/site-prune.js calls this every night with the
-- service key. It refused the service key, so it never ran and the raw
-- visit records grew for ever. It now lets the scheduled job through,
-- and clears the throttle counts as well.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.site_events') is null or to_regclass('public.site_daily') is null then return; end if;
  create or replace function public.site_prune(p_days integer default 400, p_tz text default 'UTC')
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = public, pg_temp
  as $f$
  declare
    v_asked  timestamptz;
    v_summed date;
    v_cut    timestamptz;
    v_gone   integer := 0;
  begin
    if not (public.may_see_analytics() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
      raise exception 'You do not have permission to prune the website analytics.';
    end if;
    delete from public.rate_events where at < now() - interval '2 days';

    p_tz    := coalesce(nullif(p_tz, ''), 'UTC');
    v_asked := now() - (greatest(coalesce(p_days, 400), 30) || ' days')::interval;

    select max(day) into v_summed from public.site_daily;
    if v_summed is null then return 0; end if;

    v_cut := least(v_asked, ((v_summed + 1)::timestamp) at time zone p_tz);

    delete from public.site_events where at < v_cut;
    get diagnostics v_gone = row_count;

    delete from public.site_presence where seen_at < now() - interval '1 day';

    return v_gone;
  end;
  $f$;
end $$;


-- ---------------------------------------------------------------------
-- 11. The email password can be replaced, never read back (W-12, build 77)
--
-- The password of the shop's email account sat in the private settings,
-- where anybody whose role may open Settings could read it, and every
-- "Send a test email" and "Send welcome" carried it from the admin page
-- to the website. Since build 77 the website sends those itself, with the
-- account as stored, so no page needs the password at all. It now lives
-- in a private row of its own that nobody signed in can read or write,
-- not even the owner; only the website's functions read it, with the
-- service key.
--
-- Settings > Notifications still sets it. The moment it is saved the
-- database moves it across and keeps only a note THAT one is saved.
-- Saving the form with the box left empty keeps the one already there.
-- ---------------------------------------------------------------------
create or replace function public.mail_password_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pw text;
begin
  if new.key <> 'notifications' then return new; end if;
  v_pw := coalesce(new.data ->> 'smtpPassword', '');
  if v_pw <> '' then
    insert into public.site_settings_private (key, data)
    values ('mail_secret', jsonb_build_object('smtpPassword', v_pw, 'savedAt', now()))
    on conflict (key) do update set data = excluded.data, updated_at = now();
  end if;
  new.data := (coalesce(new.data, '{}'::jsonb) - 'smtpPassword')
              || jsonb_build_object('passwordSaved', exists (
                   select 1 from public.site_settings_private s
                    where s.key = 'mail_secret' and coalesce(s.data ->> 'smtpPassword', '') <> ''));
  return new;
end;
$$;

drop trigger if exists ssp_mail_password on public.site_settings_private;
create trigger ssp_mail_password
  before insert or update on public.site_settings_private
  for each row execute function public.mail_password_private();

drop policy if exists ssp_mail_secret_none on public.site_settings_private;
create policy ssp_mail_secret_none on public.site_settings_private
  as restrictive for all to authenticated
  using (key <> 'mail_secret')
  with check (key <> 'mail_secret');

-- Move a password that is there now (the trigger does the moving).
update public.site_settings_private set data = data
 where key = 'notifications' and data ? 'smtpPassword';


-- ---------------------------------------------------------------------
-- 12. What a visitor may call (W-08)
--
-- Supabase lets every visitor call every function in the database
-- unless it is told otherwise, and "revoke ... from public" does not
-- tell it. Two analytics functions the files said were "not granted at
-- all" could be called by anybody, and one call inflated the visitor
-- figures. Most others check who is asking and refuse, but nothing made
-- sure the next one would.
--
-- So visitors (anon) may now call only what the shop's pages actually
-- call, plus the few checks the database's own rules make on their
-- behalf. What signed-in people may call is left as each file decided:
-- every admin function checks who is asking itself. The two rollups and
-- the jobs for the payment and newsletter functions are nobody's but
-- the database's and the service key's.
--
-- A later file that adds a function will be callable by visitors again
-- until this file is run once more; the report says how many there are.
-- ---------------------------------------------------------------------
create or replace function pg_temp.vq_visitor_ok()
returns text[]
language sql
immutable
as $$
  select array[
    -- the storefront's chat
    'chat_start', 'chat_send', 'chat_poll', 'chat_seen', 'chat_identify', 'chat_claim',
    'chat_resume', 'chat_end', 'chat_typing', 'chat_channel',
    'chat_photo_start', 'chat_send_photo', 'chat_photos_on',
    -- the visit record
    'site_beat', 'site_gone', 'site_bye',
    -- the newsletter, the closed shop and its preview key
    'subscribe_email', 'shop_is_closed', 'preview_ok',
    -- asked by the database's own rules while a visitor reads or writes
    'is_admin', 'chat_may_answer', 'review_auto_publish', 'chat_photo_slot_open']::text[];
$$;

do $$
declare
  f   record;
  ok  text[] := pg_temp.vq_visitor_ok();
  internal text[] := array['site_rollup', 'site_rollup_range', 'pay_expire_stale',
                           'newsletter_join', 'newsletter_confirm', 'throttle'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       -- an extension's own functions are the extension's business
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if f.proname = any (internal) then
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.proname = any (ok) then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.proname <> 'place_order' then
      -- Taken from visitors only. What signed-in people may call stays
      -- exactly as the file that made the function decided: some are the
      -- service key's alone, and stay that way.
      execute format('revoke all on function %s from public, anon', f.sig);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 13. Every function's search path is pinned (Security Advisor)
--
-- A function that does not say where to look for the tables it names
-- looks wherever the caller says. Every security-definer function here
-- already said so; these are the rest.
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                        where c like 'search_path=%')
       -- an extension's own functions, and any this login does not own,
       -- are left as they are rather than stopping the whole file
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and pg_has_role(p.proowner, 'USAGE')
  loop
    begin
      execute format('alter function %s set search_path = public, extensions, pg_temp', f.sig);
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 14. A record of what has been run (W-07)
--
-- Twenty-six of the older files say "safe to run again", and before this
-- build that was not true of ten of them: running one again on its own
-- quietly put back an older, weaker version of something. From now on
-- every file that changes the database writes a line here, and the
-- older files read it first and refuse to run once this one has, with a
-- message saying so. Nothing is lost by that — this file holds the
-- newer version of everything they would have changed, and is itself
-- safe to run again at any time.
-- ---------------------------------------------------------------------
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now(),
  note       text
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

insert into public.schema_migrations (version, note)
values ('078-hardening', 'supabase-hardening.sql, build 78')
on conflict (version) do update set applied_at = now();

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- THE REPORT
-- ---------------------------------------------------------------------
create or replace function pg_temp.vq_hardening_report()
returns table (area text, item text, status text, todo text)
language plpgsql
as $$
declare
  r       record;
  v_rows  jsonb := '[]'::jsonb;
  v       jsonb;
  v_n     integer;
  v_txt   text;
  v_two   boolean;
  v_req   boolean;
begin
  -- Staff, one line each.
  for r in
    select a.id, to_jsonb(a) as j,
           exists (select 1 from auth.mfa_factors f where f.user_id = a.id and f.status = 'verified') as enrolled,
           (a.role = 'owner'
            or (s.data -> a.role -> 'permissions' ->> 'settings')    = 'true'
            or (s.data -> a.role -> 'permissions' ->> 'orders')      = 'true'
            or (s.data -> a.role -> 'permissions' ->> 'subscribers') = 'true') as required
      from public.admins a
      left join public.site_settings s on s.key = 'roles'
     order by (a.role = 'owner') desc, a.added_at
  loop
    v_two := r.enrolled; v_req := coalesce(r.required, false);
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Staff', coalesce(r.j->>'email', r.id::text),
      case when r.j->>'role' = 'owner' then 'Owner'
           else coalesce(r.j->>'role', 'agent') end
      || case when r.j->>'role' <> 'owner' and coalesce((r.j->>'active')::boolean, true) = false
              then ' · SWITCHED OFF: can no longer read anything' else '' end
      || ' · two-factor ' || case when v_two then 'set up' when v_req then 'REQUIRED, not set up yet' else 'off (not required)' end,
      case when coalesce((r.j->>'active')::boolean, true) = false and r.j->>'role' <> 'owner'
             then 'Nothing to do: the database now refuses them. Remove them in Settings > Users & Roles when you are ready.'
           when v_req and not v_two and r.j->>'role' = 'owner'
             then 'Sign in to the admin now: it will show you how to set up two-factor before anything else.'
           when v_req and not v_two
             then 'At their next sign-in the admin will ask them to set up two-factor before they can carry on.'
           else '' end));
  end loop;

  -- Roles, as the database now enforces them.
  begin
    for r in select key, value from jsonb_each((select data from public.site_settings where key = 'roles')) loop
      select string_agg(k, ', ' order by k) into v_txt
        from jsonb_each_text(coalesce(r.value -> 'permissions', '{}'::jsonb)) as p(k, val)
       where val = 'true';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Roles', coalesce(r.value ->> 'label', r.key),
        'may: ' || coalesce(v_txt, 'nothing'),
        'Enforced by the database from now on. Change ticks in Settings > Users & Roles.'));
    end loop;
  exception when others then null;
  end;

  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Orders', 'How orders are written', 'only by the website, priced from the catalogue', ''));

  -- What counts as a sale (build 78), and how many wait for the shop.
  begin
    select count(*) into v_n from public.orders o where public.order_counts_as(to_jsonb(o)) = 'waiting';
  exception when others then v_n := 0;
  end;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Orders', 'What counts as a sale', 'confirmed by the shop, or paid online (never a test payment)',
    case when v_n > 0
         then v_n || ' order(s) are still "Received", waiting to be confirmed. They show on the Dashboard and in Analytics on their own, not as sales: confirm or cancel them in Admin > Orders.'
         else '' end));

  select (case when coalesce(data->>'previewKey', '') <> '' then 'SET, now private' else 'empty' end)
    into v_txt from public.site_settings_private where key = 'general';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Shop', 'Preview key', coalesce(v_txt, 'empty'),
    case when v_txt like 'SET%' then 'It no longer appears in the public settings. Empty it in Settings > General when you are not testing.' else '' end));

  select data into v from public.site_settings_private where key = 'chat_push';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Chat notifications', 'Keys',
    case when v is null then 'not set up'
         when coalesce(v->>'vapidPublic', '') = '' and v ? 'keysRetiredAt' then 'RETIRED: waiting for new ones'
         when coalesce(v->>'vapidPublic', '') = '' then 'not made yet'
         else 'this shop''s own' end,
    case when v is not null and coalesce(v->>'vapidPublic', '') = ''
         then 'Sign in as the owner and open Live Chats: that makes the new keys. Then everybody who wants phone notifications presses "Notify me here" again.'
         else '' end));

  select count(*) into v_n from public.subscribers where unsubscribed_at is not null;
  select data into v from public.site_settings where key = 'notifications';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Newsletter', 'Rejoining after unsubscribing', 'needs a link from the person''s own inbox',
    case when coalesce((v->>'emailEnabled')::boolean, false) is not true
         then 'Email is not set up (Settings > Notifications), so the link cannot be sent: until it is, ' || v_n || ' unsubscribed address(es) cannot rejoin.'
         else '' end));

  -- The email password (build 77).
  select data into v from public.site_settings where key = 'notifications';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Email', 'Password',
    case when exists (select 1 from public.site_settings_private
                       where key = 'mail_secret' and coalesce(data ->> 'smtpPassword', '') <> '')
           then 'saved; only the website itself can read it'
         when coalesce((v ->> 'emailEnabled')::boolean, false) then 'none saved'
         else 'email not set up' end,
    case when coalesce((v ->> 'emailEnabled')::boolean, false)
              and not exists (select 1 from public.site_settings_private
                               where key = 'mail_secret' and coalesce(data ->> 'smtpPassword', '') <> '')
           then 'If your email account needs a password, type it in Settings > Notifications and save, then use "Send a test email".'
         else '' end));

  -- Online payment, and who may use Test mode (build 77).
  select data into v from public.site_settings where key = 'payments';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Payments', 'Online payment',
    case when coalesce((v ->> 'onlineEnabled')::boolean, false) is not true then 'OFF'
         when coalesce(v ->> 'onlineMode', 'test') = 'live' then 'ON · LIVE'
         else 'ON · TEST MODE: only the shop can use it' end,
    case when coalesce((v ->> 'onlineEnabled')::boolean, false) and coalesce(v ->> 'onlineMode', 'test') <> 'live'
           then 'Customers are not offered it. You test with your preview key: open the shop as https://YOUR-SITE/?preview=YOUR-KEY' ||
                case when exists (select 1 from public.site_settings_private
                                   where key = 'general' and coalesce(data ->> 'previewKey', '') <> '')
                     then '' else ' (none is set yet: choose one in Settings > General first)' end ||
                '. Test payments are marked TEST.'
         else '' end));

  select count(*), string_agg(p.proname, ', ' order by p.proname) filter (where not (p.proname = any (pg_temp.vq_visitor_ok())))
    into v_n, v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Database', 'Functions a visitor can call',
    v_n::text || case when v_txt is null then ', all of them ones the website uses' else ', including ' || v_txt end,
    case when v_txt is null then ''
         else 'Run this file again. If these are still listed, send this line to whoever looks after the website.' end));

  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Database', 'Throttles', 'on: chats, reviews, newsletter, orders; and, from the website, starting payments and the admin''s emails', ''));

  select count(*) into v_n from public.schema_migrations;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(
    'Database', 'This file', 'RECORDED (078-hardening)',
    'The older supabase-*.sql files now refuse to run again. This one is safe to run again whenever you like.'));

  return query
    select e->>0, e->>1, e->>2, e->>3
      from jsonb_array_elements(v_rows) with ordinality as t(e, i)
     order by i;
end;
$$;

select area, item, status, todo as "do this" from pg_temp.vq_hardening_report();
