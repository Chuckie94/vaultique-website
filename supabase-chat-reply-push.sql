-- =====================================================================
-- Vaultique Boutique Point: TELLING A CUSTOMER THE SHOP HAS REPLIED
-- (website build 83)
-- Run once in this WEBSITE's Supabase SQL Editor, after
-- supabase-hardening.sql. Not the platform's.
--
--   Supabase -> SQL Editor -> New query -> paste all of this -> Run
--
-- That is all: supabase-hardening.sql does not need running again for
-- it, because this file opens its own four doors to the chat window. If
-- you ever do run the hardening again, use this build's copy or a later
-- one: it keeps these doors open, and its report has a line for them.
-- Safe to run again. It changes no conversation, message or setting. Run
-- in the wrong project, or before the files it stands on, it stops at
-- step 1 and creates nothing.
--
-- WHAT IT ADDS
--
--   * chat_reply_push: the browsers a customer has asked to be told on,
--     one row per browser per conversation. The address is the one the
--     browser's own push service gave it, and the two keys are what the
--     notification is encrypted to, so the push service cannot read it.
--     No name, phone or email is kept here. Nobody can read the table or
--     write to it directly; the chat window goes through the four doors
--     below, and the notification function reads it with the service key.
--     When the conversation ends (the customer presses End, or the shop
--     closes it) its rows are deleted at once, and a row more than a week
--     old is deleted whenever another browser is added. A conversation
--     that is deleted takes its rows with it.
--
--   * Four doors for the chat window, each opened only with that
--     conversation's own token, like every other call the window makes:
--       chat_reply_push_key    the address notifications are signed with
--                              (public by nature: it is the same one the
--                              shop's own phones use)
--       chat_reply_push_save   "tell this browser when the shop replies"
--       chat_reply_push_has    is this browser already on the list?
--       chat_reply_push_drop   "stop telling this browser"
--
--   * A nudge: when somebody in the shop replies in a conversation that
--     has a browser on the list, the website's notification function
--     (netlify/functions/chat-push.js, the one the shop's phones already
--     use) is told, the same way it is told when a customer writes. It
--     sends a notification that says only that the shop has replied.
--
-- WHAT IT NEEDS. The shop's own phone notifications set up once (the owner
-- presses "Notify me here" in Live Chats): that is what tells the
-- database the website's address and keys. The result line says so.
-- =====================================================================


-- 1) THE RIGHT DATABASE, WITH WHAT THIS STANDS ON? ----------------------------
do $guard$
begin
  if to_regclass('public.app_state') is not null then
    raise exception 'This is the platform''s database (it has app_state). Run this in the WEBSITE''s Supabase. Nothing was created.';
  end if;
  if to_regclass('public.chat_conversations') is null or to_regclass('public.chat_messages') is null then
    raise exception 'This website has no live chat yet. Run supabase-chat.sql and the chat files after it first. Nothing was created.';
  end if;
  if to_regclass('public.chat_push') is null then
    raise exception 'The shop''s own chat notifications are not here yet. Run supabase-chat-phase7.sql first. Nothing was created.';
  end if;
end
$guard$;


-- 2) THE BROWSERS A CUSTOMER HAS ASKED TO BE TOLD ON ---------------------------
create table if not exists public.chat_reply_push (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  endpoint        text not null check (length(endpoint) between 10 and 1000),
  p256dh          text not null check (length(p256dh) between 10 and 200),
  auth            text not null check (length(auth) between 8 and 100),
  created_at      timestamptz not null default now(),
  -- A browser that has been uninstalled or had notifications revoked is
  -- dropped by the sender; one that fails three times in a row as well.
  fails           int not null default 0,
  unique (conversation_id, endpoint)
);
create index if not exists chat_reply_push_conv on public.chat_reply_push (conversation_id);

alter table public.chat_reply_push enable row level security;
-- No policy at all, on purpose: not readable or writable by anybody but
-- the four doors below and the service key.
revoke all on public.chat_reply_push from public, anon, authenticated;
grant all on public.chat_reply_push to service_role;


-- 3) THE CHAT WINDOW'S FOUR DOORS --------------------------------------------------
create or replace function public.chat_reply_push_key()
returns text
language sql
stable
security definer
set search_path = ''
as $k$
  select data->>'vapidPublic' from public.site_settings_private where key = 'chat_push';
$k$;

create or replace function public.chat_reply_push_save(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $s$
declare
  v_id uuid;
begin
  if p_token is null or length(p_token) < 10 or length(p_token) > 200 then return false; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then return false; end if;
  if p_p256dh is null or length(p_p256dh) not between 10 and 200 then return false; end if;
  if p_auth is null or length(p_auth) not between 8 and 100 then return false; end if;

  select c.id into v_id from public.chat_conversations c where c.token = p_token and c.status = 'open';
  if v_id is null then return false; end if;

  insert into public.chat_reply_push (conversation_id, endpoint, p256dh, auth)
  values (v_id, p_endpoint, p_p256dh, p_auth)
  on conflict (conversation_id, endpoint)
    do update set p256dh = excluded.p256dh, auth = excluded.auth, fails = 0;

  -- Five browsers for one conversation at most: the oldest goes.
  delete from public.chat_reply_push
   where id in (select r.id from public.chat_reply_push r
                 where r.conversation_id = v_id
                 order by r.created_at desc offset 5);
  -- And any browser, in any conversation, asked more than a week ago: a
  -- conversation nobody ended does not keep its browsers for ever.
  delete from public.chat_reply_push where created_at < now() - interval '7 days';
  return true;
end
$s$;

create or replace function public.chat_reply_push_has(p_token text, p_endpoint text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $h$
  select exists (
    select 1 from public.chat_reply_push r
      join public.chat_conversations c on c.id = r.conversation_id
     where c.token = p_token and r.endpoint = p_endpoint);
$h$;

create or replace function public.chat_reply_push_drop(p_token text, p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $d$
  delete from public.chat_reply_push r
   using public.chat_conversations c
   where c.id = r.conversation_id and c.token = p_token and r.endpoint = p_endpoint;
$d$;


-- 4) THE NUDGE -------------------------------------------------------------------
-- pg_net posts and does not wait, and everything is inside an exception
-- block, as for the shop's own nudge (supabase-chat-phase7.sql): nothing
-- here may stop a reply being saved. A conversation with no browser on the
-- list costs nothing at all: the function is not even called.
create or replace function public.chat_nudge_reply()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $n$
declare
  cfg jsonb;
begin
  if new.sender <> 'shop' then return new; end if;
  begin
    if not exists (select 1 from public.chat_reply_push where conversation_id = new.conversation_id) then
      return new;
    end if;
    select data into cfg from public.site_settings_private where key = 'chat_push';
    if cfg is null or coalesce(cfg->>'siteUrl', '') = '' then return new; end if;

    perform net.http_post(
      url     := rtrim(cfg->>'siteUrl', '/') || '/.netlify/functions/chat-push',
      body    := jsonb_build_object(
                   'kind',         'reply',
                   'conversation', new.conversation_id,
                   'message',      new.id),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'X-Chat-Hook',  cfg->>'secret'),
      timeout_milliseconds := 4000
    );
  exception when others then
    null;   -- a missed notification is a missed notification; a lost reply is not
  end;
  return new;
end
$n$;

drop trigger if exists chat_nudge_reply_t on public.chat_messages;
create trigger chat_nudge_reply_t
  after insert on public.chat_messages
  for each row execute function public.chat_nudge_reply();


-- 4b) WHEN THE CHAT ENDS ------------------------------------------------------------
-- There is nobody left to tell, so the conversation's browsers are let go
-- the moment it stops being open: the customer pressing End (chat_end),
-- or somebody in the shop closing it.
create or replace function public.chat_reply_push_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  if new.status is distinct from 'open' then
    delete from public.chat_reply_push where conversation_id = new.id;
  end if;
  return new;
end
$f$;

drop trigger if exists chat_reply_push_forget_t on public.chat_conversations;
create trigger chat_reply_push_forget_t
  after update of status on public.chat_conversations
  for each row when (old.status is distinct from new.status)
  execute function public.chat_reply_push_forget();


-- 5) WHO MAY CALL WHAT ------------------------------------------------------------
-- The four doors, for the chat window (each checks the conversation's own
-- token). The nudge and the letting go only from inside the database.
-- supabase-hardening.sql (build 83's copy and later) knows these four, so
-- running it again keeps them open.
revoke all on function public.chat_nudge_reply() from public, anon, authenticated;
revoke all on function public.chat_reply_push_forget() from public, anon, authenticated;
revoke all on function public.chat_reply_push_key() from public;
revoke all on function public.chat_reply_push_save(text, text, text, text) from public;
revoke all on function public.chat_reply_push_has(text, text) from public;
revoke all on function public.chat_reply_push_drop(text, text) from public;
grant execute on function public.chat_reply_push_key() to anon, authenticated, service_role;
grant execute on function public.chat_reply_push_save(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.chat_reply_push_has(text, text) to anon, authenticated, service_role;
grant execute on function public.chat_reply_push_drop(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- 6) THE RESULT -----------------------------------------------------------------------
select case when to_regclass('public.chat_reply_push') is not null then 'OK' else 'MISSING' end as browsers_list,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('chat_reply_push_key', 'chat_reply_push_save', 'chat_reply_push_has', 'chat_reply_push_drop')
                     and has_function_privilege('anon', p.oid, 'execute')) = 4
            then 'OK · the chat window can offer it' else 'CLOSED to the chat window' end as doors,
       case when exists (select 1 from pg_trigger where tgname = 'chat_nudge_reply_t' and not tgisinternal)
             and exists (select 1 from pg_trigger where tgname = 'chat_reply_push_forget_t' and not tgisinternal)
            then 'OK' else 'MISSING' end as nudge,
       case when exists (select 1 from public.site_settings_private
                          where key = 'chat_push' and coalesce(data->>'siteUrl', '') <> '' and coalesce(data->>'vapidPublic', '') <> '')
            then 'OK · notifications are set up'
            else 'NOT YET: in the admin, open Live Chats and press Notify me here, once' end as shop_notifications,
       'Done. The hardening does not need running again; if you ever run it, use build 83''s copy or later' as next;
