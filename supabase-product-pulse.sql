-- =====================================================================
-- product_pulse — how an open browser learns the shop changed something
--
-- RUN THIS IN THE **WEBSITE'S** SUPABASE PROJECT, not the platform's.
-- It is the same project the chat, reviews and site settings live in.
--
-- WHAT IT HOLDS. One row. A timestamp copied from the platform, a
-- counter that only goes up, and when it was noticed. It holds no
-- product, no price, no customer and no name. Read by a stranger it says
-- exactly one thing: "the shop changed something at 14:32."
--
-- WHY IT IS HERE AND NOT IN THE PLATFORM'S PROJECT. A browser can only
-- subscribe to a database it holds a key for. The platform's key can
-- read the whole business — every sale, every customer, every staff
-- record — which is the entire reason /api/products exists to stand in
-- front of it and hand out six safe fields. Putting that key in the page
-- would walk straight around it. This project's key is already public
-- and reaches nothing but this website's own content, so the signal is
-- relayed through here instead.
--
-- ANYONE MAY READ IT. NOBODY MAY WRITE IT. A visitor who could write it
-- could tell every browser in the shop to fetch the catalogue, over and
-- over. So writing is left to the service role, which only the scheduled
-- function has.
--
-- RUNNING THIS IS OPTIONAL. Without it the website still updates itself
-- — the storefront falls back to a plain refresh every few minutes, and
-- the catalogue is still correct. This is what makes it prompt, not what
-- makes it right.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1. The table.
-- ---------------------------------------------------------------------
create table if not exists public.product_pulse (
  id              integer     primary key,
  pos_updated_at  text,
  revision        bigint      not null default 0,
  changed_at      timestamptz not null default now()
);

comment on table public.product_pulse is
  'One row. Says only that the shop''s catalogue changed, never what changed. Written by the scheduled product-pulse function; read by every open storefront over Realtime.';

-- The single row, so the first signal is an UPDATE like every one after
-- it rather than an INSERT nothing is listening for.
insert into public.product_pulse (id, pos_updated_at, revision)
values (1, '', 0)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- STEP 2. Anyone may read it. Nobody may write it.
-- ---------------------------------------------------------------------
alter table public.product_pulse enable row level security;

drop policy if exists product_pulse_read on public.product_pulse;
create policy product_pulse_read
  on public.product_pulse
  for select
  to anon, authenticated
  using (true);

-- No insert, update or delete policy exists, and that is deliberate: with
-- row level security on, anything not permitted is refused. The service
-- role bypasses this by design, which is how the scheduled function
-- writes and nobody else can.
revoke insert, update, delete on public.product_pulse from anon, authenticated;


-- ---------------------------------------------------------------------
-- STEP 3. Let Realtime broadcast it.
--
-- Without this the row changes and nobody is told, which looks exactly
-- like everything working except that nothing ever updates.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'product_pulse'
  ) then
    alter publication supabase_realtime add table public.product_pulse;
  end if;
-- A project without that publication is not a broken project, and this
-- is the last real statement in the file -- so stopping here told the
-- shop the whole step had failed when the table above was created
-- perfectly well. supabase-chat-realtime.sql already carried this guard
-- around the identical statement; this file did not.
exception when others then
  raise notice 'product_pulse not added to the realtime publication: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------
-- STEP 4. Check it.
-- ---------------------------------------------------------------------
select id, pos_updated_at, revision, changed_at
from public.product_pulse;

select tablename as broadcasting
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'product_pulse';
-- Expect one row from each. If the second is empty, Realtime is not
-- broadcasting this table and only the fallback refresh will be working.


-- =====================================================================
-- THE ONE SETTING THIS NEEDS
--
-- In Netlify → Site settings → Environment variables, add:
--
--   WEB_SUPABASE_SERVICE_KEY = <this project's service_role key>
--
-- That key is what lets the scheduled function write the pulse, and it
-- must never appear anywhere a browser can read. It is used by
-- netlify/functions/product-pulse.js and nothing else.
--
-- Without it the function does nothing and says so in its log, and the
-- website carries on updating on the fallback. Nothing breaks.
--
-- TO UNDO ALL OF THIS
--
--   drop table if exists public.product_pulse;
--
-- The storefront falls straight back to the plain refresh.
-- =====================================================================
