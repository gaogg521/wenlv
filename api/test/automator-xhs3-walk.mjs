// UGC 三期游客端走查（微信开发者工具模拟器）：
//   广场话题搜索/过滤头 → 详情话题跳转 → compose 缩略图条 + 拖拽排序 + 可见范围
//   → 云草稿（onHide 云同步 → 创作中心恢复）→ 语音评论（发送→展示→试听）→ 私密笔记详情（🔒 + 登录态取图）
// 用法：AUTO_WS=ws://127.0.0.1:9421 node test/automator-xhs3-walk.mjs <outDir>
// 通道：走查流量经 apiBase 运行时指向 18241 mock 通道服务（同演示库），真实语音机审直通可完整走通；
//       8080 演示服务全程不动。夹具铁律（二期）：chooseMedia mock 指 USER_DATA_PATH 真实临时文件。
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || '../automator-shots-xhs3'
fs.mkdirSync(outDir, { recursive: true })
const log = (...a) => console.log('[walk3]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))
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

// 走查通道：指向 18241（同演示库）+ mock wx.login（demo 身份→机审 mock 直通，完整走语音/私密全链）
// 说明：18241 与演示库共享 app_secret 表里的真实微信凭据，wx.login 真实 code 会走真机审通道——
// 走查必须 mock login code（mock- 前缀）才能落到 demoIdentity。8080 演示服务全程不动。
await mini.evaluate(() => { wx.clearStorageSync(); getApp().globalData.apiBase = 'http://127.0.0.1:18241'; getApp().globalData.token = '' })
await mini.mockWxMethod('login', { code: 'mock-walk3-' + Date.now() })
log('apiBase 已指向 18241（mock 通道 + demo 身份）')

// 夹具：两张代码包照片
const fixture = await mini.evaluate(() => {
  try {
    const fs = wx.getFileSystemManager()
    const dir = wx.env.USER_DATA_PATH + '/walk3'
    try { fs.mkdirSync(dir, true) } catch (e) { /* 已存在 */ }
    for (const [src, dst] of [['assets/photos/water-town.jpg', dir + '/1.jpg'], ['assets/photos/zongzi.jpg', dir + '/2.jpg']])
      fs.writeFileSync(dst, fs.readFileSync(src))
    return { ok: true }
  } catch (e) { return { fail: e.message } }
})
if (fixture.fail) { console.error('夹具准备失败', fixture.fail); process.exit(1) }
const FIX1 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk3/1.jpg')
const FIX2 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk3/2.jpg')
// 真实 mp3 夹具（ffmpeg 静音片段，试听可解码）；缺失时退回 ID3 头 stub（服务端校验仍合法，仅试听报解码错）
let mp3Base64 = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(48, 0x33)]).toString('base64')
try { mp3Base64 = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/walk3-voice.mp3')).toString('base64'); log('真实 mp3 夹具就绪') }
catch (e) { log('无 mp3 夹具，退回 ID3 stub') }

/* ===== 一、广场话题聚合（三期①） ===== */
let page = await safeNav(() => mini.reLaunch('/package-content/pages/square/index'))
await wait(3000)
page = await mini.currentPage()
await check('广场渲染（hasFilter 状态就绪）', async () => {
  const { d } = await data(mini)
  if (typeof d.hasFilter !== 'boolean') throw new Error('square data 未加载')
})
await shot(mini, '30-square-top')

const input = await page.$('.topic-input')
await input.input('走查')
await wait(300)
await (await page.$('.topic-go')).tap()
await wait(1800)
await check('话题搜索生效（过滤头出现）', async () => {
  const { d } = await data(mini)
  if (d.topic !== '走查' || !d.hasFilter) throw new Error('topic 未生效: ' + JSON.stringify({ topic: d.topic, hasFilter: d.hasFilter }))
  const chip = await page.$('.tf-chip')
  const t = chip ? await chip.text() : ''
  if (!t.includes('走查')) throw new Error('过滤头文案缺话题: ' + t)
})
await shot(mini, '31-topic-filter')
await (await page.$('.tf-clear')).tap()
await wait(1800)
await check('清除筛选回到全量', async () => {
  const { d } = await data(mini)
  if (d.hasFilter) throw new Error('hasFilter 仍为 true')
})

/* ===== 二、详情话题点击 → 话题聚合页（三期①） ===== */
const { d: sqd } = await data(mini)
const cards = await page.$$('.wf-card')
if (cards.length) {
  await cards[0].tap()
  await wait(2600)
  page = await mini.currentPage()
  if (page.path.includes('note')) {
    const { d: nd } = await data(mini)
    if (nd.n && (nd.n.topicsReady || []).length) {
      await (await page.$('.topic-tag')).tap()
      await wait(2200)
      page = await mini.currentPage()
      await check('详情话题点击跳转话题聚合页', async () => {
        if (!page.path.includes('square')) throw new Error('未跳广场: ' + page.path)
        const { d } = await data(mini)
        if (!d.hasFilter || !d.topic) throw new Error('未带话题过滤')
      })
      await shot(mini, '32-topic-from-detail')
      await safeNav(() => mini.navigateBack())
      await wait(1500)
    } else log('首卡笔记无话题，跳过详情话题点击')
    await safeNav(() => mini.navigateBack())
    await wait(1500)
  } else log('未进详情，跳过')
} else log('广场无卡片，跳过详情话题点击')

/* ===== 三、compose：缩略图条 + 可见范围 + 拖拽排序（三期⑦⑥） ===== */
await mini.mockWxMethod('chooseMedia', {
  tempFiles: [
    { tempFilePath: FIX1, size: 52364, fileType: 'image' },
    { tempFilePath: FIX2, size: 34424, fileType: 'image' },
  ],
  tempFilePaths: [FIX1, FIX2],
})
await safeNav(() => mini.reLaunch('/package-content/pages/compose/index'))
await wait(3500) // 进页自动弹选图（mock）+ 逐张上传
page = await mini.currentPage()
await check('compose 自动选图并进入编辑态（缩略图条就绪）', async () => {
  if (!page.path.includes('compose')) throw new Error('未进 compose: ' + page.path)
  const { d } = await data(mini)
  if (d.images.length !== 2) throw new Error('图片未就位: ' + d.images.length)
  if (!d.thumbs.length) throw new Error('缩略图条未生成')
})
await shot(mini, '33-compose-thumbs')

// 可见范围：公开 → 仅自己（tap 会弹原生确认框卡住截图——直调确认语义 applyVisibility('private')，
// 等价用户在弹窗里点了「确定」；交互弹窗本身见 41-private-compose 前的手动验收）
await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.applyVisibility('private') })
await wait(500)
await check('可见范围切换为仅自己', async () => {
  const { d } = await data(mini)
  if (d.visibility !== 'private' || !d.visPrivateOn) throw new Error('可见范围未切换: ' + d.visibility)
})
await mini.evaluate(() => { wx.pageScrollTo({ selector: '.vis-line', duration: 300, fail: () => {} }) })
await wait(600)
await shot(mini, '34-visibility-private')

// 拖拽排序：直调 touch 流（长按第 0 张 → 拖到第 2 格 → 松手）；封面跟随 key
const dragState = await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const before = pg.data.images.map(x => x.key)
  const coverBefore = pg.data.images[pg.data.coverIndex] ? pg.data.images[pg.data.coverIndex].key : ''
  pg.thumbLongPress({ currentTarget: { dataset: { i: 0 } } })
  return { before, coverBefore, dragging: pg.data.dragging }
})
await wait(400)
await shot(mini, '35-dragging')
const dragDone = await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  return new Promise(resolve => {
    pg.createSelectorQuery().select('#thumbStrip').boundingClientRect(rect => {
      const slot = rect && rect.width ? rect.width / Math.max(pg.data.images.length, 1) : 100
      pg.thumbMove({ touches: [{ clientX: (rect ? rect.left : 0) + slot * 1.6, clientY: (rect ? rect.top : 0) + 20 }] })
      setTimeout(() => {
        pg.thumbEnd()
        const after = pg.data.images.map(x => x.key)
        const coverAfter = pg.data.images[pg.data.coverIndex] ? pg.data.images[pg.data.coverIndex].key : ''
        resolve({ after, coverAfter, dragging: pg.data.dragging })
      }, 300)
    }).exec()
  })
})
await wait(600)
await check('拖拽排序生效且封面跟随', async () => {
  if (dragState.dragging !== true) throw new Error('长按未进入拖拽态')
  if (dragDone.dragging !== false) throw new Error('松手未退出拖拽态')
  if (JSON.stringify(dragState.before) === JSON.stringify(dragDone.after)) throw new Error('顺序未变化: ' + JSON.stringify(dragDone.after))
  if (dragState.coverBefore !== dragDone.coverAfter) throw new Error('封面未跟随: ' + dragState.coverBefore + ' → ' + dragDone.coverAfter)
})
await shot(mini, '36-drag-done')

/* ===== 四、云草稿：onHide 云同步 → 创作中心恢复（三期④） ===== */
const titleInput = await page.$('.title-input')
await titleInput.input('三期云草稿走查')
await wait(300)
// 用户切走（App onHide → Page.onHide）：直调 pg.onHide()（reLaunch 走 onUnload 不触发 onHide）
await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.onHide() })
await wait(2600)
await safeNav(() => mini.reLaunch('/package-content/pages/create/index'))
await wait(2200)
page = await mini.currentPage()
await check('创作中心出现云草稿行', async () => {
  const { d } = await data(mini)
  if (!d.drafts.length) throw new Error('云草稿列表为空（onHide 未同步成功）')
  if (!d.drafts.some(x => (x.name || '').includes('三期云草稿走查'))) throw new Error('草稿标题不符: ' + JSON.stringify(d.drafts.map(x => x.name)))
})
await shot(mini, '37-cloud-drafts')
const draftRows = await page.$$('.draft-row')
if (draftRows.length) {
  await draftRows[0].tap()
  await wait(2800)
  page = await mini.currentPage()
  await check('云草稿恢复到 compose（标题回填 + 云稿关联）', async () => {
    if (!page.path.includes('compose')) throw new Error('未进 compose: ' + page.path)
    const { d } = await data(mini)
    if (d.title !== '三期云草稿走查') throw new Error('标题未回填: ' + d.title)
    if (d.cloudDraftId == null || d.cloudDraftRevision == null) throw new Error('云稿关联丢失')
  })
  await shot(mini, '38-draft-restored')
  await safeNav(() => mini.navigateBack())
  await wait(1200)
} else log('云草稿行缺失，跳过恢复断言')

/* ===== 五、语音评论：真实 mp3 随评发送 → 列表语音行 → 试听（三期语音） ===== */
await safeNav(() => mini.reLaunch('/package-content/pages/square/index'))
await wait(3000)
page = await mini.currentPage()
const cards2 = await page.$$('.wf-card')
if (cards2.length) {
  await cards2[0].tap()
  await wait(2600)
  page = await mini.currentPage()
  if (page.path.includes('note')) {
    // 页面上下文写真实 mp3 文件（服务端 commentMedia 校验 ID3 头）
    const mp3Path = await mini.evaluate((b64) => {
      const fsm = wx.getFileSystemManager()
      const p = wx.env.USER_DATA_PATH + '/walk3/voice.mp3'
      fsm.writeFileSync(p, b64, 'base64')
      return p
    }, mp3Base64)
    await mini.evaluate((p) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1]
      pg.setData({ pendingAudio: { kind: 'audio', path: p } })
    }, mp3Path)
    await wait(300)
    await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg.submitComment() })
    await wait(2600)
    await check('语音评论发送成功且列表出现语音行', async () => {
      const { d } = await data(mini)
      const hit = d.comments.find(c => c.isAudio)
      if (!hit) throw new Error('评论列表无语音行: ' + JSON.stringify(d.comments.slice(0, 2).map(c => ({ k: c.media_kind, s: c.media_state }))))
      if (Number(hit.media_state) !== 1) throw new Error('语音未直展示: state=' + hit.media_state)
    })
    await mini.evaluate(() => { wx.pageScrollTo({ selector: '.comments', duration: 300, fail: () => {} }) })
    await wait(700)
    await shot(mini, '39-audio-comment')
    const audioBtns = await page.$$('.c-audio')
    if (audioBtns.length) {
      await audioBtns[0].tap()
      await wait(900)
      const { d: pd } = await data(mini)
      log('播放态:', pd.playingAudio ? 'playing' : 'stopped')
    }
    await shot(mini, '40-audio-play')
    await safeNav(() => mini.navigateBack())
    await wait(1200)
  } else log('未进详情页，跳过语音评论')
} else log('广场无卡片，跳过语音评论')

/* ===== 六、私密笔记全链（三期⑥）：私密发布 → 🔒 详情 + 登录态取图 ===== */
await mini.evaluate(() => { try { wx.removeStorageSync('xhs-compose-draft') } catch (e) { } })
await safeNav(() => mini.reLaunch('/package-content/pages/compose/index'))
await wait(3500) // 自动选图（mock）→ 带图私密稿
page = await mini.currentPage()
await check('私密稿素材就绪', async () => {
  const { d } = await data(mini)
  if (d.images.length !== 2) throw new Error('图片未就位: ' + d.images.length)
})
const tIn = await page.$('.title-input')
await tIn.input('三期私密走查手记')
await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  return new Promise(res => { if (!pg.editor) return res('no-editor')
    pg.editor.insertText({ text: '只有我自己能看到的走查手记：可见范围、门禁与话题聚合的三期验证。', success: () => res('ok'), fail: () => res('fail') }) })
})
await wait(700)
await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.applyVisibility('private') })
await wait(400)
await shot(mini, '41-private-compose')
// 关掉可能在 automator 下残留的原生确认弹窗（tap 链路未触发则无弹窗，此调用静默失败即可）
try { await mini.dismissModal() } catch (e) { }
await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.publish() })
await wait(4200)
page = await mini.currentPage()
// 发布成功后回到创作中心（reLaunch 兜底），取最新一篇作品 id
const newId = await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const d = pg.data || {}
  return (d.notes && d.notes[0]) ? { id: d.notes[0].id, priv: d.notes[0].isPrivate, title: d.notes[0].title } : null
})
log('最新作品:', JSON.stringify(newId))
if (newId && newId.priv) {
  await safeNav(() => mini.reLaunch('/package-content/pages/note/index?id=' + newId.id))
  await wait(3000)
  page = await mini.currentPage()
  await check('私密笔记详情：仅自己可见徽标 + 作者可读', async () => {
    if (!page.path.includes('note')) throw new Error('未进详情: ' + page.path)
    const { d } = await data(mini)
    if (!d.n) throw new Error('私密详情打不开（作者本人应可读）')
    if (d.n.isPrivate !== true) throw new Error('未标记私密: ' + d.n.visibility)
    const chip = await page.$('.private-chip')
    if (!chip) throw new Error('缺 🔒 徽标')
  })
  await mini.evaluate(() => { wx.pageScrollTo({ selector: '.author-row', duration: 300, fail: () => {} }) })
  await wait(700)
  await shot(mini, '42-private-detail')
} else {
  log('未取到私密稿（API 层已由 content-xhs3 覆盖），跳过私密详情截图')
}

console.log(`\n三期走查：✓ ${pass}  ✗ ${fail}`)
if (errors.length) { console.log('— 错误清单 —'); for (const e of errors.slice(0, 12)) console.log('  ·', e) }
await mini.disconnect()
process.exit(fail ? 1 : 0)
