-- ===========================================================================
-- ONLINE PAYMENT, THE DATABASE SIDE, CHECKED (see tests/payments-fixture.sql)
--
-- Who may say an order is paid: the payment service, and nobody else.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon, authenticated, service_role;
grant usage on sequence checks_n_seq to anon, authenticated, service_role;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;
-- Supabase grants every table to these roles by default; RLS is what decides.
grant select, insert, update, delete on public.payments to anon, authenticated, service_role;

insert into public.admins values ('11111111-1111-1111-1111-111111111111');
insert into public.orders (id, ref, name, total, currency) values
  ('00000000-0000-0000-0000-00000000000a', 'VB-AAAAA', 'WhatsApp buyer', 500, 'ZMW');

-- A customer, with the anon key
set role anon;
do $$ declare e text; begin
  begin
    insert into public.orders (ref, name, total, status) values ('VB-X1', 'x', 1, 'pending');
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'none', 'an ordinary order can still be placed, exactly as before: ' || e);

  begin
    insert into public.orders (ref, name, total, status, payment_status, paid_amount)
    values ('VB-X2', 'x', 1, 'pending', 'paid', 1);
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'payment details are set by the payment service only%',
              'but a customer cannot file an order already marked paid');
end $$;
reset role;

-- The payment service
set role service_role;
update public.orders
   set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-AAAAA-abc123',
       goods_total = 500, delivery_fee = 0, tax_total = 0
 where id = '00000000-0000-0000-0000-00000000000a';
insert into public.payments (order_id, tx_ref, mode, amount, currency, phone)
values ('00000000-0000-0000-0000-00000000000a', 'VB-AAAAA-abc123', 'test', 500, 'ZMW', '0970000000');
select chk((select payment_status from public.orders where ref = 'VB-AAAAA') = 'awaiting',
           'the payment service can mark an order as awaiting payment');
reset role;

-- An admin, signed in
insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ declare e text; begin
  begin
    update public.orders set payment_status = 'paid', paid_amount = 500 where ref = 'VB-AAAAA';
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'payment details are set by the payment service only%',
              'an admin login cannot mark an order paid');

  begin
    update public.orders set total = 1 where ref = 'VB-AAAAA';
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e like 'the total of an order paid online cannot be changed%',
              'nor change what an online order was paid for');

  begin
    update public.orders set status = 'confirmed' where ref = 'VB-AAAAA';
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'none', 'but can still move it along as usual (confirmed, dispatched…): ' || e);

  perform chk((select count(*) from public.payments) = 1, 'and can read the payments log');

  begin
    insert into public.payments (tx_ref, amount, currency) values ('fake', 1, 'ZMW');
    e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'but cannot write to it');

  begin perform public.pay_expire_stale(); e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'nor run the expiry itself');
end $$;
reset role;
delete from auth.whoami;

set role anon;
select chk((select count(*) from public.payments) = 0, 'a customer cannot see any payment');
reset role;

-- Paid, then walked-away attempts expire
set role service_role;
update public.orders set payment_status = 'paid', paid_amount = 500, paid_at = now() where ref = 'VB-AAAAA';
update public.payments set status = 'paid' where tx_ref = 'VB-AAAAA-abc123';
reset role;
insert into public.orders (id, ref, name, total, created_at) values
  ('00000000-0000-0000-0000-00000000000b', 'VB-BBBBB', 'walked away', 300, now() - interval '4 hours');
update public.orders set payment_method = 'online', payment_status = 'awaiting', pay_ref = 'VB-BBBBB-x'
 where ref = 'VB-BBBBB';
insert into public.payments (order_id, tx_ref, amount, currency, created_at)
values ('00000000-0000-0000-0000-00000000000b', 'VB-BBBBB-x', 300, 'ZMW', now() - interval '4 hours');
set role service_role;
select chk(public.pay_expire_stale() = 1, 'an attempt left for three hours is expired');
reset role;
select chk((select status || '/' || payment_status from public.orders where ref = 'VB-BBBBB') = 'cancelled/expired',
           'and its order is cancelled, so it no longer counts as an order');
select chk((select payment_status from public.orders where ref = 'VB-AAAAA') = 'paid',
           'while a paid order is left alone');

-- How orders were paid: VB-AAAAA paid online (500, mobile), VB-BBBBB expired,
-- plus a WhatsApp order, a card payment, one awaiting, one cancelled WhatsApp.
insert into public.orders (ref, name, total, status) values ('VB-WA1', 'wa', 200, 'pending');
insert into public.orders (ref, name, total, status) values ('VB-WA2', 'wa', 999, 'cancelled');
insert into public.orders (id, ref, name, total) values
  ('00000000-0000-0000-0000-00000000000c', 'VB-CCCCC', 'card', 700),
  ('00000000-0000-0000-0000-00000000000d', 'VB-DDDDD', 'waiting', 450);
set role service_role;
update public.orders set pay_channel = 'mobilemoneyzambia', delivery_fee = 40 where ref = 'VB-AAAAA';
update public.orders set payment_method = 'online', payment_status = 'paid', pay_channel = 'card',
       paid_amount = 700, delivery_fee = 60 where ref = 'VB-CCCCC';
update public.orders set payment_method = 'online', payment_status = 'awaiting' where ref = 'VB-DDDDD';
reset role;

set role anon;
do $$ declare e text; begin
  begin perform public.pay_sales_split(current_date - 1, current_date, 'UTC'); e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'a customer cannot read the sales split');
end $$;
reset role;

insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ declare j json; begin
  j := public.pay_sales_split(current_date - 1, current_date, 'Africa/Lusaka');
  -- VB-X1 (K1, placed as a customer at the top) and VB-WA1 (K200); VB-WA2 is cancelled.
  perform chk((j->>'whatsapp_orders')::int = 2 and (j->>'whatsapp_sales')::numeric = 201,
              'WhatsApp: two orders standing, the cancelled one left out: ' || j::text);
  perform chk((j->>'online_orders')::int = 2 and (j->>'online_sales')::numeric = 1200,
              'paid online: two orders, K1,200');
  perform chk((j->>'card_orders')::int = 1 and (j->>'card_sales')::numeric = 700
              and (j->>'mobile_orders')::int = 1 and (j->>'mobile_sales')::numeric = 500,
              'split into card and mobile money');
  perform chk((j->>'delivery_paid')::numeric = 100, 'with the delivery paid online kept apart');
  perform chk((j->>'online_waiting')::int = 1 and (j->>'online_unfinished')::int = 1,
              'an order still awaiting payment, and one never finished, are counted apart and not as sales');
  j := public.pay_sales_split(current_date + 5, current_date + 6, 'UTC');
  perform chk((j->>'online_orders')::int = 0 and (j->>'whatsapp_orders')::int = 0,
              'and nothing outside the date range');
end $$;
reset role;
delete from auth.whoami;

select case when ok then '  ✓ ' else '  ✗ ' end || what from checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  payments database: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
