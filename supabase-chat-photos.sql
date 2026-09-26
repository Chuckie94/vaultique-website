-- =====================================================================
-- Vaultique Boutique Point: CUSTOMERS MAY SEND A PHOTO IN THE CHAT
-- Run once in this website's Supabase SQL Editor, after the other chat
-- files. Safe to run again.
--
-- Until now only the shop could attach a photo (supabase-chat-phase4.sql),
-- and the reason was cost: a bucket the anon key can write to is a
-- bucket any stranger can fill at the shop's expense. That reason still
-- stands, so a customer's photo goes in through a narrow door:
--
--   1. chat_photo_start(token) hands out ONE address to upload to. It
--      answers only to somebody holding an open conversation's token,
--      and at most 10 times an hour per conversation (300 an hour across
--      the whole shop, so opening many conversations does not get round
--      it).
--   2. Storage accepts an upload from a customer only at an address
--      handed out in the last 15 minutes and not yet used. Nothing can
--      be overwritten: updating stays with the shop.
--   3. The bucket takes images only, 5 MB at most. The website shrinks
--      a photo on the customer's phone first, to a few hundred KB.
--   4. chat_send_photo(token, path) puts the photo in the conversation,
--      and only if the file really arrived at an address that
--      conversation was given.
--
-- A customer still cannot set meta themselves: the message's meta is
-- written here, by the database, from the address it handed out.
-- =====================================================================

-- 1) The addresses handed out ------------------------------------------
create table if not exists public.chat_photo_slots (
  path             text primary key,
  conversation_id  uuid not null
                     references public.chat_conversations(id) on delete cascade,
  created_at       timestamptz not null default now(),
  used_at          timestamptz
);
create index if not exists chat_photo_slots_recent
  on public.chat_photo_slots (conversation_id, created_at);

-- Shut to everybody. Only the functions below touch it.
alter table public.chat_photo_slots enable row level security;
drop policy if exists cps_admin on public.chat_photo_slots;
create policy cps_admin on public.chat_photo_slots for select
  using (public.is_admin());


-- 2) The bucket: images only, 5 MB at most -----------------------------
-- The shop's own chat photos were already held to images of 5 MB by the
-- admin; this makes the bucket itself say so, for everybody.
update storage.buckets
   set file_size_limit    = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp',
                                  'image/gif', 'image/heic', 'image/heif']
 where id = 'chat-uploads';


-- 3) Is this an address a customer may upload to right now? ------------
create or replace function public.chat_photo_slot_open(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_photo_slots s
     where s.path = p_name
       and s.used_at is null
       and s.created_at > now() - interval '15 minutes'
  );
$$;
revoke all on function public.chat_photo_slot_open(text) from public;
grant execute on function public.chat_photo_slot_open(text) to anon, authenticated;

drop policy if exists cu_customer_write on storage.objects;
create policy cu_customer_write on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'chat-uploads' and public.chat_photo_slot_open(name));


-- 4) Asking for an address ---------------------------------------------
create or replace function public.chat_photo_start(p_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_path text;
begin
  select id into v_id
    from public.chat_conversations
   where token = p_token and status = 'open';
  if v_id is null then
    raise exception 'no open conversation';
  end if;

  -- Addresses asked for and never used are forgotten after a day.
  delete from public.chat_photo_slots
   where used_at is null and created_at < now() - interval '1 day';

  if (select count(*) from public.chat_photo_slots
       where conversation_id = v_id
         and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many photos';
  end if;
  if (select count(*) from public.chat_photo_slots
       where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many photos';
  end if;

  -- Inside the conversation's own folder, beside the shop's photos, and
  -- named at random: nothing of the customer's phone is published.
  v_path := v_id::text || '/c-' || encode(gen_random_bytes(12), 'hex') || '.jpg';
  insert into public.chat_photo_slots (path, conversation_id) values (v_path, v_id);
  return v_path;
end;
$$;
revoke all on function public.chat_photo_start(text) from public;
grant execute on function public.chat_photo_start(text) to anon, authenticated;


-- 5) Sending it ----------------------------------------------------------
create or replace function public.chat_send_photo(
  p_token text,
  p_path  text,
  p_body  text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_id uuid;
  v_at timestamptz;
begin
  select id into v_id
    from public.chat_conversations
   where token = p_token and status = 'open';
  if v_id is null then
    raise exception 'no open conversation';
  end if;

  update public.chat_photo_slots
     set used_at = now()
   where path = p_path and conversation_id = v_id and used_at is null;
  if not found then
    raise exception 'unknown photo';
  end if;

  if not exists (select 1 from storage.objects
                  where bucket_id = 'chat-uploads' and name = p_path) then
    raise exception 'photo not uploaded';
  end if;

  insert into public.chat_messages (conversation_id, sender, body, meta)
  values (v_id, 'customer', left(btrim(coalesce(p_body, '')), 2000),
          jsonb_build_object('kind', 'image', 'path', p_path))
  returning created_at into v_at;

  return v_at;
end;
$$;
revoke all on function public.chat_send_photo(text, text, text) from public;
grant execute on function public.chat_send_photo(text, text, text) to anon, authenticated;


-- 6) How the website knows this file has been run -----------------------
-- The photo button is only shown once this answers, so a shop that has
-- not run this file never shows customers a button that cannot work.
create or replace function public.chat_photos_on()
returns boolean
language sql
stable
as $$ select true $$;
revoke all on function public.chat_photos_on() from public;
grant execute on function public.chat_photos_on() to anon, authenticated;

-- Checking: select public.chat_photos_on();   -- true
