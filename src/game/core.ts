import { SegmentGrid, segCircleHit } from './collision'
import { ESCAPE_GHOST_TICKS, checkPowerUpPickups, spawnPowerUp } from './powerups'
import { Rng } from './rng'
import {
  type GameSettings,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type ViewState,
  COUNTDOWN_TICKS,
  derivedStats,
  FIELD_H,
  FIELD_W,
  MAX_POWERUPS,
  TPS,
  TURN_RATE,
} from './state'

export interface PlayerSetup {
  name: string
  color: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function resolveTargetScore(playerCount: number, setting: GameSettings['targetScore']): number {
  if (setting === 'auto') return Math.max(10 * (playerCount - 1), 10)
  return Math.max(1, Math.floor(setting))
}

/** Sätter `matchPoint` på spelarna: sant för den/de ledande vars poäng är inom
 *  en rundas maxpoäng från målet — dvs kan vinna matchen nästa runda. */
function applyMatchPoint(g: GameState): void {
  if (g.players.length < 2) {
    for (const p of g.players) p.matchPoint = false
    return
  }
  const maxRound = g.players.length - 1 // mest man kan få på en runda
  const maxScore = Math.max(...g.players.map((p) => p.score))
  for (const p of g.players) {
    p.matchPoint = p.score === maxScore && p.score >= g.targetScore - maxRound
  }
}

/** Serialiserbar ögonblicksbild för nätverksklienter (LAN-läget). */
export function pickView(g: GameState): ViewState {
  return {
    phase: g.phase,
    tick: g.tick,
    countdown: g.countdown,
    wrapTicks: g.wrapTicks,
    wobbleTicks: g.wobbleTicks,
    darkTicks: g.darkTicks,
    darkOwner: g.darkOwner,
    wallInset: r2(g.wallInset),
    targetScore: g.targetScore,
    roundWinner: g.roundWinner,
    matchWinner: g.matchWinner,
    powerups: g.powerups,
    mines: g.mines.map((m) => ({ ...m, x: r2(m.x), y: r2(m.y) })),
    bullets: g.bullets.map((b) => ({ ...b, x: r2(b.x), y: r2(b.y), angle: Math.round(b.angle * 1000) / 1000 })),
    freshHoles: g.freshHoles,
    freshTrail: g.freshTrail.map((f) => ({
      playerId: f.playerId,
      x1: r2(f.x1),
      y1: r2(f.y1),
      x2: r2(f.x2),
      y2: r2(f.y2),
      width: r2(f.width),
    })),
    players: g.players.map((p) => ({
      name: p.name,
      color: p.color,
      x: r2(p.x),
      y: r2(p.y),
      angle: Math.round(p.angle * 1000) / 1000,
      alive: p.alive,
      score: p.score,
      effects: p.effects,
      ammo: p.ammo,
      killedBy: p.killedBy,
      matchPoint: p.matchPoint,
      matchStats: p.matchStats,
    })),
  }
}

export function createGame(setups: PlayerSetup[], seed: number, settings: GameSettings): GameState {
  const players: PlayerState[] = setups.map((s, i) => ({
    id: i,
    name: s.name,
    color: s.color,
    x: 0,
    y: 0,
    angle: 0,
    dist: 0,
    alive: true,
    score: 0,
    effects: [],
    gapLeft: 0,
    nextGapIn: 0,
    ammo: 0,
    fireWasHeld: false,
    leftWasHeld: false,
    rightWasHeld: false,
    killedBy: null,
    matchPoint: false,
    matchStats: { kills: 0, suicides: 0, powerups: 0, bestSurvivalTicks: 0 },
  }))
  return {
    phase: 'countdown',
    tick: 0,
    countdown: COUNTDOWN_TICKS,
    players,
    grid: new SegmentGrid(),
    powerups: [],
    bullets: [],
    mines: [],
    nextPowerUpIn: 0,
    wrapTicks: 0,
    wobbleTicks: 0,
    darkTicks: 0,
    darkOwner: null,
    wallInset: 0,
    roundTick: 0,
    freshHoles: [],
    targetScore: resolveTargetScore(setups.length, settings.targetScore),
    rng: new Rng(seed),
    nextId: 1,
    freshTrail: [],
    flags: { clearedTrails: false },
    settings,
    roundWinner: null,
    matchWinner: null,
  }
}

export function startRound(state: GameState): void {
  state.phase = 'countdown'
  state.countdown = COUNTDOWN_TICKS
  state.grid.clear()
  state.powerups = []
  state.bullets = []
  state.mines = []
  state.wrapTicks = 0
  state.wobbleTicks = 0
  state.darkTicks = 0
  state.darkOwner = null
  state.wallInset = 0
  state.roundTick = 0
  state.freshTrail = []
  state.freshHoles = []
  state.flags.clearedTrails = true
  state.roundWinner = null
  state.nextPowerUpIn = TPS * 3 + state.rng.int(0, TPS * 2)

  const placed: PlayerState[] = []
  // Med många spelare får kravet på inbördes startavstånd ge med sig lite,
  // annars misslyckas placeringsförsöken ofta och starterna blir trånga ändå
  const minDist = state.players.length > 4 ? 130 : 200
  for (const p of state.players) {
    p.alive = true
    p.effects = []
    p.dist = 0
    p.ammo = 0
    p.fireWasHeld = false
    p.leftWasHeld = false
    p.rightWasHeld = false
    p.killedBy = null
    p.gapLeft = 0
    p.nextGapIn = state.rng.range(150, 350)
    // Slumpa startposition, men håll avstånd till redan placerade spelare
    for (let attempt = 0; attempt < 12; attempt++) {
      p.x = state.rng.range(150, FIELD_W - 150)
      p.y = state.rng.range(130, FIELD_H - 130)
      const crowded = placed.some((q) => {
        const dx = q.x - p.x
        const dy = q.y - p.y
        return dx * dx + dy * dy < minDist * minDist
      })
      if (!crowded) break
    }
    p.angle = state.rng.range(0, Math.PI * 2)
    placed.push(p)
  }

  // Matchboll utifrån poängen som bärs över från föregående runda
  applyMatchPoint(state)
}

const BULLET_SPEED = 7
const BULLET_RADIUS = 4
const BLAST_RADIUS = 18
/** Sprängradie när Mindcamp-stjärnan kör genom ett spår */
const STAR_BLAST_RADIUS = 20
/** Dödlig radie för en armerad mina */
export const MINE_RADIUS = 9
/** Minans sprängradie — spränger även bort spår, som kanonkulan */
const MINE_BLAST_RADIUS = 26
/** px per tick som väggarna kryper inåt (≈ 7 px/s) */
const SHRINK_RATE = 0.12
/** Krymp aldrig längre än så här — det ska gå att överleva i mitten */
export const MAX_WALL_INSET = Math.min(FIELD_W, FIELD_H) / 2 - 90

/** Förbruka spelarens sköld (ta bort effekten — den räddar exakt en träff). */
function consumeShield(p: PlayerState): void {
  const i = p.effects.findIndex((e) => e.type === 'shield')
  if (i >= 0) p.effects.splice(i, 1)
}

/** Detonera minan på index `i`: spräng hål i spåren och ta bort den. */
function detonateMine(state: GameState, i: number): void {
  const m = state.mines[i]
  for (const seg of state.grid.queryCircle(m.x, m.y, MINE_BLAST_RADIUS)) {
    if (segCircleHit(seg, m.x, m.y, MINE_BLAST_RADIUS)) seg.dead = true
  }
  state.freshHoles.push({ x: m.x, y: m.y, r: MINE_BLAST_RADIUS })
  state.mines.splice(i, 1)
}

/** Flytta kanonkulor och spräng hål i spår de träffar. */
function stepBullets(state: GameState): void {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i]
    b.ttl--
    const dx = Math.cos(b.angle)
    const dy = Math.sin(b.angle)

    // Två delsteg per tick så att kulan inte tunnlar genom tunna spår
    let hit = false
    for (const sub of [0.5, 1]) {
      const x = b.x + dx * BULLET_SPEED * sub
      const y = b.y + dy * BULLET_SPEED * sub
      for (const seg of state.grid.queryCircle(x, y, BULLET_RADIUS)) {
        if (seg.dead) continue
        // Skyttens spår nära avfyrningsögonblicket (svansen) räknas inte
        if (seg.playerId === b.playerId && seg.endDist > b.spawnDist - 25) continue
        if (segCircleHit(seg, x, y, BULLET_RADIUS)) {
          hit = true
          break
        }
      }
      if (hit) {
        // Spräng hålet: döda alla segment inom sprängradien
        for (const seg of state.grid.queryCircle(x, y, BLAST_RADIUS)) {
          if (segCircleHit(seg, x, y, BLAST_RADIUS)) seg.dead = true
        }
        state.freshHoles.push({ x, y, r: BLAST_RADIUS })
        break
      }
      b.x = x
      b.y = y
    }

    const inset = state.wallInset
    const outside = b.x < inset || b.x > FIELD_W - inset || b.y < inset || b.y > FIELD_H - inset
    if (hit || outside || b.ttl <= 0) state.bullets.splice(i, 1)
  }
}

export function step(state: GameState, inputs: PlayerInput[]): void {
  state.tick++
  state.freshTrail = []
  state.freshHoles = []
  state.flags.clearedTrails = false

  if (state.phase === 'countdown') {
    // Spelarna får sikta (svänga på stället) under nedräkningen
    for (const p of state.players) {
      const input = inputs[p.id]
      if (!input) continue
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
      p.angle += dir * TURN_RATE
    }
    state.countdown--
    if (state.countdown <= 0) state.phase = 'playing'
    return
  }
  if (state.phase !== 'playing') return

  state.roundTick++

  // Sudden death: efter inställd tid kryper väggarna inåt
  if (state.settings.shrinkAfterSec !== 'off' && state.roundTick > state.settings.shrinkAfterSec * TPS) {
    state.wallInset = Math.min(state.wallInset + SHRINK_RATE, MAX_WALL_INSET)
    // Plocka bort power-ups och minor som hamnat utanför de nya väggarna
    const m = state.wallInset + 20
    state.powerups = state.powerups.filter(
      (pu) => pu.x > m && pu.x < FIELD_W - m && pu.y > m && pu.y < FIELD_H - m,
    )
    state.mines = state.mines.filter((mi) => mi.x > m && mi.x < FIELD_W - m && mi.y > m && mi.y < FIELD_H - m)
  }

  const diedNow: number[] = []

  for (const p of state.players) {
    if (!p.alive) continue
    const stats = derivedStats(p)
    /** Sköldladdning kvar denna tick — sätts false när den förbrukas */
    let shieldLeft = stats.shield
    const input = inputs[p.id] ?? { left: false, right: false }
    if (stats.square) {
      // Fyrkantssvängar: kanttriggade 90°-knyckar i stället för kontinuerlig sväng
      let turn = (input.right && !p.rightWasHeld ? 1 : 0) - (input.left && !p.leftWasHeld ? 1 : 0)
      if (stats.reversed) turn = -turn
      p.angle += (turn * Math.PI) / 2
    } else {
      let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
      if (stats.reversed) dir = -dir
      p.angle += dir * TURN_RATE
    }
    p.leftWasHeld = input.left
    p.rightWasHeld = input.right

    // Kanonen: vänster + höger samtidigt avfyrar (kanttriggat)
    const bothHeld = input.left && input.right
    if (bothHeld && !p.fireWasHeld && p.ammo > 0) {
      p.ammo--
      state.bullets.push({
        id: state.nextId++,
        playerId: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        ttl: 130,
        spawnDist: p.dist,
      })
    }
    p.fireWasHeld = bothHeld

    const px = p.x
    const py = p.y
    p.x += Math.cos(p.angle) * stats.speed
    p.y += Math.sin(p.angle) * stats.speed
    p.dist += stats.speed

    // Luckor i spåret
    let inGap = false
    if (p.gapLeft > 0) {
      p.gapLeft -= stats.speed
      inGap = true
      if (p.gapLeft <= 0) p.nextGapIn = state.rng.range(180, 420)
    } else {
      p.nextGapIn -= stats.speed
      if (p.nextGapIn <= 0) {
        p.gapLeft = stats.halfWidth * 6 + 14
        inGap = true
      }
    }

    // Väggar (ev. inkrupna av sudden death): död, eller wrap-around om
    // den globala power-upen är aktiv — eller om spelaren har Mindcamp-
    // stjärnan, som trumfar allt
    let died = false
    let teleported = false
    const r = stats.halfWidth
    const minX = state.wallInset + r
    const maxX = FIELD_W - state.wallInset - r
    const minY = state.wallInset + r
    const maxY = FIELD_H - state.wallInset - r
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
      if (state.wrapTicks > 0 || stats.star) {
        if (p.x < minX) p.x += maxX - minX
        else if (p.x > maxX) p.x -= maxX - minX
        if (p.y < minY) p.y += maxY - minY
        else if (p.y > maxY) p.y -= maxY - minY
        teleported = true
      } else if (shieldLeft) {
        // Skölden räddar: studsa mot väggen i stället för att dö. Kort spöke
        // behövs — studsen vänder spelaren rakt mot det egna färska spåret.
        shieldLeft = false
        consumeShield(p)
        p.effects.push({ type: 'ghost', ticksLeft: ESCAPE_GHOST_TICKS, ticksTotal: ESCAPE_GHOST_TICKS })
        if (p.x < minX) {
          p.x = minX + (minX - p.x)
          p.angle = Math.PI - p.angle
        } else if (p.x > maxX) {
          p.x = maxX - (p.x - maxX)
          p.angle = Math.PI - p.angle
        }
        if (p.y < minY) {
          p.y = minY + (minY - p.y)
          p.angle = -p.angle
        } else if (p.y > maxY) {
          p.y = maxY - (p.y - maxY)
          p.angle = -p.angle
        }
        teleported = true // lägg ingen spårbit över studsen
      } else {
        died = true
        p.killedBy = 'wall'
      }
    }

    // Lägg spårsegment (inte i luckor, som spöke eller över en wrap)
    if (!died && !inGap && !stats.ghost && !teleported) {
      const seg = {
        id: state.nextId++,
        playerId: p.id,
        x1: px,
        y1: py,
        x2: p.x,
        y2: p.y,
        radius: stats.halfWidth,
        endDist: p.dist,
      }
      state.grid.insert(seg)
      state.freshTrail.push({ playerId: p.id, x1: px, y1: py, x2: p.x, y2: p.y, width: stats.halfWidth * 2 })
    }

    // Kollision mot spår
    if (!died && !stats.ghost) {
      for (const seg of state.grid.queryCircle(p.x, p.y, stats.halfWidth)) {
        if (seg.dead) continue // bortsprängt
        // Hoppa över det egna, alldeles färska spåret precis bakom huvudet
        if (seg.playerId === p.id && p.dist - seg.endDist < (stats.halfWidth + seg.radius) * 2 + 6) continue
        if (segCircleHit(seg, p.x, p.y, stats.halfWidth)) {
          if (stats.star) {
            // Mindcamp-stjärnan: spräng spåret i stället för att dö
            for (const target of state.grid.queryCircle(p.x, p.y, STAR_BLAST_RADIUS)) {
              if (segCircleHit(target, p.x, p.y, STAR_BLAST_RADIUS)) target.dead = true
            }
            state.freshHoles.push({ x: p.x, y: p.y, r: STAR_BLAST_RADIUS })
            break
          }
          if (shieldLeft) {
            // Skölden räddar: kort spöke så spelaren hinner ur spåret
            shieldLeft = false
            consumeShield(p)
            p.effects.push({ type: 'ghost', ticksLeft: ESCAPE_GHOST_TICKS, ticksTotal: ESCAPE_GHOST_TICKS })
            break
          }
          died = true
          p.killedBy = seg.playerId === p.id ? 'self' : seg.playerId
          break
        }
      }
    }

    // Armerade minor — spöken glider förbi, stjärnan/skölden desarmerar
    if (!died && !stats.ghost) {
      for (let i = state.mines.length - 1; i >= 0; i--) {
        const m = state.mines[i]
        if (m.armIn > 0) continue
        const dx = p.x - m.x
        const dy = p.y - m.y
        const r = MINE_RADIUS + stats.halfWidth
        if (dx * dx + dy * dy >= r * r) continue
        detonateMine(state, i)
        if (stats.star) continue
        if (shieldLeft) {
          shieldLeft = false
          consumeShield(p)
          continue
        }
        died = true
        p.killedBy = { mine: m.playerId }
        break
      }
    }

    if (!died && state.settings.powerupsEnabled) {
      checkPowerUpPickups(state, p)
    }

    if (died) {
      p.alive = false
      diedNow.push(p.id)
      // Matchstatistik: kill till spår-/minägaren, annars självmord (eget
      // spår, egen mina eller vägg)
      const kb = p.killedBy
      const killer = typeof kb === 'number' ? kb : typeof kb === 'object' && kb !== null ? kb.mine : null
      if (killer !== null && killer !== p.id) state.players[killer].matchStats.kills++
      else p.matchStats.suicides++
      p.matchStats.bestSurvivalTicks = Math.max(p.matchStats.bestSurvivalTicks, state.roundTick)
    }
  }

  stepBullets(state)

  // Poäng: alla som fortfarande lever får 1 poäng per spelare som dog denna tick
  if (diedNow.length > 0) {
    for (const p of state.players) {
      if (p.alive) p.score += diedNow.length
    }
    applyMatchPoint(state) // poängen ändrades → uppdatera matchboll
  }

  // Effekt-timers
  for (const p of state.players) {
    if (p.effects.length === 0) continue
    for (const e of p.effects) e.ticksLeft--
    p.effects = p.effects.filter((e) => e.ticksLeft > 0)
  }
  if (state.wrapTicks > 0) state.wrapTicks--
  if (state.wobbleTicks > 0) state.wobbleTicks--
  if (state.darkTicks > 0) {
    state.darkTicks--
    if (state.darkTicks === 0) state.darkOwner = null
  }
  for (const m of state.mines) {
    if (m.armIn > 0) m.armIn--
  }

  // Power-up-spawning
  if (state.settings.powerupsEnabled && state.powerups.length < MAX_POWERUPS) {
    state.nextPowerUpIn--
    if (state.nextPowerUpIn <= 0) {
      spawnPowerUp(state)
      state.nextPowerUpIn = TPS * 3 + state.rng.int(0, TPS * 4)
    }
  }

  // Rundslut: när högst en lever (eller alla döda i ensamspel)
  const alive = state.players.filter((p) => p.alive)
  const endAt = state.players.length > 1 ? 1 : 0
  if (alive.length <= endAt) {
    state.phase = 'roundOver'
    state.roundWinner = alive[0]?.id ?? null
    // Överlevare har levt hela rundan — räkna även det som överlevnadstid
    for (const p of alive) {
      p.matchStats.bestSurvivalTicks = Math.max(p.matchStats.bestSurvivalTicks, state.roundTick)
    }
    if (state.players.length > 1) {
      const sorted = [...state.players].sort((a, b) => b.score - a.score)
      if (sorted[0].score >= state.targetScore && sorted[0].score > sorted[1].score) {
        state.matchWinner = sorted[0].id
      }
    }
  }
}
