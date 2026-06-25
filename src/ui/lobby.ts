import { resolveTargetScore } from '../game/core'
import type { GameSettings, PowerUpType } from '../game/state'
import { BOT_LEVEL_LABELS, BOT_NAMES, DEFAULT_BOT_LEVEL } from '../game/bot'
import { POWERUP_DEFS } from '../game/powerups'
import logoUrl from '../../logo/mindcamp_logo.png'
import { type KeyBinding, type Keyboard, DEFAULT_BINDINGS, prettyKey } from '../input/keyboard'

import { PLAYER_COLORS } from '../game/state'
export { PLAYER_COLORS }
const SLOT_NAMES = ['Röd', 'Grön', 'Blå', 'Gul', 'Lila', 'Turkos', 'Rosa', 'Orange']

export interface PlayerConfig {
  name: string
  color: string
  binding: KeyBinding
  /** Botstyrd — ignorerar tangentbordet, får input från botInput() */
  bot: boolean
  /** Valfri emoji som visas vid masken i stället för standardpricken */
  avatar: string
}

const TARGET_CHOICES: GameSettings['targetScore'][] = ['auto', 5, 10, 15, 20, 30, 50]
const SHRINK_CHOICES: GameSettings['shrinkAfterSec'][] = ['off', 30, 60, 120, 180]

function shrinkLabel(v: GameSettings['shrinkAfterSec']): string {
  if (v === 'off') return 'Av'
  return v < 60 ? `${v} s` : `${v / 60} min`
}

/** Väljare för när arenan börjar krympa — delas av lokala lobbyn och LAN-lobbyn. */
export function createShrinkSelect(
  current: GameSettings['shrinkAfterSec'],
  onChange: (v: GameSettings['shrinkAfterSec']) => void,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'setting'
  const select = document.createElement('select')
  select.className = 'target-select'
  for (const v of SHRINK_CHOICES) {
    const opt = document.createElement('option')
    opt.value = String(v)
    opt.textContent = shrinkLabel(v)
    select.append(opt)
  }
  select.value = String(current)
  select.addEventListener('change', () => {
    onChange(select.value === 'off' ? 'off' : Number(select.value))
  })
  label.append(document.createTextNode('Krympning '), select)
  label.title = 'Hur långt in i rundan väggarna börjar krypa inåt'
  return label
}

/** Toggle-chips för enskilda power-up-typer — delas av lokala lobbyn och
 *  LAN-lobbyn. `disabled` är typerna som är AV; klick togglar och rapporterar
 *  hela den nya listan via `onChange`. */
export function createPowerUpToggles(
  disabled: PowerUpType[],
  onChange: (disabled: PowerUpType[]) => void,
  locked = false,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'pu-toggles'
  for (const def of Object.values(POWERUP_DEFS)) {
    const btn = document.createElement('button')
    const isOff = disabled.includes(def.type)
    btn.type = 'button'
    btn.className = 'pu-toggle' + (isOff ? ' off' : '')
    // Egen hover-tooltip (CSS via data-tip) — ikonen i en span så att
    // off-nedtoningen inte drabbar tooltipen
    const icon = document.createElement('span')
    icon.className = 'pu-icon'
    icon.textContent = def.icon
    btn.append(icon)
    btn.dataset.tip = `${def.label}\n${isOff ? 'Avstängd — klicka för att slå på' : 'Klicka för att slå av'}`
    btn.disabled = locked
    btn.addEventListener('click', () => {
      onChange(isOff ? disabled.filter((t) => t !== def.type) : [...disabled, def.type])
    })
    row.append(btn)
  }
  return row
}

/** Svårighetsslider för bottarna — delas av lokala lobbyn och LAN-lobbyn.
 *  Nivå 1–5; etiketten uppdateras live utan att hela lobbyn ritas om. */
export function createBotLevelSlider(
  current: number,
  onChange: (level: number) => void,
  locked = false,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'setting bot-level'
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '1'
  slider.max = '5'
  slider.step = '1'
  slider.value = String(current)
  slider.disabled = locked
  const value = document.createElement('span')
  value.className = 'bot-level-label'
  value.textContent = BOT_LEVEL_LABELS[current - 1]
  // Etiketten följer draget live; onChange först när man släpper — i LAN-lobbyn
  // triggar varje ändring en broadcast som ritar om lobbyn (skulle avbryta draget)
  slider.addEventListener('input', () => {
    value.textContent = BOT_LEVEL_LABELS[Number(slider.value) - 1]
  })
  slider.addEventListener('change', () => onChange(Number(slider.value)))
  label.append(document.createTextNode('🤖 Nivå '), slider, value)
  label.title = 'Bottarnas svårighetsgrad — högre nivå ser längre fram och väjer tidigare'
  return label
}

/** Poängmålsväljare — delas av den lokala lobbyn och LAN-lobbyn. */
export function createTargetSelect(
  current: GameSettings['targetScore'],
  onChange: (v: GameSettings['targetScore']) => void,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'setting'
  const select = document.createElement('select')
  select.className = 'target-select'
  for (const v of TARGET_CHOICES) {
    const opt = document.createElement('option')
    opt.value = String(v)
    opt.textContent = v === 'auto' ? 'Auto' : `${v} poäng`
    select.append(opt)
  }
  select.value = String(current)
  select.addEventListener('change', () => {
    onChange(select.value === 'auto' ? 'auto' : Number(select.value))
  })
  label.append(document.createTextNode('Poängmål '), select)
  return label
}

interface Slot {
  joined: boolean
  /** Platsen är en botspelare */
  bot: boolean
  name: string
  /** Valfri emoji vid masken */
  avatar: string
  binding: KeyBinding
  /** 'left' | 'right' när vi väntar på en ny tangent för den sidan */
  remapping: 'left' | 'right' | null
  error: string | null
}

export class Lobby {
  onStart: (players: PlayerConfig[], settings: GameSettings, botLevel: number) => void = () => {}
  onLan: () => void = () => {}

  private el: HTMLElement
  private slots: Slot[]
  private powerupsEnabled = true
  private botLevel = DEFAULT_BOT_LEVEL
  private disabledPowerups: PowerUpType[] = []
  private targetScore: GameSettings['targetScore'] = 'auto'
  private shrinkAfterSec: GameSettings['shrinkAfterSec'] = 30

  constructor(private keyboard: Keyboard) {
    this.el = document.getElementById('lobby')!
    this.slots = DEFAULT_BINDINGS.map((b, i) => ({
      joined: i === 0, // första spelaren är med från start så skärmen inte är tom
      bot: false,
      name: SLOT_NAMES[i],
      avatar: '',
      binding: { ...b },
      remapping: null,
      error: null,
    }))
    this.render()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  show(): void {
    this.el.hidden = false
    this.render()
  }

  hide(): void {
    this.el.hidden = true
    this.keyboard.cancelCapture()
    for (const s of this.slots) s.remapping = null
  }

  /** Anropas varje frame från huvudloopen medan lobbyn är synlig. */
  update(): void {
    for (const slot of this.slots) {
      if (!slot.joined && this.keyboard.consumePress(slot.binding.left)) {
        slot.joined = true
        this.render()
      }
    }
    if (this.keyboard.consumePress('Space')) this.start()
  }

  private joinedSlots(): Slot[] {
    return this.slots.filter((s) => s.joined)
  }

  private start(): void {
    const joined = this.joinedSlots()
    if (joined.length === 0) return
    const players: PlayerConfig[] = joined.map((s) => ({
      name: s.name.trim() || SLOT_NAMES[this.slots.indexOf(s)],
      color: PLAYER_COLORS[this.slots.indexOf(s)],
      binding: s.binding,
      bot: s.bot,
      avatar: s.avatar.trim(),
    }))
    this.onStart(
      players,
      {
        powerupsEnabled: this.powerupsEnabled,
        disabledPowerups: this.disabledPowerups,
        targetScore: this.targetScore,
        shrinkAfterSec: this.shrinkAfterSec,
      },
      this.botLevel,
    )
  }

  private beginRemap(slot: Slot, side: 'left' | 'right'): void {
    for (const s of this.slots) s.remapping = null
    slot.remapping = side
    slot.error = null
    this.render()
    this.keyboard.captureNextKey((code) => {
      const taken = this.slots.some(
        (s) => s.joined !== false && (s.binding.left === code || s.binding.right === code) && !(s === slot && s.binding[side] === code),
      )
      if (taken) {
        slot.error = `${prettyKey(code)} är upptagen`
      } else {
        slot.binding[side] = code
      }
      slot.remapping = null
      this.render()
    })
  }

  private render(): void {
    this.el.replaceChildren()

    const head = document.createElement('header')
    head.className = 'lobby-head'
    head.innerHTML = `
      <div class="title-row">
        <img class="logo" src="${logoUrl}" alt="Mindcamp" />
        <h1>MIND<span class="bang">CURVE</span></h1>
      </div>
      <p class="tagline">Mindcamp edition — sista masken vinner</p>`
    this.el.append(head)

    const grid = document.createElement('div')
    grid.className = 'slots'
    this.slots.forEach((slot, i) => grid.append(this.renderSlot(slot, i)))
    this.el.append(grid)

    const hint = document.createElement('p')
    hint.className = 'fire-hint'
    hint.textContent = '🔫 Plockar du upp kanonen: tryck vänster + höger samtidigt för att skjuta hål i spåren'
    this.el.append(hint)

    const joinedCount = this.joinedSlots().length
    const target = resolveTargetScore(joinedCount, this.targetScore)

    const foot = document.createElement('footer')
    foot.className = 'lobby-foot'

    const settings = document.createElement('label')
    settings.className = 'setting'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.powerupsEnabled
    cb.addEventListener('change', () => {
      this.powerupsEnabled = cb.checked
      this.render() // visa/dölj toggle-raden för enskilda typer
    })
    settings.append(cb, document.createTextNode(' Power-ups'))

    const targetSetting = createTargetSelect(this.targetScore, (v) => {
      this.targetScore = v
      this.render()
    })

    const shrinkSetting = createShrinkSelect(this.shrinkAfterSec, (v) => {
      this.shrinkAfterSec = v
    })

    // Bot-nivån visas bara när minst en bot är med
    const botSlider = this.slots.some((s) => s.bot)
      ? createBotLevelSlider(this.botLevel, (v) => {
          this.botLevel = v
        })
      : null

    const info = document.createElement('p')
    info.className = 'target-info'
    info.textContent =
      joinedCount >= 2 ? `Först till ${target} poäng vinner matchen` : 'En spelare — träningsläge utan matchmål'

    const startBtn = document.createElement('button')
    startBtn.className = 'start-btn'
    startBtn.disabled = joinedCount === 0
    startBtn.innerHTML = 'STARTA <kbd>SPACE</kbd>'
    startBtn.addEventListener('click', () => this.start())

    foot.append(settings, targetSetting, shrinkSetting)
    if (botSlider) foot.append(botSlider)
    foot.append(info, startBtn)
    this.el.append(foot)

    if (this.powerupsEnabled) {
      this.el.append(
        createPowerUpToggles(this.disabledPowerups, (next) => {
          this.disabledPowerups = next
          this.render()
        }),
      )
    }

    const lan = document.createElement('button')
    lan.className = 'leave lan-link'
    lan.textContent = 'Spela över LAN →'
    lan.addEventListener('click', () => this.onLan())
    this.el.append(lan)
  }

  private renderSlot(slot: Slot, i: number): HTMLElement {
    const color = PLAYER_COLORS[i]
    const div = document.createElement('div')
    div.className = `slot ${slot.joined ? 'joined' : 'open'}`
    div.style.setProperty('--c', color)

    if (!slot.joined) {
      div.innerHTML = `
        <span class="swatch"></span>
        <p class="join-hint">Tryck <kbd>${prettyKey(slot.binding.left)}</kbd><br>för att gå med</p>`
      div.addEventListener('click', () => {
        slot.joined = true
        this.render()
      })
      const botBtn = document.createElement('button')
      botBtn.className = 'leave bot-add'
      botBtn.textContent = '🤖 Lägg till bot'
      botBtn.addEventListener('click', (e) => {
        e.stopPropagation() // annars joinar klicket platsen som människa
        slot.joined = true
        slot.bot = true
        slot.name = BOT_NAMES[i % BOT_NAMES.length]
        slot.avatar = '🤖'
        this.render()
      })
      div.append(botBtn)
      return div
    }

    const swatch = document.createElement('span')
    swatch.className = 'swatch'

    const name = document.createElement('input')
    name.className = 'name'
    name.value = slot.name
    name.maxLength = 12
    name.addEventListener('input', () => {
      slot.name = name.value
    })

    if (slot.bot) {
      // Botplats: ingen tangentkonfiguration, bara märke + ta bort
      const tag = document.createElement('p')
      tag.className = 'bot-tag'
      tag.textContent = '🤖 botstyrd'
      const remove = document.createElement('button')
      remove.className = 'leave'
      remove.textContent = 'Ta bort'
      remove.addEventListener('click', () => {
        slot.joined = false
        slot.bot = false
        slot.name = SLOT_NAMES[i]
        slot.avatar = ''
        this.render()
      })
      div.append(swatch, name, tag, remove)
      return div
    }

    // Valfri avatar-emoji som ritas vid masken (OS-emojiväljaren funkar i fältet)
    const avatar = document.createElement('input')
    avatar.className = 'avatar-input'
    avatar.value = slot.avatar
    avatar.maxLength = 8
    avatar.placeholder = '🙂'
    avatar.title = 'Valfri emoji vid din mask — lämna tomt för standardprick'
    avatar.addEventListener('input', () => {
      slot.avatar = avatar.value.trim()
    })

    const keys = document.createElement('div')
    keys.className = 'keys'
    for (const side of ['left', 'right'] as const) {
      const btn = document.createElement('button')
      btn.className = 'key' + (slot.remapping === side ? ' listening' : '')
      btn.textContent = slot.remapping === side ? '…' : prettyKey(slot.binding[side])
      btn.title = side === 'left' ? 'Sväng vänster — klicka för att byta' : 'Sväng höger — klicka för att byta'
      btn.addEventListener('click', () => this.beginRemap(slot, side))
      keys.append(btn)
      if (side === 'left') {
        const sep = document.createElement('span')
        sep.className = 'key-sep'
        sep.textContent = '↶ ↷'
        keys.append(sep)
      }
    }

    const leave = document.createElement('button')
    leave.className = 'leave'
    leave.textContent = 'Lämna'
    leave.addEventListener('click', () => {
      slot.joined = false
      slot.remapping = null
      this.keyboard.cancelCapture()
      this.render()
    })

    div.append(swatch, name, avatar, keys, leave)
    if (slot.error) {
      const err = document.createElement('p')
      err.className = 'slot-error'
      err.textContent = slot.error
      div.append(err)
    }
    return div
  }
}
