// 诊断 6：差分对比「能打开的分包」vs「打不开的分包」在 __wxAppCode__ 注册表上的差异
// 运行：MSYS_NO_PATHCONV=1 node test/diag-code.mjs
import automator from 'miniprogram-automator'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag6]', ...a)

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上'); process.exit(1) }
mini.on('console', (m) => log('[console:' + m.type + ']', (m.args || []).map(String).join(' ').slice(0, 300)))
for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}

const keys = async () => {
  const r = await mini.evaluate(function () {
    try {
      const k = Object.keys(__wxAppCode__ || {})
      const byPkg = {}
      k.forEach((x) => {
        const pkg = x.indexOf('package-') === 0 ? x.split('/')[0] : 'main'
        byPkg[pkg] = (byPkg[pkg] || 0) + 1
      })
      return JSON.stringify({ total: k.length, byPkg, sample: k.filter((x) => x.indexOf('package-') === 0).slice(0, 8) })
    } catch (e) { return 'ERR ' + e.message }
  })
  return r
}

log('初始注册表:', await keys())

log('=== 导航到 package-order/orders（已知能开）===')
await mini.navigateTo('/package-order/pages/orders/index').catch((e) => log('navigateTo 报错:', e.message))
await wait(3000)
log('order 之后注册表:', await keys())
try { log('当前页:', (await mini.currentPage()).path) } catch (e) {}
await mini.reLaunch('/pages/home/index')
await wait(1500)

log('=== 导航到 package-content/identity（打不开）===')
try {
  await mini.evaluate(function () {
    globalThis.__n = 'pending'
    wx.navigateTo({
      url: '/package-content/pages/identity/index',
      success: () => { globalThis.__n = 'NAV OK' },
      fail: (e) => { globalThis.__n = 'NAV FAIL: ' + (e && e.errMsg) },
    })
  })
} catch (e) { log('evaluate 报错:', e.message) }
await wait(5000)
try { log('identity 回调:', await mini.evaluate(() => globalThis.__n)) } catch (e) {}
log('identity 之后注册表:', await keys())

process.exit(0)
