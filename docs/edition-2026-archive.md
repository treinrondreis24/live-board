# Expliciete koppeling bestaande gegevens aan 2026

`scripts/edition-2026.mjs` voert een aanvullende PostgreSQL-migratie uit. Zonder
`--apply` wordt alles in een transactie getest en teruggedraaid. Met `--apply`
wordt de transactie pas vastgelegd als de controle van alle originele records
exact dezelfde hash oplevert. De migratie kan opnieuw worden uitgevoerd en
weigert afwijkende bestaande koppelingen of een andere regelsnapshot.

- `kk_rule_snapshots`: vaste 2026-v1-snapshot van rekenkern, Hilta, beheerroute-
  verwerking, scorekaartgenerator, XLSX-sjabloon en het volledige netwerk.
  Bestanden staan met SHA-256 en base64-inhoud in de snapshot. Het betreft de
  gebruikte implementatie bij deze migratie, niet een reconstructie van iedere
  historische softwareversie. Bestaande route/sourceHash-velden blijven intact.
- `kk_editions`: 2026-12 en 2026-24; daarnaast 2026-unassigned voor deelnemers
  zonder editie en 2026-shared voor bijvoorbeeld liveblog en uitgelichte vragen.
- `kk_record_editions`: koppelt de bestaande records via hun ongewijzigde
  (kind,id)-sleutel aan een editie en, waar van toepassing, 2026-12-v1 of
  2026-24-v1. Onbekende editie behoudt expliciet de bestaande 24-uursfallback.
- `kk_edition_migrations`: controletotalen en hashes van de migratie.

Claims, inzendingen, media, deelnemers, routevoorstellen en bevestigingen,
bijbehorende beheerhistorie, liveblog, vragen, stemmen en teams vallen binnen
deze koppeling. Accountwachtwoorden, sessies en toekomstige Hilta-netwerkversies
zijn geen editiearchief en worden niet als 2026-wedstrijdgegevens ingedeeld.
Mediaobjecten blijven op hun bestaande locatie; hun mediarecord draagt de
editiekoppeling. De gemaakte onafhankelijke back-up bevat ook de mediabestanden.

Een AFTER INSERT-trigger koppelt nieuwe 2026-records eveneens. Bestaande
koppelingen blijven bij correcties behouden. Er wordt geen recordpayload,
claimtotaal, bewijsvolgorde, bestandsnaam of route gewijzigd of herberekend.
Dit is nog geen alleen-lezen archief en nog geen nieuwe testeditie.

## Volgende stap: aparte testeditie

De huidige app rekent nog via de bestaande 2026-modules. Voor het introduceren
van een testeditie moeten aanmelding, schrijven, lezen en rekenen expliciet
op editie worden gescheiden en moet de berekening de gekoppelde regelsnapshot
kiezen. De insert-trigger weigert intussen expliciet andere competitiejaren
om onbedoeld mengen te voorkomen. Nieuwe testdeelnames mogen niet via de
bestaande 2026-deelnemersidentiteiten worden hergebruikt. De nieuwe
trajectkoppeling mag de bevroren 2026-bronbestanden niet overschrijven.
