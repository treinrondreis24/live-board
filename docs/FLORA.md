# FloRA in Seinhuis

FloRA is beschikbaar onder `/seinhuis/flora/`, uitsluitend voor de bestaande Seinhuis-eigenaar. De eigen tabel `flora_state` gebruikt dezelfde PostgreSQL-database (lokaal SQLite), valt buiten de bewaartermijn voor treingegevens en bewaart boekingen, bewijs, imports, beoordelingen, regelversies en opgeloste meldingen. Gelijktijdige wijzigingen worden met een revisienummer beschermd.

## Sanity koppelen

1. Open https://www.sanity.io/manage en kies **Treinreiziger rondreizen**, project `il9cyh3m`.
2. Ga naar **Settings → API → Tokens → Add new token**. Geef de token de naam **FloRA lezen** en de rol **Viewer**. Gebruik geen Editor-token.
3. Open de Railway-service die `treinbord.up.railway.app` bedient. Voeg bij Variables toe: `FLORA_SANITY_READ_TOKEN` met de geheime waarde. Niet in GitHub, de chat of een clientbestand opslaan.
4. Deploy de gewijzigde variabelen. Open Seinhuis → FloRA → **Sanity inlezen**. De datum van de geslaagde synchronisatie verschijnt bovenin.

Project `il9cyh3m` en dataset `production` zijn de standaard. Optionele overrides: `FLORA_SANITY_PROJECT`, `FLORA_SANITY_DATASET`. `FLORA_PUBLIC_ORIGIN` is standaard `https://treinbord.up.railway.app` en moet bij een ander domein expliciet worden ingesteld.

De server-adapter kent uitsluitend GET-queryverzoeken. Dit vervangt geen Viewer-rechten op de token zelf. Hij vraagt bewust de ruwe documenten op en geeft concepten voorrang boven gepubliceerde versies, inclusief alleen als concept bestaande boekingen. Geen geboortedata, adressen, betaallinks of bedragen worden ingelezen. Alleen de aanwezigheid van een betaallink wordt als ja/nee vastgelegd. De automatische controle draait woensdag om 06:00 in Europe/Amsterdam, met zomer- en wintertijd. Een mislukte controle behoudt het voortgangspunt en probeert na een uur opnieuw. Een gemiste woensdag wordt na herstart ingehaald. Bij eerste installatie begint de planning vanaf de volgende woensdag. De knop Extra controle uitvoeren leest ook eerst actuele Sanity-gegevens in.

## Bewijs en imports

Deze eerste implementatie verwerkt gecontroleerde CSV/JSON-reserveringsgegevens. Een voorbeeld met kolomnamen is vanuit FloRA te downloaden. De gebruiker moet de import eerst bekijken en daarna opslaan. Het bronbestand zelf wordt niet opgeslagen; de bronverwijzing, inhoud en importgeschiedenis wel. Originele leveranciers-PDF's en STC-bestanden hebben nog geen automatische vertaler. De zelfstandige Gmail/OAuth-koppeling is beschikbaar; e-mailinterpretatie is nog niet gebouwd; de Gmail-verbinding van een chat is niet beschikbaar voor een Railway-server.

Identiteit van bewijs: provider + referentie + reisnummer + todoKey. Herhaalde import werkt deze reservering bij; een annulering met dezelfde identiteit vervangt de bevestiging. Voor een vervangen reservering met een nieuw nummer moet ook de oude annulering worden geïmporteerd. Dezelfde group op verschillende kamerreserveringen verklaart meerdere kamers alleen als het totale aantal geboekte personen aansluit. Een notitie alleen onderdrukt nooit een mogelijke dubbele reservering.

`productMatch=true` is een expliciete menselijke bevestiging dat hotel/traject overeenkomt of een toegestaan alternatief is (bijvoorbeeld zelfde stad met notitie). Het systeem raadt dit niet op basis van één plaatsnaam. Dit geldt ook voor verklaarde RITAM-wijzigingen; zet geen `roomMismatch` op een verklaarde wijziging. Heenreis nachttrein: `direction=outbound`, `originCountry=NL`; terugreis `direction=inbound` (Wien Meidling toegestaan). De geboekte capaciteit en bezetting blijven altijd afzonderlijke controles.

## Beoordelingen en beperkingen

Alarmen kunnen met reden als aandachtspunt of gecontroleerd worden beoordeeld. Oorspronkelijke ernst en geschiedenis blijven behouden. Een materiële wijziging van bewijs, reizigers, todo of ernst laat de automatische beoordeling opnieuw gelden. Opgeloste meldingen worden gearchiveerd.

Een groene boeking heeft gekoppeld actief bewijs voor elke overnachting en geen open meldingen. Dit zegt niets over toekomstige controles op Interrail, betaaltransacties of andere treinreserveringen. De hotelbevestigingsregel bij een aangemaakte betaallink is gekoppeld aan `count(payments[defined(checkoutUrl)]) > 0`; beide manieren van afvinken gelden als bevestigd. Dit is geverifieerd met boeking 6656. De wekelijkse wacht-op-klantcontrole begint wanneer een gekoppelde bevestiging voor het eerst in FloRA wordt gevonden, niet op de datum van een oudere e-mail. Een wekelijkse of handmatige run gebruikt het laatste geslaagde voortgangspunt. Nieuwe en inhoudelijk gewijzigde boekingen en bewijsstukken worden geselecteerd, naast open alarmen, ontbrekende bevestigingen, niet-afgevinkte hotels en wacht-op-klantreserveringen. Ongewijzigde naamafwijkingen en overige statische aandachtspunten behouden hun eerdere controledatum, ook als een ander alarm bij dezelfde boeking wordt herhaald. De historie bewaart het venster en de selectie-aantallen. Een extra run verschuift het gezamenlijke voortgangspunt, maar slaat de volgende woensdagrun niet over. De huidige selectie betreft Sanity en reeds geïmporteerd bewijs; er is nog geen zelfstandig e-mailvoortgangspunt.

## Verificatie

`node --test flora.test.mjs` test de beslisregels, conceptvoorrang, wijzigingen, opslagconflicten, CSV-validatie, alleen-lezen adapter en toegangscontrole. `node test-flora-browser.mjs` test beoordeling, filtering, import, groene boeking en regelwijziging in Chromium. Testgegevens zijn fictief. Gebruik `PLAYWRIGHT_BROWSERS_PATH` voor de geïnstalleerde browserlocatie en `FLORA_SCREENSHOT` voor de testafbeelding.

`node --test flora-followup.test.mjs` verifieert de woensdaggrens, zomer/wintertijd, voortgangspunten, gerichte hercontroles, gemiste runs en herproberen na fouten.


## Gmail verbinden
Stel FLORA_GOOGLE_CLIENT_ID en FLORA_GOOGLE_CLIENT_SECRET in op de live-board Railway-service. Registreer https://treinbord.up.railway.app/seinhuis/flora/google/callback als redirect URI. Klik in FloRA op Gmail koppelen en autoriseer reservations@treinrondreis.nl met uitsluitend gmail.readonly. De callback controleert de werkelijke mailbox via Gmail getProfile. Een verbindingstest gebruikt een nieuw access token via het opgeslagen refresh token. Google-tokens blijven server-side; het refresh token is AES-256-GCM-versleuteld in de aparte flora_google-tabel, met een sleutel afgeleid van het client secret. Bij secretrotatie opnieuw koppelen. OAuth-state is eenmalig, tien minuten geldig, aan de beheersessie gebonden, met PKCE. Dezelfde database bewaart de verbinding na herstarts. De browser krijgt alleen configuratie-/verbindingsstatus en het tijdstip van de laatste verbindingstest. Deze release leest nog geen berichten of bijlagen en voert geen automatische e-mailinterpretatie uit.
