// 诊断 2：按真实用户路径（我的 → 点入口）验证三个分包页，并对照 wx.preloadSubpackage
// 运行：MSYS_NO_PATHCONV=1 node test/diag-entries.mjs
import automator from 'miniprogram-automator'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag2]', ...a)

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上'); process.exit(1) }
mini.on('console', (m) => log('[console]', m.type, (m.args || []).join(' ')))

for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}

// ── A. 真实路径：我的页点入口 ─────────────────────────────
async function tapEntry(label) {
  await mini.reLaunch('/pages/me/index')
  await wait(2000)
  const page = await mini.currentPage()
  if (page.path !== 'pages/me/index') { log('没到我的页，当前=', page.path); return }
  const rows = await page.$$('.kv')
  log(`我的页找到 ${rows.length} 个 .kv 入口`)
  let target = null
  for (const el of rows) {
    const t = await el.text()
    if (t && t.includes(label)) { target = el; break }
  }
  if (!target) { log(`未找到入口「${label}」`); return }
  log(`点击「${label}」…`)
  try { await target.tap() } catch (e) { log('tap 本身报错:', e.message) }
  // 轮询 10s 看页面是否真的切过去
  for (let i = 0; i < 20; i++) {
    await wait(500)
    let cur = ''
    try { const p = await mini.currentPage(); cur = p && p.path } catch (e) { cur = '(currentPage 超时)' }
    if (cur && cur.indexOf('package-') === 0) { log(`→ 打开成功: ${cur}（${(i + 1) * 0.5}s）`); return }
    if (i === 19) log(`→ 10s 内没切页，当前仍为 ${cur}`)
  }
}

await tapEntry('推广中心')
await tapEntry('创作中心')
await tapEntry('我的数字身份')
await tapEntry('我的订单') // 对照组：package-order 已知能开

// ── B. 手动预下载分包后再导航 ────────────────────────────
log('—— 对照组：先 wx.preloadSubpackage 再 navigateTo ——')
await mini.reLaunch('/pages/home/index')
await wait(1500)
for (const name of ['package-promo', 'package-content']) {
  const pre = await mini.evaluate(function (n) {
    return new Promise(function (resolve) {
      if (!wx.preloadSubpackage) return resolve('API 不存在')
      wx.preloadSubpackage({
        name: n,
        success: () => resolve('preload OK'),
        fail: (e) => resolve('preload FAIL: ' + (e && e.errMsg)),
      })
      setTimeout(() => resolve('preload 无回调(3s)'), 3000)
    })
  }, name)
  log(name, '预下载 →', pre)
}

// 预下载完再导航
for (const p of ['/package-promo/pages/center/index', '/package-content/pages/identity/index', '/package-content/pages/create/index']) {
  const t0 = Date.now()
  try {
    const page = await Promise.race([
      mini.navigateTo(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_20s')), 20000)),
    ])
    log(`navigateTo ${p} → OK ${page && page.path} ${Date.now() - t0}ms`)
  } catch (e) {
    let cur = ''
    try { const c = await mini.currentPage(); cur = c && c.path } catch (e2) {}
    log(`navigateTo ${p} → FAIL ${e.message} ${Date.now() - t0}ms 当前=${cur}`)
  }
  await wait(1000)
}

process.exit(0)
