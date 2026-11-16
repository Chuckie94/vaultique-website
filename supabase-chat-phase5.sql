-- =====================================================================
-- Live chat, phase 5: deleting a conversation, and who may do it
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again.
-- =====================================================================
--
-- Everyone who can open the admin is in the admins table, and until now
-- that was the whole of it: one kind of person, with one set of powers.
-- Deleting a conversation is the first thing that should not be shared
-- out with everybody who answers chats — a reply can be corrected and a
-- closed chat can be reopened, but a deleted one is gone, and the person
-- who deleted it is exactly the person who can no longer show you what
-- was in it.
--
-- So admins now have a role. 'owner' may delete; 'agent' may do
-- everything else they could do before, which is everything else. This
-- adds a power to one account rather than taking any away from the rest.
--
-- Who becomes the owner: the account that was added first. That is the
-- one that ran the setup and added everybody who came after, so it is a
-- fact about the shop rather than a guess. Change it whenever you like —
-- the line to run is at the bottom of this file.
-- ---------------------------------------------------------------------

alter table public.admins
  add column if not exists role text not null default 'agent';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admins_role_check'
  ) then
    alter table public.admins
      add constraint admins_role_check check (role in ('owner', 'agent'));
  end if;
end $$;

-- The first account added, and only if nobody is the owner yet. Running
-- this file a second time changes nothing, and it will not take the role
-- away from an owner you have named yourself.
update public.admins
   set role = 'owner'
 where id = (select id from public.admins order by added_at, id limit 1)
   and not exists (select 1 from public.admins where role = 'owner');

-- ---------------------------------------------------------------------
-- Asking whether the person signed in is the owner.
--
-- Its own function rather than a check written out at each call site,
-- for the same reason is_admin() is: a rule about who may do what is
-- worth having in one place where it can be read and changed.
-- ---------------------------------------------------------------------
create or replace function public.is_shop_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
     where a.id = auth.uid() and a.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------
-- Deleting a conversation.
--
-- The messages and the notes go with it: both carry
-- "references chat_conversations(id) on delete cascade", so this is one
-- statement and not three, and there is no window in which a message
-- survives the conversation it belonged to.
--
-- security definer, and the first thing it does is ask. A function that
-- runs as its owner and does not check who called it is a hole, so the
-- check is the first line and the exception is deliberate: a caller who
-- may not do this should be told, not quietly given a no-op.
-- ---------------------------------------------------------------------
create or replace function public.chat_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can delete a conversation.';
  end if;
  delete from public.chat_conversations where id = p_id;
end;
$$;

revoke all on function public.is_shop_owner()  from public;
revoke all on function public.chat_delete(uuid) from public;
grant execute on function public.is_shop_owner()  to authenticated;
grant execute on function public.chat_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Naming a different owner
--
-- Run this on its own, with the address of the account that should have
-- it. There is no rule that says there must be exactly one owner: name
-- two if two people should be able to delete.
--
--   update public.admins set role = 'owner' where email = 'someone@example.com';
--
-- And to take it back:
--
--   update public.admins set role = 'agent' where email = 'someone@example.com';
--
-- To see where things stand:
--
--   select email, role, added_at from public.admins order by added_at;
-- ---------------------------------------------------------------------
