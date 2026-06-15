// E2E-verifiering av LAN-läget: två separata webbläsarkontexter ansluter
// till servern, blir redo, spelar en runda och tar skärmdumpar.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const errors = []

async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`)
  })
  await page.goto('http://localhost:3000/')
  await page.waitForTimeout(400)
  // In i LAN-lobbyn
  await page.click('.lan-link')
  await page.waitForTimeout(400)
  // Sätt namn
  await page.fill('#netlobby .net-name', name)
  await page.press('#netlobby .net-name', 'Enter')
  await page.waitForTimeout(200)
  return page
}

const alice = await newPlayer('Alice')
const bob = await newPlayer('Bob')
await alice.waitForTimeout(300)
await alice.screenshot({ path: OUT + 'lan-1-lobby.png' })

// Båda redo → matchen ska starta
await alice.click('#netlobby .start-btn')
await bob.click('#netlobby .start-btn')
await alice.waitForTimeout(800)
await alice.screenshot({ path: OUT + 'lan-2-countdown.png' })

// Vänta ut nedräkningen och styr lite olika på varsin klient
await alice.waitForTimeout(2800)
for (let i = 0; i < 5; i++) {
  await alice.keyboard.down('ArrowLeft')
  await bob.keyboard.down('ArrowRight')
  await alice.waitForTimeout(300)
  await alice.keyboard.up('ArrowLeft')
  await bob.keyboard.up('ArrowRight')
  await alice.waitForTimeout(400)
}
await alice.screenshot({ path: OUT + 'lan-3-alice-playing.png' })
await bob.screenshot({ path: OUT + 'lan-4-bob-playing.png' })

// Låt rundan ta slut (ingen styr → krasch förr eller senare) och se banner
await alice.waitForTimeout(15000)
await alice.screenshot({ path: OUT + 'lan-5-after-round.png' })

if (errors.length) {
  console.log('FEL:\n' + errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('Inga JS-fel hos någon klient.')
}
await browser.close()
