-- =====================================================================
-- Live Chat — the job-enquiry filter
--
-- RUN THIS IN THE **WEBSITE'S** SUPABASE PROJECT, after the chat phases.
-- Safe to run again, and again after that.
--
-- WHAT IT IS FOR. A boutique that trades on WhatsApp and a chat window
-- gets asked for work. Often. Those are not customer-support
-- conversations, they do not belong in the queue an operator works
-- through, and answering each one by hand is a job in itself. This
-- notices them, answers once, marks the conversation, and takes it out
-- of the support queue. It deletes nothing and it hides nothing from
-- the shop.
--
-- WHAT THE CUSTOMER SEES. One reply, in the window, in the shop's own
-- words. They are never shown a label, a score, or the word
-- "classified". Nothing about this is visible to them beyond a polite
-- answer that arrives quickly.
--
-- THE REPLY COMES FROM 'system' AND NOT FROM 'shop', AND THAT IS THE
-- MOST IMPORTANT LINE IN THIS FILE.
--
-- Three reasons, and the third is the one that would have caused real
-- damage:
--
--   1. It is true. Nobody at the shop wrote it. A window that shows an
--      automatic notice as though an operator had typed it is lying to
--      the customer about whether a person is there.
--
--   2. Phase 7's chat_one_voice refuses a message from 'shop' unless
--      the person inserting it may answer that conversation — which is
--      exactly right, and which is false inside a customer's own send.
--      Writing 'shop' here would make every job enquiry raise an
--      exception and lose the customer's message with it.
--
--   3. chat_touch stamps first_reply_at on the first 'shop' message,
--      and chat_stats reports the shop's answering time from it. An
--      automatic notice recorded as a reply would make every job
--      enquiry look answered in under a second, and would quietly drag
--      the shop's headline response time towards zero. The one number
--      an owner uses to judge the desk would have become fiction.
--
-- WHAT IT DOES NOT TOUCH. No existing function is replaced, no existing
-- trigger is dropped or altered, no policy is changed, and no message
-- or conversation is ever deleted. It adds two columns, one scorer, one
-- trigger, and two small functions for the admin.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1. Somewhere to record what a conversation turned out to be.
--
-- Null for every conversation that has ever existed and for every
-- ordinary one from now on, so nothing that reads this table sees any
-- difference unless it asks.
-- ---------------------------------------------------------------------
alter table public.chat_conversations
  add column if not exists kind text;

alter table public.chat_conversations
  add column if not exists kind_at timestamptz;

comment on column public.chat_conversations.kind is
  'What this conversation turned out to be. Null is an ordinary customer conversation. ''job'' is an employment enquiry, answered automatically and kept out of the support queue. Internal: never returned to the customer by any function they can call.';

-- Job enquiries are a small slice of a big table and are always asked
-- for by themselves, so the index carries only them.
create index if not exists chat_conv_kind
  on public.chat_conversations (kind, last_message_at desc)
  where kind is not null;


-- ---------------------------------------------------------------------
-- STEP 2. An automatic notice is a third kind of voice.
--
-- The constraint is widened, never narrowed: 'customer' and 'shop' mean
-- exactly what they meant before and every row already on file still
-- satisfies it. Only a value that has never existed becomes possible.
-- ---------------------------------------------------------------------
do $$
begin
  alter table public.chat_messages drop constraint if exists chat_messages_sender_check;
  alter table public.chat_messages
    add constraint chat_messages_sender_check
    check (sender in ('customer', 'shop', 'system'));
exception when others then
  -- A project whose constraint was renamed at some point keeps whatever
  -- it has. Better a filter that cannot answer than a table that will
  -- not take a message.
  raise notice 'sender constraint left as it was: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- STEP 3. Reading the intent, not matching the words.
--
-- Returns a score. Three or more is an employment enquiry.
--
-- HOW IT AVOIDS THE OBVIOUS TRAP. Matching on "job", "work" or "post"
-- alone would catch "what is the position of my order", "can you post
-- it to me" and "I need a bag for work" — three ordinary customer
-- questions, each of which would then be answered with a notice about
-- recruitment and taken out of the queue. So:
--
--   * A STRONG phrase is one that is hard to say by accident: "are you
--     hiring", "any vacancies", "send my CV", "work for you". One of
--     these is enough on its own.
--
--   * A WEAK word — job, work, staff, hire — counts only when the
--     sentence is also asking or wanting something, and three of them
--     are needed. One weak word is never enough.
--
--   * TRADE words — order, delivery, payment, size, stock — take two
--     off, but only when nothing strong was found. "Where do I send my
--     CV, and did my order arrive?" is still an employment enquiry.
--
-- The two phrases that cost the most care are "opening hours" and
-- "position of my order", both of which read as vacancies to a careless
-- pattern. The first is taken out of the sentence before anything else
-- looks at it; the second never matches because "position" only counts
-- beside "available", "open" or "vacant".
-- ---------------------------------------------------------------------
create or replace function public.chat_job_intent(p_body text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  t      text;
  strong integer := 0;
  weak   integer := 0;
  asking boolean;
  trade  boolean;
  score  integer;
begin
  if p_body is null or btrim(p_body) = '' then return 0; end if;

  -- Lower case, accents off the one word that carries them, and every
  -- punctuation mark flattened to a space, so "Résumé?" "resume" and
  -- "RESUME!!" are one word to everything below. Apostrophes are kept
  -- because "I'm" and "im" are both common and both mean the same.
  t := lower(btrim(p_body));
  t := replace(replace(t, 'é', 'e'), 'è', 'e');
  t := regexp_replace(t, '[^a-z0-9'']+', ' ', 'g');
  t := ' ' || btrim(t) || ' ';

  -- Said before anything else looks at the sentence. A shop is asked its
  -- opening hours every day of the week, and "any openings" is a
  -- vacancy question — the two are one letter apart.
  t := regexp_replace(t, '\yopening\s+(hours?|times?)\y', ' shophours ', 'g');
  t := regexp_replace(t, '\yopen\s+(hours?|times?)\y', ' shophours ', 'g');
  -- "Any openings today?" in a boutique means "are you open today", not
  -- "are you hiring" -- and the person asking is standing up to come in.
  -- A job seeker asking about this month says more than three words.
  t := regexp_replace(t, '\yopening\w*\s+(today|tomorrow|tonight|now|this\s+\w+|on\s+\w+)\y', ' shophours ', 'g');
  t := regexp_replace(t, '\y(are|r)\s+(you|u)\s+open\w*\y', ' shophours ', 'g');

  -- ---- trade: what an actual customer is asking about --------------
  -- Worked out first now, because the catch-all at the end of the strong
  -- block needs it. Nothing else about it changed.
  trade := t ~ '\y(order|orders|ordered|ordering|delivery|deliver\w*|ship\w*|payment|pay|paid|paying|price|prices|pricing|cost|costs|refund|return|returns|exchange|size|sizes|colour\w*|color\w*|stock|available\s+in|dress|dresses|bag|bags|shoe\w*|jewel\w*|invoice|receipt|track\w*|discount|voucher|collect\w*|cart|checkout|deposit|visit|visiting|browse|browsing)\y';

  -- ---- strong: hard to say by accident -----------------------------
  if t ~ '\y(hiring|recruiting|recruitment|recruiter|recruit)\y' then strong := strong + 1; end if;
  if t ~ '\yvacanc(y|ies)\y' then strong := strong + 1; end if;
  if t ~ '\yjob\s+(vacanc\w*|opening\w*|application\w*|advert\w*|opportunit\w*|offer\w*|post\w*)\y' then strong := strong + 1; end if;
  if t ~ '\y(cv|cvs|curriculum\s+vitae)\y' then strong := strong + 1; end if;
  if t ~ '\y(send|sending|submit|submitting|drop|dropping|email|attach|share|forward)\w*\s+(you\s+|u\s+)?(my|a|the|an)?\s*(resume|resumes|application)\y' then strong := strong + 1; end if;
  if t ~ '\y(apply|applying|application)\w*\s+(for|to)\s+(a\s+|an\s+|the\s+|any\s+)?(job|jobs|work|position\w*|vacanc\w*|post|employment)\y' then strong := strong + 1; end if;
  if t ~ '\y(work|working|employed|employment)\s+(for|with|at)\s+(you|your|vaultique|the\s+shop|the\s+store|the\s+boutique)\y' then strong := strong + 1; end if;
  if t ~ '\yjoin\s+(your|the)\s+(team|shop|store|company|staff|business)\y' then strong := strong + 1; end if;
  if t ~ '\y(want|wants|need|needs|looking|seeking|searching|require|after)\w*\s+(for\s+)?(a\s+|an\s+|any\s+|some\s+)?(job|jobs|work|employment|internship)\y' then strong := strong + 1; end if;
  if t ~ '\y(hiring|recruit\w*|looking|need|needs|want|wants|require|taking)\w*\s+(for\s+|on\s+)?(a\s+|an\s+|any\s+|new\s+|more\s+)?(sales\s+|shop\s+|store\s+|floor\s+|part\s+time\s+|full\s+time\s+)?(agent|agents|assistant|assistants|attendant|attendants|staff|worker|workers|employee|employees|marketer|marketers|model|models|intern|interns)\y' then strong := strong + 1; end if;
  if t ~ '\y(internship|internships|apprentice\w*|graduate\s+trainee)\y' then strong := strong + 1; end if;
  if t ~ '\y(employ|hire)\s+me\y' then strong := strong + 1; end if;
  -- "Can I get a job there" and "could I have work". Asking to be given
  -- one reads nothing like asking to be given a refund, because the noun
  -- at the end of it has to be a job.
  if t ~ '\y(can|could|may|might|will)\s+(i|you)\s+(get|have|find|give|offer|apply\s+for|come\s+for|consider)\s+(me\s+)?(a\s+|an\s+|any\s+)?(job|jobs|work|employment|position\w*|vacanc\w*)\y' then strong := strong + 1; end if;
  if t ~ '\ygive\s+me\s+(a\s+)?(job|work)\y' then strong := strong + 1; end if;
  -- How casual labour is asked for here. "Piece work" is not a thing a
  -- boutique sells, and somebody asking for it is asking for work.
  if t ~ '\y(piece\s*work|casual\s+(work|labour|labor|job|jobs))\y' then strong := strong + 1; end if;
  -- "Any positions available?" and "any openings?". Plural on purpose
  -- for the second: "any opening" is most often a question about hours.
  if t ~ '\y(position\w*|opening\w*|post|posts|slot|slots)\s+(available|open|vacant|going)\y' then strong := strong + 1; end if;
  if t ~ '\y(any|got\s+any|have\s+any|are\s+there\s+any|is\s+there\s+any)\s+(vacanc\w*|job|jobs|openings|positions|employment|hiring|recruitment|work\s+going|work\s+available)\y' then strong := strong + 1; end if;
  if t ~ '\y(where|how)\s+(can|do|should|may|would)\s+i\s+(send|submit|drop|apply|deliver|bring)\y' and t ~ '\y(cv|resume|application|job)\y' then strong := strong + 1; end if;

  -- ---- and anything short whose only subject is work -----------------
  -- Every rule above is a phrasing somebody thought of. This one is not:
  -- it catches by SHAPE. A brief message, a word in it that belongs to
  -- employment and to nothing else a boutique sells, and nothing in it a
  -- customer would be asking about.
  --
  -- "Hello, any employment" is what prompted it. Three words, obviously a
  -- job enquiry to any reader, and it matched not one pattern above --
  -- "employment" was missing from the list two lines up, and on its own
  -- it was one weak word against a threshold of three.
  --
  -- WHY IT IS SAFE. `not trade` is doing the work: a customer asking
  -- about an order, a delivery, a price, a size, a refund or a piece is
  -- excluded before this is reached. And the nouns are ones nobody uses
  -- to shop -- `work` and `resume` are deliberately NOT among them,
  -- because "will it work" and "resume my order" are things people say.
  if  not trade
  and array_length(regexp_split_to_array(btrim(t), '\s+'), 1) <= 9
  and t ~ '\y(job|jobs|employment|vacanc\w*|hiring|recruit\w*|internship|internships)\y'
  then strong := strong + 1; end if;

  -- ---- weak: only ever in threes, and only when asking --------------
  asking := t ~ '\y(are|is|do|does|can|could|may|will|would|any|where|how|who|i|im|i''m|please|looking|want|need)\y';

  if t ~ '\y(job|jobs)\y'        then weak := weak + 1; end if;
  if t ~ '\y(work|working)\y'    then weak := weak + 1; end if;
  if t ~ '\yemploy\w*\y'         then weak := weak + 1; end if;
  if t ~ '\ystaff\y'             then weak := weak + 1; end if;
  if t ~ '\y(hire|hiring|hired)\y' then weak := weak + 1; end if;
  if t ~ '\y(openings|vacanc\w*)\y' then weak := weak + 1; end if;
  if t ~ '\y(experience|qualified|qualification\w*)\y' then weak := weak + 1; end if;

  if strong > 0 then
    score := 3 + least(strong - 1, 2);          -- 3, 4 or 5
  elsif asking then
    score := weak;                              -- three weak words to reach 3
  else
    score := 0;
  end if;

  if trade and strong = 0 then score := score - 2; end if;

  return greatest(score, 0);
end;
$$;

comment on function public.chat_job_intent(text) is
  'How strongly one message reads as an employment enquiry. 3 or more is treated as one. Pure and side-effect free, so it can be asked of any sentence without changing anything.';


-- ---------------------------------------------------------------------
-- STEP 4. Noticing one, and answering it once.
--
-- AFTER INSERT, and named to sort between the two triggers it has to sit
-- between. Trigger order on one table and one event is alphabetical, so
-- the name is load-bearing:
--
--   chat_msg_touch   counts the message              -> runs first
--   chat_msg_zjob    this one                        -> then this
--   chat_nudge_t     buzzes the operator's phone     -> then this
--   chat_one_voice_t (before insert, on the reply)
--
-- After chat_msg_touch so the counters it keeps are already settled and
-- this can put shop_unread back to nought: the enquiry has been
-- answered, so it is not waiting on anybody, and a desk badge counting
-- it would be counting work that does not exist.
--
-- IT ANSWERS ONCE. The mark is set in the same statement that reads it,
-- so a second job message in the same conversation is scored, found to
-- be in a conversation already marked, and left alone. Nobody gets the
-- same notice three times for asking three ways.
-- ---------------------------------------------------------------------
create or replace function public.chat_job_filter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_reply text;
begin
  -- Only what a customer wrote. The shop's own words are never scored,
  -- and neither is this function's own reply — which is what stops it
  -- answering itself for ever.
  if new.sender <> 'customer' then return new; end if;

  select kind into v_kind
    from public.chat_conversations
   where id = new.conversation_id;

  if v_kind is not null then return new; end if;                 -- already decided
  if public.chat_job_intent(new.body) < 3 then return new; end if;

  -- The shop's wording if it has set one, and the wording the feature
  -- was specified with if it has not.
  select nullif(btrim(s.data->>'jobReply'), '') into v_reply
    from public.site_settings s where s.key = 'chat';

  v_reply := coalesce(v_reply,
    'Thank you for your interest in working with Vaultique Boutique Point. ' ||
    'Job applications and vacancy enquiries are not handled through Live Chat. ' ||
    'Please use our official recruitment channels for any available opportunities.');

  update public.chat_conversations
     set kind        = 'job',
         kind_at     = now(),
         -- Answered, so nothing is waiting on the desk.
         shop_unread = 0
   where id = new.conversation_id;

  -- Wrapped, and quietly. If some later phase adds a rule this insert
  -- offends, the customer's own message must still land: losing what
  -- somebody wrote in order to deliver an automatic notice would be a
  -- far worse fault than the notice not arriving.
  begin
    insert into public.chat_messages (conversation_id, sender, body)
    values (new.conversation_id, 'system', v_reply);
  exception when others then
    raise notice 'job notice not delivered: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists chat_msg_zjob on public.chat_messages;
create trigger chat_msg_zjob
  after insert on public.chat_messages
  for each row execute function public.chat_job_filter();


-- ---------------------------------------------------------------------
-- STEP 5. Putting one back, when the filter was wrong.
--
-- No classifier is right every time, and the shop must never be stuck
-- with a customer parked in the wrong queue because a sentence read
-- oddly. One button in the admin calls this and the conversation is an
-- ordinary one again.
--
-- Deliberately one-way: there is no function to mark a conversation as a
-- job enquiry by hand, because a mark that a person can apply is a mark
-- a person can apply to somebody they simply do not want to answer.
-- ---------------------------------------------------------------------
create or replace function public.chat_job_clear(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.chat_may_answer() then
    raise exception 'You do not have permission to change a conversation.';
  end if;
  update public.chat_conversations
     set kind = null, kind_at = null
   where id = p_id;
end;
$$;

revoke all on function public.chat_job_intent(text)  from public;
revoke all on function public.chat_job_clear(uuid)   from public;
grant execute on function public.chat_job_intent(text) to authenticated;
grant execute on function public.chat_job_clear(uuid)  to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- STEP 6. Check it.
-- ---------------------------------------------------------------------
select q.said, public.chat_job_intent(q.said) as score,
       case when public.chat_job_intent(q.said) >= 3 then 'job enquiry'
            else 'ordinary customer' end as read_as
  from (values
    ('Are you hiring?'),
    ('Any vacancies?'),
    ('I want a job.'),
    ('Are you looking for sales agents?'),
    ('Where can I send my CV?'),
    ('I want to work for Vaultique.'),
    ('Do you deliver to Kitwe?'),
    ('What are your opening hours?'),
    ('What is the position of my order?'),
    ('Can you post it to me?'),
    ('Where can I send my payment?'),
    ('Do you have this dress in a size 12?')
  ) as q(said);
-- Expect the first six to read as job enquiries and the last six as
-- ordinary customers. If any line disagrees, the filter is wrong and
-- should be corrected before it is left running.


-- =====================================================================
-- TO CHANGE WHAT IT SAYS
--
-- Settings > Live Chat > "When somebody asks about a job". Left empty it
-- says the wording above.
--
-- TO UNDO ALL OF THIS
--
--   drop trigger if exists chat_msg_zjob on public.chat_messages;
--   drop function if exists public.chat_job_filter();
--   drop function if exists public.chat_job_clear(uuid);
--   drop function if exists public.chat_job_intent(text);
--
-- The two columns can be left where they are: nothing else reads them,
-- and dropping them would take the record of which conversations were
-- job enquiries with them.
-- =====================================================================
