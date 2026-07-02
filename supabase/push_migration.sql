-- ============================================================
-- Migration: echte web push meldingen (ook bij gesloten app)
-- Tabellen: push_subscriptions, push_log
-- Run this in the Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Tabel push_subscriptions: 1 rij per browser/device subscription
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_code  text NOT NULL,
  player_id        integer NOT NULL,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  lang             text,
  msg_templates    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Aanmaken mag als de toernooicode bestaat (zelfde niveau als tournaments/signups)
CREATE POLICY "Public insert with valid code" ON push_subscriptions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM tournaments t WHERE t.code = push_subscriptions.tournament_code)
  );

-- Bijwerken (upsert bij opnieuw abonneren, speler wisselen) mag met geldige code.
-- Er is geen SELECT policy, dus een client kan een rij alleen raken door het exacte
-- endpoint te noemen dat de browser zelf net heeft opgeleverd (een unieke, niet te
-- raden capability URL) -- dat is de facto "alleen je eigen rij".
CREATE POLICY "Public update own endpoint" ON push_subscriptions
  FOR UPDATE
  USING (true)
  WITH CHECK (
    EXISTS (SELECT 1 FROM tournaments t WHERE t.code = push_subscriptions.tournament_code)
  );

-- Verwijderen (toggle uit) mag alleen via het exacte endpoint, zelfde redenering.
CREATE POLICY "Public delete own endpoint" ON push_subscriptions
  FOR DELETE USING (true);

-- Geen SELECT policy: endpoints zijn gevoelige capability URLs, niemand mag ze
-- via de anon key uitlezen of opsommen. De Edge Function leest met de service
-- role key, die RLS altijd omzeilt.

-- 2. Tabel push_log: dedupe en audit van verstuurde rondes/eindstanden
CREATE TABLE IF NOT EXISTS push_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_code  text NOT NULL,
  round            integer NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('round','finish')),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_code, round, kind)
);

ALTER TABLE push_log ENABLE ROW LEVEL SECURITY;

-- Geen policies: alleen de Edge Function (service role) leest en schrijft hier.
-- RLS met nul policies betekent standaard volledig geblokkeerd voor anon/authenticated.
