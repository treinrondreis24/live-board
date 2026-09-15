# Betrouwbaarheid uploads — 15 september 2026

- Browser herhaalt tijdelijke netwerk-/502/503/504-fouten maximaal vijf keer met oplopende wachttijd of Retry-After en willekeurige spreiding. 4xx validatie/auth/quota worden niet automatisch herhaald.
- Elk bestand krijgt binnen zijn concept een blijvende uploadcode, op basis van bestandskenmerken en begrensde inhoudssamples. Geen volledige video in JavaScript-geheugen geladen voor deze herkenning.
- Server leidt de opslag-ID af van eigenaar, uploadsoort en code. Een databaselease voorkomt gelijktijdige verwerking van dezelfde code. Ontvangen media worden herkend vóór uploadquota en verwerking; eigenaar, grootte, type en bestandsnaam worden gecontroleerd.
- Maximaal twee uploads tegelijk per appproces. Databaseleases verlopen na tien minuten bij een crash. Tijdelijke bestanden en leases worden na normale afronding/fouten opgeruimd. Dit verhoogt de bestaande uploadcapaciteit niet.
- Bewijs, updates en eindclaims bewaren herkenning, ontvangen media-ID's en de exacte nog onbevestigde inzending lokaal in de browser. Na herladen krijgt de gebruiker een aparte afrondknop; daarvoor hoeven bestanden niet opnieuw gekozen te worden.
- Vóór de definitieve inzending afgebroken upload: bestanden kunnen opnieuw gekozen moeten worden; ontvangen bestanden met dezelfde kenmerken worden herkend. Geen volledige offline bestandswachtrij. Als browseropslag niet werkt verschijnt een waarschuwing.
- Beheer toont uploadtellers sinds processtart en een handmatige knop Status vernieuwen, met tijdstip. Geen permanente historische monitor.

Getest: bewijs/update/eindclaim op mobiel formaat met twee 503-reacties, verloren ontvangstbevestiging, herladen en afronden zonder nieuwe upload of inzendings-ID; serverherkenning, eigenaarscheiding, conflicterende code, afgebroken verbinding en vrijgeven uploadplaatsen; bestaande inzendings-, claim-, beheer-, scorekaart- en wachtwoordhersteltests.

Railway read-only gecontroleerd: live-board één replica, geheugenlimiet 24 GB, laatste 15-minutengrafiek rond 4 GB. PostgreSQL: geen automatische back-upplanning; PITR uit. Bestaande volume-back-ups van vijf en acht dagen geleden (resize-back-ups). Bucket 20 MB in US East; geen aparte mediaback-up bevestigd. Geen grenzen, backupinstellingen of productiegegevens gewijzigd. Herstelproef en automatische back-ups blijven afzonderlijk af te ronden.
