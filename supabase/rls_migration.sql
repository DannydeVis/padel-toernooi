-- ============================================================
-- RLS Migration: padel-bracket.com / tournaments table
-- Run this in the Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Voeg session_token kolom toe
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS session_token TEXT;

-- 2. Bestaande rijen krijgen een willekeurig token
--    (zodat ze niet meer bijgewerkt kunnen worden door willekeurige gebruikers)
UPDATE tournaments
SET session_token = encode(gen_random_bytes(16), 'hex')
WHERE session_token IS NULL;

-- 3. Activeer Row Level Security
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

-- 4. SELECT: iedereen mag lezen (live-view functionaliteit)
CREATE POLICY "Public read" ON tournaments
  FOR SELECT USING (true);

-- 5. INSERT: mag alleen als session_token aanwezig is
--    (aanmaker stuurt token mee in payload én als header)
CREATE POLICY "Public insert" ON tournaments
  FOR INSERT WITH CHECK (session_token IS NOT NULL);

-- 6. UPDATE: alleen als x-session-token header overeenkomt met opgeslagen token
--    PostgREST stelt request.headers beschikbaar als JSON-GUC
CREATE POLICY "Owner update" ON tournaments
  FOR UPDATE
  USING (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  )
  WITH CHECK (
    session_token = current_setting('request.headers', true)::json->>'x-session-token'
  );

-- 7. DELETE: geen policy = standaard geblokkeerd door RLS
--    (toernooigegevens kunnen niet verwijderd worden via de app)
