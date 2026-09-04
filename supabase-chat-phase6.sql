-- =====================================================================
-- Live chat, phase 6: people who answer chats and nothing else
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again.
-- =====================================================================
--
-- Until now there was one kind of person with a login: an administrator,
-- who can do everything. Somebody hired to answer customers does not
-- need the products, the orders, the payment details or the settings,
-- and giving them all of it to let them type a reply is the wrong shape.
--
-- So there is a second kind: chat staff. They sign in at the same
-- address, they see the Live Chats page and nothing else, and the
-- database agrees — they are not in `admins`, so every rule that asks
-- is_admin() still says no to them, including the ones on products,
-- orders and settings. What they gain is exactly the chat tables.
--
-- Two things worth being plain about:
--
--   * They can read every conversation, not only their own. That is
--     what answering chats is. If you need somebody who can only see
--     conversations assigned to them, say so — it is a different rule
--     and this file is not it.
--
--   * Creating their login needs the service role key, because making
--     an account is something only Supabase's admin API can do. That
--     key goes in Netlify's environment variables and never in the
--     browser. SETUP.md says where.
-- ---------------------------------------------------------------------

create table if not exists public.chat_staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  active        boolean not null default true,
  -- Set when the account is made and when its password is reset. The
  -- admin page will not let them past it until they have chosen their
  -- own, so the password you hand over is only ever good for one visit.
  must_change_password boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

alter table public.chat_staff enable row level security;

-- Their own row, so the page can ask "must I change my password?" and
-- "what am I called". Nobody reads anybody else's this way; the owner
-- reads the list through a function below.
drop policy if exists cs_self on public.chat_staff;
create policy cs_self on public.chat_staff for select
  using (id = auth.uid());

-- The owner, for the same table, through ordinary SQL as well as the
-- functions. is_shop_owner() comes from phase 5.
drop policy if exists cs_owner on public.chat_staff;
create policy cs_owner on public.chat_staff for all
  using (public.is_shop_owner()) with check (public.is_shop_owner());

-- ---------------------------------------------------------------------
-- Who may answer a chat
--
-- One function, so the rule lives in one place. Everything that used to
-- ask is_admin() about a chat table now asks this instead, and it still
-- says yes to every administrator — an owner or an agent in `admins` is
-- unaffected by this file.
-- ---------------------------------------------------------------------
create or replace function public.is_chat_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_staff s
     where s.id = auth.uid() and s.active
  );
$$;

create or replace function public.chat_may_answer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.is_chat_staff();
$$;

-- ---------------------------------------------------------------------
-- The chat tables, opened to chat staff
--
-- Each policy is replaced rather than added to: two permissive policies
-- on one table are OR-ed together, which works, but leaves the rule for
-- a table spread across two files and two names. One policy per table,
-- saying the whole rule, is the thing that can be read.
-- ---------------------------------------------------------------------
drop policy if exists chc_admin on public.chat_conversations;
create policy chc_admin on public.chat_conversations for all
  using (public.chat_may_answer()) with check (public.chat_may_answer());

drop policy if exists chm_admin on public.chat_messages;
create policy chm_admin on public.chat_messages for all
  using (public.chat_may_answer()) with check (public.chat_may_answer());

drop policy if exists cn_admin on public.chat_notes;
create policy cn_admin on public.chat_notes for all
  using (public.chat_may_answer()) with check (public.chat_may_answer());

-- Saved answers: everyone who answers may read them, and only an
-- administrator may change them. A reply the shop wrote once is the
-- shop's wording, not the answerer's.
drop policy if exists cq_admin on public.chat_canned;
drop policy if exists cq_read on public.chat_canned;
drop policy if exists cq_write on public.chat_canned;
create policy cq_read on public.chat_canned for select
  using (public.chat_may_answer());
create policy cq_write on public.chat_canned for all
  using (public.is_admin()) with check (public.is_admin());

-- Presence: they need to see who else is at the desk, and to say they
-- are there themselves. Still only their own row to write.
drop policy if exists ca_read on public.chat_agents;
create policy ca_read on public.chat_agents for select
  using (public.chat_may_answer());

drop policy if exists ca_self_insert on public.chat_agents;
create policy ca_self_insert on public.chat_agents for insert
  with check (public.chat_may_answer() and id = auth.uid());

drop policy if exists ca_self_update on public.chat_agents;
create policy ca_self_update on public.chat_agents for update
  using (public.chat_may_answer() and id = auth.uid())
  with check (public.chat_may_answer() and id = auth.uid());

-- Photos sent into a conversation.
drop policy if exists cu_write on storage.objects;
create policy cu_write on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-uploads' and public.chat_may_answer());

drop policy if exists cu_update on storage.objects;
create policy cu_update on storage.objects for update to authenticated
  using (bucket_id = 'chat-uploads' and public.chat_may_answer());

-- Deleting an uploaded photo stays with administrators, for the same
-- reason deleting a conversation stays with the owner.
drop policy if exists cu_delete on storage.objects;
create policy cu_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-uploads' and public.is_admin());

-- ---------------------------------------------------------------------
-- The functions the page calls, opened the same way
--
-- Each is the phase 3 or phase 4 original with one line changed: the
-- permission check. Nothing else about them moves — not the parameter
-- names, which PostgREST resolves a call by and which a replace cannot
-- rename, and not the return types, which a replace cannot change
-- either. Both of those were learned the hard way against a copy of
-- this schema rather than against the shop's.
--
-- chat_stats is deliberately absent. How the shop is performing stays
-- with administrators, so there is nothing to widen, and a function
-- left alone is a function that cannot be broken by being rewritten.
-- ---------------------------------------------------------------------
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
  if not public.chat_may_answer() then
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
  if not public.chat_may_answer() then
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

create or replace function public.chat_mark_read(
  p_conversation uuid,
  p_upto         timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
begin
  if not public.chat_may_answer() then
    raise exception 'not permitted';
  end if;

  select count(*) into v_left
    from public.chat_messages m
   where m.conversation_id = p_conversation
     and m.sender = 'customer'
     and (p_upto is null or m.created_at > p_upto);

  update public.chat_conversations
     set shop_unread = v_left
   where id = p_conversation;

  return v_left;
end;
$$;

create or replace function public.chat_find_orders(
  p_customer uuid default null,
  p_phone    text default null,
  p_ref      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v json;
begin
  if not public.chat_may_answer() then
    raise exception 'not permitted';
  end if;

  -- Something to match on, or nothing comes back. Without this the
  -- next three lines would happily return the whole order book.
  if p_customer is null
     and nullif(btrim(coalesce(p_phone, '')), '') is null
     and nullif(btrim(coalesce(p_ref,   '')), '') is null then
    return '[]'::json;
  end if;

  select coalesce(json_agg(row_to_json(o) order by o.created_at desc), '[]'::json)
    into v
    from (
      select ref, status, total, currency, fulfilment, created_at
        from public.orders
       where (p_customer is not null and customer_id = p_customer)
          or (nullif(btrim(coalesce(p_phone, '')), '') is not null and phone = btrim(p_phone))
          or (nullif(btrim(coalesce(p_ref,   '')), '') is not null
              and upper(ref) = upper(btrim(p_ref)))
       order by created_at desc
       limit 10
    ) o;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- What the admin page asks about the person signing in
--
-- One call, answered for anybody signed in. An administrator gets
-- is_staff false and chat_only false: nothing about them changes.
-- ---------------------------------------------------------------------
create or replace function public.chat_staff_me()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'is_admin',   public.is_admin(),
    'is_owner',   public.is_shop_owner(),
    'is_staff',   public.is_chat_staff(),
    -- Whether there is a chat_staff row at all, which is not the same
    -- as being able to answer. Somebody switched off has one and cannot,
    -- and the sign-in page needs to tell them that rather than telling
    -- them they are not an administrator — which is true, unhelpful, and
    -- the wrong thing to be puzzled by.
    'known',      exists (select 1 from public.chat_staff s where s.id = auth.uid()),
    -- Somebody who answers chats and is not an administrator. This is
    -- what the page uses to show the Chats tab and nothing else.
    'chat_only',  (public.is_chat_staff() and not public.is_admin()),
    'must_change_password', coalesce(
       (select s.must_change_password from public.chat_staff s where s.id = auth.uid()), false),
    'display_name', (select s.display_name from public.chat_staff s where s.id = auth.uid())
  );
$$;

-- Said by the page once the person has actually chosen a new password.
-- It cannot lie in the useful direction: it only ever clears the flag
-- for the caller's own row, and Supabase has already refused the change
-- if the new password was no good.
create or replace function public.chat_staff_password_changed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_staff
     set must_change_password = false
   where id = auth.uid();
end;
$$;

-- A person answering chats may set the name colleagues see. It is the
-- same field the presence bar shows, kept in both places for the same
-- reason phase 3 keeps it in chat_agents.
create or replace function public.chat_staff_rename(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
begin
  if v_name is null then return; end if;
  update public.chat_staff set display_name = v_name where id = auth.uid();
  update public.chat_agents set display_name = v_name where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- The owner's list
--
-- Reading and switching off live here; making an account and setting a
-- password do not, because those need the service role key and that key
-- has no business in a browser. The Netlify function does those two.
-- ---------------------------------------------------------------------
create or replace function public.chat_staff_list()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v json;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can see who answers chats.';
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json)
    into v
    from (
      select s.id, s.email, s.display_name, s.active,
             s.must_change_password, s.created_at,
             (select a.last_seen_at from public.chat_agents a where a.id = s.id) as last_seen_at,
             (select count(*) from public.chat_messages m
               where m.author_id = s.id and m.sender = 'shop') as replies
        from public.chat_staff s
    ) t;
  return v;
end;
$$;

create or replace function public.chat_staff_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change who answers chats.';
  end if;
  update public.chat_staff set active = coalesce(p_active, true) where id = p_id;
  -- Switched off is off the desk, straight away, rather than at the end
  -- of whatever their browser was in the middle of.
  if p_active is not true then
    update public.chat_agents set status = 'offline' where id = p_id;
  end if;
end;
$$;

revoke all on function public.is_chat_staff()                    from public;
revoke all on function public.chat_may_answer()                  from public;
revoke all on function public.chat_staff_me()                    from public;
revoke all on function public.chat_staff_password_changed()      from public;
revoke all on function public.chat_staff_rename(text)            from public;
revoke all on function public.chat_staff_list()                  from public;
revoke all on function public.chat_staff_set_active(uuid, boolean) from public;
grant execute on function public.is_chat_staff()                 to authenticated;
grant execute on function public.chat_may_answer()               to authenticated;
grant execute on function public.chat_staff_me()                 to authenticated;
grant execute on function public.chat_staff_password_changed()   to authenticated;
grant execute on function public.chat_staff_rename(text)         to authenticated;
grant execute on function public.chat_staff_list()               to authenticated;
grant execute on function public.chat_staff_set_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Checking it took
--
--   select id, email, active, must_change_password from public.chat_staff;
--   select public.chat_staff_me();
--
-- The second answers for whoever is signed in. Run it as yourself in the
-- SQL editor and it will say is_admin true, chat_only false — which is
-- the point: nothing about your own account changed.
-- ---------------------------------------------------------------------
