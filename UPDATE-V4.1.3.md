# Update v4.1.2 → v4.1.3

Vervang in de hoofdmap van GitHub:
- `server.mjs`
- `datahub.mjs`
- `package.json`

Vervang in `public/`:
- `datahub.html`

`storage.mjs` en `config.json` hoeven voor deze update niet te veranderen.

## Wijzigingen

1. Hoofdbord voegt vertrekregels samen wanneer alle relevante gegevens gelijk zijn behalve het treinnummer:
   - zelfde scanpunt
   - zelfde treincategorie
   - zelfde geplande vertrek/eventtijd
   - zelfde verwachte tijd
   - zelfde herkomst
   - zelfde eindbestemming
   - zelfde vertrekspoor
   - zelfde vertraging/status
   Voorbeeld: `ICE 105 / 505`.

2. Iedere trein wordt vóór samenvoegen nog steeds maximaal één keer gekozen op basis van het scanpunt waarvan de verwachte eventtijd het dichtst bij nu ligt.

3. Het hoofdbord wordt na de samenvoeging expliciet op **geplande tijd** gesorteerd. Voor vertrekregels is dit de geplande vertrektijd; expliciete arrivals gebruiken hun geplande aankomsttijd.

4. Vertraging **meer dan +30 minuten** krijgt server-side altijd `major-delay` en de CSS wordt bij uitleveren extra afgedwongen als rood, zowel op groot als mobiel bord.

5. Opslag verandert niet: samengevoegde treinnummers blijven als afzonderlijke observaties volledig in de Data Hub/PostgreSQL bewaard, inclusief sporen.
