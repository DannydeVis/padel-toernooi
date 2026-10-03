-- Controles op account_migration.sql. Draai met supabase/tests/run.sh.
-- Elke controle meet wat er echt gebeurde (found, aantallen), niet alleen of
-- er een fout kwam: RLS geeft op een geblokkeerde update of delete geen fout,
-- hij raakt gewoon nul rijen.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com');

-- ── Anna schrijft via account_sync ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ declare n int; begin
  select count(*) into n from public.account_sync(
    '[{"kind":"group","item_key":"g1","data":{"name":"Dinsdag"},"updated_at":1000},
      {"kind":"cc","item_key":"ABC123","data":{"token":"geheim"},"updated_at":1000}]'::jsonb);
  if n <> 2 then raise exception 'gezakt: Anna zou 2 rijen terug moeten krijgen, kreeg %', n; end if;
  raise notice 'ok: account_sync schrijft en geeft alles van het account terug';
end $$;
commit;

-- ── Nieuwste wint, ouder wordt genegeerd ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ declare nm text; begin
  perform public.account_sync('[{"kind":"group","item_key":"g1","data":{"name":"Oud"},"updated_at":500}]'::jsonb);
  select data->>'name' into nm from public.account_items where kind='group' and item_key='g1';
  if nm <> 'Dinsdag' then raise exception 'gezakt: een oudere versie overschreef een nieuwere (%)', nm; end if;
  perform public.account_sync('[{"kind":"group","item_key":"g1","data":{"name":"Woensdag"},"updated_at":2000}]'::jsonb);
  select data->>'name' into nm from public.account_items where kind='group' and item_key='g1';
  if nm <> 'Woensdag' then raise exception 'gezakt: een nieuwere versie werd niet opgeslagen (%)', nm; end if;
  raise notice 'ok: per rij wint de nieuwste';
end $$;
commit;

-- ── Twee keer dezelfde sleutel in één rondje ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ declare nm text; begin
  perform public.account_sync('[{"kind":"group","item_key":"g2","data":{"name":"A"},"updated_at":10},
                                {"kind":"group","item_key":"g2","data":{"name":"B"},"updated_at":20}]'::jsonb);
  select data->>'name' into nm from public.account_items where kind='group' and item_key='g2';
  if nm <> 'B' then raise exception 'gezakt: dubbele sleutel gaf %', nm; end if;
  raise notice 'ok: dubbele sleutel in één rondje geeft geen fout, de nieuwste telt';
end $$;
commit;

-- ── Grafsteen: verwijderen wist de inhoud ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ declare r record; begin
  perform public.account_sync('[{"kind":"group","item_key":"g2","deleted":true,"data":{"name":"B"},"updated_at":30}]'::jsonb);
  select * into r from public.account_items where kind='group' and item_key='g2';
  if not r.deleted or r.data is not null then raise exception 'gezakt: grafsteen bewaart nog inhoud'; end if;
  raise notice 'ok: een verwijderde groep is een grafsteen zonder inhoud';
end $$;
commit;

-- ── Bob ziet en raakt niets van Anna ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
do $$ declare n int; begin
  select count(*) into n from public.account_items;
  if n <> 0 then raise exception 'gezakt: Bob ziet % rijen van Anna', n; end if;
  select count(*) into n from public.account_sync('[]'::jsonb);
  if n <> 0 then raise exception 'gezakt: account_sync geeft Bob rijen van Anna'; end if;
  update public.account_items set data = '{"name":"gekaapt"}' where item_key = 'g1';
  if found then raise exception 'gezakt: Bob kon een rij van Anna wijzigen'; end if;
  delete from public.account_items where item_key = 'ABC123';
  if found then raise exception 'gezakt: Bob kon een rij van Anna weggooien'; end if;
  raise notice 'ok: Bob ziet, wijzigt en verwijdert niets van Anna';
end $$;
do $$ begin
  insert into public.account_items (user_id, kind, item_key, data, updated_at)
  values ('00000000-0000-0000-0000-00000000000a', 'group', 'nep', '{}', 1);
  raise exception 'gezakt: Bob kon een rij op naam van Anna aanmaken';
exception when insufficient_privilege then
  raise notice 'ok: Bob kan geen rij op naam van Anna aanmaken';
end $$;
-- account_sync heeft geen parameter voor de eigenaar: wat Bob stuurt komt bij Bob.
do $$ declare n int; begin
  perform public.account_sync('[{"kind":"group","item_key":"g1","data":{"name":"van Bob"},"updated_at":99999}]'::jsonb);
  select count(*) into n from public.account_items where item_key='g1';
  if n <> 1 then raise exception 'gezakt: Bob ziet % rijen met g1', n; end if;
  raise notice 'ok: dezelfde sleutel bij Bob is een eigen rij';
end $$;
commit;

-- Anna's g1 is niet aangeraakt
do $$ declare nm text; begin
  select data->>'name' into nm from public.account_items
   where user_id='00000000-0000-0000-0000-00000000000a' and kind='group' and item_key='g1';
  if nm <> 'Woensdag' then raise exception 'gezakt: Anna''s groep is veranderd in %', nm; end if;
  raise notice 'ok: Anna''s groep is onaangeroerd';
end $$;

-- ── Niet ingelogd: niets ──
begin;
set local role anon;
do $$ begin
  perform 1 from public.account_items;
  raise exception 'gezakt: anon kan account_items lezen';
exception when insufficient_privilege then raise notice 'ok: anon kan account_items niet lezen';
end $$;
do $$ begin
  perform public.account_sync('[]'::jsonb);
  raise exception 'gezakt: anon kan account_sync aanroepen';
exception when insufficient_privilege then raise notice 'ok: anon kan account_sync niet aanroepen';
end $$;
do $$ begin
  perform public.delete_my_account();
  raise exception 'gezakt: anon kan delete_my_account aanroepen';
exception when insufficient_privilege then raise notice 'ok: anon kan delete_my_account niet aanroepen';
end $$;
commit;

-- Ingelogd zonder claims (zou niet moeten kunnen, maar dan nog): geen eigenaar
begin;
set local role authenticated;
do $$ begin
  perform public.account_sync('[]'::jsonb);
  raise exception 'gezakt: account_sync zonder account werkte';
exception when insufficient_privilege then raise notice 'ok: account_sync zonder account weigert';
end $$;
commit;

-- ── Te groot ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ begin
  perform public.account_sync(jsonb_build_array(jsonb_build_object(
    'kind','live','item_key','state','updated_at',5000,
    'data', jsonb_build_object('blob', (select string_agg(md5(g::text), '') from generate_series(1, 40000) g)))));
  raise exception 'gezakt: een rij van ruim 1 MB werd geaccepteerd';
exception when check_violation then raise notice 'ok: een te grote rij wordt geweigerd';
end $$;
commit;

-- ── Plafond van 1000 rijen ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
do $$ begin
  perform public.account_sync((select jsonb_agg(jsonb_build_object('kind','group','item_key','x'||g,'data','{}'::jsonb,'updated_at',1))
                               from generate_series(1, 499) g));
  perform public.account_sync((select jsonb_agg(jsonb_build_object('kind','comp','item_key','y'||g,'data','{}'::jsonb,'updated_at',1))
                               from generate_series(1, 500) g));
  perform public.account_sync('[{"kind":"cc","item_key":"te-veel","data":{},"updated_at":1}]'::jsonb);
  raise exception 'gezakt: rij 1001 werd geaccepteerd';
exception when program_limit_exceeded then raise notice 'ok: na 1000 rijen is het vol';
end $$;
rollback;

-- ── Oude grafstenen worden opgeruimd ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ declare n int; begin
  perform public.account_sync('[{"kind":"comp","item_key":"oud","deleted":true,"updated_at":1}]'::jsonb);
  select count(*) into n from public.account_items where item_key='oud';
  if n <> 0 then raise exception 'gezakt: een grafsteen van 1970 bleef staan'; end if;
  raise notice 'ok: grafstenen ouder dan een half jaar verdwijnen';
end $$;
commit;

-- ── Account verwijderen ──
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.delete_my_account();
commit;
do $$ declare n int; begin
  select count(*) into n from auth.users where id='00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'gezakt: Anna''s account bestaat nog'; end if;
  select count(*) into n from public.account_items where user_id='00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'gezakt: % rijen van Anna bleven achter', n; end if;
  select count(*) into n from auth.users where id='00000000-0000-0000-0000-00000000000b';
  if n <> 1 then raise exception 'gezakt: Bob is meeverwijderd'; end if;
  raise notice 'ok: account verwijderen neemt alle opgeslagen kopieën mee, en alleen die van jezelf';
end $$;

begin;
set local role authenticated;
do $$ begin
  perform public.delete_my_account();
  raise exception 'gezakt: delete_my_account zonder account werkte';
exception when insufficient_privilege then raise notice 'ok: zonder account valt er niets te verwijderen';
end $$;
commit;

do $$ begin raise notice 'ALLE CONTROLES GESLAAGD'; end $$;
