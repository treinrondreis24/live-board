# Gedeelde structuur voor data- en beheerpagina’s

De bestaande pagina’s blijven bereikbaar. Nieuwe gedeelde onderdelen worden per pagina ingevoerd en getest; geen totale herschrijving.

## Nu centraal
- public/train-groups.mjs: labels, expliciete categorie-indeling en toegankelijke filterknoppen. train-analytics.mjs gebruikt dezelfde indeling voor SQL-filters.
- public/data-ui.css: basisvormgeving voor datapagina’s; nu gebruikt door Treindata. De dagverslagen en het aansluitarchief hebben nog hun oudere stijlen.
- platform-rules.mjs: overstapregels voor beheerproef en berekening.
- admin-security.mjs: authenticatie en bevoegdheden.

## Volgende migraties
1. Dagverslagen en aansluitarchief naar data-ui.css; visuele regressiecontrole inclusief mobiel en detailregels. Verwijder daarna uitsluitend werkelijk vervangen CSS.
2. Gedeelde navigatie en statuscomponenten; expliciet onderscheid tussen onbekend, verwachting, gerealiseerd en alternatief.
3. Gemeenschappelijke URL/filter- en laadstatusafhandeling, inclusief foutmeldingen, paginering en dekking. Domeinselecties blijven in afzonderlijke modules.
4. Beheerpagina’s naar een gedeelde beheerschil. Bestaande rechten blijven serverzijdig afgedwongen.
5. Grote-scherm/LG-weergave afzonderlijk houden wegens browsercompatibiliteit en afwijkende leesafstanden.

Geen aparte HST/nachttrein-lijsten meer kopiëren. Nieuwe categorieën alleen met geverifieerde bronbetekenis toevoegen. Meetdagen zijn geen unieke ritten; de huidige analyse maakt dat expliciet.
