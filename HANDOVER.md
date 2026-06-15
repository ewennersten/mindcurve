# Handover — Mindcurve

Status per **2026-06-12**. Spelet är en Achtung die Kurve / Curve Fever-klon
brandad för Mindcamp (TypeScript + HTML5 Canvas + Vite, 1–8 spelare lokalt på
ett tangentbord eller över LAN). Allt nedan fungerar och är verifierat. Den här filen är
för att snabbt komma igång igen imorgon.

## Snabbstart

```sh
npm install
npm run dev      # lokalt spel på http://localhost:5173
npm run lan      # bygger + LAN-server på :3000 (eller dubbelklicka launcher, se nedan)
npm test         # 42 enhetstester (vitest)
npm run check    # tsc --noEmit
```

LAN-start för icke-tekniker: dubbelklicka **`Starta Mindcurve LAN.command`**
(Terminal-fönster, robust) eller **`Starta Mindcurve LAN.app`**. Detaljer i README.

## Arkitektur (snabborientering)

- `src/game/` — **ren, deterministisk simulering utan DOM**. `step(state, inputs)`
  muterar state. `pickView(state)` ger en serialiserbar `ViewState` som
  renderare/HUD/ljud konsumerar. **Samma kärna körs i webbläsaren (lokalt) och i
  Node av LAN-servern.** Determinism via seedad RNG (`rng.ts`) + fast 60 Hz-tick.
  - Viktig regel: `GameState` är strukturellt en `ViewState`, så lokalt läge
    skickar `GameState` direkt till renderaren (zero-copy). Lägger du ett fält på
    `ViewPlayer`/`ViewState` måste det också finnas på `PlayerState`/`GameState`,
    annars bryts den kopplingen (hände med `matchPoint` idag).
- `src/render/canvas.ts` — persistent spårlager + dynamiska objekt. Äger även
  klient-VFX (partiklar, skärmskak) via `observe(view)` som diffar ViewState.
- `src/audio/` — allt ljud syntetiseras (Web Audio, inga filer). `AudioDirector`
  diffar ViewState → musik + effekter (funkar identiskt lokalt/LAN). `MusicLoop`
  är en intensitetsstyrd sequencer.
- `src/ui/` — `lobby.ts` (lokal lobby + delade select-komponenter), `hud.ts`
  (poängpanel, kill feed, effekt-timers, matchboll, banners).
- `src/net/` — `protocol.ts` (meddelanden), `client.ts` (NetSession).
- `server/index.ts` — statisk filserver + WebSocket + auktoritativ 60 Hz-loop.

Verifieringsskript (Playwright, kräver att rätt server körs — se kommentar i varje):
`scripts/verify*.mjs`. De flesta använder dev-hooken `window.__achtung`
(`getGame`, `applyPowerUp`) som bara finns i `npm run dev`.

## Gjort idag (2026-06-11)

Hela dagens bygge, ungefär i ordning:

1. **Grundspelet** (etapp 1–4): deterministisk kärna, luckor, kollision via
   spatial grid, rundor + poäng, lobby (join/färg/tangenter), power-ups,
   scoreboard, paus.
2. **LAN-läge** (etapp 2): server kör kärnan auktoritativt, klienter skickar
   inputs + renderar snapshots.
3. **Poängmål-inställning** i lobbyn (Auto / fast värde), synkad över LAN.
4. **Enklare LAN-start**: `.app` + `.command` launcher.
5. **Ljud**: soundtrack + effekter, mute (M / knapp).
6. **Hetsigare musik**: 152→170 BPM, intensitet ökar med rundlängd + döda.
7. **Nya power-ups**: 🔫 kanon (skjut hål med vänster+höger samtidigt), 🍺 öl
   (skärmen gungar för alla), snyggare emoji-ikoner, unika ljud per power-up.
8. **Mindcamp-branding**: heter Mindcurve, loggan i lobby/favicon, och
   **⭐ Mindcamp-stjärnan** (Mario Kart-stjärna: odödlig 8 s, spränger spår,
   wrappar genom väggar — trumfar allt).
9. **Launcher-fix**: appen kördes som en frusen translocation-kopia (macOS
   `com.apple.provenance`). Löst med ad-hoc-signering + `.command`-fallback +
   absolut sökväg i skriptet. **OBS: redigerar du appens `run`-fil måste den
   signeras om:** `codesign --force --deep --sign - "Starta Mindcurve LAN.app"`
   (rensa FinderInfo först om codesign klagar:
   `find "Starta Mindcurve LAN.app" -exec xattr -c {} \;`).
10. **Auto-LAN-länk**: kollegor som öppnar nätverksadressen (inte localhost)
    hamnar direkt i LAN-lobbyn. `#lan` / `#local` tvingar valet.
11. **Game Designer-review** → byggde **hela prio 1**:
    - Dödsexplosion + skärmskak
    - Kill-attribution + kill feed ("X kraschade i Ys spår")
    - Krympande arena (sudden death), inställbar starttid (Av/30s/1m/**2m**/3m)
    - Effekt-timers i HUD (krympande stapel per aktiv effekt)
    - Matchboll (guld-markering + ljudstöt när någon kan vinna nästa runda)

## Gjort 2026-06-12

- **Statistikskärm vid matchslut** (första punkten ur prio 2):
  - `MatchStats` (`kills`, `suicides`, `powerups`, `bestSurvivalTicks`) på både
    `PlayerState` och `ViewPlayer` (strukturella regeln hålls), ackumuleras i
    kärnan över rundorna → LAN-läget får statistiken gratis via `pickView`.
  - Självmord = eget spår **+ vägg**; kills krediteras spårägaren (samma
    konvention som kill feeden).
  - HUD:en visar utmärkelser på matchOver-bannern: ⚔️ Bödeln (flest kills),
    ⏱️ Överlevaren (längsta rundöverlevnad), 🎁 Plockaren (flest power-ups),
    💀 Olycksfågeln (flest självmord). Delad förstaplats → "A & B". Kategorier
    med 0 hoppas över.
  - LAN-serverns matchOver-tid höjd 8 → 12 s så att man hinner läsa.
  - 4 nya enhetstester (27 totalt) + `scripts/verify-stats.mjs` (Playwright,
    kräver `npm run dev`). Skärmdump: `verify-shots/stats-1-matchover.png`.
- Telefon som handkontroll nedprioriterad till prio 3 (Elias beslut).
- **Power-up-viktning + toggles** (andra punkten ur prio 2) + balansfixen:
  - `weight` på `PowerUpDef` (10 = normal): ⭐ 4, 🍺/🚀 6, 🐌 7, 🔄/🧹/🌀 8,
    🔫/🎈 9, övriga 10. `spawnPowerUp` drar viktat via `drawPowerUpType`.
  - `disabledPowerups?: PowerUpType[]` i `GameSettings` — avstängda typer
    spawnar aldrig. Lobby-UI: emoji-chips (`createPowerUpToggles` i `lobby.ts`,
    delas av lokala lobbyn och LAN-lobbyn), nedtonade när de är av; hela raden
    döljs när power-ups är avbockat.
  - LAN: nytt klientmeddelande `powerupTypes` + `disabledPowerups` i
    lobby-broadcasten; servern validerar mot `ALL_POWERUP_TYPES`.
  - **Balans** (designerns anmärkning): `fast` 1.65→**1.5**, `slow`
    0.55→**0.65** (gäller både self/others-varianterna — de delar effekttyp),
    plus lägre vikt på `othersFast` och `selfSlow`.
  - 3 nya enhetstester (30 totalt) + `scripts/verify-putoggle.mjs` (dev) och
    `scripts/verify-putoggle-lan.mjs` (kräver `npm run lan`) — båda gröna.
- **Mindcamp-stjärnan förlängd** 4 → 8 s (Elias önskemål).
- **Designerns fem nya power-ups** (sista stora prio 2-punkten) — alla i den
  deterministiska kärnan + ViewState, funkar identiskt lokalt/LAN:
  - 🛡️ **Sköld** (self, 10 s, vikt 8): överlever exakt en träff. Spårträff →
    skölden konsumeras + kort flykt-spöke (`ESCAPE_GHOST_TICKS`); väggträff →
    studs (vinkeln speglas) + flykt-spöke (annars dör man i sitt eget spår på
    återvägen). Silverring runt huvudet.
  - 📐 **Fyrkantssvängar** (others, 5 s, vikt 8): kanttriggade 90°-knyckar i
    stället för kontinuerlig sväng (`leftWasHeld`/`rightWasHeld` på PlayerState).
    Vänster+höger samtidigt tar ut varandra, så kanonen krockar inte.
  - 🔁 **Platsbyte** (vikt 7): byter x/y/vinkel med slumpad levande motspelare
    (seedad rng → deterministiskt), båda får flykt-spöke.
  - 💣 **Mina** (vikt 9): apteras där den plockas, armeras efter 1,5 s
    (nedräkningsring → pulserande röd), dödlig radie 9, spränger spår i radie 26.
    Kill till ägaren via ny `KillCause`-variant `{ mine: ownerId }` (egen mina =
    självmord). Spöke glider förbi; stjärna/sköld desarmerar utan död. Egen
    feed-text ("sprängdes av Xs mina").
  - 🌑 **Mörker** (others, 6 s, stack-tak 12 s, vikt 6): `darkTicks` +
    `darkOwner` i state; renderaren lägger ett svart offscreen-lager där **bara
    plockaren får en ljuscirkel** — alla andra ser sina huvudprickar (ritas
    ovanpå lagret) men inte spåren runt sig. Funkar likadant på delad skärm och
    LAN eftersom ljuset följer plockarens position, inte skärmen. Minor syns
    INTE i mörkret — medvetet elakt. (Ändrat 2026-06-12: var först globalt med
    ljus runt alla.)
  - Alla fem har egna pickup-ljud i `AudioDirector`. Minexplosion återanvänder
    blast-ljudet/gnistorna via `freshHoles`-diffen.
  - 7 nya enhetstester (37 totalt) + `scripts/verify-newpowerups.mjs` (dev).
    Toggle-skripten uppdaterade till 17 chips.
- **Hover-tooltips på power-up-chipsen i lobbyn** (lokalt + LAN): egen CSS-
  tooltip via `data-tip` (`.pu-toggle::after`), visar förklaringen ur
  `PowerUpDef.label` + av/på-läget. Nedtoningen av avstängda chips flyttad till
  inre `.pu-icon`-spannen så att tooltipen inte ärver den.
  Verifieras av `scripts/verify-tooltip.mjs` (dev).
- **Botspelare** (sista prio 2-punkten — prio 2 är nu HELT klar):
  - `src/game/bot.ts`: `botInput(state, playerId)` — ren funktion
    `GameState → PlayerInput` utanför kärnan, helt deterministisk (ingen slump).
    Provkör vänster/rakt/höger `LOOKAHEAD` (55) tick framåt mot grid + väggar +
    minor, väljer friaste vägen; styr mot närmaste power-up när det är fritt;
    skjuter kanonen när alla vägar < 18 tick (en kula i taget); förflippar
    inputen vid omvända kontroller; specialfall för 90°-svängar.
  - Lokalt: "🤖 Lägg till bot"-knapp på lediga lobby-platser, botnamn ur
    `BOT_NAMES` (Botvid, Robotina, Kurvator …). `main.ts` byter ut tangent-
    input mot `botInput` för botindex.
  - LAN: `addBot`/`removeBot` i protokollet, `bot`-flagga på `LobbyPlayer`.
    Servern äger bottarna (pseudo-klienter i `botPlayers`), kör `botInput` i
    sin tick-loop. **En ensam människa + bottar räcker för matchstart**; bara
    bottar kvar (sista människan lämnar) → matchen avslutas.
  - 3 nya enhetstester (41 totalt: botten väjer för väggen, vinner mot rak
    motståndare) + `scripts/verify-bots.mjs` (dev) och
    `scripts/verify-bots-lan.mjs` (LAN) — alla gröna.
- **Svårighetsslider för bottarna** (Elias önskemål): 5 nivåer — Lullig, Lätt,
  Lagom (default), Svår, Elak. Nivån styr lookahead (12/22/34/45/55 tick);
  nivå < 3 jagar inte power-ups, nivå < 2 skjuter inte kanonen.
  `createBotLevelSlider` i `lobby.ts` delas av båda lobbyerna och visas bara
  när minst en bot finns. LAN: `botLevel` i protokollet (klientmeddelande +
  lobby-broadcast), servern validerar 1–5. OBS: slidern skickar på `change`
  (släpp), inte `input` — annars avbryter LAN-broadcastens omritning draget.
  +1 enhetstest (42 totalt: nivå 1 väjer senare än nivå 5).
- **Upp till 8 spelare** (prio 3-punkten "Fler än 4 spelare"):
  - `PLAYER_COLORS` utökad till 8 (+ lila, turkos, rosa, orange) och ny
    `MAX_PLAYERS = PLAYER_COLORS.length` — färglistans längd ÄR spelartaket,
    allt annat (lobby-slots, serverns `freeSlot`, HUD) följer den.
  - 4 nya tangentpar i `DEFAULT_BINDINGS` (Q/W, T/Y, O/P, komma/punkt).
    **OBS:** många tangentbord klarar bara ~6 samtidiga tangenter (ghosting) —
    fler än 4 lokala spelare bör köra LAN. 8 är medvetet tak: fler färger blir
    svåra att skilja åt och arenan trång.
  - Startpositionernas minavstånd sänks 200→130 px vid >4 spelare, annars
    misslyckas placeringsförsöken ofta. Auto-poängmål skalar redan (8 → 70).
  - Verifierat: `scripts/verify-8players.mjs` (dev, lobby + 8 unika maskar) och
    `scripts/verify-8players-lan.mjs` (6 klienter över LAN). *Fallgrop vid
    skriptkörning: en kvarglömd gammal server på :3000 svarar `full` efter
    4 spelare — pkill:a innan.*

## Game Designer-listan — vad som är KVAR

Prio 1 och prio 2 är HELT klara. Kvarstår:

### Prio 3
- **Telefon som handkontroll** — nätklienten skickar redan bara `{left, right}`.
  Touch-vy med två knappytor = nästan gratis och stort partyvärde. *Nedprioriterad
  från rekommendation 2026-06-12, tas senare.*
- **Lagläge (2v2)** — poäng/rundslutslogik + lobbyval.
- **Rund-mutatorer** — var 3:e runda (seedat) en modifierare (dubbel fart, inga
  luckor, permanent wrap). Billig variation av befintliga parametrar.

### Prio 4 (polish)
- **Spår-snapshot vid LAN-återanslutning** — laddar man om mitt i en runda är
  spårlagret tomt (servern skickar bara `freshTrail`).
- **Spara lokala lobbyinställningar** i localStorage (nätlobbyn sparar redan namn).
- **Gamepad-stöd** — `Keyboard`-abstraktionen är rätt snitt.
- **Konfetti + pallceremoni** vid matchvinst.

### Balansanmärkning (från designern) — ÅTGÄRDAD 2026-06-12
`othersFast` var dubbelt straffande och `selfSlow` för stark. Fixat via mildare
multiplikatorer (`fast` 1.5×, `slow` 0.65×) + lägre spawn-vikter. Finjustera
gärna efter speltest på plats.

## Min rekommendation för nästa pass

1. **Speltesta!** Hela prio 1+2 är byggd men otestad av människor: power-up-
   vikter/tider, bottarnas svårighetsgrad (`LOOKAHEAD` är ratten — kortare =
   dummare bot) och 8-spelarkaoset behöver riktiga händer.
2. **Telefon som handkontroll** — löser ghosting-problemet som nu är flaskhalsen
   för stora lokala sällskap (tangentbord klarar ~6 samtidiga tangenter).

Designerns agent-id för uppföljningsfrågor (om sessionen lever): `af4f019583fe2df33`.
