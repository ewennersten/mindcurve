import type { SegmentGrid } from './collision'
import type { Rng } from './rng'

// ── Spelkonstanter ─────────────────────────────────────────────
export const FIELD_W = 1280
export const FIELD_H = 720
export const TPS = 60
export const BASE_SPEED = 2.1 // px per tick
export const TURN_RATE = 0.052 // radianer per tick
export const BASE_THICKNESS = 4 // linjebredd i px
export const COUNTDOWN_TICKS = TPS * 3
export const MAX_POWERUPS = 5
export const POWERUP_RADIUS = 13

/** Spelarfärger — längden sätter maxantalet spelare (lobby-slots + LAN-platser).
 *  Valda för att gå att skilja åt mot mörk bakgrund, även i ögonvrån. */
export const PLAYER_COLORS = [
  '#ff4655', // röd
  '#37d67a', // grön
  '#3aa6ff', // blå
  '#ffc233', // gul
  '#b66bff', // lila
  '#2fe0d6', // turkos
  '#ff7ab8', // rosa
  '#ff8a3d', // orange
]
export const MAX_PLAYERS = PLAYER_COLORS.length

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver'

export type EffectType = 'fast' | 'slow' | 'thin' | 'ghost' | 'reverse' | 'fat' | 'star' | 'shield' | 'square'

export interface Effect {
  type: EffectType
  ticksLeft: number
  /** Effektens totala längd — används för att rita nedräkningsstapeln i HUD */
  ticksTotal: number
}

export type PowerUpType =
  | 'selfFast'
  | 'selfSlow'
  | 'selfThin'
  | 'selfGhost'
  | 'othersFast'
  | 'othersReverse'
  | 'othersFat'
  | 'clearTrails'
  | 'wrapWalls'
  | 'cannon'
  | 'beer'
  | 'mindcamp'
  | 'shield'
  | 'othersSquare'
  | 'swap'
  | 'mine'
  | 'darkness'

/** Projektil från kanon-power-upen */
export interface Bullet {
  id: number
  playerId: number
  x: number
  y: number
  angle: number
  ttl: number
  /** Skyttens färdsträcka vid avfyrning — kulan ignorerar spår skytten
   *  lade strax före/efter skottet, annars träffar den svansen direkt. */
  spawnDist: number
}

/** Hål sprängt i spåren denna tick — konsumeras av renderaren (suddar spårlagret) */
export interface Hole {
  x: number
  y: number
  r: number
}

/** Aptering från 💣-power-upen. Armeras efter en stund, dödar vid kontakt. */
export interface Mine {
  id: number
  /** Den som apterade — får killen om någon annan kör på minan */
  playerId: number
  x: number
  y: number
  /** Ticks kvar tills minan är armerad (≤ 0 = skarp) */
  armIn: number
}

export interface PowerUpItem {
  id: number
  type: PowerUpType
  x: number
  y: number
}

export interface Segment {
  id: number
  playerId: number
  x1: number
  y1: number
  x2: number
  y2: number
  radius: number
  /** Spelarens ackumulerade färdsträcka vid segmentets slut — används för
   *  att huvudet inte ska kollidera med sitt eget alldeles färska spår. */
  endDist: number
  /** Bortsprängd av en kanonkula — ligger kvar i gridden men kolliderar inte */
  dead?: boolean
}

/** Ackumulerad statistik över hela matchen (nollställs inte mellan rundor).
 *  Visas på statistikskärmen vid matchslut. */
export interface MatchStats {
  /** Andra spelare som dött i den här spelarens spår */
  kills: number
  /** Dödsfall mot eget spår eller vägg */
  suicides: number
  /** Upplockade power-ups */
  powerups: number
  /** Längsta överlevnad i en runda, i ticks */
  bestSurvivalTicks: number
}

export interface PlayerState {
  id: number
  name: string
  color: string
  x: number
  y: number
  angle: number
  dist: number
  alive: boolean
  score: number
  effects: Effect[]
  /** >0 → mitt i en lucka, värdet är kvarvarande lucksträcka */
  gapLeft: number
  /** Sträcka kvar tills nästa lucka börjar */
  nextGapIn: number
  /** Kanonskott kvar (🔫-power-upen). Skjut med vänster + höger samtidigt. */
  ammo: number
  /** Kanttriggning för avfyrning — sant medan båda tangenterna hålls */
  fireWasHeld: boolean
  /** Kanttriggning för 90°-svängar (square-effekten) */
  leftWasHeld: boolean
  rightWasHeld: boolean
  /** Vad spelaren dog av denna runda (null = lever) */
  killedBy: KillCause | null
  /** Kan vinna matchen nästa runda (matchboll) — härlett ur poängen */
  matchPoint: boolean
  /** Matchstatistik för slutskärmen — ackumuleras över rundorna */
  matchStats: MatchStats
}

export interface PlayerInput {
  left: boolean
  right: boolean
}

/** Nyritade spårbitar denna tick — konsumeras av renderaren. */
export interface FreshSegment {
  playerId: number
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
}

export interface GameSettings {
  powerupsEnabled: boolean
  /** 'auto' = 10 × (antal spelare − 1), annars ett fast poängmål */
  targetScore: number | 'auto'
  /** Sekunder in i rundan innan arenan börjar krympa, eller 'off' */
  shrinkAfterSec: number | 'off'
  /** Power-up-typer som inte ska spawna (lobbyns toggles). Utelämnad = alla på. */
  disabledPowerups?: PowerUpType[]
}

/** Vad en spelare dog av: väggen, sitt eget spår, en annan spelares id,
 *  eller en mina (`{ mine: ägarens id }` — egen mina räknas som självmord). */
export type KillCause = 'wall' | 'self' | number | { mine: number }

export interface GameState {
  phase: Phase
  tick: number
  countdown: number
  players: PlayerState[]
  grid: SegmentGrid
  powerups: PowerUpItem[]
  bullets: Bullet[]
  mines: Mine[]
  nextPowerUpIn: number
  /** >0 → väggarna är wrap-around (global power-up) */
  wrapTicks: number
  /** >0 → skärmen gungar (öl-power-upen) */
  wobbleTicks: number
  /** >0 → mörker: bara plockaren ser sin omgivning (🌑-power-upen) */
  darkTicks: number
  /** Vem som plockade mörkret — bara hen får en ljuscirkel */
  darkOwner: number | null
  /** Hur långt väggarna krupit inåt (sudden death) */
  wallInset: number
  /** Tick sedan rundan började spelas (driver krympningen) */
  roundTick: number
  freshHoles: Hole[]
  targetScore: number
  rng: Rng
  nextId: number
  freshTrail: FreshSegment[]
  flags: { clearedTrails: boolean }
  settings: GameSettings
  roundWinner: number | null
  matchWinner: number | null
}

/** Det en renderare/HUD behöver av en spelare — JSON-serialiserbar delmängd
 *  av PlayerState, så att en nätverksklient kan rita utan egen simulering. */
export interface ViewPlayer {
  name: string
  color: string
  x: number
  y: number
  angle: number
  alive: boolean
  score: number
  effects: Effect[]
  ammo: number
  killedBy: KillCause | null
  /** Kan vinna matchen nästa runda (matchboll) */
  matchPoint: boolean
  /** Matchstatistik för slutskärmen — ackumuleras över rundorna */
  matchStats: MatchStats
}

/** Renderbar delmängd av GameState. GameState är strukturellt tilldelningsbar
 *  till ViewState, och servern serialiserar ViewState till klienterna. */
export interface ViewState {
  phase: Phase
  tick: number
  countdown: number
  players: ViewPlayer[]
  powerups: PowerUpItem[]
  bullets: Bullet[]
  mines: Mine[]
  wrapTicks: number
  /** >0 → skärmen gungar (öl-power-upen) */
  wobbleTicks: number
  /** >0 → mörker: bara plockaren ser sin omgivning (🌑-power-upen) */
  darkTicks: number
  /** Vem som plockade mörkret — bara hen får en ljuscirkel */
  darkOwner: number | null
  /** Hur långt väggarna krupit inåt (sudden death) */
  wallInset: number
  targetScore: number
  freshTrail: FreshSegment[]
  freshHoles: Hole[]
  roundWinner: number | null
  matchWinner: number | null
}

/** Effektiva egenskaper för en spelare just nu, givet aktiva effekter. */
export interface DerivedStats {
  speed: number
  halfWidth: number
  reversed: boolean
  ghost: boolean
  /** Mindcamp-stjärnan: odödlig mot spår — de sprängs i stället */
  star: boolean
  /** Sköld: överlever nästa dödliga träff (konsumeras då) */
  shield: boolean
  /** Fyrkantssvängar: kanttriggade 90°-svängar i stället för kontinuerlig sväng */
  square: boolean
}

export function derivedStats(p: { effects: Effect[] }): DerivedStats {
  let speed = BASE_SPEED
  let width = BASE_THICKNESS
  let reverseCount = 0
  let ghost = false
  let star = false
  let shield = false
  let square = false
  for (const e of p.effects) {
    switch (e.type) {
      // 1.5/0.65 i stället för 1.65/0.55: hög fart med oförändrad svängvinkel
      // per tick är dubbelt straffande (svängradien växer), så fart-effekterna
      // hålls mildare än de såg ut på pappret (designerns balansanmärkning).
      case 'fast':
        speed *= 1.5
        break
      case 'slow':
        speed *= 0.65
        break
      case 'thin':
        width *= 0.5
        break
      case 'fat':
        width *= 2
        break
      case 'reverse':
        reverseCount++
        break
      case 'ghost':
        ghost = true
        break
      case 'star':
        star = true
        break
      case 'shield':
        shield = true
        break
      case 'square':
        square = true
        break
    }
  }
  speed = Math.min(Math.max(speed, 0.7), 7)
  width = Math.min(Math.max(width, 1.6), 26)
  return { speed, halfWidth: width / 2, reversed: reverseCount % 2 === 1, ghost, star, shield, square }
}
