-- =====================================================================
-- Vaultique Boutique Point — live chat, Phase 2: who is writing
-- ---------------------------------------------------------------------
-- Run this AFTER supabase-chat.sql, in the same WEBSITE project. That
-- file is Phase 1 and is not changed by this one; if you are setting up
-- from scratch, run it first and then this.
--
-- Safe to run more than once.
--
-- Phase 1 could tell the shop that somebody was asking. It could not
-- tell them who, what they were looking at, or whether they had bought
-- before — so every conversation started by asking three questions the
-- website already knew the answers to. This adds:
--
--   · a name a guest can give, without being made to
--   · the signed-in customer behind a conversation, including one that
--     began as a guest and signed in afterwards
--   · the page or piece they are looking at while they write
--   · a conversation that follows a signed-in customer between devices
--
-- ON THE PAGE BEING RECORDED. It is written down only while a
-- conversation is actually open — the browser sends it on the same ask
-- that fetches new messages, and nothing asks until somebody has
-- written to the shop. A visitor who never opens the chat is never
-- recorded anywhere, and closing the conversation stops it.
-- =====================================================================

-- 1) What a conversation can now carry --------------------------------

alter table public.chat_conversations
  add column if not exists started_on text,       -- where they were when they wrote
  add column if not exists viewing    text,       -- where they are now
  add column if not exists viewing_at timestamptz;


-- 2) Starting, now remembering where from -----------------------------
-- The old three-argument version is dropped rather than left beside
-- this one: two functions of the same name, both callable with three
-- arguments, is a call Postgres cannot resolve.

drop function if exists public.chat_start(text, text, text);

create or replace function public.chat_start(
  p_name       text default null,
  p_phone      text default null,
  p_email      text default null,
  p_started_on text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token    text;
  v_customer uuid;
begin
  v_token := encode(gen_random_bytes(24), 'hex');

  select c.id into v_customer from public.customers c where c.id = auth.uid();

  insert into public.chat_conversations
         (token, name, phone, email, customer_id, started_on, viewing, viewing_at)
  values (
    v_token,
    nullif(btrim(coalesce(p_name,  '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    v_customer,
    left(nullif(btrim(coalesce(p_started_on, '')), ''), 300),
    left(nullif(btrim(coalesce(p_started_on, '')), ''), 300),
    now()
  );

  return v_token;
end;
$$;


-- 3) A guest putting a name to themselves -----------------------------
-- Offered, never demanded: a customer who would rather just ask their
-- question still gets an answer. Only ever fills in a blank — a name
-- the shop already has is not overwritten by a later empty box.

create or replace function public.chat_identify(
  p_token text,
  p_name  text default null,
  p_phone text default null,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set name  = coalesce(nullif(btrim(coalesce(p_name,  '')), ''), name),
         phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         email = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email)
   where token = p_token;
end;
$$;


-- 4) A guest who signs in halfway through -----------------------------
-- The conversation they already started becomes theirs, so the operator
-- sees one customer rather than a stranger and a customer who happen to
-- be the same person. A conversation that already belongs to somebody
-- is never reassigned: that is how one account would take another's.

create or replace function public.chat_claim(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_profile  public.customers%rowtype;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into v_profile from public.customers c where c.id = auth.uid();
  if v_profile.id is null then
    return;
  end if;
  v_customer := v_profile.id;

  update public.chat_conversations
     set customer_id = v_customer,
         name  = coalesce(name,  v_profile.name),
         phone = coalesce(phone, v_profile.phone)
   where token = p_token
     and customer_id is null;
end;
$$;


-- 5) The same conversation on their other phone -----------------------
-- The token lives in one browser, so a customer signing in elsewhere
-- would otherwise start again and lose the thread. Only ever returns a
-- conversation that already belongs to the caller: with nobody signed
-- in it returns nothing at all, which is what stops this being a way
-- to ask for somebody else's token.

create or replace function public.chat_resume()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    return null;
  end if;

  select token into v_token
    from public.chat_conversations
   where customer_id = auth.uid()
     and status = 'open'
   order by last_message_at desc
   limit 1;

  return v_token;
end;
$$;


-- 6) Asking, now saying where they are --------------------------------
-- Same two-argument dropped-and-replaced reason as chat_start.

drop function if exists public.chat_poll(text, timestamptz);

create or replace function public.chat_poll(
  p_token   text,
  p_after   timestamptz default null,
  p_viewing text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.chat_conversations%rowtype;
  v_msgs json;
begin
  select * into v_conv
    from public.chat_conversations
   where token = p_token;

  if v_conv.id is null then
    return null;
  end if;

  -- Where they are, kept current while they are here. Written before
  -- the messages are gathered so an operator watching sees it move.
  if p_viewing is not null and btrim(p_viewing) <> '' then
    update public.chat_conversations
       set viewing = left(btrim(p_viewing), 300), viewing_at = now()
     where id = v_conv.id;
  end if;

  select coalesce(
           json_agg(json_build_object(
             'id',     m.id,
             'sender', m.sender,
             'body',   m.body,
             'at',     m.created_at
           ) order by m.created_at),
           '[]'::json)
    into v_msgs
    from public.chat_messages m
   where m.conversation_id = v_conv.id
     and (p_after is null or m.created_at > p_after);

  return json_build_object(
    'status',   v_conv.status,
    'unread',   v_conv.customer_unread,
    'named',    (v_conv.name is not null),
    'messages', v_msgs
  );
end;
$$;


-- 7) Who may call them ------------------------------------------------

revoke all on function public.chat_start(text, text, text, text)     from public;
revoke all on function public.chat_identify(text, text, text, text)  from public;
revoke all on function public.chat_claim(text)                       from public;
revoke all on function public.chat_resume()                          from public;
revoke all on function public.chat_poll(text, timestamptz, text)     from public;

grant execute on function public.chat_start(text, text, text, text)    to anon, authenticated;
grant execute on function public.chat_identify(text, text, text, text) to anon, authenticated;
grant execute on function public.chat_poll(text, timestamptz, text)    to anon, authenticated;
-- These two answer only to somebody signed in, and return nothing at
-- all to anyone who is not. Granted to anon so that a page whose
-- session is still loading gets an empty answer rather than an error.
grant execute on function public.chat_claim(text)                      to anon, authenticated;
grant execute on function public.chat_resume()                         to anon, authenticated;

-- =====================================================================
-- Done. To check it took:
--   select column_name from information_schema.columns
--    where table_name = 'chat_conversations' and column_name = 'viewing';
-- =====================================================================
