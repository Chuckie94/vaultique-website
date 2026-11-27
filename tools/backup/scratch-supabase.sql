-- =====================================================================
-- THE CHECK'S EMPTY SUPABASE (website build 92)
--
-- Loaded into a fresh, empty database on GitHub's machine before each copy
-- is restored into it, so the copy can be checked by restoring it. It is
-- the least a copy of this website needs to load: Supabase's own roles,
-- auth.uid() and its neighbours, pgcrypto in "extensions", and the users'
-- ids (filled in from the copy itself). Never run on the shop's Supabase.
-- =====================================================================
set client_min_messages = warning;

do $r$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
                           'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$r$;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable
  as $f$ select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable
  as $f$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'anon') $f$;
create or replace function auth.jwt() returns jsonb language sql stable
  as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create or replace function auth.email() returns text language sql stable
  as $f$ select auth.jwt() ->> 'email' $f$;
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);

create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
                                            owner uuid, metadata jsonb, created_at timestamptz, updated_at timestamptz);

do $p$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $p$;

-- The copy brings its own schema "public".
drop schema if exists public cascade;
