// Visuell verifiering av: krympande arena, dödsexplosion + skärmskak, kill feed.
// Kräver npm run dev (använder dev-hooken window.__achtung).
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
await page.waitForTimeout(600)
await page.keyboard.press('KeyA')
await page.keyboard.press('Space')
await page.waitForTimeout(300) // fortfarande i nedräkningen

// Snabb krympning (1 s) och odödliga cirklande spelare (evig lucka = inga spår).
// Sätts under nedräkningen så att inga spår alls hinner ritas.
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.settings.shrinkAfterSec = 1
  for (const p of g.players) p.gapLeft = 1e9
})
await page.waitForTimeout(3100) // nedräkning klar
await page.keyboard.down('ArrowLeft')
await page.keyboard.down('KeyA')
await page.waitForTimeout(8000)
const inset = await page.evaluate(() => window.__achtung.getGame().wallInset)
await page.screenshot({ path: OUT + 'top3-1-shrink.png' })
if (inset < 20) fails.push(`wallInset bara ${inset} efter 8 s med 1 s-krympning`)

// Kör spelare 1 in i den inflyttade väggen → explosion + skak + kill feed
await page.keyboard.up('ArrowLeft')
await page.keyboard.up('KeyA')
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].x = g.wallInset + 30
  g.players[0].y = 360
  g.players[0].angle = Math.PI
})
await page.waitForTimeout(400) // ~15 px väg + explosionen mitt i livet
await page.screenshot({ path: OUT + 'top3-2-death.png' })
const feedText = await page.textContent('#feed')
const dead = await page.evaluate(() => !window.__achtung.getGame().players[0].alive)
if (!dead) fails.push('spelare 1 dog inte mot inflyttade väggen')
if (!feedText.includes('körde in i väggen')) fails.push(`kill feed: "${feedText}"`)

// Spår-kill: ny runda, låt spelare 1 köra in i spelare 2:s spår
await page.waitForTimeout(900) // banner-låset (45 ticks) måste hinna släppa
await page.keyboard.press('Space')
await page.waitForTimeout(3400)
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[1].nextGapIn = 1e9
  g.players[1].x = 300
  g.players[1].y = 500
  g.players[1].angle = 0
})
await page.waitForTimeout(1500) // spelare 2 ritar spår
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].nextGapIn = 1e9
  g.players[0].x = 400
  g.players[0].y = 460
  g.players[0].angle = Math.PI / 2 // rakt ned i spåret
})
await page.waitForTimeout(600)
const feed2 = await page.textContent('#feed')
await page.screenshot({ path: OUT + 'top3-3-trailkill.png' })
if (!feed2.includes('kraschade i')) fails.push(`kill feed (spår): "${feed2}"`)

console.log(`wallInset: ${inset.toFixed(1)} px · feed 1: "${feedText.trim()}" · feed 2: "${feed2.trim()}"`)
if (fails.length || errors.length) {
  console.log('FEL:\n' + [...fails, ...errors].join('\n'))
  process.exitCode = 1
}
await browser.close()
