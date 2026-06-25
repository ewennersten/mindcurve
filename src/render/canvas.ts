import { MINE_ARM_TICKS, POWERUP_DEFS } from '../game/powerups'
import {
  type PowerUpType,
  type ViewState,
  derivedStats,
  FIELD_H,
  FIELD_W,
  POWERUP_RADIUS,
  TPS,
} from '../game/state'
import logoUrl from '../../logo/mindcamp_logo.png'

const TARGET_COLORS: Record<string, string> = {
  self: '#46d97c',
  others: '#ff4d5e',
  global: '#4da3ff',
}

/** Mindcamp-orange — stjärnans signaturfärg */
const BRAND_ORANGE = '#ee7623'

/** Hur långt väggarna som mest kryper in (speglar core.MAX_WALL_INSET) */
const MAX_WALL_INSET = Math.min(FIELD_W, FIELD_H) / 2 - 90
/** Ticks per taktslag vid soundtrackets 126 BPM — arenan pulserar i takt */
const TICKS_PER_BEAT = TPS / (126 / 60)

const logoImg = new Image()
logoImg.src = logoUrl

/** Klientsidig partikel (explosioner, gnistor) — påverkar inte simuleringen */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  ttl: number
  size: number
  color: string
}

/** Expanderande stötvåg-ring (plock, dödsfall). Ren klient-VFX. */
interface Shockwave {
  x: number
  y: number
  life: number
  ttl: number
  /** start- och slutradie i px */
  r0: number
  r1: number
  color: string
  width: number
  /** sekunder kvar innan ringen börjar — låter flera ringar rippla ut i tur */
  delay: number
}

/**
 * Renderare med ett persistent spårlager: varje tick ritas bara de nya
 * spårbitarna dit, och huvudbilden komponeras av spårlagret + dynamiska objekt.
 * Det håller renderkostnaden konstant oavsett hur långa spåren blir.
 * Sköter också ren klient-VFX (dödsexplosioner, gnistor, skärmskak) genom
 * att diffa ViewState — samma mönster som AudioDirector.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D
  private trail: HTMLCanvasElement
  private trailCtx: CanvasRenderingContext2D
  /** Offscreen-lager för mörker-power-upen: svart med urklippta ljuscirklar */
  private dark: HTMLCanvasElement
  private darkCtx: CanvasRenderingContext2D
  /** Förrenderad arenabakgrund (golv, prickmatris, vinjett) — byggs en gång */
  private bg!: HTMLCanvasElement
  private scale: number
  private particles: Particle[] = []
  private shockwaves: Shockwave[] = []
  private shake = 0
  /** Heltäckande färgblixt (additiv) som klingar av per frame */
  private flashA = 0
  private flashColor = '#fffdf5'
  /** Taktpuls (0–1) och uppbyggd press (0–1) som driver arenans energi */
  private beat = 0
  private stress = 0
  /** Pulserande overlay-spår per spelare som har Mindcamp-stjärnan (id → bana).
   *  Det vanliga spåret bakas som vanligt; detta lägger en glödpuls ovanpå. */
  private starTrails = new Map<number, Path2D>()
  private prevAlive: boolean[] | null = null
  private lastDrawTime = 0

  constructor(private canvas: HTMLCanvasElement) {
    this.scale = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = FIELD_W * this.scale
    canvas.height = FIELD_H * this.scale
    this.ctx = canvas.getContext('2d')!
    this.trail = document.createElement('canvas')
    this.trail.width = canvas.width
    this.trail.height = canvas.height
    this.trailCtx = this.trail.getContext('2d')!
    this.trailCtx.lineCap = 'round'
    this.dark = document.createElement('canvas')
    this.dark.width = canvas.width
    this.dark.height = canvas.height
    this.darkCtx = this.dark.getContext('2d')!
    this.buildBackground()
  }

  /** Bygg arenans statiska "scengolv" en gång: lila-svart botten, en svag
   *  scenljus-lyft i mitten, prickmatrisen från lobbyn (sammanhållen identitet)
   *  och en djup vinjett. Blittas varje frame i stället för att räknas om. */
  private buildBackground(): void {
    const W = this.canvas.width
    const H = this.canvas.height
    const s = this.scale
    this.bg = document.createElement('canvas')
    this.bg.width = W
    this.bg.height = H
    const c = this.bg.getContext('2d')!

    // Botten — aningen lila-tonad mot Mindcamps mörka palett
    c.fillStyle = '#0d0d14'
    c.fillRect(0, 0, W, H)

    // Scenljus: en svag lyft i mitten så golvet känns upplyst, inte dött
    const lift = c.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, H * 0.72)
    lift.addColorStop(0, 'rgba(72, 62, 96, 0.22)')
    lift.addColorStop(1, 'rgba(72, 62, 96, 0)')
    c.fillStyle = lift
    c.fillRect(0, 0, W, H)

    // Prickmatris — samma motiv som lobbyns bakgrund, lågmält så spåren läser ovanpå
    const gap = 40 * s
    c.fillStyle = 'rgba(150, 140, 178, 0.06)'
    for (let y = gap; y < H; y += gap) {
      for (let x = gap; x < W; x += gap) {
        c.beginPath()
        c.arc(x, y, 1.1 * s, 0, Math.PI * 2)
        c.fill()
      }
    }

    // Vinjett — djupare och lätt tonad så kanterna ramar in scenen
    const vig = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.98)
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
    vig.addColorStop(1, 'rgba(4, 3, 9, 0.62)')
    c.fillStyle = vig
    c.fillRect(0, 0, W, H)
  }

  clearTrails(): void {
    this.trailCtx.clearRect(0, 0, this.trail.width, this.trail.height)
    this.starTrails.clear()
  }

  /** Diffa state per tick och trigga VFX: dödsexplosioner, plock, gnistor, skak. */
  observe(state: ViewState): void {
    if (this.prevAlive && this.prevAlive.length === state.players.length && state.phase !== 'countdown') {
      state.players.forEach((p, i) => {
        if (this.prevAlive![i] && !p.alive) this.death(p.x, p.y, p.color)
      })
    }
    this.prevAlive = state.players.map((p) => p.alive)

    // Plock-VFX direkt ur spelhändelserna. En despawn:ad (utgången) power-up ger
    // ingen freshPickup-händelse → självdöden triggar alltså ingen plockeffekt.
    for (const ev of state.freshPickups) {
      this.pickup(ev.type, ev.x, ev.y, state.players[ev.by]?.color)
    }

    for (const h of state.freshHoles) {
      this.sparks(h.x, h.y)
      this.shake = Math.max(this.shake, 6)
    }

    // Släpp stjärn-overlayen när stjärnan tagit slut (eller bäraren dött) — det
    // vanliga, redan bakade spåret står kvar; bara pulsen försvinner.
    if (this.starTrails.size > 0) {
      for (const pid of [...this.starTrails.keys()]) {
        const pl = state.players[pid]
        if (!pl || !pl.alive || !derivedStats(pl).star) this.starTrails.delete(pid)
      }
    }
  }

  /** Dödsfall: stor partikelsmäll + chockring + färgblixt + rejäl skärmskak. */
  private death(x: number, y: number, color: string): void {
    this.explode(x, y, color)
    this.shockwave(x, y, color, { r1: 130, width: 6, ttl: 0.5 })
    this.shockwave(x, y, '#fffdf5', { r1: 70, width: 3, ttl: 0.32 })
    this.addFlash(color, 0.16)
    this.shake = Math.max(this.shake, 21)
  }

  /** Power-up plockad: chockring i mål-färgen + gnistskur i plockarens färg.
   *  Mindcamp-stjärnan får en överdådig multi-ring-utlösning. */
  private pickup(type: PowerUpType, x: number, y: number, pickerColor?: string): void {
    const isStar = type === 'mindcamp'
    const ring = isStar ? BRAND_ORANGE : (TARGET_COLORS[POWERUP_DEFS[type].target] ?? '#fffdf5')
    const picker = pickerColor ?? ring

    if (isStar) {
      // Stjärnan trumfar allt — tre rasande ringar, gyllene blixt, gnistregn
      this.shockwave(x, y, BRAND_ORANGE, { r1: 200, width: 8, ttl: 0.7 })
      this.shockwave(x, y, '#ffd86b', { r1: 150, width: 5, ttl: 0.6, delay: 0.08 })
      this.shockwave(x, y, '#fffdf5', { r1: 100, width: 4, ttl: 0.5, delay: 0.16 })
      this.burst(x, y, BRAND_ORANGE, 34, 280)
      this.burst(x, y, '#ffd86b', 16, 200)
      this.addFlash(BRAND_ORANGE, 0.24)
      this.shake = Math.max(this.shake, 16)
    } else {
      this.shockwave(x, y, ring, { r1: 96, width: 4.5, ttl: 0.5 })
      this.burst(x, y, picker, 22, 210)
      this.addFlash(ring, 0.09)
      this.shake = Math.max(this.shake, 4)
    }
  }

  private explode(x: number, y: number, color: string): void {
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 60 + Math.random() * 340
      const ttl = 0.5 + Math.random() * 0.6
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: ttl,
        ttl,
        size: 1.6 + Math.random() * 3,
        color: Math.random() < 0.3 ? '#fffdf5' : color,
      })
    }
  }

  /** Liten poppande gnistskur (plock-VFX) — snabb och färgglad. */
  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.35 + Math.random() * 0.65)
      const ttl = 0.3 + Math.random() * 0.45
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: ttl,
        ttl,
        size: 1.2 + Math.random() * 2,
        color: Math.random() < 0.4 ? '#fffdf5' : color,
      })
    }
  }

  private shockwave(
    x: number,
    y: number,
    color: string,
    opts: { r1: number; width?: number; ttl?: number; delay?: number; r0?: number },
  ): void {
    this.shockwaves.push({
      x,
      y,
      life: opts.ttl ?? 0.5,
      ttl: opts.ttl ?? 0.5,
      r0: opts.r0 ?? 2,
      r1: opts.r1,
      color,
      width: opts.width ?? 4,
      delay: opts.delay ?? 0,
    })
  }

  /** Höj färgblixten (additiv heltäckare). Behåll den starkaste begäran. */
  private addFlash(color: string, a: number): void {
    if (a >= this.flashA) {
      this.flashA = Math.min(0.3, a)
      this.flashColor = color
    }
  }

  private sparks(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 90 + Math.random() * 220
      const ttl = 0.18 + Math.random() * 0.25
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: ttl,
        ttl,
        size: 1 + Math.random() * 1.6,
        color: Math.random() < 0.5 ? '#ffb347' : '#fffdf5',
      })
    }
  }

  private updateAndDrawParticles(now: number): void {
    const dt = Math.min((now - this.lastDrawTime) / 1000, 0.05)
    const ctx = this.ctx
    const s = this.scale
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 1 - 2.2 * dt
      p.vy *= 1 - 2.2 * dt
      ctx.globalAlpha = p.life / p.ttl
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x * s, p.y * s, p.size * s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private updateAndDrawShockwaves(now: number): void {
    if (this.shockwaves.length === 0) return
    const dt = Math.min((now - this.lastDrawTime) / 1000, 0.05)
    const ctx = this.ctx
    const s = this.scale
    ctx.save()
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i]
      if (w.delay > 0) {
        w.delay -= dt
        continue
      }
      w.life -= dt
      if (w.life <= 0) {
        this.shockwaves.splice(i, 1)
        continue
      }
      const t = 1 - w.life / w.ttl // 0 → 1 över ringens livstid
      const ease = 1 - (1 - t) ** 4 // ease-out-quart: snabbt ut, mjuk inbromsning
      const r = w.r0 + (w.r1 - w.r0) * ease
      ctx.globalAlpha = (1 - t) * 0.85
      ctx.strokeStyle = w.color
      ctx.lineWidth = Math.max(0.5, w.width * (1 - t * 0.55)) * s
      ctx.beginPath()
      ctx.arc(w.x * s, w.y * s, r * s, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  /** Rita denna ticks nya spårbitar till spårlagret och sudda sprängda hål. */
  applyFresh(state: ViewState): void {
    if (state.freshTrail.length === 0 && state.freshHoles.length === 0) return
    const s = this.scale
    const ctx = this.trailCtx
    for (const f of state.freshTrail) {
      const player = state.players[f.playerId]
      ctx.strokeStyle = player.color
      ctx.lineWidth = f.width * s
      ctx.beginPath()
      ctx.moveTo(f.x1 * s, f.y1 * s)
      ctx.lineTo(f.x2 * s, f.y2 * s)
      ctx.stroke()
      // Stjärnbärarens segment samlas också i en pulsande glödbana ovanpå
      if (derivedStats(player).star) {
        let path = this.starTrails.get(f.playerId)
        if (!path) {
          path = new Path2D()
          this.starTrails.set(f.playerId, path)
        }
        path.moveTo(f.x1 * s, f.y1 * s)
        path.lineTo(f.x2 * s, f.y2 * s)
      }
    }
    if (state.freshHoles.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      for (const h of state.freshHoles) {
        ctx.beginPath()
        ctx.arc(h.x * s, h.y * s, h.r * s, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  /** Pulserande glödbana för spelare med Mindcamp-stjärnan — ritas ovanpå det
   *  bakade spåret. Två stryk per spelare (glöd + kärna) oavsett spårets längd. */
  private drawStarTrails(state: ViewState): void {
    if (this.starTrails.size === 0) return
    const ctx = this.ctx
    const s = this.scale
    const pulse = 0.5 + 0.5 * Math.sin(state.tick * 0.34)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const [pid, path] of this.starTrails) {
      const color = state.players[pid]?.color ?? '#fffdf5'
      // Yttre glöd (additiv) — bredd och styrka pulsar
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.16 + 0.26 * pulse
      ctx.lineWidth = (8 + 9 * pulse) * s
      ctx.stroke(path)
      // Vit-het kärna som glimmar i takt
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.6 + 0.4 * pulse
      ctx.lineWidth = (2 + 1.5 * pulse) * s
      ctx.strokeStyle = '#fffdf5'
      ctx.stroke(path)
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  draw(state: ViewState): void {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height

    // Förrenderat scengolv (botten + prickmatris + vinjett)
    ctx.drawImage(this.bg, 0, 0)

    // Arenans energi: en taktpuls (party) som hettar upp med pressen (stress).
    // Pressen byggs av antal döda + hur långt väggarna krupit, och rampas mjukt.
    this.beat = 0.5 + 0.5 * Math.sin(state.tick * ((Math.PI * 2) / TICKS_PER_BEAT))
    const dead = state.players.reduce((n, p) => n + (p.alive ? 0 : 1), 0)
    const deadFrac = state.players.length > 1 ? dead / (state.players.length - 1) : 0
    const shrinkFrac = Math.min(state.wallInset / MAX_WALL_INSET, 1)
    const targetStress = state.phase === 'playing' ? Math.min(1, deadFrac * 0.55 + shrinkFrac * 0.85) : 0
    this.stress += (targetStress - this.stress) * 0.08

    // Golvets hjärtslag — en svag mittglöd som andas i takt och blir hetare av pressen
    {
      const hb = 0.04 + 0.05 * this.beat + 0.1 * this.stress * (0.5 + 0.5 * this.beat)
      const cr = Math.round(150 + 95 * this.stress)
      const cg = Math.round(110 - 55 * this.stress)
      const cb = Math.round(70 - 30 * this.stress)
      const heart = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, H * 0.7)
      heart.addColorStop(0, `rgba(${cr},${cg},${cb},${hb})`)
      heart.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = heart
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }

    const now = performance.now()
    ctx.save()

    // Skärmskak (dödsexplosioner, kanonträffar) — avklingar per frame
    if (this.shake > 0.3) {
      ctx.translate(
        (Math.random() * 2 - 1) * this.shake * this.scale * 0.7,
        (Math.random() * 2 - 1) * this.shake * this.scale * 0.7,
      )
      this.shake *= 0.87
    } else {
      this.shake = 0
    }

    // Öl-power-upen: hela scenen gungar (lätt uppskalad så kanterna inte glipar)
    if (state.wobbleTicks > 0) {
      const a = Math.min(state.wobbleTicks / (TPS * 1.5), 1)
      ctx.translate(
        W / 2 + Math.sin(state.tick * 0.045) * 13 * this.scale * a,
        H / 2 + Math.cos(state.tick * 0.06) * 9 * this.scale * a,
      )
      ctx.rotate(Math.sin(state.tick * 0.032) * 0.035 * a)
      ctx.scale(1 + 0.06 * a, 1 + 0.06 * a)
      ctx.translate(-W / 2, -H / 2)
    }

    ctx.drawImage(this.trail, 0, 0)
    this.drawStarTrails(state)

    this.drawPowerUps(state)
    this.drawMines(state)
    this.drawBullets(state)
    // Mörkret läggs över spår/objekt men under huvuden och partiklar
    if (state.darkTicks > 0) this.drawDarkness(state)
    this.drawHeads(state)
    this.updateAndDrawParticles(now)
    this.updateAndDrawShockwaves(now)
    this.drawBorder(state)
    if (state.phase === 'countdown') this.drawCountdown(state)

    ctx.restore()

    // Kant-energi: en pulserande ljusram (party) som hettar till en röd klämma
    // när pressen stiger (stress). Tonar kanterna — mitten lämnas läsbar för spåren.
    {
      const ea = 0.1 + 0.1 * this.beat + 0.36 * this.stress * (0.55 + 0.45 * this.beat)
      const r = Math.round(238 + 17 * this.stress) // 238 → 255
      const g = Math.round(118 - 80 * this.stress) // 118 → 38
      const b = Math.round(35 + 12 * this.stress) // 35 → 47
      const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.48, W / 2, H / 2, H * 1.02)
      edge.addColorStop(0, `rgba(${r},${g},${b},0)`)
      edge.addColorStop(1, `rgba(${r},${g},${b},${ea})`)
      ctx.save()
      ctx.fillStyle = edge
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }

    // Additiv färgblixt över hela bilden (dödsfall/plock) — klingar snabbt
    if (this.flashA > 0.01) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = this.flashA
      ctx.fillStyle = this.flashColor
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
      this.flashA *= 0.8
    } else {
      this.flashA = 0
    }

    this.lastDrawTime = now
  }

  private drawBullets(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    for (const b of state.bullets) {
      const color = state.players[b.playerId]?.color ?? '#fff'
      const x = b.x * s
      const y = b.y * s
      ctx.save()
      // Lysande tracer bakåt längs banan
      ctx.strokeStyle = color
      ctx.lineWidth = 2.2 * s
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(x - Math.cos(b.angle) * 11 * s, y - Math.sin(b.angle) * 11 * s)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fffdf5'
      ctx.beginPath()
      ctx.arc(x, y, 2.6 * s, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawBorder(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    const W = this.canvas.width
    const H = this.canvas.height
    const inset = state.wallInset * s
    ctx.save()

    // Dimma dödszonen utanför de inkrupna väggarna
    if (inset > 0) {
      ctx.fillStyle = 'rgba(6,6,10,0.62)'
      ctx.fillRect(0, 0, W, inset)
      ctx.fillRect(0, H - inset, W, inset)
      ctx.fillRect(0, inset, inset, H - 2 * inset)
      ctx.fillRect(W - inset, inset, inset, H - 2 * inset)
    }

    // Ramens färg/stil per tillstånd
    let dashed = false
    let col: string
    if (state.wrapTicks > 0) {
      // Öppna väggar: streckad ram som blinkar till strax innan effekten tar slut
      const fading = state.wrapTicks < TPS * 1.5 && Math.floor(state.wrapTicks / 8) % 2 === 0
      col = fading ? 'rgba(77,163,255,0.3)' : 'rgba(77,163,255,0.95)'
      dashed = true
    } else if (inset > 0) {
      // Sudden death: snabb, skarp varningsram som hamrar i takt med pressen
      const pulse = 0.6 + 0.4 * Math.sin(state.tick * 0.35)
      col = `rgba(255,110,64,${pulse})`
    } else {
      col = 'rgba(235,230,245,0.62)'
    }

    const x0 = inset + 1.5 * s
    const y0 = inset + 1.5 * s
    const x1 = W - inset - 1.5 * s
    const y1 = H - inset - 1.5 * s

    // Neonram med glöd som andas i takt och flammar upp när pressen stiger
    ctx.strokeStyle = col
    ctx.lineWidth = (2.5 + 1.2 * this.stress) * s
    ctx.shadowColor = col
    ctx.shadowBlur = (7 + 6 * this.beat + 12 * this.stress) * s
    if (dashed) {
      ctx.setLineDash([10 * s, 8 * s])
      ctx.lineDashOffset = -state.tick * 0.6 * s
    }
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
    ctx.setLineDash([])

    // Arkadbezel: Mindcamp-orange hörnklamrar som pulserar i takt med musiken
    const L = (36 + 7 * this.beat) * s
    ctx.strokeStyle = BRAND_ORANGE
    ctx.lineWidth = (3.5 + 1.3 * this.beat) * s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(238,118,35,0.65)'
    ctx.shadowBlur = (9 + 7 * this.beat + 8 * this.stress) * s
    ctx.beginPath()
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0) // ↖
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L) // ↗
    ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1) // ↘
    ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L) // ↙
    ctx.stroke()

    ctx.restore()
  }

  private drawHeads(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    for (const p of state.players) {
      if (!p.alive) continue
      const stats = derivedStats(p)
      const r = Math.max(stats.halfWidth + 1.4, 3.4) * s
      ctx.save()
      if (stats.star) {
        // Mindcamp-stjärnan: pulserande orange aura + roterande ring
        const pulse = 1 + 0.25 * Math.sin(state.tick * 0.3)
        const glow = ctx.createRadialGradient(p.x * s, p.y * s, r, p.x * s, p.y * s, r * 3.4 * pulse)
        glow.addColorStop(0, 'rgba(238,118,35,0.55)')
        glow.addColorStop(1, 'rgba(238,118,35,0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r * 3.4 * pulse, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = BRAND_ORANGE
        ctx.lineWidth = 2 * s
        ctx.setLineDash([5 * s, 5 * s])
        ctx.lineDashOffset = state.tick * 0.9 * s
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r + 5 * s, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (stats.shield) {
        // Sköld: stadig silverring runt huvudet
        ctx.strokeStyle = 'rgba(215,228,255,0.85)'
        ctx.lineWidth = 2 * s
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r + 3.5 * s, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (stats.ghost) {
        // Spöke: pulserande, genomskinligt huvud med ring
        ctx.globalAlpha = 0.45 + 0.25 * Math.sin(state.tick * 0.25)
        ctx.strokeStyle = p.color
        ctx.lineWidth = 1.5 * s
        ctx.setLineDash([4 * s, 4 * s])
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r + 4 * s, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (p.avatar) {
        // Avatar-emoji vid huvudet. Lagom liten: tydligt synlig men nära den
        // faktiska (lilla) träffytan så att man inte styr för försiktigt. En
        // mörk bakgrundsprick lyfter emojin mot spåren, en tunn färgring visar
        // vems mask det är.
        const fs = Math.max(13 * s, r * 2.4)
        const cx = p.x * s
        const cy = p.y * s
        ctx.fillStyle = 'rgba(10,10,16,0.55)'
        ctx.beginPath()
        ctx.arc(cx, cy, fs * 0.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = p.color
        ctx.lineWidth = 2 * s
        ctx.beginPath()
        ctx.arc(cx, cy, fs * 0.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.font = `${Math.round(fs)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#fffdf5' // syns för icke-emoji-tecken; färgemoji ignorerar den
        ctx.fillText(p.avatar, cx, cy + 1 * s)
      } else {
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,253,250,0.9)'
        ctx.beginPath()
        ctx.arc(p.x * s, p.y * s, r * 0.42, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private drawPowerUps(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    for (const pu of state.powerups) {
      const def = POWERUP_DEFS[pu.type]
      const isStar = pu.type === 'mindcamp'
      const ring = isStar ? BRAND_ORANGE : TARGET_COLORS[def.target]
      const x = pu.x * s
      const y = pu.y * s
      const r = POWERUP_RADIUS * s
      const bob = Math.sin((state.tick + pu.id * 17) * 0.07) * 1.2 * s
      ctx.save()
      ctx.translate(0, bob)
      // Sista ~1,5 s innan despawn: tona ut och blinka allt snabbare som varning
      const FADE_TICKS = TPS * 1.5
      if (pu.ttl < FADE_TICKS) {
        const fade = pu.ttl / FADE_TICKS
        const blink = 0.5 + 0.5 * Math.sin(state.tick * 0.45)
        ctx.globalAlpha = Math.max(0.08, fade * (0.35 + 0.65 * blink))
      }
      ctx.fillStyle = isStar ? '#fffdf5' : '#15151d'
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = ring
      ctx.lineWidth = isStar ? (2.4 + 1.2 * Math.sin(state.tick * 0.18)) * s : 2.4 * s
      ctx.stroke()
      if (isStar && logoImg.complete && logoImg.naturalWidth > 0) {
        // Mindcamp-loggan som ikon
        const d = r * 1.5
        ctx.drawImage(logoImg, x - d / 2, y - d / 2, d, d)
      } else {
        // Emoji-ikon (färgad av typsnittet, inte av fillStyle)
        ctx.font = `${Math.round(14 * s)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(def.icon, x, y + 1 * s)
      }
      ctx.restore()
    }
  }

  private drawMines(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    for (const m of state.mines) {
      const x = m.x * s
      const y = m.y * s
      const armed = m.armIn <= 0
      ctx.save()
      if (armed) {
        // Skarp: pulserande röd med varningsglöd
        const pulse = 0.5 + 0.5 * Math.sin(state.tick * 0.25)
        const glow = ctx.createRadialGradient(x, y, 2 * s, x, y, 14 * s)
        glow.addColorStop(0, `rgba(255,70,85,${0.25 + 0.3 * pulse})`)
        glow.addColorStop(1, 'rgba(255,70,85,0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(x, y, 14 * s, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#2a1216'
        ctx.beginPath()
        ctx.arc(x, y, 6 * s, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = `rgba(255,70,85,${0.6 + 0.4 * pulse})`
        ctx.lineWidth = 1.8 * s
        ctx.stroke()
        ctx.fillStyle = `rgba(255,90,100,${0.6 + 0.4 * pulse})`
        ctx.beginPath()
        ctx.arc(x, y, 2.2 * s, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // Armeras: grå puck med krympande nedräkningsring
        ctx.globalAlpha = 0.8
        ctx.fillStyle = '#23232d'
        ctx.beginPath()
        ctx.arc(x, y, 6 * s, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(200,200,215,0.7)'
        ctx.lineWidth = 1.8 * s
        const frac = 1 - m.armIn / MINE_ARM_TICKS
        ctx.beginPath()
        ctx.arc(x, y, 8 * s, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  /** Mörker-power-upen: svart lager där bara plockaren får en ljuscirkel —
   *  alla andra ser sina huvudprickar (ritas ovanpå) men inte spåren runt sig. */
  private drawDarkness(state: ViewState): void {
    const s = this.scale
    const W = this.dark.width
    const H = this.dark.height
    const dctx = this.darkCtx
    dctx.clearRect(0, 0, W, H)
    dctx.fillStyle = 'rgba(4,4,8,0.96)'
    dctx.fillRect(0, 0, W, H)
    const owner = state.darkOwner != null ? state.players[state.darkOwner] : null
    if (owner?.alive) {
      dctx.globalCompositeOperation = 'destination-out'
      const x = owner.x * s
      const y = owner.y * s
      const r = (72 + 4 * Math.sin(state.tick * 0.09)) * s
      const hole = dctx.createRadialGradient(x, y, r * 0.3, x, y, r)
      hole.addColorStop(0, 'rgba(0,0,0,1)')
      hole.addColorStop(1, 'rgba(0,0,0,0)')
      dctx.fillStyle = hole
      dctx.beginPath()
      dctx.arc(x, y, r, 0, Math.PI * 2)
      dctx.fill()
      dctx.globalCompositeOperation = 'source-over'
    }
    // Tona in/ut med effektens början/slut
    this.ctx.globalAlpha = Math.min(state.darkTicks / (TPS * 0.8), 1)
    this.ctx.drawImage(this.dark, 0, 0)
    this.ctx.globalAlpha = 1
  }

  private drawCountdown(state: ViewState): void {
    const ctx = this.ctx
    const s = this.scale
    // Riktningspil från varje huvud
    for (const p of state.players) {
      const len = 34 * s
      const x0 = p.x * s
      const y0 = p.y * s
      const x1 = x0 + Math.cos(p.angle) * len
      const y1 = y0 + Math.sin(p.angle) * len
      ctx.save()
      ctx.strokeStyle = p.color
      ctx.fillStyle = p.color
      ctx.lineWidth = 2.4 * s
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const a = p.angle
      const hs = 7 * s
      ctx.beginPath()
      ctx.moveTo(x1 + Math.cos(a) * hs, y1 + Math.sin(a) * hs)
      ctx.lineTo(x1 + Math.cos(a + 2.5) * hs, y1 + Math.sin(a + 2.5) * hs)
      ctx.lineTo(x1 + Math.cos(a - 2.5) * hs, y1 + Math.sin(a - 2.5) * hs)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    // Nedräkningssiffra
    const num = Math.ceil(state.countdown / TPS)
    const frac = (state.countdown % TPS) / TPS
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.6 * frac
    ctx.fillStyle = '#f2eee8'
    ctx.font = `${Math.round(120 * s)}px "Tilt Neon", "Space Grotesk", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(num), this.canvas.width / 2, this.canvas.height / 2)
    ctx.restore()
  }
}
