-- ===========================================================================
-- A stand-in for what supabase-payments.sql builds on, so tests/payments.sql
-- runs against a plain empty Postgres: the three Supabase roles, auth.uid(),
-- is_admin(), and the orders table exactly as supabase-setup.sql makes it.
--
--   createdb vq_pay
--   psql -d vq_pay -f tests/payments-fixture.sql -f supabase-payments.sql \
--                  -f tests/payments.sql
-- ===========================================================================
create extension if not exists pgcrypto;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

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

create table if not exists public.customers (id uuid primary key);
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  customer_id uuid references public.customers(id) on delete set null,
  name text, phone text, email text, address text, notes text,
  fulfilment  text default 'delivery',
  total       numeric,
  currency    text,
  status      text default 'pending',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.orders enable row level security;
create policy or_insert on public.orders for insert with check (status = 'pending');
create policy or_admin  on public.orders for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.orders to anon, authenticated, service_role;
