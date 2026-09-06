# Treinrondreis Live Board v2.0 – online opslag

Deze versie bouwt voort op v1.8 en is voorbereid voor Railway + PostgreSQL.

Nieuw:

- PostgreSQL als `DATABASE_URL` aanwezig is.
- Lokale SQLite-fallback als `DATABASE_URL` ontbreekt.
- DB-observaties worden per scanpunt centraal opgeslagen, niet alleen de uiteindelijk gekozen bordregel.
- 30-minutentrend vergelijkt dezelfde trein + hetzelfde scanpunt + aankomst/vertrek.
- Nieuwe API: `/api/history`.
- Nieuwe API: `/api/station/<station>`.
- Nieuwe API: `/api/storage`.
- Geheimen zijn uit het distributiepakket verwijderd; gebruik `.env` lokaal en Railway Variables online.

Zie **RAILWAY-STAPPEN.md** voor de online installatie.

---

# Treinrondreis vertrekbord v1.1 — DB + ITALIA

## Schermwissel

- 10 seconden internationaal / DB
- 10 seconden ITALIA
- daarna automatisch opnieuw

## DB-scherm

Behoudt de bestaande geselecteerde stations en treinnummers.

Kolommen:
Tijd | Trein | Van | Naar | Scanpunt | Status

Logica:
- trend ↑ / ↓ op basis van ongeveer 30 minuten historie
- pijl alleen bij verschil van minstens 3 minuten
- vertraging >30 minuten rood
- geannuleerd: hele regel rood

## ITALIA-scherm

Zwart/geel, geïnspireerd op Italiaanse stationsborden.

Kolommen:
Ora | Treno | Da | A | Binario | Stato

Geselecteerde treinen:

Milano Centrale — aankomst:
- ECE/trein 151
- 2821
- 2823
- 666

Milano Centrale — vertrek:
- 665
- 673
- 685
- 9631
- 9633
- 9539
- 2832

Roma Termini:
- 8508
- 8509

Voor Roma wordt vertrektijd gebruikt als die halte een vertrek heeft; anders aankomst.

## Italiaanse databron

De test gebruikt ViaggiaTreno-endpoints. Dit is een ongedocumenteerde technische
interface achter de publieke Trenitalia/ViaggiaTreno-dienst. De code probeert
de rit eerst op treinnummer te vinden en haalt vervolgens de volledige rit op.

Als ViaggiaTreno spoorinformatie levert, wordt eerst het actuele spoor getoond,
anders het geplande spoor.

## Scannen

Italia gebruikt hetzelfde dagschema als DB:
- 00:00–06:00 elke 60 min
- 06:00–08:00 elke 5 min
- 08:00–21:00 elke 3 min
- 21:00–24:00 elke 10 min

De Italiaanse calls tellen niet mee voor de DB Timetables-limiet.

## Eerste test

1. Sluit de vorige vertrekbord-server.
2. Pak de ZIP volledig uit.
3. Start `start-windows.bat`.
4. Open http://localhost:8787

Controle:
- DB: http://localhost:8787/api/trains
- Italië: http://localhost:8787/api/italy
- Alles: http://localhost:8787/api/health

Let op: de bestaande `.env` met de DB-testgegevens is meegekopieerd.
Houd deze map/ZIP privé.


## v1.2 — Italiaanse pagina's

Automatische schermrotatie:

1. Internationaal / DB — 10 sec
2. Milano Centrale · Partenze — 10 sec
3. Milano Centrale · Arrivi — 10 sec
4. Roma Termini · Partenze — 10 sec
5. daarna terug naar DB

Roma 8508 en 8509 zijn nu expliciet als vertrek ingesteld.

Elke Italiaanse pagina gebruikt:
Ora | Treno | Da | A | Binario | Stato


## v1.3 — Milano gesplitst scherm

Schermrotatie is nu:

1. Internationaal / DB — 10 sec
2. ITALIA · Milano Centrale — 10 sec
   - linkerkant: Partenze
   - rechterkant: Arrivi
3. ITALIA · Roma Termini · Partenze — 10 sec
4. daarna terug naar DB

Op het Milano-scherm is de layout bewust compacter:
- Partenze toont: Ora | Treno | A | Bin. | Stato
- Arrivi toont: Ora | Treno | Da | Bin. | Stato

Zo passen departures en arrivals tegelijk leesbaar op één scherm.


## v1.4 — Rome layout fix

Hersteld:
- Roma had 4 visuele secties maar slechts 3 CSS-gridrijen.
- Roma gebruikt nu correct:
  header | kolomkoppen | treinregels | footer
- Milano split blijft:
  header | split departures/arrivals | footer

Dit lost de grote lege ruimte en de treinregel onderaan op.


## v1.5 — extra DB-scanpunten

Toegevoegd:

### Arnhem Centraal
Monitort:
402, 403, 225, 224, 122, 421, 420, 40421, 40490, 124,
141, 143, 145, 146, 142, 140

De laatste zes zijn dezelfde treinreeks als Bad Bentheim.

### Deventer
Monitort dezelfde treinreeks als Bad Bentheim:
141, 143, 145, 146, 142, 140

### Wien Hbf
Aankomst:
40421, 66, 146

Vertrek:
40490, 19929, 1031, 143, 61, 347, 269

### Innsbruck Hbf
Aankomst:
421

Vertrek:
420, 81, 83, 87, 82, 13479, 165

## Nieuwe event-logica

Voor stations waar een trein expliciet als `arrival` of `departure` is ingesteld,
gebruikt de backend uitsluitend dat event. Hij valt daar niet automatisch terug
op de andere tijd.

Voor de bestaande stations en Arnhem/Deventer blijft de oude `auto`-logica:
vertrek indien aanwezig, anders aankomst.


## v1.6 — aangepaste weergavetijden

Schermduur:

- DB / internationaal: minimaal 15 seconden
- Milano Centrale: 7 seconden
- Roma Termini: 7 seconden

DB is dynamisch:
- 1 pagina: 15 sec
- 2 pagina's: 15 sec, ongeveer 7,5 sec per pagina
- 3 pagina's: 21 sec, ongeveer 7 sec per pagina
- 4 pagina's: 28 sec, ongeveer 7 sec per pagina

Daardoor wordt iedere DB-pagina daadwerkelijk leesbaar getoond voordat
naar Italië wordt geschakeld.

Voorbeeld bij 2 DB-pagina's:
DB pagina 1 7,5 sec → DB pagina 2 7,5 sec → Milano 7 sec → Roma 7 sec.


## v1.7 — DB toont altijd geplande tijd

Voor DB Timetables geldt nu:

- Kolom `Tijd` toont altijd de geplande tijd (`pt`).
- Een actuele/verwachte gewijzigde tijd (`ct`) vervangt de geplande tijd niet meer.
- Vertraging blijft zichtbaar in `Status`, bijvoorbeeld `+12 min`.
- De 30-minutentrend blijft als pijl in `Status`.
- Voor expliciete arrivals (o.a. Wien/Innsbruck) wordt de geplande aankomsttijd gebruikt.
- Voor expliciete departures wordt de geplande vertrektijd gebruikt.


## v1.8 — geplande + gewijzigde tijd en A/V

DB-weergave:

- Normaal: geplande tijd met kleine `ᵃ` (aankomst) of `ᵛ` (vertrek).
- Als DB een gewijzigde tijd (`ct`) levert en die afwijkt van `pt`:
  - geplande tijd wordt kleiner en doorgestreept;
  - nieuwe actuele/verwachte tijd staat ernaast;
  - de kleine aankomst/vertrek-markering blijft zichtbaar.
- Status blijft daarnaast de vertraging tonen, bijvoorbeeld `+12 min ↑`.

Voorbeeld:
`14:32 ᵛ`
of bij wijziging:
`14:32` (doorgestreept) `14:44 ᵛ`
