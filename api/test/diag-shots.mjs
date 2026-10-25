// 诊断 4：导航后立即截图，看屏幕真实状态（区分“没打开”/“打开了但白屏”/“报错页”）
// 运行：MSYS_NO_PATHCONV=1 node test/diag-shots.mjs
import automator from 'miniprogram-automator'
import fs from 'node:fs'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[diag4]', ...a)
fs.mkdirSync('./diag-shots', { recursive: true })

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('连不上'); process.exit(1) }
mini.on('console', (m) => log('[console]', m.type, (m.args || []).join(' ')))
mini.on('exception', (e) => log('[exception]', JSON.stringify(e).slice(0, 400)))
for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}

const cases = [
  ['promo', '/package-promo/pages/center/index'],
  ['identity', '/package-content/pages/identity/index'],
  ['create', '/package-content/pages/create/index'],
]

for (const [name, path] of cases) {
  let nav = ''
  try {
    await mini.evaluate(function (p) {
      globalThis.__n = 'pending'
      wx.navigateTo({
        url: p,
        success: () => { globalThis.__n = 'NAV OK' },
        fail: (e) => { globalThis.__n = 'NAV FAIL: ' + (e && e.errMsg) },
      })
    }, path)
  } catch (e) { nav = 'evaluate 失败: ' + e.message }
  await wait(3000)
  try { nav = await mini.evaluate(() => globalThis.__n) } catch (e) {}
  let cur = ''
  try { const c = await mini.currentPage(); cur = c && c.path } catch (e) { cur = '(currentPage 超时)' }
  try { await mini.screenshot({ path: `./diag-shots/${name}.png` }) } catch (e) { log('截图失败', name, e.message) }
  log(`${name}: nav=${nav}  当前页=${cur}  截图=diag-shots/${name}.png`)

  // 回到首页再下一个，避免栈叠加
  try { await mini.reLaunch('/pages/home/index') } catch (e) { log('reLaunch 回首页失败:', e.message) }
  await wait(1500)
}

process.exit(0)
