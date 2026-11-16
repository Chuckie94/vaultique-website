-- =====================================================================
-- New Arrivals that leave on their own
-- Run once in this WEBSITE's Supabase SQL Editor. Safe to run again.
--
-- Remembers the day a piece was ticked New in Products & Photos, so the
-- website can take it out of New Arrivals after the number of days set in
-- Settings > Homepage > New arrivals. The date is kept by the database
-- itself: ticking New starts it, unticking clears it, and nothing else
-- (a price change, a new photo) moves it.
-- =====================================================================

alter table public.product_meta add column if not exists new_since timestamptz;

create or replace function public.product_meta_new_since()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.is_new, false) then
    if tg_op = 'INSERT' or not coalesce(old.is_new, false) then
      new.new_since := now();                                  -- just ticked
    else
      new.new_since := coalesce(old.new_since, new.new_since, now());  -- still new: keep the date
    end if;
  else
    new.new_since := null;                                     -- not new
  end if;
  return new;
end;
$$;

drop trigger if exists product_meta_new_since_t on public.product_meta;
create trigger product_meta_new_since_t
  before insert or update on public.product_meta
  for each row execute function public.product_meta_new_since();

-- Pieces already ticked New get today as their start, so nothing
-- disappears the moment this runs. Untick any that are no longer new.
update public.product_meta set new_since = now() where is_new and new_since is null;

notify pgrst, 'reload schema';

-- The check. Every line must say OK.
select part, case when done then 'OK' else 'NOT DONE' end as status
  from (values
    ('product_meta.new_since', exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'product_meta' and column_name = 'new_since')),
    ('new_since kept by the database', exists (select 1 from pg_trigger where tgname = 'product_meta_new_since_t'))
  ) t(part, done);
