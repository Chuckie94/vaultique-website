-- =====================================================================
-- Live Chat: TAKEN WHEN OPENED, and @MENTIONS IN NOTES
-- Run once in this website's Supabase SQL Editor, after the other chat
-- files (phase 7 and 10 especially). Safe to run again.
--
-- 1. OPENING A CHAT NOBODY HAS TAKEN TAKES IT. chat_take() does it in one
--    step that cannot race: if two people open the same new chat at the
--    same moment, one gets it and the other is told who did.
--
-- 2. "TAKEN BY ..." IS WRITTEN IN THE NOTES AGAIN. Phase 6 wrote a line
--    in the conversation's notes whenever it was taken, passed on or
--    released. Phase 7 rewrote chat_assign to stop colleagues grabbing
--    each other's chats and lost that line on the way. It is back, for
--    taking, handing over and releasing alike.
--
-- 3. @MENTIONS. A note can name colleagues. Each one named gets a push
--    on their phone (through the same chat-push function and the same
--    switch in Settings > Live Chat as a new message), and the admin
--    shows it to them straight away if they have it open.
-- =====================================================================

-- 1) Who a note mentions -----------------------------------------------
alter table public.chat_notes add column if not exists mentions uuid[];


-- 2) One line in the notes for every change of hands -------------------
create or replace function public.chat_note_event(
  p_conversation uuid, p_from uuid, p_to uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fromnm text; v_tonm text; v_bynm text;
begin
  select display_name into v_fromnm from public.chat_agents where id = p_from;
  select display_name into v_tonm   from public.chat_agents where id = p_to;
  select display_name into v_bynm   from public.chat_agents where id = auth.uid();
  insert into public.chat_notes (conversation_id, author_id, kind, body)
  values (
    p_conversation, auth.uid(), 'event',
    case
      when p_to is null   then 'Released by ' || coalesce(v_bynm, 'someone')
      when p_from is null then 'Taken by ' || coalesce(v_tonm, 'someone')
      else 'Passed from ' || coalesce(v_fromnm, 'someone') ||
           ' to ' || coalesce(v_tonm, 'someone') ||
           case when auth.uid() is distinct from p_from
                then ' by ' || coalesce(v_bynm, 'someone') else '' end
    end
  );
end;
$$;
revoke all on function public.chat_note_event(uuid, uuid, uuid) from public, anon, authenticated;


-- 3) Handing over: phase 7's rules, and the line in the notes back -----
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

  if v_holder is not distinct from p_agent then return; end if;

  if v_holder is not null and v_holder <> auth.uid()
     and not public.chat_may_speak_in(p_conversation) then
    select display_name into v_name from public.chat_agents where id = v_holder;
    raise exception 'That conversation is with %. Ask them to hand it over, or wait until they are away.',
      coalesce(v_name, 'somebody else');
  end if;

  if p_agent is not null
     and not exists (select 1 from public.chat_agents a where a.id = p_agent) then
    raise exception 'unknown agent';
  end if;

  update public.chat_conversations
     set assigned_to = p_agent,
         assigned_at = case when p_agent is null then null else now() end
   where id = p_conversation;

  perform public.chat_note_event(p_conversation, v_holder, p_agent);
end;
$$;


-- 4) Taking a chat by opening it ---------------------------------------
-- Only a chat that is open and that nobody holds. The update and the
-- check are one statement, so two people cannot both take it.
create or replace function public.chat_take(p_conversation uuid)
returns json
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

  -- The person taking it appears in the list of people chats can be
  -- handed to, even if they have never set their presence.
  insert into public.chat_agents (id, display_name, status, last_seen_at)
  values (auth.uid(),
          (select split_part(coalesce(u.email, ''), '@', 1) from auth.users u where u.id = auth.uid()),
          'online', now())
  on conflict (id) do nothing;

  update public.chat_conversations
     set assigned_to = auth.uid(), assigned_at = now()
   where id = p_conversation and assigned_to is null and status = 'open';

  if found then
    perform public.chat_note_event(p_conversation, null, auth.uid());
    return json_build_object('taken', true);
  end if;

  select assigned_to into v_holder from public.chat_conversations where id = p_conversation;
  select display_name into v_name from public.chat_agents where id = v_holder;
  return json_build_object('taken', false, 'holder', v_holder, 'name', v_name);
end;
$$;
revoke all on function public.chat_take(uuid) from public, anon;
grant execute on function public.chat_take(uuid) to authenticated;


-- 5) Telling whoever a note mentions -----------------------------------
-- Only people who can answer chats, never the author, never twice.
create or replace function public.chat_note_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mentions is null then return new; end if;
  new.mentions := array(
    select distinct m from unnest(new.mentions) m
     where m is distinct from new.author_id
       and exists (select 1 from public.chat_agents a where a.id = m)
  );
  if array_length(new.mentions, 1) is null then new.mentions := null; end if;
  if array_length(new.mentions, 1) > 10 then new.mentions := new.mentions[1:10]; end if;
  return new;
end;
$$;
drop trigger if exists chat_note_mentions_t on public.chat_notes;
create trigger chat_note_mentions_t
  before insert on public.chat_notes
  for each row execute function public.chat_note_mentions();

create or replace function public.chat_nudge_mention()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare cfg jsonb;
begin
  if new.mentions is null or array_length(new.mentions, 1) is null then return new; end if;
  begin
    select data into cfg from public.site_settings_private where key = 'chat_push';
    if cfg is null or coalesce(cfg->>'siteUrl', '') = '' then return new; end if;
    perform net.http_post(
      url     := rtrim(cfg->>'siteUrl', '/') || '/.netlify/functions/chat-push',
      body    := jsonb_build_object(
                   'kind',         'mention',
                   'conversation', new.conversation_id,
                   'note',         new.id,
                   'to',           to_jsonb(new.mentions)),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'X-Chat-Hook',  cfg->>'secret'),
      timeout_milliseconds := 4000
    );
  exception when others then null;   -- a missed buzz must never lose the note
  end;
  return new;
end;
$$;
drop trigger if exists chat_nudge_mention_t on public.chat_notes;
create trigger chat_nudge_mention_t
  after insert on public.chat_notes
  for each row execute function public.chat_nudge_mention();


-- 6) So an open admin hears about a mention at once --------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_notes'
  ) then
    alter publication supabase_realtime add table public.chat_notes;
  end if;
exception when others then
  raise notice 'chat_notes not added to the realtime publication: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';

-- Checking: select count(*) from public.chat_notes where mentions is not null;
