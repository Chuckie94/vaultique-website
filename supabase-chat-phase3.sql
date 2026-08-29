-- =====================================================================
-- Vaultique Boutique Point — live chat, Phase 3: more than one of you
-- ---------------------------------------------------------------------
-- Run this AFTER supabase-chat.sql and supabase-chat-phase2.sql, in the
-- same WEBSITE project. Neither of those files is changed by this one.
--
-- Safe to run more than once.
--
-- Phases 1 and 2 assumed one shop with one person in it: every operator
-- saw every conversation and nobody owned any of them. That works until
-- two people answer the same customer, or until nobody does because
-- each assumed the other had. This adds:
--
--   · agents, and which of them is at the desk right now
--   · a conversation belonging to one of them
--   · handing one to somebody else, with a record of who and when
--   · notes staff write to each other, which the customer never sees
--   · how the shop is actually doing: replies, and how long people wait
--
-- WHY NOTES LIVE IN THEIR OWN TABLE. The obvious design is a third kind
-- of chat_messages row beside 'customer' and 'shop'. It is also how a
-- shop ends up showing a customer what its staff said about them:
-- chat_poll hands a conversation's messages to the customer, so notes
-- in that table would be one forgotten `where` away from being read by
-- the person they are about. A separate table cannot be returned by a
-- customer-facing function by accident, because none of them mention
-- it. That is worth a join.
-- =====================================================================

-- 1) The people answering ---------------------------------------------
-- Keyed on the same id as public.admins, so being an agent and being an
-- admin are the same fact rather than two lists to keep in step. Adding
-- an admin is still done in the Supabase dashboard, deliberately; this
-- row is what that person's own browser fills in when they first open
-- Live Chats.

create table if not exists public.chat_agents (
  id            uuid primary key,
  display_name  text,
  status        text not null default 'offline'
                  check (status in ('online', 'away', 'offline')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.chat_agents enable row level security;

drop policy if exists ca_read on public.chat_agents;
create policy ca_read on public.chat_agents for select
  using (public.is_admin());

-- An agent writes their own row and nobody else's. One member of staff
-- marking another one "online" would be a rota, not a presence.
drop policy if exists ca_self_insert on public.chat_agents;
create policy ca_self_insert on public.chat_agents for insert
  with check (public.is_admin() and id = auth.uid());

drop policy if exists ca_self_update on public.chat_agents;
create policy ca_self_update on public.chat_agents for update
  using (public.is_admin() and id = auth.uid())
  with check (public.is_admin() and id = auth.uid());


-- 2) What a conversation now carries ----------------------------------

alter table public.chat_conversations
  add column if not exists assigned_to    uuid references public.chat_agents(id)
                             on delete set null,
  add column if not exists assigned_at    timestamptz,
  add column if not exists first_reply_at timestamptz,   -- for "how long did they wait"
  add column if not exists closed_at      timestamptz;

create index if not exists chat_conv_assigned
  on public.chat_conversations (assigned_to, last_message_at desc);

-- Which of them wrote a given reply. Null on a customer's own message,
-- and on any reply sent before this phase existed.
alter table public.chat_messages
  add column if not exists author_id uuid;


-- 3) Notes staff write to each other ----------------------------------
-- 'note' is something a person typed. 'event' is something that
-- happened — a hand-over — recorded the same way so that the two read
-- as one history rather than a list and a separate log nobody opens.

create table if not exists public.chat_notes (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
                     references public.chat_conversations(id) on delete cascade,
  author_id        uuid,
  kind             text not null default 'note' check (kind in ('note', 'event')),
  body             text not null,
  created_at       timestamptz not null default now()
);

create index if not exists chat_notes_conv
  on public.chat_notes (conversation_id, created_at);

alter table public.chat_notes enable row level security;

-- Admins, and nobody else, exactly as with the two tables in Phase 1.
-- There is no policy for anon and no function that returns these rows,
-- so a note has no path to a customer at all.
drop policy if exists cn_admin on public.chat_notes;
create policy cn_admin on public.chat_notes for all
  using (public.is_admin()) with check (public.is_admin());


-- 4) The counters, now also remembering the first reply ---------------
-- Same trigger as Phase 1, doing one more thing. Replacing it rather
-- than adding a second keeps the arithmetic in one place.

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
                                then customer_unread + 1 else customer_unread end,
         -- The moment somebody first answered. Only ever set once: a
         -- second reply is not a first response, and overwriting this
         -- would make every conversation look instantly answered.
         first_reply_at  = case when new.sender = 'shop' and first_reply_at is null
                                then new.created_at else first_reply_at end
   where id = new.conversation_id;
  return new;
end;
$$;

-- When a conversation was closed, stamped by the database rather than
-- by whichever client happened to close it.
create or replace function public.chat_close_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed' and coalesce(old.status, '') <> 'closed' then
    new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_conv_close on public.chat_conversations;
create trigger chat_conv_close
  before update on public.chat_conversations
  for each row execute function public.chat_close_stamp();


-- 5) Being at the desk ------------------------------------------------
-- Called by an operator's own browser while Live Chats is open, and
-- once more on the way out. Writes only the caller's own row, so this
-- cannot be used to mark a colleague present.

create or replace function public.chat_presence(
  p_status text default 'online',
  p_name   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not permitted';
  end if;
  if p_status not in ('online', 'away', 'offline') then
    raise exception 'unknown status';
  end if;

  insert into public.chat_agents (id, display_name, status, last_seen_at)
  values (auth.uid(), nullif(btrim(coalesce(p_name, '')), ''), p_status, now())
  on conflict (id) do update
    set status       = excluded.status,
        last_seen_at = now(),
        display_name = coalesce(excluded.display_name, public.chat_agents.display_name);
end;
$$;


-- 6) Handing a conversation over --------------------------------------
-- Assignment and transfer are the same act; the difference is only
-- whether it had an owner before. Both leave a line in the history, so
-- "who was dealing with this" is answerable tomorrow.

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
  v_from   uuid;
  v_fromnm text;
  v_tonm   text;
  v_bynm   text;
begin
  if not public.is_admin() then
    raise exception 'not permitted';
  end if;

  select assigned_to into v_from
    from public.chat_conversations where id = p_conversation;

  -- Assigning it to whoever already has it is not an event.
  if v_from is not distinct from p_agent then
    return;
  end if;

  if p_agent is not null
     and not exists (select 1 from public.chat_agents a where a.id = p_agent) then
    raise exception 'unknown agent';
  end if;

  update public.chat_conversations
     set assigned_to = p_agent,
         assigned_at = case when p_agent is null then null else now() end
   where id = p_conversation;

  select coalesce(display_name, 'someone') into v_fromnm
    from public.chat_agents where id = v_from;
  select coalesce(display_name, 'someone') into v_tonm
    from public.chat_agents where id = p_agent;
  select coalesce(display_name, 'someone') into v_bynm
    from public.chat_agents where id = auth.uid();

  insert into public.chat_notes (conversation_id, author_id, kind, body)
  values (
    p_conversation, auth.uid(), 'event',
    case
      when p_agent is null then 'Released by ' || coalesce(v_bynm, 'someone')
      when v_from is null  then 'Taken by ' || coalesce(v_tonm, 'someone')
      else 'Passed from ' || coalesce(v_fromnm, 'someone') ||
           ' to ' || coalesce(v_tonm, 'someone') ||
           ' by ' || coalesce(v_bynm, 'someone')
    end
  );
end;
$$;


-- 7) How the shop is doing --------------------------------------------
-- Aggregates rather than rows: this answers "are people waiting" and
-- "who is carrying the load", not "what did this customer say".
--
-- SECURITY DEFINER, so it is locked from the inside as well as from the
-- outside: it refuses anybody who is not an admin, and it is granted to
-- authenticated only. Either lock alone would be enough; a function
-- that can read every conversation deserves both.

create or replace function public.chat_stats(p_days int default 30)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_tot   json;
  v_by    json;
begin
  if not public.is_admin() then
    raise exception 'not permitted';
  end if;

  v_since := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;

  select json_build_object(
           'days',       greatest(coalesce(p_days, 30), 1),
           'started',    count(*),
           'open',       count(*) filter (where status = 'open'),
           'closed',     count(*) filter (where status = 'closed'),
           'unanswered', count(*) filter (where first_reply_at is null and status = 'open'),
           'waiting',    coalesce(sum(shop_unread), 0),
           -- Seconds from the conversation starting to somebody
           -- answering. Only conversations that were answered count:
           -- averaging in the ones nobody replied to as if they were
           -- instant is how a shop flatters itself.
           'avg_first_reply_seconds',
             round(avg(extract(epoch from (first_reply_at - created_at)))
                     filter (where first_reply_at is not null))
         )
    into v_tot
    from public.chat_conversations
   where created_at >= v_since;

  -- Every agent, including one who has answered nothing this month:
  -- built from the staff list rather than from who happens to have
  -- written, because "nobody has replied and three are waiting on them"
  -- is the row a shop most needs to see, and counting only authors is
  -- exactly what would hide it.
  select coalesce(json_agg(row_to_json(t) order by t.replies desc, t.agent), '[]'::json)
    into v_by
    from (
      select coalesce(a.display_name, 'Unnamed agent')  as agent,
             count(m.id)                                as replies,
             count(distinct m.conversation_id)          as conversations,
             (select count(*) from public.chat_conversations c
               where c.assigned_to = a.id and c.status = 'open') as open_assigned
        from public.chat_agents a
        left join public.chat_messages m
               on m.author_id = a.id
              and m.sender = 'shop'
              and m.created_at >= v_since
       group by a.id, a.display_name

      union all

      -- Replies sent before this phase existed, or by somebody no longer
      -- on the staff list. Counted, because they happened; not given a
      -- name, because any name here would be a guess.
      select 'Unattributed', count(*), count(distinct m.conversation_id), 0
        from public.chat_messages m
       where m.sender = 'shop'
         and m.created_at >= v_since
         and (m.author_id is null
              or not exists (select 1 from public.chat_agents a where a.id = m.author_id))
      having count(*) > 0
    ) t;

  return json_build_object('totals', v_tot, 'agents', v_by);
end;
$$;


-- 8) Who may call them ------------------------------------------------
-- All three answer only to an admin and are granted to authenticated
-- only. A customer's anon key cannot reach any of them.

revoke all on function public.chat_presence(text, text)   from public;
revoke all on function public.chat_assign(uuid, uuid)     from public;
revoke all on function public.chat_stats(int)             from public;

grant execute on function public.chat_presence(text, text) to authenticated;
grant execute on function public.chat_assign(uuid, uuid)   to authenticated;
grant execute on function public.chat_stats(int)           to authenticated;

-- =====================================================================
-- Done. To check it took:
--   select count(*) from public.chat_agents;   -- 0, and no error
-- =====================================================================
