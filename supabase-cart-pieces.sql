-- =====================================================================
-- Which pieces were added to carts
-- Run once in this WEBSITE's Supabase SQL Editor. Safe to run again.
--
-- Admin > Analytics showed "Added to cart" as a number only, and the
-- Dashboard worked its list out from the forty most viewed pieces, so a
-- piece added to a cart but seldom viewed could be missed. This reads the
-- add-to-cart records themselves: every piece added in the range, how many
-- times, by how many people, how often it was viewed, and when it was last
-- added. Read by administrators who may see the analytics, as before.
-- =====================================================================

create or replace function public.site_cart_products(p_from date, p_to date, p_tz text, p_limit integer default 20)
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

  select json_agg(x order by x.carts desc, x.last_at desc)
    into v_out
    from (
      select e.sku                                                         as sku,
             coalesce(min(e.label) filter (where e.kind = 'add_to_cart'),
                      min(e.label))                                        as label,
             count(*) filter (where e.kind = 'add_to_cart')                as carts,
             count(distinct e.visitor) filter (where e.kind = 'add_to_cart') as people,
             count(*) filter (where e.kind = 'product_view')               as views,
             max(e.at) filter (where e.kind = 'add_to_cart')               as last_at
        from public.site_events e
       where e.sku is not null
         and e.kind in ('add_to_cart', 'product_view')
         and e.at >= v_start and e.at < v_end
       group by e.sku
      having count(*) filter (where e.kind = 'add_to_cart') > 0
       order by count(*) filter (where e.kind = 'add_to_cart') desc,
                max(e.at) filter (where e.kind = 'add_to_cart') desc
       limit greatest(coalesce(p_limit, 20), 1)
    ) x;

  return coalesce(v_out, '[]'::json);
end;
$$;
revoke all on function public.site_cart_products(date, date, text, integer) from public, anon;
grant execute on function public.site_cart_products(date, date, text, integer) to authenticated;

notify pgrst, 'reload schema';

-- The check. It must say OK.
select 'site_cart_products (which pieces were added to carts)' as part,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'site_cart_products')
            then 'OK' else 'NOT DONE' end as status;
