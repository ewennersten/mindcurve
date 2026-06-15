// Verifierar att power-up-toggles synkas mellan klienter över LAN.
// Kräver npm run lan (servern på :3000).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const fails = []

async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${name}: ${e}`))
  await page.goto('http://localhost:3000/')
  await page.waitForTimeout(400)
  await page.click('.lan-link')
  await page.waitForTimeout(400)
  return page
}

const alice = await newPlayer('Alice')
const bob = await newPlayer('Bob')

const chips = await alice.locator('#netlobby .pu-toggle').count()
console.log(`toggle-chips i LAN-lobbyn: ${chips}`)
if (chips !== 17) fails.push(`väntade 17 chips, fick ${chips}`)

// Alice stänger av stjärnan och kanonen → ska synas hos Bob via servern
await alice.locator('#netlobby .pu-toggle', { hasText: '⭐' }).click()
await alice.waitForTimeout(300)
await alice.locator('#netlobby .pu-toggle', { hasText: '🔫' }).click()
await bob.waitForTimeout(500)
const bobOff = await bob.locator('#netlobby .pu-toggle.off').count()
const aliceOff = await alice.locator('#netlobby .pu-toggle.off').count()
console.log(`avstängda chips — Alice: ${aliceOff}, Bob: ${bobOff}`)
if (aliceOff !== 2) fails.push(`Alice ser ${aliceOff} avstängda, väntade 2`)
if (bobOff !== 2) fails.push(`Bob ser ${bobOff} avstängda, väntade 2 — synken brister`)
await bob.screenshot({ path: OUT + 'putoggle-2-lansync.png' })

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nLAN-synk OK: toggles når alla klienter via servern')
await browser.close()
