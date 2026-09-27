-- psql -f tests/analytics-live-fixture.sql -f supabase-analytics-live.sql -f tests/analytics-live.sql
select case when exists (select 1 from information_schema.columns
                          where table_name = 'site_events' and column_name = 'sku')
            then '  ✓ site_events has its sku column' else '  ✗ sku column missing' end;
select case when exists (select 1 from pg_publication_tables
                          where pubname = 'supabase_realtime' and tablename = 'site_events')
            then '  ✓ new visits are announced live' else '  ✗ site_events not published' end;
