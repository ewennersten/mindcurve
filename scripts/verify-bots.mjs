// Verifierar botspelare lokalt: lägg till 3 bottar i lobbyn, starta, och se
// att de styr undan och överlever en stund. Kräver npm run dev.
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

// Lägg till tre bottar via knapparna på lediga platser
for (let i = 0; i < 3; i++) {
  await page.locator('#lobby .slot.open .bot-add').first().click()
}
const botTags = await page.locator('#lobby .bot-tag').count()
console.log(`botplatser i lobbyn: ${botTags}`)
if (botTags !== 3) fails.push(`väntade 3 botplatser, fick ${botTags}`)

// Svårighetsslidern ska synas när bottar finns, och etiketten följa värdet
const slider = page.locator('#lobby .bot-level input')
if ((await slider.count()) !== 1) fails.push('svårighetsslidern saknas trots bottar')
else {
  await slider.evaluate((el) => {
    el.value = '1'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const label = await page.locator('#lobby .bot-level-label').textContent()
  console.log(`slider på 1 → etikett: ${label}`)
  if (label !== 'Lullig') fails.push(`etiketten blev "${label}", väntade "Lullig"`)
  // Tillbaka till max inför spelet
  await slider.evaluate((el) => {
    el.value = '5'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
await page.screenshot({ path: OUT + 'bots-1-lobby.png' })

// Starta: 1 människa (Röd) + 3 bottar
await page.keyboard.press('Space')
await page.waitForTimeout(3500) // nedräkning klar

// Låt spelet rulla 6 s — bottarna ska väja och de flesta överleva,
// medan människan (ingen input) kör rakt in i något så småningom
await page.waitForTimeout(6000)
const state = await page.evaluate(() => {
  const g = window.__achtung.getGame()
  if (!g) return null
  return {
    phase: g.phase,
    players: g.players.map((p) => ({ name: p.name, alive: p.alive })),
    roundTick: g.roundTick,
  }
})
console.log(JSON.stringify(state, null, 1))
await page.screenshot({ path: OUT + 'bots-2-playing.png' })
if (!state) fails.push('spelet försvann')
else {
  const aliveBots = state.players.slice(1).filter((p) => p.alive).length
  // Efter 6 s ska minst 2 av 3 bottar leva (de väjer; krockar med varandra kan hända)
  if (state.phase === 'playing' && aliveBots < 2) fails.push(`bara ${aliveBots}/3 bottar lever efter 6 s`)
  if (state.phase !== 'playing' && state.roundTick < 200) fails.push('rundan tog slut nästan direkt — bottarna styr inte')
}

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nBottar OK lokalt: läggs till i lobbyn och överlever på planen')
await browser.close()
