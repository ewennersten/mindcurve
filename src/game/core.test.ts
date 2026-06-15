import { describe, expect, it } from 'vitest'
import { createGame, startRound, step } from './core'
import { ALL_POWERUP_TYPES, MINE_ARM_TICKS, applyPowerUp, spawnPowerUp } from './powerups'
import { type GameState, type PlayerInput, type PowerUpType, FIELD_H, FIELD_W, PLAYER_COLORS } from './state'

const TWO_PLAYERS = [
  { name: 'A', color: '#f00' },
  { name: 'B', color: '#0f0' },
]

function scriptedInputs(tick: number): PlayerInput[] {
  // Deterministiskt men varierat styrmönster
  return [
    { left: tick % 7 < 3, right: tick % 11 === 0 },
    { left: tick % 5 === 0, right: tick % 9 < 4 },
  ]
}

function snapshot(state: GameState): string {
  return JSON.stringify({
    tick: state.tick,
    phase: state.phase,
    rng: state.rng.getState(),
    players: state.players.map((p) => ({
      x: p.x,
      y: p.y,
      angle: p.angle,
      alive: p.alive,
      score: p.score,
      effects: p.effects,
    })),
    powerups: state.powerups,
  })
}

describe('determinism', () => {
  it('samma seed och inputs ger exakt samma förlopp', () => {
    const run = () => {
      const g = createGame(TWO_PLAYERS, 1234, { powerupsEnabled: true, targetScore: 'auto', shrinkAfterSec: 'off' })
      startRound(g)
      for (let t = 0; t < 1200 && g.phase !== 'roundOver'; t++) {
        step(g, scriptedInputs(t))
      }
      return snapshot(g)
    }
    expect(run()).toBe(run())
  })
})

describe('power-up-viktning och toggles', () => {
  function drawMany(g: GameState, n: number): Map<PowerUpType, number> {
    const counts = new Map<PowerUpType, number>()
    for (let i = 0; i < n; i++) {
      g.powerups = [] // kringgå MAX_POWERUPS-taket
      spawnPowerUp(g)
      for (const pu of g.powerups) counts.set(pu.type, (counts.get(pu.type) ?? 0) + 1)
    }
    return counts
  }

  it('avstängda typer spawnar aldrig', () => {
    const allButThin = ALL_POWERUP_TYPES.filter((t) => t !== 'selfThin')
    const g = createGame(TWO_PLAYERS, 5, {
      powerupsEnabled: true,
      disabledPowerups: allButThin,
      targetScore: 'auto',
      shrinkAfterSec: 'off',
    })
    const counts = drawMany(g, 100)
    expect(counts.get('selfThin')).toBeGreaterThan(0)
    expect([...counts.keys()]).toEqual(['selfThin'])
  })

  it('alla typer avstängda ger inga spawns', () => {
    const g = createGame(TWO_PLAYERS, 5, {
      powerupsEnabled: true,
      disabledPowerups: [...ALL_POWERUP_TYPES],
      targetScore: 'auto',
      shrinkAfterSec: 'off',
    })
    const counts = drawMany(g, 50)
    expect(counts.size).toBe(0)
  })

  it('vikterna styr fördelningen — stjärnan (vikt 4) är sällsyntare än normalviktade', () => {
    const g = createGame(TWO_PLAYERS, 42, {
      powerupsEnabled: true,
      targetScore: 'auto',
      shrinkAfterSec: 'off',
    })
    const counts = drawMany(g, 2000)
    expect(counts.get('mindcamp')).toBeGreaterThan(0) // finns men …
    expect(counts.get('mindcamp')!).toBeLessThan(counts.get('selfFast')!) // … är sällsyntare
    expect(counts.get('othersFast')!).toBeLessThan(counts.get('selfThin')!)
  })
})

describe('rundor och poäng', () => {
  function freshPlayingState(): GameState {
    const g = createGame(TWO_PLAYERS, 99, { powerupsEnabled: false, targetScore: 'auto', shrinkAfterSec: 'off' })
    startRound(g)
    g.phase = 'playing' // hoppa över nedräkningen i test
    // Kontrollerade positioner: båda mitt på planen, på väg åt höger
    g.players[0].x = 300
    g.players[0].y = 200
    g.players[0].angle = 0
    g.players[1].x = 300
    g.players[1].y = 500
    g.players[1].angle = 0
    return g
  }

  it('spelare dör mot väggen, överlevaren får poäng och rundan slutar', () => {
    const g = freshPlayingState()
    g.players[0].x = FIELD_W - 20 // alldeles vid högerväggen
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 60 && g.phase === 'playing'; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].killedBy).toBe('wall')
    expect(g.players[1].score).toBe(1)
    expect(g.phase).toBe('roundOver')
    expect(g.roundWinner).toBe(1)
  })

  it('wrap-around-väggar gör att man överlever väggen', () => {
    const g = freshPlayingState()
    g.players[0].x = FIELD_W - 20
    applyPowerUp(g, g.players[0], 'wrapWalls')
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 30; t++) step(g, none)
    expect(g.players[0].alive).toBe(true)
    expect(g.players[0].x).toBeLessThan(200) // har wrappat till vänstra sidan
  })

  it('luckor i spåret går att passera men spåret är dödligt', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Låt spelare 1 rita ett spår rakt fram en bra bit, utan luckor
    g.players[1].nextGapIn = 100000
    g.players[0].nextGapIn = 100000
    for (let t = 0; t < 100; t++) step(g, none)
    expect(g.players[1].alive).toBe(true)
    // Styr nu spelare 0 rakt in i spelare 1:s spår (rakt nedåt mot y=500)
    g.players[0].x = 400
    g.players[0].y = 450
    g.players[0].angle = Math.PI / 2
    for (let t = 0; t < 60 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].killedBy).toBe(1) // dog mot spelare 1:s spår
  })

  it('arenan krymper efter inställd tid och dödar vid de nya väggarna', () => {
    const g = createGame(TWO_PLAYERS, 99, { powerupsEnabled: false, targetScore: 'auto', shrinkAfterSec: 1 })
    startRound(g)
    g.phase = 'playing'
    // Håll båda mitt på planen, snurrandes — spelare 1 får ghost-liknande setup:
    // placera dem så de inte krockar med något på länge
    g.players[0].x = 400
    g.players[0].y = 360
    g.players[0].angle = 0
    g.players[1].x = 880
    g.players[1].y = 360
    g.players[1].angle = Math.PI
    g.players[0].nextGapIn = 1 // i princip alltid lucka → inga spår att krocka med
    g.players[0].gapLeft = 100000
    g.players[1].gapLeft = 100000
    const turn: PlayerInput[] = [
      { left: true, right: false },
      { left: true, right: false },
    ]
    // Före 1 s: ingen krympning
    for (let t = 0; t < 55; t++) step(g, turn)
    expect(g.wallInset).toBe(0)
    // Efter 1 s börjar väggarna krypa
    for (let t = 0; t < 120; t++) step(g, turn)
    expect(g.wallInset).toBeGreaterThan(5)

    // En spelare vid gamla väggkanten dör mot den nya, inflyttade väggen
    g.players[0].x = 30
    g.players[0].y = 360
    g.players[0].angle = Math.PI // västerut, mot väggen
    step(g, turn)
    // wallInset ~7px: spelaren på x=30 lever ännu; kör tills väggen nås
    for (let t = 0; t < 30 && g.players[0].alive; t++) step(g, turn)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].killedBy).toBe('wall')
  })

  it('krympning avstängd ger aldrig wallInset', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 200 && g.phase === 'playing'; t++) step(g, none)
    expect(g.wallInset).toBe(0)
  })

  it('kanonen ger ammunition och skott spränger passerbara hål i spår', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Spelare 1 ritar ett heldraget spår längs y=500
    g.players[0].nextGapIn = 100000
    g.players[1].nextGapIn = 100000
    for (let t = 0; t < 100; t++) step(g, none)
    expect(g.players[1].alive).toBe(true)

    // Spelare 0 får kanonen, siktar rakt nedåt mot spåret och skjuter
    applyPowerUp(g, g.players[0], 'cannon')
    expect(g.players[0].ammo).toBe(3)
    g.players[0].x = 400
    g.players[0].y = 430
    g.players[0].angle = Math.PI / 2
    step(g, [{ left: true, right: true }, none[1]])
    expect(g.players[0].ammo).toBe(2)
    expect(g.bullets.length).toBe(1)

    // Att hålla kvar båda tangenterna får inte autoavfyra
    step(g, [{ left: true, right: true }, none[1]])
    expect(g.players[0].ammo).toBe(2)

    // Kulan når spåret (~70 px bort) och spränger hål
    let holeAt: { x: number; y: number } | null = null
    for (let t = 0; t < 30 && !holeAt; t++) {
      step(g, none)
      if (g.freshHoles.length > 0) holeAt = g.freshHoles[0]
    }
    expect(holeAt).not.toBeNull()
    expect(Math.abs(holeAt!.y - 500)).toBeLessThan(12)
    expect(g.bullets.length).toBe(0)

    // Spelare 0 kör därefter rakt genom hålet utan att dö
    for (let t = 0; t < 60; t++) step(g, none)
    expect(g.players[0].alive).toBe(true)
    expect(g.players[0].y).toBeGreaterThan(520)
  })

  it('Mindcamp-stjärnan gör spelaren odödlig och spränger spår den kör igenom', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Spelare 1 ritar ett heldraget spår längs y=500
    g.players[0].nextGapIn = 100000
    g.players[1].nextGapIn = 100000
    for (let t = 0; t < 100; t++) step(g, none)

    // Spelare 0 får stjärnan och dyker rakt ned i spåret
    applyPowerUp(g, g.players[0], 'mindcamp')
    g.players[0].x = 400
    g.players[0].y = 460
    g.players[0].angle = Math.PI / 2
    let sawHole = false
    for (let t = 0; t < 40; t++) {
      step(g, none)
      if (g.freshHoles.length > 0) sawHole = true
    }
    expect(g.players[0].alive).toBe(true) // odödlig genom spåret
    expect(sawHole).toBe(true) // spåret sprängdes
    expect(g.players[0].y).toBeGreaterThan(520) // passerade igenom

    // Hålet är passerbart även utan stjärna: kör upp genom hålet, lite i
    // sidled så att spelarens eget nedåtgående spår från stjärnfärden undviks
    g.players[0].effects = []
    g.players[0].x = 412
    g.players[0].y = 540
    g.players[0].angle = -Math.PI / 2
    for (let t = 0; t < 30 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(true)
    expect(g.players[0].y).toBeLessThan(490) // passerade genom hålet i spåret
  })

  it('Mindcamp-stjärnan trumfar väggen — spelaren wrappar till andra sidan', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[0], 'mindcamp')
    g.players[0].x = FIELD_W - 20
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 30; t++) step(g, none)
    expect(g.players[0].alive).toBe(true)
    expect(g.players[0].x).toBeLessThan(200) // wrappade till vänstra sidan

    // När stjärnan tagit slut är väggen dödlig igen (ny y så att spelarens
    // eget spår från wrap-färden längs y=200 inte ligger i vägen)
    g.players[0].effects = []
    g.players[0].x = 30
    g.players[0].y = 320
    g.players[0].angle = Math.PI
    for (let t = 0; t < 30 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].killedBy).toBe('wall')
  })

  it('ölen får skärmen att gunga och klingar av', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[0], 'beer')
    expect(g.wobbleTicks).toBeGreaterThan(0)
    const before = g.wobbleTicks
    step(g, [
      { left: false, right: false },
      { left: false, right: false },
    ])
    expect(g.wobbleTicks).toBe(before - 1)
  })

  it('skölden räddar mot annans spår (konsumeras + kort spöke)', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Spelare 1 ritar ett heldraget spår längs y=500
    g.players[0].nextGapIn = 100000
    g.players[1].nextGapIn = 100000
    for (let t = 0; t < 100; t++) step(g, none)

    applyPowerUp(g, g.players[0], 'shield')
    g.players[0].x = 400
    g.players[0].y = 450
    g.players[0].angle = Math.PI / 2
    for (let t = 0; t < 60; t++) step(g, none)
    expect(g.players[0].alive).toBe(true) // räddad
    expect(g.players[0].effects.some((e) => e.type === 'shield')).toBe(false) // förbrukad
    expect(g.players[0].y).toBeGreaterThan(520) // spöket tog hen igenom spåret

    // Utan sköld dör man i nästa spår (samma manöver mot spåret igen)
    g.players[0].x = 380
    g.players[0].y = 450
    g.players[0].angle = Math.PI / 2
    g.players[0].effects = []
    for (let t = 0; t < 60 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
  })

  it('skölden studsar spelaren mot väggen', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[0], 'shield')
    g.players[0].x = FIELD_W - 20
    g.players[0].angle = 0 // rakt mot högerväggen
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 30; t++) step(g, none)
    expect(g.players[0].alive).toBe(true)
    expect(g.players[0].x).toBeLessThan(FIELD_W - 25) // på väg bort från väggen
    expect(Math.cos(g.players[0].angle)).toBeLessThan(0) // riktningen speglad
    expect(g.players[0].effects.some((e) => e.type === 'shield')).toBe(false)
  })

  it('fyrkantssvängar ger exakta 90°-knyckar på kanttryck', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[1], 'othersSquare') // others → spelare 0 får effekten
    expect(g.players[0].effects.some((e) => e.type === 'square')).toBe(true)
    const a0 = g.players[0].angle
    const none = { left: false, right: false }
    // Håll höger i tre ticks: bara kanten (första ticken) ska svänga
    step(g, [{ left: false, right: true }, none])
    step(g, [{ left: false, right: true }, none])
    step(g, [{ left: false, right: true }, none])
    expect(g.players[0].angle).toBeCloseTo(a0 + Math.PI / 2, 10)
    // Släpp och tryck igen → en sväng till
    step(g, [none, none])
    step(g, [{ left: false, right: true }, none])
    expect(g.players[0].angle).toBeCloseTo(a0 + Math.PI, 10)
  })

  it('platsbyte byter position och riktning mellan två spelare', () => {
    const g = freshPlayingState()
    const before = g.players.map((p) => ({ x: p.x, y: p.y, angle: p.angle }))
    applyPowerUp(g, g.players[0], 'swap')
    expect(g.players[0].x).toBe(before[1].x)
    expect(g.players[0].y).toBe(before[1].y)
    expect(g.players[1].x).toBe(before[0].x)
    expect(g.players[1].angle).toBe(before[0].angle)
    // Båda fick flykt-spöke
    expect(g.players[0].effects.some((e) => e.type === 'ghost')).toBe(true)
    expect(g.players[1].effects.some((e) => e.type === 'ghost')).toBe(true)
  })

  it('minan armeras efter fördröjningen och dödar — killen går till ägaren', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Spelare 1 apterar en mina på sin position
    g.players[1].x = 800
    g.players[1].y = 500
    applyPowerUp(g, g.players[1], 'mine')
    expect(g.mines.length).toBe(1)
    expect(g.mines[0].armIn).toBe(MINE_ARM_TICKS)

    // Armeringen räknar ner per tick
    step(g, none)
    expect(g.mines[0].armIn).toBe(MINE_ARM_TICKS - 1)

    // Flytta undan spelare 1 (annars sprängs hen av sin egen mina), armera,
    // och kör spelare 0 rakt in i minan (minradien 11 nås före spelare 1:s
    // spår som börjar vid x=800)
    g.players[1].x = 1000
    g.players[1].y = 200
    g.mines[0].armIn = 0
    g.players[0].x = 700
    g.players[0].y = 500
    g.players[0].angle = 0
    for (let t = 0; t < 60 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].killedBy).toEqual({ mine: 1 })
    expect(g.players[1].matchStats.kills).toBe(1)
    expect(g.mines.length).toBe(0) // detonerad
  })

  it('egen mina räknas som självmord i statistiken', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    applyPowerUp(g, g.players[0], 'mine')
    g.mines[0].armIn = 0 // armera direkt
    g.players[0].x = g.mines[0].x - 40
    g.players[0].y = g.mines[0].y
    g.players[0].angle = 0
    for (let t = 0; t < 40 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].alive).toBe(false)
    expect(g.players[0].matchStats.suicides).toBe(1)
    expect(g.players[0].matchStats.kills).toBe(0)
  })

  it('mörkret sätter darkTicks + ägare och klingar av', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[1], 'darkness')
    expect(g.darkTicks).toBeGreaterThan(0)
    expect(g.darkOwner).toBe(1) // plockaren slipper mörkret
    const before = g.darkTicks
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    step(g, none)
    expect(g.darkTicks).toBe(before - 1)
    // När effekten klingat av släpps ägaren
    g.darkTicks = 1
    step(g, none)
    expect(g.darkTicks).toBe(0)
    expect(g.darkOwner).toBe(null)
  })

  it('matchboll markeras för ledaren inom en rundas maxpoäng från målet', () => {
    const g = createGame(TWO_PLAYERS, 1, { powerupsEnabled: false, targetScore: 10, shrinkAfterSec: 'off' })
    g.players[0].score = 9
    g.players[1].score = 5
    startRound(g)
    expect(g.players[0].matchPoint).toBe(true)
    expect(g.players[1].matchPoint).toBe(false)
  })

  it('ingen matchboll när ledaren är för långt från målet', () => {
    const g = createGame(TWO_PLAYERS, 1, { powerupsEnabled: false, targetScore: 10, shrinkAfterSec: 'off' })
    g.players[0].score = 8
    startRound(g)
    expect(g.players[0].matchPoint).toBe(false)
  })

  it('matchboll uppdateras mitt i rundan när poäng delas ut', () => {
    const g = freshPlayingState()
    g.players[0].score = 8 // targetScore auto = 10, tröskel = 9
    g.players[0].x = 300
    g.players[0].y = 300
    g.players[1].x = FIELD_W - 20 // spelare 1 dör → spelare 0 får poäng (9) → matchboll
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 60 && g.players[1].alive; t++) step(g, none)
    expect(g.players[0].score).toBe(9)
    expect(g.players[0].matchPoint).toBe(true)
  })

  it('aktiva effekter har ticksTotal lika med starttiden', () => {
    const g = freshPlayingState()
    applyPowerUp(g, g.players[0], 'selfFast')
    const e = g.players[0].effects[0]
    expect(e.ticksTotal).toBeGreaterThan(0)
    expect(e.ticksLeft).toBe(e.ticksTotal)
  })

  it('inställt poängmål används i stället för auto', () => {
    const g = createGame(TWO_PLAYERS, 7, { powerupsEnabled: false, targetScore: 25, shrinkAfterSec: 'off' })
    expect(g.targetScore).toBe(25)
  })

  it('matchstatistik: väggdöd bokförs som självmord och överlevnadstid registreras', () => {
    const g = freshPlayingState()
    g.players[0].x = FIELD_W - 20
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 60 && g.phase === 'playing'; t++) step(g, none)
    expect(g.players[0].matchStats.suicides).toBe(1)
    expect(g.players[0].matchStats.kills).toBe(0)
    expect(g.players[0].matchStats.bestSurvivalTicks).toBeGreaterThan(0)
    // Överlevaren får minst lika lång överlevnadstid som den döda
    expect(g.players[1].matchStats.bestSurvivalTicks).toBeGreaterThanOrEqual(
      g.players[0].matchStats.bestSurvivalTicks,
    )
  })

  it('matchstatistik: död i annans spår ger killen till spårägaren', () => {
    const g = freshPlayingState()
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Spelare 1 ritar ett heldraget spår, spelare 0 styrs rakt in i det
    g.players[0].nextGapIn = 100000
    g.players[1].nextGapIn = 100000
    for (let t = 0; t < 100; t++) step(g, none)
    g.players[0].x = 400
    g.players[0].y = 450
    g.players[0].angle = Math.PI / 2
    for (let t = 0; t < 60 && g.players[0].alive; t++) step(g, none)
    expect(g.players[0].killedBy).toBe(1)
    expect(g.players[1].matchStats.kills).toBe(1)
    expect(g.players[0].matchStats.suicides).toBe(0)
  })

  it('matchstatistik: upplockade power-ups räknas', () => {
    const g = freshPlayingState()
    g.settings.powerupsEnabled = true
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    // Lägg en power-up rakt framför spelare 0
    g.powerups.push({ id: g.nextId++, type: 'selfThin', x: g.players[0].x + 30, y: g.players[0].y })
    for (let t = 0; t < 30 && g.powerups.length > 0; t++) step(g, none)
    expect(g.players[0].matchStats.powerups).toBe(1)
    expect(g.players[1].matchStats.powerups).toBe(0)
  })

  it('matchstatistik nollställs inte mellan rundor', () => {
    const g = freshPlayingState()
    g.players[0].matchStats.kills = 3
    g.players[0].matchStats.suicides = 2
    startRound(g)
    expect(g.players[0].matchStats.kills).toBe(3)
    expect(g.players[0].matchStats.suicides).toBe(2)
  })

  it('åtta spelare: alla placeras inom planen och rundan avgörs', () => {
    const setups = PLAYER_COLORS.map((c, i) => ({ name: `P${i + 1}`, color: c }))
    const g = createGame(setups, 7, { powerupsEnabled: false, targetScore: 'auto', shrinkAfterSec: 'off' })
    startRound(g)
    expect(g.players.length).toBe(8)
    expect(g.targetScore).toBe(70) // auto: 10 × (8 − 1)
    for (const p of g.players) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(FIELD_W)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(FIELD_H)
    }
    // Alla kör rakt fram → så småningom dör alla mot väggar/spår och rundan avgörs
    g.phase = 'playing'
    const none: PlayerInput[] = setups.map(() => ({ left: false, right: false }))
    for (let t = 0; t < 3000 && g.phase === 'playing'; t++) step(g, none)
    expect(g.phase).toBe('roundOver')
    expect(Math.max(...g.players.map((p) => p.score))).toBeGreaterThan(0)
  })

  it('match avgörs när målpoängen nås av en ensam ledare', () => {
    const g = freshPlayingState()
    expect(g.targetScore).toBe(10)
    g.players[1].score = 9
    g.players[0].x = FIELD_W - 20 // spelare 0 dör strax → spelare 1 når 10
    const none: PlayerInput[] = [
      { left: false, right: false },
      { left: false, right: false },
    ]
    for (let t = 0; t < 60 && g.phase === 'playing'; t++) step(g, none)
    expect(g.players[1].score).toBe(10)
    expect(g.matchWinner).toBe(1)
  })
})
