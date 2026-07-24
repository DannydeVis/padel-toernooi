-- ============================================================
-- Cleanup: verwijder de ongebruikte ended_at-opzet
--
-- tournament_duration_migration.sql voegde ooit een ended_at-kolom plus
-- een "anon end" UPDATE-policy toe aan tournament_starts. Die aanpak is
-- vervangen door de losse tabel tournament_durations, zie trackEnd() in
-- app/index.html. De kolom wordt sindsdien nergens meer geschreven of
-- gelezen, maar het schrijfrecht staat nog wel aan.
--
-- Waarom dat weg moet: de policy laat iedereen met de publieke anon key
-- (die staat gewoon in de JavaScript van de site) rijen in
-- tournament_starts wijzigen zolang ended_at NULL is. Omdat niets die
-- kolom ooit vult, geldt dat voor elke rij. RLS begrenst rijen, niet
-- kolommen, dus in dezelfde update kunnen ook mode en player_count
-- overschreven worden. Lezen en verwijderen kan anon niet, dus het
-- risico is vervuilde statistiek, geen datalek of dataverlies.
--
-- Idempotent. De kolom gaat er alleen af als hij aantoonbaar leeg is.
-- Run in Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Het overbodige schrijfrecht intrekken. Dit is de eigenlijke opruiming.
DROP POLICY IF EXISTS "anon end" ON tournament_starts;

-- 2. De ongebruikte kolom opruimen, maar alleen als er geen enkele waarde
--    in staat. Zo kan dit script nooit data weggooien, ook niet als er
--    ooit buiten de app om toch iets in gezet is.
DO $$
DECLARE gevuld bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tournament_starts'
      AND column_name  = 'ended_at'
  ) THEN
    RAISE NOTICE 'ended_at bestaat niet (meer), niets te doen.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM tournament_starts WHERE ended_at IS NOT NULL' INTO gevuld;

  IF gevuld = 0 THEN
    ALTER TABLE tournament_starts DROP COLUMN ended_at;
    RAISE NOTICE 'ended_at verwijderd (kolom was leeg).';
  ELSE
    RAISE NOTICE 'ended_at NIET verwijderd: % rij(en) hebben een waarde. Bekijk die data eerst.', gevuld;
  END IF;
END $$;
