-- Testgereedschap, hoort NIET in Supabase: daar bestaat dit al.
--
-- Supabase levert het schema `auth` mee (de tabel met accounts en auth.uid()).
-- Kale PostgreSQL heeft dat niet, dus zonder dit bestand draait
-- account_migration.sql lokaal niet eens. auth.uid() leest, net als bij
-- Supabase, de `sub` uit de JWT-claims die PostgREST per verzoek zet:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>"}';
--
-- Zonder claims is auth.uid() null: een bezoeker die niet ingelogd is.
-- (Overgenomen van de aanpak in Predict the Race, test/auth-nabootsing.sql.)

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase geeft alles wat in public wordt aangemaakt meteen aan anon en
-- authenticated. Zonder deze regels zou de testdatabase strenger zijn dan de
-- echte, en zou een vergeten revoke in de migratie hier niet opvallen.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
