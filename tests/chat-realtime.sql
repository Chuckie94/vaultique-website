-- ===========================================================================
-- THE LIVE NUDGE, CHECKED: the shop typing reaches the customer at once.
--
--   psql -d <scratch db> -f tests/chat-jobs-fixture.sql \
--        -f tests/chat-realtime-fixture.sql -f supabase-chat-realtime.sql \
--        -f tests/chat-realtime.sql
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql as $$ begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;

insert into public.chat_conversations (id, token) values ('bbbbbbbb-0000-0000-0000-000000000001', 'tok-live');
delete from realtime.sent;

update public.chat_conversations set shop_typing_at = now() where token = 'tok-live';
select chk((select count(*) from realtime.sent) = 1
           and (select topic from realtime.sent limit 1) = public.chat_channel('tok-live'),
           'the shop starting to type nudges the customer''s own channel at once');

delete from realtime.sent;
update public.chat_conversations set shop_typing_at = now() + interval '1 second' where token = 'tok-live';
select chk((select count(*) from realtime.sent) = 1, 'and again while they keep typing');

delete from realtime.sent;
update public.chat_conversations set name = 'Chanda' where token = 'tok-live';
select chk((select count(*) from realtime.sent) = 0, 'a change the customer cannot see sends nothing');

delete from realtime.sent;
insert into public.chat_messages (conversation_id, sender, body) values ('bbbbbbbb-0000-0000-0000-000000000001', 'customer', 'Hi');
select chk((select count(*) from realtime.sent) >= 1, 'a message still nudges, as before');

select chk((select payload::text from realtime.sent limit 1) not like '%Hi%', 'and the nudge carries none of the words');

select case when ok then '  ✓ ' else '  ✗ ' end || what from checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  live chat nudges: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
