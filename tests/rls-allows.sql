set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set request.jwt.claim.role = 'authenticated';

\echo '== the customer manages their own row =='
insert into public.customers (id, name, wishlist)
  values (auth.uid(), 'Chanda M', '["WF-1"]')
  on conflict (id) do update set name = excluded.name, wishlist = excluded.wishlist;
select name, wishlist from public.customers where id = auth.uid();

\echo '== and their own address =='
delete from public.customer_addresses where customer_id = auth.uid();
insert into public.customer_addresses (customer_id, label, address)
  values (auth.uid(), 'Home', '42 Kabulonga Road');
select label, address from public.customer_addresses;

\echo '== an order they place is theirs to read =='
delete from public.orders where ref = 'VB-TEST';
insert into public.orders (ref, customer_id, name, status, fulfilment, total)
  values ('VB-TEST', auth.uid(), 'Chanda M', 'pending', 'delivery', 900);
select ref, status from public.orders where ref = 'VB-TEST';

\echo '== they cannot file an order under another customer =='
do $$ begin
  insert into public.orders (ref, customer_id, name, status)
    values ('VB-BAD', '11111111-1111-1111-1111-111111111111', 'X', 'pending');
  raise notice 'SUCCEEDED — BAD';
exception when others then raise notice 'refused: %', SQLERRM; end $$;

\echo '== nor file one already confirmed =='
do $$ begin
  insert into public.orders (ref, customer_id, name, status)
    values ('VB-BAD2', auth.uid(), 'X', 'confirmed');
  raise notice 'SUCCEEDED — BAD';
exception when others then raise notice 'refused: %', SQLERRM; end $$;

\echo '== nor promote their own order afterwards =='
do $$ begin
  update public.orders set status = 'confirmed' where ref = 'VB-TEST';
  raise notice 'rows changed: %', (select count(*) from public.orders where status = 'confirmed');
end $$;
reset role;

\echo ''
\echo '=== WHAT THE OLD POLICY WOULD HAVE DONE ==='
create policy ssp_old on public.site_settings_private for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set request.jwt.claim.role = 'authenticated';
select data->>'bankAccount' as bank_account_a_customer_could_read
  from public.site_settings_private;
reset role;
drop policy ssp_old on public.site_settings_private;
