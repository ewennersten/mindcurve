// Verifierar de fem nya power-upsen visuellt och funktionellt i dev-läget:
// sköld (ring + räddning), mina (aptering + rendering), mörker (overlay),
// platsbyte (positioner) och fyrkantssvängar (90°). Kräver npm run dev.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const fails = []
page.on('pageerror', (e) => fails.push(String(e)))
await page.goto('http://localhost:5173/')
await page.waitForTimeout(600)
await page.keyboard.press('KeyA')
await page.keyboard.press('Space')
await page.waitForTimeout(3500) // playing

// Gör spelare 2 (Grön) odödlig för resten av skriptet: evigt spöke (ingen
// spår-/minkollision) + håll dess vänstertangent (A) nere så den cirklar på
// plats i stället för att köra in i väggen. Annars kan rundan ta slut mitt i.
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[1].x = 640
  g.players[1].y = 520
  g.players[1].effects.push({ type: 'ghost', ticksLeft: 1000000, ticksTotal: 1000000 })
})
await page.keyboard.down('KeyA')

// --- Sköld: ge spelare 1 sköld, kolla effekt + HUD-chip, skärmdump ---
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  applyPowerUp(getGame(), getGame().players[0], 'shield')
})
await page.waitForTimeout(300)
const shieldChip = await page.evaluate(() => {
  const icons = [...document.querySelectorAll('#sidebar .fx-icon')].map((el) => el.textContent)
  return icons.join(',')
})
console.log(`sköld-chip i HUD: ${shieldChip}`)
if (!shieldChip.includes('🛡')) fails.push('sköld-chip saknas i HUD')
await page.screenshot({ path: OUT + 'newpu-1-shield.png' })

// Sköldräddning: kör spelare 1 in i väggen — ska studsa, inte dö
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].x = 1270; g.players[0].y = 360; g.players[0].angle = 0
})
await page.waitForTimeout(500)
const afterWall = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  return { alive: g.players[0].alive, hasShield: g.players[0].effects.some((e) => e.type === 'shield') }
})
console.log(`efter väggstuds: lever=${afterWall.alive}, sköld kvar=${afterWall.hasShield}`)
if (!afterWall.alive) fails.push('spelaren dog mot väggen trots sköld')
if (afterWall.hasShield) fails.push('skölden konsumerades inte vid räddningen')

// --- Mina: aptera mitt på planen, vänta ut armeringen, skärmdump ---
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].x = 400; g.players[0].y = 300; g.players[0].angle = 0
  g.mines.push({ id: g.nextId++, playerId: 1, x: 640, y: 360, armIn: 30 })
})
// Polla tills minan armerats (30 ticks = 0,5 s) i stället för fast väntetid
let mineState = null
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(150)
  mineState = await page.evaluate(() => window.__achtung.getGame().mines.map((m) => ({ armIn: m.armIn })))
  if (mineState.length === 1 && mineState[0].armIn === 0) break
}
console.log(`minor: ${JSON.stringify(mineState)}`)
if (mineState?.length !== 1 || mineState[0].armIn !== 0) fails.push('minan armerades inte som väntat')
await page.screenshot({ path: OUT + 'newpu-2-mine.png' })

// --- Mörker: aktivera för spelare 1, kolla darkTicks + ägare + skärmdump ---
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  applyPowerUp(getGame(), getGame().players[0], 'darkness')
})
await page.waitForTimeout(400)
const dark = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  return { ticks: g.darkTicks, owner: g.darkOwner }
})
console.log(`darkTicks: ${dark.ticks}, darkOwner: ${dark.owner}`)
if (!(dark.ticks > 0)) fails.push('darkTicks sattes inte')
if (dark.owner !== 0) fails.push(`darkOwner blev ${dark.owner}, väntade 0 (plockaren)`)
await page.screenshot({ path: OUT + 'newpu-3-darkness.png' })

// --- Platsbyte: registrera positioner, byt, jämför ---
const swapped = await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  const g = getGame()
  const before = g.players.map((p) => ({ x: p.x, y: p.y }))
  applyPowerUp(g, g.players[0], 'swap')
  const after = g.players.map((p) => ({ x: p.x, y: p.y }))
  return { ok: after[0].x === before[1].x && after[1].x === before[0].x }
})
console.log(`platsbyte: ${swapped.ok ? 'positioner bytta' : 'FEL'}`)
if (!swapped.ok) fails.push('platsbyte bytte inte positioner')

// --- Fyrkantssvängar: ge effekt, tryck höger, kolla 90° ---
const square = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  // Flytta till säker yta först — efter platsbytet står spelaren i cirkelytan
  g.players[0].x = 300; g.players[0].y = 360; g.players[0].angle = 0
  g.players[0].effects.push({ type: 'square', ticksLeft: 300, ticksTotal: 300 })
  return g.players[0].angle
})
await page.keyboard.down('ArrowRight')
await page.waitForTimeout(250)
await page.keyboard.up('ArrowRight')
const squareTurn = await page.evaluate(() => window.__achtung.getGame().players[0].angle)
const delta = squareTurn - square
console.log(`fyrkantssväng: Δvinkel = ${delta.toFixed(4)} (väntat ${(Math.PI / 2).toFixed(4)})`)
if (Math.abs(delta - Math.PI / 2) > 0.0001) fails.push(`90°-svängen blev ${delta} rad`)

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nNya power-ups OK: sköld, mina, mörker, platsbyte, fyrkantssvängar')
await browser.close()
