// Seedad PRNG (mulberry32). Deterministisk så att rundor går att
// reproducera och så att server och klient kan köra samma simulering i LAN-läget.
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** Flyttal i [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Flyttal i [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Heltal i [min, max] (inklusivt) */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  getState(): number {
    return this.s
  }
}
