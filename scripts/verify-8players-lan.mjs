// Verifierar att fler än 4 spelare kan ansluta och spela över LAN.
// Kräver npm run lan (servern på :3000).
import { chromium } from 'playwright'
const browser = await chromium.launch()
const fails = []

async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${name}: ${e}`))
  await page.goto('http://localhost:3000/#lan')
  await page.waitForSelector('#netlobby .net-name', { timeout: 10000 }).catch(async () => {
    const err = await page.locator('#netlobby .net-error').textContent().catch(() => null)
    throw new Error(`${name} kom inte in i lobbyn${err ? ` — servern sa: "${err}"` : ''}`)
  })
  await page.fill('#netlobby .net-name', name)
  await page.press('#netlobby .net-name', 'Enter')
  return page
}

// Sex spelare ansluter — fler än gamla taket på fyra
const players = []
for (let i = 1; i <= 6; i++) players.push(await newPlayer(`Spelare${i}`))
await players[0].waitForTimeout(500)

const rows = await players[0].locator('#netlobby .score-row').count()
console.log(`spelare i LAN-lobbyn: ${rows}`)
if (rows !== 6) fails.push(`väntade 6 spelare i lobbyn, fick ${rows}`)

// Alla redo → matchen startar
for (const p of players) await p.click('#netlobby .start-btn')
await players[0].waitForTimeout(1500)
const inGame = await players[0].evaluate(() => document.getElementById('game')?.hidden === false)
const hudRows = await players[0].locator('#sidebar .score-row').count()
console.log(`match igång: ${inGame}, HUD-rader: ${hudRows}`)
if (!inGame) fails.push('matchen startade inte med 6 spelare')
if (hudRows !== 6) fails.push(`HUD visar ${hudRows} rader, väntade 6`)
await players[0].screenshot({ path: 'verify-shots/8p-3-lan6.png' })

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nLAN OK: 6 spelare anslutna och match igång')
await browser.close()
