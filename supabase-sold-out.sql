-- =====================================================================
-- When a piece sold out
-- Run once in this WEBSITE's Supabase SQL Editor. Safe to run again.
--
-- The platform says whether a piece can be bought, never since when. For
-- "hide sold-out pieces after so many days" (Settings > Shopping) the
-- website's product feed notes the day it first sees a piece sold out, and
-- removes the note when it is back in stock. Only the website's own server
-- function (with the service key) reads or writes this table.
-- =====================================================================

create table if not exists public.sold_out_since (
  sku    text primary key check (length(sku) <= 80),
  since  timestamptz not null default now()
);
alter table public.sold_out_since enable row level security;
revoke all on public.sold_out_since from anon, authenticated;
grant select, insert, update, delete on public.sold_out_since to service_role;
-- No policy: browsers cannot read or change it.

notify pgrst, 'reload schema';

-- The check. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('sold_out_since', exists (select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'sold_out_since'))
  ) t(part, done);
