-- =====================================================================
-- Vaultique Boutique Point — live chat (Phase 1)
-- ---------------------------------------------------------------------
-- Run this ONCE in the SQL editor of the WEBSITE Supabase project, the
-- same one supabase-setup.sql was run in. It is separate from that file
-- so the setup you already ran stays exactly as it is.
--
-- It ADDS two tables, one trigger and four functions. It alters nothing
-- that already exists, and it never touches the POS project.
--
-- Safe to run more than once.
--
-- ---------------------------------------------------------------------
-- How a guest can chat safely
--
-- A customer chatting has no account, so there is no auth.uid() to hang
-- a rule on. Rather than open the tables to everyone with the anon key,
-- the tables are closed to everyone EXCEPT admins, and the customer's
-- side of the conversation goes through the four functions below.
--
-- Each conversation carries a token: 24 random bytes the SERVER makes,
-- handed once to the browser that started it and kept there. Holding
-- the token is what proves a browser owns a conversation, so the
-- functions ask for it and the tables themselves stay shut. A token
-- nobody has is a conversation nobody can read, and guessing one means
-- guessing 192 bits.
-- =====================================================================

-- 1) The tables -------------------------------------------------------

create table if not exists public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  token            text unique not null,          -- the browser's proof of ownership
  customer_id      uuid references public.customers(id) on delete set null,
  name             text,
  phone            text,
  email            text,
  status           text not null default 'open',  -- open | closed
  last_message_at  timestamptz not null default now(),
  shop_unread      int not null default 0,        -- waiting for the shop to read
  customer_unread  int not null default 0,        -- waiting for the customer to read
  created_at       timestamptz not null default now()
);

-- The operator's list is "most recently spoken in, first", every time.
create index if not exists chat_conv_recent
  on public.chat_conversations (last_message_at desc);

create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
                     references public.chat_conversations(id) on delete cascade,
  sender           text not null check (sender in ('customer', 'shop')),
  body             text not null,
  created_at       timestamptz not null default now()
);

-- One conversation's messages, in order: the only way either side reads.
create index if not exists chat_msg_conv
  on public.chat_messages (conversation_id, created_at);


-- 2) Row Level Security ----------------------------------------------
-- Admins, and nobody else. There is deliberately no policy for anon:
-- a table with RLS on and no policy that matches denies everything, so
-- the anon key cannot read one message or write one row directly. The
-- customer's own access is the four functions in section 4, and only
-- what they choose to return.

alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;

drop policy if exists chc_admin on public.chat_conversations;
create policy chc_admin on public.chat_conversations for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists chm_admin on public.chat_messages;
create policy chm_admin on public.chat_messages for all
  using (public.is_admin()) with check (public.is_admin());


-- 3) Counters that cannot drift --------------------------------------
-- Whoever wrote the message, the conversation is stamped by the same
-- trigger. Left to each caller these would be two sets of arithmetic
-- free to disagree, and an unread badge that lies is worse than none.

create or replace function public.chat_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set last_message_at = new.created_at,
         shop_unread     = case when new.sender = 'customer'
                                then shop_unread + 1 else shop_unread end,
         customer_unread = case when new.sender = 'shop'
                                then customer_unread + 1 else customer_unread end
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_msg_touch on public.chat_messages;
create trigger chat_msg_touch
  after insert on public.chat_messages
  for each row execute function public.chat_touch();


-- 4) The customer's side ----------------------------------------------
-- Four functions, each asking for the token. They run as their owner so
-- they can see past the policies above, which is the whole point: they
-- are the narrow door in a wall with no other opening.

-- Start a conversation. Returns the token, which the browser keeps.
create or replace function public.chat_start(
  p_name text default null,
  p_phone text default null,
  p_email text default null
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

  -- Only when the signed-in person actually has a customer row: a
  -- conversation must not fail to start over a foreign key.
  select c.id into v_customer from public.customers c where c.id = auth.uid();

  insert into public.chat_conversations (token, name, phone, email, customer_id)
  values (
    v_token,
    nullif(btrim(coalesce(p_name,  '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    v_customer
  );

  return v_token;
end;
$$;

-- Say something. Returns when it was said.
create or replace function public.chat_send(p_token text, p_body text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_at   timestamptz;
  v_body text;
begin
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'empty message';
  end if;
  -- Long enough for anything a customer means to say, short enough that
  -- the table cannot be filled by one caller in one call.
  v_body := left(v_body, 2000);

  select id into v_id
    from public.chat_conversations
   where token = p_token and status = 'open';
  if v_id is null then
    raise exception 'no open conversation';
  end if;

  insert into public.chat_messages (conversation_id, sender, body)
  values (v_id, 'customer', v_body)
  returning created_at into v_at;

  return v_at;
end;
$$;

-- Everything the customer's window needs in one round trip: whatever is
-- newer than it has, and the state of the conversation around it.
create or replace function public.chat_poll(
  p_token text,
  p_after timestamptz default null
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

  -- An unknown token is not an error to explain; it is simply nothing.
  if v_conv.id is null then
    return null;
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
    'messages', v_msgs
  );
end;
$$;

-- The customer has the window open and has read what is in it.
create or replace function public.chat_seen(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set customer_unread = 0
   where token = p_token;
end;
$$;


-- 5) Who may call them ------------------------------------------------
-- The functions, to everybody; the tables, to nobody. A customer with
-- the anon key can start, send, poll and mark read, and can do nothing
-- else to either table.

revoke all on function public.chat_start(text, text, text)    from public;
revoke all on function public.chat_send(text, text)           from public;
revoke all on function public.chat_poll(text, timestamptz)    from public;
revoke all on function public.chat_seen(text)                 from public;

grant execute on function public.chat_start(text, text, text) to anon, authenticated;
grant execute on function public.chat_send(text, text)        to anon, authenticated;
grant execute on function public.chat_poll(text, timestamptz) to anon, authenticated;
grant execute on function public.chat_seen(text)              to anon, authenticated;

-- =====================================================================
-- Done. Nothing above alters a table you already had.
--
-- To check it took, in the SQL editor:
--   select count(*) from public.chat_conversations;   -- 0, and no error
-- =====================================================================
