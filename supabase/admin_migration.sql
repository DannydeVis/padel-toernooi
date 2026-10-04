-- ============================================================
-- Migration: beheerpagina (/admin/) zonder service_role key
--
-- Tot nu toe plakte je de service_role key in /admin/. Die sleutel mag
-- álles in de database, en stond daarna in de localStorage van de browser.
-- Nu log je in met Google of een mailcode (hetzelfde account als in de app),
-- en bepaalt de database of je beheerder bent. De service_role key hoeft
-- nergens meer in een browser.
--
-- Vereist: account_migration.sql (voor account_items).
-- Run in Supabase Dashboard -> SQL Editor. Veilig om opnieuw te draaien.
-- Overgenomen van Predict the Race (beheer_adres / ik_ben_beheerder).
-- ============================================================

-- ── Wie is beheerder ────────────────────────────────────────
-- Het beheeradres, plus eventuele extra beheerders in site_admins. Alleen
-- als het adres bevestigd is: wie voor dit adres een inloglink aanvraagt,
-- komt er niet in, want die link komt in de mailbox van de eigenaar.
create or replace function public.admin_address()
returns text language sql immutable set search_path = ''
as $$ select 'devisser.danny@gmail.com'::text $$;

create table if not exists public.site_admins (
  email text primary key check (email = lower(email))
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
       and (lower(u.email) = public.admin_address()
            or lower(u.email) in (select s.email from public.site_admins s))
  )
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Elke beheerfunctie begint hiermee. 42501 = geen toegang.
create or replace function public.admin_gate()
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end $$;
revoke all on function public.admin_gate() from public, anon, authenticated;

-- Dagen tellen in Nederlandse tijd, niet in UTC: "vandaag" begint om
-- middernacht in Amsterdam.
create or replace function public.admin_day(ts timestamptz)
returns date language sql immutable set search_path = ''
as $$ select (ts at time zone 'Europe/Amsterdam')::date $$;
revoke all on function public.admin_day(timestamptz) from public, anon, authenticated;

-- ── Het overzicht: wat de oude pagina liet zien, plus accounts ─
-- Eén aanroep, één JSON. Toernooien onder de 5 minuten tellen als test,
-- boven de 10 uur als vergeten (zelfde grenzen als de oude pagina).
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.admin_day(now());
  out jsonb;
begin
  perform public.admin_gate();

  with dur as (
    select duration_seconds / 60.0 as m from public.tournament_durations
     where duration_seconds >= 0 and duration_seconds < 600 * 60
  ), recent as (
    select s.mode, s.player_count, s.created_at,
           (select d.duration_seconds from public.tournament_durations d
             where d.client_id = s.client_id order by d.created_at desc limit 1) as seconds
      from public.tournament_starts s
     order by s.created_at desc limit 50
  ), days as (
    select generate_series(today - 13, today, interval '1 day')::date as day
  ), adays as (
    select generate_series(today - 29, today, interval '1 day')::date as day
  ), accts as (
    select u.created_at,
           coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) as providers
      from auth.users u
  )
  select jsonb_build_object(
    'starts_total', (select count(*) from public.tournament_starts),
    'starts_today', (select count(*) from public.tournament_starts where public.admin_day(created_at) = today),
    'starts_week',  (select count(*) from public.tournament_starts where public.admin_day(created_at) > today - 7),
    'shared_total', (select count(*) from public.tournaments),
    'dur_avg_min',  (select round(avg(m)) from dur where m >= 5),
    'dur_real',     (select count(*) from dur where m >= 5),
    'dur_test',     (select count(*) from dur where m < 5),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
                 'mode', mode, 'players', player_count, 'when', created_at, 'seconds', seconds)
                 order by created_at desc) from recent), '[]'::jsonb),
    'modes', coalesce((select jsonb_object_agg(mode, n) from
                 (select mode, count(*) n from public.tournament_starts group by mode) x), '{}'::jsonb),
    'daily', (select jsonb_agg(jsonb_build_object('day', d.day,
                 'n', (select count(*) from public.tournament_starts s where public.admin_day(s.created_at) = d.day))
                 order by d.day) from days d),
    'players', coalesce((select jsonb_object_agg(player_count, n) from
                 (select player_count, count(*) n from public.tournament_starts
                   where player_count is not null group by player_count) x), '{}'::jsonb),
    'mode_avg', coalesce((select jsonb_object_agg(mode, a) from
                 (select mode, round(avg(player_count), 1) a from public.tournament_starts
                   where player_count is not null group by mode) x), '{}'::jsonb),
    'accounts_total', (select count(*) from accts),
    'accounts_today', (select count(*) from accts where public.admin_day(created_at) = today),
    'accounts_week',  (select count(*) from accts where public.admin_day(created_at) > today - 7),
    'accounts_google', (select count(*) from accts where providers ? 'google'),
    'accounts_mail',   (select count(*) from accts where providers ? 'email'),
    'accounts_daily', (select jsonb_agg(jsonb_build_object('day', d.day,
                 'n', (select count(*) from accts a where public.admin_day(a.created_at) = d.day))
                 order by d.day) from adays d)
  ) into out;
  return out;
end $$;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

-- ── De accounts zelf: wie is er nieuw, en gebruikt hij het? ──
-- Wat er in account_items staat, alleen als aantallen: het beheer hoeft de
-- groepen en toernooien van iemand niet te kunnen lezen om te zien of hij
-- de app gebruikt.
create or replace function public.admin_accounts()
returns table (
  id uuid, email text, providers text[], created_at timestamptz,
  last_sign_in_at timestamptz, groups int, comps int,
  has_live boolean, has_cc boolean, has_signup boolean, last_sync timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.admin_gate();
  return query
  select u.id, u.email::text,
         coalesce(array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')), '{}'::text[]),
         u.created_at, u.last_sign_in_at,
         (select count(*)::int from public.account_items a where a.user_id = u.id and a.kind = 'group' and not a.deleted),
         (select count(*)::int from public.account_items a where a.user_id = u.id and a.kind = 'comp' and not a.deleted),
         exists (select 1 from public.account_items a where a.user_id = u.id and a.kind = 'live' and not a.deleted),
         exists (select 1 from public.account_items a where a.user_id = u.id and a.kind = 'cc'),
         exists (select 1 from public.account_items a where a.user_id = u.id and a.kind = 'signup'),
         (select to_timestamp(max(a.updated_at) / 1000.0) from public.account_items a where a.user_id = u.id)
    from auth.users u
   order by u.created_at desc
   limit 500;
end $$;
revoke all on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;
