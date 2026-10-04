-- Controles op read_policy_migration.sql (na security_migration.sql en
-- security.test.sql, dus met de rijen die die test achterliet).
\set ON_ERROR_STOP on

create or replace function pg_temp.hdr(code text, tok text default null) returns void language sql as $$
  select set_config('request.headers', json_strip_nulls(json_build_object('x-padel-code', code, 'x-session-token', tok))::text, true)
$$;

update public.signup_events set signup_open = true where code = 'SIGN01';

-- ── Zonder code: niets te zien ──
begin; set local role anon;
do $$ declare n int; begin
  select count(*) into n from public.tournaments;        if n <> 0 then raise exception 'gezakt: zonder code % toernooien te zien', n; end if;
  select count(*) into n from public.competitions;       if n <> 0 then raise exception 'gezakt: zonder code % competities te zien', n; end if;
  select count(*) into n from public.ladder_players;     if n <> 0 then raise exception 'gezakt: zonder code % ladderspelers te zien', n; end if;
  select count(*) into n from public.ladder_challenges;  if n <> 0 then raise exception 'gezakt: zonder code uitdagingen te zien'; end if;
  select count(*) into n from public.competition_events; if n <> 0 then raise exception 'gezakt: zonder code avonden te zien'; end if;
  select count(*) into n from public.signup_events;      if n <> 0 then raise exception 'gezakt: zonder code inschrijvingen te zien'; end if;
  select count(*) into n from public.signups;            if n <> 0 then raise exception 'gezakt: zonder code aanmeldingen te zien'; end if;
  raise notice 'ok: zonder code zijn alle zeven tabellen leeg (niet leeg te vissen)';
end $$;
commit;

-- ── Met een code: precies die ──
begin; set local role anon;
select pg_temp.hdr('open01');
do $$ declare n int; begin
  select count(*) into n from public.tournaments;
  if n <> 1 then raise exception 'gezakt: met code OPEN01 % toernooien', n; end if;
  if (select code from public.tournaments) <> 'OPEN01' then raise exception 'gezakt: verkeerd toernooi'; end if;
  raise notice 'ok: met de code (ook in kleine letters) zie je precies dat toernooi';
end $$;
commit;

begin; set local role anon;
select pg_temp.hdr('LADDER');
do $$ declare n int; begin
  select count(*) into n from public.competitions;   if n <> 1 then raise exception 'gezakt: competitie niet te zien'; end if;
  select count(*) into n from public.ladder_players; if n < 2 then raise exception 'gezakt: ladder niet te zien (%)', n; end if;
  select count(*) into n from public.tournaments;    if n <> 0 then raise exception 'gezakt: met een competitiecode zie je toernooien'; end if;
  insert into public.ladder_players (competition_code, name, position) values ('LADDER', 'Fien', 9);
  insert into public.ladder_challenges (competition_code, challenger_name, defender_name, reported_winner) values ('LADDER', 'Fien', 'Bob', 'Fien');
  raise notice 'ok: met de competitiecode zie je de ladder, en kun je je aanmelden en uitdagen';
end $$;
commit;

begin; set local role anon;
select pg_temp.hdr('LADDER', 'geheim-ladder');
do $$ begin
  update public.ladder_players set position = 1 where name = 'Fien';
  if not found then raise exception 'gezakt: de organisator kan de ladder niet bijwerken'; end if;
  update public.ladder_challenges set status = 'approved' where challenger_name = 'Fien';
  if not found then raise exception 'gezakt: de organisator kan een uitdaging niet goedkeuren'; end if;
  raise notice 'ok: de organisator beheert de ladder (code en sleutel mee)';
end $$;
commit;

begin; set local role anon;
select pg_temp.hdr('SIGN01');
do $$ declare n int; begin
  select count(*) into n from public.signup_events where code = 'SIGN01'; if n <> 1 then raise exception 'gezakt: inschrijving niet te zien'; end if;
  insert into public.signups (tournament_code, name, status) values ('SIGN01', 'Gijs', 'confirmed');
  select count(*) into n from public.signups where name = 'Gijs'; if n <> 1 then raise exception 'gezakt: eigen aanmelding niet te zien'; end if;
  raise notice 'ok: met de code zie je de inschrijving en kun je je aanmelden';
end $$;
commit;

begin; set local role anon;
select pg_temp.hdr('SIGN01', 'geheim-inschrijving');
do $$ begin
  update public.signups set status = 'waitlist' where name = 'Gijs';
  if not found then raise exception 'gezakt: de organisator kan de wachtlijst niet beheren'; end if;
  delete from public.signups where name = 'Gijs';
  if not found then raise exception 'gezakt: de organisator kan een aanmelding niet weghalen'; end if;
  raise notice 'ok: de organisator beheert de wachtlijst (code en sleutel mee)';
end $$;
commit;

-- De functies zien alles, ook zonder code in de header
begin; set local role anon;
do $$ begin
  perform public.tournament_submit_score('OPEN01', '99', 3, 4, null, null, 'Hans');
  if not public.tournament_save('OPEN01', '{"playerScoring":true}', 'geheim-toernooi-1') then raise exception 'gezakt: tournament_save'; end if;
  if public.competition_owner_token('LADDER', array['geheim-ladder']) is null then raise exception 'gezakt: competition_owner_token'; end if;
  raise notice 'ok: insturen, bewaren en de beheerderscheck werken nog';
end $$;
commit;

do $$ begin raise notice 'ALLE LEESCONTROLES GESLAAGD'; end $$;
