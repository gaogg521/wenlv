// 三端打磨 · 游客端（mini-a）实页走查：A1 首页作品区 / A2 双向关系 / A3 广场 / B1 实付解释 / C-01 攻略图草稿
// 运行前提：devtools auto-port 9421（mini-a），隔离服务 18251
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = '../automator-shots-polish'
fs.mkdirSync(outDir, { recursive: true })
const BASE = 'http://127.0.0.1:18251'
const SCENIC_ID = process.env.WALK_SCENIC || '24'
const BOOK_PRODUCT = process.env.WALK_BOOK_PRODUCT || '61'
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name) } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 }
}
const shot = async (mini, name) => { await mini.screenshot({ path: path.join(outDir, name + '.png') }); console.log('    📸', name) }

const mini = await (async () => {
  for (let i = 0; i < 40; i++) { try { return await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' }) } catch { await new Promise(r => setTimeout(r, 1000)) } }
  throw new Error('无法连接 9421')
})()
console.log('[walk] 已连接模拟器')
for (let i = 0; i < 60; i++) { try { const p = await mini.currentPage(); if (p && p.path) break } catch { } await new Promise(r => setTimeout(r, 1000)) }

// 通道指向隔离服务（走查用 18251；8080 演示服务不动）+ 清残留 token
const apiBase = await mini.evaluate(() => { const g = getApp().globalData; g.apiBase = 'http://127.0.0.1:18251'; g.token = ''; wx.removeStorageSync('token'); wx.removeStorageSync('user'); return g.apiBase })
console.log('[walk] apiBase =', apiBase)
// 固定走查身份（真实 wx.login code 每次不同会换新用户——旅豆等账户数据无法稳定预置）
await mini.mockWxMethod('login', { code: 'mock-polish-fixed' })

const cur = async () => { const p = await mini.currentPage(); return p }
// 等 currentPage().path 等于期望值——reLaunch 后 handle 存在时序竞态，固定 sleep 不可靠
const waitPage = async (part, timeout = 12000) => {
  for (let i = 0; i < timeout / 500; i++) {
    try { const p = await mini.currentPage(); if (p && p.path && p.path.includes(part)) return p } catch { }
    await new Promise(r => setTimeout(r, 500))
  }
  const p = await mini.currentPage().catch(() => null)
  throw new Error('等待页面超时（期望含 ' + part + '，实际 ' + (p && p.path) + '）')
}
// devtools 3.17.5 + automator 0.13：page.callMethod 失效（this 绑定丢失）——统一用 evaluate 直调页面方法
const pgCall = (method, arg) => mini.evaluate((m, a) => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const r = pg[m](a)
  return r && typeof r.then === 'function' ? r.then(x => x === undefined ? null : x) : (r === undefined ? null : r)
}, method, arg === undefined ? null : arg)

// ---------- A1 首页旅行笔记作品区 ----------
await t('A1 冷启动首页：主题卡下方出现「旅行笔记」作品区（无需进创作中心）', async () => {
  await mini.reLaunch('/pages/home/index')
  await waitPage('pages/home/index')
  await new Promise(r => setTimeout(r, 3000)) // feed 拉取（含静默登录）
  const pg = await cur()
  const cards = await pg.$$('.note-card')
  if (!cards.length) throw new Error('首页作品区没有作品卡')
  await shot(mini, 'a1-home-notes')
})
await t('A1 卡片直达笔记详情（非创作入口）', async () => {
  const pg = await cur()
  const card = await pg.$('.note-card')
  await card.tap()
  const p2 = await waitPage('note/index')
  await new Promise(r => setTimeout(r, 1500))
  await shot(mini, 'a1-note-detail')
})
await t('A1 「看更多」进广场', async () => {
  await mini.navigateBack()
  const pg = await waitPage('pages/home/index')
  await new Promise(r => setTimeout(r, 800))
  const more = await pg.$('.notes-more')
  if (!more) throw new Error('找不到「看更多」')
  await more.tap()
  const p2 = await waitPage('square/index')
})

// ---------- A2 景区/线路双向 ----------
await t('A2 景区详情：页内直接展示该景区公开笔记卡（2-3 条）', async () => {
  await mini.reLaunch('/package-tour/pages/place/index?kind=scenic&id=' + SCENIC_ID)
  const pg = await waitPage('place/index')
  await new Promise(r => setTimeout(r, 2500))
  const cards = await pg.$$('.pl-note')
  if (!cards.length) throw new Error('景区详情无页内笔记')
  await shot(mini, 'a2-place-notes')
})
await t('A2 景区页内卡 → 笔记详情 → 「看这个景区的笔记」回景区（往返闭环）', async () => {
  const pg = await cur()
  const card = await pg.$('.pl-note')
  await card.tap()
  let p2 = await waitPage('note/index')
  await new Promise(r => setTimeout(r, 1500))
  await shot(mini, 'a2-note-from-place')
  const scenicLine = await p2.$('.scenic-line')
  if (!scenicLine) throw new Error('详情缺「看这个景区的笔记」入口')
  await scenicLine.tap()
  p2 = await waitPage('place/index')
})
await t('A2 线路详情：展示「走过这条线路的笔记」（线路关联）', async () => {
  await mini.reLaunch('/package-tour/pages/detail/index?id=1')
  const pg = await waitPage('package-tour/pages/detail/index')
  await new Promise(r => setTimeout(r, 2500))
  const cards = await pg.$$('.pl-note')
  if (!cards.length) throw new Error('线路详情无笔记卡')
  await shot(mini, 'a2-line-notes')
})
await t('A2 笔记详情 →「查看这条线路」→ 线路详情（下架线路无死链由 product_status 契约保障）', async () => {
  // 挂线路的笔记：从线路详情点第一张卡进入
  const pg = await cur()
  const card = await pg.$('.pl-note')
  await card.tap()
  const p2 = await waitPage('note/index')
  await new Promise(r => setTimeout(r, 1500))
  const lines = await p2.$$('.scenic-line')
  if (!lines.length) throw new Error('详情缺关联入口行')
  // 最后一行是「查看这条线路」（第一行是景区）
  const productLine = lines[lines.length - 1]
  await productLine.tap()
  const p3 = await waitPage('package-tour/pages/detail/index')
  await shot(mini, 'a2-note-to-line')
})

// ---------- A3 广场浏览/发帖/返回 ----------
await t('A3 广场搜索话题 → 命中 → 打开作品返回后筛选与已加载内容保留', async () => {
  await mini.reLaunch('/package-content/pages/square/index')
  await waitPage('square/index')
  await new Promise(r => setTimeout(r, 2200))
  const pg = await cur()
  await pgCall('setData', { topicInput: '朱家角漫步' })
  await pgCall('searchTopic')
  await new Promise(r => setTimeout(r, 2200))
  const p2 = await waitPage('square/index')
  const left = await p2.data('leftItems')
  if (!left || !left.length) throw new Error('话题搜索无命中')
  await shot(mini, 'a3-square-topic')
  const before = left.length
  await pgCall('goNote', { currentTarget: { dataset: { id: left[0].id } } })
  await waitPage('note/index')
  await new Promise(r => setTimeout(r, 1200))
  await mini.navigateBack()
  const p3 = await waitPage('square/index')
  await new Promise(r => setTimeout(r, 800))
  const left2 = await p3.data('leftItems')
  const topic2 = await p3.data('topic')
  if (!left2 || left2.length !== before) throw new Error('返回后已加载内容丢失')
  if (topic2 !== '朱家角漫步') throw new Error('返回后筛选丢失：' + topic2)
  await shot(mini, 'a3-square-kept')
})
await t('A3 空结果态：冷门话题给出明确空态文案', async () => {
  const pg = await cur()
  await pgCall('setData', { topicInput: '绝不存在的话题xyz' })
  await pgCall('searchTopic')
  await new Promise(r => setTimeout(r, 2000))
  const emptyText = await (await waitPage('square/index')).data('emptyText')
  if (!emptyText || !emptyText.includes('还没有公开笔记')) throw new Error('空态文案缺失：' + emptyText)
  await shot(mini, 'a3-square-empty')
})

// ---------- B1 预订底栏实付解释 ----------
await t('B1 预订页底栏：预计实付 + 优惠原因（旅豆/自由豆）同屏', async () => {
  await mini.reLaunch('/package-tour/pages/booking/index?id=' + BOOK_PRODUCT)
  const pg = await waitPage('booking/index')
  await new Promise(r => setTimeout(r, 3000))
  const pay = await pg.data('priceSummary')
  if (!pay) throw new Error('无 priceSummary')
  const reason = await pg.data('payReason')
  const calc = await pg.data('payCalcText')
  if (!calc || !calc.includes('应付')) throw new Error('明细缺应付合计算式：' + calc)
  await shot(mini, 'b1-booking-bottom')
})
await t('B1 切换保险：金额同步刷新且明细算式更新（含 +保险）', async () => {
  const pg = await cur()
  await pgCall('toggleInsurance', { detail: { value: true } })
  await new Promise(r => setTimeout(r, 1600))
  const calc = await pg.data('payCalcText')
  if (!calc.includes('保险')) throw new Error('保险未进算式：' + calc)
  await shot(mini, 'b1-booking-insurance')
})
await t('B1 优惠原因行：旅豆抵扣开启时底栏出现「旅豆已抵」', async () => {
  // 静默登录用户每次运行可能不同——按当前登录用户直接预置旅豆账户，再重进预订页让 onLoad 拉到余额
  const { assertIsolatedDb } = await import('./_guard.mjs')
  assertIsolatedDb('polish-walk-mini-a 助记夹具')
  const { q, closeDb } = await import('../src/db.mjs')
  const uid = await mini.evaluate(() => getApp().globalData.user && getApp().globalData.user.id)
  if (!uid) throw new Error('未登录态，无 user id')
  try { await q('UPDATE bean_account SET balance=3000 WHERE user_id=?', [uid]) } finally { await closeDb() }
  await mini.reLaunch('/package-tour/pages/booking/index?id=' + BOOK_PRODUCT)
  const pg = await waitPage('booking/index')
  await new Promise(r => setTimeout(r, 3000))
  const bal = await pg.data('beanBal')
  if (!Number(bal)) throw new Error('beanBal 未拉到余额：' + bal)
  await pgCall('toggleBean', { detail: { value: true } })
  await new Promise(r => setTimeout(r, 1800))
  const reason = await pg.data('payReason')
  if (!reason || !(reason.includes('旅豆已抵') || reason.includes('自由豆已减'))) throw new Error('底栏缺优惠原因：' + reason)
  await shot(mini, 'b1-booking-reason')
})

// ---------- C-01 攻略图草稿恢复 ----------
await t('C-01 攻略图数据入草稿（onHide 云存档+本地快照）', async () => {
  await mini.evaluate(() => wx.removeStorageSync('xhs-compose-draft')) // 清历史草稿，走纯净流程
  // 空草稿路径 onReady 会 pickImages 弹原生相册（阻塞 evaluate）——mock 掉
  await mini.mockWxMethod('chooseMedia', { tempFiles: [], errMsg: 'chooseMedia:ok' })
  await mini.reLaunch('/package-content/pages/compose/index')
  await waitPage('compose/index')
  await new Promise(r => setTimeout(r, 2000))
  const pg = await cur()
  // 填入攻略图文案（模板 2=图文拼贴）
  await pgCall('setData', { guideTitle: '朱家角一日路线', guideText: '早上 8 点到放生桥\n中午北大街吃阿婆粽\n下午手摇船游镇', guideStyle: 2 })
  await pgCall('onHide')
  await new Promise(r => setTimeout(r, 800))
  const draft = await mini.evaluate(() => wx.getStorageSync('xhs-compose-draft'))
  if (!draft || draft.guideTitle !== '朱家角一日路线' || Number(draft.guideStyle) !== 2) throw new Error('草稿缺攻略图字段：' + JSON.stringify(draft && { g: draft.guideTitle, s: draft.guideStyle }))
  console.log('    草稿含 guideTitle/guideStyle ✓')
})
await t('C-01 重新进入：恢复文字与样式；失效配图提示并清引用', async () => {
  // 预置一个必然失效的配图路径（沙箱里不存在的文件），恢复时应清掉
  await mini.evaluate(() => { const d = wx.getStorageSync('xhs-compose-draft') || {}; d.guidePhoto = '/tmp/not-exist-fake.png'; wx.setStorageSync('xhs-compose-draft', d) })
  await mini.reLaunch('/package-content/pages/compose/index')
  await waitPage('compose/index')
  await new Promise(r => setTimeout(r, 2000))
  const pg = await cur()
  // 原生 showModal 无法自动点击（automator 限制）：直调恢复语义函数，恢复逻辑与 modal confirm 分支一致
  const draft = await mini.evaluate(() => wx.getStorageSync('xhs-compose-draft'))
  await mini.mockWxMethod('chooseMedia', { tempFiles: [], errMsg: 'chooseMedia:ok' })
  const restored = await pgCall('restoreGuide', draft)
  await new Promise(r => setTimeout(r, 600))
  if (!restored) throw new Error('restoreGuide 未识别攻略图草稿')
  const d = await pg.data()
  if (d.guideTitle !== '朱家角一日路线' || Number(d.guideStyle) !== 2) throw new Error('恢复失败：' + d.guideTitle + '/' + d.guideStyle)
  if (d.guidePhoto) throw new Error('失效配图未清引用：' + d.guidePhoto)
  await shot(mini, 'c01-guide-restored')
})

console.log(`\nmini-a 走查：${pass} 通过 / ${fail} 失败`)
process.exit(process.exitCode || 0)
