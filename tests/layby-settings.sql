-- ===========================================================================
-- WHO CAN READ AND WHO CAN CHANGE THE LAYBY FIGURES -- the database half
--
-- The deposit percentage and the number of months live in the Payments row of
-- site_settings, beside everything else on that page. No new table and no new
-- rule: this checks that the rules already on that table, run here exactly as
-- supabase-setup.sql writes them, do what the estimate needs. The product page
-- can read them; only a signed-in administrator can change them.
--
--   psql -d vq_layby -f tests/layby-settings-fixture.sql
--   sed -n '/^create table if not exists public.site_settings (/,/with check (public.is_admin());/p' \
--       supabase-setup.sql | psql -d vq_layby
--   psql -d vq_layby -f tests/layby-settings.sql
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temp table ls (n serial, ok boolean, what text);
grant all on ls to public; grant all on sequence ls_n_seq to public;

-- Payments as a shop has it before the estimate arrived.
insert into public.site_settings (key, data) values ('payments', '{"cashEnabled": true, "cashName": "Cash"}');
insert into public.admins values ('00000000-0000-0000-0000-0000000000a1');

-- The owner, signed in, saves the page the way the admin does: the whole row.
truncate auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
insert into public.site_settings (key, data, updated_at)
values ('payments', '{"cashEnabled": true, "cashName": "Cash", "laybyDeposit": 25, "laybyMonths": 12}', now())
on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
reset role;
insert into ls (ok, what)
select data->'laybyDeposit' = '25'::jsonb and data->'laybyMonths' = '12'::jsonb and data->>'cashName' = 'Cash',
       'an administrator saves 25% and 12 months, in the Payments row with the rest of the page'
  from public.site_settings where key = 'payments';

-- A visitor, signed in to nothing, as the product page asks.
truncate auth.whoami;
set role anon;
insert into ls (ok, what)
select (data->>'laybyDeposit')::numeric = 25 and (data->>'laybyMonths')::int = 12,
       'a visitor can read them, which the product page needs'
  from public.site_settings where key = 'payments';
do $$ declare n integer; begin
  update public.site_settings set data = jsonb_set(data, '{laybyDeposit}', '5') where key = 'payments';
  get diagnostics n = row_count;
  insert into ls (ok, what) values (n = 0, 'a visitor''s change reaches no row');
end $$;
do $$ begin
  begin
    insert into public.site_settings (key, data) values ('payments', '{"laybyDeposit": 5}')
    on conflict (key) do update set data = excluded.data;
    insert into ls (ok, what) values (false, 'a visitor''s save is refused');
  exception when others then
    insert into ls (ok, what) values (sqlerrm ~ 'row-level security', 'a visitor''s save is refused (' || sqlerrm || ')');
  end;
end $$;
reset role;

-- A customer with an account, signed in but not an administrator.
truncate auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
do $$ declare n integer; begin
  update public.site_settings set data = jsonb_set(data, '{laybyMonths}', '60') where key = 'payments';
  get diagnostics n = row_count;
  insert into ls (ok, what) values (n = 0, 'a signed-in customer''s change reaches no row either');
end $$;
do $$ begin
  begin
    insert into public.site_settings (key, data) values ('payments', '{"laybyMonths": 60}')
    on conflict (key) do update set data = excluded.data;
    insert into ls (ok, what) values (false, 'nor is their save allowed');
  exception when others then
    insert into ls (ok, what) values (sqlerrm ~ 'row-level security', 'nor is their save allowed');
  end;
end $$;
reset role;

insert into ls (ok, what)
select (data->>'laybyDeposit')::numeric = 25 and (data->>'laybyMonths')::int = 12,
       'after all of that, still 25% and 12 months'
  from public.site_settings where key = 'payments';

-- And the administrator can change them again.
truncate auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
update public.site_settings set data = data || '{"laybyDeposit": 30, "laybyMonths": 6}'::jsonb where key = 'payments';
reset role;
insert into ls (ok, what)
select (data->>'laybyDeposit')::numeric = 30 and (data->>'laybyMonths')::int = 6,
       'the administrator changes them back to 30% and 6 months'
  from public.site_settings where key = 'payments';

select n, case when ok then '  ✓ ' else '  ✗ ' end || what as result from ls order by n;
select case when bool_and(ok) then '  layby settings in the database: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end as summary from ls;
