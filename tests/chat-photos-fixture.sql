-- ===========================================================================
-- A stand-in for what supabase-chat-photos.sql builds on, so that
-- tests/chat-photos.sql runs against a plain empty Postgres:
-- the chat tables (tests/chat-jobs-fixture.sql, run first) plus the two
-- Supabase Storage tables and the chat-uploads bucket's existing rules.
--
--   dropdb --if-exists vq_photos && createdb vq_photos
--   psql -d vq_photos -f tests/chat-jobs-fixture.sql \
--                     -f tests/chat-photos-fixture.sql \
--                     -f supabase-chat-photos.sql \
--                     -f tests/chat-photos.sql
-- ===========================================================================
create extension if not exists pgcrypto;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;

insert into storage.buckets (id, name, public) values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

-- phase 4 and phase 6, as they stand
drop policy if exists cu_read on storage.objects;
create policy cu_read on storage.objects for select using (bucket_id = 'chat-uploads');
drop policy if exists cu_write on storage.objects;
create policy cu_write on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-uploads' and public.chat_may_answer());
drop policy if exists cu_update on storage.objects;
create policy cu_update on storage.objects for update to authenticated
  using (bucket_id = 'chat-uploads' and public.chat_may_answer());
