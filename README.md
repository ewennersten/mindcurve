# Mindcurve

Mindcamps egen version av klassikern *Achtung, die Kurve!* / Curve Fever —
upp till 4 spelare på samma tangentbord, eller varsin dator över LAN. Byggd
med TypeScript, HTML5 Canvas och Vite; LAN-läget körs av en Node-server (`ws`).
Loggan i `logo/` används i lobbyn, som favicon och på Mindcamp-stjärnan.

## Lokalt spel (en dator)

```sh
npm install
npm run dev
```

Öppna adressen som Vite skriver ut (vanligtvis `http://localhost:5173`).

- Gå med genom att trycka din vänstertangent eller klicka på en ruta.
- Standardkontroller: **P1** `←`/`→` · **P2** `A`/`S` · **P3** `V`/`B` · **P4** `K`/`L`
  (klicka på tangentknapparna i lobbyn för att byta).
- `SPACE` startar matchen och nästa runda. `ESC` pausar.

## LAN-spel (flera datorer)

Enklast: **dubbelklicka på `Starta Mindcurve LAN.command`** i projektmappen.
En Terminal-ruta öppnas, spelet byggs och servern startar — inbjudningsadressen
och vilka som joinar syns live i fönstret. **Stäng fönstret för att stoppa
servern.** Den gör alltid en ren omstart (dödar gammal server + allt på port 3000).

Det finns också en **`Starta Mindcurve LAN.app`** (samma sak, utan Terminal-fönster,
servern i bakgrunden + loggar till `lan-server.log`). Den är ad-hoc-signerad för att
undvika macOS "App Translocation". Om appen någon gång krånglar — använd
`.command`-filen, den kan aldrig drabbas av det problemet.

Båda gör en ren omstart varje gång, så klicka bara när ni vill börja om (en
pågående match avbryts). Filerna måste ligga kvar i projektmappen.

Eller via terminalen på värddatorn:

```sh
npm run lan
```

Servern bygger klienten och skriver ut en adress, t.ex. `http://192.168.1.23:3000`
(adressen syns också under "Bjud in:" i LAN-lobbyn).
Alla andra på samma nätverk öppnar den adressen i sin webbläsare — ingen
installation behövs. Eftersom de kommer via nätverksadressen (inte `localhost`)
hamnar de **direkt i LAN-lobbyn**; de väljer namn och trycker **REDO**.
Värddatorn öppnar via `localhost` och får vanliga menyn med val mellan lokalt
spel och LAN. Matchen startar när alla (minst 2) är redo. Styr med `←`/`→` eller
`A`/`S`. (Vill du tvinga valet: lägg `#lan` respektive `#local` på adressen.)

Servern kör hela simuleringen; klienterna skickar bara inputs och ritar.

## Regler

- Sista överlevande masken vinner rundan. Alla som lever när någon dör får 1 poäng.
- Först till poängmålet — med ensam ledning — vinner matchen. Målet väljs i lobbyn:
  **Auto** (`10 × (antal spelare − 1)`) eller ett fast antal poäng.
- Spåren har slumpmässiga luckor som går att smita igenom.
- **Sudden death**: efter inställd tid (standard 2 min, väljs i lobbyn under
  "Krympning", kan stängas av) börjar väggarna krypa inåt med pulserande
  varningsram och larm — försiktiga cirklare tvingas mötas.
- Kill feed visar vem som dog av vad ("Röd kraschade i Gröns spår"), och varje
  död ger explosion i spelarens färg plus en skärmskakning.
- Aktiva power-up-effekter visas i poängpanelen med en nedräkningsstapel — du ser
  hur länge t.ex. omvända kontroller eller spöke är kvar.
- **Matchboll**: när en spelare kan vinna matchen nästa runda lyser raden guld
  med en "MATCHBOLL"-markering och en ljudstöt.

### Power-ups

Ringfärgen visar vem som påverkas: **grön** = du själv, **röd** = motståndarna,
**blå** = alla/planen.

| Ikon | Effekt |
|---|---|
| ⚡ / 🐌 | Fart upp / ner (dig själv) |
| 🪶 | Tunn linje |
| 👻 | Spöke — ritar inget spår och kan inte krocka en kort stund |
| 🔫 | Kanon: 3 skott — tryck **vänster + höger samtidigt** för att skjuta hål i spåren |
| 🚀 | Motståndarna snabbare |
| 🔄 | Omvända kontroller (motståndare) |
| 🎈 | Tjock linje (motståndare) |
| 🧹 | Rensar alla spår |
| 🌀 | Öppna väggar — wrap-around en stund |
| 🍺 | Öl — skärmen gungar för alla i några sekunder |
| ![logo](logo/mindcamp_logo.png) | **Mindcamp-stjärnan** — som stjärnan i Mario Kart, trumfar allt: odödlig i 4 s, spår du kör igenom sprängs och väggarna wrappar dig till andra sidan. |

Varje power-up har sin egen ljudeffekt, och kanonen låter både när den plockas,
avfyras (pew!) och när hålet sprängs.

## Ljud

Allt ljud syntetiseras i realtid med Web Audio API — inga ljudfiler:

- **Soundtrack**: loopande synthslinga (126 BPM, Am–F–C–G) som spelar under rundorna.
- **Effekter**: nedräkningspip, kraschexplosion, power-up-plock med olika klang
  beroende på färg (grön/röd/blå), vinststing per runda, fanfar vid matchvinst
  och en svisch när väggarna öppnas.

Ljudknappen nere till höger (eller `M` under spel) stänger av/på allt; valet sparas.

## Utveckling

```sh
npm test         # enhetstester (vitest)
npm run check    # typkontroll
npm run build    # produktionsbygge till dist/
node scripts/verify.mjs        # e2e: lokalt spel i headless Chromium
node scripts/verify-lan.mjs    # e2e: två LAN-klienter mot servern (kräver npm run lan)
node scripts/verify-audio.mjs  # e2e: ljudmotorn schemalägger musik/effekter (kräver npm run dev)
node scripts/verify-powerups.mjs  # e2e: power-up-ikoner, kanon, öl (kräver npm run dev)
node scripts/verify-top3.mjs   # e2e: krympning, dödsexplosion, kill feed (kräver npm run dev)
node scripts/verify-prio1.mjs  # e2e: effekt-timers + matchboll (kräver npm run dev)
node scripts/verify-mindcurve.mjs  # e2e: Mindcurve-branding + Mindcamp-stjärnan (kräver npm run dev)
```

Arkitekturen i korthet: `src/game/` är en ren, deterministisk simulering
(seedad RNG, fast 60 Hz-tick, geometrisk kollision i spatial grid) utan
DOM-beroenden — samma kod körs i webbläsaren för lokalt spel och i Node av
LAN-servern (`server/index.ts`). `src/render/` ritar, `src/ui/` är lobby/HUD,
`src/net/` är protokoll + klientsession.
