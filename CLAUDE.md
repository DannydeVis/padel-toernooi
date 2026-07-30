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
