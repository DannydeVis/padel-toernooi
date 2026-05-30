-- ============================================================
-- Tabel: tournament_starts
-- Bijhoudt elk gestart toernooi (ook niet-gedeelde).
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS tournament_starts (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode      text    NOT NULL,          -- 'team' | 'roundrobin' | 'americano' | 'mexicano'
  player_count int,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- RLS: iedereen mag inserteren (app), niemand mag lezen via anon key
ALTER TABLE tournament_starts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon insert" ON tournament_starts
  FOR INSERT TO anon WITH CHECK (true);

-- SELECT is alleen toegestaan via service_role key (admin dashboard)
-- Geen SELECT policy nodig — service_role bypast RLS automatisch
