-- Controles op security_migration.sql, tegen de policies uit de bestaande
-- migratiebestanden. Draai met supabase/tests/run.sh.
\set ON_ERROR_STOP on

-- Een organisator: schrijft met zijn sleutel in de header, net als de app
create or replace function pg_temp.als_organisator(tok text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-session-token', tok)::text, true)
$$;

insert into public.tournaments (code, data, session_token) values
  ('OPEN01', '{"playerScoring":true,"courtTokens":{"1":"baan1sleutel"},"courtPending":[{"matchId":7,"sa":1,"sb":2}]}', 'geheim-toernooi-1'),
  ('DICHT1', '{"courtTokens":{"2":"baan2sleutel"}}', 'geheim-dicht');
insert into public.competitions (code, session_token, name, type) values ('LADDER', 'geheim-ladder', 'Ladder', 'ladder');
insert into public.ladder_players (competition_code, name, position) values ('LADDER', 'Anna', 1), ('LADDER', 'Bob', 2);
insert into public.signup_events (code, session_token, format, max_players) values ('SIGN01', 'geheim-inschrijving', 'americano', 8);

-- ── De sleutels zijn niet meer te lezen ──
begin; set local role anon;
do $$ begin
  perform session_token from public.tournaments;
  raise exception 'gezakt: anon kan de sleutel van een toernooi lezen';
exception when insufficient_privilege then raise notice 'ok: de sleutel van een toernooi is niet te lezen';
end $$;
do $$ begin
  perform session_token from public.competitions;
  raise exception 'gezakt: anon kan de sleutel van een competitie lezen';
exception when insufficient_privilege then raise notice 'ok: de sleutel van een competitie is niet te lezen';
end $$;
do $$ begin
  perform session_token from public.signup_events;
  raise exception 'gezakt: anon kan de sleutel van een inschrijving lezen';
exception when insufficient_privilege then raise notice 'ok: de sleutel van een inschrijving is niet te lezen';
end $$;
do $$ declare n int; begin
  select count(*) into n from (select code, data, updated_at from public.tournaments) x;
  if n <> 2 then raise exception 'gezakt: meekijken leest % toernooien', n; end if;
  perform code, name, type, settings, aliases from public.competitions;
  perform code, event_name, format, max_players, signup_open from public.signup_events;
  raise notice 'ok: al het andere is nog gewoon te lezen (meekijken, ladder, inschrijving)';
end $$;
commit;

begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa"}';
do $$ begin
  perform session_token from public.tournaments;
  raise exception 'gezakt: een ingelogd account kan de sleutel lezen';
exception when insufficient_privilege then raise notice 'ok: ook ingelogd is de sleutel niet te lezen';
end $$;
commit;

-- ── De organisator kan nog alles wat hij kon ──
begin; set local role anon;
select pg_temp.als_organisator('geheim-toernooi-1');
do $$ begin
  update public.tournaments set data = jsonb_set(data, '{x}', '1'), updated_at = now() where code = 'OPEN01';
  if not found then raise exception 'gezakt: de organisator kan zijn toernooi niet meer bijwerken'; end if;
  raise notice 'ok: de organisator werkt zijn toernooi bij met zijn sleutel';
end $$;
-- De oude manier van bewaren (upsert) kan niet meer: daarom tournament_save
do $$ begin
  insert into public.tournaments (code, data, updated_at, session_token) values ('OPEN01', '{}', now(), 'geheim-toernooi-1')
    -- Zo stuurt PostgREST een upsert: alle meegestuurde kolommen in de SET
    on conflict (code) do update set code = excluded.code, data = excluded.data,
      updated_at = excluded.updated_at, session_token = excluded.session_token;
  raise exception 'gezakt: verwacht dat een upsert leesrecht op de sleutel vraagt';
exception when insufficient_privilege then raise notice 'ok: een upsert kan niet meer (vraagt leesrecht op de sleutel), dus tournament_save';
end $$;
do $$ declare d jsonb; begin
  if not public.tournament_save('OPEN01', '{"playerScoring":true,"courtTokens":{"1":"baan1sleutel"},"r":2}', 'geheim-toernooi-1') then
    raise exception 'gezakt: tournament_save met de goede sleutel'; end if;
  select data into d from public.tournaments where code = 'OPEN01';
  if d->>'r' <> '2' then raise exception 'gezakt: tournament_save schreef niet'; end if;
  if not public.tournament_save('NIEUW2', '{"a":1}', 'geheim-nieuw-0000') then
    raise exception 'gezakt: tournament_save maakt geen nieuw toernooi'; end if;
  raise notice 'ok: tournament_save werkt een toernooi bij en maakt een nieuw aan';
end $$;
do $$ begin
  insert into public.tournaments (code, data, session_token) values ('NIEUW1', '{}', 'geheim-nieuw');
  raise notice 'ok: een nieuw toernooi delen werkt nog';
end $$;
commit;

begin; set local role anon;
do $$ begin
  perform public.tournament_save('OPEN01', '{}', 'een-verkeerde-sleutel');
  raise exception 'gezakt: tournament_save met een verkeerde sleutel overschrijft een toernooi';
exception when insufficient_privilege then raise notice 'ok: tournament_save weigert een verkeerde sleutel';
end $$;
do $$ begin
  perform public.tournament_save('OPEN01', '{}', 'kort');
  raise exception 'gezakt: een te korte sleutel wordt geaccepteerd';
exception when invalid_parameter_value then raise notice 'ok: een te korte sleutel of rare code wordt geweigerd';
end $$;
commit;

begin; set local role anon;
select pg_temp.als_organisator('fout');
do $$ begin
  update public.tournaments set data = '{}' where code = 'OPEN01';
  if found then raise exception 'gezakt: een verkeerde sleutel kan een toernooi wijzigen'; end if;
  raise notice 'ok: met een verkeerde sleutel verandert er niets';
end $$;
commit;

begin; set local role anon;
select pg_temp.als_organisator('geheim-ladder');
do $$ begin
  update public.ladder_players set position = 3 where name = 'Anna' and competition_code = 'LADDER';
  if not found then raise exception 'gezakt: de organisator kan de ladder niet meer bijwerken'; end if;
  update public.competitions set name = 'Ladder 2' where code = 'LADDER';
  if not found then raise exception 'gezakt: de organisator kan zijn competitie niet meer bijwerken'; end if;
  raise notice 'ok: de organisator beheert zijn ladder en competitie nog';
end $$;
commit;

begin; set local role anon;
select pg_temp.als_organisator('geheim-inschrijving');
do $$ declare i bigint; begin
  insert into public.signups (tournament_code, name, status) values ('SIGN01', 'Carla', 'confirmed');
  update public.signups set status = 'waitlist' where tournament_code = 'SIGN01' and name = 'Carla';
  if not found then raise exception 'gezakt: de organisator kan een aanmelding niet meer bijwerken'; end if;
  delete from public.signups where tournament_code = 'SIGN01' and name = 'Carla';
  if not found then raise exception 'gezakt: de organisator kan een aanmelding niet meer weghalen'; end if;
  update public.signup_events set signup_open = false where code = 'SIGN01';
  if not found then raise exception 'gezakt: de organisator kan zijn inschrijving niet meer sluiten'; end if;
  raise notice 'ok: de organisator beheert zijn inschrijving nog';
end $$;
commit;

-- ── Een bezoeker zonder sleutel ──
update public.signup_events set signup_open = true where code = 'SIGN01'; -- hierboven gesloten
begin; set local role anon;
select pg_temp.als_organisator('fout');
do $$ begin
  insert into public.ladder_players (competition_code, name, position) values ('LADDER', 'Dirk', 4);
  insert into public.ladder_challenges (competition_code, challenger_name, defender_name, reported_winner) values ('LADDER', 'Dirk', 'Bob', 'Dirk');
  insert into public.signups (tournament_code, name, status) values ('SIGN01', 'Eva', 'confirmed');
  raise notice 'ok: zonder sleutel kun je je nog aanmelden op de ladder, een uitdaging melden en je inschrijven';
end $$;
do $$ begin
  update public.ladder_players set position = 1 where name = 'Dirk';
  if found then raise exception 'gezakt: zonder sleutel kun je de ladder aanpassen'; end if;
  update public.ladder_challenges set status = 'approved' where challenger_name = 'Dirk';
  if found then raise exception 'gezakt: zonder sleutel kun je een uitdaging goedkeuren'; end if;
  delete from public.ladder_players where name = 'Anna';
  if found then raise exception 'gezakt: zonder sleutel kun je iemand van de ladder halen'; end if;
  update public.signups set status = 'waitlist' where name = 'Eva';
  if found then raise exception 'gezakt: zonder sleutel kun je een aanmelding wijzigen'; end if;
  delete from public.signups where name = 'Eva';
  if found then raise exception 'gezakt: zonder sleutel kun je een aanmelding weghalen'; end if;
  raise notice 'ok: zonder sleutel kun je niets aanpassen of weghalen op de ladder en de wachtlijst';
end $$;
commit;

-- ── Een speler stuurt een score in ──
begin; set local role anon;
do $$ declare d jsonb; begin
  perform public.tournament_submit_score('OPEN01', '12', 21, 11, null, null, 'Anna');
  perform public.tournament_submit_score('OPEN01', '12', 20, 12, null, null, 'Anna');
  select data into d from public.tournaments where code = 'OPEN01';
  if jsonb_array_length(d->'courtPending') <> 1 or (d->'courtPending'->0->>'sa')::int <> 20 then
    raise exception 'gezakt: courtPending is %', d->'courtPending'; end if;
  if d->'courtPending'->0->>'playerName' <> 'Anna' then raise exception 'gezakt: naam ontbreekt'; end if;
  if d->>'playerScoring' <> 'true' or d->'courtTokens'->>'1' <> 'baan1sleutel' then
    raise exception 'gezakt: de rest van het toernooi is veranderd'; end if;
  raise notice 'ok: een speler stuurt een score in; een tweede keer vervangt de eerste';
end $$;
do $$ begin
  perform public.tournament_submit_score('DICHT1', '1', 21, 11, null, null, 'Anna');
  raise exception 'gezakt: insturen kan ook als spelers geen scores mogen invoeren';
exception when insufficient_privilege then raise notice 'ok: zonder "spelers voeren scores in" kan het niet';
end $$;
do $$ begin
  perform public.tournament_submit_score('DICHT1', '1', 21, 11, 2, 'baan2sleutel', null);
  raise notice 'ok: met de sleutel van een baanlink kan het wel';
end $$;
do $$ begin
  perform public.tournament_submit_score('DICHT1', '1', 21, 11, 2, 'fout', null);
  raise exception 'gezakt: een verkeerde baansleutel werkt';
exception when insufficient_privilege then raise notice 'ok: een verkeerde baansleutel niet';
end $$;
do $$ begin
  perform public.tournament_submit_score('OPEN01', '1', -1, 1000, null, null, null);
  raise exception 'gezakt: een onzinnige score wordt geaccepteerd';
exception when invalid_parameter_value then raise notice 'ok: een onzinnige score wordt geweigerd';
end $$;
do $$ declare n int; begin
  for i in 1..230 loop perform public.tournament_submit_score('OPEN01', to_jsonb(i), 1, 1, null, null, null); end loop;
  select jsonb_array_length(data->'courtPending') into n from public.tournaments where code = 'OPEN01';
  if n <> 200 then raise exception 'gezakt: courtPending heeft % inzendingen', n; end if;
  raise notice 'ok: hooguit 200 inzendingen, de oudste vallen eraf';
end $$;
commit;

-- ── Beheerder van een competitie? ──
begin; set local role anon;
do $$ begin
  if public.competition_owner_token('LADDER', array['iets','geheim-ladder']) <> 'geheim-ladder' then
    raise exception 'gezakt: de eigen sleutel wordt niet herkend'; end if;
  if public.competition_owner_token('LADDER', array['fout']) is not null then
    raise exception 'gezakt: een verkeerde sleutel geeft iets terug'; end if;
  if public.competition_owner_token('LADDER', '{}') is not null then
    raise exception 'gezakt: zonder sleutels komt er iets terug'; end if;
  raise notice 'ok: competition_owner_token kent alleen een sleutel die je al hebt';
end $$;
commit;

do $$ begin raise notice 'ALLE BEVEILIGINGSCONTROLES GESLAAGD'; end $$;
