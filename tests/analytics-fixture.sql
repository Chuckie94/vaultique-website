-- ===========================================================================
-- A stand-in for the parts of a Supabase project that supabase-analytics.sql
-- ===========================================================================
-- Nothing here ships with the website and nothing here is run against a real
-- project. It exists so that tests/analytics.sql can be run against a plain
-- empty Postgres — the two roles Supabase creates, an auth.uid() that can be
-- pointed at whoever a test wants to be, and the three objects the setup file
-- and phase 10 leave behind.
--
-- The roles row below is phase 10's seed COPIED EXACTLY, with no 'analytics'
-- key anywhere in it, because a shop that ran phase 10 before this feature
-- existed is the case that has to work.
--
--   dropdb --if-exists vq_test && createdb vq_test
--   psql -d vq_test -f tests/analytics-fixture.sql \
--                   -f supabase-analytics.sql \
--                   -f tests/analytics.sql
-- ===========================================================================
-- A stand-in for the parts of a Supabase project that supabase-analytics.sql
-- expects to already be there: the two roles, auth.uid(), and the three
-- objects phase 10 and the setup file create.
-- Roles belong to the cluster, not the database, so a second run of this
-- against a fresh database must not trip over the ones the first left behind.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
-- The signed-in person, switched from the tests.
create table auth.whoami (id uuid);
create or replace function auth.uid() returns uuid language sql stable as $$
  select id from auth.whoami limit 1;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.admins (
  id uuid primary key,
  email text,
  role text not null default 'agent',
  display_name text,
  active boolean not null default true,
  must_change_password boolean not null default false
);
create table public.site_settings (key text primary key, data jsonb not null default '{}'::jsonb);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;

-- phase 5's version, near enough: the first administrator on file is the owner.
create or replace function public.is_shop_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                  where a.id = auth.uid() and a.role = 'owner');
$$;

alter table public.admins enable row level security;
alter table public.site_settings enable row level security;
create policy adm_read on public.admins for select using (public.is_admin());
create policy ss_read on public.site_settings for select using (true);

-- phase 10's seed, verbatim in shape: no 'analytics' key anywhere.
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

-- Three people: the owner, an administrator, and an agent.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@vaultique.test'),
  ('22222222-2222-2222-2222-222222222222', 'admin@vaultique.test'),
  ('33333333-3333-3333-3333-333333333333', 'agent@vaultique.test');
insert into public.admins (id, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'owner@vaultique.test', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'admin@vaultique.test', 'full'),
  ('33333333-3333-3333-3333-333333333333', 'agent@vaultique.test', 'agent');
