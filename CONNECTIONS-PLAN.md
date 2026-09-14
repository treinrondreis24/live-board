# Aansluitbord, aansluitarchief en dagverslagen

Opdracht 14 september 2026. Stap 1–2: aansluitregels, persistente beoordelingen en tests.
Stap 3: zelfstandig scherm op `/aansluitbord`, zeven regels per pagina,
automatisch wisselen na 15 seconden, gegevens ophalen elke 30 seconden.
Planmatig onmogelijke aansluitingen zijn verborgen. Een planmatig mogelijke
aansluiting met geannuleerde trein blijft rood zichtbaar als niet mogelijk.
Stap 4: `/aansluitarchief` met datum, station, status en treinnummerfilters,
bronmetingen per aansluiting en op aanvraag gepagineerde wijzigingsgeschiedenis.
Onbekend blijft onderscheiden van een laatste bruikbare beoordeling. Geen
reconstructie van ontbrekende historie. De hoofdpagina bevat inmiddels ook één
aansluitpagina in de schermrotatie.
Stap 5: `/dagverslagen` en `/api/day-reports?date=YYYY-MM-DD` bewaren compacte
samenvattingen buiten de bronretentie. Top 5 per herkenbare rit, met bron, meettijd
en station; annuleringen zijn geen vertraging in minuten. Schermselectie wordt
elke minuut vastgelegd met de actuele drie-uursregel, niet achteraf gereconstrueerd.
Bij start wordt de nog beschikbare historie van vandaag en twee voorgaande dagen
beperkt opgevraagd voor aanvulling van de algemene top en drie doelmetingen.
Dit blijft expliciet onvolledig. Dienstregeling zonder actuele bevestiging blijft
onbekend. Extra aankomstcollectie NJ 40421 Wien gebruikt bestaande DB-opvragen.
Beheer volgt afzonderlijk.

## Bevestigde uitgangspunten
- Voorbeeldafbeelding ontvangen: blauw aansluitbord, zonder aparte overstaptijdkolom.
- Bevestigd door gebruiker: vervanger 122 is 152; vervanger 224 is 1254. Dit geldt ook in Düsseldorf.
- Bevestigde grenzen: ander perron >=7 haalbaar, 3–6 onzeker,
  <=2 niet haalbaar. Perron onbekend >=7 haalbaar, 0–6 onzeker, negatief niet haalbaar.
- Zelfde perron: >=1 minuut haalbaar, 0 onzeker, <=-1 niet haalbaar.
- Geen waargenomen fysieke reizigersoverstap: registreer een beoordeling op basis van
  de laatste treinmetingen, inclusief voorlopige/definitieve gegevenskwaliteit.
  Een verwachting mag geen feitelijke aankomst of bevestigde overstap worden.

## Regels (alleen planmatig bestaande aansluitingen)
| Station | Aankomende trein | Vertrekkende trein | Voorwaarden |
|---|---|---|---|
| Mannheim Hbf | 225 | EC 5 | 225 ->1255 alleen als 225 planmatig niet rijdt |
| Mannheim Hbf | 225 | 371 | Anders trein richting Basel/Zürich, gepland vertrek 13:30–14:00 |
| Wien Hbf | RJX 66 | NJ 40490 | NJ gepland vóór 19:00; bij ontbreken 66 andere RJ/RJX met geplande aankomst 16:15–16:45 |
| Wien Hbf | EC 146 | NJ 40490 | NJ gepland na 19:00 |
| Innsbruck Hbf | RJ 82 | NJ 420 | |
| Berlin Hbf | 178 | 142 | 140 als 142 ontbreekt of aansluiting niet haalbaar is |
| Köln Hbf | 106 | 224 | Vervanger 1254; Düsseldorf terugval |
| Frankfurt(Main)Hbf | 372 | 124 | Vervanger 154 |
| Köln Hbf | 108 | 122 | Vervanger 152; Düsseldorf terugval |
| Innsbruck Hbf | 421 | 81 | |
| Innsbruck Hbf | 421 | 83 | |
| Dresden Hbf | 178 | 2440 | Vanaf 2026-10-07 |
| Hannover Hbf | 2440 | 142 | Vanaf 2026-10-07 |
| Frankfurt(M) Flughafen Fernbf | ICE 28 | 224 | 28 moet uit Wien Hbf komen; vervanger 224 ->1254 |
| Stuttgart Hbf | 225 | 2383 | Vervanger 225 ->1255 |
| Milano Centrale | 151 | 679 | |
| Milano Centrale | 151 | 2832 | |
| Osnabrück Hbf | 145 | 202 | Tot 5 oktober (inclusiviteit nog expliciet vastleggen) |
| Osnabrück Hbf | 143 | 204 | Tot 5 oktober (inclusiviteit nog expliciet vastleggen) |
| Osnabrück Hbf | 141 | 206 | Tot 5 oktober (inclusiviteit nog expliciet vastleggen) |

Köln/Düsseldorf: bij planmatig onmogelijke aansluiting in Köln de overeenkomstige
aansluiting in Düsseldorf beoordelen. Bij ongepland mislukken Köln behouden in
weergave/archief, Düsseldorf aanvullend beoordelen. Niet vervangen vanwege alleen
ontbrekende data. Planmatig ontbreken en realtime annuleren zijn verschillende zaken.
19:00 exact voldoet aan geen van beide opgegeven Wien-voorwaarden.

## Opslag en presentatie
- Aansluiting identificeren op datum, regel, station en beide ritidentiteiten;
  nooit treinnummer alleen (225 bestaat ook bij andere bronnen/landen).
- Aankomst en vertrek apart; dienstregeling, laatste verwachting, eventuele gerealiseerde
  tijd, meettijd, bron, sporen en perrongroep bewaren met de beoordeling.
- Perrongroepen bestaan al in station_platform_layouts. Alleen bekende indelingen
  gebruiken; geen groep afleiden uit opeenvolgende spoornummers of ontbrekende sporen.
- Registratie van wijzigingen plus laatste toestand; samenvattingen los van de
  korte bronretentie bewaren. Geen gigantische ruwe payloads in een rapport.
- Afzonderlijk /aansluitbord, /aansluitarchief en /dagverslagen, later ook schermrotatie
  en stationschef-configuratie. Vormgeving na ontvangst afbeelding.
- Geen aparte overstaptijdkolom. Stadnamen, zo mogelijk C/Hbf/HB/SBB behouden.
- Rapport per lokale kalenderdag; huidige dag voorlopig, ontbrekende data expliciet.
- Dagverslag: 40490 op Nederlandse stations, 40421 aankomst Wien, 225 aankomst Mannheim.
- Top 5 grootste gemeten vertragingen van schermtreinen en afzonderlijk alle verzamelde
  treinen; per rit ontdubbelen, met station/bron/meetmoment. Voor een echte scherm-top-5
  schermselectie tijdens de dag vastleggen, niet achteraf uit huidige configuratie gokken.
- Overzicht onzeker/niet haalbaar en ontbrekende meetgegevens, met link naar aansluitarchief.

## Gecontroleerd in bestaande data
Implementatie stap 1–2: `connections-rules.mjs`, `connections-engine.mjs`,
`connections-store.mjs`, `connections-monitor.mjs`. Monitor elke minuut; gebruikt
bestaande DB-scans en ViaggiaTreno (679 toegevoegd). Geen extra DB-requests.
De volledige opgehaalde planning wordt apart opgenomen, zodat afwezigheid niet
wordt verward met een trein buiten het realtimevenster. Vervanging bij afwezigheid
vereist volledige dagdekking; Berlin vereist beide stationsniveaus.
Werkgegevens 7 dagen; beoordelingen en betekenisvolle revisies blijven bewaard.
Bij meer dan 15 minuten oude verwachtingen: onbekend, met laatste geldige beoordeling
apart bewaard. Geen definitieve claim dat een reiziger de aansluiting heeft gehaald.
Leesroutes: `/api/connections?date=YYYY-MM-DD`, `/api/connections/status`,
`/api/connections/revisions?key=...`. Tests: `node --test connections.test.mjs`.
Datumaanname: "tot 5 oktober" is exclusief 5 oktober (laatste dag 4 oktober).

Op 14 september bevatte 225 Mannheim een DB-vertrekmeting, geen aparte aankomstmeting.
151 Milano heeft een aankomst uit ViaggiaTreno. Actual timestamps waren in deze
steekproef leeg. DB-normalisatie ondersteunt aankomstselectie uit dezelfde opgehaalde
stops: connection-collection.mjs voegt die toe zonder extra stationrequests.
Bronretentie is doorgaans 3 dagen, voor geselecteerde categorieën 30 dagen.
Historische dagverslagen kunnen daarom alleen volledig worden gereconstrueerd waar
de benodigde waarnemingen nog aanwezig zijn.
