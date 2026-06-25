// Meddelandeprotokoll mellan LAN-servern och klienterna.
// Delas av server/ (Node) och src/ (webbläsare) — håll det fritt från DOM/Node-API:er.
import type { GameSettings, PowerUpType, ViewState } from '../game/state'

export const WS_PATH = '/ws'
export const DEFAULT_PORT = 3000

export interface LobbyPlayer {
  slot: number
  name: string
  ready: boolean
  /** Valfri emoji vid masken */
  avatar?: string
  /** Botspelare som kör på servern — alltid redo */
  bot?: boolean
}

export type ServerMsg =
  /** Skickas direkt vid anslutning */
  | { t: 'welcome'; slot: number; urls: string[] }
  /** Lobbyläget — skickas vid varje förändring */
  | {
      t: 'lobby'
      players: LobbyPlayer[]
      powerups: boolean
      /** Power-up-typer som är avstängda i lobbyn */
      disabledPowerups: PowerUpType[]
      target: GameSettings['targetScore']
      shrink: GameSettings['shrinkAfterSec']
      /** Bottarnas svårighetsgrad 1–5 */
      botLevel: number
      inGame: boolean
    }
  /** En simuleringstick. `clear` = töm spårlagret innan freshTrail ritas. */
  | { t: 'tick'; v: ViewState; clear: boolean }
  /** Servern är full (MAX_PLAYERS spelare) */
  | { t: 'full' }

export type ClientMsg =
  | { t: 'name'; name: string }
  | { t: 'avatar'; avatar: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; left: boolean; right: boolean }
  | { t: 'powerups'; enabled: boolean }
  | { t: 'powerupTypes'; disabled: PowerUpType[] }
  /** Lägg till en serverstyrd botspelare på en ledig plats */
  | { t: 'addBot' }
  /** Ta bort boten på angiven plats */
  | { t: 'removeBot'; slot: number }
  /** Sätt bottarnas svårighetsgrad (1–5) */
  | { t: 'botLevel'; level: number }
  | { t: 'target'; target: GameSettings['targetScore'] }
  | { t: 'shrink'; shrink: GameSettings['shrinkAfterSec'] }
