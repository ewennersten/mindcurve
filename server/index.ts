// LAN-server för Achtung: serverar den byggda klienten (dist/) över HTTP och
// kör den auktoritativa simuleringen — samma deterministiska kärna som det
// lokala spelet (src/game/) — och broadcastar varje tick till klienterna.
import { exec } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { BOT_NAMES, botInput, DEFAULT_BOT_LEVEL } from '../src/game/bot'
import { createGame, pickView, startRound, step } from '../src/game/core'
import { ALL_POWERUP_TYPES } from '../src/game/powerups'
import { type GameSettings, type GameState, type PlayerInput, type PowerUpType, MAX_PLAYERS, PLAYER_COLORS, TPS } from '../src/game/state'
import { type ClientMsg, type LobbyPlayer, type ServerMsg, DEFAULT_PORT, WS_PATH } from '../src/net/protocol'

const DIST = join(fileURLToPath(import.meta.url), '../../dist')
const PORT = Number(process.env.PORT ?? DEFAULT_PORT)

// ── Statisk filserver för klienten ─────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const httpServer = createServer((req, res) => {
  lastActivity = Date.now()
  const url = (req.url ?? '/').split('?')[0]
  // normalize + join hindrar path traversal utanför dist/
  let file = join(DIST, normalize(url).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

// ── Lobby och anslutningar ─────────────────────────────────────

interface Client {
  ws: WebSocket
  slot: number
  name: string
  /** Valfri emoji vid masken */
  avatar: string
  ready: boolean
  input: PlayerInput
  /** Index i game.players under pågående match, annars -1 */
  playerIndex: number
  /** Serverstyrd bot (inget ws-objekt används) — input hämtas från botInput() */
  bot?: boolean
}

const clients = new Set<Client>()
/** Serverstyrda botspelare — upptar slots och deltar i matcher, alltid redo */
const botPlayers: Client[] = []
let lastActivity = Date.now()
let powerupsEnabled = true
let disabledPowerups: PowerUpType[] = []
let botLevel = DEFAULT_BOT_LEVEL
let targetScore: GameSettings['targetScore'] = 'auto'
let shrinkAfterSec: GameSettings['shrinkAfterSec'] = 30
let game: GameState | null = null
let participants: Client[] = []
let phaseTimer = 0
let pendingClear = false

function lanUrls(): string[] {
  const urls: string[] = []
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) urls.push(`http://${iface.address}:${PORT}`)
    }
  }
  return urls.length > 0 ? urls : [`http://localhost:${PORT}`]
}

function broadcast(msg: ServerMsg): void {
  const data = JSON.stringify(msg)
  for (const c of clients) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data)
  }
}

function broadcastLobby(): void {
  const players: LobbyPlayer[] = [...clients, ...botPlayers]
    .sort((a, b) => a.slot - b.slot)
    .map((c) => ({ slot: c.slot, name: c.name, avatar: c.avatar, ready: c.ready, bot: c.bot }))
  broadcast({
    t: 'lobby',
    players,
    powerups: powerupsEnabled,
    disabledPowerups,
    target: targetScore,
    shrink: shrinkAfterSec,
    botLevel,
    inGame: game !== null,
  })
}

function freeSlot(): number {
  const taken = new Set([...clients, ...botPlayers].map((c) => c.slot))
  for (let s = 0; s < MAX_PLAYERS; s++) if (!taken.has(s)) return s
  return -1
}

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH })

wss.on('connection', (ws) => {
  lastActivity = Date.now()
  const slot = freeSlot()
  if (slot === -1) {
    ws.send(JSON.stringify({ t: 'full' } satisfies ServerMsg))
    ws.close()
    return
  }
  const client: Client = {
    ws,
    slot,
    name: `Spelare ${slot + 1}`,
    avatar: '',
    ready: false,
    input: { left: false, right: false },
    playerIndex: -1,
  }
  clients.add(client)
  ws.send(JSON.stringify({ t: 'welcome', slot, urls: lanUrls() } satisfies ServerMsg))
  broadcastLobby()
  console.log(`+ ${client.name} anslöt (${clients.size} anslutna)`)

  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    switch (msg.t) {
      case 'name':
        client.name = String(msg.name).trim().slice(0, 12) || client.name
        broadcastLobby()
        break
      case 'avatar':
        client.avatar = String(msg.avatar).trim().slice(0, 8)
        broadcastLobby()
        break
      case 'ready':
        if (!game) {
          client.ready = Boolean(msg.ready)
          broadcastLobby()
          maybeStart()
        }
        break
      case 'input':
        client.input = { left: Boolean(msg.left), right: Boolean(msg.right) }
        break
      case 'powerups':
        if (!game) {
          powerupsEnabled = Boolean(msg.enabled)
          broadcastLobby()
        }
        break
      case 'powerupTypes':
        if (!game && Array.isArray(msg.disabled)) {
          // Släpp bara igenom kända typer
          disabledPowerups = ALL_POWERUP_TYPES.filter((t) => msg.disabled.includes(t))
          broadcastLobby()
        }
        break
      case 'addBot': {
        if (game) break
        const botSlot = freeSlot()
        if (botSlot === -1) break
        botPlayers.push({
          ws: null as unknown as WebSocket, // används aldrig — bots broadcastas inte till
          slot: botSlot,
          name: BOT_NAMES[botSlot % BOT_NAMES.length],
          avatar: '🤖',
          ready: true,
          input: { left: false, right: false },
          playerIndex: -1,
          bot: true,
        })
        broadcastLobby()
        maybeStart() // alla människor kan redan vara redo
        break
      }
      case 'removeBot': {
        if (game) break
        const i = botPlayers.findIndex((b) => b.slot === msg.slot)
        if (i >= 0) {
          botPlayers.splice(i, 1)
          broadcastLobby()
        }
        break
      }
      case 'botLevel':
        if (!game && Number.isFinite(msg.level) && msg.level >= 1 && msg.level <= 5) {
          botLevel = Math.round(msg.level)
          broadcastLobby()
        }
        break
      case 'target':
        if (!game && (msg.target === 'auto' || (Number.isFinite(msg.target) && msg.target >= 1))) {
          targetScore = msg.target
          broadcastLobby()
        }
        break
      case 'shrink':
        if (!game && (msg.shrink === 'off' || (Number.isFinite(msg.shrink) && msg.shrink >= 5 && msg.shrink <= 600))) {
          shrinkAfterSec = msg.shrink
          broadcastLobby()
        }
        break
    }
  })

  ws.on('close', () => {
    lastActivity = Date.now()
    clients.delete(client)
    console.log(`- ${client.name} lämnade (${clients.size} anslutna)`)
    if (game && client.playerIndex >= 0) {
      // Döda den frånkopplades mask; rundslutslogiken i step() tar det därifrån
      game.players[client.playerIndex].alive = false
      participants = participants.filter((c) => c !== client)
      // Bara bottar kvar → ingen tittar, avsluta matchen
      if (!participants.some((c) => !c.bot)) endGame()
    }
    broadcastLobby()
  })
})

// ── Matchen ────────────────────────────────────────────────────

function maybeStart(): void {
  if (game) return
  // Alla anslutna människor redo, minst en människa, och minst två deltagare
  // totalt (bottar räknas) — en ensam spelare kan alltså möta bara bottar
  const ready = [...clients].filter((c) => c.ready)
  if (ready.length === 0 || ready.length !== clients.size) return
  if (ready.length + botPlayers.length < 2) return
  participants = [...ready, ...botPlayers].sort((a, b) => a.slot - b.slot)
  participants.forEach((c, i) => (c.playerIndex = i))
  game = createGame(
    participants.map((c) => ({ name: c.name, color: PLAYER_COLORS[c.slot], avatar: c.avatar })),
    Date.now() >>> 0,
    { powerupsEnabled, disabledPowerups, targetScore, shrinkAfterSec },
  )
  startRound(game)
  pendingClear = true
  phaseTimer = 0
  broadcastLobby() // markera inGame för ev. sena anslutningar
  console.log(`Match startad: ${participants.map((c) => c.name).join(', ')}`)
}

function endGame(): void {
  game = null
  participants = []
  for (const c of clients) {
    c.ready = false
    c.playerIndex = -1
  }
  broadcastLobby()
  console.log('Tillbaka till lobbyn')
}

/** En servertick på 60 Hz — speglar tickGame() i klientens lokala läge. */
function serverTick(): void {
  if (!game) return
  const g = game

  if (g.phase === 'countdown' || g.phase === 'playing') {
    const inputs: PlayerInput[] = participants.map((c) => (c.bot ? botInput(g, c.playerIndex, botLevel) : c.input))
    step(g, inputs)
    if (g.flags.clearedTrails) pendingClear = true
  } else if (g.phase === 'roundOver') {
    phaseTimer++
    if (phaseTimer >= TPS * 3.5) {
      phaseTimer = 0
      if (g.matchWinner != null) {
        g.phase = 'matchOver'
      } else {
        startRound(g)
        pendingClear = true
      }
    }
  } else if (g.phase === 'matchOver') {
    phaseTimer++
    // 12 s — slutskärmen visar även matchstatistiken, ge tid att läsa
    if (phaseTimer >= TPS * 12) {
      endGame()
      return
    }
  }

  broadcast({ t: 'tick', v: pickView(g), clear: pendingClear })
  pendingClear = false
}

// Driftkorrigerad 60 Hz-loop (setInterval driver iväg över tid)
const TICK_MS = 1000 / TPS
let nextTick = performance.now()
function loop(): void {
  const now = performance.now()
  while (nextTick <= now) {
    serverTick()
    nextTick += TICK_MS
  }
  setTimeout(loop, Math.max(0, nextTick - performance.now()))
}

// Stäng av oss själva när servern stått helt oanvänd länge, så att en server
// startad via appen (utan terminal) inte blir en kvarglömd bakgrundsprocess.
const IDLE_SHUTDOWN_MS = 30 * 60_000
setInterval(() => {
  if (clients.size === 0 && Date.now() - lastActivity > IDLE_SHUTDOWN_MS) {
    console.log('Ingen aktivitet på 30 minuter — stänger av servern.')
    process.exit(0)
  }
}, 60_000)

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} är upptagen — kör appen "Starta Mindcurve LAN" igen (den stänger gamla processer), eller: kill $(lsof -ti tcp:${PORT})`)
  } else {
    console.error('Servern kunde inte starta:', err)
  }
  process.exit(1)
})

httpServer.listen(PORT, () => {
  console.log('Mindcurve LAN-server igång!')
  for (const url of lanUrls()) console.log(`  → ${url}`)
  console.log('Dela adressen med de andra spelarna på samma nätverk.')
  // Öppna värdens webbläsare automatiskt (NO_OPEN=1 stänger av, t.ex. i tester)
  if (process.platform === 'darwin' && !process.env.NO_OPEN) {
    exec(`open http://localhost:${PORT}/`)
  }
  loop()
})
