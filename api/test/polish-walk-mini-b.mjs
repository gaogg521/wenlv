// 三端打磨 · 商户端（mini-b）实页走查：B2 今日待办面板/下钻、结算调整净额、C-02 库存分页+批量入口
// 前提：devtools auto-port 9422（mini-b），隔离服务 18251（含 walk-seed 数据：今日待办 1/15/2/5、结算 #46 调整 -1200）
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = '../automator-shots-polish'
fs.mkdirSync(outDir, { recursive: true })
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name) } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 }
}
const shot = async (mini, name) => { await mini.screenshot({ path: path.join(outDir, name + '.png') }); console.log('    📸', name) }
const waitPage = async (part, timeout = 12000) => {
  for (let i = 0; i < timeout / 500; i++) {
    try { const p = await mini.currentPage(); if (p && p.path && p.path.includes(part)) return p } catch { }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('等待页面超时：' + part)
}
const pgCall = (method, arg) => mini.evaluate((m, a) => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const r = pg[m](a)
  return r && typeof r.then === 'function' ? r.then(x => x === undefined ? null : x) : (r === undefined ? null : r)
}, method, arg === undefined ? null : arg)
const cur2 = async (m) => m.currentPage()

const mini = await (async () => {
  for (let i = 0; i < 40; i++) { try { return await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' }) } catch { await new Promise(r => setTimeout(r, 1000)) } }
  throw new Error('无法连接 9422')
})()
console.log('[walk-b] 已连接模拟器')
for (let i = 0; i < 60; i++) { try { const p = await mini.currentPage(); if (p && p.path) break } catch { } await new Promise(r => setTimeout(r, 1000)) }

// 指向隔离服务 + 清登录态（演示登录固定店长 → 商户 1）
await mini.evaluate(() => { const g = getApp().globalData; g.apiBase = 'http://127.0.0.1:18251'; g.token = ''; g.merchant = null; g.role = 0; wx.removeStorageSync('mtoken'); wx.removeStorageSync('merchant'); wx.removeStorageSync('mloginMode') })

// 演示登录（me 页 enterDemo → mock-chenjie → 商户1 店长）
await t('B2 演示登录（固定店长 · 商户1）', async () => {
  await mini.reLaunch('/pages/me/index')
  const pg = await waitPage('pages/me/index')
  await pgCall('enterDemo')
  await new Promise(r => setTimeout(r, 2500))
  const st = await mini.evaluate(() => ({ token: !!getApp().globalData.token, role: getApp().globalData.role, mid: getApp().globalData.merchant && getApp().globalData.merchant.id }))
  if (!st.token || st.role < 2 || Number(st.mid) !== 1) throw new Error('演示登录失败：' + JSON.stringify(st))
  console.log('    店长登录 ✓ merchant=1 role=' + st.role)
})

// ---------- B2 今日待办面板 ----------
await t('B2 工作台：扫码核销下方出现「今日待办」四项（待接待/待核销/临近截止/异常待处理）', async () => {
  await mini.reLaunch('/pages/index/index')
  await waitPage('pages/index/index')
  await new Promise(r => setTimeout(r, 3000))
  const pg = await cur2(mini)
  const items = await pg.data('todoItems')
  if (!items || items.length < 4) throw new Error('今日待办不足四项：' + JSON.stringify(items))
  const labels = items.map(x => x.label).join(',')
  if (!labels.includes('待接待') || !labels.includes('待核销') || !labels.includes('临近截止') || !labels.includes('异常待处理')) throw new Error('待办标签缺失：' + labels)
  const vals = items.map(x => x.label + '=' + (x.v || 0)).join(' ')
  console.log('    今日待办：', vals)
  if (!items.some(x => x.k === 'arrivals' && Number(x.v) >= 1)) throw new Error('待接待=0（walk-seed 应有 1 单今日出发）')
  if (!items.some(x => x.k === 'abnormal' && Number(x.v) >= 1)) throw new Error('异常待处理=0（walk-seed 应有 5 单退款中）')
  await shot(mini, 'b2-workbench-todos')
})

await t('B2 待接待下钻：订单页带「出发日」预设筛选 chip（口径与待办一致）', async () => {
  const pg = await cur2(mini)
  await pgCall('goTodo', { currentTarget: { dataset: { k: 'arrivals' } } })
  const p2 = await waitPage('pages/orders/index')
  await new Promise(r => setTimeout(r, 2000))
  const depart = await p2.data('presetDepart')
  const status = await p2.data('status')
  if (!depart) throw new Error('出发日预设未生效')
  if (status !== 'waiting') throw new Error('待接待状态筛选未生效：' + status)
  await shot(mini, 'b2-orders-arrivals')
  await pgCall('clearPreset')
  await new Promise(r => setTimeout(r, 1500))
  const cleared = await p2.data('presetDepart')
  if (cleared) throw new Error('预设清除失败')
})
await t('B2 异常待处理下钻：退款筛选生效', async () => {
  await mini.reLaunch('/pages/index/index')
  await waitPage('pages/index/index')
  await new Promise(r => setTimeout(r, 2500))
  const pg = await cur2(mini)
  await pgCall('goTodo', { currentTarget: { dataset: { k: 'abnormal' } } })
  const p2 = await waitPage('pages/orders/index')
  await new Promise(r => setTimeout(r, 2000))
  const status = await p2.data('status')
  if (status !== 'refund') throw new Error('退款筛选未生效：' + status)
  await shot(mini, 'b2-orders-refund')
})
await t('B2 临近截止下钻：库存页切到「未来7天」', async () => {
  await mini.reLaunch('/pages/index/index')
  await waitPage('pages/index/index')
  await new Promise(r => setTimeout(r, 2500))
  const pg = await cur2(mini)
  await pgCall('goTodo', { currentTarget: { dataset: { k: 'closing' } } })
  const p2 = await waitPage('pages/supply/index')
  await new Promise(r => setTimeout(r, 2500))
  const range = await p2.data('range')
  if (range !== 'week') throw new Error('未来7天预设未生效：' + range)
  await shot(mini, 'b2-supply-week')
})

// ---------- C-02 库存服务端分页 + 批量入口 ----------
await t('C-02 库存页：服务端分页（首屏一页），展示 已加载/总数 与 加载更多', async () => {
  const pg = await cur2(mini)
  const page = await pg.data('page'), total = await pg.data('total'), hasMore = await pg.data('hasMore')
  const list = await pg.data('list')
  if (!list || !list.length) throw new Error('库存列表为空')
  if (Number(page) !== 1) throw new Error('首屏不是第一页：' + page)
  if (!(Number(total) >= list.length)) throw new Error('total 异常：' + total + ' < ' + list.length)
  console.log(`    首屏 ${list.length} / 总 ${total} · hasMore=${hasMore}`)
  await shot(mini, 'c02-supply-paged')
})
await t('C-02 批量入口：展开商品显示「批量调整本商品」，店长可见', async () => {
  const pg = await cur2(mini)
  const groups = await pg.data('groups')
  if (!groups || !groups.length) throw new Error('无商品分组')
  const key = groups[0].key
  await pgCall('toggleProduct', { currentTarget: { dataset: { key } } })
  await new Promise(r => setTimeout(r, 800))
  const batchBtn = await pg.$$('.group-footer')
  if (!batchBtn.length) throw new Error('批量入口未渲染')
  await shot(mini, 'c02-supply-batch-entry')
})

// ---------- B2 结算卡：调整待冲抵 ----------
await t('B2 结算卡：展示 调整待冲抵/调整后应结（有退款调整的账单）', async () => {
  await mini.reLaunch('/pages/settlement/index')
  await waitPage('pages/settlement/index')
  await new Promise(r => setTimeout(r, 2500))
  const pg = await cur2(mini)
  const list = await pg.data('list')
  const withAdj = (list || []).filter(s => s.hasAdjust)
  if (!withAdj.length) throw new Error('无带调整的结算单（walk-seed #46 应含 -1200 待冲抵）')
  const s = withAdj[0]
  console.log(`    结算单 ${s.period}：应结 ¥${s.payableLabel} · 调整待冲抵 ¥${s.adjustText} · 调整后 ¥${s.payableAfterAdjText} · ${s.statusText}`)
  // 展开订单明细 → 调整明细可追到订单
  await pgCall('toggleDetail', { currentTarget: { dataset: { id: s.id } } })
  await new Promise(r => setTimeout(r, 2000))
  const adj = await pg.data('adjustDetail')
  const rows = adj && adj[String(s.id)]
  if (!rows || !rows.length) throw new Error('调整明细未下发')
  console.log('    调整明细行：', rows.map(r => r.typeText + ' ¥' + r.amountText).join(' / '))
  await shot(mini, 'b2-settlement-adjust')
})

// 核销员角色裁剪证据：切核销员只看待核销
await t('B2 核销员视角：今日待办只显示「待核销」（权限以现有配置为准）', async () => {
  await mini.evaluate(() => { getApp().globalData.role = 1 })
  await mini.reLaunch('/pages/index/index')
  await waitPage('pages/index/index')
  await new Promise(r => setTimeout(r, 2500))
  const pg = await cur2(mini)
  const items = await pg.data('todoItems')
  if (!items || items.length !== 1 || items[0].k !== 'verify') throw new Error('核销员待办裁剪失败：' + JSON.stringify(items))
  await shot(mini, 'b2-verifier-todos')
})

console.log(`\nmini-b 走查：${pass} 通过 / ${fail} 失败`)
process.exit(process.exitCode || 0)
