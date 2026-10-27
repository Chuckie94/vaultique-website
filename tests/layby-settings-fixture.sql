-- ===========================================================================
-- A stand-in for what Supabase provides, so tests/layby-settings.sql runs on a
-- plain empty Postgres: the three roles, auth.uid(), is_admin(), and the table
-- privileges Supabase grants by default (so that what decides is the row
-- level security in supabase-setup.sql, exactly as on the real project).
--
--   createdb vq_layby
--   psql -d vq_layby -f tests/layby-settings-fixture.sql
--   sed -n '/^create table if not exists public.site_settings (/,/with check (public.is_admin());/p' \
--       supabase-setup.sql | psql -d vq_layby
--   psql -d vq_layby -f tests/layby-settings.sql
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.whoami (id uuid);
grant select on auth.whoami to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select id from auth.whoami limit 1;
$$;

create table if not exists public.admins (id uuid primary key);
grant select on public.admins to anon, authenticated, service_role;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;
