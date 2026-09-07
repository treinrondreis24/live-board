# Update v4.1.1 → v4.1.2

Vervang in de hoofdmap van GitHub:
- `server.mjs`
- `storage.mjs`
- `datahub.mjs`
- `config.json`
- `package.json`

Vervang in `public/`:
- `datahub.html`

Daarna committen. Railway deployt automatisch.

Na deployment:
1. `/api/storage` toont `dbRetention.fernverkehr = permanent` en
   `dbRetention.regional = current-and-previous-service-day`.
2. `/api/v1/stats` toont versie `4.1.2`.
3. `/api/health` laat bij de brede collectors lege `categories` zien; dat is
   bewust: alle vertrekcategorieën worden verzameld.

Het hoofdboard verandert niet. Mannheim/Wien blijven op hun mobiele view
Fernverkehr-gefilterd.
