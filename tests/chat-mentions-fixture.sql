-- What supabase-chat-mentions.sql builds on, beyond tests/chat-jobs-fixture.sql:
-- the notes table (phase 3), auth.users, the private settings row the push
-- reads, and a stand-in for pg_net that records what it was asked to post.
create table if not exists public.chat_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  author_id uuid, kind text not null default 'note' check (kind in ('note', 'event')),
  body text not null, created_at timestamptz not null default now()
);
alter table public.chat_notes enable row level security;
drop policy if exists cn_admin on public.chat_notes;
create policy cn_admin on public.chat_notes for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.chat_notes to authenticated;
grant select, update on public.chat_conversations to authenticated;
grant usage on schema public to authenticated;
create table if not exists auth.users (id uuid primary key, email text);
create table if not exists public.site_settings_private (key text primary key, data jsonb);
insert into public.site_settings_private values
  ('chat_push', '{"siteUrl":"https://shop.test","secret":"s"}') on conflict (key) do nothing;
create schema if not exists net;
create table if not exists net.posted (url text, body jsonb);
create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
returns bigint language sql as $$ insert into net.posted values (url, body); select 1::bigint $$;
alter table public.chat_conversations add column if not exists assigned_at timestamptz;
