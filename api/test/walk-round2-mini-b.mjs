// 二轮走查 · mini-b 商户端（项2 视觉证据 + 项6 三态抽查）：店长 / 核销员各一套。
// 前置：隔离服务 + walk-round2-fixtures.mjs；mini-b 副本（appid 借 mini-a 真实号，仅本机模拟器）已 cli auto --auto-port 9422。
// 运行：node --env-file=<隔离env> test/walk-round2-mini-b.mjs <截图输出目录>
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/walk-round2-mini-b.mjs')
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + process.env.PORT)
const OUT = process.argv[2] || './walk-round2-shots-b'; fs.mkdirSync(OUT, { recursive: true })
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
const setApiBase = async (url) => { await mini.evaluate(new Function('getApp().globalData.apiBase = ' + JSON.stringify(url))) }

let n = 0
const shot = async (page, role, state, wait = 1600) => {
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${role}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(${role}/${state})`)
  return f
}
const shotError = async (page, role, state, wait = 1800) => {
  await setApiBase('http://127.0.0.1:9')
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${role}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(error)`)
  await setApiBase(BASE)
  return f
}

const boss = await mLogin('mock-chenjie', 1)   // 店长（role 2，门店 1 安麓大夫第）
const verifier = await mLogin('mock-verify1', 1) // 核销员（role 1，门店 1）
console.log('店长 role =', boss.role, '；核销员 role =', verifier.role, '；门店 =', boss.merchant?.name)

// ===== 店长一套 =====
await asStaff(boss)
await shot('/pages/index/index', 'manager', 'workbench')          // B-01 首屏门店岗位 + B-03 导航
await shot('/pages/orders/index', 'manager', 'orders')            // 订单列表（有数据）
await shot('/pages/supply/index', 'manager', 'supply')            // 库存
await shot('/pages/settlement/index', 'manager', 'settlement')    // 结算
await shot('/pages/reviews/index', 'manager', 'reviews')          // B-02 评价页（含演示评价）
await shot('/pages/honor/index', 'manager', 'honor')              // 荣誉
await shot('/pages/me/index', 'manager', 'me')                    // R-05 岗位卡入口 / B-04 门店码入口
// R-05 岗位卡展开 + B-04 门店码弹窗（页面 handler）
await mini.reLaunch('/pages/me/index'); await sleep(1200)
try { await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; p.toggleRoleGuide && p.toggleRoleGuide()')); await sleep(800) } catch (e) { console.log('岗位卡展开失败', e.message) }
await shot('/pages/me/index', 'manager', 'role-guide')
await mini.reLaunch('/pages/me/index'); await sleep(1200)
try { await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; p.storeQrcode && p.storeQrcode()')); await sleep(1400) } catch (e) { console.log('门店码触发失败', e.message) }
await shot('/pages/me/index', 'manager', 'store-code-dialog')     // B-04 弹窗文案
// 评价页回复（B-02：能回复）——对第一条待回复评价点回复，弹窗确认截图后取消
await mini.reLaunch('/pages/reviews/index'); await sleep(1600)
try { await mini.evaluate(new Function('const p = getCurrentPages().slice(-1)[0]; const b = p.data.items && p.data.items[0]; if (b) wx.showModal({ title: "回复评价", editable: true, placeholderText: "回复内容（2-200字）", success: () => {} })')); await sleep(1000) } catch (e) { console.log('回复弹窗失败', e.message) }
await shot('/pages/reviews/index', 'manager', 'reply-dialog')

// ===== 核销员一套 =====
await asStaff(verifier)
await shot('/pages/index/index', 'verifier', 'workbench')         // 核销员工作台（A-33：仅工作台+我的）
await shot('/pages/orders/index', 'verifier', 'orders')
await shot('/pages/supply/index', 'verifier', 'supply-readonly')  // 只读文案
await shot('/pages/verify/index', 'verifier', 'verify')           // 核销页
await shot('/pages/me/index', 'verifier', 'me')

// ===== 项6 三态抽查（店长身份）=====
await asStaff(boss)
await shotError('/pages/index/index', 'manager', 'error')
await shotError('/pages/orders/index', 'manager', 'error')
await shotError('/pages/reviews/index', 'manager', 'error')

await mini.disconnect()
console.log(`完成 ${n} 张截图 → ${OUT}`)
