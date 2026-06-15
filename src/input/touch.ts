/**
 * Touch-styrning för LAN-spel på telefon: två håll-knappar (vänster/höger) plus
 * ett "vrid telefonen"-tips i stående läge. Skapas och aktiveras ENBART av
 * NetSession på touch-enheter i spelfasen — den finns aldrig i lokalt läge, så
 * en telefon kan bara fungera som egen LAN-spelare, aldrig som fjärrkontroll.
 */

/** Sant på enheter där den primära pekaren är grov (telefon/platta). */
export function isTouchDevice(): boolean {
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(pointer: coarse)').matches) return true
  }
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
}

export class TouchControls {
  /** Läses varje frame av NetSession och OR:as in i input till servern. */
  left = false
  right = false

  private root: HTMLElement
  private rotateHint: HTMLElement

  constructor() {
    this.root = document.createElement('div')
    this.root.id = 'touch-controls'
    this.root.hidden = true
    this.root.append(this.makeButton('◀', 'left'), this.makeButton('▶', 'right'))

    // Tipset styrs av en orientation-media query i CSS:en — vi växlar bara
    // hidden så att det inte finns kvar utanför spelfasen.
    this.rotateHint = document.createElement('div')
    this.rotateHint.id = 'rotate-hint'
    this.rotateHint.hidden = true
    this.rotateHint.innerHTML = '<div class="rotate-emoji">📱</div><p>Vrid telefonen</p>'

    document.body.append(this.root, this.rotateHint)
  }

  private makeButton(label: string, dir: 'left' | 'right'): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = `touch-btn touch-${dir}`
    btn.textContent = label
    btn.setAttribute('aria-label', dir === 'left' ? 'Sväng vänster' : 'Sväng höger')

    const set = (on: boolean): void => {
      this[dir] = on
      btn.classList.toggle('active', on)
    }
    // Knapparna är oberoende pekarmål → båda kan hållas samtidigt, vilket krävs
    // för 🔫-kanonen och 📐-fyrkantssvängarna (vänster + höger samtidigt).
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      set(true)
      // Behåll pekaren även om fingret glider utanför knappen. Kan kasta för
      // syntetiska pekare (utan aktiv pointerId) — strunta i det då.
      try {
        btn.setPointerCapture(e.pointerId)
      } catch {
        /* ignorera */
      }
    })
    btn.addEventListener('pointerup', () => set(false))
    btn.addEventListener('pointercancel', () => set(false))
    btn.addEventListener('lostpointercapture', () => set(false))
    btn.addEventListener('contextmenu', (e) => e.preventDefault()) // inget långtrycks-menyn
    return btn
  }

  enable(): void {
    this.root.hidden = false
    this.rotateHint.hidden = false
    // Driver mobil-layouten (dold sidopanel, helskärm). Klass i stället för en
    // (pointer: coarse)-media query: knytningen blir exakt till LAN-touch-läget
    // och fungerar pålitligt även under testemulering.
    document.body.classList.add('mobile-lan')
  }

  disable(): void {
    this.root.hidden = true
    this.rotateHint.hidden = true
    this.left = false
    this.right = false
    document.body.classList.remove('mobile-lan')
  }
}
