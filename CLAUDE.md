# padel-toernooi

## Workflow
- Push direct naar `main`, geen pull requests nodig
- Bump altijd `APP_VERSION` in `app/index.html` (regel 847) bij elke wijziging

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
- Service worker: `app/sw.js` — bump `CACHE` versie bij grote wijzigingen
