// 诊断 3：运行时路由表 + 真实“页面不存在”对照组
// 运行：MSYS_NO_PATHCONV=1 node test/diag-route.mjs
import automator from 'miniprogram-automator'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag3]', ...a)

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上'); process.exit(1) }
for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}
log('已连接')

// 1) 运行时能否读到路由配置
const cfg = await mini.evaluate(function () {
  const out = {}
  try { out.hasWxConfig = typeof __wxConfig } catch (e) { out.hasWxConfig = 'throw' }
  try {
    if (typeof __wxConfig !== 'undefined') {
      out.pages = (__wxConfig.pages || []).slice(0, 50)
      out.tabBar = !!(__wxConfig.tabBar && __wxConfig.tabBar.list)
      out.subPackages = __wxConfig.subPackages || __wxConfig.subpackages || null
      out.keys = Object.keys(__wxConfig).slice(0, 20)
    }
  } catch (e) { out.err = e.message }
  try { out.routeList = getCurrentPages().map((p) => p.route) } catch (e) {}
  return JSON.stringify(out)
})
log('路由探测:', cfg)

// 2) 对照组：真正不存在的页面会怎样
async function probe(label, path) {
  const t0 = Date.now()
  const r = await mini.evaluate(function (p) {
    return new Promise(function (resolve) {
      let done = false
      const timer = setTimeout(function () { if (!done) { done = true; resolve('NO_CALLBACK_5s') } }, 5000)
      wx.navigateTo({
        url: p,
        success: function () { if (!done) { done = true; clearTimeout(timer); resolve('NAV OK') } },
        fail: function (e) { if (!done) { done = true; clearTimeout(timer); resolve('NAV FAIL: ' + (e && e.errMsg)) } },
      })
    })
  }, path)
  let cur = ''
  try { const c = await mini.currentPage(); cur = c && c.path } catch (e) { cur = '(超时)' }
  log(`${label} ${path} → ${r}  ${Date.now() - t0}ms  当前=${cur}`)
  await wait(1200)
}

await probe('不存在的页面(对照组)', '/package-promo/pages/not-exist/index')
await probe('不存在的页面(对照组)', '/pages/not-exist/index')
await probe('promo    ', '/package-promo/pages/center/index')
await probe('identity ', '/package-content/pages/identity/index')
await probe('create   ', '/package-content/pages/create/index')
await probe('order(已知可开)', '/package-order/pages/orders/index')

process.exit(0)
