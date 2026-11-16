-- ===========================================================================
-- THE SAME DOOR ON A WEBSITE THAT NEVER SET UP ONLINE PAYMENT OR REWARDS
--
--   createdb vq_bare
--   psql -d vq_bare -f tests/pos-orders-fixture.sql -f supabase-setup.sql \
--        -f supabase-pos-orders.sql -f tests/pos-orders-bare.sql
--
-- supabase-payments.sql and supabase-rewards.sql have not been run here. The
-- door must still list, claim and complete WhatsApp orders, with no points
-- and no payment, and must not need the tables those files make.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon;
grant usage on sequence checks_n_seq to anon;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;
update public.pos_door_key set fingerprint = sha256(convert_to('k508-0123456789abcdef0123456789abcdef', 'UTF8'));

select chk(to_regclass('public.rewards_holds') is null and to_regclass('public.payments') is null,
           'neither rewards nor online payment has been set up here');
select chk((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders'
             and column_name in ('payment_method', 'payment_status', 'paid_amount', 'delivery_fee')) = 4,
           'the door added the payment columns it reads, empty');

set role anon;
do $$ declare r jsonb; ref text; begin
  ref := public.place_order('{"name":"Guest","phone":"0977000000","total":450,"currency":"ZMW"}',
                            '[{"sku":"SCF-01","name":"Silk scarf","price":450,"qty":1}]', null) ->> 'ref';
  perform chk(ref like 'VB-%', 'a WhatsApp order is placed as before');
  r := public.vbp_pos_orders('k508-0123456789abcdef0123456789abcdef', null, 'open');
  perform chk(r->>'ok' = 'true' and jsonb_array_length(r->'orders') = 1, 'the list answers');
  r := public.vbp_pos_order('k508-0123456789abcdef0123456789abcdef', ref);
  perform chk(r->'order'->'points' = 'null'::jsonb and r->'order'->'account'->>'custNo' is null
              and r->'order'->'payment' = '{"online":false}'::jsonb,
              'one order: no points, no customer number, not paid online');
  r := public.vbp_pos_order_claim('k508-0123456789abcdef0123456789abcdef', ref, 'till-aaaa-0001', 'Mary');
  perform chk(r->>'ok' = 'true', 'it can be claimed');
  r := public.vbp_pos_order_complete('k508-0123456789abcdef0123456789abcdef', ref, 'till-aaaa-0001',
                                     '{"saleId":"S-1","receiptNo":"RCT-1","pointsUsed":0}');
  perform chk(r->>'ok' = 'true', 'and completed');
end $$;
reset role;
-- With online payment never set up, nothing guards the payment columns the
-- door added; an order marked paid by hand must still not count as paid.
insert into public.orders (ref, name, total, currency, status, payment_method, payment_status, paid_amount)
values ('VB-HAND1', 'Says Paid', 900, 'ZMW', 'pending', 'online', 'paid', 900);
set role anon;
do $$ declare r jsonb; begin
  r := public.vbp_pos_order('k508-0123456789abcdef0123456789abcdef', 'VB-HAND1');
  perform chk(r->'order'->'payment'->>'verified' = 'false', 'an order marked paid by hand is not taken as paid');
  r := public.vbp_pos_order_claim('k508-0123456789abcdef0123456789abcdef', 'VB-HAND1', 'till-aaaa-0001', 'Mary');
  perform chk(r->>'why' = 'awaiting_payment', 'and cannot be rung up as paid');
end $$;
reset role;

select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   bare website: all ' || count(*) || ' checks passed'
            else '   bare website: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
