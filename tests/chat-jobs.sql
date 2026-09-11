-- ===========================================================================
-- THE JOB-ENQUIRY FILTER, CHECKED
--
--   psql -d <scratch db> -f tests/chat-jobs-fixture.sql \
--                        -f supabase-chat-jobs.sql \
--                        -f tests/chat-jobs.sql
--
-- Two halves, and the second is the one that matters more.
--
-- The first reads sentences and checks what the filter makes of them. The
-- corpus is deliberately not the six examples the feature was asked for: those
-- are in it, but so are thirty ways of saying the same thing that nobody
-- listed, and twenty-five ordinary customer questions chosen because a
-- careless pattern would answer them with a recruitment notice.
--
-- The second half puts messages through the real trigger, in a database
-- carrying the real rule that refuses a 'shop' message from a customer's
-- session, and checks what happened to the conversation afterwards: that the
-- notice arrived, that it arrived once, that the customer's own message
-- survived, that the shop's answering-time statistic was not touched, and that
-- an ordinary conversation is left exactly as it was.
-- ===========================================================================
set client_min_messages = warning;

create table checks (n serial, ok boolean, what text);
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
create or replace function hdr(p_text text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (null, p_text); end $$;
grant execute on function chk(boolean, text) to public;
grant execute on function hdr(text) to public;

create or replace function be(p_who text) returns void language plpgsql as $$
begin
  delete from auth.whoami;
  if p_who = 'owner' then insert into auth.whoami values ('11111111-1111-1111-1111-111111111111'); end if;
end $$;

-- ---------------------------------------------------------------------------
select hdr('The six it was asked to catch');
-- ---------------------------------------------------------------------------
do $$
declare r record; missed int := 0; said text;
begin
  for r in select * from (values
    ('Are you hiring?'),
    ('Any vacancies?'),
    ('I want a job.'),
    ('Are you looking for sales agents?'),
    ('Where can I send my CV?'),
    ('I want to work for Vaultique.')
  ) as v(s) loop
    if public.chat_job_intent(r.s) < 3 then
      missed := missed + 1; said := coalesce(said || ' | ', '') || r.s;
    end if;
  end loop;
  perform chk(missed = 0, 'all six of the listed examples are caught' ||
                          coalesce(' — missed: ' || said, ''));
end $$;

-- ---------------------------------------------------------------------------
select hdr('And thirty ways of saying it that nobody listed');
-- ---------------------------------------------------------------------------
do $$
declare r record; missed int := 0; said text := '';
begin
  for r in select * from (values
    ('are u hiring'),
    ('Hi, are you guys recruiting at the moment?'),
    ('do you have any vacancies available'),
    ('Any openings?'),
    ('Are there any positions available at your shop?'),
    ('im looking for a job'),
    ('I am looking for work'),
    ('I need a job please'),
    ('Can I get a job there'),
    ('Please employ me'),
    ('hire me'),
    ('Give me a job'),
    ('I would like to apply for a job'),
    ('How do I apply for a position?'),
    ('where do i send my cv'),
    ('Where can I drop my CV?'),
    ('Can I send you my resume?'),
    ('I want to submit my application'),
    ('Do you need shop assistants?'),
    ('Are you taking on new staff?'),
    ('are you looking for marketers'),
    ('do you need models'),
    ('I want to join your team'),
    ('How can I work with Vaultique'),
    ('I would love to work for your boutique'),
    ('Do you offer internships?'),
    ('Is there an internship at Vaultique'),
    ('Any work going?'),
    ('are you hiring sales agents in Lusaka'),
    ('I have experience in retail, are you hiring?')
  ) as v(s) loop
    if public.chat_job_intent(r.s) < 3 then
      missed := missed + 1; said := said || ' | ' || r.s;
    end if;
  end loop;
  perform chk(missed = 0, 'all thirty paraphrases are caught' ||
                          case when missed > 0 then ' — missed:' || said else '' end);
end $$;

-- ---------------------------------------------------------------------------
select hdr('And leaves a customer alone');
-- ---------------------------------------------------------------------------
do $$
declare r record; wrong int := 0; said text := '';
begin
  for r in select * from (values
    ('Do you deliver to Kitwe?'),
    ('What are your opening hours?'),
    ('Are you open on Sunday?'),
    ('What is the position of my order?'),
    ('Can you post it to me?'),
    ('Where can I send my payment?'),
    ('Do you have this dress in a size 12?'),
    ('Is the black bag still in stock?'),
    ('How much is delivery to Ndola'),
    ('I want to order the silk dress'),
    ('My order has not arrived'),
    ('Can I pay on delivery?'),
    ('Do you accept mobile money?'),
    ('I need a bag for work'),
    ('I am looking for a dress for a wedding'),
    ('What time do you close today?'),
    ('Can I return this?'),
    ('Is there a discount on shoes?'),
    ('Do you have staff who speak Bemba?'),
    ('Please send me the invoice'),
    ('Can someone help me with my account?'),
    ('Do you ship internationally?'),
    ('I want to exchange the size'),
    ('How do I track my parcel'),
    ('Are you available to chat?')
  ) as v(s) loop
    if public.chat_job_intent(r.s) >= 3 then
      wrong := wrong + 1; said := said || ' | ' || r.s;
    end if;
  end loop;
  perform chk(wrong = 0, 'not one of twenty-five ordinary questions is mistaken for a job enquiry' ||
                         case when wrong > 0 then ' — wrongly caught:' || said else '' end);
end $$;

do $$
begin
  perform chk(public.chat_job_intent('Where can I send my CV, and has my order shipped?') >= 3,
    'a job enquiry that also mentions an order is still a job enquiry');
  perform chk(public.chat_job_intent(null) = 0, 'nothing said is not an enquiry');
  perform chk(public.chat_job_intent('') = 0, 'and neither is an empty message');
  perform chk(public.chat_job_intent('hello') = 0, 'nor a greeting');
end $$;

-- ---------------------------------------------------------------------------
select hdr('Dressing FOR a job is shopping, not applying');
-- ---------------------------------------------------------------------------
-- Found by audit W-1. Every sentence below is somebody about to spend money,
-- and every one of the first six was being answered "we are not hiring" and
-- filed out of sight. Two of them are somebody who has just GOT a job and
-- needs clothes for it, which is as ready to buy as a customer ever gets.
--
-- The giveaway was that "I need an outfit for an interview" was already fine
-- and "Do you have anything for a job interview?" was not -- the same
-- customer, told two different things, over one extra word.
do $$
declare r record; wrong int := 0; said text := '';
begin
  for r in select * from (values
    -- the six the audit found
    ('Do you have anything for a job interview?'),
    ('What should I wear to a job interview'),
    ('something smart for a job interview on Monday'),
    ('I got a new job, need something to wear'),
    ('starting a new job next week, need work clothes'),
    ('is the shop hiring out dresses'),
    -- and the near neighbours that were already right, kept so that a
    -- later change cannot quietly break them instead
    ('I need an outfit for an interview'),
    ('dress for interview'),
    ('Do you have interview shoes'),
    ('Do you have work shoes?'),
    ('Looking for something to wear to work'),
    ('I want a piece for a work function'),
    ('Can I get a suit for work tomorrow?'),
    ('do you hire out pieces for a wedding'),
    ('Do you deliver to my workplace?'),
    ('I want to apply the discount code')
  ) as v(s) loop
    if public.chat_job_intent(r.s) >= 3 then
      wrong := wrong + 1; said := said || ' | ' || r.s;
    end if;
  end loop;
  perform chk(wrong = 0, 'a customer dressing for work reaches the desk' ||
                         coalesce(nullif(said, ''), ''));
end $$;

-- ---------------------------------------------------------------------------
select hdr('And the filter was not narrowed to do it');
-- ---------------------------------------------------------------------------
-- The failure mode to watch for. A fix that stops turning customers away by
-- quietly catching fewer job seekers has made things worse, not better: a job
-- seeker reaching the desk costs a minute of somebody's time, and a customer
-- turned away costs a sale. So the same sentences are asked again from the
-- other side, including four the audit had not tried before.
do $$
declare r record; missed int := 0; said text := '';
begin
  for r in select * from (values
    ('Hello, any employment'),
    ('am looking for a job'),
    ('am looking for work'),
    ('any job going?'),
    ('can i drop my resume'),
    ('do you have vacancies for a shop attendant'),
    ('piece work available?'),
    ('Do you have any openings for a sales assistant?'),
    ('can i work for you'),
    ('Good day, I am looking for employment opportunities'),
    ('do you need a shop assistant'),
    ('Are you hiring?')
  ) as v(s) loop
    if public.chat_job_intent(r.s) < 3 then
      missed := missed + 1; said := said || ' | ' || r.s;
    end if;
  end loop;
  perform chk(missed = 0, 'every job enquiry is still caught' ||
                          coalesce(nullif(said, ''), ''));
end $$;

-- "Are you hiring" and "hiring out" are one word apart and mean opposite
-- things, so both are pinned rather than left to a general rule.
do $$
begin
  perform chk(public.chat_job_intent('are you hiring') >= 3,
    'asking whether the shop is hiring is still a job enquiry');
  perform chk(public.chat_job_intent('do you hire out dresses') = 0,
    'asking whether it hires dresses out is not');
  perform chk(public.chat_job_intent('I have a job interview and need a suit') = 0,
    'a job interview names the occasion, not the vacancy');
  perform chk(public.chat_job_intent('any vacancies for a job') >= 3,
    'and a vacancy is still a vacancy');
end $$;

-- ---------------------------------------------------------------------------
select hdr('What happens to the conversation');
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_msgs int; v_kind text; v_body text; v_unread int; v_first timestamptz;
begin
  insert into public.chat_conversations (token, name) values ('tok-job-0001', 'Mwansa')
    returning id into v_id;
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Good morning, are you hiring shop assistants?');

  select kind, shop_unread, first_reply_at into v_kind, v_unread, v_first
    from public.chat_conversations where id = v_id;
  select count(*) into v_msgs from public.chat_messages where conversation_id = v_id;
  select body into v_body from public.chat_messages
   where conversation_id = v_id and sender = 'system';

  perform chk(v_kind = 'job', 'it is marked as a job enquiry');
  perform chk(v_msgs = 2, 'and answered — two messages, theirs and the notice');
  perform chk(v_body like 'Thank you for your interest in working with Vaultique%',
              'in the wording the feature was specified with');
  perform chk(v_body like '%official recruitment channels for any available opportunities.',
              'all the way to the end of it');
  perform chk(v_body !~* '(job enquiry|classif|intent|score|flag)',
              'and the notice says nothing about how it was classified');
  perform chk(v_unread = 0, 'nothing is left waiting on the desk, because it has been answered');
  perform chk(v_first is null,
              'and first_reply_at is untouched, so the shop''s answering time stays honest');
end $$;

do $$
declare v_id uuid; v_msgs int; v_sys int;
begin
  select id into v_id from public.chat_conversations where token = 'tok-job-0001';
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Please, I really need a job, any vacancies?');
  select count(*) into v_msgs from public.chat_messages where conversation_id = v_id;
  select count(*) into v_sys from public.chat_messages
   where conversation_id = v_id and sender = 'system';
  perform chk(v_sys = 1, 'asking a second time does not get a second notice');
  perform chk(v_msgs = 3, 'though the second message is kept, like every other');
end $$;

-- ---------------------------------------------------------------------------
select hdr('The rule that would have lost the customer''s message');
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_agent uuid := '22222222-2222-2222-2222-222222222222';
        v_msgs int; v_kind text;
begin
  /* A conversation held by an operator who is online. phase 7's one-voice
     rule refuses a 'shop' message from anybody who may not answer it — which
     is every customer, always. A notice written as 'shop' would raise here
     and take the customer's own message down with it. */
  insert into public.chat_agents (id, display_name, status, last_seen_at)
    values (v_agent, 'Chanda', 'online', now()) on conflict (id) do nothing;
  insert into public.chat_conversations (token, assigned_to)
    values ('tok-job-0002', v_agent) returning id into v_id;

  perform be(null);                       -- nobody signed in: a customer's session
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Are you recruiting?');

  select count(*), max(kind) into v_msgs, v_kind
    from public.chat_messages m
    join public.chat_conversations c on c.id = m.conversation_id
   where m.conversation_id = v_id group by c.kind;

  perform chk(v_msgs = 2, 'the notice still arrives in a conversation somebody else is holding');
  perform chk(v_kind = 'job', 'and it is still marked');
end $$;

do $$
declare v_id uuid; v_failed boolean := false;
begin
  /* And the rule itself is untouched: a 'shop' message from a customer's
     session is still refused, exactly as before. */
  select id into v_id from public.chat_conversations where token = 'tok-job-0002';
  perform be(null);
  begin
    insert into public.chat_messages (conversation_id, sender, body)
      values (v_id, 'shop', 'I am pretending to be the shop');
  exception when others then v_failed := true;
  end;
  perform chk(v_failed, 'and phase 7''s one-voice rule still refuses an impostor');
end $$;

-- ---------------------------------------------------------------------------
select hdr('An ordinary conversation is exactly as it was');
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_msgs int; v_kind text; v_unread int; v_first timestamptz;
begin
  insert into public.chat_conversations (token, name) values ('tok-ok-0001', 'Thandi')
    returning id into v_id;
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Do you have this dress in a size 12?');

  select kind, shop_unread into v_kind, v_unread
    from public.chat_conversations where id = v_id;
  select count(*) into v_msgs from public.chat_messages where conversation_id = v_id;

  perform chk(v_kind is null, 'not marked as anything');
  perform chk(v_msgs = 1, 'no notice added');
  perform chk(v_unread = 1, 'and it is waiting on the desk, as it should be');

  -- The shop answers, as the owner, the way it always has.
  perform be('owner');
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'shop', 'Yes, we have it in a 12.');
  select first_reply_at, customer_unread into v_first, v_unread
    from public.chat_conversations where id = v_id;
  perform chk(v_first is not null, 'the shop''s reply still stamps first_reply_at');
  perform chk(v_unread = 1, 'and still raises the customer''s unread count');
  perform be(null);
end $$;

-- ---------------------------------------------------------------------------
select hdr('Putting one back when the filter was wrong');
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_kind text; v_msgs int; v_refused boolean := false;
begin
  select id into v_id from public.chat_conversations where token = 'tok-job-0001';
  select count(*) into v_msgs from public.chat_messages where conversation_id = v_id;

  perform be(null);
  begin perform public.chat_job_clear(v_id);
  exception when others then v_refused := true; end;
  perform chk(v_refused, 'a customer cannot clear the mark');

  perform be('owner');
  perform public.chat_job_clear(v_id);
  select kind into v_kind from public.chat_conversations where id = v_id;
  perform chk(v_kind is null, 'the shop can');
  perform chk((select count(*) from public.chat_messages where conversation_id = v_id) = v_msgs,
              'and doing so deletes not one word of what was said');
end $$;

-- ---------------------------------------------------------------------------
select hdr('The shop''s own wording, when it sets one');
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_body text;
begin
  insert into public.site_settings (key, data)
  values ('chat', jsonb_build_object('jobReply', 'Please email careers@vaultique.example'))
  on conflict (key) do update set data = excluded.data;

  insert into public.chat_conversations (token) values ('tok-job-0003') returning id into v_id;
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Any vacancies?');
  select body into v_body from public.chat_messages
   where conversation_id = v_id and sender = 'system';
  perform chk(v_body = 'Please email careers@vaultique.example',
              'Settings > Live Chat replaces the wording');

  update public.site_settings set data = data - 'jobReply' where key = 'chat';
  insert into public.chat_conversations (token) values ('tok-job-0004') returning id into v_id;
  insert into public.chat_messages (conversation_id, sender, body)
    values (v_id, 'customer', 'Any vacancies?');
  select body into v_body from public.chat_messages
   where conversation_id = v_id and sender = 'system';
  perform chk(v_body like 'Thank you for your interest%',
              'and emptying it puts the original back');
end $$;

-- ---------------------------------------------------------------------------
select hdr('Nothing was deleted, by anything, at any point');
-- ---------------------------------------------------------------------------
do $$
begin
  perform chk((select count(*) from public.chat_conversations) = 5,
              'every conversation these checks made is still here');
  perform chk((select count(*) from public.chat_messages where sender = 'customer') = 6,
              'and every word a customer wrote');
end $$;

select case
         when ok is null then E'\n' || what
         when ok        then '  ✓ ' || what
         else                '  ✗ ' || what
       end as line
  from checks order by n;

select E'\n' || case when count(*) filter (where ok is false) = 0
            then 'job filter: all ' || count(*) filter (where ok is not null) || ' checks passed'
            else count(*) filter (where ok is not null) || ' checks, '
                 || count(*) filter (where ok is false) || ' FAILED'
       end as line
  from checks;

select 1 / (count(*) filter (where ok is false) = 0)::int as all_passed from checks;


-- =====================================================================
-- THE ONES A REAL SHOP FOUND
--
-- "Hello, any employment" went through the filter on the live site and
-- was handed to the shop as ordinary support. It named employment, it
-- read as a job enquiry to anybody, and it matched not one pattern:
-- "employment" was missing from the "any ..." list, and on its own it
-- was one weak word against a threshold of three.
--
-- The cure was not another phrasing. It was a rule that catches by
-- SHAPE -- short, names work, names nothing a customer would ask about
-- -- so the next phrasing nobody thought of is caught too. These check
-- both halves of that: that it catches, and that it has not started
-- catching customers.
-- =====================================================================
do $$
declare
  bad text;
begin
  -- Job enquiries, however they are put.
  select string_agg(m, ' | ') into bad from (values
    ('Hello, any employment'),
    ('any employment'),
    ('employment?'),
    ('Hi, jobs?'),
    ('vacancies please'),
    ('is there employment available'),
    ('Good morning, any hiring going on'),
    ('any openings for a sales assistant'),
    ('internship available?'),
    ('am looking for piece work'),
    ('any piece work?'),
    ('casual work available?')
  ) v(m) where public.chat_job_intent(m) < 3;
  if bad is not null then
    raise exception 'these job enquiries were let through: %', bad;
  end if;

  -- Customers, who must never be answered with the recruitment notice.
  select string_agg(m, ' | ') into bad from (values
    ('Any openings today? I want to visit the shop'),
    ('any openings today'),
    ('are you open today'),
    ('What are your opening hours?'),
    ('I want a piece of the black dress'),
    ('can I get a piece in size 10'),
    ('Send me a piece'),
    ('Do you have this piece in stock'),
    ('Does this work with mobile money'),
    ('Please resume my order'),
    ('I want to buy a dress for work'),
    ('Is this suitable for office work'),
    ('Do you have staff who can help me choose'),
    ('any bags available'),
    ('Do you have any dresses in stock')
  ) v(m) where public.chat_job_intent(m) >= 3;
  if bad is not null then
    raise exception 'these customers were treated as job enquiries: %', bad;
  end if;

  raise notice 'the ones a real shop found: all 27 pass';
end $$;
