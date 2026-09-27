-- ===========================================================================
-- "HANDED TO" UNTIL THEY ANSWER, CHECKED
--   psql -d <db> -f tests/chat-jobs-fixture.sql -f tests/chat-mentions-fixture.sql \
--        -f supabase-chat-mentions.sql -f supabase-chat-handover.sql -f tests/chat-handover.sql
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to authenticated;
grant usage on sequence checks_n_seq to authenticated;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$ begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;
grant select, insert on public.chat_messages to authenticated;

insert into public.admins (id, email, role) values
  ('22222222-2222-2222-2222-222222222222', 'mwila@vaultique.test', 'agent') on conflict (id) do nothing;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'c@t'), ('22222222-2222-2222-2222-222222222222', 'm@t');
insert into public.chat_agents (id, display_name, status, last_seen_at) values
  ('11111111-1111-1111-1111-111111111111', 'Chanda', 'online', now()),
  ('22222222-2222-2222-2222-222222222222', 'Mwila',  'online', now());
insert into public.chat_conversations (id, token, status) values ('dddddddd-0000-0000-0000-000000000001', 'h1', 'open');

-- Mwila takes it by opening it, then hands it to Chanda
delete from auth.whoami; insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.chat_take('dddddddd-0000-0000-0000-000000000001');
reset role;
select chk(not (select handed_pending from public.chat_conversations where token = 'h1'),
           'taking a chat yourself is not a hand-over: it reads "Taken by" at once');
set role authenticated;
select public.chat_assign('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
reset role;
select chk((select handed_pending from public.chat_conversations where token = 'h1'),
           'handed to Chanda, it is "Handed to Chanda", not yet taken');
select chk(exists (select 1 from public.chat_notes where body = 'Handed to Chanda by Mwila'),
           'and the notes say "Handed to Chanda by Mwila"');

-- Chanda answers the customer
delete from auth.whoami; insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into public.chat_messages (conversation_id, sender, body) values ('dddddddd-0000-0000-0000-000000000001', 'shop', 'Hello, I can help');
reset role;
select chk(not (select handed_pending from public.chat_conversations where token = 'h1'),
           'her first reply to the customer makes it "Taken by Chanda"');
select chk((select count(*) from public.chat_notes where body = 'Taken by Chanda') = 1,
           'with "Taken by Chanda" in the notes');
set role authenticated;
insert into public.chat_messages (conversation_id, sender, body) values ('dddddddd-0000-0000-0000-000000000001', 'shop', 'Second');
reset role;
select chk((select count(*) from public.chat_notes where body = 'Taken by Chanda') = 1, 'and only once');
delete from auth.whoami;

select case when ok then '  ✓ ' else '  ✗ ' end || what from checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  chat hand-over: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end from checks;
