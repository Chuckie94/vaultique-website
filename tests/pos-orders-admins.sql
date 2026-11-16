-- ===========================================================================
-- What the chat files add to the admins table before supabase-rewards.sql
-- reads it (role and active, from supabase-chat-phase10.sql; is_shop_owner,
-- from supabase-chat-phase5.sql), so the rewards file loads as it does on the
-- live website. Copied as they are written there.
-- ===========================================================================
alter table public.admins add column if not exists role text not null default 'agent';
alter table public.admins add column if not exists display_name text;
alter table public.admins add column if not exists active boolean not null default true;

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
