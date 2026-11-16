-- ===========================================================================
-- Orders already recorded BEFORE supabase-order-progress.sql is run, as on the
-- live website: a WhatsApp order the owner confirmed by hand, and one the
-- platform rang up before build 509 (Completed, its receipt kept). Loaded
-- after supabase-pos-orders.sql and before the new file; tests/order-progress.sql
-- checks neither is changed by running it, twice.
-- ===========================================================================
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@shop.test'),
  ('33333333-3333-3333-3333-333333333333', 'other@shop.test')
on conflict do nothing;
insert into public.customers (id, name) values
  ('22222222-2222-2222-2222-222222222222', 'Test Buyer'),
  ('33333333-3333-3333-3333-333333333333', 'Other Buyer')
on conflict do nothing;

insert into public.orders (id, ref, name, phone, total, currency, status, fulfilment, created_at)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'VB-PRE01', 'Before Buyer', '0970000101', 450, 'ZMW', 'confirmed',
        'delivery', now() - interval '3 days'),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'VB-PRE02', 'Before Buyer', '0970000102', 900, 'ZMW', 'completed',
        'collection', now() - interval '2 days');
update public.orders set pos_sale_id = 'S-OLD-1', pos_receipt_no = 'R-OLD-1', pos_completed_at = now() - interval '2 days'
 where ref = 'VB-PRE02';
