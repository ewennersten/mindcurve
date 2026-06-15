// Verifierar poängmålsväljaren: lokalt (vite dev) och i LAN-lobbyn,
// inklusive att servern broadcastar valet till andra klienter.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../verify-shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const errors = []
const fails = []

function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`))
}

// ── Lokalt: välj 5 poäng, starta, kolla "Först till 5" i sidopanelen ──
const local = await browser.newPage({ viewport: { width: 1440, height: 810 } })
watch(local, 'lokal')
await local.goto('http://localhost:5173/')
await local.waitForTimeout(500)
await local.selectOption('#lobby .target-select', '5')
await local.keyboard.press('KeyA') // spelare 2 joinar
await local.waitForTimeout(300)
const infoText = await local.textContent('#lobby .target-info')
if (!infoText.includes('5')) fails.push(`lokal lobbytext: "${infoText}"`)
await local.screenshot({ path: OUT + 'target-1-lobby.png' })
await local.keyboard.press('Space')
await local.waitForTimeout(600)
const sidebarTarget = await local.textContent('#sidebar .target')
if (!sidebarTarget.includes('Först till 5')) fails.push(`lokal sidopanel: "${sidebarTarget}"`)
await local.screenshot({ path: OUT + 'target-2-game.png' })

// ── LAN: en klient ändrar målet, den andra ska se ändringen ──
async function lanClient(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } })
  const page = await ctx.newPage()
  watch(page, name)
  await page.goto('http://localhost:3000/')
  await page.waitForTimeout(400)
  await page.click('.lan-link')
  await page.waitForTimeout(400)
  return page
}
const a = await lanClient('A')
const b = await lanClient('B')
await a.selectOption('#netlobby .target-select', '30')
await a.waitForTimeout(500)
const bSeen = await b.inputValue('#netlobby .target-select')
if (bSeen !== '30') fails.push(`LAN-klient B ser poängmål "${bSeen}", väntade "30"`)
await b.screenshot({ path: OUT + 'target-3-netlobby.png' })

// Starta matchen och kolla att målet följde med
await a.click('#netlobby .start-btn')
await b.click('#netlobby .start-btn')
await a.waitForTimeout(800)
const lanTarget = await a.textContent('#sidebar .target')
if (!lanTarget.includes('Först till 30')) fails.push(`LAN sidopanel: "${lanTarget}"`)
await a.screenshot({ path: OUT + 'target-4-netgame.png' })

if (errors.length || fails.length) {
  console.log('FEL:\n' + [...errors, ...fails].join('\n'))
  process.exitCode = 1
} else {
  console.log('Poängmål OK: lokalt 5 ✓, LAN 30 synkat mellan klienter ✓')
}
await browser.close()
