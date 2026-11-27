-- ===========================================================================
-- DELIVERY, KEPT WHEN AN OLDER FILE IS RUN AGAIN (website build 89)
--
-- Chain "delivery-kept" (tools/sql-tests.sh): the till's files, an order's
-- progress, supabase-delivery.sql, then supabase-test-orders.sql and
-- supabase-order-progress.sql AGAIN, as an owner may run any file again.
-- Both redefine what the door and the private link hand out; both carry the
-- delivery details in build 89, so nothing is lost.
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;

set role service_role;
insert into public.orders (id, ref, name, phone, address, total, currency, status, fulfilment, created_at,
                           delivery_instructions, ship_courier, ship_tracking, ship_tracking_url, ship_updates)
values ('dddddddd-0000-0000-0000-000000000021', 'VB-KEPT1', 'Kept Buyer', '0970000021', 'Plot 21, Ndola', 800, 'ZMW',
        'confirmed', 'delivery', now(), 'Behind the market', 'Yango', 'YG-1', 'https://yango.example/t/YG-1',
        '[{"at": "2026-11-26T08:00:00Z", "text": "Left Lusaka"}]');
reset role;

select chk((public.pos_order_out('dddddddd-0000-0000-0000-000000000021', false) -> 'delivery' ->> 'instructions') = 'Behind the market'
       and (public.pos_order_out('dddddddd-0000-0000-0000-000000000021', false) -> 'delivery' ->> 'trackingUrl') = 'https://yango.example/t/YG-1',
       'supabase-test-orders.sql run again: the door still hands out the delivery details');
select chk((public.order_progress_out('dddddddd-0000-0000-0000-000000000021') -> 'ship' ->> 'tracking') = 'YG-1'
       and (public.order_progress_out('dddddddd-0000-0000-0000-000000000021') -> 'ship' -> 'updates' -> 0 ->> 'text') = 'Left Lusaka',
       'supabase-order-progress.sql run again: the progress still carries the courier and its updates');
select chk(exists (select 1 from pg_trigger where tgname = 'orders_delivery_guard_t'),
       'and the guard is still there');

select case when ok then '   ✓ ' else '   ✗ ' end || what from checks order by n;
select case when bool_and(ok) then '   delivery kept: all ' || count(*) || ' checks passed'
            else '   delivery kept: ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
