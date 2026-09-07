# Update v4.0 → v4.1

Vervang in de hoofdmap van GitHub:
- `datahub.mjs`
- `storage.mjs`
- `server.mjs`
- `package.json`

Vervang in `public/`:
- `datahub.html`
- `datahub.js`

Daarna committen; Railway deployt automatisch.

Controleer na deployment:
- `/api/v1/stats` → version `4.1`; migratie moet hervatten en `lastLegacyId` oplopen.
- `/datahub` → V4.1 en `Actuele event-states`.
- `/api/storage` → PostgreSQL en `legacyHeartbeatMinutes: 15`.

De bestaande boards, URLs en config blijven ongewijzigd.
