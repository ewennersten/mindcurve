import { type Phase, type PowerUpType, type ViewState, TPS } from '../game/state'
import { AudioEngine, midiHz } from './engine'
import { MusicLoop } from './music'

interface PrevSnapshot {
  phase: Phase
  countNum: number
  alive: boolean[]
  bulletIds: Set<number>
  wrapActive: boolean
  shrinking: boolean
  matchPoint: boolean[]
}

/**
 * Spelets "ljuddirigent": tar emot samma ViewState som renderaren (lokalt
 * varje tick, över LAN varje servermeddelande), diffar mot förra ögonblicket
 * och triggar musik och effekter. Ingen koppling till simuleringen behövs.
 */
export class AudioDirector {
  readonly engine = new AudioEngine()
  private music = new MusicLoop(this.engine)
  private prev: PrevSnapshot | null = null
  private roundTicks = 0
  /** Spelar stjärnloopen just nu (någon har Mindcamp-stjärnan) */
  private starActive = false

  unlock(): void {
    this.engine.unlock()
  }

  get muted(): boolean {
    return this.engine.muted
  }

  toggleMuted(): void {
    this.engine.setMuted(!this.engine.muted)
  }

  /** Anropas när man lämnar spelet (till lobbyn) eller en nätverkssession. */
  reset(): void {
    this.music.stop()
    this.music.setStarMode(false)
    this.prev = null
    this.starActive = false
  }

  setMusicPaused(paused: boolean): void {
    if (paused) this.music.stop()
    else if (this.prev?.phase === 'playing') this.music.start()
  }

  observe(v: ViewState): void {
    const prev = this.prev
    this.prev = this.snap(v)
    if (!prev) {
      if (v.phase === 'playing') this.music.start()
      return
    }

    if (v.phase !== prev.phase) this.onPhaseChange(prev.phase, v)

    // Stöt när någon precis nått matchboll
    if (v.phase !== 'matchOver') {
      v.players.forEach((p, i) => {
        if (p.matchPoint && !prev.matchPoint[i]) this.matchPointSting()
      })
    }

    // Stjärnläge: byt till den rusande stjärnloopen medan någon bär stjärnan
    const starNow = v.phase === 'playing' && v.players.some((p) => p.alive && p.effects.some((e) => e.type === 'star'))
    if (starNow !== this.starActive) {
      this.starActive = starNow
      this.music.setStarMode(starNow)
    }

    if (v.phase === 'countdown') {
      const num = Math.ceil(v.countdown / TPS)
      if (num !== prev.countNum && num > 0) this.beep()
    }

    if (v.phase === 'playing' && prev.phase === 'playing') {
      // Pressen ökar med rundans längd och för varje spelare som faller
      this.roundTicks++
      const dead = v.players.filter((p) => !p.alive).length
      const deadFrac = v.players.length > 1 ? dead / (v.players.length - 1) : 0
      const shrinkPanic = v.wallInset > 0 ? 0.35 : 0
      this.music.setIntensity(Math.min(1, this.roundTicks / (TPS * 40)) * 0.65 + deadFrac * 0.5 + shrinkPanic)

      if (!prev.shrinking && v.wallInset > 0) this.shrinkAlarm()

      let deaths = 0
      v.players.forEach((p, i) => {
        if (prev.alive[i] && !p.alive) deaths++
      })
      for (let i = 0; i < deaths; i++) this.crash(this.engine.now() + i * 0.07)

      // Plock-ljud direkt ur spelhändelserna — en despawn:ad power-up ger ingen
      // freshPickup-händelse, så självdöden låter (riktigt nog) ingenting.
      for (const ev of v.freshPickups) this.pickup(ev.type)

      // Nya kulor = någon sköt; sprängda hål = träff
      for (const b of v.bullets) {
        if (!prev.bulletIds.has(b.id)) this.shot()
      }
      for (let i = 0; i < v.freshHoles.length; i++) this.blast(this.engine.now() + i * 0.04)

      if (!prev.wrapActive && v.wrapTicks > 0) this.wrapOn()
    }
  }

  private snap(v: ViewState): PrevSnapshot {
    return {
      phase: v.phase,
      countNum: Math.ceil(v.countdown / TPS),
      alive: v.players.map((p) => p.alive),
      bulletIds: new Set(v.bullets.map((b) => b.id)),
      wrapActive: v.wrapTicks > 0,
      shrinking: v.wallInset > 0,
      matchPoint: v.players.map((p) => p.matchPoint),
    }
  }

  /** Spänd uppåtgående stöt när en spelare når matchboll */
  private matchPointSting(): void {
    const t = this.engine.now()
    for (const [i, m] of [76, 80, 83].entries()) {
      this.engine.tone({ freq: midiHz(m), type: 'square', t: t + i * 0.06, dur: 0.12, vol: 0.16, filter: 3000 })
    }
  }

  private onPhaseChange(from: Phase, v: ViewState): void {
    switch (v.phase) {
      case 'playing':
        this.go()
        this.roundTicks = 0
        this.music.start()
        break
      case 'roundOver':
        this.music.stop()
        if (from === 'playing') {
          if (v.roundWinner != null) this.roundWin()
          else this.draw()
        }
        break
      case 'matchOver':
        this.music.stop()
        this.fanfare()
        break
      case 'countdown':
        break
    }
  }

  // ── Ljudeffekterna ───────────────────────────────────────────

  private beep(): void {
    this.engine.tone({ freq: 440, type: 'square', dur: 0.09, vol: 0.18 })
  }

  private go(): void {
    this.engine.tone({ freq: 880, type: 'square', dur: 0.3, vol: 0.22 })
  }

  private crash(t: number): void {
    // Brusexplosion med fallande filter + subduns
    this.engine.noise({ t, dur: 0.45, vol: 0.5, freq: 3200, sweepTo: 120 })
    this.engine.tone({ freq: 110, glide: 38, type: 'sine', t, dur: 0.35, vol: 0.6 })
  }

  /** Varje power-up har sin egen klang som matchar effekten. */
  private pickup(type: PowerUpType): void {
    const e = this.engine
    const t = e.now()
    switch (type) {
      case 'selfFast': // ⚡ blixtsnabb zip uppåt
        e.tone({ freq: 320, glide: 1500, type: 'sawtooth', t, dur: 0.22, vol: 0.2, filter: 4000 })
        break
      case 'selfSlow': // 🐌 trött glid nedåt
        e.tone({ freq: 700, glide: 160, type: 'sine', t, dur: 0.5, vol: 0.2 })
        break
      case 'selfThin': // 🪶 lätt liten "tink-tink"
        e.tone({ freq: 1800, type: 'sine', t, dur: 0.05, vol: 0.16 })
        e.tone({ freq: 2400, type: 'sine', t: t + 0.07, dur: 0.07, vol: 0.14 })
        break
      case 'selfGhost': // 👻 svävande detune-skimmer
        e.tone({ freq: 520, type: 'sine', t, dur: 0.5, vol: 0.12 })
        e.tone({ freq: 524, type: 'sine', t, dur: 0.5, vol: 0.12 })
        e.tone({ freq: 1040, glide: 780, type: 'triangle', t: t + 0.1, dur: 0.4, vol: 0.08 })
        break
      case 'cannon': // 🔫 "k-chk" — vapnet osäkras
        e.noise({ t, dur: 0.04, vol: 0.3, freq: 1400 })
        e.noise({ t: t + 0.1, dur: 0.06, vol: 0.38, freq: 950 })
        break
      case 'othersFast': // 🚀 raketsvisch
        e.noise({ t, dur: 0.3, vol: 0.24, filterType: 'highpass', freq: 700, sweepTo: 5500 })
        e.tone({ freq: 200, glide: 900, type: 'sawtooth', t, dur: 0.3, vol: 0.12, filter: 2500 })
        break
      case 'othersReverse': // 🔄 olycksbådande tritonus-fall
        e.tone({ freq: midiHz(74), type: 'square', t, dur: 0.08, vol: 0.16, filter: 2500 })
        e.tone({ freq: midiHz(68), type: 'square', t: t + 0.09, dur: 0.16, vol: 0.16, filter: 2500 })
        break
      case 'othersFat': // 🎈 ballongen blåses upp
        e.tone({ freq: 90, glide: 300, type: 'square', t, dur: 0.35, vol: 0.22, filter: 800 })
        break
      case 'clearTrails': // 🧹 svepande borste + glitter
        e.noise({ t, dur: 0.4, vol: 0.2, filterType: 'bandpass', freq: 350, sweepTo: 5000 })
        e.tone({ freq: 880, glide: 1760, type: 'triangle', t: t + 0.22, dur: 0.2, vol: 0.14 })
        break
      case 'wrapWalls': // 🌀 portalklang (själva sviischet sköts av wrapOn)
        e.tone({ freq: midiHz(72), glide: midiHz(88), type: 'triangle', t, dur: 0.35, vol: 0.18 })
        break
      case 'beer': // 🍺 glugg-glugg-bubbel
        for (const [i, f] of [240, 190, 260, 170].entries()) {
          e.tone({ freq: f, glide: f * 0.7, type: 'sine', t: t + i * 0.09, dur: 0.08, vol: 0.22 })
        }
        e.noise({ t: t + 0.05, dur: 0.4, vol: 0.07, freq: 700 })
        break
      case 'shield': // 🛡️ metalliskt "shiing" som klingar ut
        e.tone({ freq: 1100, glide: 1650, type: 'triangle', t, dur: 0.3, vol: 0.18 })
        e.tone({ freq: 2200, type: 'sine', t: t + 0.05, dur: 0.4, vol: 0.1 })
        break
      case 'othersSquare': // 📐 kantiga, kvantiserade blippar
        for (const [i, f] of [600, 600, 900, 450].entries()) {
          e.tone({ freq: f, type: 'square', t: t + i * 0.07, dur: 0.05, vol: 0.15, filter: 2800 })
        }
        break
      case 'swap': // 🔁 två toner som byter plats
        e.tone({ freq: midiHz(64), glide: midiHz(76), type: 'triangle', t, dur: 0.22, vol: 0.18 })
        e.tone({ freq: midiHz(76), glide: midiHz(64), type: 'triangle', t, dur: 0.22, vol: 0.18 })
        e.noise({ t: t + 0.18, dur: 0.1, vol: 0.12, freq: 3000 })
        break
      case 'mine': // 💣 stubinväsning + apteringsklick
        e.noise({ t, dur: 0.25, vol: 0.16, filterType: 'highpass', freq: 4500 })
        e.tone({ freq: 240, type: 'square', t: t + 0.28, dur: 0.05, vol: 0.22, filter: 1200 })
        break
      case 'darkness': // 🌑 olycksbådande fall ner i mörkret
        e.tone({ freq: midiHz(57), glide: midiHz(45), type: 'sawtooth', t, dur: 0.7, vol: 0.16, filter: 700 })
        e.tone({ freq: midiHz(33), type: 'sine', t: t + 0.2, dur: 0.6, vol: 0.2 })
        break
      case 'mindcamp': {
        // ⭐ Mario-stjärnig jubelarpeggio i dur, två varv
        const run = [76, 80, 83, 88]
        run.forEach((m, i) => {
          e.tone({ freq: midiHz(m), type: 'square', t: t + i * 0.07, dur: 0.09, vol: 0.18, filter: 3500 })
          e.tone({ freq: midiHz(m + 12), type: 'triangle', t: t + 0.3 + i * 0.07, dur: 0.09, vol: 0.14 })
        })
        e.tone({ freq: midiHz(88), glide: midiHz(100), type: 'triangle', t: t + 0.62, dur: 0.3, vol: 0.12 })
        break
      }
    }
  }

  private shot(): void {
    // Pew! Snabbt fallande laser
    this.engine.tone({ freq: 1500, glide: 220, type: 'square', dur: 0.13, vol: 0.22, filter: 3500 })
  }

  private blast(t: number): void {
    this.engine.noise({ t, dur: 0.25, vol: 0.35, freq: 2500, sweepTo: 200 })
    this.engine.tone({ freq: 100, glide: 45, type: 'sine', t, dur: 0.2, vol: 0.4 })
  }

  /** Tvåtonigt larm när väggarna börjar krypa inåt */
  private shrinkAlarm(): void {
    const t = this.engine.now()
    for (let i = 0; i < 3; i++) {
      this.engine.tone({ freq: 660, type: 'square', t: t + i * 0.34, dur: 0.15, vol: 0.16, filter: 2200 })
      this.engine.tone({ freq: 495, type: 'square', t: t + i * 0.34 + 0.16, dur: 0.15, vol: 0.16, filter: 2200 })
    }
  }

  private wrapOn(): void {
    this.engine.noise({ dur: 0.5, vol: 0.18, filterType: 'bandpass', freq: 400, sweepTo: 4500 })
  }

  private roundWin(): void {
    const t = this.engine.now()
    for (const [i, m] of [69, 73, 76].entries()) {
      this.engine.tone({ freq: midiHz(m), type: 'triangle', t: t + i * 0.09, dur: 0.18, vol: 0.22 })
    }
  }

  private draw(): void {
    this.engine.tone({ freq: midiHz(57), type: 'square', dur: 0.4, vol: 0.14, filter: 900 })
    this.engine.tone({ freq: midiHz(58), type: 'square', t: this.engine.now() + 0.02, dur: 0.4, vol: 0.1, filter: 900 })
  }

  private fanfare(): void {
    const t = this.engine.now()
    const melody = [69, 73, 76, 81, 81]
    melody.forEach((m, i) => {
      this.engine.tone({ freq: midiHz(m), type: 'square', t: t + i * 0.13, dur: i === 4 ? 0.7 : 0.14, vol: 0.2, filter: 2500 })
    })
    // Avslutande ackord under sista tonen
    for (const m of [57, 64, 69]) {
      this.engine.tone({ freq: midiHz(m), type: 'triangle', t: t + 0.52, dur: 0.8, vol: 0.14 })
    }
  }
}
