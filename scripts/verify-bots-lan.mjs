// Verifierar bottar över LAN: en ensam klient lägger till en bot, blir redo,
// och matchen startar med botten styrd av servern. Kräver npm run lan.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
mkdirSync(new URL('../verify-shots/', import.meta.url).pathname, { recursive: true })
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage()
const fails = []
page.on('pageerror', (e) => fails.push(String(e)))
await page.goto('http://localhost:3000/#lan')
await page.waitForSelector('#netlobby .net-name', { timeout: 10000 })
await page.fill('#netlobby .net-name', 'Elias')
await page.press('#netlobby .net-name', 'Enter')

// Lägg till en bot — ska dyka upp i listan med 🤖
await page.click('#netlobby .bot-add')
await page.waitForTimeout(400)
const rows = await page.locator('#netlobby .score-row').count()
const botMark = await page.locator('#netlobby .net-ready', { hasText: '🤖' }).count()
console.log(`rader i lobbyn: ${rows}, bottar: ${botMark}`)
if (rows !== 2 || botMark !== 1) fails.push(`lobbyn visar ${rows} rader / ${botMark} bottar`)

// Ta bort och lägg tillbaka — ✕-knappen ska funka
await page.click('#netlobby .score-row .leave')
await page.waitForTimeout(300)
const afterRemove = await page.locator('#netlobby .score-row').count()
if (afterRemove !== 1) fails.push(`boten togs inte bort (${afterRemove} rader)`)
await page.click('#netlobby .bot-add')
await page.waitForTimeout(300)

// Slidern ska synas när boten finns, och värdet studsa via serverns broadcast
const slider = page.locator('#netlobby .bot-level input')
if ((await slider.count()) !== 1) fails.push('svårighetsslidern saknas i LAN-lobbyn')
else {
  await slider.evaluate((el) => {
    el.value = '2'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(400) // broadcast → omritning
  const synced = await page.locator('#netlobby .bot-level input').inputValue()
  console.log(`slider efter serverstuds: ${synced}`)
  if (synced !== '2') fails.push(`nivån synkades inte (${synced})`)
}

// Ensam människa + bot → REDO ska starta matchen
await page.click('#netlobby .start-btn')
await page.waitForTimeout(4500) // nedräkning
await page.waitForTimeout(4000) // låt botten köra
const inGame = await page.evaluate(() => document.getElementById('game')?.hidden === false)
const hud = await page.evaluate(() =>
  [...document.querySelectorAll('#sidebar .score-row')].map((r) => ({
    name: r.querySelector('.p-name')?.textContent,
    dead: r.classList.contains('dead'),
  })),
)
console.log(`match igång: ${inGame}, HUD: ${JSON.stringify(hud)}`)
if (!inGame) fails.push('matchen startade inte med 1 människa + 1 bot')
const bot = hud.find((p) => p.name !== 'Elias')
if (!bot || bot.dead) fails.push('botten lever inte efter 4 s spel — styr servern den?')
await page.screenshot({ path: 'verify-shots/bots-3-lan.png' })

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nBottar OK över LAN: läggs till/tas bort, matchen startar och servern styr boten')
await browser.close()
