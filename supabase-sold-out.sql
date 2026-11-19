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

-- ---------------------------------------------------------------------
-- NOT AFTER BUILD 76'S HARDENING. Once supabase-hardening.sql has been
-- run on this project it holds the newer version of everything this
-- file sets up, and running this one again would quietly put back an
-- older, weaker one. So it stops here, before changing anything.
-- ---------------------------------------------------------------------
do $$
declare
  v_done boolean := false;
begin
  -- Asked through EXECUTE because on a project that has never run the
  -- hardening the table does not exist, and a plain query naming it
  -- would stop this file before it started.
  if to_regclass('public.schema_migrations') is not null then
    execute 'select exists (select 1 from public.schema_migrations where version >= ''076'')' into v_done;
  end if;
  if v_done then
    raise exception using
      message = 'Not run, and nothing was changed: supabase-hardening.sql (build 76 or later) has already been run on this project and replaces this file. If you were running this file again because older instructions said it was safe to, you do not need to: run supabase-hardening.sql again instead.',
      hint = 'Only if this file has never been run on this project and you need it: run  delete from public.schema_migrations where version >= ''076'';  then this file, then supabase-hardening.sql again.';
  end if;
end $$;

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
