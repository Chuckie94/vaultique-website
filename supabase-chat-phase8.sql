-- =====================================================================
-- Live chat, phase 8: a green dot while somebody is typing
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again. Nothing to fill in.
-- =====================================================================
--
-- Two timestamps, one each way, and nothing more. "Is somebody typing"
-- is not a fact worth storing — it is a fact worth having recently, so
-- what is stored is WHEN, and both sides work out for themselves whether
-- that was recent enough to matter.
--
-- WHY A TIMESTAMP RATHER THAN A FLAG. A flag has to be turned off, and
-- the one thing that is certain about a browser is that it will
-- sometimes be closed mid-word. A flag left on shows a dot that breathes
-- for ever under a conversation nobody is in. A timestamp goes stale by
-- itself, so the only way to keep the dot alive is to keep typing.
--
-- SIX SECONDS. Both sides ask every three, and both send at most one of
-- these every two while somebody is typing. Six is two pings' grace: one
-- can be lost to a bad moment on the network without the dot blinking
-- out in front of somebody who is still writing.
-- ---------------------------------------------------------------------

alter table public.chat_conversations
  add column if not exists customer_typing_at timestamptz,
  add column if not exists shop_typing_at     timestamptz;

-- ---------------------------------------------------------------------
-- The customer saying they are writing.
--
-- Through a function, like everything else on that side: the customer's
-- browser holds a token and no standing at all, and chat_conversations
-- is closed to it. This writes one column of one row and returns
-- nothing, so the token buys exactly this and no reading.
-- ---------------------------------------------------------------------
create or replace function public.chat_typing(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set customer_typing_at = now()
   where token = p_token
     and status = 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- And the shop saying it.
--
-- Only somebody who may actually speak in the conversation. A dot that
-- breathes under a conversation the person cannot reply in would be a
-- promise the panel then refuses to keep — chat_may_speak_in() is the
-- same rule the reply box and the insert trigger use, asked once here
-- so the three cannot drift apart.
-- ---------------------------------------------------------------------
create or replace function public.chat_typing_shop(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.chat_may_speak_in(p_conversation) then return; end if;

  update public.chat_conversations
     set shop_typing_at = now()
   where id = p_conversation
     and status = 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- And the shop asking whether the customer is.
--
-- Through a function, deliberately, even though the panel could select
-- the column directly — it did, at first, and that is exactly why the
-- dot appeared on the customer's side and not on the shop's.
--
-- PostgREST keeps a cache of the table layout. A column added by a
-- migration is not in that cache until it reloads, so asking for
-- customer_typing_at by name came back as an error until it did, and
-- the panel treats an error here as "nobody is typing" — silently, as
-- it should, because a dot is not worth an alarm. The customer's side
-- never had the problem because it reads through chat_poll, which is a
-- function and so has no column names in the request at all.
--
-- A function on this side too means both halves work the same way and
-- neither can be broken by a cache. The reload below makes it moot in
-- any case, and it is here as well because belt and braces cost nothing.
-- ---------------------------------------------------------------------
create or replace function public.chat_typing_peek(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_conversations c
     where c.id = p_conversation
       and c.status = 'open'
       and c.customer_typing_at is not null
       and c.customer_typing_at > now() - interval '6 seconds'
       -- Only somebody who is actually answering may ask.
       and public.chat_may_answer()
  );
$$;

-- ---------------------------------------------------------------------
-- Sending clears your own.
--
-- Without this the dot hangs about for up to six seconds after the
-- message it was promising has already arrived — which reads as a
-- second message coming that never does. The message and the dot are
-- the same event, so they end together.
-- ---------------------------------------------------------------------
create or replace function public.chat_typing_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender = 'shop' then
    update public.chat_conversations
       set shop_typing_at = null where id = new.conversation_id;
  else
    update public.chat_conversations
       set customer_typing_at = null where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_typing_done_t on public.chat_messages;
create trigger chat_typing_done_t
  after insert on public.chat_messages
  for each row execute function public.chat_typing_done();

-- ---------------------------------------------------------------------
-- What the customer's window is told.
--
-- This is chat_poll from supabase-chat-phase4.sql with one line added —
-- 'typing'. It is reproduced whole rather than patched because there is
-- no way to add a field to a function's result without writing the
-- function again, and a version of it that differed anywhere else would
-- be a bug nobody would think to look for.
--
-- Note it answers only whether the SHOP is typing. The customer knows
-- perfectly well whether they are.
-- ---------------------------------------------------------------------
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
             'at',     m.created_at,
             -- Null for almost every row, and never set by anything a
             -- customer can call. See the note at the top.
             'meta',   m.meta
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
    -- Nothing waiting on the shop's side means the shop has read it.
    -- Only ever a count of this conversation's own messages, so it says
    -- nothing about anybody else's.
    'seen',     coalesce(v_conv.shop_unread, 0) = 0,
    -- Whether there is somebody there to answer. Away is not answering:
    -- an operator who says so should not leave a green light burning on
    -- the customer's window, which is what "not offline" did.
    'here',     exists (
                  select 1 from public.chat_agents a
                   where a.status = 'online'
                     and a.last_seen_at > now() - interval '2 minutes'),
    -- Somebody at the shop is writing, as of a moment ago.
    'typing',   (v_conv.shop_typing_at is not null
                 and v_conv.shop_typing_at > now() - interval '6 seconds'),
    'messages', v_msgs
  );
end;
$$;

revoke all on function public.chat_typing(text)      from public;
revoke all on function public.chat_typing_shop(uuid) from public;
revoke all on function public.chat_typing_peek(uuid) from public;
-- The customer's side is anon, like the other four it already calls.
grant execute on function public.chat_typing(text)      to anon, authenticated;
grant execute on function public.chat_typing_shop(uuid) to authenticated;
grant execute on function public.chat_typing_peek(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Tell PostgREST the shape of things has changed.
--
-- Two new columns and three new functions. Supabase usually notices on
-- its own, but "usually" is what made the shop's own dot invisible while
-- the customer's worked — so it is asked for here rather than waited on.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Checking it took
--
--   select customer_typing_at, shop_typing_at
--     from public.chat_conversations limit 5;
--
-- Both null until somebody types. Open the website in one window and
-- Live Chats in another, and start writing in either.
-- ---------------------------------------------------------------------
