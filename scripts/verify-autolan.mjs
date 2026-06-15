import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const IP = readFileSync('/tmp/mc-ip.txt', 'utf8').trim()
const browser = await chromium.launch()
const fails = []

async function check(url, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(url)
  await page.waitForTimeout(1200)
  const lobbyHidden = await page.locator('#lobby').evaluate((el) => el.hidden)
  const netVisible = await page.locator('#netlobby').evaluate((el) => !el.hidden)
  const netText = (await page.textContent('#netlobby').catch(() => '')) || ''
  console.log(`${label}: lokal lobby dold=${lobbyHidden}, LAN-lobby synlig=${netVisible}`)
  if (errs.length) fails.push(`${label}: JS-fel ${errs.join(';')}`)
  await page.close()
  return { lobbyHidden, netVisible, netText }
}

// Kollega: öppnar via nätverks-IP → ska auto-öppna LAN-lobbyn
const colleague = await check(`http://${IP}:3000/`, 'Kollega (IP)')
if (!colleague.netVisible || !colleague.lobbyHidden) fails.push('Kollega hamnade INTE i LAN-lobbyn')
if (!colleague.netText.includes('LAN')) fails.push('LAN-lobbyns innehåll saknas för kollega')

// Värd: öppnar via localhost → ska få vanliga menyn
const host = await check('http://localhost:3000/', 'Värd (localhost)')
if (host.netVisible || host.lobbyHidden) fails.push('Värd hamnade i LAN-lobbyn (skulle fått vanliga menyn)')

// #local-flagga på IP → tvinga vanliga menyn
const forced = await check(`http://${IP}:3000/#local`, 'IP + #local')
if (forced.netVisible) fails.push('#local respekterades inte')

// #lan-flagga på localhost → tvinga LAN-lobbyn
const forcedLan = await check('http://localhost:3000/#lan', 'localhost + #lan')
if (!forcedLan.netVisible) fails.push('#lan respekterades inte')

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nAuto-LAN OK: kollega→LAN, värd→meny, #local/#lan override funkar')
await browser.close()
