// Verifierar statistikskärmen (utmärkelser) vid matchslut. Kräver npm run dev.
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

// Rigga matchslut: spelare 1 har matchboll + påhittad statistik, spelare 2 kör
// in i väggen → rundan (och matchen) avgörs av den riktiga spel-loopen.
await page.evaluate(() => {
  const g = window.__achtung.getGame()
  g.players[0].score = 9 // auto-mål 10
  g.players[0].matchStats = { kills: 3, suicides: 1, powerups: 5, bestSurvivalTicks: 2700 }
  g.players[0].x = 400; g.players[0].y = 300; g.players[0].angle = 0
  g.players[1].x = 1270; g.players[1].y = 300; g.players[1].angle = 0 // rakt in i högerväggen
})
await page.waitForTimeout(1500) // roundOver + bannerlås (45 ticks)
await page.keyboard.press('Space') // visa resultat → matchOver
await page.waitForTimeout(800)

const res = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  const awards = [...document.querySelectorAll('#banner .award')].map((el) => el.textContent.trim())
  return { phase: g?.phase, awards }
})
await page.screenshot({ path: OUT + 'stats-1-matchover.png' })
console.log(`fas: ${res.phase}`)
for (const a of res.awards) console.log(`  utmärkelse: ${a}`)

if (res.phase !== 'matchOver') fails.push(`hamnade inte i matchOver (fas: ${res.phase})`)
if (res.awards.length < 3) fails.push(`för få utmärkelser (${res.awards.length}) — väntade minst kills/överlevnad/självmord`)
if (!res.awards.some((a) => a.includes('Bödeln') && a.includes('3 kills'))) fails.push('Bödeln-utmärkelsen saknas eller fel värde')
if (!res.awards.some((a) => a.includes('Överlevaren') && a.includes('45,0 s'))) fails.push('Överlevaren-utmärkelsen saknas eller fel värde')
if (!res.awards.some((a) => a.includes('Plockaren') && a.includes('5 power-ups'))) fails.push('Plockaren-utmärkelsen saknas eller fel värde')
// Båda spelarna har 1 självmord (riggat + väggdöden) → delad utmärkelse
if (!res.awards.some((a) => a.includes('Olycksfågeln') && a.includes('&'))) fails.push('Olycksfågeln-utmärkelsen saknas eller är inte delad vid lika')

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nStatistikskärm OK: utmärkelser visas med rätt värden vid matchslut')
await browser.close()
