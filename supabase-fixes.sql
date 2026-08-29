-- =====================================================================
-- Vaultique Boutique Point — website database fixes
-- ---------------------------------------------------------------------
-- Run this ONCE in Supabase: SQL Editor > New query > paste > Run.
--
-- It is safe to run again. Nothing here drops a table, removes a row or
-- changes anything you have saved; it replaces two rules and adds one
-- function.
--
-- The same changes are in supabase-setup.sql, so a site set up from
-- scratch after today already has them and does not need this file.
--
-- What it fixes:
--   H-1  a guest's order was never recorded, and neither were its lines
--   H-4  a review could arrive already wearing the "Verified" badge
-- =====================================================================


-- ---------------------------------------------------------------------
-- H-1 · Writing an order
--
-- Writing an order is the one thing a guest must be able to do and could
-- not. `or_insert` lets the row in, but PostgreSQL applies a table's
-- SELECT policies to anything an insert RETURNs, and a guest passes none
-- of them — so asking for the new row's id, which the website needs
-- before it can write the lines, refused the whole insert. The lines
-- were refused as well: `oi_insert` asks whether the order exists, and
-- that question is answered under the caller's own reading rights, which
-- show a guest nothing.
--
-- So the whole order is written here instead, in one place, by a
-- function that runs with the standing to do it. Every limit the two
-- policies state is restated here, so nothing is loosened by going
-- through it: the caller cannot choose the status, cannot file an order
-- under anybody else's name, and cannot exceed any of the same bounds.
-- ---------------------------------------------------------------------

create or replace function public.place_order(
  p_order jsonb,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_ref      text;
  v_customer uuid := auth.uid();
  v_pool     text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- no O/0, no I/1
  v_try      int;
  v_i        int;
  v_item     jsonb;
  v_count    int;
  v_name     text := nullif(p_order->>'name', '');
  v_phone    text := nullif(p_order->>'phone', '');
  v_email    text := nullif(p_order->>'email', '');
  v_address  text := nullif(p_order->>'address', '');
  v_notes    text := nullif(p_order->>'notes', '');
  v_fulfil   text := coalesce(nullif(p_order->>'fulfilment', ''), 'delivery');
  v_total    numeric := nullif(p_order->>'total', '')::numeric;
  v_currency text := nullif(p_order->>'currency', '');
begin
  -- The same sanity limits or_insert states. An open door with no bounds
  -- is an invitation to fill the table from a browser console.
  if v_name    is not null and char_length(v_name)    > 120 then raise exception 'name is too long'; end if;
  if v_phone   is not null and char_length(v_phone)   > 40  then raise exception 'phone is too long'; end if;
  if v_email   is not null and char_length(v_email)   > 160 then raise exception 'email is too long'; end if;
  if v_address is not null and char_length(v_address) > 400 then raise exception 'address is too long'; end if;
  if v_notes   is not null and char_length(v_notes)   > 600 then raise exception 'notes are too long'; end if;
  if v_total   is not null and (v_total < 0 or v_total >= 10000000) then raise exception 'total is out of range'; end if;
  if v_fulfil not in ('delivery', 'collection') then v_fulfil := 'delivery'; end if;

  if jsonb_typeof(p_items) <> 'array' then p_items := '[]'::jsonb; end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 200 then raise exception 'too many lines in one order'; end if;

  -- Short, sayable over a phone, and not sequential: a running number
  -- would tell anyone who ordered how many orders the shop has had.
  -- Made here rather than in the browser so that two people pressing
  -- Continue at the same moment cannot land on the same one.
  for v_try in 1..12 loop
    v_ref := 'VB-';
    for v_i in 1..5 loop
      v_ref := v_ref || substr(v_pool, 1 + floor(random() * char_length(v_pool))::int, 1);
    end loop;
    begin
      insert into public.orders
        (ref, customer_id, name, phone, email, address, notes, fulfilment, total, currency, status)
      values
        (v_ref, v_customer, v_name, v_phone, v_email, v_address, v_notes, v_fulfil, v_total, v_currency, 'pending')
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;   -- that reference was taken; try another
    end;
  end loop;

  if v_id is null then raise exception 'could not allocate an order reference'; end if;

  -- The lines, with the same bounds oi_insert states. A line that fails
  -- one of them fails the whole order rather than being dropped
  -- quietly: half an order in the Orders tab is worse than none.
  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'name', '') is not null and char_length(v_item->>'name') > 200 then
      raise exception 'a line name is too long';
    end if;
    if nullif(v_item->>'sku', '') is not null and char_length(v_item->>'sku') > 60 then
      raise exception 'a line sku is too long';
    end if;
    if nullif(v_item->>'price', '') is not null
       and ((v_item->>'price')::numeric < 0 or (v_item->>'price')::numeric >= 10000000) then
      raise exception 'a line price is out of range';
    end if;
    if nullif(v_item->>'qty', '') is not null
       and ((v_item->>'qty')::int <= 0 or (v_item->>'qty')::int > 999) then
      raise exception 'a line quantity is out of range';
    end if;

    insert into public.order_items (order_id, sku, name, price, qty)
    values (
      v_id,
      nullif(v_item->>'sku', ''),
      nullif(v_item->>'name', ''),
      nullif(v_item->>'price', '')::numeric,
      coalesce(nullif(v_item->>'qty', '')::int, 1)
    );
  end loop;

  return jsonb_build_object('id', v_id, 'ref', v_ref);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;


-- ---------------------------------------------------------------------
-- H-4 · A review may not arrive already verified, or dated ahead
--
-- The old rule constrained the rating, the name, the comment and the
-- auto-publish decision, and said nothing about `verified` or
-- `created_at`. Both are sent by the browser, so a review posted
-- straight at the API could arrive wearing the badge that means the shop
-- confirmed this person bought from them — and the shop would never know
-- it had not put it there.
-- ---------------------------------------------------------------------

drop policy if exists rv_insert on public.reviews;
create policy rv_insert on public.reviews for insert with check (
  rating between 1 and 5
  and char_length(name) between 1 and 60
  and (comment is null or char_length(comment) <= 1000)
  -- Waiting to be read is always allowed. Publishing yourself is only
  -- allowed when the shop has said so.
  and (approved = false or public.review_auto_publish(rating))
  -- The badge is the shop's word, not the reviewer's.
  and verified is not true
  -- And a review may not be dated ahead, which would hold it at the top
  -- of a list ordered newest first for as long as that date is in front.
  and (created_at is null or created_at <= now())
);
