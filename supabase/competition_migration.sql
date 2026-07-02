-- ============================================================
-- Migration: clubcompetitie (avondencompetitie) en ladder
-- Tabellen: competitions, competition_events, ladder_players, ladder_challenges
-- Run this in the Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Tabel competitions: 1 rij per club-competitie (serie of ladder)
CREATE TABLE IF NOT EXISTS competitions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text UNIQUE NOT NULL,
  session_token text NOT NULL,
  name          text NOT NULL,
  club_name     text,
  type          text NOT NULL CHECK (type IN ('series','ladder')),
  settings      jsonb NOT NULL DEFAULT '{}',
  aliases       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (leaderboard + ladder pagina)
CREATE POLICY "Public read" ON competitions
  FOR SELECT USING (true);

-- Aanmaken mag als er een session_token wordt meegestuurd
CREATE POLICY "Public insert" ON competitions
  FOR INSERT WITH CHECK (session_token IS NOT NULL);

-- Wijzigen (instellingen, aliases) alleen door de organisator
CREATE POLICY "Owner update" ON competitions
  FOR UPDATE
  USING (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  )
  WITH CHECK (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  );

-- Geen DELETE policy = standaard geblokkeerd

-- 2. Tabel competition_events: momentopname van 1 toernooiavond in een serie-competitie
CREATE TABLE IF NOT EXISTS competition_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competition_code  text NOT NULL REFERENCES competitions(code),
  tournament_code   text,
  played_at         timestamptz NOT NULL DEFAULT now(),
  format            text,
  results           jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competition_events ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (leaderboard + per-avond uitklap)
CREATE POLICY "Public read" ON competition_events
  FOR SELECT USING (true);

-- Toevoegen mag als de competitiecode bestaat (zelfde niveau als signups)
CREATE POLICY "Public insert with valid code" ON competition_events
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM competitions c WHERE c.code = competition_events.competition_code)
  );

-- Verwijderen alleen door de organisator van de competitie
CREATE POLICY "Owner delete" ON competition_events
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = competition_events.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );

-- 3. Tabel ladder_players: spelers op de ladder, met hun huidige positie
CREATE TABLE IF NOT EXISTS ladder_players (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competition_code  text NOT NULL REFERENCES competitions(code),
  name              text NOT NULL,
  position          integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ladder_players ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (ladderstand)
CREATE POLICY "Public read" ON ladder_players
  FOR SELECT USING (true);

-- Zelf aanmelden mag met een server-side spamlimiet: max 300 spelers per
-- ladder totaal en max 20 aanmeldingen per ladder binnen 2 minuten.
CREATE POLICY "Public insert" ON ladder_players
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM competitions c WHERE c.code = ladder_players.competition_code AND c.type = 'ladder')
    AND (
      SELECT count(*) FROM ladder_players lp2
      WHERE lp2.competition_code = ladder_players.competition_code
    ) < 300
    AND (
      SELECT count(*) FROM ladder_players lp3
      WHERE lp3.competition_code = ladder_players.competition_code
        AND lp3.created_at > now() - interval '2 minutes'
    ) < 20
  );

-- Positie bijwerken (na goedkeuren van een challenge) alleen door de organisator
CREATE POLICY "Owner update" ON ladder_players
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = ladder_players.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = ladder_players.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );

-- Verwijderen (speler van de ladder halen) alleen door de organisator
CREATE POLICY "Owner delete" ON ladder_players
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = ladder_players.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );

-- 4. Tabel ladder_challenges: uitdagingen, in afwachting van organisator-goedkeuring
CREATE TABLE IF NOT EXISTS ladder_challenges (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competition_code  text NOT NULL REFERENCES competitions(code),
  challenger_name   text NOT NULL,
  defender_name     text NOT NULL,
  score             text,
  reported_winner   text NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  approved_at       timestamptz
);

ALTER TABLE ladder_challenges ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (geschiedenis van gespeelde challenges)
CREATE POLICY "Public read" ON ladder_challenges
  FOR SELECT USING (true);

-- Uitslag melden mag via de share link, met een spamlimiet van max 20
-- meldingen per ladder binnen 2 minuten.
CREATE POLICY "Public insert" ON ladder_challenges
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM competitions c WHERE c.code = ladder_challenges.competition_code AND c.type = 'ladder')
    AND (
      SELECT count(*) FROM ladder_challenges lc2
      WHERE lc2.competition_code = ladder_challenges.competition_code
        AND lc2.created_at > now() - interval '2 minutes'
    ) < 20
  );

-- Goedkeuren/afwijzen alleen door de organisator
CREATE POLICY "Owner update" ON ladder_challenges
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = ladder_challenges.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.code = ladder_challenges.competition_code
        AND c.session_token = current_setting('request.headers', true)::json->>'x-session-token'
    )
  );

-- Geen DELETE policy op ladder_challenges = geschiedenis blijft altijd bewaard
