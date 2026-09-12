# Beheerbasis (fase 1)

Routes: /stationschef, /stationschef/borden, /seinhuis. Seinhuis bevat in deze fase accountbeveiliging; pagina- en inhoudsbeheer volgt apart.

## Activering
1. Publiceer met Node 24; bestaande BOARD_ADMIN_PASSWORD blijft aanwezig.
2. Open /stationschef vanuit Nederland. Vul het bestaande beheerwachtwoord in en kies een gebruikersnaam en persoonlijk wachtwoord (minimaal 14 tekens).
3. Scan QR of voer de sleutel handmatig in de authenticator in. Bevestig met een verse code.
4. Bewaar de tien eenmalige herstelcodes offline/in een wachtwoordmanager.
5. Controleer /stationschef/borden en /seinhuis. Na stap 3 vervallen /beheer en /board-admin.html (404) en accepteert de oude login-API geen wachtwoordlogin meer. Oude cookies verlenen geen toegang meer.

Wachtwoorden: scrypt N=32768,r=8,p=1. TOTP SHA1/6 cijfers/30 seconden, eenmaal per tijdstap, marge één stap. TOTP-sleutel AES-256-GCM versleuteld met ADMIN_ENCRYPTION_KEY indien ingesteld, anders een van BOARD_ADMIN_PASSWORD afgeleide sleutel. **Wijzig/verwijder deze omgevingssleutel niet na activering zonder herstel/migratie.** Persoonlijke wachtwoorden wijzigen via het scherm wijzigt deze encryptiesleutel niet. Stel een eventuele aparte ADMIN_ENCRYPTION_KEY vóór activering in; voeg hem later niet zomaar toe.

Beveiligingsgegevens staan in admin_security, buiten bewaartermijnen voor treingegevens. Versienummer/CAS beschermt concurrerende wijzigingen en codehergebruik. Sessies zijn server-side opgeslagen en verlopen na 12 uur. Vertrouwde browsers maximaal 30 dagen; vrijstelling van TOTP alleen bij Nederlandse IP-landherkenning. Wachtwoord blijft nodig. Landcontrole geldt ook voor bestaande sessies en board-API. Secure/HttpOnly/SameSite=Strict cookies vereisen HTTPS.

Railway: de edge levert X-Real-IP. Deze header wordt alleen op Railway (RAILWAY_ENVIRONMENT_ID) gebruikt; elders de socket-IP. Niet rechtstreeks achter een willekeurige proxy gebruiken zonder de vertrouwensgrens opnieuw te configureren. Geen door de browser opgegeven landheader accepteren. GeoIP lokaal via geoip-lite; onbekend land wordt geweigerd. IP-geolocatie is niet onfeilbaar en VPN's kunnen de landcontrole passeren. Houd de GeoIP-package/data bijgewerkt. GeoLite-data: MaxMind, https://www.maxmind.com, licentie van de meegeleverde package/data respecteren.

## Herstel op reis
Met wachtwoord + eenmalige herstelcode kan vanuit een geblokkeerd/onbekend land een beperkte sessie worden geopend (15 min), uitsluitend voor beveiligingsinstellingen. Een tweede herstelcode is nodig om landen aan te passen. Hersteltoegang verleent nooit boardrechten. Daarna opnieuw inloggen met authenticator. Herstelcodes vervangen geen verloren authenticator.

## Authenticator verloren / definitieve lock-out
Alleen via de bevoegde hostingconsole: `node admin-recovery.mjs`. Het script vraagt om expliciete bevestiging, verwijdert alleen het beveiligingsrecord en beëindigt alle beheertoegang. Het bestaande bootstrapwachtwoord moet beschikbaar zijn. Stel direct een nieuw account vanuit Nederland in. Er is geen openbare reset-URL of gedeelde herstelachterdeur. Dit kan ook nodig zijn na verlies/wijziging van de encryptiesleutel.

## Validatie
`node test-admin-security.mjs` test echte SQLite-persistentie, RFC TOTP-vector, activatie, replay, CSRF, trust, landcontrole, herstel, intrekken, CAS en throttling. Ook bestaande board/cache- en PWA-regressies uitvoeren. Node 24 is nodig voor actuele geoip-lite 2.x. Beheer is no-store/noindex, frame-ancestors none voor nieuwe beheerpagina's, niet toegevoegd aan openbare navigatie/sitemap. noindex is geen toegangsbeveiliging.

Fase 1 heeft één persoonlijk eigenaaraccount. Meerdere accounts/rollen en selfservice-vervanging van de authenticator zijn vervolgwerk, geen onderdeel van deze eerste basis.
