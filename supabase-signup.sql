-- =====================================================================
-- Creating customer accounts, with the link sent by the shop's own email
-- Run once in this WEBSITE's Supabase SQL Editor. Safe to run again.
--
-- netlify/functions/account-signup.js makes the account with the website's
-- service key and emails the "confirm your email" link through Settings >
-- Notifications. It needs two small things here. Neither can be reached by
-- a browser: only the website's own server function, with the service key.
-- =====================================================================

-- 1) Whether an address already has an account: 'none', 'waiting'
--    (not confirmed yet) or 'confirmed'. Nothing else about the account.
create or replace function public.account_signup_state(p_email text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select case when u.email_confirmed_at is null then 'waiting' else 'confirmed' end
       from auth.users u
      where lower(u.email) = lower(trim(p_email))
      order by u.created_at desc
      limit 1),
    'none');
$$;
revoke all on function public.account_signup_state(text) from public, anon, authenticated;
grant execute on function public.account_signup_state(text) to service_role;

-- 2) How many links were sent in the last hour, per address and per
--    connection, kept as fingerprints (never the address itself), so
--    nobody can use the shop to flood a stranger's inbox.
create table if not exists public.signup_sends (
  k          text primary key check (length(k) <= 64),
  sends      integer not null default 0,
  window_at  timestamptz not null default now()
);
alter table public.signup_sends enable row level security;
revoke all on public.signup_sends from anon, authenticated;
grant select, insert, update, delete on public.signup_sends to service_role;
-- No policy: only the server function (service key) reads or writes it.

-- Old counts are of no use after an hour.
delete from public.signup_sends where window_at < now() - interval '1 day';

notify pgrst, 'reload schema';

-- The check. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('account_signup_state', exists (select 1 from pg_proc where proname = 'account_signup_state')),
    ('signup_sends',         exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'signup_sends'))
  ) t(part, done);
