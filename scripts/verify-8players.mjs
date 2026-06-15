// Verifierar 8-spelarstödet: lobbyn visar 8 slots, alla kan gå med, och en
// runda med 8 maskar startar och renderas. Kräver npm run dev.
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

const slotCount = await page.locator('#lobby .slot').count()
console.log(`slots i lobbyn: ${slotCount}`)
if (slotCount !== 8) fails.push(`väntade 8 slots, fick ${slotCount}`)

// Anslut alla genom att klicka på de öppna platserna
while ((await page.locator('#lobby .slot.open').count()) > 0) {
  await page.locator('#lobby .slot.open').first().click()
}
const joined = await page.locator('#lobby .slot.joined').count()
console.log(`anslutna: ${joined}`)
if (joined !== 8) fails.push(`väntade 8 anslutna, fick ${joined}`)
await page.screenshot({ path: OUT + '8p-1-lobby.png' })

// Starta och låt rundan rulla en stund
await page.keyboard.press('Space')
await page.waitForTimeout(4500) // nedräkning + 1,5 s spel
const game = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  return {
    phase: g?.phase,
    players: g?.players.length,
    colors: new Set(g?.players.map((p) => p.color)).size,
    target: g?.targetScore,
    rows: document.querySelectorAll('#sidebar .score-row').length,
  }
})
console.log(`fas: ${game.phase}, spelare: ${game.players}, unika färger: ${game.colors}, mål: ${game.target}, HUD-rader: ${game.rows}`)
if (game.players !== 8) fails.push(`spelet fick ${game.players} spelare`)
if (game.colors !== 8) fails.push(`färgerna är inte unika (${game.colors})`)
if (game.target !== 70) fails.push(`auto-målet blev ${game.target}, väntade 70`)
if (game.rows !== 8) fails.push(`HUD visar ${game.rows} rader`)
await page.screenshot({ path: OUT + '8p-2-playing.png' })

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\n8 spelare OK: lobby, start, unika färger och HUD')
await browser.close()
