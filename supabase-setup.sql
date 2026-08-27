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

-- 3) Row Level Security: public read, admin (authenticated) write ------
alter table public.product_meta  enable row level security;
alter table public.site_content  enable row level security;

drop policy if exists pm_read   on public.product_meta;
drop policy if exists pm_write  on public.product_meta;
drop policy if exists sc_read   on public.site_content;
drop policy if exists sc_write  on public.site_content;

create policy pm_read  on public.product_meta for select using (true);
create policy pm_write on public.product_meta for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy sc_read  on public.site_content for select using (true);
create policy sc_write on public.site_content for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
  with check (bucket_id = 'product-images');
create policy vbp_img_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images');
create policy vbp_img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images');

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
create policy rv_insert on public.reviews for insert with check (
  rating between 1 and 5
  and char_length(name) between 1 and 60
  and (comment is null or char_length(comment) <= 1000)
);
create policy rv_admin  on public.reviews for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 6) Newsletter subscribers (private: only admin can read) -------------
create table if not exists public.subscribers (
  email      text primary key,
  created_at timestamptz default now()
);
alter table public.subscribers enable row level security;
drop policy if exists sub_insert on public.subscribers;
drop policy if exists sub_admin  on public.subscribers;
create policy sub_insert on public.subscribers for insert
  with check (char_length(email) between 3 and 200);
create policy sub_admin  on public.subscribers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Done. Next: create your admin login under Authentication > Users,
-- then paste the Project URL and anon key into config.js.
