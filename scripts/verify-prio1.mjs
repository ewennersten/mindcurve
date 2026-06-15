// Verifierar effekt-timers (krympande stapel) och matchboll-markering. Kräver npm run dev.
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

// --- Effekt-timer: ge spelare 1 en effekt, kolla att stapeln finns och krymper ---
await page.evaluate(() => {
  const { getGame, applyPowerUp } = window.__achtung
  applyPowerUp(getGame(), getGame().players[0], 'selfFast')
})
await page.waitForTimeout(150)
const bar1 = await page.evaluate(() => {
  const b = document.querySelector('#sidebar .fx-bar')
  if (!b) return null
  return b.style.transform
})
await page.waitForTimeout(1200)
const bar2 = await page.evaluate(() => {
  const b = document.querySelector('#sidebar .fx-bar')
  return b ? b.style.transform : null
})
const chipCount = await page.evaluate(() => document.querySelectorAll('#sidebar .fx-chip').length)
await page.screenshot({ path: OUT + 'prio1-1-effecttimer.png' })
function scaleOf(t) { const m = t && t.match(/scaleX\(([0-9.]+)\)/); return m ? parseFloat(m[1]) : null }
const s1 = scaleOf(bar1), s2 = scaleOf(bar2)
console.log(`effekt-stapel: chips=${chipCount}, scaleX ${s1} -> ${s2}`)
if (s1 === null) fails.push('ingen effekt-stapel hittades')
else if (!(s2 < s1)) fails.push(`stapeln krympte inte (${s1} -> ${s2})`)

// --- Matchboll: spelare 1 nära målet, motståndaren dör naturligt (kör in i
//     väggen) → poänglogiken delar ut poäng och uppdaterar matchboll ---
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].score = 9 // auto-mål 10, tröskel 9
  g.players[0].x = 400; g.players[0].y = 300; g.players[0].angle = 0
  g.players[1].x = 1270; g.players[1].y = 300; g.players[1].angle = 0 // rakt in i högerväggen
})
await page.waitForTimeout(1000)
const mp = await page.evaluate(() => {
  const badge = document.querySelector('#sidebar .mp-badge')
  const row = document.querySelector('#sidebar .score-row.match-point')
  return { badge: badge ? badge.textContent : null, hasRow: !!row }
})
await page.screenshot({ path: OUT + 'prio1-2-matchpoint.png' })
console.log(`matchboll: badge="${mp.badge}", markerad rad=${mp.hasRow}`)
if (mp.badge !== 'MATCHBOLL' || !mp.hasRow) fails.push('matchboll-markering saknas')

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nPrio 1 OK: effekt-timer krymper + matchboll-markering visas')
await browser.close()
