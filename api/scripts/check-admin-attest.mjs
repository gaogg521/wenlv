// 后台页面离线渲染检查（不开浏览器、不登录）：
// 用桩接管 DOM/fetch，把 admin/app.js 里的页面函数真跑一遍，断言关键字段都渲染出来、没有 undefined / NaN 泄漏。
// 这比"语法通过"强：模板里少一个字段、数组没判空、字段名写错，都会在这里炸出来。
// 用法：node scripts/check-admin-attest.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const API = process.env.API_BASE || 'http://127.0.0.1:8080'

// ── 1. 拿一个真后台 token（走真接口，保证 fixture 是真数据） ──
const login = await fetch(`${API}/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' }),
}).then((r) => r.json())
if (!login.data?.token) { console.error('登录失败：', login.msg); process.exit(1) }
const token = login.data.token

// ── 2. DOM 桩：记录最后一次 innerHTML ──
const store = { html: '' }
const el = () => ({
  set innerHTML(v) { store.html = v }, get innerHTML() { return store.html },
  textContent: '', value: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } },
  style: {}, appendChild() {}, addEventListener() {}, focus() {},
})
const documentStub = {
  querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(),
  createElement: () => el(), body: el(), addEventListener() {},
}
const localStorageStub = {
  _m: { admin_token: token, admin_me: JSON.stringify(login.data.user || { name: 'admin' }) },
  getItem(k) { return this._m[k] ?? null }, setItem(k, v) { this._m[k] = v }, removeItem(k) { delete this._m[k] }, clear() { this._m = {} },
}
const locationStub = { hash: '', reload() {}, replace() {}, href: '', search: '' }
const fetchStub = (url, opt) => fetch(String(url).startsWith('http') ? url : API + url, opt)

// ── 3. 在沙箱里执行 admin/app.js，取出页面函数 ──
const src = fs.readFileSync(path.join(ROOT, 'admin', 'app.js'), 'utf8')
const sandbox = new Function(
  'document', 'localStorage', 'location', 'fetch', 'window', 'navigator', 'alert', 'prompt', 'confirm', 'setTimeout',
  `${src}\n;return { attest, web3dash, pointassets, badges, wallets, vcPage, chainAssetsPage, contract, go }`)

let ctx
try {
  ctx = sandbox(documentStub, localStorageStub, locationStub, fetchStub,
    { addEventListener() {}, matchMedia: () => ({ matches: false }) }, { userAgent: 'node' },
    () => {}, () => null, () => true, (fn) => fn())
} catch (e) {
  console.error('执行 admin/app.js 失败：', e.message)
  process.exit(1)
}

let pass = 0
let fail = 0
const check = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  PASS ', msg) }
  else { fail++; console.log('  FAIL ', msg, extra === undefined ? '' : JSON.stringify(String(extra).slice(0, 300))) }
}

const bad = (h) => /undefined|NaN|\[object Object\]/.test(h)

console.log('== 页面渲染（真实接口数据）==')
for (const page of ['attest', 'web3dash', 'pointassets', 'badges', 'wallets', 'vcPage', 'chainAssetsPage', 'contract']) {
  store.html = ''
  try {
    await ctx[page]()
  } catch (e) {
    check(false, `${page} 渲染无异常`, e.message)
    continue
  }
  const h = store.html
  check(h.length > 500, `${page} 输出了内容（${(h.length / 1024).toFixed(1)} KB）`, h.length)
  check(!bad(h), `${page} 无 undefined / NaN / [object Object] 泄漏`)
}

console.log('== 存证中心关键内容 ==')
store.html = ''
await ctx.attest()
const h = store.html
check(h.includes('存证批次'), '有「存证批次」区块')
check(h.includes('链起点') || h.includes('前根'), '展示前根/链起点语义')
check(h.includes('旅豆账本日终封存'), '有「旅豆账本日终封存」区块')
check(h.includes('已打包·待锚定') || h.includes('已锚定'), '状态文案正确（待锚定 / 已锚定）')
check(!h.includes('已上链'), 'NOOP 期不出现「已上链」')
check(h.includes('runJob(\'attest-pack\',\'attest\')'), '打包按钮会停留在本页（不跳运维控制台）')
check(h.includes('/open/report/bean-day/'), '日终表带「证明 PDF」下载入口')
check(h.includes('/verify?date='), '日终表带「公开复核」入口')

console.log('== 单号验证面板（接口侧证据）==')
const sample = await fetch(`${API}/admin/attest/center`, { headers: { authorization: 'Bearer ' + token } })
  .then((r) => r.json()).then((j) => (j.data.recent || []).find((x) => x.biz_type === 'order')?.biz_ref)
if (sample) {
  const v = await fetch(`${API}/admin/attest/verify?bizType=order&bizRef=${encodeURIComponent(sample)}`, {
    headers: { authorization: 'Bearer ' + token },
  }).then((r) => r.json())
  check(v.data?.proofValid === true, `单号 ${sample} 的 proof 自检通过`, v.data?.note)
  check(Array.isArray(v.data?.leafPath) && v.data.leafPath.length > 0, '返回含 leafPath（页面据此显示"本地重算通过"）')
  check(!!v.data?.prevRoot || v.data?.batchSeq === 1, '前根有值，或本批就是链起点')
} else {
  check(false, '库里没有已打包的订单事件（先跑 npm run e2e 或 test/web3-integrity.mjs）')
}

console.log(`\nADMIN RENDER: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
