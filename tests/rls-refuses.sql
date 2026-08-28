-- A customer registers. In Supabase they land in auth.users and are
-- 'authenticated' — exactly the role every old policy trusted.
insert into auth.users (id, email)
  values ('22222222-2222-2222-2222-222222222222', 'customer@example.com')
  on conflict (id) do nothing;
insert into public.site_settings_private (key, data)
  values ('payments', '{"bankAccount":"0123456789","bankName":"Zanaco"}')
  on conflict (key) do update set data = excluded.data;
insert into public.site_settings (key, data) values ('general', '{"businessName":"Vaultique"}')
  on conflict (key) do update set data = excluded.data;
insert into public.product_meta (sku, price_override) values ('WF-1', 900)
  on conflict (sku) do update set price_override = excluded.price_override;

grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;

-- Now BE that customer.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set request.jwt.claim.role = 'authenticated';

\echo '== a signed-in customer tries the bank details =='
select coalesce((select count(*) from public.site_settings_private)::text, '?') as rows_visible;

\echo '== tries to change a price =='
do $$ begin
  update public.product_meta set price_override = 1 where sku = 'WF-1';
  raise notice 'rows changed: %', (select count(*) from public.product_meta where price_override = 1);
end $$;

\echo '== tries to rewrite a setting =='
do $$ begin
  update public.site_settings set data = '{"businessName":"Hacked"}' where key = 'general';
end $$;
select data->>'businessName' as business_name from public.site_settings where key = 'general';

\echo '== tries to make themselves an admin =='
do $$ begin
  insert into public.admins (id, email) values (auth.uid(), 'customer@example.com');
  raise notice 'INSERT SUCCEEDED — BAD';
exception when others then
  raise notice 'refused: %', SQLERRM;
end $$;

\echo '== is_admin() says =='
select public.is_admin() as customer_is_admin;

\echo '== and they cannot write a row as somebody else =='
do $$ begin
  insert into public.customers (id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Impersonated');
  raise notice 'INSERT SUCCEEDED — BAD';
exception when others then
  raise notice 'refused: %', SQLERRM;
end $$;
reset role;
