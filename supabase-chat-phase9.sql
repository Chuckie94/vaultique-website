-- =====================================================================
-- Phase 9: two kinds of person, and each with their own front door
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again. Nothing to fill in.
-- =====================================================================
--
-- The shop has two kinds of people who sign in, and until now only one
-- of them could be made without opening Supabase:
--
--   * AN ADMINISTRATOR — everything. Products, orders, settings, chats.
--     Signs in at /admin.html. There may be as many as the shop likes,
--     and one of them is the owner, who alone may delete a conversation
--     and name other owners.
--
--   * A CHAT AGENT — chats and nothing else. Signs in at /agent.html,
--     which is a different page with a different door, so nobody has to
--     remember which parts of the admin they are allowed to touch. The
--     database refuses them the rest either way.
--
-- WHAT THIS FILE ADDS. A new administrator handed a password by the
-- owner is in exactly the position a new chat agent is in — somebody
-- else knows their password — so they are made to choose their own on
-- first arrival, the same way. That needs one column and two small
-- functions.
-- ---------------------------------------------------------------------

alter table public.admins
  add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------------
-- Who am I, and what am I made to do first?
--
-- This is chat_staff_me() from supabase-chat-phase6.sql with one line
-- changed: must_change_password now answers for an administrator as
-- well as for a chat agent. It could not before, because administrators
-- were only ever made by hand in Supabase and nobody was handing them a
-- password.
--
-- Reproduced whole rather than patched, because there is no way to
-- change one field of a function without writing it again, and a copy
-- that differed anywhere else would be a bug nobody would look for.
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
    -- An agent's own flag first, then an administrator's. Nobody is
    -- normally both; if somebody were, being made to choose a password
    -- once too often is the harmless way round.
    'must_change_password', coalesce(
       (select s.must_change_password from public.chat_staff s where s.id = auth.uid()),
       (select a.must_change_password from public.admins     a where a.id = auth.uid()),
       false),
    'display_name', (select s.display_name from public.chat_staff s where s.id = auth.uid())
  );
$$;

-- Said by the page once an administrator has actually chosen a new one.
-- Like its chat_staff twin it cannot lie in the useful direction: it
-- clears the flag for the caller's own row and nobody else's, and
-- Supabase has already refused the change if the password was no good.
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
-- The list the owner manages people from.
--
-- admins already answers to any administrator for reading, which is what
-- Settings > Security shows. This adds the one fact that list was
-- missing — whether each row is the owner — so the page can say so, and
-- can refuse to offer the owner's own row for removal.
-- ---------------------------------------------------------------------
create or replace function public.admins_list()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'id',    a.id,
           'email', a.email,
           'role',  coalesce(a.role, 'agent'),
           'added_at', a.added_at,
           'must_change_password', a.must_change_password
         ) order by a.added_at), '[]'::json)
    from public.admins a
   where public.is_admin();
$$;

revoke all on function public.admin_password_changed() from public;
revoke all on function public.admins_list()            from public;
grant execute on function public.admin_password_changed() to authenticated;
grant execute on function public.admins_list()            to authenticated;

-- Two new functions and a new column: tell PostgREST, rather than
-- waiting for it to notice.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Checking it took
--
-- NOT with chat_staff_me() or admins_list(). Both answer "who is making
-- this request", and in the Supabase SQL Editor the honest answer is
-- nobody: that window runs as the database's own superuser, where
-- auth.uid() is null. chat_staff_me() comes back all false and
-- admins_list() comes back empty, and both are correct — they only mean
-- something when a signed-in person asks them, from the website.
--
-- These say what actually happened here:
--
--   select column_name from information_schema.columns
--    where table_name = 'admins' and column_name = 'must_change_password';
--   -- one row = the column is in
--
--   select proname from pg_proc
--    where proname in ('admins_list', 'admin_password_changed',
--                      'chat_staff_me', 'chat_typing_peek')
--    order by proname;
--   -- four rows = this file and the phase 8 top-up are both in
--
-- And these are the two worth looking at, being the people themselves:
--
--   select email, role, must_change_password from public.admins order by added_at;
--   select email, display_name, active, must_change_password from public.chat_staff;
-- ---------------------------------------------------------------------
