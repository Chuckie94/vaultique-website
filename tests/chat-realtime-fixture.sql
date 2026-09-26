-- A stand-in for Supabase Realtime's realtime.send, recording what it was
-- asked to send, and the typing column supabase-chat-phase8.sql adds.
create schema if not exists realtime;
create table if not exists realtime.sent (topic text, event text, payload jsonb);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean)
returns void language sql as $$ insert into realtime.sent values (topic, event, payload) $$;
alter table public.chat_conversations add column if not exists shop_typing_at timestamptz;
