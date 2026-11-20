// M-11 证据 · mini-b 商户端三套截图（老板/店长/核销员），隔离库 + 模拟器 390px。
// 前置：隔离服务 18240 + mn-walk/mini-b 副本（appid 借 mini-a，apiBase=18240）已 cli auto --auto-port 9422；
//       库内夹具：门店1 老板=mock-mn-boss-fix / 店长=mock-chenjie（seed）/ 核销员=mock-mn-verify-fix（见 scripts/mn-fixtures.sql）。
// 运行：DB_NAME=wanderlust_qa_mn PORT=18240 API_BASE=http://127.0.0.1:18240 node test/walk-mn-mini-b.mjs <输出目录>
// 全部弹窗来自真实代码路径（confirmPriceChange / staffApply / toggleNotifyPanel 直调），无摆拍。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/walk-mn-mini-b.mjs')
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + process.env.PORT)
const OUT = process.argv[2] || './walk-mn-shots-b'; fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const mLogin = async (code, merchantId) => (await api('POST', '/m/auth/login', { code, merchantId })).data

const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' })
console.log('已连接 mini-b 模拟器；windowWidth =', (await mini.systemInfo()).windowWidth)
await sleep(4000)
for (let i = 0; i < 3; i++) {
  try { await mini.reLaunch('/pages/index/index'); break } catch (e) { console.log('首屏重试', i + 1, String(e.message).slice(0, 60)); await sleep(4000) }
}
await sleep(1500)

const asStaff = async (loginData) => {
  await mini.callWxMethod('setStorageSync', 'mtoken', loginData.token)
  await mini.callWxMethod('setStorageSync', 'merchant', loginData.merchant || null)
  await mini.callWxMethod('setStorageSync', 'mrole', loginData.role)
  await mini.evaluate(new Function('const a = getApp().globalData; a.token = ' + JSON.stringify(loginData.token) +
    '; a.merchant = ' + JSON.stringify(loginData.merchant || null) + '; a.role = ' + String(loginData.role)))
}
let n = 0
const shot = async (page, role, state, wait = 1600) => {
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${role}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(${role}/${state})`)
}
const shotKeep = async (role, state, wait = 800) => {
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${role}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), `(current/${state})`)
}
// 直调页面方法（automator evaluate 带参会挂，用 new Function 烘焙）
const callPage = async (expr) => {
  await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; (' + expr + ')(p)'))
}
// 等页面数据就绪（如 supply 的 groups 加载完）
const waitFor = async (expr, timeout = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; return !!(' + expr + ')')).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

const boss = await mLogin('mock-mn-boss-fix', 1)     // 老板（role 3，门店 1）
const manager = await mLogin('mock-chenjie', 1)      // 店长（role 2，门店 1，seed）
const verifier = await mLogin('mock-mn-verify-fix', 1) // 核销员（role 1，门店 1）
console.log('老板 role =', boss.role, '；店长 role =', manager.role, '；核销员 role =', verifier.role)
// 引导未确认状态（onboarded=0），保证「首次引导」可拍
await api('POST', '/m/notify/prefs', { onboarded: false }, manager.token).catch(() => {})

// ===== 店长一套 =====
await asStaff(manager)
await shot('/pages/index/index', 'manager', 'workbench-guide', 2600)  // M-02：首次引导（真实 showModal）
// 引导拍完即落库 onboarded，下一张才能拍到干净的状态条（原生弹窗没有自动化点击通道）
await api('POST', '/m/notify/prefs', { onboarded: true }, manager.token).catch(() => {})
await shot('/pages/index/index', 'manager', 'workbench-statusbar', 2400) // M-09 状态条 + M-02 轮询
await shot('/pages/me/index', 'manager', 'me', 1800)
await callPage('p => p.toggleNotifyPanel && p.toggleNotifyPanel()')
await shotKeep('manager', 'me-notify-panel', 900)                     // M-02：三开关 + 状态（模板未接入=未接入态）
await shot('/pages/supply/index', 'manager', 'supply', 2200)
// 大幅改价：真实 confirmPriceChange（±30% → needReason 弹窗），拍完取消不提交（等 list 加载完再调）
await waitFor('p.data.list && p.data.list.length')
await callPage(`p => {
  const s = p.data.list[0]
  p.setData({ expandedKey: String(s.product_id), sessionLimit: 24 })
  p.applyFilters()
  setTimeout(() => p.confirmPriceChange(s.id, s.version, s.price_adult, String(Math.round(s.price_adult / 100 * 0.5))), 200)
}`)
await shotKeep('manager', 'supply-price-confirm-reason', 1200)        // M-12：改价确认（旧→新 + 必填原因）
await shot('/pages/supply/index', 'manager', 'supply-pricechange', 2200) // M-07 最近改价行（若上一弹窗未提交则显示原价）

// ===== 老板一套 =====
await asStaff(boss)
await shot('/pages/index/index', 'boss', 'workbench', 2400)
await shot('/pages/me/index', 'boss', 'me', 1800)
await callPage('p => p.toggleNotifyPanel && p.toggleNotifyPanel()')
await shotKeep('boss', 'me-notify-panel-on', 900)                     // M-02：老板默认全开
await callPage('p => p.fetchStaff && p.fetchStaff()')
await shotKeep('boss', 'me-staff-list', 1000)                         // M-06：加入时间
await callPage(`p => {
  const s = (p.data.staff || []).find(x => Number(x.role) === 1 && Number(x.status) === 1) || (p.data.staff || []).find(x => Number(x.role) === 2)
  if (s) p.staffApply(s, s.role === 1 ? 1 : 0)                        // 真实 staffApply → 「确认改岗」弹窗
}`)
await shotKeep('boss', 'me-staff-change-confirm', 1200)               // M-12/M-06：改岗确认（旧→新）
await callPage(`p => {
  const b = (p.data.staff || []).find(x => Number(x.role) === 1 && Number(x.status) === 1)
  if (b) p.staffApply(b, 2)                                           // 在职核销员 → 停用（A+ 必填原因）
}`)
await shotKeep('boss', 'me-staff-disable-reason', 1200)               // A+：停用必填原因

// ===== 核销员一套 =====
await asStaff(verifier)
await shot('/pages/index/index', 'verifier', 'workbench', 2200)
await shot('/pages/supply/index', 'verifier', 'supply-readonly', 2200) // 只读/无权限态
await shot('/pages/me/index', 'verifier', 'me', 1800)
await callPage('p => p.toggleNotifyPanel && p.toggleNotifyPanel()')
await shotKeep('verifier', 'me-notify-panel-off', 900)                 // M-02：核销员默认关

await mini.disconnect()
console.log(`完成 ${n} 张截图 → ${OUT}`)
