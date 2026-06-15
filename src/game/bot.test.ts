import { describe, expect, it } from 'vitest'
import { botInput } from './bot'
import { createGame, startRound, step } from './core'
import { type GameState, type PlayerInput, FIELD_W } from './state'

const SETUPS = [
  { name: 'Bot', color: '#f00' },
  { name: 'Motståndare', color: '#0f0' },
]

const NONE: PlayerInput = { left: false, right: false }

function freshGame(): GameState {
  const g = createGame(SETUPS, 99, { powerupsEnabled: false, targetScore: 'auto', shrinkAfterSec: 'off' })
  startRound(g)
  g.phase = 'playing'
  return g
}

describe('botspelare', () => {
  it('ger ingen input under nedräkning eller som död', () => {
    const g = createGame(SETUPS, 1, { powerupsEnabled: false, targetScore: 'auto', shrinkAfterSec: 'off' })
    startRound(g) // countdown
    expect(botInput(g, 0)).toEqual(NONE)
    g.phase = 'playing'
    g.players[0].alive = false
    expect(botInput(g, 0)).toEqual(NONE)
  })

  it('svänger undan från väggen och överlever', () => {
    const g = freshGame()
    g.players[0].x = FIELD_W - 60
    g.players[0].y = 360
    g.players[0].angle = 0 // rakt mot högerväggen
    // Motståndaren cirklar ofarligt utan spår så att rundan inte tar slut
    g.players[1].x = 250
    g.players[1].y = 550
    g.players[1].gapLeft = 1e9
    for (let t = 0; t < 400; t++) {
      step(g, [botInput(g, 0), { left: true, right: false }])
    }
    expect(g.players[0].alive).toBe(true)
  })

  it('lägre nivå ser kortare fram — nivå 1 väjer senare än nivå 5', () => {
    // Bot 100 px från väggen: nivå 5 (lookahead 55 tick ≈ 115 px) ser den
    // och väjer direkt; nivå 1 (12 tick ≈ 25 px) kör vidare rakt ett tag till
    const setup = () => {
      const g = freshGame()
      g.players[0].x = FIELD_W - 100
      g.players[0].y = 360
      g.players[0].angle = 0
      return g
    }
    const g1 = setup()
    const g5 = setup()
    const turns1 = botInput(g1, 0, 1)
    const turns5 = botInput(g5, 0, 5)
    expect(turns5.left || turns5.right).toBe(true) // nivå 5 väjer redan
    expect(turns1.left || turns1.right).toBe(false) // nivå 1 ser inget problem än
  })

  it('överlever en rak motståndare och vinner rundan', () => {
    const g = freshGame()
    for (let t = 0; t < 5000 && g.phase === 'playing'; t++) {
      step(g, [botInput(g, 0), NONE])
    }
    expect(g.phase).toBe('roundOver')
    expect(g.roundWinner).toBe(0) // botten lever när den rake åkt in i väggen
  })
})
