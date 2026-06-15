import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const fails = []
page.on('pageerror', (e) => fails.push(String(e)))
await page.goto('http://localhost:5173/')
await page.waitForTimeout(600)

// Hovra över sköld-chipen och kolla att tooltipen blir synlig
const shield = page.locator('#lobby .pu-toggle', { hasText: '🛡' })
await shield.hover()
await page.waitForTimeout(300)
const tip = await shield.evaluate((el) => {
  const after = getComputedStyle(el, '::after')
  return { opacity: after.opacity, content: after.content }
})
console.log(`tooltip: opacity=${tip.opacity}, content=${tip.content.slice(0, 60)}…`)
if (tip.opacity !== '1') fails.push(`tooltipen visas inte vid hover (opacity ${tip.opacity})`)
if (!tip.content.includes('Sköld')) fails.push('tooltipen saknar förklaringstexten')
await page.screenshot({ path: 'verify-shots/tooltip-1-hover.png' })

// Stäng av chipen → tooltipen ska byta till "Avstängd …"
await shield.click()
await page.waitForTimeout(200)
const offTip = await page.locator('#lobby .pu-toggle.off').first().getAttribute('data-tip')
console.log(`avstängd tooltip: ${offTip?.replace('\n', ' | ')}`)
if (!offTip?.includes('Avstängd')) fails.push('tooltipen uppdateras inte när chipen stängs av')
await page.locator('#lobby .pu-toggle.off').first().hover()
await page.waitForTimeout(300)
await page.screenshot({ path: 'verify-shots/tooltip-2-off.png' })

if (fails.length) { console.log('\nFEL:\n' + fails.join('\n')); process.exitCode = 1 }
else console.log('\nTooltip OK: visas vid hover och uppdateras med av/på-läget')
await browser.close()
