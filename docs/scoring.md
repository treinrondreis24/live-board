# Kilometerberekening per editie

`kk-scoring.mjs` is de gezamenlijke rekenkern voor de actuele score en de Excel-scorekaart. `kk-scoring-service.mjs` haalt bewijzen in bulk op voor de overzichten.

Actief: 2026-12-v1 en 2026-24-v1. Bestaande deelnames zonder expliciet competitiejaar blijven 2026; een afwijkende reisdatum verandert niet stilzwijgend de editie. Een expliciete regelversie moet bij jaar én editie passen. Onbekende of conceptregels geven geen schijnscore.

De kern retourneert geldige, bevestigd afgelegde en niet-meetellende kilometers, plus het aantal nog te beoordelen bewijzen. Niet-bevestigde/verouderde routes zijn niet gelijk aan ongeldige kilometers. Het overzicht is een berekende weergave: historische claims, routebevestigingen en ingeleverde bestanden worden niet gewijzigd.

2026 gebruikt exact de bestaande scorekaartmaxima, validatie en deeltrajecttelling. Het eerste Rotterdam-bewijs in reisvolgorde bepaalt standaard de grens vóór/na; bij meerdere bewijzen toont het scherm een waarschuwing. Bij de Excel-download blijft de expliciete meldpuntkeuze beschikbaar: bij een andere keuze kan het totaal verschillen. Ontbreekt een meldpuntbewijs, dan telt de kern voorlopig alles vóór de post.

2028 staat alleen als concept geregistreerd en kan niet als actieve rekenregel gebruikt worden. Voor activering zijn onder meer nodig: vastgestelde jokerlimiet, stempelpost en tijden, afspraak voor gedeeltelijke jokertrajecten, regelversie en het bijbehorende stationsnetwerk. De 12-uurs puntentelling wacht daarnaast op vaststelling van vertraging-, opdrachten- en bonusregels. De 24-uurs conceptinstellingen bewaren het startvenster en de duur van 23:59:59.

Route wijzigen, later bewijs toevoegen en bewijs verwijderen behouden hun bestaande verwerking. Er wordt in deze wijziging geen route automatisch opnieuw berekend. Een latere migratie moet bewijs en routekoppelingen verder losmaken; die stap is geen onderdeel van deze scoreweergave.
