@echo off
cd /d "%~dp0"
if not exist .env (
  echo LET OP: .env ontbreekt.
  echo Kopieer .env.example naar .env en vul DB_CLIENT_ID en DB_API_KEY in.
  echo.
)
echo Treinrondreis Live Board v2.0 starten...
echo Lokaal zonder DATABASE_URL gebruikt het systeem history.sqlite.
echo.
node server.mjs
pause
