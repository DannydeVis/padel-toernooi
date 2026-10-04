-- ============================================================
-- Migration: beheersleutels onleesbaar (het lek dicht)
--
-- Het lek: de leespolicies op tournaments, competitions en signup_events
-- staan op using (true) voor álle kolommen, ook session_token. Met de anon
-- key uit de broncode kon iedereen dus de beheersleutel van elk toernooi,
-- elke clubcompetitie en elke inschrijving uitlezen, en daarmee alles
-- wijzigen of weggooien wat die sleutel mag.
--
-- De oplossing, in twee delen:
-- 1. session_token is niet meer te lezen (kolomrechten). Al het andere wel,
--    zodat live meekijken, inschrijven en de ladder blijven werken.
--    Schrijven met de sleutel blijft zoals het was: wie hem heeft (de
--    organisator, in zijn eigen browser of account), mag.
-- 2. De plekken waar de app de sleutel wél las, krijgen een functie:
--    - tournament_save: de organisator bewaart zijn gedeelde toernooi (zie
--      daar waarom een gewone upsert niet meer kan).
--    - tournament_submit_score: spelers sturen een score in. Die komt alleen
--      in de lijst "ingestuurd door spelers" (courtPending); de organisator
--      keurt hem goed. Vroeger las de speler daarvoor de sleutel en schreef
--      hij het hele toernooi terug.
--    - competition_owner_token: is deze browser beheerder van deze
--      competitie? De app gaf daarvoor de sleutel mee naar elke bezoeker.
--
-- Volgorde: eerst de app (v2.14.0 of nieuwer), dan dit bestand. De app kan
-- met en zonder deze migratie werken.
--
-- Run in Supabase Dashboard -> SQL Editor. Veilig om opnieuw te draaien.
-- ============================================================

-- ── 1. session_token niet meer leesbaar ─────────────────────
-- Per tabel: lezen intrekken, en daarna lezen teruggeven op elke kolom
-- behalve session_token. Kolommen die er later bij komen, krijgen
-- automatisch leesrecht als dit bestand opnieuw gedraaid wordt.
do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['tournaments','competitions','signup_events'] loop
    continue when to_regclass('public.' || t) is null;
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name <> 'session_token';
    execute format('revoke select on public.%I from public, anon, authenticated', t);
    execute format('grant select (%s) on public.%I to anon, authenticated', cols, t);
  end loop;
end $$;

-- ── 1b. Policies die de sleutel van een andere tabel lazen ───
-- De ladder, de competitieavonden en de inschrijvingen controleerden de
-- organisator met EXISTS (select ... from competitions/signup_events where
-- session_token = header). Die subquery draait met de rechten van de
-- bezoeker, en die mag session_token nu niet meer lezen: zonder dit deel kon
-- geen organisator zijn ladder of wachtlijst meer beheren.
-- Nu vraagt de policy het aan een functie die alleen ja of nee zegt.
create or replace function public.comp_token_ok(p_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.competitions c
                  where c.code = p_code
                    and c.session_token = current_setting('request.headers', true)::json ->> 'x-session-token')
$$;
create or replace function public.signup_token_ok(p_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.signup_events se
                  where se.code = p_code
                    and se.session_token = current_setting('request.headers', true)::json ->> 'x-session-token')
$$;
revoke all on function public.comp_token_ok(text) from public;
revoke all on function public.signup_token_ok(text) from public;
grant execute on function public.comp_token_ok(text) to anon, authenticated;
grant execute on function public.signup_token_ok(text) to anon, authenticated;

do $$ begin
  if to_regclass('public.competition_events') is not null then
    drop policy if exists "Owner delete" on public.competition_events;
    create policy "Owner delete" on public.competition_events
      for delete using (public.comp_token_ok(competition_code));
  end if;
  if to_regclass('public.ladder_players') is not null then
    drop policy if exists "Owner update" on public.ladder_players;
    drop policy if exists "Owner delete" on public.ladder_players;
    create policy "Owner update" on public.ladder_players
      for update using (public.comp_token_ok(competition_code)) with check (public.comp_token_ok(competition_code));
    create policy "Owner delete" on public.ladder_players
      for delete using (public.comp_token_ok(competition_code));
  end if;
  if to_regclass('public.ladder_challenges') is not null then
    drop policy if exists "Owner update" on public.ladder_challenges;
    create policy "Owner update" on public.ladder_challenges
      for update using (public.comp_token_ok(competition_code)) with check (public.comp_token_ok(competition_code));
  end if;
  if to_regclass('public.signups') is not null then
    drop policy if exists "Owner update" on public.signups;
    drop policy if exists "Owner delete" on public.signups;
    create policy "Owner update" on public.signups
      for update using (public.signup_token_ok(tournament_code)) with check (public.signup_token_ok(tournament_code));
    create policy "Owner delete" on public.signups
      for delete using (public.signup_token_ok(tournament_code));
  end if;
end $$;

-- Staat er in deze database nog een policy (met een andere naam dan in de
-- migratiebestanden) die de sleutel van een andere tabel leest? Dan breekt
-- die nu, en dat moet je weten.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename not in ('tournaments', 'competitions', 'signup_events')
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%session_token%'
  loop
    raise warning 'Let op: policy "%" op % leest nog session_token van een andere tabel en werkt nu niet meer', r.policyname, r.tablename;
  end loop;
end $$;

-- ── 2. De organisator bewaart zijn toernooi ─────────────────
-- De app bewaarde met een upsert (insert ... on conflict do update). Met
-- RLS vraagt PostgreSQL daarvoor leesrecht op de kolommen die de policy
-- controleert, dus op session_token, en dat is precies wat hierboven dicht
-- gaat. Een gewone update kan nog wel, maar dan moet de app eerst weten of
-- het toernooi al bestaat. Deze functie doet het in één keer: bijwerken als
-- de sleutel klopt, aanmaken als de code nog vrij is, en anders weigeren.
create or replace function public.tournament_save(p_code text, p_data jsonb, p_token text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_code is null or p_code !~ '^[A-Z0-9]{4,12}$' or p_token is null or char_length(p_token) < 16 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.tournaments set data = p_data, updated_at = now()
   where code = p_code and session_token = p_token;
  if found then return true; end if;
  insert into public.tournaments (code, data, updated_at, session_token)
  values (p_code, p_data, now(), p_token)
  on conflict (code) do nothing;
  if found then return true; end if;
  raise exception 'not_owner' using errcode = '42501';
end $$;
revoke all on function public.tournament_save(text, jsonb, text) from public;
grant execute on function public.tournament_save(text, jsonb, text) to anon, authenticated;

-- ── 2a. Een score insturen als speler ───────────────────────
-- Mag alleen als de organisator "Spelers voeren scores in" aanzette
-- (data.playerScoring), of met de sleutel van een baanlink
-- (data.courtTokens[baan]). Raakt niets anders dan courtPending.
create or replace function public.tournament_submit_score(
  p_code text, p_match_id jsonb, p_sa int, p_sb int,
  p_court int default null, p_court_token text default null, p_player text default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  d jsonb;
  pending jsonb;
  allowed boolean;
begin
  if p_sa is null or p_sb is null or p_sa < 0 or p_sb < 0 or p_sa > 999 or p_sb > 999 then
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  if p_match_id is null or jsonb_typeof(p_match_id) not in ('number', 'string')
     or char_length(p_match_id::text) > 64 then
    raise exception 'invalid_match' using errcode = '22023';
  end if;

  select data into d from public.tournaments where code = p_code for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  d := coalesce(d, '{}'::jsonb);

  allowed := coalesce((d ->> 'playerScoring')::boolean, false)
          or (p_court is not null and p_court_token is not null
              and d -> 'courtTokens' ->> p_court::text = p_court_token);
  if not allowed then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into pending
    from jsonb_array_elements(coalesce(d -> 'courtPending', '[]'::jsonb)) e
   where e -> 'matchId' is distinct from p_match_id;
  pending := pending || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'matchId', p_match_id, 'court', p_court, 'sa', p_sa, 'sb', p_sb,
    'at', to_jsonb(now()), 'playerName', left(p_player, 80))));
  -- Een plafond, zodat niemand het toernooi kan opblazen met inzendingen
  if jsonb_array_length(pending) > 200 then
    select jsonb_agg(e order by i) into pending
      from jsonb_array_elements(pending) with ordinality as x(e, i)
     where i > jsonb_array_length(pending) - 200;
  end if;

  update public.tournaments
     set data = jsonb_set(d, '{courtPending}', pending), updated_at = now()
   where code = p_code;
  return true;
end $$;
revoke all on function public.tournament_submit_score(text, jsonb, int, int, int, text, text) from public;
grant execute on function public.tournament_submit_score(text, jsonb, int, int, int, text, text) to anon, authenticated;

-- ── 2b. Ben ik beheerder van deze competitie? ───────────────
-- Geeft de sleutel terug die deze browser al kent, als die past. Een
-- sleutel die je niet al hebt, komt er nooit uit.
create or replace function public.competition_owner_token(p_code text, p_tokens text[])
returns text
language sql stable security definer set search_path = public
as $$
  select c.session_token from public.competitions c
   where c.code = p_code
     and c.session_token = any (p_tokens[1:20])
   limit 1
$$;
revoke all on function public.competition_owner_token(text, text[]) from public;
grant execute on function public.competition_owner_token(text, text[]) to anon, authenticated;
