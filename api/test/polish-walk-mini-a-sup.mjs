// 三端打磨 · 游客端补充走查：A1 双地点、A3 发笔记返回保留、B1 试算失败态与恢复
// 前提：devtools 9421（mini-a）、隔离服务 18251；先跑 polish-walk-seed + 142 号产品关联稿（或复用现有）
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

const mini = await (async () => {
  for (let i = 0; i < 40; i++) { try { return await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' }) } catch { await new Promise(r => setTimeout(r, 1000)) } }
  throw new Error('无法连接 9421')
})()
for (let i = 0; i < 60; i++) { try { const p = await mini.currentPage(); if (p && p.path) break } catch { } await new Promise(r => setTimeout(r, 1000)) }
// 恢复上轮残留 mock，通道指向隔离服务
await mini.evaluate(() => { try { wx.removeStorageSync('xhs-compose-draft') } catch (e) { } const g = getApp().globalData; g.apiBase = 'http://127.0.0.1:18251' })
await mini.mockWxMethod('login', { code: 'mock-polish-fixed' })
await mini.mockWxMethod('chooseMedia', { tempFiles: [], errMsg: 'chooseMedia:ok' })

await t('A1 首页作品卡覆盖两个地点（景区名 + 线路名两条地点行）', async () => {
  await mini.reLaunch('/pages/home/index')
  const pg = await waitPage('pages/home/index')
  await new Promise(r => setTimeout(r, 3200))
  const notes = await pg.data('notes')
  if (!notes || notes.length < 2) throw new Error('作品卡不足两张')
  const places = [...new Set(notes.filter(x => x.place).map(x => x.place))]
  if (places.length < 2) throw new Error('地点行不足两个：' + JSON.stringify(notes.map(x => x.place)))
  console.log('    地点行：', places.join(' | '))
  await shot(mini, 'a1-home-two-places')
})

await t('A3 点「去发布我的笔记」→ compose 返回 → 广场筛选与已加载内容保留', async () => {
  await mini.reLaunch('/package-content/pages/square/index')
  const pg = await waitPage('square/index')
  await new Promise(r => setTimeout(r, 2200))
  await pgCall('setData', { topicInput: '朱家角漫步' })
  await pgCall('searchTopic')
  await new Promise(r => setTimeout(r, 2200))
  const p2 = await waitPage('square/index')
  const before = (await p2.data('leftItems')).length
  if (!before) throw new Error('话题无命中')
  await pgCall('goCreate')
  const p3 = await waitPage('compose/index')
  await new Promise(r => setTimeout(r, 1200))
  await mini.navigateBack()
  const p4 = await waitPage('square/index')
  await new Promise(r => setTimeout(r, 1000))
  const after = (await p4.data('leftItems')).length
  const topic = await p4.data('topic')
  if (after !== before) throw new Error('返回后已加载内容丢失')
  if (topic !== '朱家角漫步') throw new Error('返回后筛选丢失：' + topic)
  await shot(mini, 'a3-square-after-create')
})

await t('B1 试算失败：断网态给出失败反馈（明细与底栏），恢复后重试成功', async () => {
  await mini.reLaunch('/package-tour/pages/booking/index?id=69')
  const pg = await waitPage('booking/index')
  await new Promise(r => setTimeout(r, 3000))
  // 制造试算失败：把通道拨到不存在的端口（本地断网语义）
  await mini.evaluate(() => { getApp().globalData.apiBase = 'http://127.0.0.1:1' })
  await pgCall('toggleInsurance', { detail: { value: false } }) // 触发 updatePrice→quoteFreedom
  await pgCall('toggleInsurance', { detail: { value: true } })
  await new Promise(r => setTimeout(r, 2500))
  const err1 = await pg.data('freedomError')
  if (!err1) throw new Error('断网后 freedomError 未置位')
  if (await pg.data('quoted')) throw new Error('试算失败仍保留旧报价')
  if (!(await (await pg.$('.dt-cta')).attribute('class')).includes('off')) throw new Error('试算失败仍可提交')
  await shot(mini, 'b1-quote-failure')
  // 恢复通道 → 重试成功
  await mini.evaluate(() => { getApp().globalData.apiBase = 'http://127.0.0.1:18251' })
  await pgCall('retryQuote')
  await new Promise(r => setTimeout(r, 2500))
  const err2 = await pg.data('freedomError')
  const ps = await pg.data('priceSummary')
  if (err2) throw new Error('恢复后仍失败：' + err2)
  if (!ps || !ps.pay) throw new Error('恢复后无价格')
  await shot(mini, 'b1-quote-recovered')
})

console.log(`\nmini-a 补充走查：${pass} 通过 / ${fail} 失败`)
process.exit(process.exitCode || 0)
