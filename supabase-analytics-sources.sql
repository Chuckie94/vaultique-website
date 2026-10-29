-- =====================================================================
-- Website Analytics: WHERE VISITORS CAME FROM
-- Run once, after supabase-analytics.sql. Safe to run again.
--
-- Reads what the website already records -- the site a visit arrived
-- from, as a host name and nothing more -- and groups it into sources
-- the shop recognises: Facebook, Instagram, WhatsApp, Google and so on.
-- A visit is counted once, by where its first page came from.
--
-- Nothing is sent to Meta or anybody else. This only reads the shop's
-- own table, and only for administrators who may see analytics.
-- =====================================================================

-- ---------------------------------------------------------------------
-- NOT AFTER BUILD 76'S HARDENING. Once supabase-hardening.sql has been
-- run on this project it holds the newer version of everything this
-- file sets up, and running this one again would quietly put back an
-- older, weaker one. So it stops here, before changing anything.
-- ---------------------------------------------------------------------
do $$
declare
  v_done boolean := false;
begin
  -- Asked through EXECUTE because on a project that has never run the
  -- hardening the table does not exist, and a plain query naming it
  -- would stop this file before it started.
  if to_regclass('public.schema_migrations') is not null then
    execute 'select exists (select 1 from public.schema_migrations where version >= ''076'')' into v_done;
  end if;
  if v_done then
    raise exception using
      message = 'Not run, and nothing was changed: supabase-hardening.sql (build 76) has already been run on this project and replaces this file. If you were running this file again because older instructions said it was safe to, you do not need to: run supabase-hardening.sql again instead.',
      hint = 'Only if this file has never been run on this project and you need it: run  delete from public.schema_migrations where version = ''076-hardening'';  then this file, then supabase-hardening.sql again.';
  end if;
end $$;

create or replace function public.site_source_name(p_host text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_host is null or p_host = ''                                   then 'Direct'
    when p_host ~* '(^|\.)(instagram\.com|ig\.me)$' or p_host ~* '^instagram$'
                                                                         then 'Instagram'
    when p_host ~* '(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$' or p_host ~* '^(facebook|fb|meta)$'
                                                                         then 'Facebook'
    when p_host ~* '(^|\.)(whatsapp\.com|wa\.me)$' or p_host ~* '^whatsapp$' then 'WhatsApp'
    when p_host ~* '(^|\.)google\.'  or p_host ~* '^google$'             then 'Google'
    when p_host ~* '(^|\.)tiktok\.com$' or p_host ~* '^tiktok$'          then 'TikTok'
    when p_host ~* '(^|\.)(t\.co|twitter\.com|x\.com)$'                  then 'X (Twitter)'
    when p_host ~* '(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com)$'       then 'Other search engines'
    else lower(p_host)
  end;
$$;

create or replace function public.site_sources(p_from date, p_to date, p_tz text default 'UTC')
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_out   json;
begin
  if not public.may_see_analytics() then
    raise exception 'You do not have permission to read the website analytics.';
  end if;
  if p_from is null or p_to is null then return '[]'::json; end if;
  p_tz    := coalesce(nullif(p_tz, ''), 'UTC');
  v_start := (p_from::timestamp) at time zone p_tz;
  v_end   := ((p_to + 1)::timestamp) at time zone p_tz;

  with visits as (
    select e.session,
           min(e.visitor)                              as visitor,
           (array_agg(e.referrer order by e.at, e.id))[1] as first_ref
      from public.site_events e
     where e.at >= v_start and e.at < v_end
     group by e.session
  )
  select json_agg(x order by x.visits desc, x.source)
    into v_out
    from (
      select public.site_source_name(first_ref) as source,
             count(*)                            as visits,
             count(distinct visitor)             as visitors
        from visits
       group by 1
       order by count(*) desc
       limit 20
    ) x;
  return coalesce(v_out, '[]'::json);
end;
$$;
revoke all on function public.site_sources(date, date, text) from public, anon;
grant execute on function public.site_sources(date, date, text) to authenticated;

notify pgrst, 'reload schema';

-- The check. It must say OK.
select case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'site_sources')
            then 'OK' else 'NOT DONE' end as "where visitors came from";
