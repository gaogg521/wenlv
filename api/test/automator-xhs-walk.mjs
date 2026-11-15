// 小红书化游客端全链路走查（微信开发者工具模拟器）：
//   首页入口 → 广场瀑布流 → 详情 → 评论/回复/点赞 → 我的 → 创作中心 → compose（选图/AI 写作/话题/发布）
//   → 回广场验证 → 朱家角订单链路（报名 → MOCK 支付 → 订单）
// 用法：AUTO_WS=ws://127.0.0.1:9421 node test/automator-xhs-walk.mjs <outDir>
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || '../automator-shots-xhs'
fs.mkdirSync(outDir, { recursive: true })
const log = (...a) => console.log('[walk]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))
// 冷启动 webview 未就绪时 reLaunch/switchTab 会撞 getPageMetaByWebviewId null（debug-cli.sh 已知坑）——统一带重试
const safeNav = async (fn, tries = 12) => {
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      if (!/getPageMetaByWebviewId|timeout|closed/i.test(e.message)) throw e
      await wait(2000)
    }
  }
  throw new Error('导航重试耗尽')
}
const shot = async (mini, name) => { await mini.screenshot({ path: path.join(outDir, name + '.png') }); log('截图', name) }
const errors = []
let pass = 0, fail = 0
const check = async (name, fn) => {
  try { await fn(); pass++; log('✓', name) }
  catch (e) { fail++; errors.push(name + ': ' + e.message); log('✗', name, e.message) }
}
const data = async mini => {
  const page = await mini.currentPage()
  return { page, d: await page.data() }
}

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) }
  catch (e) { log('等待通道…', i + 1); await wait(1000) }
}
if (!mini) { console.error('无法连接 ' + WS); process.exit(1) }
mini.on('console', msg => { if (msg.type === 'error') errors.push('[console.error] ' + (msg.args || []).join(' ')) })
mini.on('exception', e => errors.push('[exception] ' + (e.message || '')))

for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) { log('模拟器就绪:', p.path); break } } catch (e) { }
  await wait(1000)
}

// 清理旧登录态，让走查用户全新登录（ensureLogin 自动 wx.login）
await mini.evaluate(() => { wx.clearStorageSync() })
// 代码包照片 → USER_DATA_PATH（真实临时文件：fs 可读、image 可渲染；包内相对路径读文件在 devtools 不稳）
const fixture = await mini.evaluate(() => {
  try {
    const fs = wx.getFileSystemManager()
    const dir = wx.env.USER_DATA_PATH + '/walk'
    try { fs.mkdirSync(dir, true) } catch (e) { /* 已存在 */ }
    for (const [src, dst] of [['assets/photos/water-town.jpg', dir + '/1.jpg'], ['assets/photos/zongzi.jpg', dir + '/2.jpg']])
      fs.writeFileSync(dst, fs.readFileSync(src))
    return { ok: true, dir }
  } catch (e) { return { fail: e.message } }
})
log('走查夹具:', JSON.stringify(fixture))
if (fixture.fail) { console.error('夹具准备失败', fixture.fail); process.exit(1) }
const FIX1 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk/1.jpg')
const FIX2 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk/2.jpg')

/* ===== 一、浏览：首页入口 → 广场瀑布流 ===== */
let page = await safeNav(() => mini.reLaunch('/pages/home/index'))
await wait(2600)
await check('首页渲染且有小红书入口条', async () => {
  const entry = await page.$('.content-entry')
  if (!entry) throw new Error('缺少 .content-entry')
})
await shot(mini, '01-home')

await (await page.$('.content-entry')).tap()
await wait(2400)
page = await mini.currentPage()
log('当前页:', page.path)
await check('广场为双列瀑布流且有种子内容', async () => {
  if (!page.path.includes('square')) throw new Error('未进入广场: ' + page.path)
  // feed 返回有延迟：轮询等待内容（最长 12s）
  for (let i = 0; i < 12; i++) {
    const { d } = await data(mini)
    if (d.leftItems.length > 0 && d.rightItems.length > 0) return
    await wait(1000)
  }
  const { d } = await data(mini)
  throw new Error(`瀑布流两列异常 L${d.leftItems.length}/R${d.rightItems.length}`)
})
await shot(mini, '02-square-waterfall')

/* ===== 二、详情：图集/话题/评论互动 ===== */
// 选一张带封面的卡片点进（老种子笔记可能无图）
const { d: sq } = await data(mini)
const withCover = sq.leftItems.concat(sq.rightItems).find(x => x.cover)
const cards = await page.$$('.wf-card')
let coverCard = null
for (const card of cards) {
  const t = await card.text()
  if (withCover && withCover.title && t.includes(withCover.title.slice(0, 6))) { coverCard = card; break }
}
await (coverCard || cards[0]).tap()
await wait(2400)
page = await mini.currentPage()
await check('详情页渲染（图集/话题/评论区）', async () => {
  if (!page.path.includes('note')) throw new Error('未进入详情: ' + page.path)
  const { d } = await data(mini)
  if (!d.n) throw new Error('笔记数据为空')
  if (!(d.n.imagesFull.length > 0 || d.n.video)) throw new Error('无图集')
})
await shot(mini, '03-note-detail')

// 发一条一级评论
const countBefore = (await data(mini)).d.n.commentCount
const cInput = await page.$('.ab-input')
await cInput.input('乌镇的早晨太美了，请问是几月拍的？')
await wait(400)
const sendBtn = await page.$('.ab-send')
await sendBtn.tap()
await wait(2000)
await check('评论发布成功且计数 +1', async () => {
  const { d } = await data(mini)
  if (d.n.commentCount !== countBefore + 1) throw new Error(`计数 ${d.n.commentCount} ≠ ${countBefore}+1`)
  if (!d.comments.length || !/几月拍的/.test(d.comments[0].body)) throw new Error('新评论不在列表首位')
})
await shot(mini, '04-comment-posted')

// 回复该评论 → 展开楼内回复
const { d: dNow } = await data(mini)
const rootId = dNow.comments[0].id
const replyBtn = await page.$('.c-item .c-act') // 第一个「回复」
await replyBtn.tap()
await wait(500)
await check('回复态生效（placeholder 变为 回复@）', async () => {
  const { d } = await data(mini)
  if (!d.replyTarget || !d.replyTarget.label) throw new Error('replyTarget 未设置')
})
await cInput.input('十月拍的，早上六点人最少～')
await (await page.$('.ab-send')).tap()
await wait(2000)
// 展开楼内回复验证 replyAuthor
await check('楼内回复展开且带 回复@ 前缀', async () => {
  const { d } = await data(mini)
  const root = d.comments.find(c => c.id === rootId)
  if (!root || !root.replies.length) throw new Error('楼内回复未内嵌展示')
  if (!root.replies[0].replyAuthor) throw new Error('缺少 replyAuthor')
})
await shot(mini, '05-reply-thread')

// 评论点赞
await check('评论点赞变红', async () => {
  const like = await page.$('.c-item .c-like')
  await like.tap()
  await wait(1200)
  const { d } = await data(mini)
  const root = d.comments.find(c => c.id === rootId)
  if (!root.liked || root.likes !== 1) throw new Error(`liked=${root.liked} likes=${root.likes}`)
})
await shot(mini, '06-comment-liked')

/* ===== 三、发帖：创作中心 → compose（选图 → AI 写作 → 话题 → 发布） ===== */
await safeNav(() => mini.switchTab('/pages/me/index'))
await wait(2000)
await shot(mini, '07-me')
// 「创作中心」入口（.kv 内文本匹配）
let tapped = false
for (const kv of await (await mini.currentPage()).$$('.kv')) {
  const t = await kv.text()
  if (/创作中心/.test(t)) { await kv.tap(); tapped = true; break }
}
if (!tapped) { errors.push('未找到创作中心入口'); fail++ }
await wait(2200)
page = await mini.currentPage()
await check('创作中心渲染（发布按钮 + 我的作品）', async () => {
  if (!page.path.includes('create')) throw new Error('未进入创作中心: ' + page.path)
  if (!(await page.$('.compose-btn'))) throw new Error('缺少发布按钮')
})
await shot(mini, '08-create')

// mock chooseMedia：两张实拍照片（代码包内文件，fs 可读）
await mini.mockWxMethod('chooseMedia', {
  tempFiles: [
    { tempFilePath: FIX1, size: 52364, fileType: 'image' },
    { tempFilePath: FIX2, size: 34424, fileType: 'image' },
  ],
  tempFilePaths: [FIX1, FIX2],
})
await (await page.$('.compose-btn')).tap()
await wait(3500) // 进页自动弹选图（被 mock）+ 逐张上传
page = await mini.currentPage()
log('当前页:', page.path)
await check('compose 两图上传完成（图集轮播 + 封面标记）', async () => {
  if (!page.path.includes('compose')) throw new Error('未进入 compose: ' + page.path)
  const { d } = await data(mini)
  if (d.images.length !== 2) throw new Error('图集数量 ' + d.images.length)
  if (d.uploadingCount !== 0) throw new Error('仍有上传中 ' + d.uploadingCount)
  if (!d.images.every(x => x.url && !x.failed)) throw new Error('有图片未上传成功')
  if (!d.images.some(x => x.isCover)) throw new Error('未设封面标记')
  if (!d.canIdeas) throw new Error('写作建议入口未激活')
})
await shot(mini, '09-compose-media')

// AI 写作建议（真实 Qwen 调用，演示 .env 已配置）
const kvLines = await page.$$('.kv-line')
let ideasOpened = false
for (const kv of kvLines) {
  const t = await kv.text()
  if (/写作建议/.test(t)) { await kv.tap(); ideasOpened = true; break }
}
if (!ideasOpened) { errors.push('未找到写作建议入口'); fail++ }
await wait(1200)
await shot(mini, '10-ai-panel')
const intent = await page.$('.idea-intent')
await intent.input('想记录在水边慢下来的感觉')
await (await page.$('.idea-gen')).tap()
log('AI 生成中（真实 Qwen，最长 45s）…')
await wait(12000)
for (let i = 0; i < 6; i++) {
  const { d } = await data(mini)
  if (!d.visionBusy) break
  await wait(6000)
}
await check('AI 生成出标题与正文', async () => {
  const { d } = await data(mini)
  if (d.visionError) throw new Error('AI 报错: ' + d.visionError)
  if (!d.visionResult || !d.visionResult.title || !d.visionResult.text) throw new Error('AI 结果为空')
})
await shot(mini, '11-ai-result')
const applyBtn = await page.$('.ir-apply')
if (applyBtn) { await applyBtn.tap(); await wait(1800) }
else {
  // AI 未出结果时回退手填，保证后续链路继续（AI 失败已单独记入问题清单）
  log('AI 未出结果，回退手填')
  const titleInput = await page.$('.title-input')
  await titleInput.input('水边的下午·走查手记')
  await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]
    return new Promise(res => { if (!pg.editor) return res('no-editor')
      pg.editor.insertText({ text: '自动化走查回退手填的正文：水边、石桥和缓慢的下午。', success: () => res('ok'), fail: () => res('fail') }) }) })
  await wait(900)
}

// 话题：# 添加话题 → 选第一个热门话题
await (await page.$('.topic-add')).tap()
await wait(900)
await (await page.$('.topic-opt')).tap()
await wait(700)
await check('标题/正文/话题已就位', async () => {
  const { d } = await data(mini)
  if (!d.title) throw new Error('标题为空')
  if (d.bodyLen < 4) throw new Error('正文不足')
  if (!d.topics.length) throw new Error('话题未添加')
})
await shot(mini, '12-compose-filled')

// 发布
const publishedTitle = (await data(mini)).d.title
for (let i = 0; i < 3; i++) {
  await (await page.$('.pub-btn')).tap()
  await wait(2500)
  page = await mini.currentPage()
  if (page.path.includes('create')) break
  // automator 对固定底栏元素的 tap 在部分 devtools 版本会吞掉——回退直接调用处理函数（真机点击正常）
  await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]
    if (pg.route && pg.route.includes('compose')) pg.publish() })
  await wait(3200)
  page = await mini.currentPage()
  if (page.path.includes('create')) break
  log('发布未返回，重试', i + 1)
}
let publishedStatus = '已发布'
await check('发布成功并返回创作中心（我的作品置顶）', async () => {
  if (!page.path.includes('create')) throw new Error('发布后未返回: ' + page.path)
  const { d } = await data(mini)
  if (!d.notes.length) throw new Error('我的作品为空')
  // 真实微信登录 + 演示内网部署时，图片机审通道降级 → 转人工审核（治理闭环：脚本随即在后台通过）
  if (!['已发布', '人工审核中'].includes(d.notes[0].statusText)) throw new Error('最新作品状态: ' + d.notes[0].statusText)
  publishedStatus = d.notes[0].statusText
})
// 人工审核路径：后台通过，让新笔记进入广场（完整治理闭环演示）
if (publishedStatus === '人工审核中') {
  const login = await (await fetch((process.env.API_BASE || 'http://127.0.0.1:8080') + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' }) })).json()
  const A = login.data.token
  const q = await (await fetch((process.env.API_BASE || 'http://127.0.0.1:8080') + '/admin/content?kw=' + encodeURIComponent(publishedTitle) + '&status=1', { headers: { authorization: 'Bearer ' + A } })).json()
  const row = (q.data?.rows || [])[0]
  if (!row) { fail++; errors.push('后台未检索到待审笔记: ' + publishedTitle) } else {
    const v = await (await fetch((process.env.API_BASE || 'http://127.0.0.1:8080') + '/admin/content/' + row.id + '/verdict', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A }, body: JSON.stringify({ pass: true, revision: row.revision }) })).json()
    log('后台人工审核通过:', v.code === 0 ? 'ok note-' + row.id : v.msg)
    await wait(800)
  }
}
await shot(mini, '13-create-after-publish')
await mini.mockWxMethod('chooseMedia', null) // 撤销 mock

/* ===== 四、回广场看新笔记 ===== */
await safeNav(() => mini.reLaunch('/package-content/pages/square/index'))
await wait(2400)
page = await mini.currentPage()
await check('广场瀑布流出现新发布的笔记', async () => {
  const { d } = await data(mini)
  const all = d.leftItems.concat(d.rightItems)
  if (!all.some(x => x.title === publishedTitle)) throw new Error(`广场未见「${publishedTitle}」`)
})
await shot(mini, '14-square-with-new')

/* ===== 五、朱家角订单链路（报名 → MOCK 支付 → 我的订单） ===== */
await mini.reLaunch('/pages/home/index')
await wait(2400)
page = await mini.currentPage()
const tourItems = await page.$$('.tour-item')
let zhujiajiao = null
for (const item of tourItems) {
  const t = await item.text()
  if (/朱家角/.test(t)) { zhujiajiao = item; break }
}
if (!zhujiajiao) { errors.push('首页未找到朱家角线路卡'); fail++ } else {
  await zhujiajiao.tap()
  await wait(2400)
  page = await mini.currentPage()
  await shot(mini, '15-zhujiajiao-detail')
  // 立即报名 → booking 页：联系人 + 协议 → 提交订单并支付（MOCK）→ 我的订单
  const bookBtn = await page.$('.btn')
  if (bookBtn) {
    await bookBtn.tap()
    await wait(2600)
    page = await mini.currentPage()
    log('报名后页面:', page.path)
    if (page.path.includes('booking')) {
      await shot(mini, '16-booking')
      const bd = await page.data()
      if (!(bd.sessions && bd.sessions.length)) throw new Error('booking 无可售团期')
      // 自动选第一个有余位的团期（默认首团可能已被演示订单吃满）
      let pickIdx = -1
      for (let i = bd.sessions.length - 1; i >= 0; i--) if (Number(bd.sessions[i].left_seats) >= (bd.qty || 1)) { pickIdx = i; break }
      if (pickIdx < 0) pickIdx = bd.sessions.findIndex(x => Number(x.left_seats) === -1 || x.left_seats == null)
      if (pickIdx < 0) throw new Error('所有团期均无余位（演示库存耗尽）')
      await page.setData({ sel: pickIdx })
      log('选用团期下标', pickIdx, '余位', bd.sessions[pickIdx].left_seats)
      await page.setData({ contactName: '走查测试', contactPhone: '13800001234', agree: true })
      await wait(600)
      await (await page.$('.dt-cta')).tap()
      await wait(3500)
      page = await mini.currentPage()
      if (page.path.includes('booking')) {
        // 同上：固定底栏 CTA 的 tap 回退
        await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]
          if (pg.route && pg.route.includes('booking')) pg.submit() })
        await wait(5000)
        page = await mini.currentPage()
      }
      log('支付后页面:', page.path)
      await shot(mini, '17-pay-result')
      await check('订单支付完成（pay-result / 订单页）', async () => {
        if (!/pay-result|orders|order-detail/.test(page.path)) throw new Error('支付后未进入结果页: ' + page.path)
      })
    } else {
      try { await page.setData({ contactPhone: '13800001234', contactName: '走查测试' }) } catch (e) { }
      await bookBtn.tap()
      await wait(5000)
      page = await mini.currentPage()
    }
    await safeNav(() => mini.reLaunch('/package-order/pages/orders/index'))
    await wait(2400)
    page = await mini.currentPage()
    await shot(mini, '18-my-orders')
    await check('我的订单出现新订单', async () => {
      const { d } = await data(mini)
      if (!page.path.includes('orders')) throw new Error('未进入订单页: ' + page.path)
      if (!(Array.isArray(d.orders) && d.orders.length)) throw new Error('订单列表为空')
    })
  } else { errors.push('详情页未找到报名按钮'); fail++ }
}

/* ===== 汇总 ===== */
console.log('\n===== 走查汇总 =====')
console.log(`通过 ${pass} · 失败 ${fail} · 截图目录 ${outDir}`)
if (errors.length) { console.log('问题清单：'); errors.forEach((e, i) => console.log(` ${i + 1}. ${e}`)) }
process.exit(fail ? 1 : 0)
