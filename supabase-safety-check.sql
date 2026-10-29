-- =====================================================================
-- Vaultique Boutique Point — website SAFETY CHECK (build 74)
-- ---------------------------------------------------------------------
-- Run in THIS WEBSITE's Supabase (not the platform's):
--   SQL Editor > New query > paste all of this > Run
--
-- Safe to run again, as often as you like. It changes ONE thing: it gives
-- the chat notifications a new secret. Everything else it only reads.
--
-- WHY A NEW SECRET. Every copy of the website up to build 73 carried the
-- secret the database sends with each "a customer wrote" nudge, written
-- out in supabase-chat-phase7.sql, so anybody holding an old zip has it.
-- Both ends read it from one row of site_settings_private, so replacing
-- it there is the whole job: nothing to copy, nothing to paste into
-- Netlify, and the phones keep buzzing.
--
-- THE REPORT. One line per thing worth knowing, as the result of this
-- query. The last column says what to do; a blank one needs nothing.
-- It never shows the secret itself.
-- =====================================================================

-- The report is built by a function that lives only for this session
-- (pg_temp), so nothing is left behind in the database afterwards.
create or replace function pg_temp.vq_safety_check()
returns table (area text, item text, status text, todo text)
language plpgsql
as $$
declare
  r        record;
  v_rows   jsonb := '[]'::jsonb;   -- the report, one [area, item, status, todo] per line
  v_data   jsonb;
  v_roles  jsonb;
  v_txt    text;
  v_n      bigint;
  v_from   timestamptz;
  v_to     timestamptz;
  v_mfa    boolean;          -- can two-factor be read here at all
  v_staff  integer := 0;
  v_owners integer := 0;
  v_big    record;
begin
  -- -------------------------------------------------------------------
  -- 1) A new secret for the chat notifications
  -- -------------------------------------------------------------------
  begin
    update public.site_settings_private
       set data = jsonb_set(
                    jsonb_set(data, '{secret}',
                              to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))),
                    '{secretRotatedAt}', to_jsonb(now()))
     where key = 'chat_push'
    returning data into v_data;

    if v_data is null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Chat notifications', 'Secret', 'not set up',
         'Nothing to do: phone notifications were never switched on here.'));
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Chat notifications', 'Secret', 'REPLACED just now', ''));
      v_txt := nullif(btrim(coalesce(v_data->>'siteUrl', '')), '');
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Chat notifications', 'Nudges are sent to', coalesce(v_txt, '(blank)'),
         case when v_txt is null
              then 'Phones will not buzz until the owner opens Live Chats once.'
              else 'Check this is your own website''s address. If it is not, open Live Chats signed in as the owner, which puts it back, and remove whoever changed it.'
         end));
    end if;
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Chat notifications', 'Secret', 'NOT CHANGED: ' || sqlerrm,
       'Send this line to whoever looks after the website.'));
  end;

  -- -------------------------------------------------------------------
  -- 2) Online payment: off, live, or test
  -- -------------------------------------------------------------------
  begin
    select data into v_data from public.site_settings where key = 'payments';
    if coalesce((v_data->>'onlineEnabled')::boolean, false) is not true then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Online payment', 'Taking payments online', 'OFF', ''));
    elsif coalesce(v_data->>'onlineMode', 'test') = 'live' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Online payment', 'Taking payments online', 'ON · LIVE', ''));
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Online payment', 'Taking payments online', 'ON · TEST MODE',
         'Today: turn it OFF, or switch to Live, in Settings > Payments. In Test mode anybody can "pay" with the test cards Flutterwave publishes, and the order shows Paid.'));
    end if;
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Online payment', 'Taking payments online', 'could not check: ' || sqlerrm, ''));
  end;

  -- -------------------------------------------------------------------
  -- 3) Everybody who can sign in to the admin
  -- -------------------------------------------------------------------
  begin
    select data into v_roles from public.site_settings where key = 'roles';

    -- Two-factor lives in Supabase's own auth schema. If this project
    -- does not let the SQL Editor read it, say so rather than guess.
    begin
      execute 'select true from auth.mfa_factors limit 1';
      v_mfa := true;
    exception when others then
      v_mfa := false;
    end;

    for r in
      select a.id, to_jsonb(a) as j, u.last_sign_in_at
        from public.admins a
        left join auth.users u on u.id = a.id
       order by (to_jsonb(a)->>'role' = 'owner') desc, a.added_at
    loop
      declare
        v_role  text    := coalesce(r.j->>'role', 'agent');
        v_label text    := coalesce(v_roles->(coalesce(r.j->>'role', 'agent'))->>'label',
                                    initcap(coalesce(r.j->>'role', 'agent')));
        v_on    boolean := coalesce((r.j->>'active')::boolean, true);
        v_two   boolean := null;
        v_said  text;
        v_do    text    := '';
      begin
        v_staff := v_staff + 1;
        if v_role = 'owner' then v_owners := v_owners + 1; end if;
        if v_mfa then
          execute 'select exists (select 1 from auth.mfa_factors f
                                   where f.user_id = $1 and f.status = ''verified'')'
             into v_two using r.id;
        end if;

        v_said := case when v_role = 'owner' then 'Owner' else v_label end
               || case when v_role <> 'owner' and not v_on then ' · SWITCHED OFF' else '' end
               || ' · two-factor ' || case when v_two is null then 'unknown'
                                           when v_two then 'ON' else 'off' end
               || ' · last signed in ' || coalesce(to_char(r.last_sign_in_at, 'DD Mon YYYY'), 'never');

        if v_role <> 'owner' and not v_on then
          v_do := 'Press Remove for them in Settings > Users & Roles. Switch off does NOT stop them reading the database.';
        elsif v_role = 'owner' and v_two is not true then
          v_do := 'Turn on two-factor for yourself: Settings > Security.';
        elsif v_two is not true then
          v_do := 'Recommended: ask them to turn on two-factor (Settings > Security).';
        end if;

        v_rows := v_rows || jsonb_build_array(jsonb_build_array(
          'Staff', coalesce(r.j->>'email', r.id::text), v_said, v_do));
      end;
    end loop;

    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Staff', 'Everybody above', v_staff || case when v_staff = 1 then ' person' else ' people' end
                || ' · ' || v_owners || case when v_owners = 1 then ' owner' else ' owners' end,
       'Until a later build, every one of them (Agents and switched-off people included) can read the bank details, the email password and every customer through the database. Remove anybody who should not have that.'));
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Staff', 'Admin list', 'could not check: ' || sqlerrm, ''));
  end;

  -- What the private table holds (names only, never values).
  begin
    select string_agg(key, ', ' order by key) into v_txt from public.site_settings_private;
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Staff', 'Private settings held', coalesce(v_txt, '(none)'), ''));
  exception when others then null;
  end;

  -- -------------------------------------------------------------------
  -- 4) Customer accounts, against Supabase's own sign-up switch
  -- -------------------------------------------------------------------
  begin
    select data into v_data from public.site_settings where key = 'customer-accounts';
    if coalesce((v_data->>'accountsEnabled')::boolean, false)
       and coalesce(v_data->>'registration', 'open') = 'open' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Customer accounts', 'On the website', 'ON · anybody may sign up',
         'In Supabase > Authentication: leave sign-ups allowed, and make sure "Confirm email" is on.'));
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Customer accounts', 'On the website',
         case when coalesce((v_data->>'accountsEnabled')::boolean, false)
              then 'ON · new sign-ups closed' else 'OFF' end,
         'In Supabase > Authentication: turn OFF "Allow new users to sign up". While it is on, anybody can make an account through Supabase directly, whatever the website says.'));
    end if;
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Customer accounts', 'On the website', 'could not check: ' || sqlerrm, ''));
  end;

  -- -------------------------------------------------------------------
  -- 5) Open or closed, and the preview key
  -- -------------------------------------------------------------------
  begin
    select data into v_data from public.site_settings where key = 'general';
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Shop', 'Open to customers',
       case when coalesce((v_data->>'maintenanceMode')::boolean, false) then 'maintenance'
            else coalesce(nullif(v_data->>'websiteStatus', ''), 'live') end, ''));
    if nullif(btrim(coalesce(v_data->>'previewKey', '')), '') is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Shop', 'Preview key', 'SET',
         'Anybody can read this key from the public settings and use it to see the shop while it is closed. Empty it in Settings > General whenever you are not testing.'));
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Shop', 'Preview key', 'empty', ''));
    end if;
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Shop', 'Settings', 'could not check: ' || sqlerrm, ''));
  end;

  -- -------------------------------------------------------------------
  -- 6) Orders that did not come through the checkout
  --
  -- The checkout gives every order a reference of VB- and five letters
  -- and figures (no 0, 1, I or O). Until a later build, orders could also
  -- be written straight into the table, with any reference or none.
  -- -------------------------------------------------------------------
  begin
    select count(*), min(created_at), max(created_at) into v_n, v_from, v_to
      from public.orders
     where ref is null or ref !~ '^VB-[2-9A-HJ-NP-Z]{5}$';
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Orders', 'Not in the checkout''s reference form',
       v_n::text || case when v_n > 0
                         then ' · ' || to_char(v_from, 'DD Mon YYYY') || ' to ' || to_char(v_to, 'DD Mon YYYY')
                         else '' end,
       case when v_n > 0
            then 'Look at these in the Orders tab. Orders from before the checkout made its own references can be among them; anything recent deserves a look.'
            else '' end));

    select o.ref, o.total, o.currency, o.status, o.created_at into v_big
      from public.orders o
     where o.total is not null
     order by o.total desc
     limit 1;
    if found then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array(
        'Orders', 'Largest on record',
         coalesce(v_big.ref, '(no reference)') || ' · ' || v_big.total::text || coalesce(' ' || v_big.currency, '')
         || ' · ' || coalesce(v_big.status, '?') || ' · ' || to_char(v_big.created_at, 'DD Mon YYYY'),
         'If this is not a real order, cancel it in the Orders tab: an unconfirmed order still counts towards Sales on the Dashboard.'));
    end if;
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Orders', 'Check', 'could not check: ' || sqlerrm, ''));
  end;

  -- -------------------------------------------------------------------
  -- 7) How big the raw visit record has grown
  -- -------------------------------------------------------------------
  begin
    select count(*), min(at) into v_n, v_from from public.site_events;
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Analytics', 'Raw visit records kept',
       v_n::text || coalesce(' since ' || to_char(v_from, 'DD Mon YYYY'), ''),
       'Nothing to do now. The daily clean-up cannot run yet (fixed in a later build), so this only grows.'));
  exception when others then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(
      'Analytics', 'Raw visit records kept', 'not set up', ''));
  end;

  return query
    select e->>0, e->>1, e->>2, e->>3
      from jsonb_array_elements(v_rows) with ordinality as t(e, i)
     order by i;
end
$$;

select area, item, status, todo as "do this" from pg_temp.vq_safety_check();
