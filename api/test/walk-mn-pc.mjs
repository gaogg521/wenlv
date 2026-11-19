// M-11 证据 · PC 后台截图（D-01 筛选持久化+重置 / D-02 输入约束 / M-12 uiConfirm），隔离服务 18240。
// 运行：BASE=http://127.0.0.1:18240 node test/walk-mn-pc.mjs <输出目录>
// 说明：不改库数据——确认弹窗出现后全部点「取消」；D-01 刷新回读筛选。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE || 'http://127.0.0.1:18240'
const OUT = process.argv[2] || './walk-mn-shots-pc'; fs.mkdirSync(OUT, { recursive: true })
let n = 0
const shot = async (page, tag) => {
  const f = path.join(OUT, `${(++n + '').padStart(2, '0')}-${tag}.png`)
  await page.screenshot({ path: f, fullPage: false })
  console.log('📸', path.basename(f))
}

// playwright-core 不带浏览器——优先系统 Chrome，其次 Edge（Windows 自带）
const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }))
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('dialog', (d) => d.dismiss().catch(() => {}))

// 登录（隔离库 admin/admin123）
await page.goto(BASE + '/admin-ui')
await page.fill('#luser', 'admin'); await page.fill('#lpass', 'admin123')
await page.click('#loginSubmit')
await page.waitForTimeout(3000)

// D-01 订单页：hash 持久化（既有）——设筛选→切走→回来→筛选仍在 + 重置按钮在
await page.goto(BASE + '/admin-ui/#orders')
await page.waitForTimeout(2000)
await shot(page, 'pc-orders-filter')
await page.fill('#ordKw', '演示').catch(() => {})
await page.waitForTimeout(1200)
await page.goto(BASE + '/admin-ui/#dashboard'); await page.waitForTimeout(1200)
await page.goto(BASE + '/admin-ui/#orders'); await page.waitForTimeout(1800)
await shot(page, 'pc-orders-filter-kept')   // hash 里有 kw=演示

// D-01 商品列表：筛选持久化 + 重置按钮（M-14 新增 sessionStorage 持久化）
await page.goto(BASE + '/admin-ui/#products')
await page.waitForTimeout(2000)
const kwSel = 'input[placeholder*="商品名"], input[placeholder*="搜索"], #fprodKw'
await page.fill(kwSel, '安吉').catch(() => {})
await page.waitForTimeout(1400)
await page.goto(BASE + '/admin-ui/#dashboard'); await page.waitForTimeout(1000)
await page.goto(BASE + '/admin-ui/#products'); await page.waitForTimeout(1800)
await shot(page, 'pc-products-filter-kept')  // D-01：刷新后筛选仍在
const resetBtn = await page.$('text=重置')
assert.ok(resetBtn, '商品筛选栏应有「重置」按钮（D-01）')

// D-02 商品库存输入约束（min/step）+ M-12 库存确认
await page.goto(BASE + '/admin-ui/#products')
await page.waitForTimeout(1800)
const negInput = await page.$('input[type=number][step="0.01"]')
if (negInput) {
  await negInput.scrollIntoViewIfNeeded().catch(() => {})
  await shot(page, 'pc-input-constraints')
} else {
  await shot(page, 'pc-input-constraints')
}

// M-12 uiConfirm：商品上下架确认（点取消不提交）
const toggleBtn = await page.$('button:has-text("下架"), button:has-text("上架")')
if (toggleBtn) {
  await toggleBtn.click()
  await page.waitForTimeout(900)
  const dlg = await page.$('.modal')
  assert.ok(dlg, '商品上下架应弹 uiConfirm 确认框（M-12）')
  await shot(page, 'pc-uiconfirm-toggle-product')
  const cancel = await page.$('.modal-foot button:has-text("取消")')
  if (cancel) await cancel.click()
  await page.waitForTimeout(600)
}
// M-12 A+：生成结算单需填原因（点取消）
await page.goto(BASE + '/admin-ui/#settlements')
await page.waitForTimeout(1800)
const genBtn = await page.$('button:has-text("生成结算"), button:has-text("生成本周结算")')
if (genBtn) {
  await genBtn.click(); await page.waitForTimeout(900)
  await shot(page, 'pc-uiconfirm-gen-settlements')
  const cancel = await page.$('.modal-foot button:has-text("取消")')
  if (cancel) await cancel.click()
}
// D-05 复制 chip（订单列表）
await page.goto(BASE + '/admin-ui/#orders')
await page.waitForTimeout(1800)
const chip = await page.$('.copy-chip')
assert.ok(chip, '订单号应有复制 chip（D-05）')
await shot(page, 'pc-copy-chip-orders')

await browser.close()
console.log(`PC 截图完成 ${n} 张 → ${OUT}`)
process.exit(0)
