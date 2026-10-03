# Optioneel account: inloggen met Google of een mailcode

Wat het doet: wie inlogt, neemt alles wat de app van de organisator bewaart
mee naar een ander toestel, en is het niet kwijt als de browsergegevens
gewist worden. Dat zijn:

| Wat | Lokaal in | Soort in `account_items` |
|---|---|---|
| Opgeslagen groepen | `padel_groups` | `group` (per groep) |
| Eigen competities (ELO) | `padel_competitions` | `comp` (per competitie) |
| Beheersleutels van clubcompetities | `padel-cc-token` + `padel-cc-tokens` | `cc` (per sleutel) |
| Inschrijving met wachtlijst | `padel-signup-code/-token` | `signup` |
| Lopend toernooi + deellink en beheersleutel | `padel-state`, `padel-share-code`, `padel-session-token` | `live` |

Inloggen is nooit verplicht. Zonder account werkt alles zoals het werkte.

## Aanzetten: in deze volgorde

De app staat nu met `ACCOUNT_LIVE=false` in `app/index.html`. Niemand ziet
het, behalve wie `?account=preview` achter de url zet (en `?account=off` om
het weer uit te zetten). Zo kun je het op het echte domein proberen voordat
iedereen het ziet.

1. **SQL draaien.** `supabase/account_migration.sql` in de SQL Editor.
   Veilig om opnieuw te draaien.
2. **Redirect-url's toestaan.** Authentication → URL Configuration →
   Redirect URLs: `https://padel-bracket.com/app/` (en eventueel
   `https://padel-bracket.com/**`). Staat de url er niet in, dan stuurt
   Supabase je na het inloggen naar de Site URL in plaats van terug naar de
   app.
3. **Google aanzetten.** Authentication → Sign In / Providers → Google, met
   een client-ID en -secret uit Google Cloud Console (OAuth-client van het
   type "Web application", met als redirect-URI de callback-url die Supabase
   op die pagina toont). Zet in het OAuth-toestemmingsscherm de app-naam
   "Padel Bracket" en het logo, anders ziet de speler de projectcode van
   Supabase.
4. **Mailsjabloon met code.** Authentication → Email Templates → Magic Link:
   zet er `{{ .Token }}` in, bijvoorbeeld *"Je inlogcode is {{ .Token }}. Of
   tik op deze link: …"*. Zonder code in de mail kan iemand die de app op zijn
   iPhone heeft geïnstalleerd niet inloggen met zijn mail: de link opent in
   Safari, niet in de app.
5. **Eigen mailserver (aanbevolen).** Authentication → SMTP Settings. De
   ingebouwde mailer van Supabase stuurt maar een paar mails per uur en is
   niet voor productie bedoeld. Google is de hoofdweg, dus het hoeft niet op
   dag één, maar zonder eigen SMTP houdt inloggen met je mail bij de derde of
   vierde gebruiker per uur op ("te veel mails, probeer het later").
6. **Proberen** met `https://padel-bracket.com/app/?account=preview`: met
   Google én met een mailcode inloggen, een groep opslaan, op een tweede
   toestel inloggen en kijken of de groep er staat.
7. **Aanzetten:** `ACCOUNT_LIVE=true` in `app/index.html` en `APP_VERSION`
   ophogen.

Anoniem inloggen en "Manual linking" zijn **niet** nodig (zie hieronder
waarom).

## Wat er is overgenomen van Predict the Race, en wat niet

Overgenomen:

- **`ACCT_RETURN` bovenin vastleggen.** supabase-js wisselt een `?code=` in en
  ruimt hem op zodra er een client is. Daarna is niet meer te zien dat
  iemand net inlogde.
- **Geen parameters in de terugkeer-url.** Supabase plakt er zijn eigen
  `?code=` achter. Kwam je van een clubcompetitie (`?comp=`), dan onthoudt
  `sessionStorage` dat en gaat de app er na het inloggen naartoe terug.
- **Eén client met een sessie.** Alle andere Supabase-clients in de app staan
  op `persistSession:false` en `detectSessionInUrl:false` (`_sbClient`).
  Anders pakt de eerste client die toevallig gemaakt wordt de `?code=` af,
  zonder de sleutel om hem in te wisselen. Live toernooien, inschrijvingen en
  clubcompetities praten dus nog steeds als `anon` met Supabase, precies zoals
  voorheen.
- **Lui.** Een paginaweergave maakt geen auth-client aan. Die komt pas als je
  ooit inlogde of net terugkomt van een inloglink.
- **Google groot met het echte logo, mail eronder.** Het logo staat inline:
  een plaatje van Google zou bij elke weergave je IP-adres naar Google sturen.
- **Foutmeldingen in gewone taal**, en zeggen wanneer het niet aan jou ligt
  (Google staat uit, migratie niet gedraaid).
- **Eén keer gevraagd.** Op een moment dat er iets te verliezen valt: een
  afgelopen toernooi, een nieuwe clubcompetitie of inschrijving. Daarna nooit
  meer (`padel-acct-asked`). "Nu niet" is even groot als inloggen.
- **Twee tikken** voor uitloggen en verwijderen, geen `confirm()`.
- **Verwijderen via een databasefunctie** (`delete_my_account`, security
  definer). De service_role key hoort nooit in de app.
- **Expliciete grants.** Supabase geeft elke nieuwe tabel aan `anon` en
  `authenticated`; de migratie draait dat terug voor `anon`.
- **SQL-tests met nagebootste auth** tegen een echte PostgreSQL 16.

Bewust anders:

- **Geen anonieme accounts.** Predict the Race had ze nodig omdat spelers in
  de database aan iemand moesten hangen. Hier staat alles lokaal, en komt het
  account pas als iemand zelf inlogt. Gevolg: geen accounts voor crawlers, en
  **uitloggen is altijd veilig**, want wat in je account staat krijg je terug.
  Daarom ook geen "Manual linking" nodig.
- **Een code uit de mail naast de link.** Een geïnstalleerde app op een
  iPhone krijgt een maillink nooit te zien. De code typen werkt overal.
- **`shouldCreateUser: true`** bij de mail: er is geen bestaand account om een
  adres aan te hangen; inloggen met je mail ís hoe je een account krijgt.
- **Een toernooi van een ander toestel wordt aangeboden, nooit stil
  overgenomen.** Ook niet als het nieuwer is: je zou een lopend toernooi op dit
  toestel kwijt kunnen raken.

## Hoe het synchroniseren werkt

Per ding één rij in `account_items`. `account_sync(p_items)` schrijft wat het
toestel meestuurt, maar alleen waar het nieuwer is dan wat er staat, en geeft
alles van het account terug. Eén rondje per synchronisatie.

Of iets lokaal veranderd is, ziet de app aan een vingerafdruk per rij in
`padel-acct-meta`. Daardoor hoeft een plek die opslaat alleen `acctSchedule()`
aan te roepen. Verdwijnt iets lokaal, dan wordt het een grafsteen
(`deleted=true`); anders komt een weggegooide groep terug van je andere
toestel. Beheersleutels en de inschrijving krijgen nooit een grafsteen: je
beheer kwijtraken is erger dan een sleutel te veel bewaren.

Clubcompetities: elk toestel had zijn eigen beheersleutel (`padel-cc-token`).
Met een account komen die van je andere toestellen erbij (`padel-cc-tokens`),
en `ccIsOwner` en `ccGetWrite` kijken naar alle bekende sleutels.

## Testen

```sh
# SQL tegen een lege PostgreSQL 16 (17 controles)
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh

# Browser, twee toestellen, tegen een nagebootste Supabase (53 controles)
node scripts/test-account.mjs
```

`scripts/fake-supabase.js` vervangt supabase-js in de browsertest. De sessie
staat daarin, net als bij supabase-js, in `localStorage`, dus een nieuwe
browsercontext is echt een ander toestel. PKCE wordt nagedaan, zodat "een
maillink in een andere browser werkt niet" ook echt getest wordt.

## Wat nog openstaat (los van het account)

De beheersleutels (`session_token`) van `tournaments`, `competitions` en
`signup_events` zijn voor iedereen leesbaar: de leespolicy staat op
`using (true)` voor alle kolommen, en de app leest de sleutel zelf ook terug
(spelers die scores invoeren, `ccIsOwner`). Wie de anon key uit de broncode
haalt, kan daarmee elk toernooi of elke competitie wijzigen. Dichtzetten
vraagt om `security definer`-functies voor het lezen zonder sleutel en voor
het invoeren van scores door spelers. Dat is een aparte wijziging, net als
"Fase 0" bij Predict the Race.
