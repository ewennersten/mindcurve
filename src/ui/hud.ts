import { type ViewPlayer, type ViewState, TPS } from '../game/state'
import { POWERUP_DEFS } from '../game/powerups'

const EFFECT_ICONS: Record<string, string> = {
  fast: POWERUP_DEFS.selfFast.icon,
  slow: POWERUP_DEFS.selfSlow.icon,
  thin: POWERUP_DEFS.selfThin.icon,
  ghost: POWERUP_DEFS.selfGhost.icon,
  reverse: POWERUP_DEFS.othersReverse.icon,
  fat: POWERUP_DEFS.othersFat.icon,
  star: POWERUP_DEFS.mindcamp.icon,
  shield: POWERUP_DEFS.shield.icon,
  square: POWERUP_DEFS.othersSquare.icon,
}

interface FeedEntry {
  html: string
  until: number
}

export class Hud {
  private game: HTMLElement
  private sidebar: HTMLElement
  private banner: HTMLElement
  private feedEl: HTMLElement
  private lastSignature = ''
  private lastBanner = ''
  private lastFeedHtml = ''
  private feed: FeedEntry[] = []
  private prevAlive: boolean[] | null = null
  /** Nedräkningsstaplar för aktiva effekter, uppdateras varje frame */
  private timerBars: { bar: HTMLElement; playerIndex: number; type: string }[] = []

  constructor() {
    this.game = document.getElementById('game')!
    this.sidebar = document.getElementById('sidebar')!
    this.banner = document.getElementById('banner')!
    this.feedEl = document.getElementById('feed')!
  }

  show(): void {
    this.game.hidden = false
    this.lastSignature = ''
    this.lastBanner = ''
    this.feed = []
    this.prevAlive = null
  }

  hide(): void {
    this.game.hidden = true
    this.banner.hidden = true
  }

  /** `auto` = nätverksläge: rundor går vidare av sig själva, utan SPACE. */
  update(state: ViewState, paused: boolean, auto = false): void {
    this.updateSidebar(state)
    this.updateEffectTimers(state)
    this.updateFeed(state)
    this.updateBanner(state, paused, auto)
  }

  /** Krymper varje aktiv effekts nedräkningsstapel. Körs varje frame; den
   *  signatur-gatade updateSidebar bygger om strukturen när effekter dyker
   *  upp/försvinner, så här uppdaterar vi bara bredderna. */
  private updateEffectTimers(state: ViewState): void {
    for (const t of this.timerBars) {
      const p = state.players[t.playerIndex]
      let frac = 0
      if (p) {
        for (const e of p.effects) {
          if (e.type === t.type && e.ticksTotal > 0) frac = Math.max(frac, e.ticksLeft / e.ticksTotal)
        }
      }
      t.bar.style.transform = `scaleX(${frac.toFixed(3)})`
    }
  }

  /** Kill feed: vem dog, och av vad. */
  private updateFeed(state: ViewState): void {
    if (this.prevAlive && this.prevAlive.length === state.players.length && state.phase !== 'countdown') {
      state.players.forEach((p, i) => {
        if (!this.prevAlive![i] || p.alive) return
        const name = `<b style="color:${p.color}">${escapeHtml(p.name)}</b>`
        let html: string
        if (p.killedBy === 'wall') html = `${name} körde in i väggen`
        else if (p.killedBy === 'self') html = `${name} snurrade in i sitt eget spår`
        else if (typeof p.killedBy === 'number' && state.players[p.killedBy]) {
          const killer = state.players[p.killedBy]
          html = `${name} kraschade i <b style="color:${killer.color}">${escapeHtml(killer.name)}</b>s spår`
        } else if (typeof p.killedBy === 'object' && p.killedBy !== null && state.players[p.killedBy.mine]) {
          const owner = state.players[p.killedBy.mine]
          html =
            p.killedBy.mine === i
              ? `${name} sprang på sin egen mina 💣`
              : `${name} sprängdes av <b style="color:${owner.color}">${escapeHtml(owner.name)}</b>s mina 💣`
        } else html = `${name} dog`
        this.feed.push({ html, until: Date.now() + 5000 })
      })
    }
    this.prevAlive = state.players.map((p) => p.alive)
    if (state.phase === 'countdown') this.feed = []

    this.feed = this.feed.filter((e) => e.until > Date.now())
    const feedHtml = this.feed.map((e) => `<p class="feed-entry">${e.html}</p>`).join('')
    if (feedHtml !== this.lastFeedHtml) {
      this.lastFeedHtml = feedHtml
      this.feedEl.innerHTML = feedHtml
    }
  }

  private updateSidebar(state: ViewState): void {
    // Strukturen byggs om när poäng, liv, ammo, matchboll eller UPPSÄTTNINGEN
    // av effekter ändras (inte när en effekt bara tickar ner — det sköter
    // updateEffectTimers per frame).
    const showMatchPoint = state.phase !== 'matchOver'
    const signature = state.players
      .map(
        (p) =>
          `${p.score}:${p.alive ? 1 : 0}:${p.ammo}:${p.effects.map((e) => e.type).sort().join(',')}:${showMatchPoint && p.matchPoint ? 'M' : ''}`,
      )
      .join('|')
    if (signature === this.lastSignature) return
    this.lastSignature = signature

    this.sidebar.replaceChildren()
    this.timerBars = []

    const title = document.createElement('h2')
    title.textContent = 'POÄNG'
    this.sidebar.append(title)

    state.players.forEach((p, i) => {
      const row = document.createElement('div')
      row.className = 'score-row' + (p.alive ? '' : ' dead') + (showMatchPoint && p.matchPoint ? ' match-point' : '')
      row.style.setProperty('--c', p.color)

      const dot = document.createElement('span')
      dot.className = 'dot'

      const name = document.createElement('span')
      name.className = 'p-name'
      name.textContent = p.name

      const fx = document.createElement('span')
      fx.className = 'fx'
      // En chip per unik effekttyp, med nedräkningsstapel
      for (const type of [...new Set(p.effects.map((e) => e.type))]) {
        const chip = document.createElement('span')
        chip.className = 'fx-chip'
        const icon = document.createElement('span')
        icon.className = 'fx-icon'
        icon.textContent = EFFECT_ICONS[type] ?? '?'
        const bar = document.createElement('span')
        bar.className = 'fx-bar'
        chip.append(icon, bar)
        fx.append(chip)
        this.timerBars.push({ bar, playerIndex: i, type })
      }
      if (p.ammo > 0) {
        const ammo = document.createElement('span')
        ammo.className = 'fx-chip ammo'
        ammo.textContent = `🔫×${p.ammo}`
        fx.append(ammo)
      }

      const score = document.createElement('span')
      score.className = 'p-score'
      score.textContent = String(p.score)

      row.append(dot, name, fx, score)
      if (showMatchPoint && p.matchPoint) {
        const badge = document.createElement('span')
        badge.className = 'mp-badge'
        badge.textContent = 'MATCHBOLL'
        row.append(badge)
      }
      this.sidebar.append(row)
    })

    if (state.players.length > 1) {
      const target = document.createElement('p')
      target.className = 'target'
      target.textContent = `Först till ${state.targetScore}`
      this.sidebar.append(target)
    }
  }

  private updateBanner(state: ViewState, paused: boolean, auto: boolean): void {
    let html = ''
    if (paused) {
      html = `<p class="big">PAUS</p><p class="sub"><kbd>ESC</kbd> fortsätt</p>`
    } else if (state.phase === 'roundOver') {
      const winner = state.roundWinner != null ? state.players[state.roundWinner] : null
      const headline = winner
        ? `<p class="big" style="--c:${winner.color}">Rundan till <strong>${escapeHtml(winner.name)}</strong></p>`
        : `<p class="big">Oavgjort!</p>`
      const sub = auto
        ? `<p class="sub">${state.matchWinner != null ? 'resultat' : 'nästa runda'} strax …</p>`
        : state.matchWinner != null
          ? `<p class="sub"><kbd>SPACE</kbd> visa resultat</p>`
          : `<p class="sub"><kbd>SPACE</kbd> nästa runda</p>`
      html = headline + sub
    } else if (state.phase === 'matchOver') {
      const sorted = [...state.players].sort((a, b) => b.score - a.score)
      const rows = sorted
        .map(
          (p, i) =>
            `<div class="standing" style="--c:${p.color}"><span class="place">${i + 1}.</span><span class="dot"></span> ${escapeHtml(p.name)} <span class="pts">${p.score}</span></div>`,
        )
        .join('')
      const back = auto ? 'tillbaka till lobbyn strax …' : '<kbd>SPACE</kbd> tillbaka till lobbyn'
      html = `<p class="big" style="--c:${sorted[0].color}"><strong>${escapeHtml(sorted[0].name)}</strong> vinner matchen!</p>
        <div class="standings">${rows}</div>
        ${buildAwards(state)}
        <p class="sub">${back}</p>`
    }

    if (html === this.lastBanner) return
    this.lastBanner = html
    this.banner.hidden = html === ''
    this.banner.innerHTML = html
  }
}

/** Utmärkelser för matchslutsskärmen: bästa spelare per statistikkategori.
 *  Vid delad förstaplats listas alla; kategorier där ingen har något hoppas över. */
function buildAwards(state: ViewState): string {
  const top = (get: (p: ViewPlayer) => number) => {
    const value = Math.max(...state.players.map(get))
    return { value, players: state.players.filter((p) => get(p) === value) }
  }
  const rows: string[] = []
  const kills = top((p) => p.matchStats.kills)
  if (kills.value > 0) rows.push(awardRow('⚔️', 'Bödeln', kills.players, plural(kills.value, 'kill', 'kills')))
  const survival = top((p) => p.matchStats.bestSurvivalTicks)
  if (survival.value > 0) {
    rows.push(awardRow('⏱️', 'Överlevaren', survival.players, `${(survival.value / TPS).toFixed(1).replace('.', ',')} s`))
  }
  const powerups = top((p) => p.matchStats.powerups)
  if (powerups.value > 0) {
    rows.push(awardRow('🎁', 'Plockaren', powerups.players, plural(powerups.value, 'power-up', 'power-ups')))
  }
  const suicides = top((p) => p.matchStats.suicides)
  if (suicides.value > 0) rows.push(awardRow('💀', 'Olycksfågeln', suicides.players, plural(suicides.value, 'självmord', 'självmord')))
  return rows.length > 0 ? `<div class="awards">${rows.join('')}</div>` : ''
}

function awardRow(icon: string, title: string, players: ViewPlayer[], value: string): string {
  const names = players.map((p) => `<b style="color:${p.color}">${escapeHtml(p.name)}</b>`).join(' & ')
  return `<div class="award"><span class="award-icon">${icon}</span><span class="award-title">${title}</span><span class="award-who">${names}</span><span class="award-val">${value}</span></div>`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
