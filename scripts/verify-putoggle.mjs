// Verifierar power-up-toggles i lokala lobbyn: chips renderas, klick stänger av
// typer, och inställningen når spelets settings. Kräver npm run dev.
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

// Toggle-raden finns med en chip per power-up-typ
const chipCount = await page.locator('#lobby .pu-toggle').count()
console.log(`toggle-chips i lobbyn: ${chipCount}`)
if (chipCount !== 17) fails.push(`väntade 17 chips, fick ${chipCount}`)

// Stäng av stjärnan (⭐) och ölen (🍺)
await page.locator('#lobby .pu-toggle', { hasText: '⭐' }).click()
await page.locator('#lobby .pu-toggle', { hasText: '🍺' }).click()
const offCount = await page.locator('#lobby .pu-toggle.off').count()
console.log(`avstängda chips: ${offCount}`)
if (offCount !== 2) fails.push(`väntade 2 avstängda chips, fick ${offCount}`)
await page.screenshot({ path: OUT + 'putoggle-1-lobby.png' })

// Bocka ur Power-ups helt → raden ska försvinna
await page.locator('#lobby .setting input[type=checkbox]').first().uncheck()
const hidden = (await page.locator('#lobby .pu-toggles').count()) === 0
if (!hidden) fails.push('toggle-raden döljs inte när power-ups stängs av')
await page.locator('#lobby .setting input[type=checkbox]').first().check()

// Starta spelet och kontrollera att inställningen nådde kärnan
await page.keyboard.press('Space')
await page.waitForTimeout(500)
const disabled = await page.evaluate(() => window.__achtung.getGame()?.settings.disabledPowerups)
console.log(`settings.disabledPowerups: ${JSON.stringify(disabled)}`)
if (!disabled || disabled.length !== 2 || !disabled.includes('mindcamp') || !disabled.includes('beer')) {
  fails.push(`spelets settings fick fel disabledPowerups: ${JSON.stringify(disabled)}`)
}

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nPower-up-toggles OK: chips renderas, togglar och når spelets settings')
await browser.close()
