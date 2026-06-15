// Liten Web Audio-motor: allt ljud i spelet syntetiseras — inga ljudfiler.
// AudioContext får inte skapas före en användargest; unlock() anropas därför
// från pointer-/tangentlyssnare i main och är idempotent.

export interface ToneOpts {
  freq: number
  type?: OscillatorType
  t?: number
  dur?: number
  vol?: number
  /** Glid till denna frekvens över tonens längd */
  glide?: number
  /** Lågpassfilter (Hz) mellan oscillator och gain */
  filter?: number
  music?: boolean
}

export interface NoiseOpts {
  t?: number
  dur?: number
  vol?: number
  filterType?: BiquadFilterType
  freq?: number
  /** Svep filterfrekvensen hit över ljudets längd */
  sweepTo?: number
  music?: boolean
}

const MASTER_VOL = 0.55

export class AudioEngine {
  muted = localStorage.getItem('achtung-muted') === '1'

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null

  get ready(): boolean {
    return this.ctx !== null
  }

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : MASTER_VOL
      this.master.connect(ctx.destination)
      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = 0.42
      this.musicBus.connect(this.master)
      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = 0.85
      this.sfxBus.connect(this.master)

      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuf = buf
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    localStorage.setItem('achtung-muted', muted ? '1' : '0')
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, this.ctx.currentTime, 0.02)
    }
  }

  now(): number {
    return this.ctx?.currentTime ?? 0
  }

  tone(o: ToneOpts): void {
    if (!this.ctx) return
    const t = o.t ?? this.now()
    const dur = o.dur ?? 0.15
    const vol = o.vol ?? 0.3
    const osc = this.ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t)
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(o.glide, 1), t + dur)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)

    let head: AudioNode = osc
    if (o.filter) {
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(o.filter, t)
      head.connect(f)
      head = f
    }
    head.connect(gain)
    gain.connect((o.music ? this.musicBus : this.sfxBus)!)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  noise(o: NoiseOpts): void {
    if (!this.ctx || !this.noiseBuf) return
    const t = o.t ?? this.now()
    const dur = o.dur ?? 0.2
    const vol = o.vol ?? 0.3
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true

    const f = this.ctx.createBiquadFilter()
    f.type = o.filterType ?? 'lowpass'
    f.frequency.setValueAtTime(o.freq ?? 1000, t)
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)

    src.connect(f)
    f.connect(gain)
    gain.connect((o.music ? this.musicBus : this.sfxBus)!)
    src.start(t)
    src.stop(t + dur + 0.05)
  }
}

export function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
