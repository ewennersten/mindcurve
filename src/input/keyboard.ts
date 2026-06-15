import type { PlayerInput } from '../game/state'

export interface KeyBinding {
  left: string // KeyboardEvent.code
  right: string
}

// Ett par per lobby-slot (MAX_PLAYERS stycken), utspridda över tangentbordet.
// Undvik M (mute), SPACE och ESC. OBS: många tangentbord klarar bara ~6
// samtidiga tangenter — fler än 4 lokala spelare är bäst över LAN.
export const DEFAULT_BINDINGS: KeyBinding[] = [
  { left: 'ArrowLeft', right: 'ArrowRight' },
  { left: 'KeyA', right: 'KeyS' },
  { left: 'KeyV', right: 'KeyB' },
  { left: 'KeyK', right: 'KeyL' },
  { left: 'KeyQ', right: 'KeyW' },
  { left: 'KeyT', right: 'KeyY' },
  { left: 'KeyO', right: 'KeyP' },
  { left: 'Comma', right: 'Period' },
]

/** Läsbar etikett för en KeyboardEvent.code, t.ex. 'ArrowLeft' → '←' */
export function prettyKey(code: string): string {
  const special: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'SPACE',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    ShiftLeft: 'V SHIFT',
    ShiftRight: 'H SHIFT',
    ControlLeft: 'V CTRL',
    ControlRight: 'H CTRL',
    AltLeft: 'V ALT',
    AltRight: 'H ALT',
  }
  if (special[code]) return special[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6)
  return code.toUpperCase()
}

export class Keyboard {
  private pressed = new Set<string>()
  private justPressed = new Set<string>()
  /** Sätts vid omkonfigurering av tangenter — fångar nästa tangenttryck */
  private captureCallback: ((code: string) => void) | null = null

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (this.captureCallback) {
        e.preventDefault()
        const cb = this.captureCallback
        this.captureCallback = null
        cb(e.code)
        return
      }
      // Hindra att piltangenter/space scrollar sidan
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
      if (!e.repeat) this.justPressed.add(e.code)
      this.pressed.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.pressed.delete(e.code)
    })
    window.addEventListener('blur', () => {
      this.pressed.clear()
    })
  }

  isDown(code: string): boolean {
    return this.pressed.has(code)
  }

  /** Sant exakt en gång per nedtryckning (kanttriggad). */
  consumePress(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code)
      return true
    }
    return false
  }

  /** Töm kanttriggade tryck (anropas i slutet av varje frame). */
  flushPresses(): void {
    this.justPressed.clear()
  }

  captureNextKey(cb: (code: string) => void): void {
    this.captureCallback = cb
  }

  cancelCapture(): void {
    this.captureCallback = null
  }

  inputsFor(bindings: KeyBinding[]): PlayerInput[] {
    return bindings.map((b) => ({
      left: this.pressed.has(b.left),
      right: this.pressed.has(b.right),
    }))
  }
}
