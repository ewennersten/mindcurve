import { type AudioEngine, midiHz } from './engine'

// Loopande soundtrack byggt för stress: fyrtaktskick, virvel på 2 och 4,
// obarmhärtig sextondelsbas med oktavpump och sågtandsarpeggio över
// Am — Am — F — E (dominanten löses aldrig upp = konstant spänning).
//
// `intensity` (0–1) styrs av AudioDirector och växer under rundan och när
// spelare dör: tempot kryper 152 → 170 BPM, basfiltret öppnas, hi-hatsen
// dubblas till sextondelar och arpeggiot klättrar en oktav.

const BPM_BASE = 152
const BPM_MAX = 170
const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12

const KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]
const HAT8 = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
const ARP_SEQ = [0, 1, 2, 1]

// "Stjärnläge" — när någon plockar Mindcamp-stjärnan tar en snabb, studsande
// dur-loop över i Mario-stjärneanda (egen melodi): rusande tempo, oom-pah-bas
// på root/kvint och en klättrande, glittrande dur-lead.
const STAR_BPM = 200
const STAR_LEAD = [72, 74, 76, 79, 81, 79, 76, 79, 84, 81, 79, 76, 79, 76, 74, 72]

// Bas: root–root–oktav–root i pumpande sextondelar
const BASS_OCT = [0, 0, 12, 0]
const BASS_ROOTS = [45, 45, 41, 40] // A2, A2, F2, E2
const ARP_CHORDS = [
  [69, 72, 76], // Am
  [76, 72, 69], // Am, fallande — varierar utan att släppa greppet
  [65, 69, 72], // F
  [64, 68, 71], // E (dur — spänningen!)
]

export class MusicLoop {
  private timer: ReturnType<typeof setInterval> | null = null
  private step = 0
  private nextTime = 0
  private intensity = 0
  private starMode = false

  constructor(private engine: AudioEngine) {}

  get playing(): boolean {
    return this.timer !== null
  }

  setIntensity(i: number): void {
    this.intensity = Math.min(Math.max(i, 0), 1)
  }

  /** Slå på/av stjärnloopen (Mindcamp-stjärnan) — överstyr den vanliga musiken. */
  setStarMode(on: boolean): void {
    this.starMode = on
  }

  start(): void {
    if (this.timer || !this.engine.ready) return
    this.step = 0
    this.intensity = 0
    this.starMode = false
    this.nextTime = this.engine.now() + 0.06
    this.timer = setInterval(() => this.schedule(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private stepDur(): number {
    if (this.starMode) return 60 / STAR_BPM / 4
    const bpm = BPM_BASE + (BPM_MAX - BPM_BASE) * this.intensity
    return 60 / bpm / 4
  }

  private schedule(): void {
    while (this.nextTime < this.engine.now() + SCHEDULE_AHEAD) {
      this.scheduleStep(this.step, this.nextTime)
      this.step++
      this.nextTime += this.stepDur()
    }
  }

  private scheduleStep(stepIdx: number, t: number): void {
    if (this.starMode) {
      this.scheduleStarStep(stepIdx, t)
      return
    }
    const bar = Math.floor(stepIdx / 16) % 4
    const s = stepIdx % 16
    const hot = this.intensity

    if (KICK[s]) {
      this.engine.tone({ freq: 150, glide: 42, type: 'sine', t, dur: 0.12, vol: 0.9, music: true })
    }
    if (SNARE[s]) {
      this.engine.noise({ t, dur: 0.11, vol: s === 15 ? 0.16 : 0.3, filterType: 'bandpass', freq: 1900, music: true })
    }
    // Hi-hats: åttondelar i grunden, sextondelar när det hettar till
    if (HAT8[s] || hot > 0.45) {
      const accent = s % 4 === 2
      this.engine.noise({
        t,
        dur: accent ? 0.05 : 0.03,
        vol: accent ? 0.14 : 0.07 + 0.05 * hot,
        filterType: 'highpass',
        freq: 7000,
        music: true,
      })
    }
    // Pumpande sextondelsbas — filtret öppnas med intensiteten
    this.engine.tone({
      freq: midiHz(BASS_ROOTS[bar] + BASS_OCT[s % 4]),
      type: 'square',
      t,
      dur: 0.1,
      vol: 0.22,
      filter: 520 + 2600 * hot,
      music: true,
    })
    // Sågtandsarpeggio — klättrar en oktav när pressen ökar
    const octaveUp = hot > 0.65 ? 12 : Math.floor(stepIdx / 64) % 2 === 1 ? 12 : 0
    this.engine.tone({
      freq: midiHz(ARP_CHORDS[bar][ARP_SEQ[s % 4]] + octaveUp),
      type: 'sawtooth',
      t,
      dur: 0.07,
      vol: 0.055 + 0.05 * hot,
      filter: 2200 + 3500 * hot,
      music: true,
    })
    // På hög intensitet: stigande "siren"-glid i varje taktstart
    if (hot > 0.8 && s === 0) {
      const root = midiHz(BASS_ROOTS[bar] + 24)
      this.engine.tone({ freq: root, glide: root * 1.5, type: 'sawtooth', t, dur: this.stepDur() * 14, vol: 0.045, filter: 1800, music: true })
    }
  }

  /** Stjärnloopen: rusande dur-galopp i Mario-stjärneanda. Två takters
   *  harmoni (C → D) för studs, oom-pah-bas och en glittrande lead. */
  private scheduleStarStep(stepIdx: number, t: number): void {
    const s = stepIdx % 16
    const bar = Math.floor(stepIdx / 16) % 2
    const lift = bar === 1 ? 2 : 0 // andra takten ett helt tonsteg upp = framåtlut
    const e = this.engine

    // Drivande kick på fjärdedelar
    if (s % 4 === 0) e.tone({ freq: 140, glide: 55, type: 'sine', t, dur: 0.1, vol: 0.8, music: true })
    // Sextondels-hi-hats med accent
    e.noise({ t, dur: s % 4 === 2 ? 0.05 : 0.025, vol: s % 4 === 2 ? 0.13 : 0.06, filterType: 'highpass', freq: 8500, music: true })
    // Oom-pah-bas: root på jämn åttondel, kvint på udda
    if (s % 2 === 0) {
      const oom = (s % 4 === 0 ? 48 : 55) + lift // C3 / G3
      e.tone({ freq: midiHz(oom), type: 'square', t, dur: 0.09, vol: 0.3, filter: 1500, music: true })
    }
    // Snabb, studsande dur-lead + glitter en oktav upp
    const lead = STAR_LEAD[s] + lift
    e.tone({ freq: midiHz(lead), type: 'square', t, dur: 0.06, vol: 0.17, filter: 4800, music: true })
    e.tone({ freq: midiHz(lead + 12), type: 'triangle', t, dur: 0.05, vol: 0.07, music: true })
  }
}
