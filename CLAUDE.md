# padel-toernooi

## Workflow
- Push direct naar `main`, geen pull requests nodig
- Bump altijd `APP_VERSION` in `app/index.html` bij elke release
- `APP_VERSION` is de enige bron van waarheid voor de versie. De service worker
  krijgt die mee via `sw.js?v=` en leidt zijn cachenaam daaruit af. Zet de
  cachenaam in `app/sw.js` dus **nooit met de hand**, en bump alleen `APP_VERSION`.

## Versienummering
`vNr.Feature.Bugfix` — bijv. `v1.18.1`

| Type             | Voorbeeld      | Wanneer                        |
|------------------|----------------|--------------------------------|
| Grote wijziging  | v2.0.0         | Redesign, nieuwe modus, breuk  |
| Feature toevoeging | v1.19.0      | Nieuwe functionaliteit         |
| Bug fix          | v1.18.2        | Correctie van bestaand gedrag  |

## Stack
- Single-file app: `app/index.html`
- Hosting: GitHub Pages (automatisch via `.github/workflows/deploy.yml`)
- Backend: Supabase (live sharing via tabel `tournaments`)
- Service worker: `app/sw.js`, cachenaam wordt afgeleid van `APP_VERSION`

## Account (optioneel)
- Inloggen met Google of een mailcode; synchroniseert groepen, competities,
  beheersleutels en het lopende toernooi. Achtergrond en dashboardstappen:
  `supabase/ACCOUNT.md`.
- Staat live sinds v2.13.0 (`ACCOUNT_LIVE=true` in `app/index.html`); de
  stappen uit ACCOUNT.md zijn gedaan.
- Nieuwe Supabase-clients altijd via `_sbClient()`, nooit rechtstreeks
  `createClient`: alleen `acctSB()` mag een sessie hebben en de `?code=` van
  een inloglink lezen.
- Lokaal iets nieuws bewaren dat mee moet naar andere toestellen? Voeg het toe
  aan `_acctLocalItems()`/`_acctApply()` en roep na het opslaan `acctSchedule()` aan.
- Beheer: `/admin/` logt in met hetzelfde account; `is_admin()` in
  `supabase/admin_migration.sql` beslist. Nooit meer de service_role key in de browser.
- Beheersleutels (`session_token`) zijn niet leesbaar (`supabase/security_migration.sql`):
  nooit `select('*')` of `session_token` op `tournaments`, `competitions` of
  `signup_events`; gebruik de kolomlijsten (`SU_COLS`, `CC_COLS`) en de functies
  `tournament_save`, `tournament_submit_score`, `competition_owner_token`.
- Tests: `node scripts/test-account.mjs`, `node scripts/test-admin.mjs` en `node scripts/test-security.mjs`
  (browser, nagebootste Supabase) en `supabase/tests/run.sh` (SQL tegen PostgreSQL 16).
