// 诊断 5：把 console / exception 参数完整序列化，抓 "Page has not been registered" 的真实原因
// 运行：MSYS_NO_PATHCONV=1 node test/diag-verbose.mjs
import automator from 'miniprogram-automator'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag5]', ...a)
const dump = (v) => {
  try { return typeof v === 'string' ? v : JSON.stringify(v) } catch (e) { return String(v) }
}

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上'); process.exit(1) }

mini.on('console', (m) => {
  const args = (m.args || []).map(dump)
  log('[console:' + m.type + ']', args.join(' | ').slice(0, 1200))
})
mini.on('exception', (e) => log('[exception]', dump(e).slice(0, 1500)))

for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}
log('已连接，当前页 =', (await mini.currentPage()).path)

// 检查 app service 里页面是否注册
const reg = await mini.evaluate(function () {
  const out = {}
  try {
    out.hasPageFn = typeof Page
    out.hasApp = typeof getApp
    out.routes = (typeof __wxConfig !== 'undefined' ? (__wxConfig.pages || []) : []).filter((p) => p.indexOf('package-') === 0)
    // 有些版本暴露 __wxAppCode__ / __wxRoute
    out.hasAppCode = typeof __wxAppCode__
    if (typeof __wxAppCode__ === 'object' && __wxAppCode__) out.appCodeKeys = Object.keys(__wxAppCode__).slice(0, 30)
  } catch (e) { out.err = e.message }
  return JSON.stringify(out)
})
log('注册态探测:', reg)

// 逐个导航，只看 identity（会抛 routeDone 的那个）
for (const p of ['/package-content/pages/identity/index', '/package-promo/pages/center/index']) {
  log('=== 导航 ' + p + ' ===')
  try {
    await mini.evaluate(function (path) {
      globalThis.__n = 'pending'
      wx.navigateTo({
        url: path,
        success: () => { globalThis.__n = 'NAV OK' },
        fail: (e) => { globalThis.__n = 'NAV FAIL: ' + (e && e.errMsg) },
      })
    }, p)
  } catch (e) { log('evaluate 报错:', e.message) }
  await wait(4000)
  try { log('回调结果:', await mini.evaluate(() => globalThis.__n)) } catch (e) {}
  try {
    const st = await mini.evaluate(() => JSON.stringify({
      stack: getCurrentPages().map((x) => x.route),
      len: getCurrentPages().length,
    }))
    log('页面栈:', st)
  } catch (e) { log('读栈失败:', e.message) }
  await mini.reLaunch('/pages/home/index').catch(() => {})
  await wait(1500)
}

process.exit(0)
