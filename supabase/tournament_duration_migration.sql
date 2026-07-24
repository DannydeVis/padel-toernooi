-- ============================================================
-- VEROUDERD - NIET MEER DRAAIEN
--
-- Deze aanpak (ended_at op tournament_starts) is vervangen door de
-- losse tabel tournament_durations, zie tournament_durations.sql en
-- trackEnd() in app/index.html. De kolom hieronder wordt nergens meer
-- geschreven of gelezen, en de "anon end" policy geeft schrijfrecht
-- dat nergens meer voor nodig is.
--
-- Draai in plaats hiervan tournament_ended_at_cleanup.sql, dat dit
-- weer opruimt. Dit bestand blijft staan als historie.
-- ============================================================

-- ============================================================
-- Migration: voeg ended_at toe aan tournament_starts
-- Maakt berekening van gemiddelde speelduur mogelijk.
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE tournament_starts ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- Anon-gebruikers mogen ended_at instellen (was NULL) — alleen analytics
CREATE POLICY "anon end" ON tournament_starts
  FOR UPDATE TO anon
  USING (ended_at IS NULL)
  WITH CHECK (ended_at IS NOT NULL);
