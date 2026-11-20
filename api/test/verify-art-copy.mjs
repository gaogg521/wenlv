import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const OUT = 'C:/Users/allenzhao/AppData/Local/Temp/minicheck/art-copy'
mkdirSync(OUT, { recursive: true })
const root = 'C:/Users/allenzhao/Desktop/文旅项目/wanderlust/招商宣传站/site'
const url = 'file:///' + root.replace(/\\/g, '/') + '/__csp_check.html'

const b = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
})
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
p.on('pageerror', e => errs.push('pageerror: ' + e.message))
await p.goto(url, { waitUntil: 'load' })
await p.waitForTimeout(800)

const snap = async (panel, i) => {
  const tabName = panel === 'panel-visitor' ? 'visitor' : 'merchant'
  await p.evaluate(name => document.querySelector(`[data-tab="${name}"]`)?.click(), tabName)
  await p.waitForTimeout(150)
  await p.evaluate(({ panel, i }) => {
    const v = document.querySelector(`#${panel} video`)
    const seeks = panel === 'panel-visitor' ? [0, 4, 13, 20, 30] : [0, 4, 11.6, 24]
    v.pause()
    v.currentTime = seeks[i] + 0.2
  }, { panel, i })
  await p.waitForTimeout(280)
  const result = await p.evaluate(panel => {
    const v = document.querySelector(`#${panel} .product-visual`)
    const cs = getComputedStyle(v)
    const sg = v.querySelector('.demo-slogan')
    const scs = getComputedStyle(sg)
    const badge = v.querySelector('.demo-note b')
    return {
      stage: v.getAttribute('data-stage'),
      slogan: sg.textContent,
      font: scs.fontFamily.split(',')[0].replace(/"/g, ''),
      fill: scs.webkitTextFillColor,
      gradient: scs.backgroundImage.includes('linear-gradient'),
      themeA: cs.getPropertyValue('--stage-a').trim(),
      marks: [...v.querySelectorAll('.demo-note b')].map(x => x.textContent),
      badgeClip: getComputedStyle(badge).clipPath.slice(0, 24),
      active: [...document.querySelectorAll(`#${panel} [data-mini-tab]`)].findIndex(t => t.classList.contains('is-active')),
    }
  }, panel)
  return result
}

const visitor = [], merchant = []
for (let i = 0; i < 5; i++) visitor.push(await snap('panel-visitor', i))
for (let i = 0; i < 4; i++) merchant.push(await snap('panel-merchant', i))
console.log('VISITOR=' + JSON.stringify(visitor))
console.log('MERCHANT=' + JSON.stringify(merchant))

const inline = await p.evaluate(() => document.querySelectorAll('[style]').length)
console.log('INLINE_STYLE_COUNT=' + inline)
console.log('ERRORS=' + JSON.stringify(errs))

const goto = async (panel, i) => {
  const name = panel === 'panel-visitor' ? 'visitor' : 'merchant'
  await p.evaluate(name => document.querySelector(`[data-tab="${name}"]`)?.click(), name)
  await p.waitForTimeout(150)
  await p.evaluate(({ panel, i }) => {
    document.querySelectorAll(`#${panel} [data-mini-tab]`)[i]?.click()
    document.querySelector(`#${panel} video`)?.pause()
  }, { panel, i })
  await p.waitForTimeout(650)
}
await goto('panel-visitor', 0)
await p.locator('#panel-visitor .product-visual').screenshot({ path: OUT + '/visitor-0.png' })
await goto('panel-visitor', 3)
await p.locator('#panel-visitor .product-visual').screenshot({ path: OUT + '/visitor-3.png' })
await goto('panel-merchant', 1)
await p.locator('#panel-merchant .product-visual').screenshot({ path: OUT + '/merchant-1.png' })

await p.setViewportSize({ width: 390, height: 844 })
await p.evaluate(() => window.scrollTo(0, 0))
await goto('panel-visitor', 0)
await p.locator('#panel-visitor .product-visual').screenshot({ path: OUT + '/visitor-mobile.png' })
const mobile = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }))
console.log('MOBILE=' + JSON.stringify(mobile))
console.log('SCREENSHOTS=' + OUT)
await b.close()
