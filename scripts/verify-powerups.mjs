// Visuell verifiering av power-ups: radar upp alla ikoner på planen,
// avfyrar kanonen och aktiverar öl-gungningen. Kräver npm run dev (dev-hooken).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('http://localhost:5173/')
await page.waitForTimeout(600)
await page.keyboard.press('KeyA')
await page.keyboard.press('Space')
await page.waitForTimeout(3400) // nedräkningen klar → playing

// Rada upp samtliga power-ups i två rader för ikongranskning
await page.evaluate(() => {
  const { getGame } = window.__achtung
  const g = getGame()
  const types = [
    'selfFast', 'selfSlow', 'selfThin', 'selfGhost', 'cannon', 'othersFast',
    'othersReverse', 'othersFat', 'clearTrails', 'wrapWalls', 'beer', 'mindcamp',
  ]
  types.forEach((type, i) => {
    g.powerups.push({ id: 9000 + i, type, x: 180 + (i % 6) * 190, y: 120 + Math.floor(i / 6) * 110 })
  })
})
await page.waitForTimeout(150)
await page.screenshot({ path: OUT + 'pu-1-icons.png' })

// Ge spelare 1 kanonen och skjut (vänster+höger samtidigt)
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  const g = getGame()
  applyPowerUp(g, g.players[0], 'cannon')
})
await page.keyboard.down('ArrowLeft')
await page.keyboard.down('ArrowRight')
await page.waitForTimeout(120)
await page.keyboard.up('ArrowLeft')
await page.keyboard.up('ArrowRight')
const midFlight = await page.evaluate(() => window.__achtung.getGame().bullets.length)
await page.screenshot({ path: OUT + 'pu-2-shot.png' })

// Öl: skärmen ska gunga
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  const g = getGame()
  applyPowerUp(g, g.players[0], 'beer')
})
await page.waitForTimeout(700)
const wobble = await page.evaluate(() => window.__achtung.getGame().wobbleTicks)
await page.screenshot({ path: OUT + 'pu-3-beer.png' })

console.log(`kulor i luften efter skott: ${midFlight} · wobbleTicks: ${wobble}`)
if (midFlight < 1) {
  console.log('FEL: inget skott avfyrades')
  process.exitCode = 1
}
if (wobble <= 0) {
  console.log('FEL: ingen gungning')
  process.exitCode = 1
}
if (errors.length) {
  console.log('SIDFEL:\n' + errors.join('\n'))
  process.exitCode = 1
}
await browser.close()
