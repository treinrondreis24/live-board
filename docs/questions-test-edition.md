# Regels & vragen — testeditie

De testapp heeft een aparte hulppagina op `/kilometerkampioen-test/hulp` en beheer op `/treinhuis-test/hulp`. De bestaande editie blijft ongewijzigd. Artikelen en vragen gebruiken de gescheiden testopslag.

- Beheer maakt hoofdlijnen, volledige regels en FAQ voor beide of één editie (12/24 uur), eerst als concept of direct gepubliceerd. Er zijn bewust geen niet-aangeleverde officiële regels verzonnen.
- Communityvragen zijn zichtbaar voor ingelogde deelnemers; privévragen uitsluitend voor de vraagsteller en KM-beheer. Dezelfde toegang geldt voor antwoorden en bijlagen.
- Bijlagen gebruiken de bestaande streaming-upload met bestandsvalidatie, quota en particuliere opslag. De vragen-API controleert de eigenaar bij toevoegen en de vraagtoegang vóór een tijdelijke downloadlink.
- Alleen beheer kan een antwoord bevestigen of de bevestiging intrekken. Een FAQ overnemen maakt altijd een concept; controle en expliciete publicatie blijven nodig, ook voor privévragen.
- Tekst wordt als tekst weergegeven, niet als HTML. Schrijfverzoeken eisen dezelfde origin, authenticatie en hebben een limiet. Inzendingen en antwoorden hebben een unieke sleutel tegen dubbel opslaan bij herhalen.
- Overzichten gebruiken de bestaande limiet van de 200 recentste records. Voor grootschalig gebruik is paginering een vervolgstap.

Tests: `test-kk-questions.mjs`, `test-kk-questions-browser.mjs` en de HTTP-controles in `test-kk-test-edition.mjs`.
