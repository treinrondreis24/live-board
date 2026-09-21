# Richting voor editie 2028

Verbeter de bestaande applicatie stapsgewijs. Behoud bewezen functies en vervang onderdelen afzonderlijk, met controles van bestaand gedrag.

## Editie en puntentelling

- Sla routes, bewijs en werkelijk afgelegde afstand los van meetellende kilometers op.
- Bereken meetellende kilometers direct tijdens de reis, niet alleen bij de eindclaim. Toon de status van onbevestigde trajecten duidelijk.
- Gebruik een expliciete, vastgelegde regelversie per editie. Nieuwe regels mogen historische resultaten niet wijzigen.
- Gebruik dezelfde rekenfunctie voor het deelnemersoverzicht, beheer en scorekaart. Bewaar welke gegevens en regels een uitkomst hebben bepaald.
- Correcties blijven herleidbaar. Herberekenen moet bewust gebeuren met de juiste editie en regelversie.

## Beheer en uitbreidbaarheid

Inventariseer dubbele schermen en acties voordat menu's worden geschrapt. Maak één deelnemersdossier met bewijs, trajecten en eindclaim; andere overzichten linken daarheen met behoud van filters en scrollpositie.

Deel gedeelde navigatie, formulieren en meldingen. Houd deelnemers, bewijs, routeberekening, puntentelling en communicatie als afzonderlijke onderdelen met duidelijke interfaces.

Houd ruimte voor een latere vragenfunctie: antwoorden door beheerders en deelnemers, openbare en privévragen. Zichtbaarheid moet ook op de server worden afgedwongen. Deze functie wordt nu niet gebouwd.

## Volgorde

1. Centrale bestaande controles (deze wijziging).
2. Voorstel en tests voor gescheiden afstanden en regels per editie.
3. Beheer vereenvoudigen en geleidelijk opsplitsen.
4. Nieuwe functies toevoegen binnen de afgesproken onderdelen.

Geen automatische migratie of herberekening van editie 2026 in deze wijziging.
