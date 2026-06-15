// Verifierar Mindcurve-brandingen och Mindcamp-stjärnan i spel. Kräver npm run dev.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const errors = []
const fails = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('http://localhost:5173/')
await page.waitForTimeout(700)
const title = await page.title()
if (title !== 'Mindcurve') fails.push(`titel: "${title}"`)
const h1 = await page.textContent('#lobby h1')
if (!h1.includes('MINDCURVE')) fails.push(`h1: "${h1}"`)
await page.screenshot({ path: OUT + 'mc-1-lobby.png' })

// Starta, ge spelare 2 ett spår och spelare 1 stjärnan — kör tvärs igenom
await page.keyboard.press('KeyA')
await page.keyboard.press('Space')
await page.waitForTimeout(3500)
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[1].nextGapIn = 1e9
  g.players[1].x = 250
  g.players[1].y = 450
  g.players[1].angle = 0
})
await page.waitForTimeout(2000) // ~250 px spår
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  const g = getGame()
  applyPowerUp(g, g.players[0], 'mindcamp')
  g.players[0].x = 350
  g.players[0].y = 410
  g.players[0].angle = Math.PI / 2
})
await page.waitForTimeout(500) // mitt i genomfarten, auran aktiv
await page.screenshot({ path: OUT + 'mc-2-star.png' })
const after = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  return { alive: g.players[0].alive, y: g.players[0].y, star: g.players[0].effects.some((e) => e.type === 'star') }
})
if (!after.alive) fails.push('stjärnspelaren dog mot spåret')
if (after.y < 460) fails.push(`stjärnspelaren tog sig inte igenom (y=${after.y})`)

console.log(`titel: ${title} · stjärna aktiv: ${after.star} · genom spåret vid y=${after.y.toFixed(0)}: ${after.alive ? 'levande' : 'död'}`)
if (fails.length || errors.length) {
  console.log('FEL:\n' + [...fails, ...errors].join('\n'))
  process.exitCode = 1
}
await browser.close()
