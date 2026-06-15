import './style.css'
import logoUrl from '../logo/mindcamp_logo.png'
import { AudioDirector } from './audio/director'
import { botInput, DEFAULT_BOT_LEVEL } from './game/bot'
import { createGame, startRound, step } from './game/core'
import type { GameState, Phase } from './game/state'
import { type KeyBinding, Keyboard } from './input/keyboard'
import { NetSession } from './net/client'
import { Renderer } from './render/canvas'
import { Hud } from './ui/hud'
import { Lobby } from './ui/lobby'

// Favicon från Mindcamp-loggan (bundlas av Vite, funkar även i LAN-bygget)
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = logoUrl
document.head.append(favicon)

const keyboard = new Keyboard()
const renderer = new Renderer(document.getElementById('field') as HTMLCanvasElement)
const lobby = new Lobby(keyboard)
const hud = new Hud()
const audio = new AudioDirector()
const net = new NetSession(keyboard, renderer, hud, audio, () => lobby.show())

// AudioContext kräver en användargest — lås upp på första interaktionen
window.addEventListener('pointerdown', () => audio.unlock())
window.addEventListener('keydown', () => audio.unlock())

const muteBtn = document.getElementById('mute') as HTMLButtonElement
function syncMuteBtn(): void {
  muteBtn.textContent = audio.muted ? '🔇' : '🔊'
}
muteBtn.addEventListener('click', () => {
  audio.toggleMuted()
  syncMuteBtn()
  muteBtn.blur() // annars triggar SPACE knappen igen
})
syncMuteBtn()

lobby.onLan = () => {
  lobby.hide()
  net.start()
}

// Kollegor öppnar nätverksadressen (t.ex. http://192.168.1.217:3000) och ska
// hamna direkt i LAN-lobbyn. Värddatorn öppnar via localhost och får den vanliga
// menyn med val mellan lokalt spel och LAN. Hash-flaggor tvingar valet:
//   #lan   → alltid LAN-lobbyn   #local → alltid vanliga menyn
function openedFromNetwork(): boolean {
  const h = location.hostname
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1' && h !== '::1'
}
if (location.hash !== '#local' && (location.hash === '#lan' || openedFromNetwork())) {
  lobby.hide()
  net.start()
}

let game: GameState | null = null
let bindings: KeyBinding[] = []
/** Vilka spelarindex som är botstyrda — deras input hämtas från botInput() */
let bots: boolean[] = []
let botLevel = DEFAULT_BOT_LEVEL
let paused = false
/** Kort spärr efter rundslut så att ett paniktryck på space inte hoppar förbi resultatet */
let bannerLockTicks = 0

lobby.onStart = (players, settings, level) => {
  bindings = players.map((p) => p.binding)
  bots = players.map((p) => p.bot)
  botLevel = level
  game = createGame(players, Date.now() >>> 0, settings)
  startRound(game)
  renderer.clearTrails()
  paused = false
  lobby.hide()
  hud.show()
}

function tickGame(g: GameState): void {
  if (g.phase === 'countdown' || g.phase === 'playing') {
    const inputs = keyboard.inputsFor(bindings)
    for (let i = 0; i < inputs.length; i++) {
      if (bots[i]) inputs[i] = botInput(g, i, botLevel)
    }
    step(g, inputs)
    renderer.applyFresh(g)
    if (g.flags.clearedTrails) renderer.clearTrails()
    // step() kan ha ändrat fasen — kringgå TS:s narrowing av g.phase
    if ((g.phase as Phase) === 'roundOver') bannerLockTicks = 45
    renderer.observe(g)
    audio.observe(g)
    return
  }

  if (bannerLockTicks > 0) {
    bannerLockTicks--
    return
  }
  if (!keyboard.consumePress('Space')) return

  if (g.phase === 'roundOver') {
    if (g.matchWinner != null) {
      g.phase = 'matchOver'
      bannerLockTicks = 30
    } else {
      startRound(g)
      renderer.clearTrails()
    }
    audio.observe(g)
  } else if (g.phase === 'matchOver') {
    game = null
    hud.hide()
    lobby.show()
    audio.reset()
  }
}

const DT = 1000 / 60
let acc = 0
let last = performance.now()

function frame(now: number): void {
  acc += now - last
  last = now
  if (acc > 250) acc = 250 // undvik dödsspiral efter att fliken legat i bakgrunden

  // Kanttriggade tryck får bara rensas när någon faktiskt hunnit konsumera dem —
  // annars kan ett SPACE-tryck försvinna i en frame som inte hann köra någon tick.
  let consumersRan = true

  if (net.active) {
    acc = 0
    net.update()
  } else if (game) {
    if (keyboard.consumePress('Escape') && (game.phase === 'playing' || game.phase === 'countdown')) {
      paused = !paused
      audio.setMusicPaused(paused)
    }
    if (paused) {
      acc = 0
    } else {
      consumersRan = false
      while (acc >= DT) {
        acc -= DT
        consumersRan = true
        tickGame(game)
        if (!game) break // matchen avslutades → tillbaka till lobbyn
      }
    }
    if (game) {
      renderer.draw(game)
      hud.update(game, paused)
    }
  } else {
    acc = 0
    lobby.update()
  }

  // M = mute, men bara när tangenten inte kan vara en styrtangent
  const mFree = game ? !bindings.some((b) => b.left === 'KeyM' || b.right === 'KeyM') : net.active
  if (mFree && keyboard.consumePress('KeyM')) {
    audio.toggleMuted()
    syncMuteBtn()
  }

  if (consumersRan) keyboard.flushPresses()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// Dev-hook för e2e-skripten (scripts/verify-*.mjs) — försvinner ur produktionsbygget
if (import.meta.env.DEV) {
  void import('./game/powerups').then((powerups) => {
    ;(window as unknown as Record<string, unknown>).__achtung = {
      getGame: () => game,
      applyPowerUp: powerups.applyPowerUp,
    }
  })
}
