-- ===========================================================================
-- A stand-in for the parts of Supabase the website's own SQL builds on, so
-- the REAL supabase-setup.sql, supabase-payments.sql and supabase-rewards.sql
-- load into a plain empty Postgres, and supabase-pos-orders.sql is then run
-- on top of them exactly as it will be on the live website:
--
--   createdb vq_pos
--   psql -d vq_pos -f tests/pos-orders-fixture.sql -f supabase-setup.sql \
--        -f supabase-payments.sql -f tests/pos-orders-admins.sql \
--        -f supabase-rewards.sql -f supabase-pos-orders.sql \
--        -f tests/pos-orders.sql
--
-- The three Supabase roles; auth.users and auth.uid() (whoever is in
-- auth.whoami is signed in); the storage tables the photo bucket's rules
-- name. Nothing here is the website's own: that all comes from its files.
-- ===========================================================================
create extension if not exists pgcrypto;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants every table and function in public to these roles by
-- default; Row Level Security and the functions' own revokes decide.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create table if not exists auth.whoami (id uuid);
grant select on auth.whoami to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select id from auth.whoami limit 1;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select case when exists (select 1 from auth.whoami) then 'authenticated' else 'anon' end;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;

-- PostgREST's schema reload, which the files ask for at the end.
-- (NOTIFY on a channel nobody listens to is harmless.)
