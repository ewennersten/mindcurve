// Verifierar att ljudmotorn faktiskt schemalägger ljud under spel:
// instrumenterar AudioContext innan sidan laddas och räknar oscillator-starter
// (musiksequencern + effekter) under nedräkning och en spelad runda.
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.addInitScript(() => {
  const Orig = window.AudioContext
  window.__oscStarts = 0
  window.__noiseStarts = 0
  window.__ctxState = 'aldrig skapad'
  window.AudioContext = class extends Orig {
    constructor(...a) {
      super(...a)
      const self = this
      setInterval(() => (window.__ctxState = self.state), 500)
    }
    createOscillator() {
      const o = super.createOscillator()
      const start = o.start.bind(o)
      o.start = (...a) => {
        window.__oscStarts++
        return start(...a)
      }
      return o
    }
    createBufferSource() {
      const s = super.createBufferSource()
      const start = s.start.bind(s)
      s.start = (...a) => {
        window.__noiseStarts++
        return start(...a)
      }
      return s
    }
  }
})

await page.goto('http://localhost:5173/')
await page.waitForTimeout(500)
await page.keyboard.press('KeyA') // spelare 2 joinar (gest → unlock)
await page.keyboard.press('Space') // starta
// Nedräkning (3 s, pip) + ~4 s spel (musikloop + ev. effekter)
await page.waitForTimeout(7500)

const osc = await page.evaluate(() => window.__oscStarts)
const noise = await page.evaluate(() => window.__noiseStarts)
const state = await page.evaluate(() => window.__ctxState)

console.log(`AudioContext: ${state} · oscillatorer startade: ${osc} · brusljud startade: ${noise}`)
// ~4 s musik vid 126 BPM ≈ 130+ sextondelar (arp på varje + bas/kick) → långt över 100
if (osc < 50 || noise < 5) {
  console.log('FEL: för få schemalagda ljud — ljudmotorn verkar inte trigga.')
  process.exitCode = 1
}
if (errors.length) {
  console.log('SIDFEL:\n' + errors.join('\n'))
  process.exitCode = 1
}
await browser.close()
