-- The parts of Supabase the setup file assumes exist.
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
-- auth.uid() and auth.role() as Supabase defines them
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
-- Supabase grants these to signed-in users; without them a test fails for
-- reasons that have nothing to do with the policies being checked.
grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;

-- an existing admin, so the self-seeding insert has something to carry across
insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'owner@vaultique.test')
  on conflict (id) do nothing;
