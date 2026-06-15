// Botspelare. En bot är bara en funktion GameState → PlayerInput och lever
// HELT utanför den deterministiska kärnan — den anropas där simuleringen körs
// (webbläsaren lokalt, Node på LAN-servern) och matas in i step() precis som
// mänskliga inputs. Ingen slump: samma state ger alltid samma input.
import { segCircleHit } from './collision'
import { MINE_RADIUS } from './core'
import {
  type GameState,
  type PlayerInput,
  derivedStats,
  FIELD_H,
  FIELD_W,
  TURN_RATE,
} from './state'

export const BOT_NAMES = ['Botvid', 'Robotina', 'Kurvator', 'Maskinen', 'Beep-Boop', 'Auto-Mats', 'Snurr-Bot', 'C-3PR']

/** Svårighetsgrader 1–5. Nivån styr hur många tick framåt rattprovkörningarna
 *  simuleras — kortare sikt = senare väjningar = dummare bot. Låga nivåer
 *  jagar inte heller power-ups (< 3) och skjuter inte kanonen (< 2). */
export const BOT_LEVEL_LABELS = ['Lullig', 'Lätt', 'Lagom', 'Svår', 'Elak']
export const DEFAULT_BOT_LEVEL = 3
const LEVEL_LOOKAHEAD = [12, 22, 34, 45, 55]

/** Är botten instängd (alla vägar kortare än så här) skjuter den om den kan */
const FIRE_WHEN_BLOCKED = 18

const NO_INPUT: PlayerInput = { left: false, right: false }

function normalizeAngle(a: number): number {
  return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
}

/** Beräknar botens input genom att provköra sväng vänster/rakt/höger och
 *  välja den riktning som har längst fri väg. `level` 1–5, se BOT_LEVEL_LABELS. */
export function botInput(state: GameState, playerId: number, level = DEFAULT_BOT_LEVEL): PlayerInput {
  if (state.phase !== 'playing') return NO_INPUT
  const p = state.players[playerId]
  if (!p?.alive) return NO_INPUT

  const lvl = Math.min(Math.max(Math.round(level), 1), 5)
  const LOOKAHEAD = LEVEL_LOOKAHEAD[lvl - 1]
  const stats = derivedStats(p)
  const r = stats.halfWidth + 1 // liten säkerhetsmarginal
  const immortal = stats.star || state.wrapTicks > 0 // väggarna wrappar, spår sprängs/ofarliga

  /** Antal fria tick i riktningen `dir` (-1 vänster, 0 rakt, 1 höger) */
  const clearance = (dir: number): number => {
    let x = p.x
    let y = p.y
    let a = p.angle
    const minX = state.wallInset + r
    const maxX = FIELD_W - state.wallInset - r
    const minY = state.wallInset + r
    const maxY = FIELD_H - state.wallInset - r
    for (let i = 1; i <= LOOKAHEAD; i++) {
      // Fyrkantssvängar: knycken sker direkt, sedan rakt
      if (stats.square) a = i === 1 ? a + (dir * Math.PI) / 2 : a
      else a += dir * TURN_RATE
      x += Math.cos(a) * stats.speed
      y += Math.sin(a) * stats.speed
      if (!immortal && (x < minX || x > maxX || y < minY || y > maxY)) return i
      if (!stats.ghost && !stats.star) {
        for (const seg of state.grid.queryCircle(x, y, r)) {
          if (seg.dead) continue
          // Eget färskt spår alldeles bakom huvudet räknas inte (som i kärnan)
          if (seg.playerId === p.id && p.dist + i * stats.speed - seg.endDist < (r + seg.radius) * 2 + 8) continue
          if (segCircleHit(seg, x, y, r)) return i
        }
        for (const m of state.mines) {
          // Undvik även minor under armering — de hinner bli skarpa
          const dx = x - m.x
          const dy = y - m.y
          const hit = MINE_RADIUS + r + 2
          if (dx * dx + dy * dy < hit * hit) return i
        }
      }
    }
    return LOOKAHEAD + 1
  }

  const cl = clearance(-1)
  const cs = clearance(0)
  const cr = clearance(1)

  // Instängd med kanon? Skjut hål (vänster+höger samtidigt). En kula i taget.
  if (
    lvl >= 2 &&
    p.ammo > 0 &&
    !p.fireWasHeld &&
    cs < FIRE_WHEN_BLOCKED &&
    cl < FIRE_WHEN_BLOCKED &&
    cr < FIRE_WHEN_BLOCKED &&
    !state.bullets.some((b) => b.playerId === p.id)
  ) {
    return { left: true, right: true }
  }

  let dir: number
  if (cs > LOOKAHEAD) {
    // Fritt rakt fram: sväng mjukt mot närmaste power-up om även sidan är fri
    dir = 0
    let best: { dx: number; dy: number; d2: number } | null = null
    if (lvl >= 3) for (const pu of state.powerups) {
      const dx = pu.x - p.x
      const dy = pu.y - p.y
      const d2 = dx * dx + dy * dy
      if (!best || d2 < best.d2) best = { dx, dy, d2 }
    }
    if (best) {
      const da = normalizeAngle(Math.atan2(best.dy, best.dx) - p.angle)
      if (Math.abs(da) > 0.15) {
        const want = da > 0 ? 1 : -1
        if ((want < 0 ? cl : cr) > LOOKAHEAD) dir = want
      }
    }
  } else if (cs >= cl && cs >= cr) {
    dir = 0
  } else if (cl === cr) {
    // Helt symmetriskt — håll åt var sitt håll per bot så de inte beter sig i klump
    dir = playerId % 2 === 0 ? -1 : 1
  } else {
    dir = cl > cr ? -1 : 1
  }

  // Omvända kontroller: kärnan flippar inputen, så botten förflippar
  if (stats.reversed) dir = -dir
  return { left: dir === -1, right: dir === 1 }
}
