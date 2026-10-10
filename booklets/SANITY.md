# Herbruikbare teksten uit Sanity

Bibliotheek → Sanity-tekst toevoegen. Zoek op titel of inhoud, bekijk de tekst,
selecteer maximaal dertig teksten en bepaal de volgorde. Kies A4 staand of A5
liggend en één of twee kolommen. De paginatitel is optioneel. Daarna opent de
gewone bouwsteeneditor met land, bestemming, inhoudsopgave en paginanummers.

De tekst gebruikt Open Sans 10, subkoppen 11, Montserrat 28 en regelafstand 1,65.
Tekst stroomt door naar volgende pagina's; koppen blijven bij hun eerste alinea.
Afbeeldingen, links en gewone tekstmarkeringen worden meegenomen. Niet
ondersteunde onderdelen geven een foutmelding; inhoud wordt niet stil weggelaten.

Iedere PDF-generatie vraagt de gepubliceerde documenten rechtstreeks op bij
Sanity (geen CDN voor tekst). Een bestaande opmaak kan worden hergebruikt als
de opgehaalde bron en instellingen identiek zijn. Ontbrekende bronnen of een
storing blokkeren de export. De paginaverdeling en inhoudsopgave worden na het
ophalen berekend. Oude drukversies blijven intact. De editor heeft ook een knop
Vernieuwen uit Sanity.

De bestaande openbare dataset wordt alleen gelezen: project `il9cyh3m`, dataset
`production`, documenttype `reusableText`. Concepten worden uitgesloten.
Optionele service-instellingen: `BOOKLETS_SANITY_PROJECT_ID` en
`BOOKLETS_SANITY_DATASET`. Voor deze openbare dataset is geen nieuwe sleutel,
Google-toestemming of betaalde dienst nodig. Alle Boekjesmaker-API's blijven
achter de bestaande Seinhuis-gateway.

Controle: Python `test_sanity_sources.py` en Node `test-sanity-ui.cjs`, naast de
bestaande Boekjesmaker-tests. Echte Nightjet-bron met QR-afbeelding als A5-PDF
opgehaald en visueel gecontroleerd.
