// M-02 证据补拍：工作台 30s 轮询的新订单提示条 + 订单 tab 红点实拍（不依赖微信授权的应用内兜底）。
// 流程：店长登录 → 工作台（首轮轮询只校准基线）→ SQL 插一笔新支付订单 → 等下一次 30s 轮询 → 横幅+红点出现 → 截图。
// 运行：DB_NAME=wanderlust_qa_mn PORT=18240 API_BASE=http://127.0.0.1:18240 node test/walk-mn-banner.mjs <输出目录>
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/walk-mn-banner.mjs')
import automator from 'miniprogram-automator'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + process.env.PORT)
const OUT = process.argv[2] || './walk-mn-shots-banner'; fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()

const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' })
console.log('已连接 mini-b；windowWidth =', (await mini.systemInfo()).windowWidth)
await sleep(4000)
for (let i = 0; i < 3; i++) {
  try { await mini.reLaunch('/pages/index/index'); break } catch (e) { await sleep(4000) }
}
await sleep(1500)

const mgr = (await api('POST', '/m/auth/login', { code: 'mock-chenjie', merchantId: 1 })).data
// 引导先落库 onboarded，避免原生弹窗挡住横幅（引导弹窗另有专门截图）
await api('POST', '/m/notify/prefs', { onboarded: true }, mgr.token).catch(() => {})
await mini.callWxMethod('setStorageSync', 'mtoken', mgr.token)
await mini.callWxMethod('setStorageSync', 'merchant', mgr.merchant || null)
await mini.callWxMethod('setStorageSync', 'mrole', mgr.role)
await mini.evaluate(new Function('const a = getApp().globalData; a.token = ' + JSON.stringify(mgr.token) +
  '; a.merchant = ' + JSON.stringify(mgr.merchant || null) + '; a.role = 2'))
await mini.reLaunch('/pages/index/index')
console.log('工作台已加载，等首轮轮询校准基线（31s）…')
await sleep(31000)

// 插一笔新支付订单（隔离库演示单；base64 时间戳单号保证唯一）
const no = 'MNB' + Date.now()
execSync(`mysql -uroot -proot wanderlust_qa_mn -e "INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, city_code, status, qty, amount_goods, amount_pay, channel, paid_at) SELECT '${no}', u.id, p.id, s.id, p.merchant_id, p.city_code, 20, 1, 23800, 23800, 'main', NOW() FROM tour_product p JOIN tour_session s ON s.product_id = p.id JOIN (SELECT 2 id) u WHERE p.merchant_id = 1 AND p.status = 1 AND s.depart_date >= CURDATE() ORDER BY p.id, s.id LIMIT 1;"`, { stdio: 'ignore' })
console.log('新支付订单已插入：', no, '—— 等下一次 30s 轮询…')
await sleep(33000)

const f = path.join(OUT, 'manager-workbench-neworder-banner.png')
await mini.screenshot({ path: f })
console.log('📸 横幅截图 →', f)

// 验证轮询接口确实返回 newPaid>0（数据层旁证）
const d = await api('GET', '/m/notify/poll?after=0', null, mgr.token)
console.log('poll 直查：', JSON.stringify(d.data))
await mini.disconnect()
