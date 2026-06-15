import { MINE_ARM_TICKS, POWERUP_DEFS } from '../game/powerups'
import { type ViewState, derivedStats, FIELD_H, FIELD_W, POWERUP_RADIUS, TPS } from '../game/state'
import logoUrl from '../../logo/mindcamp_logo.png'

const TARGET_COLORS: Record<string, string> = {
  self: '#46d97c',
  others: '#ff4d5e',
  global: '#4da3ff',
}

/** Mindcamp-orange — stjärnans signaturfärg */
const BRAND_ORANGE = '#ee7623'

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
  private scale: number
  private particles: Particle[] = []
  private shake = 0
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
  }

  clearTrails(): void {
    this.trailCtx.clearRect(0, 0, this.trail.width, this.trail.height)
  }

  /** Diffa state per tick och trigga VFX: dödsexplosioner, gnistor, skak. */
  observe(state: ViewState): void {
    if (this.prevAlive && this.prevAlive.length === state.players.length && state.phase !== 'countdown') {
      state.players.forEach((p, i) => {
        if (this.prevAlive![i] && !p.alive) {
          this.explode(p.x, p.y, p.color)
          this.shake = Math.max(this.shake, 15)
        }
      })
    }
    this.prevAlive = state.players.map((p) => p.alive)
    for (const h of state.freshHoles) {
      this.sparks(h.x, h.y)
      this.shake = Math.max(this.shake, 6)
    }
  }

  private explode(x: number, y: number, color: string): void {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 50 + Math.random() * 240
      const ttl = 0.45 + Math.random() * 0.5
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: ttl,
        ttl,
        size: 1.4 + Math.random() * 2.4,
        color: Math.random() < 0.25 ? '#fffdf5' : color,
      })
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

  /** Rita denna ticks nya spårbitar till spårlagret och sudda sprängda hål. */
  applyFresh(state: ViewState): void {
    if (state.freshTrail.length === 0 && state.freshHoles.length === 0) return
    const s = this.scale
    const ctx = this.trailCtx
    for (const f of state.freshTrail) {
      const color = state.players[f.playerId].color
      ctx.strokeStyle = color
      ctx.lineWidth = f.width * s
      ctx.beginPath()
      ctx.moveTo(f.x1 * s, f.y1 * s)
      ctx.lineTo(f.x2 * s, f.y2 * s)
      ctx.stroke()
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

  draw(state: ViewState): void {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height

    // Bakgrund med svag vinjett
    ctx.fillStyle = '#101016'
    ctx.fillRect(0, 0, W, H)
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95)
    vig.addColorStop(0, 'rgba(0,0,0,0)')
    vig.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = vig
    ctx.fillRect(0, 0, W, H)

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

    this.drawPowerUps(state)
    this.drawMines(state)
    this.drawBullets(state)
    // Mörkret läggs över spår/objekt men under huvuden och partiklar
    if (state.darkTicks > 0) this.drawDarkness(state)
    this.drawHeads(state)
    this.updateAndDrawParticles(now)
    this.drawBorder(state)
    if (state.phase === 'countdown') this.drawCountdown(state)

    ctx.restore()
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

    if (state.wrapTicks > 0) {
      // Öppna väggar: streckad ram som blinkar till strax innan effekten tar slut
      const fading = state.wrapTicks < TPS * 1.5 && Math.floor(state.wrapTicks / 8) % 2 === 0
      ctx.strokeStyle = fading ? 'rgba(77,163,255,0.25)' : 'rgba(77,163,255,0.9)'
      ctx.setLineDash([10 * s, 8 * s])
      ctx.lineDashOffset = -state.tick * 0.6 * s
    } else if (inset > 0) {
      // Sudden death: pulserande varningsram
      const pulse = 0.55 + 0.35 * Math.sin(state.tick * 0.2)
      ctx.strokeStyle = `rgba(255,110,64,${pulse})`
    } else {
      ctx.strokeStyle = 'rgba(235,230,245,0.5)'
    }
    ctx.lineWidth = 2.5 * s
    ctx.strokeRect(inset + 1.5 * s, inset + 1.5 * s, W - 2 * inset - 3 * s, H - 2 * inset - 3 * s)
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
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x * s, p.y * s, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,253,250,0.9)'
      ctx.beginPath()
      ctx.arc(p.x * s, p.y * s, r * 0.42, 0, Math.PI * 2)
      ctx.fill()
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
