-- =====================================================================
-- Vaultique Rewards on the website
-- Run once in this WEBSITE's Supabase SQL Editor (not the platform's).
-- Safe to run again.
--
-- WHAT IS KEPT HERE, AND WHAT IS NOT. The platform owns the points. This
-- database keeps only the website's own records:
--   * which customer number a website account has proved is theirs;
--   * a short-lived sign-in code, as a fingerprint, never the code itself;
--   * requests for the team (link me, or sign me up);
--   * points a website order has promised, until the till rings it up.
-- No name, phone, email, balance or sale from the platform is stored, and
-- nothing here is ever sent to the platform.
--
-- WHO MAY DO WHAT. A customer may read their own link, requests and
-- promises, and nothing else. Every write is made by the website's own
-- server function (netlify/functions/rewards.js) or, for the team, by the
-- functions at the bottom, which check the person may handle orders.
-- =====================================================================

-- 1) A website account and the customer number it has proved -------------
create table if not exists public.rewards_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  cust_no    text not null check (cust_no ~ '^[0-9A-Z]{3,24}$'),
  how        text not null default 'code' check (how in ('code', 'team')),
  linked_at  timestamptz not null default now()
);
-- One customer number, one website account: two accounts spending the
-- same points is the duplicate this exists to prevent.
create unique index if not exists rewards_links_one_number on public.rewards_links (cust_no);

-- 2) The code sent to the email on the customer's record -----------------
create table if not exists public.rewards_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  cust_no    text not null,
  code_hash  text,                      -- a fingerprint of the code; null when none was sent
  expires_at timestamptz not null,
  tries      integer not null default 0,
  sends      integer not null default 0,
  window_at  timestamptz not null default now()
);

-- 3) Requests for the team ----------------------------------------------
-- 'link': prove this number is mine (no email on the record, or a number
--         the code could not be sent for). The team checks on the platform.
-- 'join': I am not a registered customer yet; please register me.
create table if not exists public.rewards_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('link', 'join')),
  cust_no     text check (cust_no is null or cust_no ~ '^[0-9A-Z]{3,24}$'),
  name        text check (name is null or length(name) <= 80),    -- typed by the customer, for 'join'
  phone       text check (phone is null or length(phone) <= 30),  -- typed by the customer, for 'join'
  status      text not null default 'waiting' check (status in ('waiting', 'done', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);
create index if not exists rewards_requests_waiting on public.rewards_requests (created_at desc) where status = 'waiting';
-- One open request of each kind per account.
create unique index if not exists rewards_requests_one_open
  on public.rewards_requests (user_id, kind) where status = 'waiting';

-- 4) Points promised on a website order ---------------------------------
-- The customer pays less now; the till takes the points when the order
-- is rung up for that customer. Until then the website shows the balance
-- less these, so the same points cannot be promised twice.
create table if not exists public.rewards_holds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cust_no     text not null,
  order_ref   text not null check (length(order_ref) <= 40),
  points      integer not null check (points > 0),
  value       numeric(12,2) not null check (value > 0),
  status      text not null default 'promised' check (status in ('promised', 'rung_up', 'released')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);
create index if not exists rewards_holds_open on public.rewards_holds (cust_no) where status = 'promised';
create unique index if not exists rewards_holds_one_per_order on public.rewards_holds (order_ref);


-- 5) Who may read ---------------------------------------------------------
alter table public.rewards_links    enable row level security;
alter table public.rewards_codes    enable row level security;
alter table public.rewards_requests enable row level security;
alter table public.rewards_holds    enable row level security;

-- The team: the owner, or a role allowed to handle orders.
create or replace function public.may_handle_rewards()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
     and coalesce((select a.active from public.admins a where a.id = auth.uid()), true)
     and (
       public.is_shop_owner()
       or coalesce(
            (select (s.data->(select coalesce(a.role,'agent') from public.admins a
                                where a.id = auth.uid())->'permissions'->>'orders')::boolean
               from public.site_settings s where s.key = 'roles'),
            false)
     );
$$;

drop policy if exists rl_own on public.rewards_links;
create policy rl_own on public.rewards_links for select to authenticated
  using (user_id = auth.uid() or public.may_handle_rewards());
drop policy if exists rr_own on public.rewards_requests;
create policy rr_own on public.rewards_requests for select to authenticated
  using (user_id = auth.uid() or public.may_handle_rewards());
drop policy if exists rh_own on public.rewards_holds;
create policy rh_own on public.rewards_holds for select to authenticated
  using (user_id = auth.uid() or public.may_handle_rewards());
-- rewards_codes: no policy at all. Only the server function touches it.

-- Nobody writes these tables directly. The server function uses the
-- service key; the team uses the functions below.
revoke insert, update, delete on public.rewards_links    from anon, authenticated;
revoke insert, update, delete on public.rewards_requests from anon, authenticated;
revoke insert, update, delete on public.rewards_holds    from anon, authenticated;
revoke all on public.rewards_codes from anon, authenticated;
revoke all on public.rewards_links, public.rewards_requests, public.rewards_holds from anon;
grant select on public.rewards_links, public.rewards_requests, public.rewards_holds to authenticated;


-- 6) What the team can do -------------------------------------------------

-- A request answered. Approving a 'link' links that account to the number
-- the team has checked on the platform.
create or replace function public.rewards_decide(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.rewards_requests;
begin
  if not public.may_handle_rewards() then raise exception 'not permitted'; end if;
  select * into r from public.rewards_requests where id = p_request for update;
  if not found or r.status <> 'waiting' then raise exception 'That request has already been answered.'; end if;
  if p_approve and r.kind = 'link' then
    if r.cust_no is null then raise exception 'That request has no customer number.'; end if;
    if exists (select 1 from public.rewards_links where cust_no = r.cust_no and user_id <> r.user_id) then
      raise exception 'Customer number % is already linked to another website account.', r.cust_no;
    end if;
    insert into public.rewards_links (user_id, cust_no, how) values (r.user_id, r.cust_no, 'team')
      on conflict (user_id) do update set cust_no = excluded.cust_no, how = 'team', linked_at = now();
  end if;
  update public.rewards_requests
     set status = case when p_approve then 'done' else 'declined' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_request;
end;
$$;

-- Points promised on an order: rung up on the till for that customer, or
-- let go (the order was cancelled, or paid without the points).
create or replace function public.rewards_settle(p_hold uuid, p_rung_up boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_handle_rewards() then raise exception 'not permitted'; end if;
  update public.rewards_holds
     set status = case when p_rung_up then 'rung_up' else 'released' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_hold and status = 'promised';
  if not found then raise exception 'Those points have already been settled.'; end if;
end;
$$;

-- Unlinking an account (a customer number typed in error, or a phone
-- handed on). The customer's points on the platform are untouched.
create or replace function public.rewards_unlink(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_handle_rewards() then raise exception 'not permitted'; end if;
  delete from public.rewards_links where user_id = p_user;
end;
$$;

revoke all on function public.may_handle_rewards() from public, anon;
revoke all on function public.rewards_decide(uuid, boolean) from public, anon;
revoke all on function public.rewards_settle(uuid, boolean) from public, anon;
revoke all on function public.rewards_unlink(uuid) from public, anon;
grant execute on function public.may_handle_rewards() to authenticated;
grant execute on function public.rewards_decide(uuid, boolean) to authenticated;
grant execute on function public.rewards_settle(uuid, boolean) to authenticated;
grant execute on function public.rewards_unlink(uuid) to authenticated;

notify pgrst, 'reload schema';

-- The check. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('rewards_links',    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rewards_links')),
    ('rewards_codes',    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rewards_codes')),
    ('rewards_requests', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rewards_requests')),
    ('rewards_holds',    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rewards_holds')),
    ('rewards_decide',   exists (select 1 from pg_proc where proname = 'rewards_decide')),
    ('rewards_settle',   exists (select 1 from pg_proc where proname = 'rewards_settle'))
  ) t(part, done);
