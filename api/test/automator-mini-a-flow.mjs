// mini-a 黄金链路：首页 → 详情 → 报名 → 支付(MOCK) → 订单详情 → 核销码
import automator from 'miniprogram-automator'
import path from 'node:path'

const log = (...a) => console.log('[flow]', ...a)
const shot = async (mini, name) => { await mini.screenshot({ path: path.join('./automator-shots', name + '.png') }); log('截图', name) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
let mini = null
// 冷启动时自动化端口可能要 30s+ 才真正可用，重试预算给足 40s
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) }
  catch (e) { log('等待自动化通道…', i + 1); await new Promise((r) => setTimeout(r, 1000)) }
}
if (!mini) { console.error('无法连接自动化端口 ' + WS); process.exit(1) }
mini.on('console', (msg) => log('[console]', msg.type, msg.args && msg.args.join(' ')))

// 冷启动时模拟器可能还没有活动页面；此时 reLaunch 会让自动化会话崩掉。等条件，不等时间。
for (let i = 0; i < 60; i++) {
  try {
    const p = await mini.currentPage()
    if (p && p.path) { log('模拟器就绪:', p.path); break }
  } catch (e) { /* 还没起来，继续等 */ }
  if (i % 10 === 0) log('等待模拟器出首屏…', i + 1)
  await new Promise((r) => setTimeout(r, 1000))
}

// 首页 → 点第一条线路
let page = await mini.reLaunch('/pages/home/index')
await wait(2000)
const item = await page.$('.tour-item')
if (!item) { console.error('首页无卡片'); process.exit(1) }
await item.tap()
await wait(2200)
await shot(mini, 'flow-detail')

// 立即报名（提交下单 + MOCK 支付）
page = await mini.currentPage()
const btn = await page.$('.btn')
if (btn) {
  await btn.tap()
  log('已点击立即报名')
  await wait(4500)
  page = await mini.currentPage()
  log('当前页面:', page.path)
  const d = await page.data()
  log('页面数据:', JSON.stringify({ fallback: d.fallback, loading: d.loading, sel: d.sel, qty: d.qty }).slice(0, 200))
  await shot(mini, 'flow-pay-result')
}

// 查看核销码：支付结果页若给了按钮，否则走订单列表
page = await mini.currentPage()
let target = null
for (const el of await page.$$('.btn')) {
  const t = await el.text()
  if (t.includes('核销码')) { target = el; break }
}
if (target) {
  await target.tap()
  await wait(2000)
  // 订单列表 → 点第一单
  page = await mini.currentPage()
  const oi = await page.$('.tour-item')
  if (oi) {
    await oi.tap()
    await wait(2000)
    await shot(mini, 'flow-order-detail')
    // 订单详情 → 点凭证
    page = await mini.currentPage()
    const pr = await page.$('.pass-row')
    if (pr) {
      await pr.tap()
      await wait(2500)
      await shot(mini, 'flow-pass-code')
    } else log('订单详情无凭证行（可能未出票）')
  }
} else log('支付结果页无核销码按钮（状态未到 30）')

log('FLOW DONE')
process.exit(0)
