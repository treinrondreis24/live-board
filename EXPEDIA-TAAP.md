# Expedia TAAP-berichten



Railway `live-board` gebruikt `EXPEDIA_CLIENT_ID` en `EXPEDIA_CLIENT_SECRET` voor de TAAP Subscriptions API. De bestaande `ADMIN_ENCRYPTION_KEY` (of `BOARD_ADMIN_PASSWORD`) versleutelt de eenmalige abonnementssleutel in PostgreSQL. Verander deze encryptiesleutel niet zonder de abonnementssleutel opnieuw te versleutelen.



Open als eigenaar `/seinhuis/flora/expedia` en kies **Koppeling activeren**. De applicatie vraagt een OAuth-token op, controleert bestaande abonnementen, reserveert de activering in de database en maakt hoogstens één abonnement voor `taap.itinerary.change`. Het standaard ontvangstadres is `https://treinbord.up.railway.app/api/expedia/itinerary-events`; bij een ander domein moet `EXPEDIA_PUBLIC_ORIGIN` worden ingesteld vóór activering.



De publieke POST-ontvanger controleert Expedia's HMAC over de ongewijzigde berichtbytes en het geconfigureerde HTTPS-adres. Alleen na opslag volgt HTTP 200. Identieke berichten worden eenmaal opgeslagen. Alle afzonderlijke versies blijven beschikbaar met zowel ontvangstmoment als Expedia's `update_date_time`; een later ontvangen ouder bericht mag dus niet als nieuwste boekingsstatus gelden. Dit scherm toont ontvangstgeschiedenis, niet een samengevoegde actuele boeking.



Berichten en abonnementstatus zijn uitsluitend zichtbaar na Seinhuis-login. De abonnementssleutel en OAuth-token worden nooit teruggegeven aan de browser. Vouchers, Sanity en e-mails worden niet gewijzigd. Persoonsgegevens worden meegeleverd (`include_pii: true`) om later namen en boekingsreferenties te kunnen vergelijken.



Bij een onzekere abonnementsaanmaak blijft `creating` opgeslagen. Maak dan niet blind opnieuw een abonnement: inspecteer eerst de Expedia-abonnementen. Een bestaand abonnement zonder opgeslagen sleutel kan niet automatisch worden hersteld, omdat Expedia de sleutel uitsluitend bij het aanmaken levert.



Bronnen: https://developers.expediagroup.com/analytics/resources/api-setup en https://developers.expediagroup.com/analytics/itineraries/api-delivery, inclusief gekoppelde TAAP OpenAPI-specificaties.



Controle: `node --test expedia.test.mjs`; volledige repositorycontrole: `npm run check`.



## E-mail als bron, API als controle

Vanaf 6 oktober 2026 blijft de e-mail bron van voucherinhoud. FloRA vergelijkt de nieuwste API-snapshot op exact Expedia-nummer met opgeslagen e-mailbewijzen. Er wordt geen reis afgeleid uit een vrije agency reference zoals `1982A HJ`. Alleen een strikte viercijferige referentie met A wordt vergeleken met de al gekoppelde reis.



De controles vergelijken expliciete datums, totale bezetting, hotelnaam, aantoonbaar verschillende kamerklassen en expliciet inbegrepen/uitgesloten ontbijt in rate_plan_name. Ontbrekend kamertype, ontbijt of andere gegevens veroorzaakt geen alarm. Purchaser wordt niet als bewijs van alle gastnamen gebruikt. E-mailbewijs wordt nooit overschreven met API-gegevens. Status annulering (ook één geannuleerde kamer) blokkeert het gebruik van de reservering als voucher; historische vouchers worden niet automatisch verwijderd.



`GET /seinhuis/flora/expedia/checks?itinerary=...` vereist dezelfde eigenaarssessie als de pagina. Het geeft controles inclusief `voucherBlocked`, vergeleken velden en verschillen. De pagina toont deze controles naast de ongewijzigde berichtgeschiedenis. FloRA neemt verschillen als bevindingen op; iedere 30 seconden worden nieuwe snapshots verwerkt, ook na een herstart. Conflicterende wijzigingen worden de volgende cyclus opnieuw geprobeerd. De actuele selectie gebruikt alle opgeslagen reserveringen, ongeacht de limiet van 100 gebeurtenissen in de geschiedenis.



Controle: `node flora-expedia.test.mjs` en `node scripts/check.mjs all`.

