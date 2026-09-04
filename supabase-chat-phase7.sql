-- =====================================================================
-- Live chat, phase 7: a conversation belongs to one person, and the
-- phone buzzes when a customer writes
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again.
-- =====================================================================
--
-- Two things, and they belong together: the point of both is that a
-- customer is not left waiting.
--
--   * TAKING ONE. Until now `assigned_to` was a label. Anybody could
--     take a conversation somebody else was in the middle of, and two
--     people could answer the same customer over each other. Now it is
--     a lock, enforced here rather than by the page — a rule the
--     browser merely honours is a request.
--
--   * HANDING IT OVER. A lock with no way out is worse than none: a
--     conversation held by somebody who has gone home would wait for
--     ever. So there are three ways out, and they are all in
--     chat_may_speak_in() below where they can be read together.
--
--   * THE BUZZ. A customer's message fires a webhook at the website,
--     which sends a push to every device that asked for one. It is
--     wrapped so that it can never stop a message being saved: a
--     notification that fails is a missed buzz, and a message that
--     fails is a lost customer.
--
-- WHAT YOU HAVE TO DO: run this file. That is all — there is nothing in
-- it to fill in or check. The keys below were generated for this shop
-- and are written into site_settings_private, which has no public read
-- policy: the website cannot read it and neither can a customer.
--
-- The one thing this file cannot know is the address the shop's website
-- answers at, so it does not guess. The first time the owner opens Live
-- Chats, the browser tells the database the address it is being used at.
-- ---------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Devices that have asked to be told
--
-- One row per browser per person. The endpoint is the address Google or
-- Mozilla gave that browser; the two keys are what the message is
-- encrypted to, so nobody between here and the phone can read it —
-- including the push service itself.
-- ---------------------------------------------------------------------
create table if not exists public.chat_push (
  id          uuid primary key default gen_random_uuid(),
  person      uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  label       text,                       -- "Chrome on Android", so devices can be told apart
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  -- A browser that has been uninstalled or had notifications revoked
  -- answers 404 or 410 for ever. Counted, and dropped at three.
  fails       int not null default 0
);

create index if not exists chat_push_person on public.chat_push (person);

alter table public.chat_push enable row level security;

-- Your own devices, and only your own. The sender reads them all, but
-- it does that with the service role key from outside these rules.
drop policy if exists cp_own on public.chat_push;
create policy cp_own on public.chat_push for all
  using (person = auth.uid()) with check (person = auth.uid());

-- ---------------------------------------------------------------------
-- 2) A conversation belongs to one person
--
-- Three ways somebody other than the holder may speak in a conversation,
-- and no fourth:
--
--   * nobody holds it;
--   * you are the shop owner, who can always step in;
--   * the holder is not at the desk — their browser has stopped saying
--     so for five minutes, or they have marked themselves away.
--
-- Five minutes rather than the two the presence bar uses. Two is right
-- for a green light and wrong for taking somebody's work away from them:
-- a person reading a long message is not a person who has gone.
--
-- "Away" counts as gone on purpose. Away means present but not
-- answering, and a customer should not wait behind somebody who has
-- said they are not answering.
-- ---------------------------------------------------------------------
create or replace function public.chat_holder_present(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_agents a
     where a.id = p_agent
       and a.status = 'online'
       and a.last_seen_at > now() - interval '5 minutes'
  );
$$;

create or replace function public.chat_may_speak_in(p_conversation uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_holder uuid;
  v_found  boolean;
begin
  if not public.chat_may_answer() then return false; end if;
  if public.is_shop_owner() then return true; end if;

  select c.assigned_to, true into v_holder, v_found
    from public.chat_conversations c where c.id = p_conversation;

  -- No such conversation. Nothing to protect, and the insert will fail
  -- on its own foreign key rather than on a permission that reads as a
  -- different fault.
  if v_found is not true then return true; end if;

  if v_holder is null or v_holder = auth.uid() then return true; end if;
  return not public.chat_holder_present(v_holder);
end;
$$;

-- The name of whoever has it, for a message worth reading. Null when
-- nobody has it or the caller may speak anyway.
create or replace function public.chat_held_by(p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.display_name
    from public.chat_conversations c
    join public.chat_agents a on a.id = c.assigned_to
   where c.id = p_conversation;
$$;

-- ---------------------------------------------------------------------
-- Taking one, letting it go, and handing it over — one function, because
-- they are the same act with a different destination.
-- ---------------------------------------------------------------------
create or replace function public.chat_assign(
  p_conversation uuid,
  p_agent        uuid default null      -- null releases it back to the room
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holder uuid;
  v_name   text;
begin
  if not public.chat_may_answer() then
    raise exception 'not permitted';
  end if;

  select assigned_to into v_holder
    from public.chat_conversations where id = p_conversation;

  /* Taking one out of somebody else's hands, which is the thing this
     phase exists to stop. The same three ways out as speaking in it —
     asked through the one function so the two can never drift apart. */
  if v_holder is not null and v_holder <> auth.uid()
     and not public.chat_may_speak_in(p_conversation) then
    select display_name into v_name from public.chat_agents where id = v_holder;
    raise exception 'That conversation is with %. Ask them to hand it over, or wait until they are away.',
      coalesce(v_name, 'somebody else');
  end if;

  update public.chat_conversations
     set assigned_to = p_agent,
         assigned_at = case when p_agent is null then null else now() end
   where id = p_conversation;
end;
$$;

-- ---------------------------------------------------------------------
-- And the same rule where it actually matters: the reply itself.
--
-- A page that hides a button is being polite. This is the rule. Only
-- the shop's own messages are checked — a customer writing into their
-- own conversation goes through chat_send, which runs as its owner and
-- has nothing to do with who is holding it.
-- ---------------------------------------------------------------------
create or replace function public.chat_one_voice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if new.sender <> 'shop' then return new; end if;
  if public.chat_may_speak_in(new.conversation_id) then return new; end if;

  select display_name into v_name
    from public.chat_agents a
    join public.chat_conversations c on c.assigned_to = a.id
   where c.id = new.conversation_id;

  raise exception 'That conversation is with %. Ask them to hand it over, or wait until they are away.',
    coalesce(v_name, 'somebody else');
end;
$$;

drop trigger if exists chat_one_voice_t on public.chat_messages;
create trigger chat_one_voice_t
  before insert on public.chat_messages
  for each row execute function public.chat_one_voice();

-- ---------------------------------------------------------------------
-- 3) The buzz
--
-- The keys the push service needs, kept in the private settings table:
-- no public read policy, so the website cannot read them and neither
-- can a customer. Only this shop's own functions and the sender, which
-- reads them with the service role key from outside these rules.
--
-- Written once. Running this file again leaves whatever is there,
-- so the keys never change under devices that have already subscribed —
-- changing them would silence every phone until it subscribed again.
-- ---------------------------------------------------------------------
insert into public.site_settings_private (key, data)
values ('chat_push', jsonb_build_object(
  'vapidPublic',  'BAwIM3PoXqqdmloCT-l3wymrUKhFTc_eFtnemss4NyPAoKBbpL99_7R_JBPYdGwzmOtY-JMobix3x1xZLZSVB9w',
  'vapidPrivate', '1ebigkWGU6PdDbHjDqhxLebRYHmkvD347GevngFMvRM',
  'secret',       '4ScGtkubiXPyCmdV5LQoVlVNtJPZWJyP',
  -- Deliberately blank. This is where the database sends the "somebody
  -- wrote" nudge, and it is the one value in this file that nobody can
  -- know but the shop — so nobody types it. The first time the owner
  -- opens Live Chats, the browser tells the database the address it is
  -- actually being used at, through chat_push_site() below.
  --
  -- Blank rather than a guess on purpose. The nudge is silent when it
  -- fails, by design, so a wrong address here would mean phones that
  -- never buzz and nothing anywhere saying why. Blank means no nudge at
  -- all until the address is known, which is a state that fixes itself.
  'siteUrl',      '',
  'subject',      'mailto:chimukachipini@gmail.com'
))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- The shop telling the database where it lives.
--
-- Called by the admin panel with the address the browser is looking at,
-- so it is right by construction and stays right if the shop moves to
-- another domain later.
--
-- OWNER ONLY, and that is a security boundary rather than tidiness. The
-- hook secret is sent to this address in a header. Somebody who could
-- point it at a machine of their own would be handed that secret, and
-- could then send the shop's phones whatever they liked. The owner can
-- already do anything; nobody else may touch this.
-- ---------------------------------------------------------------------
create or replace function public.chat_push_site(p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_now text;
begin
  if not public.is_shop_owner() then
    raise exception 'not permitted';
  end if;

  -- An origin and nothing else: https, a host, an optional port. No
  -- path, no query, no userinfo, and no http:// — a nudge carrying the
  -- secret must never go out unencrypted.
  if p_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' then
    raise exception 'That is not a website address.';
  end if;

  select data->>'siteUrl' into v_now
    from public.site_settings_private where key = 'chat_push';

  if v_now is not distinct from p_url then return v_now; end if;

  update public.site_settings_private
     set data = jsonb_set(data, '{siteUrl}', to_jsonb(p_url))
   where key = 'chat_push';

  return p_url;
end;
$$;

-- The public half, which a browser needs in order to subscribe at all.
-- It is public by design: it is what identifies this shop to Google's
-- and Mozilla's push services, and it can do nothing on its own.
create or replace function public.chat_push_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select data->>'vapidPublic' from public.site_settings_private where key = 'chat_push';
$$;

-- A device saying "tell me". Keyed on the endpoint, so the same browser
-- subscribing twice is one row rather than two buzzes.
create or replace function public.chat_push_save(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_label    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.chat_may_answer() then
    raise exception 'not permitted';
  end if;
  insert into public.chat_push (person, endpoint, p256dh, auth, label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 80))
  on conflict (endpoint) do update
    set person = auth.uid(),
        p256dh = excluded.p256dh,
        auth   = excluded.auth,
        label  = excluded.label,
        fails  = 0;
end;
$$;

create or replace function public.chat_push_drop(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_push
   where endpoint = p_endpoint and person = auth.uid();
end;
$$;

-- Whether this browser is already subscribed, which is what the button
-- in Live Chats reads to decide what to say.
create or replace function public.chat_push_has(p_endpoint text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_push
     where endpoint = p_endpoint and person = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- The nudge itself.
--
-- pg_net posts and does not wait, so nothing here delays a customer's
-- message. Everything is inside an exception block as well: a shop with
-- no pg_net, a wrong address, a website that is down — none of those may
-- stop a message being saved. A missed buzz is a missed buzz. A lost
-- message is a lost customer.
-- ---------------------------------------------------------------------
create or replace function public.chat_nudge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg jsonb;
begin
  if new.sender <> 'customer' then return new; end if;

  begin
    select data into cfg from public.site_settings_private where key = 'chat_push';
    if cfg is null or coalesce(cfg->>'siteUrl', '') = '' then return new; end if;

    perform net.http_post(
      url     := rtrim(cfg->>'siteUrl', '/') || '/.netlify/functions/chat-push',
      body    := jsonb_build_object(
                   'kind',         'message',
                   'conversation', new.conversation_id,
                   'message',      new.id),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'X-Chat-Hook',  cfg->>'secret'),
      timeout_milliseconds := 4000
    );
  exception when others then
    -- Deliberately silent. See the note above.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists chat_nudge_t on public.chat_messages;
create trigger chat_nudge_t
  after insert on public.chat_messages
  for each row execute function public.chat_nudge();

-- And the same when a conversation is handed to somebody: the person
-- receiving it is exactly the person who needs to know.
create or replace function public.chat_nudge_handover()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare cfg jsonb;
begin
  if new.assigned_to is null or new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  -- Taking one yourself is not news to you.
  if new.assigned_to = auth.uid() then return new; end if;

  begin
    select data into cfg from public.site_settings_private where key = 'chat_push';
    if cfg is null or coalesce(cfg->>'siteUrl', '') = '' then return new; end if;

    perform net.http_post(
      url     := rtrim(cfg->>'siteUrl', '/') || '/.netlify/functions/chat-push',
      body    := jsonb_build_object(
                   'kind',         'handover',
                   'conversation', new.id,
                   'to',           new.assigned_to),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'X-Chat-Hook',  cfg->>'secret'),
      timeout_milliseconds := 4000
    );
  exception when others then null;
  end;

  return new;
end;
$$;

drop trigger if exists chat_nudge_handover_t on public.chat_conversations;
create trigger chat_nudge_handover_t
  after update of assigned_to on public.chat_conversations
  for each row execute function public.chat_nudge_handover();

revoke all on function public.chat_holder_present(uuid)              from public;
revoke all on function public.chat_may_speak_in(uuid)                from public;
revoke all on function public.chat_held_by(uuid)                     from public;
revoke all on function public.chat_push_key()                        from public;
revoke all on function public.chat_push_save(text, text, text, text) from public;
revoke all on function public.chat_push_drop(text)                   from public;
revoke all on function public.chat_push_has(text)                    from public;
revoke all on function public.chat_push_site(text)                   from public;
grant execute on function public.chat_holder_present(uuid)              to authenticated;
grant execute on function public.chat_may_speak_in(uuid)                to authenticated;
grant execute on function public.chat_held_by(uuid)                     to authenticated;
grant execute on function public.chat_push_key()                        to authenticated;
grant execute on function public.chat_push_save(text, text, text, text) to authenticated;
grant execute on function public.chat_push_drop(text)                   to authenticated;
grant execute on function public.chat_push_has(text)                    to authenticated;
grant execute on function public.chat_push_site(text)                   to authenticated;

-- ---------------------------------------------------------------------
-- Checking it took
--
--   select public.chat_push_key();            -- the long B... string
--   select count(*) from public.chat_push;    -- devices, once you subscribe
--   select key from public.site_settings_private;  -- should list chat_push
--
-- And if you ever move the site to a different address:
--
--   update public.site_settings_private
--      set data = jsonb_set(data, '{siteUrl}', '"https://the-new-one.com"')
--    where key = 'chat_push';
-- ---------------------------------------------------------------------
