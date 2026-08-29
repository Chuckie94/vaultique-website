-- =====================================================================
-- Vaultique Boutique Point — WEBSITE database setup
-- Run this ONCE in your NEW Supabase project (NOT the POS project):
--   Supabase dashboard > SQL Editor > New query > paste all > Run
--
-- It creates two tables, a public image bucket, and security rules so
-- that anyone can READ photos/content but only a logged-in admin (you)
-- can CHANGE them. It does not touch the POS in any way.
-- =====================================================================

-- 1) Per-product presentation data, linked to the POS by SKU ------------
create table if not exists public.product_meta (
  sku         text primary key,
  image_url   text,            -- main photo (public URL)
  gallery     jsonb default '[]'::jsonb,  -- extra photo URLs (supports 10+)
  videos      jsonb default '[]'::jsonb,  -- product video URLs (up to 2)
  featured    boolean default false,
  is_new      boolean default false,
  hidden      boolean default false,      -- hide from the website
  description text,                        -- optional custom description
  updated_at  timestamptz default now()
);
-- If product_meta already existed from an earlier setup, make sure the videos
-- column is present (safe to run repeatedly; does nothing if it already exists).
alter table public.product_meta add column if not exists videos jsonb default '[]'::jsonb;
-- Best sellers are chosen in the admin, not read from the POS: the product
-- feed deliberately carries no sales figures. Safe to run repeatedly.
alter table public.product_meta add column if not exists best_seller boolean default false;

-- Pricing. Prices themselves come from the POS and are never stored here.
-- These four columns hold only what the POS cannot tell the website:
--   ref_price      the higher price this piece was last seen at, so a
--                  reduction made in the POS can be shown as a reduction
--   ref_price_at   when that price was recorded, so a sale can go stale
--   price_override a website price that replaces the POS price outright
--   on_request     show "price on request" instead of a figure
-- Safe to run repeatedly.
alter table public.product_meta add column if not exists ref_price      numeric;
alter table public.product_meta add column if not exists ref_price_at   timestamptz;
alter table public.product_meta add column if not exists price_override numeric;
alter table public.product_meta add column if not exists on_request     boolean default false;

-- 2) Editable site content (single row of JSON) ------------------------
create table if not exists public.site_content (
  id         int primary key default 1,
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint site_content_single_row check (id = 1)
);
insert into public.site_content (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- 2b) Who counts as an admin -------------------------------------------
-- Until now every policy said `auth.role() = 'authenticated'`, which in
-- Supabase means ANYONE SIGNED IN. That was safe only while the admin was
-- the sole person who could sign in at all.
--
-- Customer accounts change that. A customer who registers is also
-- 'authenticated', and would have inherited write access to prices,
-- settings, reviews, policies, the photo bucket and — worst — the private
-- table holding the bank details.
--
-- So being signed in is no longer enough. A policy now asks whether this
-- particular user is an admin.
create table if not exists public.admins (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  added_at   timestamptz default now()
);
alter table public.admins enable row level security;

-- Everyone who could already sign in was, by definition, an admin, since
-- customers had no way to sign in at all. They are carried across so
-- nobody is locked out of their own shop by running this file.
--
-- ONLY WHILE THE TABLE IS EMPTY. Once customers exist they are also rows
-- in auth.users, and a later re-run of this file would otherwise promote
-- every one of them to administrator — quietly, and with no sign that it
-- had happened. After the first run the admins list is yours to manage in
-- the Supabase dashboard, and this file stops touching it.
insert into public.admins (id, email)
select id, email from auth.users
where not exists (select 1 from public.admins)
on conflict (id) do nothing;

-- The test every other policy uses. SECURITY DEFINER so it can read the
-- admins table without needing a policy that lets everyone read it, and
-- STABLE so Postgres calls it once per query rather than once per row.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;

-- Admins can see who else is an admin. Nobody else can see the list, and
-- nobody can add themselves: adding an admin is done in the Supabase
-- dashboard, deliberately.
drop policy if exists adm_read on public.admins;
create policy adm_read on public.admins for select using (public.is_admin());

-- 3) Row Level Security: public read, admin write ---------------------
-- Every rule below asks is_admin(), never merely "is somebody signed
-- in", so a customer account carries no power over the shop.
alter table public.product_meta  enable row level security;
alter table public.site_content  enable row level security;

drop policy if exists pm_read   on public.product_meta;
drop policy if exists pm_write  on public.product_meta;
drop policy if exists sc_read   on public.site_content;
drop policy if exists sc_write  on public.site_content;

create policy pm_read  on public.product_meta for select using (true);
create policy pm_write on public.product_meta for all
  using (public.is_admin()) with check (public.is_admin());

create policy sc_read  on public.site_content for select using (true);
create policy sc_write on public.site_content for all
  using (public.is_admin()) with check (public.is_admin());

-- 4) Public image bucket ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Storage rules: anyone can view, only logged-in admin can upload/change
drop policy if exists vbp_img_read   on storage.objects;
drop policy if exists vbp_img_write  on storage.objects;
drop policy if exists vbp_img_update on storage.objects;
drop policy if exists vbp_img_delete on storage.objects;

create policy vbp_img_read on storage.objects for select
  using (bucket_id = 'product-images');
create policy vbp_img_write on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy vbp_img_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy vbp_img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- 5) Reviews (per-product when sku is set, site-wide when sku is null) --
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  sku        text,                       -- null = review of the whole shop
  name       text not null,
  rating     int  not null check (rating between 1 and 5),
  comment    text,
  verified   boolean default false,      -- admin marks genuine buyers
  approved   boolean default true,       -- admin can hide a review
  created_at timestamptz default now()
);
alter table public.reviews enable row level security;
drop policy if exists rv_read   on public.reviews;
drop policy if exists rv_insert on public.reviews;
drop policy if exists rv_admin  on public.reviews;
create policy rv_read   on public.reviews for select using (approved = true);

-- The rule about who may publish a review needs the settings table,
-- which is created further down, so rv_insert and the function behind it
-- are made at the end of section 8 rather than here. Postgres checks a
-- function's body when it is created, and would refuse one that reads a
-- table that does not exist yet.

create policy rv_admin  on public.reviews for all
  using (public.is_admin()) with check (public.is_admin());

-- 6) Newsletter subscribers (private: only admin can read) -------------
create table if not exists public.subscribers (
  email      text primary key,
  created_at timestamptz default now()
);

-- Somebody who asks to come off the list is recorded rather than simply
-- deleted. Deleting them looks the same today and is not the same thing:
-- the row is what stops any form on the site quietly signing them up
-- again, because the address is still the primary key and a second
-- attempt has nowhere to go. Their wish outlives the request.
--
-- Added separately so an existing list keeps every address and date it
-- already had. Running this file again on a list that already has the
-- column does nothing at all.
alter table public.subscribers add column if not exists unsubscribed_at timestamptz;

alter table public.subscribers enable row level security;
drop policy if exists sub_insert on public.subscribers;
drop policy if exists sub_admin  on public.subscribers;
create policy sub_insert on public.subscribers for insert
  with check (char_length(email) between 3 and 200);
create policy sub_admin  on public.subscribers for all
  using (public.is_admin()) with check (public.is_admin());

-- 7) Website policies (editable by admin; shown on the Policies page) ---
create table if not exists public.policies (
  id         uuid primary key default gen_random_uuid(),
  section    text,
  title      text not null,
  body       text,
  sort       int  default 100,
  updated_at timestamptz default now()
);
alter table public.policies enable row level security;
drop policy if exists pol_read  on public.policies;
drop policy if exists pol_admin on public.policies;
create policy pol_read  on public.policies for select using (true);
create policy pol_admin on public.policies for all
  using (public.is_admin()) with check (public.is_admin());

-- 8) Admin settings (one row per Settings category) --------------------
-- Each Settings category in the admin stores its own row here, keyed by
-- the same key the category registers with (for example 'general'). The
-- payload is free-form JSON so a category can grow new fields later
-- without a schema change. Public read so the storefront can honour the
-- public-facing settings; only a logged-in admin may write.
create table if not exists public.site_settings (
  key        text primary key,
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.site_settings enable row level security;
drop policy if exists ss_read  on public.site_settings;
drop policy if exists ss_admin on public.site_settings;
create policy ss_read  on public.site_settings for select using (true);
create policy ss_admin on public.site_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- Whether a review of this rating is allowed to publish itself.
--
-- The shop's choice has to be enforced HERE and not only in the page.
-- "Hold new reviews for my approval" that the website merely honours is
-- a request, not a rule: anyone can speak to the database directly, and
-- a review that arrives already marked approved would appear on the shop
-- without ever being read. This asks the shop's own setting.
--
-- Absent or unreadable settings mean false, so the careful behaviour is
-- what happens when anything is missing.
create or replace function public.review_auto_publish(r int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (data->>'autoPublish')::boolean
            and r >= coalesce((data->>'minAutoRating')::int, 1)
       from public.site_settings
      where key = 'reviews'),
    false);
$$;

create policy rv_insert on public.reviews for insert with check (
  rating between 1 and 5
  and char_length(name) between 1 and 60
  and (comment is null or char_length(comment) <= 1000)
  -- Waiting to be read is always allowed. Publishing yourself is only
  -- allowed when the shop has said so.
  and (approved = false or public.review_auto_publish(rating))
  -- The badge means the shop confirmed this person bought from them, so
  -- it is the shop's word and not the reviewer's. Both this and the date
  -- are sent by the browser like everything else here, and a review
  -- posted straight at the API could otherwise arrive already wearing
  -- the badge, or dated ahead so that it holds the top of a list
  -- ordered newest first.
  and verified is not true
  and (created_at is null or created_at <= now())
);

-- 9) Private admin settings (NOT readable by the website) ---------------
-- Everything in site_settings above is public: the storefront reads it
-- with the anon key, so anyone can read it too. That is fine for opening
-- hours and colours, and wrong for a bank account number.
--
-- This table has no public read policy at all. Only a signed-in admin can
-- read or write it, so what is kept here never reaches a customer's
-- browser. Bank details and mobile money numbers live here.
create table if not exists public.site_settings_private (
  key        text primary key,
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.site_settings_private enable row level security;
drop policy if exists ssp_admin on public.site_settings_private;
create policy ssp_admin on public.site_settings_private for all
  using (public.is_admin()) with check (public.is_admin());

-- 10) Customer accounts ------------------------------------------------
-- A customer signs in with Supabase Auth, the same machinery the admin
-- uses. What separates them is section 2b: an admin is a row in `admins`,
-- and a customer never is. Being signed in gives a customer power over
-- their own rows here and nothing else anywhere.
create table if not exists public.customers (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  phone       text,
  wishlist    jsonb default '[]'::jsonb,   -- SKUs, so it follows them between devices
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.customers enable row level security;
drop policy if exists cu_own   on public.customers;
drop policy if exists cu_admin on public.customers;
-- A customer reads and writes their own row. Not anyone else's: `using`
-- covers reading and updating, `with check` stops them writing a row
-- under somebody else's id.
create policy cu_own   on public.customers for all
  using (auth.uid() = id) with check (auth.uid() = id);
create policy cu_admin on public.customers for select using (public.is_admin());

-- Saved addresses. Several per customer, so a phone and a laptop agree
-- and an address survives a new device.
create table if not exists public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label       text,                        -- 'Home', 'Office'
  recipient   text,
  phone       text,
  address     text not null,
  city        text,
  is_default  boolean default false,
  created_at  timestamptz default now()
);
create index if not exists ca_customer on public.customer_addresses(customer_id);
alter table public.customer_addresses enable row level security;
drop policy if exists ca_own   on public.customer_addresses;
drop policy if exists ca_admin on public.customer_addresses;
create policy ca_own   on public.customer_addresses for all
  using (auth.uid() = customer_id) with check (auth.uid() = customer_id);
create policy ca_admin on public.customer_addresses for select using (public.is_admin());

-- 11) Orders -----------------------------------------------------------
-- What this is, and what it is not.
--
-- The shop is settled on WhatsApp. A row here is created when a customer
-- presses Continue, so it records what somebody ASKED FOR, not what the
-- shop agreed to. That is why a new row is 'pending' and why the admin
-- can confirm or cancel it: the truth is in the conversation, and this
-- table is only useful for as long as somebody keeps it honest.
--
-- The price is copied in rather than looked up later, because a piece
-- reduced next week must not rewrite what was asked for today.
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,                 -- short human reference, e.g. VB-3F9K
  customer_id uuid references public.customers(id) on delete set null,
  name        text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  fulfilment  text default 'delivery',     -- 'delivery' or 'collection'
  total       numeric,                     -- what the site showed at the time
  currency    text,
  status      text default 'pending',      -- pending | confirmed | completed | cancelled
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists or_customer on public.orders(customer_id);
create index if not exists or_created  on public.orders(created_at desc);

create table if not exists public.order_items (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references public.orders(id) on delete cascade,
  sku       text,
  name      text,
  price     numeric,
  qty       int default 1
);
create index if not exists oi_order on public.order_items(order_id);

alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

drop policy if exists or_insert  on public.orders;
drop policy if exists or_own     on public.orders;
drop policy if exists or_admin   on public.orders;
drop policy if exists oi_insert  on public.order_items;
drop policy if exists oi_own     on public.order_items;
drop policy if exists oi_admin   on public.order_items;

-- Anyone may place an order, signed in or not, because guest checkout is
-- a setting and a guest must still be able to buy. A guest's row carries
-- no customer_id, so nobody can later claim it: an order with no owner
-- can only be read by the admin.
--
-- A signed-in customer may only file an order under their own id, so one
-- customer cannot put an order in another's history.
create policy or_insert on public.orders for insert
  with check (
    (customer_id is null or customer_id = auth.uid())
    -- The same shape of sanity check the reviews table uses. An open
    -- insert with no bounds is an invitation to fill the table with
    -- nonsense from a browser console.
    and (name  is null or char_length(name)  <= 120)
    and (phone is null or char_length(phone) <= 40)
    and (email is null or char_length(email) <= 160)
    and (address is null or char_length(address) <= 400)
    and (notes is null or char_length(notes) <= 600)
    and (total is null or (total >= 0 and total < 10000000))
    and (fulfilment is null or fulfilment in ('delivery', 'collection'))
    and status = 'pending'          -- nobody files an order already confirmed
  );
create policy or_own    on public.orders for select
  using (customer_id is not null and customer_id = auth.uid());
create policy or_admin  on public.orders for all
  using (public.is_admin()) with check (public.is_admin());

-- Lines follow their order. The insert rule repeats the order's own test
-- rather than trusting the order_id it was handed.
create policy oi_insert on public.order_items for insert
  with check (
    (name is null or char_length(name) <= 200)
    and (sku is null or char_length(sku) <= 60)
    and (price is null or (price >= 0 and price < 10000000))
    and (qty is null or (qty > 0 and qty <= 999))
    and exists (
      select 1 from public.orders o
      where o.id = order_id and (o.customer_id is null or o.customer_id = auth.uid())
    )
  );
create policy oi_own    on public.order_items for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id is not null and o.customer_id = auth.uid()
  ));
create policy oi_admin  on public.order_items for all
  using (public.is_admin()) with check (public.is_admin());

-- Writing an order, for everybody.
--
-- A guest must be able to place one and, from their side of the fence,
-- cannot. or_insert lets the row in, but PostgreSQL applies a table's
-- SELECT policies to anything an insert RETURNs, and a guest passes
-- none of them -- so asking for the new row's id, which the lines need,
-- refuses the whole insert. The lines are refused as well: oi_insert
-- asks whether the order exists, and that question is answered under
-- the caller's own reading rights, which show a guest nothing.
--
-- So the order and its lines are written here, together, by a function
-- with the standing to do it. Every limit the two policies above state
-- is restated inside it, so nothing is loosened by going through it:
-- the caller cannot choose the status, cannot file an order under
-- anybody else's name, and cannot exceed any of the same bounds. The
-- policies stay exactly as they are, and still govern every other way
-- in.
create or replace function public.place_order(
  p_order jsonb,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_ref      text;
  v_customer uuid := auth.uid();
  v_pool     text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- no O/0, no I/1
  v_try      int;
  v_i        int;
  v_item     jsonb;
  v_count    int;
  v_name     text := nullif(p_order->>'name', '');
  v_phone    text := nullif(p_order->>'phone', '');
  v_email    text := nullif(p_order->>'email', '');
  v_address  text := nullif(p_order->>'address', '');
  v_notes    text := nullif(p_order->>'notes', '');
  v_fulfil   text := coalesce(nullif(p_order->>'fulfilment', ''), 'delivery');
  v_total    numeric := nullif(p_order->>'total', '')::numeric;
  v_currency text := nullif(p_order->>'currency', '');
begin
  -- The same sanity limits or_insert states. An open door with no bounds
  -- is an invitation to fill the table from a browser console.
  if v_name    is not null and char_length(v_name)    > 120 then raise exception 'name is too long'; end if;
  if v_phone   is not null and char_length(v_phone)   > 40  then raise exception 'phone is too long'; end if;
  if v_email   is not null and char_length(v_email)   > 160 then raise exception 'email is too long'; end if;
  if v_address is not null and char_length(v_address) > 400 then raise exception 'address is too long'; end if;
  if v_notes   is not null and char_length(v_notes)   > 600 then raise exception 'notes are too long'; end if;
  if v_total   is not null and (v_total < 0 or v_total >= 10000000) then raise exception 'total is out of range'; end if;
  if v_fulfil not in ('delivery', 'collection') then v_fulfil := 'delivery'; end if;

  if jsonb_typeof(p_items) <> 'array' then p_items := '[]'::jsonb; end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 200 then raise exception 'too many lines in one order'; end if;

  -- Short, sayable over a phone, and not sequential: a running number
  -- would tell anyone who ordered how many orders the shop has had.
  -- Made here rather than in the browser so that two people pressing
  -- Continue at the same moment cannot land on the same one.
  for v_try in 1..12 loop
    v_ref := 'VB-';
    for v_i in 1..5 loop
      v_ref := v_ref || substr(v_pool, 1 + floor(random() * char_length(v_pool))::int, 1);
    end loop;
    begin
      insert into public.orders
        (ref, customer_id, name, phone, email, address, notes, fulfilment, total, currency, status)
      values
        (v_ref, v_customer, v_name, v_phone, v_email, v_address, v_notes, v_fulfil, v_total, v_currency, 'pending')
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;   -- that reference was taken; try another
    end;
  end loop;

  if v_id is null then raise exception 'could not allocate an order reference'; end if;

  -- The lines, with the same bounds oi_insert states. A line that fails
  -- one of them fails the whole order rather than being dropped
  -- quietly: half an order in the Orders tab is worse than none.
  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'name', '') is not null and char_length(v_item->>'name') > 200 then
      raise exception 'a line name is too long';
    end if;
    if nullif(v_item->>'sku', '') is not null and char_length(v_item->>'sku') > 60 then
      raise exception 'a line sku is too long';
    end if;
    if nullif(v_item->>'price', '') is not null
       and ((v_item->>'price')::numeric < 0 or (v_item->>'price')::numeric >= 10000000) then
      raise exception 'a line price is out of range';
    end if;
    if nullif(v_item->>'qty', '') is not null
       and ((v_item->>'qty')::int <= 0 or (v_item->>'qty')::int > 999) then
      raise exception 'a line quantity is out of range';
    end if;

    insert into public.order_items (order_id, sku, name, price, qty)
    values (
      v_id,
      nullif(v_item->>'sku', ''),
      nullif(v_item->>'name', ''),
      nullif(v_item->>'price', '')::numeric,
      coalesce(nullif(v_item->>'qty', '')::int, 1)
    );
  end loop;

  return jsonb_build_object('id', v_id, 'ref', v_ref);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;

-- 12) Activity log ------------------------------------------------------
-- What changed in the admin, when, and who changed it.
--
-- Append only, and deliberately so. There is a policy to write a line
-- and a policy to read the lines, and none at all to change or remove
-- one - not even for an administrator. A record that the person being
-- recorded can quietly edit is not a record of anything, and the whole
-- value of this table is that it cannot be tidied up after the fact.
--
-- What it must never hold: the VALUE of anything private. A bank account
-- number written into "previous value" would be readable by exactly the
-- people the private settings table was built to keep it from, and it
-- would sit there in plain text for years. The admin records that such a
-- field changed and never what it changed to; see assets/admin/audit.js,
-- which is where that is enforced.
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text,        -- added | changed | deleted
  module      text,        -- where in the admin it happened
  record      text,        -- which thing it happened to
  changes     jsonb,       -- [{ field, from, to }], never for private settings
  device      text         -- the browser and device, as the browser reports them
);
create index if not exists al_at on public.activity_log(at desc);

alter table public.activity_log enable row level security;
drop policy if exists al_read   on public.activity_log;
drop policy if exists al_write  on public.activity_log;
drop policy if exists al_admin  on public.activity_log;
-- An older run of this file may have created a policy that allowed
-- everything. Dropped above, and not recreated.
create policy al_read  on public.activity_log for select using (public.is_admin());
create policy al_write on public.activity_log for insert with check (public.is_admin());

-- Done. Next: create your admin login under Authentication > Users,
-- then paste the Project URL and anon key into config.js.
