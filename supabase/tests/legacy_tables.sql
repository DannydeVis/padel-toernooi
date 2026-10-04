-- De tabellen van vóór de migratiebestanden in deze map (in Supabase met de
-- hand aangemaakt), met de kolommen zoals ze in productie staan.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create table if not exists public.tournaments (
  id bigint generated always as identity primary key,
  code text unique not null,
  data jsonb,
  updated_at timestamptz default now()
);
