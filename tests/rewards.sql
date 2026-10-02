-- psql -f tests/analytics-fixture.sql -f supabase-rewards.sql -f tests/rewards.sql
-- (analytics-fixture.sql supplies auth, admins, roles, is_admin and is_shop_owner.)
\set ON_ERROR_STOP on
set client_min_messages = warning;
grant select on auth.whoami to anon, authenticated;
create temp table rc (n serial, ok boolean, what text);
grant all on rc to public; grant all on sequence rc_n_seq to public;

-- Two shoppers, as website accounts.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'chanda@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'mwila@example.com');
-- Written as the server function would (service key, so as the owner here).
insert into public.rewards_links (user_id, cust_no) values ('aaaaaaaa-0000-0000-0000-000000000001', 'VB0007');
insert into public.rewards_holds (user_id, cust_no, order_ref, points, value)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'VB0007', 'VB-TEST1', 20000, 10);
insert into public.rewards_requests (user_id, kind, cust_no)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'link', 'VB0009');
insert into public.rewards_codes (user_id, cust_no, code_hash, expires_at)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'VB0009', 'x', now() + interval '10 minutes');

-- Chanda, signed in.
delete from auth.whoami; insert into auth.whoami values ('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into rc (ok, what) values
  ((select count(*) from public.rewards_links) = 1, 'a shopper sees their own link'),
  ((select count(*) from public.rewards_requests) = 0, 'and not somebody else''s request'),
  ((select count(*) from public.rewards_holds) = 1, 'and their own promised points');
do $$ begin
  begin
    insert into public.rewards_links (user_id, cust_no) values ('aaaaaaaa-0000-0000-0000-000000000001', 'VB0001');
    insert into rc (ok, what) values (false, 'a shopper cannot link themselves to a number');
  exception when others then insert into rc (ok, what) values (true, 'a shopper cannot link themselves to a number'); end;
  begin
    update public.rewards_holds set points = 1;
    insert into rc (ok, what) values ((select points from public.rewards_holds limit 1) = 20000, 'nor change the points promised');
  exception when others then insert into rc (ok, what) values (true, 'nor change the points promised'); end;
  begin
    perform 1 from public.rewards_codes;
    insert into rc (ok, what) values (false, 'nor read any sign-in code');
  exception when others then insert into rc (ok, what) values (true, 'nor read any sign-in code'); end;
  begin
    perform public.rewards_settle((select id from public.rewards_holds limit 1), false);
    insert into rc (ok, what) values (false, 'nor release their own promised points');
  exception when others then insert into rc (ok, what) values (true, 'nor release their own promised points'); end;
end $$;
reset role;

-- An agent with no Orders permission.
delete from auth.whoami; insert into auth.whoami values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
do $$ begin
  begin
    perform public.rewards_decide((select id from public.rewards_requests limit 1), true);
    insert into rc (ok, what) values (false, 'a member of staff without Orders cannot approve');
  exception when others then insert into rc (ok, what) values (true, 'a member of staff without Orders cannot approve'); end;
end $$;
reset role;

-- The owner approves Mwila's link.
delete from auth.whoami; insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.rewards_decide((select id from public.rewards_requests limit 1), true);
insert into rc (ok, what) values
  ((select cust_no from public.rewards_links where user_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'VB0009'
     and (select how from public.rewards_links where user_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'team',
   'the team approves a link after checking on the platform');
do $$ begin
  begin
    perform public.rewards_decide((select id from public.rewards_requests limit 1), true);
    insert into rc (ok, what) values (false, 'a request is answered once');
  exception when others then insert into rc (ok, what) values (true, 'a request is answered once'); end;
end $$;
select public.rewards_settle((select id from public.rewards_holds limit 1), true);
insert into rc (ok, what) values
  ((select status from public.rewards_holds limit 1) = 'rung_up', 'promised points marked as rung up on the till');
reset role;

-- A join request completed with the number the platform gave them.
reset role;
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000003', 'eve@example.com');
insert into public.rewards_requests (user_id, kind, name, phone)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'join', 'Eve', '0977 123 456');
delete from auth.whoami; insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ begin
  begin
    perform public.rewards_join_done((select id from public.rewards_requests where kind = 'join'), 'VB-0007');
    insert into rc (ok, what) values (false, 'a join cannot be given a number already linked to someone else');
  exception when others then insert into rc (ok, what) values (true, 'a join cannot be given a number already linked to someone else'); end;
end $$;
select public.rewards_join_done((select id from public.rewards_requests where kind = 'join'), 'vb-0042');
insert into rc (ok, what) values
  ((select cust_no from public.rewards_links where user_id = 'aaaaaaaa-0000-0000-0000-000000000003') = 'VB0042'
     and (select status from public.rewards_requests where kind = 'join') = 'done',
   'a join marked done with the new customer number links the account at once');
reset role;
delete from auth.whoami; insert into auth.whoami values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
do $$ begin
  begin
    perform public.rewards_join_done(gen_random_uuid(), 'VB0050');
    insert into rc (ok, what) values (false, 'staff without Orders cannot complete a join');
  exception when others then insert into rc (ok, what) values (true, 'staff without Orders cannot complete a join'); end;
end $$;
reset role;

-- One number, one account.
do $$ begin
  begin
    insert into public.rewards_links (user_id, cust_no) values ('aaaaaaaa-0000-0000-0000-000000000002', 'VB0007')
      on conflict (user_id) do update set cust_no = excluded.cust_no;
    insert into rc (ok, what) values (false, 'a customer number cannot be linked to two accounts');
  exception when unique_violation then insert into rc (ok, what) values (true, 'a customer number cannot be linked to two accounts'); end;
end $$;

-- Nobody signed in sees anything.
delete from auth.whoami;
set role anon;
do $$ begin
  begin
    insert into rc (ok, what) values ((select count(*) from public.rewards_links) = 0, 'a visitor reads nothing');
  exception when others then insert into rc (ok, what) values (true, 'a visitor reads nothing'); end;
end $$;
reset role;

select case when ok then '  ✓ ' else '  ✗ ' end || what from rc order by n;
select case when count(*) filter (where not ok) = 0 then '  rewards database: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end from rc;
