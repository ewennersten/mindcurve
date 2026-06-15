// Verifierar den mobilanpassade LAN-klienten: en touch-emulerad telefon ansluter
// över LAN, får två styrknappar + liggande-tips, kan styra masken, och att
// touch-styrningen ALDRIG dyker upp på desktop eller i lokalt läge.
// Kräver att servern körs: npm run lan
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
mkdirSync(new URL('../verify-shots/', import.meta.url).pathname, { recursive: true })

const browser = await chromium.launch()
const fails = []

// ── 1. Telefon (touch, liggande) ansluter över LAN ───────────────────
const phone = await browser.newContext({
  viewport: { width: 844, height: 390 }, // liggande
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
})
const page = await phone.newPage()
page.on('pageerror', (e) => fails.push('phone: ' + String(e)))

await page.goto('http://localhost:3000/#lan')
await page.waitForSelector('#netlobby .net-name', { timeout: 10000 })

// Coarse pointer → isTouchDevice() sant → touch-DOM ska skapas vid net.start()
const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
console.log(`telefon: pointer coarse = ${coarse}`)

await page.fill('#netlobby .net-name', 'Mobilen')
await page.press('#netlobby .net-name', 'Enter')
await page.click('#netlobby .bot-add') // 1 människa + 1 bot räcker för start
await page.waitForTimeout(300)
await page.click('#netlobby .start-btn')
await page.waitForTimeout(4500) // nedräkning

const inGame = await page.evaluate(() => document.getElementById('game')?.hidden === false)
if (!inGame) fails.push('matchen startade inte på telefonen')

// Två styrknappar ska finnas och synas; liggande-tipset ska vara dolt.
const btnCount = await page.locator('#touch-controls .touch-btn').count()
const leftVisible = await page.locator('.touch-left').isVisible()
const hintHidden = await page.evaluate(() => {
  const h = document.getElementById('rotate-hint')
  return !h || getComputedStyle(h).display === 'none'
})
console.log(`knappar: ${btnCount}, vänster synlig: ${leftVisible}, tips dolt (liggande): ${hintHidden}`)
if (btnCount !== 2) fails.push(`fel antal touch-knappar (${btnCount})`)
if (!leftVisible) fails.push('vänsterknappen syns inte i liggande')
if (!hintHidden) fails.push('vrid-telefonen-tipset visas i liggande (ska vara dolt)')

// Håll in vänster → knappen ska bli .active och masken svänga. Vi jämför två
// spel-skärmdumpar (LAN-bygget saknar window.__achtung, så vi mäter liveness).
const left = page.locator('.touch-left')
await page.waitForTimeout(1500)
const before = await page.locator('#field').screenshot()
await left.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true })
const active = await left.evaluate((el) => el.classList.contains('active'))
if (!active) fails.push('vänsterknappen blev inte .active vid pointerdown')
await page.waitForTimeout(1600) // låt masken svänga åt vänster
await left.dispatchEvent('pointerup', { pointerId: 1, bubbles: true })
const after = await page.locator('#field').screenshot()
if (Buffer.compare(before, after) === 0) fails.push('spelplanen rörde sig inte medan knappen hölls (input nådde inte servern?)')
await page.screenshot({ path: 'verify-shots/mobile-1-game.png' })

// Portrait → vrid-tipset ska dyka upp
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(200)
const hintShown = await page.evaluate(() => {
  const h = document.getElementById('rotate-hint')
  return !!h && getComputedStyle(h).display !== 'none'
})
console.log(`tips synligt i stående: ${hintShown}`)
if (!hintShown) fails.push('vrid-telefonen-tipset visas inte i stående')
await page.screenshot({ path: 'verify-shots/mobile-2-rotate.png' })

// ── 2. Negativtest: desktop-LAN-klient får ALDRIG touch-knappar ──────
const desktop = await browser.newContext({ viewport: { width: 1440, height: 810 } })
const dpage = await desktop.newPage()
dpage.on('pageerror', (e) => fails.push('desktop: ' + String(e)))
await dpage.goto('http://localhost:3000/#lan')
// net.start() körs direkt på #lan (matchen kan redan pågå → åskådare); räcker
// för att TouchControls skulle ha skapats om det vore en touch-enhet.
await dpage.waitForTimeout(1500)
const desktopHasTouch = await dpage.evaluate(() => !!document.getElementById('touch-controls'))
console.log(`desktop-LAN har touch-DOM: ${desktopHasTouch} (ska vara false)`)
if (desktopHasTouch) fails.push('desktop-LAN-klient fick touch-knappar')

// ── 3. Negativtest: touch-enhet i LOKALT läge får ALDRIG touch-DOM ───
// (#local tvingar lokala lobbyn → net.start() körs aldrig → ingen TouchControls)
const localPhone = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
})
const lpage = await localPhone.newPage()
lpage.on('pageerror', (e) => fails.push('local-phone: ' + String(e)))
await lpage.goto('http://localhost:3000/#local')
await lpage.waitForTimeout(600)
const localHasTouch = await lpage.evaluate(() => !!document.getElementById('touch-controls'))
console.log(`touch-enhet i lokalt läge har touch-DOM: ${localHasTouch} (ska vara false)`)
if (localHasTouch) fails.push('touch-styrning skapades i lokalt läge')

if (fails.length) {
  console.log('\nFEL:\n' + fails.join('\n'))
  process.exitCode = 1
} else {
  console.log('\nMobil-LAN OK: telefon får styrknappar + liggande-tips och kan styra; desktop och lokalt läge förblir touch-fria')
}
await browser.close()
