-- ===========================================================================
-- TAKEN WHEN OPENED, AND @MENTIONS, CHECKED
--   psql -d <db> -f tests/chat-jobs-fixture.sql -f tests/chat-mentions-fixture.sql \
--        -f supabase-chat-mentions.sql -f tests/chat-mentions.sql
-- ===========================================================================
set client_min_messages = warning;
create table checks (n serial, ok boolean, what text);
grant insert, select on checks to authenticated;
grant usage on sequence checks_n_seq to authenticated;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$ begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;

-- Two people at the desk: Chanda (the owner) and Mwila.
insert into public.admins (id, email, role) values
  ('22222222-2222-2222-2222-222222222222', 'mwila@vaultique.test', 'agent') on conflict (id) do nothing;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'chanda@vaultique.test'),
                              ('22222222-2222-2222-2222-222222222222', 'mwila@vaultique.test');
insert into public.chat_agents (id, display_name, status, last_seen_at) values
  ('11111111-1111-1111-1111-111111111111', 'Chanda', 'online', now()),
  ('22222222-2222-2222-2222-222222222222', 'Mwila',  'online', now());
insert into public.chat_conversations (id, token, status) values
  ('cccccccc-0000-0000-0000-000000000001', 't1', 'open'),
  ('cccccccc-0000-0000-0000-000000000002', 't2', 'closed');

-- Mwila opens the new chat
delete from auth.whoami; insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
select chk((public.chat_take('cccccccc-0000-0000-0000-000000000001')->>'taken')::boolean,
           'opening a chat nobody has taken takes it');
reset role;
select chk((select assigned_to from public.chat_conversations where token = 't1') = '22222222-2222-2222-2222-222222222222',
           'it is now Mwila''s, for everyone to see');
select chk(exists (select 1 from public.chat_notes where kind = 'event' and body = 'Taken by Mwila'),
           'and the notes say "Taken by Mwila"');
select chk((select count(*) from net.posted where body->>'kind' = 'handover') = 0,
           'taking one yourself does not notify you');

-- Chanda opens it a moment later
delete from auth.whoami; insert into auth.whoami values ('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ declare j json; begin
  j := public.chat_take('cccccccc-0000-0000-0000-000000000001');
  perform chk(not (j->>'taken')::boolean and j->>'name' = 'Mwila',
              'opening one somebody already has does not take it, and says who has it: ' || j::text);
  j := public.chat_take('cccccccc-0000-0000-0000-000000000002');
  perform chk(not (j->>'taken')::boolean, 'a closed chat is not taken by opening it');
end $$;
reset role;
select chk((select assigned_to from public.chat_conversations where token = 't1') = '22222222-2222-2222-2222-222222222222',
           'so it stays with Mwila');

-- Mwila mentions Chanda in a note
delete from net.posted;
delete from auth.whoami; insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');
set role authenticated;
insert into public.chat_notes (conversation_id, author_id, kind, body, mentions) values
  ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'note',
   '@Chanda can you take this one? Asking about a refund.',
   array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
         '99999999-9999-9999-9999-999999999999']::uuid[]);
reset role;
select chk((select mentions from public.chat_notes where kind = 'note') = array['11111111-1111-1111-1111-111111111111']::uuid[],
           'the note keeps who it mentions: not the author, not somebody who is not staff');
select chk((select count(*) from net.posted) = 1
           and (select body->>'kind' from net.posted) = 'mention'
           and (select body->'to' from net.posted) = '["11111111-1111-1111-1111-111111111111"]'::jsonb,
           'and Chanda''s phone is sent a "mentioned you" notification');

-- Mwila hands it to Chanda
delete from net.posted;
set role authenticated;
select public.chat_assign('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
reset role;
select chk(exists (select 1 from public.chat_notes where kind = 'event' and body = 'Passed from Mwila to Chanda'),
           'handing it over writes "Passed from Mwila to Chanda" in the notes again');

-- a note with nobody mentioned sends nothing
delete from net.posted;
set role authenticated;
insert into public.chat_notes (conversation_id, author_id, kind, body)
values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'note', 'Just a note');
reset role;
select chk((select count(*) from net.posted) = 0, 'a note that mentions nobody notifies nobody');
delete from auth.whoami;

select case when ok then '  ✓ ' else '  ✗ ' end || what from checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  chat taking and mentions: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
