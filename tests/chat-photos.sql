-- ===========================================================================
-- CUSTOMER PHOTOS IN THE CHAT, CHECKED (see tests/chat-photos-fixture.sql)
--
-- The door a customer's photo comes through, tried from the anon role the
-- website really uses: that it opens for the right person, once, at the
-- right address, and for nobody and nothing else.
-- ===========================================================================
set client_min_messages = warning;

create table checks (n serial, ok boolean, what text);
grant insert, select on checks to anon;
grant usage on sequence checks_n_seq to anon;
create or replace function chk(p_ok boolean, p_what text) returns void
language plpgsql security definer as $$
begin insert into checks (ok, what) values (coalesce(p_ok, false), p_what); end $$;
grant execute on function chk(boolean, text) to public;

insert into public.chat_conversations (id, token, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tok-open',   'open'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'tok-other',  'open'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'tok-closed', 'closed');

select chk((select file_size_limit from storage.buckets where id = 'chat-uploads') = 5242880
           and (select allowed_mime_types @> array['image/jpeg']
                      and not allowed_mime_types @> array['text/html']
                  from storage.buckets where id = 'chat-uploads'),
           'the bucket takes images only, 5 MB at most');

set role anon;

select chk(public.chat_photos_on(), 'the website can tell the feature is installed');

-- An address, for somebody with an open conversation
create temp table got (k text, v text);
do $$
declare p text; e text;
begin
  p := public.chat_photo_start('tok-open');
  insert into got values ('p', p);
  perform chk(p like 'aaaaaaaa-0000-0000-0000-000000000001/c-%.jpg',
              'an open conversation is given an address inside its own folder');

  begin perform public.chat_photo_start('nonsense'); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'no open conversation', 'a made-up token is given nothing');

  begin perform public.chat_photo_start('tok-closed'); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'no open conversation', 'nor is a closed conversation');
end $$;

-- Uploading
do $$
declare p text := (select v from got where k = 'p'); e text;
begin
  begin
    insert into storage.objects (bucket_id, name) values ('chat-uploads', 'aaaaaaaa-0000-0000-0000-000000000001/mine.jpg');
    e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'uploading anywhere else is refused');

  begin
    insert into storage.objects (bucket_id, name) values ('product-images', p);
    e := 'none';
  exception when others then e := 'refused'; end;
  perform chk(e = 'refused', 'and so is the same address in another bucket');

  begin
    insert into storage.objects (bucket_id, name) values ('chat-uploads', p);
    e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'none', 'uploading to the address handed out works: ' || e);
end $$;

-- Sending
do $$
declare p text := (select v from got where k = 'p'); e text; at timestamptz;
begin
  begin perform public.chat_send_photo('tok-other', p); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'unknown photo', 'another conversation cannot send this one''s photo');

  at := public.chat_send_photo('tok-open', p, '  is this in stock?  ');
  perform chk(at is not null, 'the owner sends it into their conversation');

  begin perform public.chat_send_photo('tok-open', p); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'unknown photo', 'and cannot send the same address twice');

  perform chk(not public.chat_photo_slot_open(p), 'a used address is closed to further uploads');
end $$;

-- A slot asked for but never uploaded to
do $$
declare p text; e text;
begin
  p := public.chat_photo_start('tok-open');
  begin perform public.chat_send_photo('tok-open', p); e := 'none';
  exception when others then e := sqlerrm; end;
  perform chk(e = 'photo not uploaded', 'a photo that never arrived is not sent');
  -- and its slot is still open, since the failed send rolled back
  insert into storage.objects (bucket_id, name) values ('chat-uploads', p);
  perform public.chat_send_photo('tok-open', p);
end $$;

-- The hourly limit
do $$
declare n int := 0; e text := 'none';
begin
  -- two were already asked for above
  for k in 1..20 loop
    begin perform public.chat_photo_start('tok-open'); n := n + 1;
    exception when others then e := sqlerrm; exit; end;
  end loop;
  perform chk(e = 'too many photos' and n = 8,
              'at most 10 photos an hour per conversation (8 more were allowed: ' || n || ')');
  perform chk(public.chat_photo_start('tok-other') is not null,
              'which does not stop a different customer');
end $$;

reset role;

select chk(m.sender = 'customer' and m.body = 'is this in stock?'
           and m.meta->>'kind' = 'image'
           and m.meta->>'path' like 'aaaaaaaa-0000-0000-0000-000000000001/c-%',
           'the message is the customer''s, with the photo attached by the database')
  from public.chat_messages m order by created_at limit 1;
select chk((select shop_unread from public.chat_conversations where token = 'tok-open') = 2,
           'and the shop sees two unread messages');

set role anon;
do $$ declare n int; begin
  begin select count(*) into n from public.chat_photo_slots; perform chk(n = 0, 'a customer cannot list the addresses');
  exception when others then perform chk(true, 'a customer cannot list the addresses'); end;
end $$;
reset role;

select case when ok then '  ✓ ' else '  ✗ ' end || what from checks order by n;
select case when count(*) filter (where not ok) = 0
            then '  chat photos: all ' || count(*) || ' checks passed'
            else '  ✗ ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks FAILED' end
  from checks;
