-- ============================================================
-- Migration: voeg client_id toe aan tournament_starts
-- Koppelt een gestart toernooi aan zijn speelduur in de tabel
-- tournament_durations. Wordt gezet door trackStart() in
-- app/index.html met een client-side gegenereerde UUID.
--
-- LET OP: deze kolom is destijds direct in het Supabase dashboard
-- toegevoegd, niet via dit bestand. Achter IF NOT EXISTS, dus dit
-- bestand draaien op de bestaande database verandert niets.
--
-- Run in Supabase Dashboard -> SQL Editor
-- ============================================================

-- Bewust nullable: rijen van voordat deze kolom bestond hebben geen
-- client_id en dus geen gekoppelde speelduur. Het admin dashboard
-- toont die als "Niet afgerond".
ALTER TABLE tournament_starts ADD COLUMN IF NOT EXISTS client_id text;

-- Het admin dashboard haalt de laatste toernooien op gesorteerd op datum.
CREATE INDEX IF NOT EXISTS tournament_starts_created_at_idx
  ON tournament_starts (created_at DESC);
