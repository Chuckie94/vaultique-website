-- =====================================================================
-- Live Chat — telling both sides at once, instead of asking every few
-- seconds
--
-- RUN THIS IN THE **WEBSITE'S** SUPABASE PROJECT, after the chat phases.
-- Safe to run again. Nothing to fill in.
--
-- WHAT CHANGES. Nothing about how a message is sent, stored, read or
-- permitted. The only thing that changes is HOW SOON each side finds
-- out that there is something new to read.
--
-- THE TWO SIDES CANNOT WORK THE SAME WAY, and this is the whole design.
--
-- THE OPERATOR is signed in and is an administrator, and the chat tables
-- already have a policy that lets an administrator read them. So the
-- admin page can listen to the tables directly — Postgres changes,
-- straight down the socket — and all this file does for them is put the
-- two tables into the publication that carries such things.
--
-- THE CUSTOMER cannot, and must not. A guest has no policy on these
-- tables at all: that is precisely what stops one customer reading
-- another's conversation, and Realtime obeys the same policies as
-- everything else. Handing a guest a table subscription would mean
-- opening the table, which is the one thing that must not happen.
--
-- So the customer is not sent the message. They are sent a NUDGE: an
-- empty signal on a channel named after their own conversation, which
-- their browser answers by calling chat_poll exactly as it does today.
-- The signal carries no message, no name, no id and no count — read by
-- a stranger it says only "something happened". The words still come
-- back through the same function, past the same checks, as the only way
-- a customer has ever read them.
--
-- THE CHANNEL NAME IS A HASH, NOT THE TOKEN. The token is the
-- customer's proof that the conversation is theirs, so it is not put
-- somewhere a channel list would show it. sha256 of it names the
-- channel instead: the browser can work out its own channel name and
-- nobody can work backwards from a channel name to a token.
--
-- IF THIS FILE IS NEVER RUN, or if Realtime is switched off, or if the
-- socket cannot be opened: both sides carry on asking on a timer, as
-- they always have. That is not a fallback bolted on afterwards — it is
-- the same loop that has been running all along, left in place and
-- slowed down once the socket proves itself.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1. The operator's side: let Realtime carry the two tables.
--
-- The policies are untouched. A table in this publication is still read
-- through exactly the rules it had — which for these two means
-- administrators and nobody else.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception when others then
  raise notice 'chat_messages not added to the realtime publication: %', sqlerrm;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_conversations'
  ) then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
exception when others then
  raise notice 'chat_conversations not added to the realtime publication: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- STEP 2. What a customer's channel is called.
--
-- Built from the token and nothing else, so a browser holding the token
-- can work out its own name and no two conversations share one. sha256
-- is built into Postgres and into every browser, so neither side needs
-- an extension or a library to agree on the answer.
-- ---------------------------------------------------------------------
create or replace function public.chat_channel(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_token is null or btrim(p_token) = '' then null
           else 'vbp-chat-' || encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
         end;
$$;


-- ---------------------------------------------------------------------
-- STEP 3. The nudge.
--
-- Fired after a message lands and after a conversation's own row moves —
-- which is what carries "the shop is typing", "somebody read it",
-- "closed", and whether anybody is at the desk.
--
-- IT SENDS NOTHING. The payload is a word saying which of the two
-- happened, so the browser can decide whether to redraw at all, and not
-- one character of what was written.
--
-- EVERY FAILURE IS SWALLOWED, and that is deliberate rather than lazy: a
-- project without Realtime, a project where realtime.send has a
-- different shape, a socket that is not there. In every one of those
-- cases a message must still be saved. The worst this file can do to a
-- shop is nothing at all.
-- ---------------------------------------------------------------------
create or replace function public.chat_nudge_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_topic text;
begin
  if tg_table_name = 'chat_messages' then
    select c.token into v_token
      from public.chat_conversations c where c.id = new.conversation_id;
  else
    v_token := new.token;
  end if;

  v_topic := public.chat_channel(v_token);
  if v_topic is null then return new; end if;

  begin
    perform realtime.send(
      json_build_object('what', tg_table_name)::jsonb,
      'nudge',
      v_topic,
      false                       -- a public topic: see the note on hashing
    );
  exception when others then
    -- No Realtime here, or a different signature. Both sides are already
    -- covered by the timer they never stopped running.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists chat_msg_nudge_customer on public.chat_messages;
create trigger chat_msg_nudge_customer
  after insert on public.chat_messages
  for each row execute function public.chat_nudge_customer();

-- Typing, seen, closed, and who is at the desk all reach the customer
-- through this row rather than through a message.
drop trigger if exists chat_conv_nudge_customer on public.chat_conversations;
create trigger chat_conv_nudge_customer
  after update on public.chat_conversations
  for each row
  when (old.last_message_at is distinct from new.last_message_at
     or old.status          is distinct from new.status
     or old.shop_unread     is distinct from new.shop_unread
     or old.customer_unread is distinct from new.customer_unread)
  execute function public.chat_nudge_customer();

revoke all on function public.chat_channel(text) from public;
grant execute on function public.chat_channel(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- STEP 4. Check it.
-- ---------------------------------------------------------------------
select tablename as broadcasting
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('chat_messages', 'chat_conversations')
 order by tablename;
-- Expect two rows. None means Realtime will not carry the operator's
-- side and the admin page will go on asking on its timer, which still
-- works and is simply slower.

select public.chat_channel('example-token') as channel_name_looks_like;
-- Expect one 'vbp-chat-' followed by sixty-four hex characters.


-- =====================================================================
-- TO UNDO ALL OF THIS
--
--   drop trigger if exists chat_msg_nudge_customer on public.chat_messages;
--   drop trigger if exists chat_conv_nudge_customer on public.chat_conversations;
--   drop function if exists public.chat_nudge_customer();
--   drop function if exists public.chat_channel(text);
--   alter publication supabase_realtime drop table public.chat_messages;
--   alter publication supabase_realtime drop table public.chat_conversations;
--
-- Both sides fall straight back to asking on a timer. Nobody loses a
-- message and nothing needs redeploying.
-- =====================================================================
