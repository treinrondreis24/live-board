# Google-login en browsergoedkeuring voor Seinhuis

Deze wijziging voegt Google-login naast het bestaande eigenaaraccount toe. Bestaande wachtwoorden, Authenticator, landenregels en herstelcodes worden niet gemigreerd of verwijderd.

## Vooraf toegestane accounts

| Account | Rol | Toegang |
| --- | --- | --- |
| hildebrand@treinreiziger.nl | Beheerder | Alle bestaande beheeronderdelen en toegangsbeheer |
| reservations@treinrondreis.nl | Beheerder | Alle bestaande beheeronderdelen en toegangsbeheer |
| tickets@treinrondreis.nl | Gebruiker | Instelbaar per onderdeel; aanvankelijk Boekjesmaker en FloRA |
| florentina.niculae@treinrondreis.nl | Gebruiker | Instelbaar per onderdeel; aanvankelijk Boekjesmaker en FloRA |

Een toegestaan account heeft nog geen goedgekeurde browser. De eerste Google-login bindt het geverifieerde Workspace-adres aan Googles vaste `sub`. Een ander Google-account met hetzelfde adres neemt die binding niet over. Alleen Google Workspace-identiteiten met een passend `hd` en geverifieerd e-mailadres worden geaccepteerd. De twee verschillende Workspace-domeinen vereisen een OAuth-app die beide organisaties toelaat.

## Google en Railway instellen

1. Maak een OAuth-client van type **Web application** in Google Cloud voor Seinhuis. Gebruik een consentconfiguratie die accounts uit beide organisaties toelaat. In testmodus voeg je alle vier accounts als testgebruikers toe. Workspace-beleid kan daarnaast beheerderstoestemming vereisen.
2. Registreer exact deze redirect-URI: `https://treinbord.up.railway.app/seinhuis/google/callback`.
3. Zet via de beveiligde Railway-instellingen `SEINHUIS_GOOGLE_CLIENT_ID` en `SEINHUIS_GOOGLE_CLIENT_SECRET`. Stuur het secret niet via chat en commit het niet. `SEINHUIS_PUBLIC_ORIGIN` is standaard `https://treinbord.up.railway.app`; bij een ander domein moet de geregistreerde redirect ook worden aangepast.
4. De login vraagt uitsluitend `openid email`. Er worden geen Gmail-/Drive-rechten en geen refresh tokens opgeslagen. De bestaande Gmail-koppeling van FloRA blijft afzonderlijk.
5. Publiceer de gecontroleerde wijziging. Zonder clientinstellingen toont het nieuwe scherm dat Google-login nog wordt ingericht; de oude ingang blijft werken.

## Eerste beheerder en overstap

1. Log in via de bestaande eigenaarlogin met wachtwoord en Authenticator.
2. Open `/seinhuis/toegang`, kies **Beheerdersaccount koppelen**, vul een verse Authenticator-code in en selecteer één van de twee toegestane beheerdersaccounts bij Google.
3. Alleen deze expliciete, browsergebonden koppelactie keurt de eerste beheerdersbrowser automatisch goed. Een gewone Google-login van een beheerder doet dat niet.
4. Controleer het overzicht en de apps. Laat het tweede beheerdersaccount via Google aanmelden en keur diens browser goed vanuit het eerste account.
5. Stel onder Accounts de onderdeelrechten voor Tickets en Florentina in. Je kunt Stationschef, Treinhuis (KM-trein), Treinreiziger, Boekjesmaker en FloRA afzonderlijk aan- of uitzetten. Laat hen daarna aanmelden en keur hun browsers goed. Zij zien uitsluitend de toegekende onderdelen.

Onderdeelrechten zijn onafhankelijk van de rol beheerder. Een gebruiker met alle vijf onderdelen kan de operationele functies gebruiken, maar geen accounts, browsergoedkeuringen of algemene beveiliging beheren. Beide beheerders hebben alle onderdelen. Rechten worden bij iedere aanvraag uit de database gelezen: een onderdeel intrekken geldt meteen voor bestaande sessies, zonder de browser opnieuw te hoeven goedkeuren. Je kunt ook alle onderdelen uitzetten; het account blijft dan ingelogd op een leeg Seinhuis-overzicht.

Een succesvolle overgang naar een goedgekeurde Google-sessie sluit de bestaande eigenaarssessie in die browser. Het bestaande account kan nog steeds via de oude ingang opnieuw inloggen. Bewaar Authenticator en herstelcodes. Herstelcodes geven nog steeds beperkte toegang voor landenherstel; ze vervangen geen verloren Authenticator. Definitieve lock-out gebruikt de bestaande hostingprocedure `admin-recovery.mjs`.

## Sessies, intrekken en locaties

### Beheeractie bevestigen zonder de pagina te verlaten

Aanvragen staan bovenaan. Het computeroverzicht groepeert browsergoedkeuringen per account, met zoeken en statusfilters. Een kaart stelt een browsercookie bij een account voor, geen vastgesteld fysiek apparaat. Sessies en IP-/browserdetails staan afzonderlijk bij het overzicht. Meldingen krijgen focus en de pagina schuift naar de melding.

Een Google-beheerder kan gedurende tien minuten na de laatste bevestiging beheeracties uitvoeren. Na die termijn opent de gekozen actie een dialoog met het doel van de actie. De knop daarin opent Google in een apart venster. De server bindt deze bevestiging aan het bestaande sessietoken, dezelfde goedgekeurde browser en exact hetzelfde Google-account. Een geblokkeerd account, ingetrokken sessie/browser of niet-toegestaan land kan daarmee niet worden hersteld. Na succes wordt uitsluitend de bevestigingstijd van de bestaande sessie vernieuwd; daarna probeert de oorspronkelijke pagina de bewaarde actie opnieuw met de normale servercontroles.

Het venster geeft alleen een willekeurige kanaalcode door, geen tokens of accountgegevens. De oorspronkelijke pagina vertrouwt een vensterbericht niet als bewijs: zij controleert opnieuw de eigen serverstatus. Ook wanneer Google de vensterverbinding isoleert, controleert de pagina die status tijdelijk om de bevestiging op te merken. Annuleren of een verlopen bevestiging voert de bewaarde actie niet uit. Bij een geblokkeerd pop-upvenster verschijnt uitleg in de dialoog. De bestaande eigenaarlogin vraagt een verse Authenticator-code in dezelfde dialoog; onjuiste codes worden nooit automatisch opnieuw geprobeerd.

- Browsergoedkeuring verloopt niet na 30 dagen. De database bewaart de goedkeuring totdat een beheerder haar intrekt. De browser krijgt een beveiligde cookie van maximaal 400 dagen, opnieuw geplaatst bij Google-login; browsers mogen cookies eerder verwijderen.
- Een Google-sessie verloopt na 30 dagen. Daarna volgt opnieuw de Google-accountkeuze, zonder nieuwe browsergoedkeuring. Google bepaalt zelf of extra verificatie nodig is.
- Iedere beschermde aanvraag controleert account, browsergoedkeuring en sessie in de database. Een ingetrokken browser blijft ingetrokken na Google-login. Accountblokkade beëindigt alle Google-sessies en trekt alle bijbehorende browsers in; het account opnieuw toestaan keurt die browsers niet automatisch goed.
- Voor goedkeuren, intrekken en blokkeren is een Google-bevestiging van minder dan 10 minuten oud nodig. Met de oude eigenaarlogin is een verse TOTP-code vereist. Een recente OAuth-bevestiging garandeert niet dat Google daarbij opnieuw een wachtwoord of tweede factor vroeg: beveilig de Google-accounts met sterke tweestapsverificatie/passkeys.
- Goedkeuring beheren geldt voor een browsercookie, niet voor een cryptografisch vastgesteld fysiek apparaat. Cookies wissen of een andere browser gebruiken kan een nieuwe aanvraag opleveren. Een gestolen sessie plus apparaatcookie blijft een risico; gebruik persoonlijke, vergrendelde computers.
- De bestaande landenlijst geldt voor zowel Google-login als de oude login. Een toegestaan account en goedgekeurde browser krijgen uitsluitend toegang vanuit een bekend, toegestaan land. De controle geldt bij het starten en afronden van Google-login, bij het voortzetten na browsergoedkeuring en bij iedere beschermde aanvraag, inclusief toegangsbeheer. Onbekende landen worden geweigerd en tijdelijke landtoestemming vervalt ook voor bestaande sessies. Browsergoedkeuring blijft behouden bij een landenblokkade. Beheer de landenlijst via de bestaande beveiligingsinstellingen; de beperkte herstelroute voor reislanden blijft bestaan.
- Het overzicht toont browser/user-agent, laatste activiteit, IP-adres en geschatte stad/land. Browserinformatie is door de client opgegeven; IP-locatie is onnauwkeurig. Activiteit wordt maximaal eenmaal per minuut bijgewerkt. Alleen beheerders zien het overzicht; maximaal 500 toegangsacties blijven in het logboek.
- Intrekken verhindert nieuwe aanvragen. Reeds geladen of gedownloade gegevens en al gestarte acties worden niet teruggehaald. Uitloggen bij Google beëindigt niet automatisch de Seinhuis-sessie.

## Controle vóór activering

- Controleer op de actieve Node-service alleen of beide `SEINHUIS_GOOGLE_CLIENT_*` instellingen aanwezig zijn; druk hun inhoud nooit af. Nog niet uitgerolde Railway-wijzigingen zijn geen bewijs dat de actieve service is ingesteld.
- Controleer vóór publicatie dat de redirect-URI exact overeenkomt en dat beide Workspace-domeinen worden toegelaten. Laat de bestaande eigenaarlogin en herstelroute beschikbaar.
- Test na afzonderlijk akkoord voor publicatie eerst de bestaande eigenaarlogin, daarna de expliciete beheerderskoppeling en vervolgens een collega met beperkte onderdeelrechten. Goedkeuren van een echte browser of wijzigen van echte rechten vereist afzonderlijke toestemming voor die actie.
- Controleer met die collega dat Boekjesmaker bereikbaar is en dat algemeen beveiligingsbeheer en niet-toegekende onderdelen worden geweigerd. Controleer intrekking uitsluitend met toestemming en een afgesproken testbrowser.
- Rond de overstap pas af nadat de echte Google-aanmelding is bevestigd. Een geslaagde lokale test of GitHub-controle bevestigt geen productieconfiguratie.

## Testdekking

`google-login.test.mjs` controleert echte RSA-handtekeningen, issuer, client, nonce, tijdslimieten en Workspace-identiteit. `google-access.test.mjs` gebruikt echte SQLite-persistentie voor onboarding, rollen, CSRF, browserbinding, state-hergebruik, sessieverloop, intrekken, blokkeren en een blokkade tijdens de Google-netwerkaanvraag. `test-google-access-browser.mjs` controleert het scherm en de bediening met API-fixtures op desktop en mobiel. Een volledige Google-login met de productieclient moet na configuratie nog worden getest; fixtures bevestigen geen live OAuth-configuratie.
