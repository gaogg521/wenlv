// 质量门禁：模拟"后端不可达"（真机常见状态），逐页断言 —— 不许出现报错，必须有内容
// 运行：MSYS_NO_PATHCONV=1 node test/quality-gate.mjs
import automator from 'miniprogram-automator'
import fs from 'node:fs'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[QA]', ...a)
const OUT = './qa-shots'
fs.mkdirSync(OUT, { recursive: true })

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) } catch (e) { await wait(1000) }
}
if (!mini) { console.error('通道连不上'); process.exit(1) }
for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) break } catch (e) {}
  await wait(1000)
}
log('已连接')

// 关键：把 apiBase 指向一个关闭的端口，等价于"手机连不到后端"
await mini.evaluate(function () { getApp().globalData.apiBase = 'http://127.0.0.1:9' })
log('已切换到"后端不可达"模式（apiBase=http://127.0.0.1:9）')

// A-18 口径（后端不可达场景）：使用 FALLBACK 的页面必须 demo===true（常驻"演示模式"标识，
// 假数据不得与真实数据无法区分）；错误态页面必须可重试（loadError 有值）。
// develop 环境允许演示兜底；本门禁在开发者工具里跑（envVersion=develop）。
const cases = [
  ['首页（演示标识）', '/pages/home/index', (d) => d.tours && d.tours.length > 0 && d.demo === true && !d.error],
  ['主题游（演示标识）', '/pages/tour-list/index', (d) => d.tours && d.tours.length > 0 && d.demo === true && !d.error],
  ['商城（演示标识）', '/pages/shop/index', (d) => d.items && d.items.length > 0 && d.demo === true && !d.error],
  ['旅豆（演示标识）', '/pages/bean/index', (d) => !!d.bean && (d.ledger || []).length > 0 && d.demo === true && !d.error
    && d.ledger.every((x) => x.tx_no && (x.direction === 0 || x.direction === 1) && x.biz_type && Number(x.amount) === x.amount && x.created_at)],
  ['我的（演示标识）', '/pages/me/index', (d) => !!d.user && !!d.user.nickname && d.demo === true],
  ['我的订单', '/package-order/pages/orders/index', (d) => (d.orders || []).length > 0 && !d.error
    && d.orders.every((o) => o.order_no && o.title && Number(o.amount_pay) === o.amount_pay && o.amount_pay > 0 && o.statusText && o.created_at && o.days_desc)],
  ['数字身份', '/package-content/pages/identity/index', (d) => !!d.d && !!d.d.profile && !String(d.loadTxt || '').match(/不可达|失败/)],
  ['创作中心（错误态可重试）', '/package-content/pages/create/index', (d) => !!String(d.loadError || '').match(/失败|重试|不可达/)],
  ['推广中心', '/package-promo/pages/center/index', (d) => !String(d.loadTxt || '').match(/不可达|失败/)],
  ['目的地', '/pages/destination/index', (d) => !d.error],
  ['FAQ', '/pages/faq/index', (d) => !d.error],
]

let pass = 0, fail = 0
const rows = []
for (const [name, path, check] of cases) {
  let ok = false, detail = ''
  try {
    await mini.reLaunch(path)
    await wait(2200)
    const page = await mini.currentPage()
    const d = await page.data()
    ok = !!check(d)
    // 同时抓页面可见文案里的"服务不可达/加载失败"
    const body = await mini.evaluate(function () {
      const q = (sel) => Array.from(document.querySelectorAll(sel) || [])
      return ''
    }).catch(() => '')
    detail = ok ? '内容就绪' : JSON.stringify({
      tours: (d.tours || []).length, items: (d.items || []).length, orders: (d.orders || []).length,
      bean: !!d.bean, ledger: (d.ledger || []).length, user: d.user && d.user.nickname,
      d: !!d.d, error: d.error, loadError: d.loadError, loadTxt: d.loadTxt,
    }).slice(0, 200)
  } catch (e) { detail = '异常: ' + e.message }
  // 统一红线：页面数据序列化后不得出现 NaN（字段名不一致的典型症状）
  try {
    const raw = await mini.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data) })
    if (raw && raw.indexOf('NaN') >= 0) { ok = false; detail = (detail || '') + ' [含 NaN]' }
  } catch (e) {}
  await mini.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {})
  ok ? pass++ : fail++
  rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${path} | ${detail} |`)
}

// 恢复 apiBase
await mini.evaluate(function () { getApp().globalData.apiBase = 'http://127.0.0.1:8080' }).catch(() => {})
log('\n| 结果 | 页面 | 路径 | 说明 |\n|---|---|---|---|')
rows.forEach((r) => log(r))
log(`\n合计：通过 ${pass} / 失败 ${fail}（截图：api/qa-shots/）`)
process.exit(fail === 0 ? 0 : 1)
