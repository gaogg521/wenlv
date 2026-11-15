// UGC 演示环境全流水线走查（8080 真实通道 + 真实网络素材）：
//   真实图文×2 + 真实视频×1 → UI 发布（机审降级转人工）→ 后台审核通过（发豆）→ 广场/话题聚合
//   → 详情渲染（图/视频）→ 文字评论 + 点赞 → 语音评论预期错误路径（演示机无公网 HTTPS，真实通道无法提交媒体机审）
// 素材：Wikimedia Commons 真实照片（朱家角/乌镇）+ 真实上海延时视频（ffmpeg 转 25s/720p/4MB）
// 用法：AUTO_WS=ws://127.0.0.1:9421 node test/ugc-pipeline-demo-walk.mjs <outDir>
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || '../automator-shots-ugc-pipeline'
fs.mkdirSync(outDir, { recursive: true })
const MEDIA_DIR = process.env.DEMO_MEDIA_DIR || '../../../demo-media'
const log = (...a) => console.log('[pipe]', ...a)
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

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8080'
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { if (r.code !== 0) throw new Error((r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }

/* ---------- 后台登录（审核步骤用） ---------- */
let A = null
for (const pwd of [process.env.ADMIN_PASSWORD || 'admin123', 'change-admin-password']) {
  const r = await call('POST', '/admin/login', { username: 'admin', password: pwd })
  if (r.code === 0) { A = r.data.token; log('后台登录成功（口令候选命中）'); break }
}
if (!A) { console.error('后台登录失败，无法走审核段'); process.exit(1) }

/* ---------- 素材就位：真实文件 → base64 → USER_DATA_PATH（大文件分块写） ---------- */
const readB64 = f => fs.readFileSync(path.join(import.meta.dirname, MEDIA_DIR, f)).toString('base64')
const IMGS = {
  zj1: readB64('zhujiajiao-1.jpg'), zj2: readB64('zhujiajiao-2.jpg'), zj3: readB64('zhujiajiao-3.jpg'),
  wz1: readB64('wuzhen-1.jpg'), wz2: readB64('wuzhen-2.jpg'),
}
const VID = readB64('zhujiajiao-walk-video.mp4')
const VID_SIZE = Buffer.from(VID, 'base64').length
log('素材体积: 视频base64', (VID.length / 1048576).toFixed(1), 'MB')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) }
  catch (e) { log('等待通道…', i + 1); await wait(1000) }
}
if (!mini) { console.error('无法连接 ' + WS); process.exit(1) }
mini.on('console', msg => { if (msg.type === 'error') errors.push('[console.error] ' + (msg.args || []).join(' ').slice(0, 160)) })
mini.on('exception', e => errors.push('[exception] ' + (e.message || '').slice(0, 160)))

for (let i = 0; i < 60; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) { log('模拟器就绪:', p.path); break } } catch (e) { }
  await wait(1000)
}

// 真实登录口径：storage + globalData 双清（旧会话残留 token 若与演示 .env 同 JWT_SECRET 会继续有效，
// 用户会落回旧 mock 身份、机审走 mock 直通）；注销用 restoreWxMethod（mockWxMethod(x,null) 是注册
// null 结果 mock，会把 wx.login 挂死）
await mini.restoreWxMethod('login').catch(() => { })
await mini.restoreWxMethod('chooseMedia').catch(() => { })
await mini.evaluate(() => {
  wx.clearStorageSync()
  getApp().globalData.token = ''
  getApp().globalData.apiBase = 'http://127.0.0.1:8080'
})

let pipeCleaned = false
const writeFileChunked = async (name, b64) => {
  const p = await mini.evaluate((name) => {
    const fs = wx.getFileSystemManager()
    const dir = wx.env.USER_DATA_PATH + '/pipe'
    try { fs.mkdirSync(dir, true) } catch (e) { }
    return dir + '/' + name
  }, name)
  const step = 700000
  for (let i = 0; i < b64.length; i += step) {
    const slice = b64.slice(i, i + step)
    await mini.evaluate(({ p, slice, first }) => {
      const fs = wx.getFileSystemManager()
      if (first) fs.writeFileSync(p, slice, 'base64')
      else fs.appendFileSync(p, slice, 'base64')
      return true
    }, { p, slice, first: i === 0 })
  }
  return p
}

// devtools 沙箱 USER_DATA_PATH 总配额约 10MB——历史跑批残留（旧视频/日志/夹具）会把配额吃满，
// 每轮启动全清（assets 是代码包文件不受影响）
await mini.evaluate(() => {
  const fs = wx.getFileSystemManager()
  const root = wx.env.USER_DATA_PATH
  const wipe = (p) => {
    let items = []
    try { items = fs.readdirSync(p) } catch (e) { return }
    for (const it of items) {
      const full = p + '/' + it
      let stat = null
      try { stat = fs.statSync(full) } catch (e) { continue }
      if (stat.isDirectory()) { wipe(full); try { fs.rmdirSync(full) } catch (e) { } }
      else try { fs.unlinkSync(full) } catch (e) { }
    }
  }
  wipe(root)
  return true
})
const P = {}
for (const [k, b64] of Object.entries(IMGS)) P[k] = await writeFileChunked(k + '.jpg', b64)
P.video = await writeFileChunked('walk.mp4', VID)
log('夹具写入完成:', Object.keys(P).join(','))

// 真实登录触发：首页 ensureLogin（wx.login 真实 code → 真实 openid → 长期真实用户）
await safeNav(() => mini.reLaunch('/pages/home/index'))
await wait(3600)
const userMe = await mini.evaluate(async () => {
  const r = await new Promise((resolve) => wx.request({ url: getApp().globalData.apiBase + '/c/me', header: { Authorization: 'Bearer ' + (getApp().globalData.token || '') }, success: x => resolve(x.data) }))
  return r && r.code === 0 ? { id: r.data.id, nick: r.data.nickname } : null
})
log('走查用户:', JSON.stringify(userMe))
if (!userMe) { console.error('真实登录失败'); process.exit(1) }

/* ---------- compose 发布一次的公共流程 ---------- */
// files: [{path,size,duration?}], kind: 'image'|'video', { title, body, topics:[...], setCover } 
let pickSeq = 0
async function publishOne(kind, files, opts) {
  const mock = kind === 'video'
    ? { tempFiles: files, tempFilePaths: files.map(f => f.tempFilePath) }
    : { tempFiles: files, tempFilePaths: files.map(f => f.tempFilePath) }
  await mini.mockWxMethod('chooseMedia', mock)
  await safeNav(() => mini.reLaunch('/package-content/pages/compose/index'))
  await wait(3800)
  let page = await mini.currentPage()
  if (!page.path.includes('compose')) throw new Error('未进 compose: ' + page.path)
  if (kind === 'video') {
    // 进页自动 pickImages 会把 mock 的 video 文件过滤掉（图文/视频互斥），再 tap「视频」入口
    const entries = await page.$$('.entry-card')
    let vEntry = null
    for (const eCard of entries) { const s2 = await eCard.text(); if (s2.includes('视频')) { vEntry = eCard; break } }
    if (!vEntry) throw new Error('找不到视频入口卡')
    await vEntry.tap()
    await wait(3200)
  }
  // 标题
  const tIn = await page.$('.title-input')
  await tIn.input(opts.title)
  await wait(300)
  // 正文
  await mini.evaluate((text) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1]
    return new Promise(res => { if (!pg.editor) return res('no-editor')
      pg.editor.insertText({ text, success: () => res('ok'), fail: () => res('fail') }) })
  }, opts.body)
  await wait(700)
  // 话题（热门 chips 直接 tap；addTopic 选完自动关 sheet）
  if (opts.topics && opts.topics.length) {
    for (const t of opts.topics) {
      const sheetNow = await page.$('.topic-sheet')
      if (!sheetNow) {
        await (await page.$('.topic-add')).tap()
        await wait(800)
      }
      const opts_ = await page.$$('.topic-opt')
      let hit = null
      for (const o of opts_) { const s = await o.text(); if (s.replace('#', '').trim() === t) { hit = o; break } }
      if (hit) { await hit.tap(); await wait(500) }
      else {
        log('话题', t, '不在热门表，跳过（自定义弹窗 automator 不可驱动）')
        await page.tap('.sheet-mask').catch(() => { })
        await wait(400)
      }
    }
    const sheetEnd = await page.$('.topic-sheet')
    if (sheetEnd) await page.tap('.sheet-mask').catch(() => { })
    await wait(400)
  }
  // 封面（图文稿）
  if (opts.setCover) {
    const acts = await page.$$('.m-act')
    for (const a of acts) { const s = await a.text(); if (s.includes('设为封面')) { await a.tap(); break } }
    await wait(300)
  }
  await shot(mini, opts.shotPre)
  // 发布（底栏 CTA 在部分 devtools 版本 tap 会被吞——evaluate 直调兜底）
  await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.publish() })
  await wait(4500)
  page = await mini.currentPage()
  const after = await mini.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1]
    return { path: pg.route, hint: pg.data.barHint || '', busy: pg.data.busy }
  })
  log('发布后页面:', JSON.stringify(after))
  await mini.mockWxMethod('chooseMedia', null)
  return after
}

/* ===== 一、图文 N1：朱家角三图（真实网络照片） ===== */
let n1 = null
await check('N1 图文发布（真实朱家角三图 → 机审降级转人工）', async () => {
  await publishOne('image', [
    { tempFilePath: P.zj1, size: 331638, fileType: 'image' },
    { tempFilePath: P.zj2, size: 325329, fileType: 'image' },
    { tempFilePath: P.zj3, size: 375086, fileType: 'image' },
  ], { title: '朱家角半日·放生桥烟火', body: '放生桥上看船来船往，北大街的扎肉香气一路飘到城隍庙。石板路被下午的太阳晒得发亮，茶馆里评弹声刚好漫出窗外。', topics: ['古镇漫步', '人文历史'], setCover: true, shotPre: 'n1-compose' })
  // 服务端核验：最新一篇是本次发布、素材本人上传、带 cover
  const token = await mini.evaluate(() => getApp().globalData.token)
  const notes = ok(await call('GET', '/c/notes', null, token))
  const hit = notes.find(x => (x.title || '').includes('朱家角半日'))
  if (!hit) throw new Error('作品列表未见 N1')
  n1 = hit
  if (Number(hit.status) !== 1) throw new Error('降级口径：图文应转人工 status=1，实为 ' + hit.status)
  const pack = ok(await call('GET', `/admin/content/${hit.id}`, null, A))
  for (const u of (pack.note.images || [])) {
    const raw = u.split('?')[0]
    if (!raw.includes(`note_${userMe.id}_`)) throw new Error('素材非本人上传: ' + raw)
  }
})
await shot(mini, 'n1-published')

/* ===== 二、图文 N2：乌镇两图 ===== */
let n2 = null
await check('N2 图文发布（真实乌镇两图）', async () => {
  await publishOne('image', [
    { tempFilePath: P.wz1, size: 260212, fileType: 'image' },
    { tempFilePath: P.wz2, size: 540749, fileType: 'image' },
  ], { title: '乌镇西栅的水色清晨', body: '清晨的西栅几乎没有游客，摇橹船推开薄雾，染坊的蓝印花布晾在风里。沿河坐下吃了一碗羊肉面，整个江南都慢了下来。', topics: ['古镇漫步', '美食探店'], setCover: true, shotPre: 'n2-compose' })
  const notes = ok(await call('GET', '/c/notes', null, await mini.evaluate(() => getApp().globalData.token)))
  const hit = notes.find(x => (x.title || '').includes('乌镇西栅'))
  if (!hit) throw new Error('作品列表未见 N2')
  n2 = hit
  if (Number(hit.status) !== 1) throw new Error('降级口径：status 应为 1，实为 ' + hit.status)
})
await shot(mini, 'n2-published')

/* ===== 三、视频 N3：真实上海延时（25s/4MB） ===== */
let n3 = null
await check('N3 视频发布（真实延时视频 base64 上传 4MB）', async () => {
  await publishOne('video', [
    { tempFilePath: P.video, size: VID_SIZE, duration: 25, fileType: 'video' },
  ], { title: '外滩天际线延时·入夜前', body: '从午后拍到华灯初上，陆家嘴的天际线在延时里一寸寸亮起来。黄浦江上的船像慢慢移动的标点。', topics: ['人文历史'], shotPre: 'n3-compose' })
  const notes = ok(await call('GET', '/c/notes', null, await mini.evaluate(() => getApp().globalData.token)))
  const hit = notes.find(x => (x.title || '').includes('外滩天际线'))
  if (!hit) throw new Error('作品列表未见 N3')
  n3 = hit
  if (!hit.hasVideo) throw new Error('N3 未标记视频')
  if (Number(hit.status) !== 1) throw new Error('视频稿 manualReview 应转人工，实为 ' + hit.status)
})
await shot(mini, 'n3-published')

/* ===== 四、后台审核通过 ×3（发豆）+ 素材票据核验 ===== */
const beanBefore = await (async () => {
  const me = ok(await call('GET', '/c/me', null, await mini.evaluate(() => getApp().globalData.token)))
  return Number(me.bean || 0)
})()
await check('后台逐篇审核通过（含 revision 守卫）+ 发布发豆', async () => {
  for (const n of [n1, n2, n3]) {
    const pack = ok(await call('GET', `/admin/content/${n.id}`, null, A))
    assert2(pack.note && pack.note.revision != null, '审核材料缺 revision')
    // 审核素材走 note-review 票据：图文核验首图、视频稿核验视频位（video-only 稿 images 为空）
    const firstImg = (pack.note.images || [])[0]
    const firstVideo = pack.note.video
    const assetUrl = firstImg || firstVideo
    assert2(assetUrl && assetUrl.includes('media='), '审核素材未注入票据: ' + (assetUrl || '无素材'))
    const assetRes = await fetch(assetUrl.startsWith('http') ? assetUrl : BASE + assetUrl)
    assert2(assetRes.status === 200, '票据素材读取 ' + assetRes.status)
    const v = await call('POST', `/admin/content/${n.id}/verdict`, { pass: true, reason: '', revision: pack.note.revision }, A)
    assert2(v.code === 0, 'verdict 失败: ' + (v.msg || ''))
  }
  const me = ok(await call('GET', '/c/me', null, await mini.evaluate(() => getApp().globalData.token)))
  const gained = Number(me.bean || 0) - beanBefore
  log('发布奖励到账:', gained, '豆')
  // 发放路径核验：verdict 通过即逐篇发 20 豆；金额受 content.publish_reward_monthly_cap（月度防刷，默认10）
  // 与预算水位影响——演示老账号当月配额可能已用满（grantPublishReward 静默跳过 + reward_granted 留 0 待重试），金额 0/20/40/60 均合法
  assert2(Number.isInteger(gained) && gained >= 0 && gained <= 60 && gained % 20 === 0, '发豆金额异常: ' + gained)
  if (gained < 60) log('月度上限/预算封顶，实发', gained, '豆（发放路径由 content-xhs 断言与账本 biz_ref=note-<id> 覆盖）')
})
function assert2(cond, msg) { if (!cond) throw new Error(msg) }

/* ===== 五、广场与话题聚合（UI） ===== */
await safeNav(() => mini.reLaunch('/package-content/pages/square/index'))
await wait(3200)
let page = await mini.currentPage()
await check('广场瀑布流出现三条真实 UGC（封面/话题 chips）', async () => {
  for (let i = 0; i < 10; i++) {
    const { d } = await data(mini)
    const all = d.leftItems.concat(d.rightItems)
    if (all.some(x => (x.title || '').includes('朱家角半日')) && all.some(x => (x.title || '').includes('乌镇西栅')) && all.some(x => (x.title || '').includes('外滩天际线'))) return
    await wait(1200)
  }
  const { d } = await data(mini)
  throw new Error('广场未见三条: L' + d.leftItems.length + '/R' + d.rightItems.length)
})
await shot(mini, 'f1-square-pipeline')
// 话题聚合：搜"古镇漫步"
const input = await page.$('.topic-input')
await input.input('古镇漫步')
await wait(300)
await (await page.$('.topic-go')).tap()
await wait(2000)
await check('话题聚合过滤：三条按话题命中', async () => {
  const { d } = await data(mini)
  if (d.topic !== '古镇漫步') throw new Error('topic 未生效')
  const all = d.leftItems.concat(d.rightItems)
  if (!all.length) throw new Error('话题聚合为空')
  if (!all.every(x => (x.topics || []).includes('古镇漫步'))) throw new Error('混入无该话题的笔记')
})
await shot(mini, 'f2-topic-aggregate')

/* ===== 六、详情渲染 + 文字评论 + 点赞（UI tap） ===== */
// 图文详情：清筛选后进 N1
const tfClear = await page.$('.tf-clear')
await tfClear.tap()
await wait(2200)
page = await mini.currentPage()
const cards = await page.$$('.wf-card')
let n1Card = null
for (const c of cards) { const s = await c.text(); if (s.includes('朱家角半日')) { n1Card = c; break } }
await (n1Card || cards[0]).tap()
await wait(2800)
page = await mini.currentPage()
await check('N1 详情：真实图集渲染 + 评论/点赞可用', async () => {
  if (!page.path.includes('note')) throw new Error('未进详情: ' + page.path)
  const { d } = await data(mini)
  if (!d.n) throw new Error('详情数据空')
  if (!d.n.imagesFull.length) throw new Error('图集为空')
  if (!d.n.topicsReady.includes('古镇漫步')) throw new Error('话题缺失: ' + JSON.stringify(d.n.topicsReady))
})
await shot(mini, 'f3-note1-detail')
// 文字评论（真实机审）
const cInput = await page.$('.ab-input')
await cInput.input('请问放生桥傍晚拍是几点？光线太好了')
await wait(400)
const sendBtn = await page.$('.ab-send')
await sendBtn.tap().catch(async () => {
  await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.submitComment() })
})
await wait(2600)
await check('N1 文字评论发出（真实文本机审直通）', async () => {
  const { d } = await data(mini)
  if (!d.comments.some(c => (c.body || '').includes('放生桥傍晚'))) throw new Error('评论未入列: ' + JSON.stringify(d.comments.slice(0, 2).map(c => c.body)))
})
await shot(mini, 'f4-note1-comment')
// 点赞
await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.toggleLike() })
await wait(1200)
await check('N1 点赞成功', async () => {
  const { d } = await data(mini)
  if (!d.liked) throw new Error('liked 未置位')
})
await safeNav(() => mini.navigateBack())
await wait(1400)

// 视频详情
page = await mini.currentPage()
const cards3 = await page.$$('.wf-card')
let n3Card = null
for (const c of cards3) { const s = await c.text(); if (s.includes('外滩天际线')) { n3Card = c; break } }
await (n3Card || cards3[0]).tap()
await wait(3200)
page = await mini.currentPage()
await check('N3 详情：视频位渲染（Range 直读）', async () => {
  if (!page.path.includes('note')) throw new Error('未进详情: ' + page.path)
  const { d } = await data(mini)
  if (!d.n || !d.n.video) throw new Error('视频位为空: ' + JSON.stringify({ v: d.n && d.n.video }))
  if (!d.n.video.startsWith('http')) throw new Error('视频地址异常: ' + d.n.video)
  const probe = await fetch(d.n.video, { headers: { Range: 'bytes=0-1023' } })
  assert2(probe.status === 206 || probe.status === 200, '视频 Range 响应 ' + probe.status)
})
await shot(mini, 'f5-note3-video')
await safeNav(() => mini.navigateBack())
await wait(1400)

/* ===== 七、语音评论：真实通道预期错误路径（演示机无公网 HTTPS） ===== */
page = await mini.currentPage()
const cardsV = await page.$$('.wf-card')
let n2Card = null
for (const c of cardsV) { const s = await c.text(); if (s.includes('乌镇西栅')) { n2Card = c; break } }
await (n2Card || cardsV[0]).tap()
await wait(2800)
page = await mini.currentPage()
const voiceRes = await mini.evaluate((b64) => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const fsx = wx.getFileSystemManager()
  const p = wx.env.USER_DATA_PATH + '/pipe/voice.mp3'
  fsx.writeFileSync(p, b64, 'base64')
  pg.setData({ pendingAudio: { kind: 'audio', path: p } })
  return new Promise(res => { pg.submitComment(); setTimeout(() => res({ msg: pg.data.commentMsg, busy: pg.data.commentBusy }), 6500) })
}, Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(64, 0)]).toString('base64'))
await check('语音评论：真实通道预期失败（机审提交不可达）且错误提示明确', async () => {
  if (!voiceRes.msg) throw new Error('无错误提示（既没成功也没报错）: ' + JSON.stringify(voiceRes))
  if (!/媒体审核/.test(voiceRes.msg)) throw new Error('错误提示不含媒体审核语义: ' + voiceRes.msg)
})
log('语音评论错误信息:', voiceRes.msg)
await shot(mini, 'f6-voice-expected-fail')

console.log(`\n演示流水线：✓ ${pass}  ✗ ${fail}`)
if (errors.length) { console.log('— 错误清单 —'); for (const e of errors.slice(0, 12)) console.log('  ·', e) }
await mini.disconnect()
process.exit(fail ? 1 : 0)
