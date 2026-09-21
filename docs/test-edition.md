# Geïsoleerde testeditie 2026

- Deelnemers: `/kilometerkampioen-test/`; beheer: `/treinhuis-test`.
- Eigen registratie en cookie `kk_test_session`; bestaand beheeraccount blijft
  nodig voor testbeheer. Geen accounts, claims of bewijzen overgenomen.
- Eigen tabel `kk_test_records`; alle store-functies gebruiken dezelfde
  request-context. Alleen de vaste tabelnaam wordt gewisseld; geen SQL-waarden.
- Foto's/documenten onder `kk/test-2026/`; browserconcepten onder `kk-test:`.
- `kk_test_settings` bewaart bij eerste gebruik één kopie van het actuele
  nieuwe stationsnetwerk, inclusief revision en SHA-256. Latere wijzigingen
  aan het conceptnetwerk veranderen bestaande testberekeningen niet.
- Regelversies 2026-12-v1 en 2026-24-v1 blijven van toepassing: maxima vóór
  en na Rotterdam, inclusief de twee uitzonderingen. Herhaling wordt per
  aangrenzend stationsdeel begrensd. De scorekaart telt dezelfde geldige km.
- Een route over een nog niet goedgekeurd traject kan worden bekeken, maar
  niet bevestigd. HSL-vragen vereisen een antwoord; via-stations blijven
  mogelijk. In beheer kan een via-station worden ingevuld bij zo'n routevraag.
- De XLSX-download en alle testschermen vermelden TESTEDITIE. E-mailcodes
  zijn uitgeschakeld; testregistratie werkt met een eigen wachtwoord.
- Herstel van testwachtwoorden gebruikt `/wachtwoord-herstellen-test`.

`test-kk-test-edition.mjs` controleert gescheiden records, cookies en media,
hetzelfde e-mailadres, frontend-assets, bewijs/routebevestiging, herhaalde
deeltrajecten, HSL, scorekaartgelijkheid en onveranderde echte records.

De echte 2026-tabellen en de regelsnapshot van de eerdere migratie worden
niet gewijzigd. De versie is bedoeld om te testen, niet als officiële editie.
Testgegevens worden niet automatisch verwijderd of naar 2026 overgezet.
