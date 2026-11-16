-- =====================================================================
-- Vaultique Boutique Point — live chat, Phase 4: answering properly
-- ---------------------------------------------------------------------
-- Run this AFTER phases 1, 2 and 3, in the same WEBSITE project. None
-- of those files is changed by this one.
--
-- Safe to run more than once.
--
-- Until now a reply could only be words. A boutique's answers often are
-- not: "this one, in navy, K1,450" is a piece, and "it went out on
-- Tuesday" is an order. This lets a reply carry the thing itself.
--
--   · a photo the shop sends
--   · a piece, as a card the customer can open
--   · an order, with where it has got to
--   · answers the shop writes once and sends often
--
-- ONE MECHANISM, NOT FOUR. All of these are a message with something
-- attached, so all of them are one nullable `meta` column and a `kind`
-- the client draws. Four columns, or four tables, would be four things
-- to keep in step and four places for the next kind to be forgotten.
--
-- WHAT A CUSTOMER MAY ATTACH: nothing. chat_send is unchanged and has
-- no way to set meta, so a customer cannot fabricate a product card
-- with a price the shop never offered, nor an order marked delivered,
-- nor a message pointing at an image on somebody else's server. Cards
-- come from the shop or they do not exist. A customer with a photo to
-- send is handed to WhatsApp, which the shop already runs and which
-- already does this well.
-- =====================================================================

-- 1) What a message can carry -----------------------------------------
-- Null on almost every row: most replies really are just words.
--
--   {"kind":"image",   "path":"<object path in chat-uploads>"}
--   {"kind":"product", "sku":…, "name":…, "price":…, "image":…}
--   {"kind":"order",   "ref":…, "status":…, "total":…, "placed":…}
--
-- An image is stored as the path inside the bucket, never as a whole
-- address: the page builds the URL from its own project, so a row can
-- never point a customer at somebody else's server.

alter table public.chat_messages
  add column if not exists meta jsonb;


-- 2) Somewhere for the photos -----------------------------------------
-- Public to read, exactly like product-images: a customer must be able
-- to see what was sent them without signing in, and the file names are
-- random. Writing is another matter entirely, below.

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

drop policy if exists cu_read on storage.objects;
create policy cu_read on storage.objects for select
  using (bucket_id = 'chat-uploads');

-- Only the shop puts anything in it. Not "anybody signed in" and
-- certainly not the anon key: a bucket a stranger may write to is a
-- bucket somebody else pays for.
drop policy if exists cu_write on storage.objects;
create policy cu_write on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-uploads' and public.is_admin());

drop policy if exists cu_update on storage.objects;
create policy cu_update on storage.objects for update to authenticated
  using (bucket_id = 'chat-uploads' and public.is_admin());

drop policy if exists cu_delete on storage.objects;
create policy cu_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-uploads' and public.is_admin());


-- 3) Answers written once -----------------------------------------------
-- The five or six things a boutique says every day: opening hours,
-- delivery to the Copperbelt, how to pay, what happens if it does not
-- fit. Written once, and then a reply is a click rather than a retype.

create table if not exists public.chat_canned (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists chat_canned_order on public.chat_canned (sort, title);

alter table public.chat_canned enable row level security;

-- Staff only. A customer never sees this list, only the answer it puts
-- in a reply, which by then is an ordinary message.
drop policy if exists cq_admin on public.chat_canned;
create policy cq_admin on public.chat_canned for all
  using (public.is_admin()) with check (public.is_admin());


-- 4) Asking, now bringing the attachments with it ----------------------
-- Same three arguments as Phase 2, returning one more field per
-- message. Replaced rather than added to, so there is one chat_poll.

create or replace function public.chat_poll(
  p_token   text,
  p_after   timestamptz default null,
  p_viewing text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.chat_conversations%rowtype;
  v_msgs json;
begin
  select * into v_conv
    from public.chat_conversations
   where token = p_token;

  if v_conv.id is null then
    return null;
  end if;

  if p_viewing is not null and btrim(p_viewing) <> '' then
    update public.chat_conversations
       set viewing = left(btrim(p_viewing), 300), viewing_at = now()
     where id = v_conv.id;
  end if;

  select coalesce(
           json_agg(json_build_object(
             'id',     m.id,
             'sender', m.sender,
             'body',   m.body,
             'at',     m.created_at,
             -- Null for almost every row, and never set by anything a
             -- customer can call. See the note at the top.
             'meta',   m.meta
           ) order by m.created_at),
           '[]'::json)
    into v_msgs
    from public.chat_messages m
   where m.conversation_id = v_conv.id
     and (p_after is null or m.created_at > p_after);

  return json_build_object(
    'status',   v_conv.status,
    'unread',   v_conv.customer_unread,
    'named',    (v_conv.name is not null),
    -- Nothing waiting on the shop's side means the shop has read it.
    -- Only ever a count of this conversation's own messages, so it says
    -- nothing about anybody else's.
    'seen',     coalesce(v_conv.shop_unread, 0) = 0,
    -- Whether there is somebody there to answer. Away is not answering:
    -- an operator who says so should not leave a green light burning on
    -- the customer's window, which is what "not offline" did.
    'here',     exists (
                  select 1 from public.chat_agents a
                   where a.status = 'online'
                     and a.last_seen_at > now() - interval '2 minutes'),
    'messages', v_msgs
  );
end;
$$;

-- The customer saying they are done. The shop learns it the same way it
-- learns anything else about this conversation: from the row.
create or replace function public.chat_end(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set status = 'closed'
   where token = p_token and status = 'open';
end;
$$;

revoke all on function public.chat_end(text) from public;
grant execute on function public.chat_end(text) to anon, authenticated;

revoke all on function public.chat_poll(text, timestamptz, text) from public;
grant execute on function public.chat_poll(text, timestamptz, text) to anon, authenticated;

-- chat_send is deliberately NOT touched. It takes a token and a body,
-- and there is no argument through which a customer could set meta.


-- 5) The orders an operator may quote ---------------------------------
-- The admin can already read the orders table, so this exists only to
-- find one quickly by its reference or the customer it belongs to,
-- without pulling every column of every order into a chat window.

create or replace function public.chat_find_orders(
  p_customer uuid default null,
  p_phone    text default null,
  p_ref      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v json;
begin
  if not public.is_admin() then
    raise exception 'not permitted';
  end if;

  -- Something to match on, or nothing comes back. Without this the
  -- next three lines would happily return the whole order book.
  if p_customer is null
     and nullif(btrim(coalesce(p_phone, '')), '') is null
     and nullif(btrim(coalesce(p_ref,   '')), '') is null then
    return '[]'::json;
  end if;

  select coalesce(json_agg(row_to_json(o) order by o.created_at desc), '[]'::json)
    into v
    from (
      select ref, status, total, currency, fulfilment, created_at
        from public.orders
       where (p_customer is not null and customer_id = p_customer)
          or (nullif(btrim(coalesce(p_phone, '')), '') is not null and phone = btrim(p_phone))
          or (nullif(btrim(coalesce(p_ref,   '')), '') is not null
              and upper(ref) = upper(btrim(p_ref)))
       order by created_at desc
       limit 10
    ) o;

  return v;
end;
$$;

revoke all on function public.chat_find_orders(uuid, text, text) from public;
grant execute on function public.chat_find_orders(uuid, text, text) to authenticated;


-- 6) A few answers to start with --------------------------------------
-- Inserted only when the table is empty, so a shop that has written its
-- own is never given these back. Edit or delete them freely.

insert into public.chat_canned (title, body, sort)
select * from (values
  ('Opening hours',
   'We are open Monday to Saturday. Tell us when suits you and we will make sure someone is here for you.', 10),
  ('Delivery',
   'We deliver nationwide where possible. Send us the area and we will confirm the fee and how long it usually takes.', 20),
  ('Sizing',
   'Happy to help with sizing. Tell us your usual size and what you are looking at, and we will tell you how this piece runs.', 30),
  ('Holding a piece',
   'We can hold it for you. Let us know your name and a number, and it will be here when you come.', 40),
  ('How to pay',
   'Payment is arranged with us directly when you collect or when we deliver. We will confirm everything before anything is sent.', 50)
) as seed(title, body, sort)
where not exists (select 1 from public.chat_canned);

-- =====================================================================
-- Done. To check it took:
--   select count(*) from public.chat_canned;                 -- 5
--   select id from storage.buckets where id = 'chat-uploads';
-- =====================================================================
