# Treinrondreis Live Board v2.0 – Railway stappen

Deze versie kan op twee manieren draaien:

- lokaal zonder `DATABASE_URL`: SQLite (`history.sqlite`)
- online met `DATABASE_URL`: PostgreSQL

Dezelfde code kan dus lokaal getest en daarna op Railway gepubliceerd worden.

## 1. GitHub

1. Maak op GitHub een **private repository**, bijvoorbeeld `treinrondreis-live-board`.
2. Pak de ZIP van v2.0 uit.
3. Upload de **inhoud** van de map naar de root van de repository.
4. Upload **geen `.env`**. De `.gitignore` blokkeert dit ook bij normaal Git-gebruik.

Belangrijke bestanden in de root zijn onder andere:

- `server.mjs`
- `storage.mjs`
- `config.json`
- `package.json`
- `railway.json`
- `.env.example`
- `public/`

## 2. Railway app aanmaken

1. Log in op Railway.
2. Maak een nieuw project.
3. Kies **Deploy from GitHub repo**.
4. Selecteer de private repository `treinrondreis-live-board`.

Railway herkent `package.json`, installeert de Node-dependency `pg` en start de app met `npm start`.

## 3. PostgreSQL toevoegen

1. Klik in het Railway-project op **+ New**.
2. Kies **Database → PostgreSQL**.
3. Open daarna de Variables van de web/app-service.
4. Voeg een reference variable toe:

   `DATABASE_URL` → de `DATABASE_URL` van de PostgreSQL-service.

Gebruik bij voorkeur de reference-variable van Railway; plak de database-URL niet handmatig in GitHub.

## 4. DB API-geheimen toevoegen

Voeg bij de Variables van de app-service toe:

- `DB_CLIENT_ID`
- `DB_API_KEY`
- `HISTORY_DAYS=7`

`PORT` hoef je op Railway niet zelf te zetten; Railway levert die variabele.

De API-geheimen staan bewust niet in deze v2.0-ZIP en horen ook niet in GitHub.

## 5. Publieke URL genereren

In de app-service:

1. Settings
2. Networking
3. Generate Domain

Daarna krijg je een adres in de vorm van een Railway-domein. Het vertrekbord staat op `/`.

## 6. Controle

Test na de eerste deployment:

- `/api/health`
- `/api/storage`
- `/api/trains`
- `/api/italy`

Bij `/api/storage` hoort online ongeveer dit te staan:

```json
{
  "backend": "postgresql",
  "historyDays": 7,
  "online": true
}
```

## Nieuwe centrale data-API

### Historie van ICE 225

`/api/history?source=DB&train=225&hours=24`

### Alleen ICE 225 bij Arnhem Centraal

`/api/history?source=DB&train=225&station=Arnhem%20Centraal&hours=24`

### Laatste opgeslagen observaties van een scanpunt

`/api/station/Arnhem%20Centraal`

Dit endpoint toont voor nu de treinen die wij op dat station bewust monitoren. Een volledig vertrekbord met **alle** treinen van een willekeurig station wordt een volgende uitbreiding.

## Wat wordt centraal opgeslagen?

Per observatie onder andere:

- bron
- treinsoort en treinnummer
- scanpunt
- aankomst of vertrek
- moment van waarneming
- geplande tijd
- actuele/verwachte tijd
- vertraging
- status/annulering
- herkomst en bestemming
- spoor/binario als de bron dat levert

De 30-minutentrend vergelijkt nu bovendien dezelfde trein op hetzelfde scanpunt en hetzelfde eventtype. Dat voorkomt dat bijvoorbeeld een waarneming in Köln met een waarneming in Arnhem wordt vergeleken.
