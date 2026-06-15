import {
  type EffectType,
  type GameState,
  type PlayerState,
  type PowerUpType,
  derivedStats,
  FIELD_H,
  FIELD_W,
  MAX_POWERUPS,
  TPS,
} from './state'

export type PowerUpTarget = 'self' | 'others' | 'global'

export interface PowerUpDef {
  type: PowerUpType
  target: PowerUpTarget
  label: string
  icon: string
  /** Relativ spawnsannolikhet — 10 = normal, lägre = mer sällsynt */
  weight: number
  effect?: EffectType
  durationTicks?: number
}

export const POWERUP_DEFS: Record<PowerUpType, PowerUpDef> = {
  selfFast: { type: 'selfFast', target: 'self', label: 'Fart upp', icon: '⚡', weight: 10, effect: 'fast', durationTicks: TPS * 4 },
  // selfSlow är spelets starkaste defensiva power-up (snäv svängradie) → lägre vikt
  selfSlow: { type: 'selfSlow', target: 'self', label: 'Fart ner', icon: '🐌', weight: 7, effect: 'slow', durationTicks: TPS * 4 },
  selfThin: { type: 'selfThin', target: 'self', label: 'Tunn linje', icon: '🪶', weight: 10, effect: 'thin', durationTicks: TPS * 6 },
  selfGhost: { type: 'selfGhost', target: 'self', label: 'Spöke', icon: '👻', weight: 10, effect: 'ghost', durationTicks: Math.round(TPS * 2.3) },
  cannon: { type: 'cannon', target: 'self', label: 'Kanon — skjut med ←+→ samtidigt', icon: '🔫', weight: 9 },
  // othersFast är dubbelt straffande (fart + vidare svängradie) → mer sällsynt
  othersFast: { type: 'othersFast', target: 'others', label: 'Andra snabbare', icon: '🚀', weight: 6, effect: 'fast', durationTicks: TPS * 4 },
  othersReverse: { type: 'othersReverse', target: 'others', label: 'Omvända kontroller', icon: '🔄', weight: 8, effect: 'reverse', durationTicks: Math.round(TPS * 4.5) },
  othersFat: { type: 'othersFat', target: 'others', label: 'Tjock linje', icon: '🎈', weight: 9, effect: 'fat', durationTicks: TPS * 6 },
  clearTrails: { type: 'clearTrails', target: 'global', label: 'Rensa spåren', icon: '🧹', weight: 8 },
  wrapWalls: { type: 'wrapWalls', target: 'global', label: 'Öppna väggar', icon: '🌀', weight: 8 },
  beer: { type: 'beer', target: 'global', label: 'Öl — skärmen gungar för alla', icon: '🍺', weight: 6 },
  shield: { type: 'shield', target: 'self', label: 'Sköld — överlever en krock', icon: '🛡️', weight: 8, effect: 'shield', durationTicks: TPS * 10 },
  othersSquare: { type: 'othersSquare', target: 'others', label: 'Fyrkantssvängar — andra svänger i 90°', icon: '📐', weight: 8, effect: 'square', durationTicks: TPS * 5 },
  swap: { type: 'swap', target: 'global', label: 'Platsbyte — du byter plats med någon', icon: '🔁', weight: 7 },
  mine: { type: 'mine', target: 'others', label: 'Mina — apteras där du plockar den, armeras efter 1,5 s', icon: '💣', weight: 9 },
  darkness: { type: 'darkness', target: 'others', label: 'Mörker — alla utom du famlar i mörkret', icon: '🌑', weight: 6 },
  mindcamp: {
    type: 'mindcamp',
    target: 'self',
    label: 'Mindcamp-stjärnan — trumfar allt: spränger spår, wrappar genom väggar',
    icon: '⭐',
    weight: 4, // stjärnan ska kännas speciell
    effect: 'star',
    durationTicks: TPS * 8,
  },
}

export const ALL_POWERUP_TYPES = Object.keys(POWERUP_DEFS) as PowerUpType[]

const WRAP_DURATION = TPS * 7
const WRAP_MAX = TPS * 15
const WOBBLE_DURATION = TPS * 7
const WOBBLE_MAX = TPS * 14
const DARK_DURATION = TPS * 6
const DARK_MAX = TPS * 12
export const CANNON_AMMO = 3
/** Ticks innan en aptered mina är skarp */
export const MINE_ARM_TICKS = Math.round(TPS * 1.5)
/** Kort spöke efter platsbyte/sköldräddning så man hinner ur det främmande spåret */
export const ESCAPE_GHOST_TICKS = Math.round(TPS * 0.6)

export function applyPowerUp(state: GameState, picker: PlayerState, type: PowerUpType): void {
  const def = POWERUP_DEFS[type]
  if (type === 'cannon') {
    picker.ammo += CANNON_AMMO
    return
  }
  if (type === 'mine') {
    state.mines.push({ id: state.nextId++, playerId: picker.id, x: picker.x, y: picker.y, armIn: MINE_ARM_TICKS })
    return
  }
  if (type === 'darkness') {
    // Mörker för alla utom plockaren — bara hen får en ljuscirkel av renderaren
    state.darkTicks = Math.min(state.darkTicks + DARK_DURATION, DARK_MAX)
    state.darkOwner = picker.id
    return
  }
  if (type === 'swap') {
    // Byt plats (position + riktning) med en slumpad annan levande spelare.
    // Båda får kort spöke så ingen dör direkt i den andres färska spår.
    const others = state.players.filter((q) => q.alive && q.id !== picker.id)
    if (others.length === 0) return
    const other = others[state.rng.int(0, others.length - 1)]
    for (const k of ['x', 'y', 'angle'] as const) {
      const tmp = picker[k]
      picker[k] = other[k]
      other[k] = tmp
    }
    for (const q of [picker, other]) {
      q.effects.push({ type: 'ghost', ticksLeft: ESCAPE_GHOST_TICKS, ticksTotal: ESCAPE_GHOST_TICKS })
    }
    return
  }
  if (def.target === 'global') {
    if (type === 'clearTrails') {
      state.grid.clear()
      state.flags.clearedTrails = true
    } else if (type === 'wrapWalls') {
      state.wrapTicks = Math.min(state.wrapTicks + WRAP_DURATION, WRAP_MAX)
    } else if (type === 'beer') {
      state.wobbleTicks = Math.min(state.wobbleTicks + WOBBLE_DURATION, WOBBLE_MAX)
    }
    return
  }
  const effect = { type: def.effect!, ticksLeft: def.durationTicks!, ticksTotal: def.durationTicks! }
  if (def.target === 'self') {
    picker.effects.push(effect)
  } else {
    for (const q of state.players) {
      if (q.alive && q.id !== picker.id) q.effects.push({ ...effect })
    }
  }
}

/** Viktad dragning bland de typer som inte stängts av i lobbyn.
 *  Returnerar null om allt är avstängt. */
function drawPowerUpType(state: GameState): PowerUpType | null {
  const disabled = state.settings.disabledPowerups ?? []
  const pool = ALL_POWERUP_TYPES.filter((t) => !disabled.includes(t))
  if (pool.length === 0) return null
  const total = pool.reduce((sum, t) => sum + POWERUP_DEFS[t].weight, 0)
  let roll = state.rng.range(0, total)
  for (const t of pool) {
    roll -= POWERUP_DEFS[t].weight
    if (roll < 0) return t
  }
  return pool[pool.length - 1] // flyttalsmarginal
}

export function spawnPowerUp(state: GameState): void {
  if (state.powerups.length >= MAX_POWERUPS) return
  const type = drawPowerUpType(state)
  if (type === null) return
  // Undvik att spawna ovanpå ett huvud — gör några försök, ge annars upp denna gång
  for (let attempt = 0; attempt < 8; attempt++) {
    const m = 60 + state.wallInset
    const x = state.rng.range(m, FIELD_W - m)
    const y = state.rng.range(m, FIELD_H - m)
    const tooClose = state.players.some((p) => {
      if (!p.alive) return false
      const dx = p.x - x
      const dy = p.y - y
      return dx * dx + dy * dy < 90 * 90
    })
    if (!tooClose) {
      state.powerups.push({ id: state.nextId++, type, x, y })
      return
    }
  }
}

export function checkPowerUpPickups(state: GameState, p: PlayerState): void {
  const stats = derivedStats(p)
  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const pu = state.powerups[i]
    const dx = p.x - pu.x
    const dy = p.y - pu.y
    const hit = 13 + stats.halfWidth + 2
    if (dx * dx + dy * dy < hit * hit) {
      state.powerups.splice(i, 1)
      p.matchStats.powerups++
      applyPowerUp(state, p, pu.type)
    }
  }
}
