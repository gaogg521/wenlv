// 二轮走查 · mini-a 六页三态截图（项1）：无资格 / 暂无数据 / 加载失败。
// 前置（同 automator-cross-end.mjs）：
//   1) 隔离库 + 隔离服务已 migrate + seed:scenario + test/walk-round2-fixtures.mjs；
//   2) mini-a 副本 app.js 的 API_BASE_DEV 指向隔离服务端口；
//   3) cli auto --project <副本> --auto-port 9421 后运行本脚本：
//      node --env-file=<隔离env> test/walk-round2-mini-a.mjs <截图输出目录>
// 每页三态：denied（纯游客）/ empty（对应资格但无数据）/ error（临时把 apiBase 指向不通端口再 reLaunch）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/walk-round2-mini-a.mjs')
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + process.env.PORT)
const OUT = process.argv[2] || './walk-round2-shots'; fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()

const login = async (code) => (await api('POST', '/c/auth/login', { code })).data?.token
const T = { pure: await login('mock-pure1'), promo: await login('mock-promo1'), coop: await login('mock-coop1') }

const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
console.log('已连接模拟器；systemInfo.windowWidth =', (await mini.systemInfo()).windowWidth)
// 冷启动等首屏就绪再 reLaunch（手册坑：首屏未出时 reLaunch 会崩会话）
await sleep(4000)
for (let i = 0; i < 3; i++) {
  try { await mini.reLaunch('/pages/home/index'); break } catch (e) { console.log('首屏重试', i + 1, String(e.message).slice(0, 60)); await sleep(4000) }
}
await sleep(1500)

// 注意：本版本 automator 的 evaluate 带参调用会挂死（探针验证：无参/源码烘焙均正常）——
// 所有需要传值的 evaluate 一律用 new Function 把值烘焙进函数源码，不使用 evaluate(fn, ...args)。
const as = async (tok) => {
  await mini.callWxMethod('setStorageSync', 'token', tok)
  await mini.evaluate(new Function('getApp().globalData.token = ' + JSON.stringify(tok)))
}
const setApiBase = async (url) => { await mini.evaluate(new Function('getApp().globalData.apiBase = ' + JSON.stringify(url))) }
// 调用页面 handler：合成事件对象（handler 读取 e.currentTarget.dataset）
const callPage = (method, dataset) => mini.evaluate(new Function(
  'const p = getCurrentPages().slice(-1)[0]; const m = ' + JSON.stringify(method) +
  '; return p[m] ? (p[m]({ currentTarget: { dataset: ' + JSON.stringify(dataset || {}) + ' } }), "ok") : "no method " + m'))

let n = 0
const shot = async (page, account, state, wait = 1200) => {
  await as(T[account])
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${account}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(${account}/${state})`)
  return f
}
// 错误态：断 apiBase → reLaunch → 页面请求失败；截图后恢复
const shotError = async (page, account, state, wait = 1800) => {
  await as(T[account])
  await setApiBase('http://127.0.0.1:9')
  await mini.reLaunch(page)
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${account}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(error)`)
  await setApiBase(BASE)
  return f
}
// tab 内空态：先 as，再 reLaunch 页面并切到指定分段
const shotSeg = async (page, account, state, seg, wait = 1400) => {
  await as(T[account])
  await mini.reLaunch(page)
  await sleep(1000)
  await callPage('switchSeg', { k: seg })
  await sleep(wait)
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${account}-${state}.png`)
  await mini.screenshot({ path: f })
  console.log('📸', path.basename(f), page, `(${account}/${state} seg=${seg})`)
  return f
}

const CENTER = '/package-promo/pages/center/index'
const PRODUCTS = '/package-promo/pages/products/index'
const RECORDS = '/package-promo/pages/records/index?kind=commissions'
const WORK = '/package-promo/pages/work/index'
const FREEDOM = '/package-promo/pages/freedom/index'
const NOTES = '/pages/notes/index'

// ---- 推广中心：denied / ready(空客记录) / error ----
await shot(CENTER, 'pure', 'denied')
await shot(CENTER, 'promo', 'ready')
await shotSeg(CENTER, 'promo', 'empty-cust', 'cust')
await shotError(CENTER, 'pure', 'error')
// ---- 可推广产品：denied / empty / error ----
await shot(PRODUCTS, 'pure', 'denied')
await shot(PRODUCTS, 'promo', 'empty')
await shotError(PRODUCTS, 'promo', 'error')
// ---- 佣金明细：denied / empty / error ----
await shot(RECORDS, 'pure', 'denied')
await shot(RECORDS, 'promo', 'empty')
await shotError(RECORDS, 'promo', 'error')
// ---- 合作中心：denied / empty(主体无分润) / error ----
await shot(WORK, 'pure', 'denied')
await shot(WORK, 'coop', 'empty-profit')
await shotError(WORK, 'coop', 'error')
// ---- 自由豆：empty(可用) / error（无资格态：自由豆对所有登录游客开放，不适用）----
await shot(FREEDOM, 'pure', 'empty-available')
await shotError(FREEDOM, 'pure', 'error')
// ---- 笔记：empty 或 data（取决于夹具库是否有公开笔记）/ error ----
await shot(NOTES, 'pure', 'empty-or-data')
await shotError(NOTES, 'pure', 'error')

await mini.disconnect()
console.log(`完成 ${n} 张截图 → ${OUT}`)
