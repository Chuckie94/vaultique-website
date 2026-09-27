-- =====================================================================
-- Website Analytics: LIVE FIGURES, and a repair
-- Run once, after supabase-analytics.sql. Safe to run again.
--
-- 1. REPAIR. A shop whose site_events table was made before the sku
--    column existed refuses every visit that mentions it. The column is
--    added here if it is missing; nothing happens if it is there.
--
-- 2. LIVE. The Analytics page is told the moment a page or a piece is
--    opened, and reads its figures again straight away. Realtime applies
--    the same rules as reading: only a signed-in administrator whose
--    role may see analytics receives anything.
-- =====================================================================

alter table public.site_events add column if not exists sku text;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'site_events'
  ) then
    alter publication supabase_realtime add table public.site_events;
  end if;
exception when others then
  raise notice 'site_events not added to the realtime publication: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
