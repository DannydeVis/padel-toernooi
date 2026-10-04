-- Controles op admin_migration.sql. Draai met supabase/tests/run.sh.
\set ON_ERROR_STOP on

-- Schone lei: de accounttest hiervoor liet accounts achter
delete from auth.users;

-- De tabellen die de app al had (alleen de kolommen die het beheer leest)
create table if not exists public.tournament_starts (id bigint generated always as identity primary key,
  mode text not null, player_count int, client_id text, created_at timestamptz not null default now());
create table if not exists public.tournament_durations (id bigint generated always as identity primary key,
  client_id text not null, duration_seconds int not null, created_at timestamptz not null default now());
create table if not exists public.tournaments (code text primary key, data jsonb);
alter table public.tournament_starts enable row level security;
alter table public.tournament_durations enable row level security;
alter table public.tournaments enable row level security;

insert into public.tournament_starts (mode, player_count, client_id, created_at) values
  ('americano', 8, 'c1', now()), ('americano', 12, 'c2', now() - interval '2 days'),
  ('mexicano', 8, 'c3', now() - interval '20 days'), ('team', null, null, now());
insert into public.tournament_durations (client_id, duration_seconds) values ('c1', 5400), ('c2', 120);
insert into public.tournaments values ('ABC123', '{}');

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'DevIsser.Danny@gmail.com', now(), '{"providers":["google"]}', now() - interval '40 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'devisser.danny@gmail.com.nep.nl', now(), '{"providers":["email"]}', now()),
  ('00000000-0000-0000-0000-0000000000e1', 'nieuw@example.com', now(), '{"providers":["email"]}', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'kaper@example.com', null, '{"providers":["email"]}', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000e3', 'hulp@example.com', now(), '{"providers":["google","email"]}', now() - interval '3 days');

-- Een tweede account met precies het beheeradres maar onbevestigd. (Kan in
-- Supabase niet echt naast het eerste bestaan, maar de regel moet ook dan kloppen.)
insert into auth.users (id, email, email_confirmed_at, created_at) values
  ('00000000-0000-0000-0000-0000000000d3', 'devisser.danny@gmail.com', null, now());

insert into public.account_items (user_id, kind, item_key, data, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'group', 'g1', '{}', 1700000000000),
  ('00000000-0000-0000-0000-0000000000e1', 'group', 'g2', null, 1700000000001),
  ('00000000-0000-0000-0000-0000000000e1', 'live', 'current', '{}', 1700000000002),
  ('00000000-0000-0000-0000-0000000000e1', 'cc', 'tok', '{}', 1700000000003);
update public.account_items set deleted = true where item_key = 'g2';

-- ── Wie is beheerder ──
create or replace function pg_temp.als(uid text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  return public.is_admin();
end $$;

begin; set local role authenticated;
do $$ begin
  if not pg_temp.als('00000000-0000-0000-0000-0000000000d1') then raise exception 'gezakt: het bevestigde beheeradres (andere hoofdletters) is geen beheerder'; end if;
  raise notice 'ok: het bevestigde beheeradres is beheerder, hoofdletters maken niet uit';
  if pg_temp.als('00000000-0000-0000-0000-0000000000d3') then raise exception 'gezakt: het onbevestigde beheeradres is beheerder'; end if;
  raise notice 'ok: hetzelfde adres onbevestigd is geen beheerder';
  if pg_temp.als('00000000-0000-0000-0000-0000000000d2') then raise exception 'gezakt: een adres dat met het beheeradres begint is beheerder'; end if;
  raise notice 'ok: een adres dat er alleen op lijkt is geen beheerder';
  if pg_temp.als('00000000-0000-0000-0000-0000000000e1') then raise exception 'gezakt: een gewoon account is beheerder'; end if;
  raise notice 'ok: een gewoon account is geen beheerder';
end $$;
commit;

insert into public.site_admins values ('hulp@example.com'), ('kaper@example.com');
begin; set local role authenticated;
do $$ begin
  if not pg_temp.als('00000000-0000-0000-0000-0000000000e3') then raise exception 'gezakt: een extra beheerder uit site_admins komt er niet in'; end if;
  raise notice 'ok: een extra beheerder uit site_admins is beheerder';
  if pg_temp.als('00000000-0000-0000-0000-0000000000e2') then raise exception 'gezakt: een onbevestigde extra beheerder is beheerder'; end if;
  raise notice 'ok: ook in site_admins telt alleen een bevestigd adres';
end $$;
commit;

-- ── Geen beheerder: niets ──
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
do $$ begin
  perform public.admin_dashboard();
  raise exception 'gezakt: een gewoon account kan admin_dashboard aanroepen';
exception when insufficient_privilege then raise notice 'ok: admin_dashboard weigert een gewoon account';
end $$;
do $$ begin
  perform * from public.admin_accounts();
  raise exception 'gezakt: een gewoon account kan admin_accounts aanroepen';
exception when insufficient_privilege then raise notice 'ok: admin_accounts weigert een gewoon account';
end $$;
do $$ begin
  perform 1 from public.site_admins;
  raise exception 'gezakt: een gewoon account kan site_admins lezen';
exception when insufficient_privilege then raise notice 'ok: site_admins is dicht';
end $$;
do $$ begin
  insert into public.site_admins values ('nieuw@example.com');
  raise exception 'gezakt: een gewoon account kan zichzelf beheerder maken';
exception when insufficient_privilege then raise notice 'ok: zelf beheerder worden kan niet';
end $$;
commit;

begin; set local role anon;
do $$ begin
  perform public.admin_dashboard();
  raise exception 'gezakt: anon kan admin_dashboard aanroepen';
exception when insufficient_privilege then raise notice 'ok: anon kan admin_dashboard niet aanroepen';
end $$;
do $$ begin
  perform public.is_admin();
  raise exception 'gezakt: anon kan is_admin aanroepen';
exception when insufficient_privilege then raise notice 'ok: anon kan is_admin niet aanroepen';
end $$;
commit;

-- ── Beheerder: de cijfers kloppen ──
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
do $$ declare d jsonb; begin
  d := public.admin_dashboard();
  if (d->>'starts_total')::int <> 4 then raise exception 'gezakt: starts_total %', d->>'starts_total'; end if;
  if (d->>'starts_today')::int <> 2 then raise exception 'gezakt: starts_today %', d->>'starts_today'; end if;
  if (d->>'starts_week')::int <> 3 then raise exception 'gezakt: starts_week %', d->>'starts_week'; end if;
  if (d->>'shared_total')::int <> 1 then raise exception 'gezakt: shared_total'; end if;
  if (d->>'dur_avg_min')::int <> 90 or (d->>'dur_real')::int <> 1 or (d->>'dur_test')::int <> 1 then raise exception 'gezakt: speelduur %', d; end if;
  if (d->'modes'->>'americano')::int <> 2 then raise exception 'gezakt: modes'; end if;
  if jsonb_array_length(d->'daily') <> 14 then raise exception 'gezakt: daily heeft % dagen', jsonb_array_length(d->'daily'); end if;
  if (d->'daily'->13->>'n')::int <> 2 then raise exception 'gezakt: vandaag in daily is %', d->'daily'->13; end if;
  if jsonb_array_length(d->'recent') <> 4 or (d->'recent'->0->>'seconds') is null then raise exception 'gezakt: recent %', d->'recent'; end if;
  if (d->'players'->>'8')::int <> 2 then raise exception 'gezakt: players'; end if;
  if (d->>'accounts_total')::int <> 6 then raise exception 'gezakt: accounts_total %', d->>'accounts_total'; end if;
  if (d->>'accounts_week')::int <> 5 then raise exception 'gezakt: accounts_week %', d->>'accounts_week'; end if;
  if (d->>'accounts_google')::int <> 2 then raise exception 'gezakt: accounts_google %', d->>'accounts_google'; end if;
  if jsonb_array_length(d->'accounts_daily') <> 30 then raise exception 'gezakt: accounts_daily'; end if;
  raise notice 'ok: admin_dashboard geeft de cijfers die erin horen';
end $$;
do $$ declare r record; n int; begin
  select count(*) into n from public.admin_accounts();
  if n <> 6 then raise exception 'gezakt: admin_accounts geeft % accounts', n; end if;
  select * into r from public.admin_accounts() where email = 'nieuw@example.com';
  if r.groups <> 1 or not r.has_live or not r.has_cc or r.has_signup or r.last_sync is null then
    raise exception 'gezakt: wat er bij nieuw@example.com staat klopt niet: %', r; end if;
  if r.providers <> array['email'] then raise exception 'gezakt: providers %', r.providers; end if;
  select * into r from public.admin_accounts() limit 1;
  if r.created_at < now() - interval '1 minute' then raise exception 'gezakt: nieuwste account staat niet bovenaan'; end if;
  raise notice 'ok: admin_accounts: nieuwste eerst, met wat iemand gebruikt (grafstenen tellen niet mee)';
end $$;
commit;

do $$ begin raise notice 'ALLE BEHEERCONTROLES GESLAAGD'; end $$;
