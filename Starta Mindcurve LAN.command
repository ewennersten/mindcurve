#!/bin/bash
# Dubbelklicka för att starta Mindcurve LAN-servern i en Terminal-ruta.
# En .command-fil körs alltid från sin riktiga plats (till skillnad från en .app
# kan den inte "transloceras" av macOS), så den här fungerar även om appen krånglar.
# Stänger du Terminal-fönstret stoppas servern. Lägg filen kvar i projektmappen.

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || { echo "Hittar inte projektmappen $DIR"; read -r; exit 1; }

if [ ! -f package.json ]; then
  echo "package.json saknas i $DIR — ligger .command-filen i projektmappen?"
  read -r -p "Tryck Enter för att stänga."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Hittade inte npm/node. Installera Node.js (t.ex. via Homebrew) och försök igen."
  read -r -p "Tryck Enter för att stänga."
  exit 1
fi

echo "Stänger ev. gammal server …"
pkill -f "tsx server/index.ts" 2>/dev/null
PORT_PID="$(lsof -ti tcp:3000 2>/dev/null)"
[ -n "$PORT_PID" ] && kill $PORT_PID 2>/dev/null
sleep 1
PORT_PID="$(lsof -ti tcp:3000 2>/dev/null)"
[ -n "$PORT_PID" ] && kill -9 $PORT_PID 2>/dev/null

echo "Startar Mindcurve LAN — bygger spelet, vänta några sekunder …"
echo "(Stäng det här fönstret för att stoppa servern.)"
echo
# Foreground: utskrifter (inbjudningsadress + vilka som joinar) syns live.
# Servern öppnar webbläsaren själv när den är uppe.
exec npm run lan
