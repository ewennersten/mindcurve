// Manuell verifiering med headless Chromium: joinar två spelare i lobbyn,
// startar en match, spelar en stund och tar skärmdumpar längs vägen.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto('http://localhost:5173/')
await page.waitForTimeout(800)
await page.screenshot({ path: OUT + '1-lobby.png' })

// Spelare 2 (Grön) joinar med sin vänstertangent A
await page.keyboard.press('KeyA')
await page.waitForTimeout(300)
await page.screenshot({ path: OUT + '2-lobby-two-joined.png' })

// Starta med space
await page.keyboard.press('Space')
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + '3-countdown.png' })

// Vänta ut nedräkningen (3 s) och spela: håll sväng då och då
await page.waitForTimeout(3000)
for (let i = 0; i < 6; i++) {
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('KeyS')
  await page.waitForTimeout(350)
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.up('KeyS')
  await page.waitForTimeout(450)
}
await page.screenshot({ path: OUT + '4-playing.png' })

// Spela tills rundan tar slut (någon kraschar förr eller senare utan styrning)
await page.waitForTimeout(12000)
await page.screenshot({ path: OUT + '5-later.png' })

if (errors.length) {
  console.log('SIDFEL:\n' + errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('Inga JS-fel på sidan.')
}
await browser.close()
