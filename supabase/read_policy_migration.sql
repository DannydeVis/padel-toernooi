-- ============================================================
-- Migration: alleen lezen met de code erbij
--
-- Na security_migration.sql waren de beheersleutels dicht, maar de rest
-- stond nog open: met de anon key uit de broncode kon iedereen in één keer
-- álle toernooien, competities, ladders en inschrijvingen downloaden, met
-- alle namen en scores.
--
-- Nu: wie de code heeft, ziet alles van die code; wie de code niet heeft,
-- ziet niets. Dezelfde grens als bij Predict the Race. De app stuurt de
-- code mee in de header x-padel-code (sbFor() in app/index.html), dus voor
-- wie een link of code heeft verandert er niets.
--
-- Volgorde: eerst de app (v2.15.0 of nieuwer), dan dit bestand.
-- Run in Supabase Dashboard -> SQL Editor. Veilig om opnieuw te draaien.
-- ============================================================

-- De code waar dit verzoek over gaat (hoofdletters, net als de codes zelf)
create or replace function public.req_code()
returns text language sql stable set search_path = ''
as $$ select upper(nullif(current_setting('request.headers', true)::json ->> 'x-padel-code', '')) $$;
grant execute on function public.req_code() to anon, authenticated;

do $$ begin
  if to_regclass('public.tournaments') is not null then
    drop policy if exists "Public read" on public.tournaments;
    drop policy if exists "Read with code" on public.tournaments;
    create policy "Read with code" on public.tournaments for select using (code = public.req_code());
  end if;
  if to_regclass('public.competitions') is not null then
    drop policy if exists "Public read" on public.competitions;
    drop policy if exists "Read with code" on public.competitions;
    create policy "Read with code" on public.competitions for select using (code = public.req_code());
  end if;
  if to_regclass('public.competition_events') is not null then
    drop policy if exists "Public read" on public.competition_events;
    drop policy if exists "Read with code" on public.competition_events;
    create policy "Read with code" on public.competition_events for select using (competition_code = public.req_code());
  end if;
  if to_regclass('public.ladder_players') is not null then
    drop policy if exists "Public read" on public.ladder_players;
    drop policy if exists "Read with code" on public.ladder_players;
    create policy "Read with code" on public.ladder_players for select using (competition_code = public.req_code());
  end if;
  if to_regclass('public.ladder_challenges') is not null then
    drop policy if exists "Public read" on public.ladder_challenges;
    drop policy if exists "Read with code" on public.ladder_challenges;
    create policy "Read with code" on public.ladder_challenges for select using (competition_code = public.req_code());
  end if;
  if to_regclass('public.signup_events') is not null then
    drop policy if exists "Public read" on public.signup_events;
    drop policy if exists "Read with code" on public.signup_events;
    create policy "Read with code" on public.signup_events for select using (code = public.req_code());
  end if;
  if to_regclass('public.signups') is not null then
    drop policy if exists "Public read" on public.signups;
    drop policy if exists "Read with code" on public.signups;
    create policy "Read with code" on public.signups for select using (tournament_code = public.req_code());
  end if;
end $$;

-- Staat er nog een andere leespolicy die alles openzet? Policies tellen bij
-- elkaar op, dus dan is de tabel nog steeds leeg te vissen.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('tournaments','competitions','competition_events','ladder_players','ladder_challenges','signup_events','signups')
              and cmd in ('SELECT', 'ALL')
              and policyname <> 'Read with code'
  loop
    raise warning 'Let op: policy "%" op % laat mogelijk nog alles lezen', r.policyname, r.tablename;
  end loop;
end $$;
