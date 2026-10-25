// 真实 UI 端到端（全模拟器身份，跨端闭环）：
// mini-a 下单支付 → 凭证码页读取展示码 → mini-b 商户绑店+手输核销(30→40) → 系统完成(→50) → mini-a 写评价
import automator from 'miniprogram-automator'
import path from 'node:path'
const log = (...a) => console.log('[ui2]', ...a)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:8080'
const shot = async (mini, dir, name) => { await mini.screenshot({ path: path.join(dir, name + '.png') }); log('截图', name) }
const http = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json(); if (j.code !== 0) throw new Error(p + ' -> ' + j.code + ' ' + j.msg); return j.data
}

// ===== mini-a：游客 UI 下单 =====
const A = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
let page = await A.reLaunch('/pages/home/index')
await wait(2200)
page = await A.currentPage()
const item = await page.$('.tour-item')
await item.tap()
await wait(2200)
page = await A.currentPage()
const submitBtn = await page.$('.btn')
await submitBtn.tap()
log('已点立即报名（MOCK 支付自动回调）')
await wait(4000)
page = await A.currentPage()
if (!page.path.includes('pay-result')) throw new Error('未跳转支付结果页: ' + page.path)
const pd = await page.data()
const orderNo = pd.orderNo
log('支付结果页 · 订单号', orderNo)
await shot(A, './automator-shots', 'x1-pay-result')

// 进凭证码页读取展示码（游客"出示"屏幕）
page = await A.navigateTo('/package-order/pages/orders/index')
await wait(2000)
page = await A.currentPage()
let firstOrder = null
for (let i = 0; i < 6 && !firstOrder; i++) {
  firstOrder = await page.$('.tour-item')
  if (!firstOrder) { await wait(1200); page = await A.currentPage() }
}
await firstOrder.tap()
await wait(2000)
page = await A.currentPage()
const passRow = await page.$('.pass-row')
if (!passRow) throw new Error('订单详情无凭证行')
await passRow.tap()
await wait(2500)
page = await A.currentPage()
if (!page.path.includes('pass-code')) throw new Error('未进入核销码页: ' + page.path)
const codeData = await page.data()
const display = codeData.code && codeData.code.display
if (!display) throw new Error('未读到展示码')
log('从游客屏幕读到展示码', display)
await shot(A, './automator-shots', 'x2-pass-code')

// ===== mini-b：商户绑店 + 手输核销 =====
const B = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' })
page = await B.reLaunch('/pages/me/index')
await wait(1800)
const midInput = await page.$('input')
if (midInput) { await midInput.input('1'); await wait(300); const btn = await page.$('.btn'); if (btn) await btn.tap(); await wait(1500) }
page = await B.reLaunch('/pages/index/index')
await wait(2200)
await shot(B, './automator-shots-b', 'x3-workbench')
page = await B.navigateTo('/pages/verify/index')
await wait(1600)
const codeInput = await page.$('input')
await codeInput.input(display)
await wait(300)
const btns = await page.$$('.btn')
for (const b of btns) { if ((await b.text()).includes('核销')) { await b.tap(); break } }
await wait(2200)
const vd = await page.data()
log('商户核销:', vd.result && vd.result.ok ? '✅ 成功（30→40）' : '❌ ' + (vd.result && vd.result.reason), '连续核销', vd.streak, '单')
await shot(B, './automator-shots-b', 'x4-verify-success')
await B.disconnect()

// ===== 系统完成观察期 → 50 =====
const admin = await http('POST', '/admin/login', { username: 'admin', password: 'admin123' })
await http('POST', '/admin/dev/complete', { orderNo }, admin.token)
log('观察期完成 → 订单 50（游客可评价）')

// ===== mini-a：写评价（真实 UI）=====
page = await A.navigateTo('/package-order/pages/orders/index')
await wait(2000)
page = await A.currentPage()
firstOrder = await page.$('.tour-item')
await firstOrder.tap()
await wait(2000)
page = await A.currentPage()
let stars = []
for (let i = 0; i < 6 && !stars.length; i++) {
  await wait(1200)
  page = await A.currentPage()
  const dd = await page.data()
  if (dd.o) log('详情: status=' + dd.o.status, 'reviewed=' + dd.o.reviewed)
  stars = await page.$$('.pick-star')
}
if (!stars.length) throw new Error('评价卡未出现')
await stars[3].tap() // 4 星
const ta = await page.$('.rv-input')
await ta.input('核销很顺畅，领队专业，动态码全程不掉线，体验加分！')
await wait(300)
const btns2 = await page.$$('.btn.sm')
for (const b of btns2) { if ((await b.text()).includes('提交')) { await b.tap(); break } }
await wait(2200)
const dd2 = await page.data()
log('游客评价:', dd2.reviewDone || dd2.o.reviewed ? '✅ 已评价' : '❌ 未生效')
await shot(A, './automator-shots', 'x5-review-done')
await A.disconnect()
log('UI E2E ALL DONE')
process.exit(0)
