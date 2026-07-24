-- ============================================================
-- Tabel: tournament_durations
-- Bewaart de speelduur van een afgerond toernooi. De app schrijft hier
-- een rij weg via trackEnd() in app/index.html, gekoppeld aan een
-- gestart toernooi via tournament_starts.client_id.
--
-- LET OP: deze tabel is destijds direct in het Supabase dashboard
-- aangemaakt, niet via dit bestand. De definitie hieronder is
-- gereconstrueerd uit de app- en admin-code en kan in details afwijken
-- van de live tabel. Alles staat achter IF NOT EXISTS, dus dit bestand
-- draaien op de bestaande database verandert niets.
--
-- Run in Supabase Dashboard -> SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS tournament_durations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id        text NOT NULL,   -- verwijst naar tournament_starts.client_id
  duration_seconds int  NOT NULL,   -- verschil in seconden, zie trackEnd()
  created_at       timestamptz DEFAULT now() NOT NULL
);

-- RLS: de app (anon key) mag alleen inserten. Lezen kan alleen met de
-- service_role key vanuit het admin dashboard, die RLS automatisch bypast.
ALTER TABLE tournament_durations ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY kent geen IF NOT EXISTS, dus expliciet checken. Zo laten
-- we een eventueel al bestaande policy ongemoeid in plaats van te droppen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'tournament_durations'
      AND policyname = 'anon insert'
  ) THEN
    CREATE POLICY "anon insert" ON tournament_durations
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

-- Het admin dashboard zoekt speelduren op met .in('client_id', [...]).
CREATE INDEX IF NOT EXISTS tournament_durations_client_id_idx
  ON tournament_durations (client_id);
