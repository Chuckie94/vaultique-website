-- ===========================================================================
-- A stand-in for the chat schema, so tests/chat-jobs.sql can be run against a
-- plain empty Postgres.
--
-- It is NOT a copy of the whole feature. It is the parts supabase-chat-jobs.sql
-- actually touches or has to survive, lifted from the files that create them:
--
--   chat_conversations, chat_messages   supabase-chat.sql
--   chat_touch + its trigger            supabase-chat-phase3.sql
--   chat_agents                         supabase-chat-phase3.sql
--   chat_may_answer                     supabase-chat-phase10.sql
--   chat_may_speak_in, chat_one_voice   supabase-chat-phase7.sql
--   site_settings, admins, is_admin     supabase-setup.sql / phase 10
--
-- chat_one_voice is here on purpose and is the point of half the tests: it is
-- the rule that refuses a 'shop' message from a session that may not answer,
-- and the filter has to deliver its notice without tripping it and without
-- losing the customer's own message.
--
--   dropdb --if-exists vq_chat && createdb vq_chat
--   psql -d vq_chat -f tests/chat-jobs-fixture.sql \
--                   -f supabase-chat-jobs.sql \
--                   -f tests/chat-jobs.sql
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;

create schema if not exists auth;
create table if not exists auth.whoami (id uuid);
create or replace function auth.uid() returns uuid language sql stable as $$
  select id from auth.whoami limit 1;
$$;

create table if not exists public.admins (
  id uuid primary key, email text, role text not null default 'agent',
  active boolean not null default true
);
create table if not exists public.site_settings (
  key text primary key, data jsonb not null default '{}'::jsonb
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;
create or replace function public.is_shop_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.id = auth.uid() and a.role = 'owner');
$$;

create table if not exists public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  token            text unique not null,
  name             text,
  status           text not null default 'open',
  last_message_at  timestamptz not null default now(),
  shop_unread      int not null default 0,
  customer_unread  int not null default 0,
  first_reply_at   timestamptz,
  assigned_to      uuid,
  created_at       timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.chat_conversations(id) on delete cascade,
  sender           text not null constraint chat_messages_sender_check
                     check (sender in ('customer', 'shop')),
  body             text not null,
  meta             jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists public.chat_agents (
  id uuid primary key, display_name text,
  status text not null default 'online', last_seen_at timestamptz default now()
);

-- phase 3's counter trigger, verbatim in behaviour.
create or replace function public.chat_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_conversations
     set last_message_at = new.created_at,
         shop_unread     = case when new.sender = 'customer' then shop_unread + 1 else shop_unread end,
         customer_unread = case when new.sender = 'shop' then customer_unread + 1 else customer_unread end,
         first_reply_at  = case when new.sender = 'shop' and first_reply_at is null
                                then new.created_at else first_reply_at end
   where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists chat_msg_touch on public.chat_messages;
create trigger chat_msg_touch after insert on public.chat_messages
  for each row execute function public.chat_touch();

create or replace function public.chat_may_answer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
     and coalesce((select a.active from public.admins a where a.id = auth.uid()), true);
$$;
create or replace function public.chat_holder_present(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_agents a
                  where a.id = p_id and a.status = 'online'
                    and a.last_seen_at > now() - interval '2 minutes');
$$;
create or replace function public.chat_may_speak_in(p_conversation uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_holder uuid; v_found boolean;
begin
  if not public.chat_may_answer() then return false; end if;
  if public.is_shop_owner() then return true; end if;
  select c.assigned_to, true into v_holder, v_found
    from public.chat_conversations c where c.id = p_conversation;
  if v_found is not true then return true; end if;
  if v_holder is null or v_holder = auth.uid() then return true; end if;
  return not public.chat_holder_present(v_holder);
end;
$$;

-- phase 7's one-voice rule. The reason the notice cannot be a 'shop' message.
create or replace function public.chat_one_voice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender <> 'shop' then return new; end if;
  if public.chat_may_speak_in(new.conversation_id) then return new; end if;
  raise exception 'That conversation is with somebody else.';
end;
$$;
drop trigger if exists chat_one_voice_t on public.chat_messages;
create trigger chat_one_voice_t before insert on public.chat_messages
  for each row execute function public.chat_one_voice();

insert into public.admins (id, email, role)
values ('11111111-1111-1111-1111-111111111111', 'owner@vaultique.test', 'owner')
on conflict (id) do nothing;
