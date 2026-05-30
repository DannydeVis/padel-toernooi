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
