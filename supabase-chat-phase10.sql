-- =====================================================================
-- Phase 10: users, roles and permissions
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again. Nothing to fill in.
-- =====================================================================
--
-- One kind of person now. Everybody who works here is a row in admins,
-- everybody signs in at /admin.html, and what they can do is decided by
-- their role. Roles are yours to define in Settings > Users & Roles, and
-- changing one takes effect the next time that person loads a page.
--
-- The separate chat-only login and the separate page it used are gone.
-- chat_staff is left in place and unused so that nothing already in the
-- database is destroyed by running this; the section at the very bottom
-- has the two lines that clear it out if you want it gone.
-- ---------------------------------------------------------------------

-- A role is a name. What it may do lives in Settings, so it can change
-- without a migration.
alter table public.admins
  add column if not exists role text not null default 'agent';

alter table public.admins
  add column if not exists display_name text;

alter table public.admins
  add column if not exists active boolean not null default true;

-- The old check constraint allowed only 'owner' and 'agent'. Roles are
-- the shop's to name now, so it goes.
alter table public.admins drop constraint if exists admins_role_check;

-- ---------------------------------------------------------------------
-- What a role may do
--
-- Stored in site_settings under 'roles', which the owner edits in
-- Settings. Two are seeded so the shop is never left with none; both can
-- be renamed, changed or deleted afterwards.
--
--   full   — everything
--   agent  — the chats, and nothing else
--
-- The keys are the admin's own tabs, so adding a tab later means adding
-- one key here and nowhere else.
-- ---------------------------------------------------------------------
insert into public.site_settings (key, data)
values ('roles', jsonb_build_object(
  'full', jsonb_build_object(
    'label', 'Administrator',
    'permissions', jsonb_build_object(
      'dashboard', true, 'products', true, 'orders', true, 'chats', true,
      'reviews', true, 'subscribers', true, 'policies', true,
      'settings', true, 'activity', true, 'deleteChats', false)),
  'agent', jsonb_build_object(
    'label', 'Agent',
    'permissions', jsonb_build_object(
      'dashboard', false, 'products', false, 'orders', false, 'chats', true,
      'reviews', false, 'subscribers', false, 'policies', false,
      'settings', false, 'activity', false, 'deleteChats', false))
))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Who am I and what may I do
--
-- One question, one answer, asked by every page as it loads. The owner
-- is given everything regardless of what their role says, so a shop can
-- never lock itself out by editing a role.
-- ---------------------------------------------------------------------
create or replace function public.my_access()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_owner boolean;
  v_admin boolean;
  v_name  text;
  v_live  boolean;
  v_perm  jsonb;
begin
  v_admin := public.is_admin();
  if not v_admin then
    return json_build_object('is_admin', false, 'is_owner', false, 'active', false,
                             'role', null, 'permissions', '{}'::json);
  end if;

  select a.role, a.display_name, coalesce(a.active, true)
    into v_role, v_name, v_live
    from public.admins a where a.id = auth.uid();

  v_owner := public.is_shop_owner();

  -- data IS the roles object: { "full": {...}, "agent": {...} }
  select (data->coalesce(v_role,'agent')->'permissions')
    into v_perm
    from public.site_settings where key = 'roles';

  -- An owner is never limited by a role, and a role nobody has defined
  -- grants nothing rather than everything.
  if v_owner then
    v_perm := jsonb_build_object(
      'dashboard', true, 'products', true, 'orders', true, 'chats', true,
      'reviews', true, 'subscribers', true, 'policies', true,
      'settings', true, 'activity', true, 'deleteChats', true);
  end if;

  return json_build_object(
    'is_admin', true,
    'is_owner', v_owner,
    -- An owner cannot be switched off, so this is never their answer.
    'active', (v_owner or coalesce(v_live, true)),
    'role', coalesce(v_role, 'agent'),
    'display_name', v_name,
    'must_change_password', coalesce(
      (select a.must_change_password from public.admins a where a.id = auth.uid()), false),
    'permissions', coalesce(v_perm, '{}'::jsonb)
  );
end;
$$;

-- The name somebody types on the chat page is the name the owner's user
-- list should show. This replaces the old chat-only rename, and each
-- caller can only ever change their own row.
create or replace function public.user_rename(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  update public.admins
     set display_name = nullif(btrim(p_name), '')
   where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- The list the owner manages people from.
-- ---------------------------------------------------------------------
create or replace function public.users_list()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'id',    a.id,
           'email', a.email,
           'display_name', a.display_name,
           'role',  coalesce(a.role, 'agent'),
           'active', coalesce(a.active, true),
           'added_at', a.added_at,
           'must_change_password', coalesce(a.must_change_password, false),
           'replies', (select count(*) from public.chat_messages m
                        where m.author_id = a.id and m.sender = 'shop'),
           'last_seen_at', (select g.last_seen_at from public.chat_agents g where g.id = a.id)
         ) order by a.added_at), '[]'::json)
    from public.admins a
   where public.is_shop_owner();
$$;

-- Switching somebody off without deleting them. Their replies stay in
-- the conversations they handled.
create or replace function public.user_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then raise exception 'Only the owner can do that.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot switch yourself off.'; end if;
  if exists (select 1 from public.admins where id = p_id and role = 'owner') then
    raise exception 'An owner cannot be switched off.';
  end if;
  update public.admins set active = p_active where id = p_id;
end;
$$;

create or replace function public.user_set_role(p_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then raise exception 'Only the owner can do that.'; end if;
  if exists (select 1 from public.admins where id = p_id and role = 'owner') then
    raise exception 'An owner''s role is changed in SQL, on purpose.';
  end if;
  -- And nobody is made one from a page, either. A second owner can undo
  -- everything the first one decides, so naming one stays a line of SQL
  -- somebody typed deliberately.
  if lower(coalesce(p_role, '')) = 'owner' then
    raise exception 'An owner is named in SQL, on purpose.';
  end if;
  update public.admins set role = p_role where id = p_id;
end;
$$;

create or replace function public.admin_password_changed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admins set must_change_password = false where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Who may answer chats
--
-- The chat rules used to ask is_admin() or is_chat_staff(). They now ask
-- whether this person's role has the chats permission, so switching a
-- role off in Settings takes their access away in the database and not
-- merely in the page.
-- ---------------------------------------------------------------------
create or replace function public.chat_may_answer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
     and coalesce((select a.active from public.admins a where a.id = auth.uid()), true)
     and (
       public.is_shop_owner()
       or coalesce(
            (select (s.data->(select coalesce(a.role,'agent') from public.admins a
                                where a.id = auth.uid())->'permissions'->>'chats')::boolean
               from public.site_settings s where s.key = 'roles'),
            false)
     );
$$;

-- Deleting a conversation follows the same idea: the owner always, and
-- anybody whose role has been given it.
create or replace function public.may_delete_chats()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_shop_owner()
      or coalesce(
           (select (s.data->(select coalesce(a.role,'agent') from public.admins a
                               where a.id = auth.uid())->'permissions'->>'deleteChats')::boolean
              from public.site_settings s where s.key = 'roles'),
           false);
$$;

create or replace function public.chat_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_delete_chats() then
    raise exception 'You do not have permission to delete a conversation.';
  end if;
  delete from public.chat_conversations where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- The roles row is the owner's alone
--
-- Every setting in site_settings may be written by any administrator,
-- which is right for a delivery charge and wrong for this one row: two
-- of the ticks in it are enforced by the database, so an agent able to
-- edit the row could hand themselves the very thing it withholds. The
-- page only shows the Roles card to the owner; this makes it true.
-- ---------------------------------------------------------------------
create or replace function public.roles_row_is_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null when this is not a signed-in browser: the SQL
  -- Editor, or the service key the Create-user function holds. Both are
  -- already trusted with far more than this, and stopping them would
  -- stop this very file from being run a second time.
  if coalesce(new.key, old.key) = 'roles'
     and auth.uid() is not null
     and not public.is_shop_owner() then
    raise exception 'Only the shop owner can change roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists site_settings_roles_guard on public.site_settings;
create trigger site_settings_roles_guard
  before insert or update on public.site_settings
  for each row execute function public.roles_row_is_owners();

revoke all on function public.my_access()                      from public;
revoke all on function public.users_list()                     from public;
revoke all on function public.user_set_active(uuid, boolean)   from public;
revoke all on function public.user_set_role(uuid, text)        from public;
revoke all on function public.user_rename(text)                from public;
revoke all on function public.may_delete_chats()               from public;
grant execute on function public.my_access()                    to authenticated;
grant execute on function public.users_list()                   to authenticated;
grant execute on function public.user_set_active(uuid, boolean) to authenticated;
grant execute on function public.user_set_role(uuid, text)      to authenticated;
grant execute on function public.user_rename(text)              to authenticated;
grant execute on function public.may_delete_chats()             to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Clearing out the old chat-only logins
--
-- Nothing above needs this. Run it when you are ready to be rid of them.
-- The first line removes their sign-ins; the second empties the table.
--
--   delete from auth.users where id in (select id from public.chat_staff);
--   delete from public.chat_staff;
-- ---------------------------------------------------------------------
