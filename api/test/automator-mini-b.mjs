// mini-b 绑定门店 → 工作台 → 结算 全流程截图
import automator from 'miniprogram-automator'
import path from 'node:path'

const log = (...a) => console.log('[auto-b]', ...a)
const mini = await automator.connect({ wsEndpoint: process.env.AUTO_WS || 'ws://127.0.0.1:9422' })

// 1. 我的 → 输门店 ID → 绑定
let page = await mini.reLaunch('/pages/me/index')
await new Promise((r) => setTimeout(r, 2000))
page = await mini.currentPage()
const input = await page.$('input')
if (input) {
  await input.input('1')
  await new Promise((r) => setTimeout(r, 300))
  const btn = await page.$('.btn')
  if (btn) { await btn.tap(); log('点击绑定按钮') }
  await new Promise((r) => setTimeout(r, 1800))
  log('已绑定门店 1')
} else { log('me 页未找到输入框（可能已登录）') }
// 2. 工作台
page = await mini.reLaunch('/pages/index/index')
await new Promise((r) => setTimeout(r, 1800))
await mini.screenshot({ path: path.join('./automator-shots-b', 'workbench-logged.png') })
const kpi = await page.$$('.kpi')
log('KPI 卡数:', kpi.length)
// 3. 结算
page = await mini.navigateTo('/pages/settlement/index')
await new Promise((r) => setTimeout(r, 1800))
await mini.screenshot({ path: path.join('./automator-shots-b', 'settlement-logged.png') })
const bars = await page.$$('.split-bar')
log('五口径分段条数:', bars.length)
log('DONE')
process.exit(0)
