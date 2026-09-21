# Centrale controles

Gebruik Node 24 en installeer de afhankelijkheden met `npm ci`.
Installeer voor de browsertests Chromium in dezelfde map als de controle gebruikt:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.playwright-browsers'
npx playwright install chromium
npm run check
```

`npm run check` controleert de JavaScript-syntaxis en voert alle bestaande tests uit, inclusief de twee browsertests. Elk testbestand draait in een afzonderlijk proces; fouten worden verzameld en leveren een mislukte eindstatus op.

Afzonderlijk: `npm run check:syntax`, `npm test`, `npm run test:browser`.
De tests gebruiken hun eigen testgegevens; hiervoor zijn geen productiegeheimen nodig.
GitHub Actions voert dezelfde controles uit bij pull requests en pushes naar main. Dit is op zichzelf geen blokkade voor de afzonderlijke Railway-autodeploy.
