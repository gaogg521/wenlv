// M-11 证据 · mini-a 游客端截图（T-01 订单分页/旅豆流水查看更多 + T-03 订单详情复制/客服/再次预订），隔离库 390px。
// 前置：隔离服务 18240 + mn-walk/mini-a 副本已 cli auto --auto-port 9421；
//       库内夹具：游客 mock-openid-mn-tour55 有 55 单（scripts/mn-fixtures.sql，截图前插入；test:db 结束后执行避免污染选单断言）。
// 运行：DB_NAME=wanderlust_qa_mn PORT=18240 API_BASE=http://127.0.0.1:18240 node test/walk-mn-mini-a.mjs <输出目录>
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/walk-mn-mini-a.mjs')
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + process.env.PORT)
const OUT = process.argv[2] || './walk-mn-shots-a'; fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()

const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
console.log('已连接 mini-a 模拟器；windowWidth =', (await mini.systemInfo()).windowWidth)
await sleep(4000)
for (let i = 0; i < 3; i++) {
  try { await mini.reLaunch('/pages/home/index'); break } catch (e) { console.log('首屏重试', i + 1, String(e.message).slice(0, 60)); await sleep(4000) }
}
await sleep(1500)

// 55 单游客登录态（真实登录接口拿 token，注入 storage 与 globalData）
const t = (await api('POST', '/c/auth/login', { code: 'mock-mn-tour55' })).data
await mini.callWxMethod('setStorageSync', 'token', t.token)
await mini.evaluate(new Function('const a = getApp().globalData; a.token = ' + JSON.stringify(t.token)))
console.log('游客登录 ok，uid =', t.user.id)

let n = 0
const shot = async (page, tag, wait = 2000) => {
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${tag}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page)
}
const callPage = async (expr) => {
  await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; (' + expr + ')(p)'))
}

// T-01：订单列表分页（55 单 → 总数提示 + 触底加载）
await shot('/package-order/pages/orders/index', 'orders-page1', 2200)
await callPage('p => p.onReachBottom && p.onReachBottom()')
await shot('/package-order/pages/orders/index', 'orders-page2-loadmore', 1800)
// T-01：旅豆流水查看更多
await shot('/pages/bean/index', 'bean-ledger-more', 2400)
// T-03：订单详情（复制单号 / 联系客服 / 再次预订）——取一单已完成的夹具单
const no = (await api('GET', '/c/orders?page=1&pageSize=1', null, t.token)).data.items[0].order_no
await shot('/package-order/pages/order-detail/index?no=' + no, 'order-detail-t03', 2400)
// 分享（T-05）：笔记广场（带 onShareAppMessage 的页面可直接截顶部转发入口状态不直观——以页面正常渲染 + js 断言为准，截图记录页面）
await shot('/package-content/pages/square/index', 'square-t06', 2200)

await mini.disconnect()
console.log(`完成 ${n} 张截图 → ${OUT}`)
