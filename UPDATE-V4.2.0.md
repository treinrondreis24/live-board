# v4.2.0 — Köln iframe

Köln Hbf werd al gedeeltelijk gemeten voor het hoofdboard. Voor deze versie
is Köln daarnaast een volledige departure collector geworden. Het bestaande
hoofdboard verandert hierdoor niet.

Nieuw:
- volledige Köln-departurecollectie, opgeslagen in Data Hub/PostgreSQL
- extra planvenster tot 8 uur vooruit voor de Köln-stationpagina
- `/api/views/koeln`
- `/embed/koeln`
- Snel naar:
  - Nederland
  - München
  - Zwitserland
  - Mönchengladbach
  - Köln Messe/Deutz
- per richting eerst 1 trein, daarna `toon meer`
- compleet vertrekbord met Langeafstand / Regionaal
- sortering op geplande vertrektijd
- dubbele fysieke vertrekken met verschillende treinnummers worden visueel
  samengevoegd; individuele treinnummers blijven afzonderlijk opgeslagen

GitHub:
- vervangen: server.mjs, config.json, package.json
- toevoegen onder public/: koeln-embed.html, koeln-embed.css, koeln-embed.js

Na Railway deploy:
- https://treinbord.up.railway.app/api/views/koeln
- https://treinbord.up.railway.app/embed/koeln
