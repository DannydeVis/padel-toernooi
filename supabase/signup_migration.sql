-- ============================================================
-- Migration: zelf-inschrijving met wachtlijst
-- Tabellen: signup_events, signups
-- Run this in the Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Tabel signup_events: instellingen van een inschrijvingslink
CREATE TABLE IF NOT EXISTS signup_events (
  code          text PRIMARY KEY,
  session_token text NOT NULL,
  event_name    text,
  event_date    text,
  location      text,
  format        text NOT NULL,
  max_players   int NOT NULL,
  signup_open   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE signup_events ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (inschrijfpagina + live lijst)
CREATE POLICY "Public read" ON signup_events
  FOR SELECT USING (true);

-- Aanmaken mag als er een session_token wordt meegestuurd
CREATE POLICY "Public insert" ON signup_events
  FOR INSERT WITH CHECK (session_token IS NOT NULL);

-- Wijzigen (sluiten, max_players etc.) alleen door de eigenaar
CREATE POLICY "Owner update" ON signup_events
  FOR UPDATE
  USING (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  )
  WITH CHECK (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  );

-- Geen DELETE policy = standaard geblokkeerd

-- 2. Tabel signups: individuele aanmeldingen
CREATE TABLE IF NOT EXISTS signups (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_code  text NOT NULL REFERENCES signup_events(code),
  name             text NOT NULL,
  gender           text,
  status           text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlist')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE signups ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (deelnemerslijst + tellers)
CREATE POLICY "Public read" ON signups
  FOR SELECT USING (true);

-- Aanmelden mag als de code een open inschrijving heeft, met een
-- server-side spamlimiet: max 300 aanmeldingen per code totaal en
-- max 20 aanmeldingen per code binnen 2 minuten.
CREATE POLICY "Public insert" ON signups
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM signup_events se
      WHERE se.code = signups.tournament_code AND se.signup_open
    )
    AND (
      SELECT count(*) FROM signups s2
      WHERE s2.tournament_code = signups.tournament_code
    ) < 300
    AND (
      SELECT count(*) FROM signups s3
      WHERE s3.tournament_code = signups.tournament_code
        AND s3.created_at > now() - interval '2 minutes'
    ) < 20
  );

-- Status wijzigen (bv. wachtlijst -> bevestigd) alleen door de organisator
CREATE POLICY "Owner update" ON signups
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM signup_events se
      WHERE se.code = signups.tournament_code
        AND se.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM signup_events se
      WHERE se.code = signups.tournament_code
        AND se.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );

-- Verwijderen alleen door de organisator
CREATE POLICY "Owner delete" ON signups
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM signup_events se
      WHERE se.code = signups.tournament_code
        AND se.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );
