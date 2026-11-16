-- =====================================================================
-- Live Chat: "HANDED TO" UNTIL THEY ACTUALLY ANSWER
-- Run once, after supabase-chat-mentions.sql. Safe to run again.
--
-- Handing a chat to a colleague used to make it read "Taken by" them at
-- once, although they might not even have seen it. Now it reads
-- "Handed to <name>" until that person sends the customer a message,
-- and only then "Taken by <name>", with a line in the notes saying so.
-- =====================================================================

alter table public.chat_conversations
  add column if not exists handed_pending boolean not null default false;

-- The line in the notes when a chat changes hands: "Handed to Chanda by Mwila".
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
      when p_to is not distinct from auth.uid() then 'Taken by ' || coalesce(v_tonm, 'someone')
      else 'Handed to ' || coalesce(v_tonm, 'someone') ||
           ' by ' || coalesce(v_bynm, v_fromnm, 'someone')
    end
  );
end;
$$;
revoke all on function public.chat_note_event(uuid, uuid, uuid) from public, anon, authenticated;

-- Handing over marks it pending; taking it yourself does not.
create or replace function public.chat_assign(
  p_conversation uuid,
  p_agent        uuid default null
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
     set assigned_to    = p_agent,
         assigned_at    = case when p_agent is null then null else now() end,
         handed_pending = (p_agent is not null and p_agent is distinct from auth.uid())
   where id = p_conversation;

  perform public.chat_note_event(p_conversation, v_holder, p_agent);
end;
$$;

-- The first reply from the person it was handed to is them taking it.
create or replace function public.chat_handover_taken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if new.sender <> 'shop' then return new; end if;
  update public.chat_conversations
     set handed_pending = false
   where id = new.conversation_id
     and handed_pending
     and assigned_to = auth.uid();
  if found then
    select display_name into v_name from public.chat_agents where id = auth.uid();
    insert into public.chat_notes (conversation_id, author_id, kind, body)
    values (new.conversation_id, auth.uid(), 'event', 'Taken by ' || coalesce(v_name, 'someone'));
  end if;
  return new;
end;
$$;

drop trigger if exists chat_handover_taken_t on public.chat_messages;
create trigger chat_handover_taken_t
  after insert on public.chat_messages
  for each row execute function public.chat_handover_taken();

notify pgrst, 'reload schema';
