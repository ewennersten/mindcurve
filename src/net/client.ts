import type { AudioDirector } from '../audio/director'
import type { GameSettings, PowerUpType, ViewState } from '../game/state'
import type { Keyboard } from '../input/keyboard'
import { isTouchDevice, TouchControls } from '../input/touch'
import type { Renderer } from '../render/canvas'
import type { Hud } from '../ui/hud'
import { createBotLevelSlider, createPowerUpToggles, createShrinkSelect, createTargetSelect } from '../ui/lobby'
import { type ClientMsg, type LobbyPlayer, type ServerMsg, WS_PATH } from './protocol'
import { PLAYER_COLORS } from '../game/state'
import logoUrl from '../../logo/mindcamp_logo.png'

type NetPhase = 'connecting' | 'lobby' | 'game' | 'error'

/**
 * En LAN-session: äger WebSocket-anslutningen, nätverkslobbyns UI och
 * vidarebefordran av serverns ticks till renderaren. Klienten simulerar
 * ingenting själv — servern är auktoritativ.
 */
export class NetSession {
  active = false

  private ws: WebSocket | null = null
  private el: HTMLElement
  private phase: NetPhase = 'connecting'
  private mySlot = -1
  private urls: string[] = []
  private lobbyPlayers: LobbyPlayer[] = []
  private powerups = true
  private disabledPowerups: PowerUpType[] = []
  private botLevel = 3
  private target: GameSettings['targetScore'] = 'auto'
  private shrink: GameSettings['shrinkAfterSec'] = 30
  private inGame = false
  private view: ViewState | null = null
  private lastSent = { left: false, right: false }
  private errorText = ''
  /** Touch-knappar för telefon — finns bara på touch-enheter (aldrig lokalt). */
  private touch: TouchControls | null = null

  constructor(
    private keyboard: Keyboard,
    private renderer: Renderer,
    private hud: Hud,
    private audio: AudioDirector,
    private onExit: () => void,
  ) {
    this.el = document.getElementById('netlobby')!
  }

  start(): void {
    // Skapa touch-knapparna först när en LAN-session faktiskt startar, så att en
    // telefon i lokalt läge aldrig ens får touch-DOM i sidan.
    if (!this.touch && isTouchDevice()) this.touch = new TouchControls()
    this.active = true
    this.phase = 'connecting'
    this.view = null
    this.inGame = false
    this.errorText = ''
    this.el.hidden = false
    this.renderLobby()

    const ws = new WebSocket(`ws://${location.host}${WS_PATH}`)
    this.ws = ws
    ws.onopen = () => {
      this.send({ t: 'name', name: this.myName() })
      this.send({ t: 'avatar', avatar: this.myAvatar() })
    }
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data as string) as ServerMsg)
    ws.onerror = () => this.fail('Ingen LAN-server hittades. Starta värden med  npm run lan  och öppna adressen den skriver ut.')
    ws.onclose = () => {
      if (this.active && this.phase !== 'error') this.fail('Tappade anslutningen till servern.')
    }
  }

  stop(): void {
    this.active = false
    this.el.hidden = true
    this.touch?.disable()
    this.hud.hide()
    this.audio.reset()
    this.ws?.close()
    this.ws = null
    this.onExit()
  }

  private fail(text: string): void {
    this.phase = 'error'
    this.errorText = text
    this.touch?.disable()
    this.hud.hide()
    this.el.hidden = false
    this.renderLobby()
  }

  private myName(): string {
    return localStorage.getItem('achtung-name') || 'Spelare'
  }

  private myAvatar(): string {
    return localStorage.getItem('achtung-avatar') || ''
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.mySlot = msg.slot
        this.urls = msg.urls
        break
      case 'full':
        this.fail(`Servern är full — alla ${PLAYER_COLORS.length} platser är upptagna.`)
        break
      case 'lobby':
        this.lobbyPlayers = msg.players
        this.powerups = msg.powerups
        this.disabledPowerups = msg.disabledPowerups
        this.botLevel = msg.botLevel
        this.target = msg.target
        this.shrink = msg.shrink
        this.inGame = msg.inGame
        if (this.phase !== 'error') {
          if (this.phase === 'game') this.audio.reset()
          this.phase = 'lobby'
          this.view = null
          this.touch?.disable()
          this.hud.hide()
          this.el.hidden = false
          this.renderLobby()
        }
        break
      case 'tick':
        if (this.phase === 'lobby' || this.phase === 'connecting') {
          this.phase = 'game'
          this.el.hidden = true
          this.touch?.enable()
          this.hud.show()
          this.renderer.clearTrails()
        }
        if (msg.clear) this.renderer.clearTrails()
        this.view = msg.v
        this.renderer.applyFresh(msg.v)
        this.renderer.observe(msg.v)
        this.audio.observe(msg.v)
        break
    }
  }

  /** Anropas varje frame från huvudloopen medan sessionen är aktiv. */
  update(): void {
    if (this.phase === 'game' && this.view) {
      // Styrning: piltangenter eller A/S — skicka bara vid förändring
      const input = {
        left: this.keyboard.isDown('ArrowLeft') || this.keyboard.isDown('KeyA') || !!this.touch?.left,
        right: this.keyboard.isDown('ArrowRight') || this.keyboard.isDown('KeyS') || !!this.touch?.right,
      }
      if (input.left !== this.lastSent.left || input.right !== this.lastSent.right) {
        this.lastSent = input
        this.send({ t: 'input', ...input })
      }
      this.renderer.draw(this.view)
      this.hud.update(this.view, false, true)
    } else if (this.phase === 'lobby') {
      if (this.keyboard.consumePress('Space')) this.toggleReady()
    }
    if (this.keyboard.consumePress('Escape') && this.phase !== 'game') this.stop()
  }

  private toggleReady(): void {
    const me = this.lobbyPlayers.find((p) => p.slot === this.mySlot)
    if (!me || this.inGame) return
    this.send({ t: 'ready', ready: !me.ready })
  }

  // ── Nätverkslobbyns DOM ──────────────────────────────────────

  private renderLobby(): void {
    this.el.replaceChildren()

    const head = document.createElement('header')
    head.className = 'lobby-head'
    head.innerHTML = `
      <div class="title-row">
        <img class="logo" src="${logoUrl}" alt="Mindcamp" />
        <h1>MIND<span class="bang">CURVE</span> LAN</h1>
      </div>
      <p class="tagline">samma kurva — flera datorer</p>`
    this.el.append(head)

    if (this.phase === 'connecting') {
      this.el.append(this.note('Ansluter …'))
      this.el.append(this.backLink())
      return
    }
    if (this.phase === 'error') {
      const err = this.note(this.errorText)
      err.classList.add('net-error')
      this.el.append(err, this.backLink())
      return
    }

    if (this.urls.length > 0) {
      const share = document.createElement('p')
      share.className = 'share-url'
      share.innerHTML = `Bjud in: ${this.urls.map((u) => `<code>${u}</code>`).join(' · ')}`
      this.el.append(share)
    }
    if (this.inGame) this.el.append(this.note('Match pågår — du är med i nästa.'))

    const list = document.createElement('div')
    list.className = 'net-list'
    for (const p of this.lobbyPlayers) {
      const row = document.createElement('div')
      row.className = 'score-row' + (p.ready ? ' ready' : '')
      row.style.setProperty('--c', PLAYER_COLORS[p.slot])
      const dot = document.createElement('span')
      dot.className = 'dot'
      const nameEl = document.createElement('span')
      nameEl.className = 'p-name'
      const face = p.avatar ? `${p.avatar} ` : ''
      nameEl.textContent = face + p.name + (p.slot === this.mySlot ? ' (du)' : '')
      const status = document.createElement('span')
      status.className = 'p-score net-ready'
      status.textContent = p.bot ? '🤖' : p.ready ? 'REDO' : '…'
      row.append(dot, nameEl, status)
      if (p.bot && !this.inGame) {
        const remove = document.createElement('button')
        remove.className = 'leave'
        remove.textContent = '✕'
        remove.title = 'Ta bort boten'
        remove.addEventListener('click', () => this.send({ t: 'removeBot', slot: p.slot }))
        row.append(remove)
      }
      list.append(row)
    }
    this.el.append(list)

    const botRow = document.createElement('div')
    botRow.className = 'net-bot-row'
    if (!this.inGame && this.lobbyPlayers.length < PLAYER_COLORS.length) {
      const addBot = document.createElement('button')
      addBot.className = 'leave bot-add'
      addBot.textContent = '🤖 Lägg till bot'
      addBot.addEventListener('click', () => this.send({ t: 'addBot' }))
      botRow.append(addBot)
    }
    if (this.lobbyPlayers.some((p) => p.bot)) {
      botRow.append(
        createBotLevelSlider(this.botLevel, (v) => this.send({ t: 'botLevel', level: v }), this.inGame),
      )
    }
    if (botRow.childElementCount > 0) this.el.append(botRow)

    const foot = document.createElement('footer')
    foot.className = 'lobby-foot'

    const nameInput = document.createElement('input')
    nameInput.className = 'name net-name'
    nameInput.maxLength = 12
    nameInput.value = this.myName()
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim() || 'Spelare'
      localStorage.setItem('achtung-name', name)
      this.send({ t: 'name', name })
    })

    const avatarInput = document.createElement('input')
    avatarInput.className = 'avatar-input'
    avatarInput.maxLength = 8
    avatarInput.placeholder = '🙂'
    avatarInput.value = this.myAvatar()
    avatarInput.title = 'Valfri emoji vid din mask'
    avatarInput.addEventListener('input', () => {
      const avatar = avatarInput.value.trim()
      localStorage.setItem('achtung-avatar', avatar)
      this.send({ t: 'avatar', avatar })
    })

    const setting = document.createElement('label')
    setting.className = 'setting'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.powerups
    cb.disabled = this.inGame
    cb.addEventListener('change', () => this.send({ t: 'powerups', enabled: cb.checked }))
    setting.append(cb, document.createTextNode(' Power-ups'))

    const targetSetting = createTargetSelect(this.target, (v) => this.send({ t: 'target', target: v }))
    if (this.inGame) targetSetting.querySelector('select')!.disabled = true

    const shrinkSetting = createShrinkSelect(this.shrink, (v) => this.send({ t: 'shrink', shrink: v }))
    if (this.inGame) shrinkSetting.querySelector('select')!.disabled = true

    const me = this.lobbyPlayers.find((p) => p.slot === this.mySlot)
    const readyBtn = document.createElement('button')
    readyBtn.className = 'start-btn'
    readyBtn.disabled = this.inGame
    readyBtn.innerHTML = `${me?.ready ? 'INTE REDO' : 'REDO'} <kbd>SPACE</kbd>`
    readyBtn.addEventListener('click', () => this.toggleReady())

    const info = document.createElement('p')
    info.className = 'target-info'
    info.textContent = 'Matchen startar när alla är redo. Styr med ← → eller A/S — skjut 🔫 med båda samtidigt.'

    foot.append(nameInput, avatarInput, setting, targetSetting, shrinkSetting, info, readyBtn)
    this.el.append(foot)

    if (this.powerups) {
      this.el.append(
        createPowerUpToggles(
          this.disabledPowerups,
          (next) => this.send({ t: 'powerupTypes', disabled: next }),
          this.inGame,
        ),
      )
    }
    this.el.append(this.backLink())
  }

  private note(text: string): HTMLElement {
    const p = document.createElement('p')
    p.className = 'net-note'
    p.textContent = text
    return p
  }

  private backLink(): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'leave'
    btn.textContent = '← Tillbaka till lokalt spel'
    btn.addEventListener('click', () => this.stop())
    return btn
  }
}
