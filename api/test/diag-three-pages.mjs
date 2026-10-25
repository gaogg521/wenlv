// 诊断三个 timeout 的分包页：逐个 reLaunch + 抓 console/异常 + 用 wx.navigateTo 复测
// 运行：MSYS_NO_PATHCONV=1 node test/diag-three-pages.mjs
import automator from 'miniprogram-automator'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag]', ...a)

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上 ' + WS); process.exit(1) }
log('已连接')

mini.on('console', (m) => log('[console]', m.type, (m.args || []).join(' ')))
mini.on('exception', (e) => log('[exception]', JSON.stringify(e)))

// 等首屏
for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) { log('就绪:', p.path); break } } catch (e) {}
  await wait(1000)
}

const pages = [
  '/package-promo/pages/center/index',
  '/package-content/pages/identity/index',
  '/package-content/pages/create/index',
  '/package-tour/pages/detail/index', // 对照组：已知能开
]

for (const p of pages) {
  const t0 = Date.now()
  let out = ''
  try {
    const r = await Promise.race([
      mini.reLaunch(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_25s')), 25000)),
    ])
    out = 'OK ' + (r && r.path ? r.path : '')
  } catch (e) {
    out = 'FAIL ' + e.message
  }
  const dt = Date.now() - t0
  let cur = '(取不到)'
  try { const cp = await mini.currentPage(); cur = cp && cp.path } catch (e) { cur = '(currentPage 超时)' }
  log(`reLaunch ${p} → ${out}  ${dt}ms  当前页=${cur}`)
  await wait(1200)
}

// 用 wx.navigateTo 复测（绕开 automator 的 reLaunch 实现），拿 errMsg
log('—— 以下用 wx.navigateTo 直测，看是否 page is not found ——')
for (const p of pages) {
  try {
    await mini.evaluate(function (path) {
      globalThis.__nav = 'pending'
      wx.navigateTo({
        url: path,
        success: () => { globalThis.__nav = 'NAV OK' },
        fail: (e) => { globalThis.__nav = 'NAV FAIL: ' + (e && e.errMsg) },
      })
    }, p)
  } catch (e) {
    log('evaluate 本身失败:', p, e.message)
    continue
  }
  await wait(3500)
  let r = '(读不到)'
  try { r = await mini.evaluate(() => globalThis.__nav) } catch (e) { r = '(读不到: ' + e.message + ')' }
  let cur = ''
  try { const cp = await mini.currentPage(); cur = cp && cp.path } catch (e) {}
  log(`navigateTo ${p} → ${r}  当前页=${cur}`)
  await wait(800)
}

// 收尾：确认通道仍活
await mini.reLaunch('/pages/home/index')
await wait(1500)
const home = await mini.currentPage()
log('收尾回首页 →', home && home.path)
process.exit(0)
