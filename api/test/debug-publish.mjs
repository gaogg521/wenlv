// 发布链路单点调试：临时文件夹具 + 直探 POST /c/notes 响应
import automator from 'miniprogram-automator'
const log = (...a) => console.log('[dbg]', ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))
const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const errors = []
mini.on('console', m => { if (m.type === 'error') errors.push((m.args || []).join(' ').slice(0, 300)) })

// 1. 代码包照片读出 → 写入 USER_DATA_PATH（真实临时文件：fs 可读、image 可渲染）
const copies = await mini.evaluate(() => new Promise(res => {
  try {
    const fs = wx.getFileSystemManager()
    const dir = wx.env.USER_DATA_PATH + '/walk'
    try { fs.mkdirSync(dir, true) } catch (e) { /* 已存在 */ }
    for (const [src, dst] of [['assets/photos/water-town.jpg', dir + '/1.jpg'], ['assets/photos/zongzi.jpg', dir + '/2.jpg']])
      fs.writeFileSync(dst, fs.readFileSync(src))
    res({ ok: true })
  } catch (e) { res({ fail: e.message }) }
}))
log('临时文件复制:', JSON.stringify(copies))
if (copies.fail) process.exit(1)

// 2. mock chooseMedia 指向 USER_DATA_PATH 真实临时文件
const p1 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk/1.jpg')
const p2 = await mini.evaluate(() => wx.env.USER_DATA_PATH + '/walk/2.jpg')
await mini.mockWxMethod('chooseMedia', {
  tempFiles: [ { tempFilePath: p1, size: 52364, fileType: 'image' }, { tempFilePath: p2, size: 34424, fileType: 'image' } ],
  tempFilePaths: [p1, p2],
})

// 3. 进入 compose
let page = await mini.reLaunch('/package-content/pages/create/index')
await wait(2200)
await (await page.$('.compose-btn')).tap()
await wait(3500)
page = await mini.currentPage()
log('page:', page.path)
const d = await page.data()
log('images:', d.images.length, 'uploading:', d.uploadingCount, 'canIdeas:', d.canIdeas)

// 4. 造 AI 结果 → 应用 → 话题（全部在页面上下文执行，this 绑定正确）
const staged = await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  pg.setData({ visionResult: { title: '走查测试标题', text: '这是走查测试的正文内容，用来验证发布链路是否通畅。', reason: '调试', guide: false }, showIdeas: false, topics: ['走查'] })
  pg.applyIdea()
  pg.refresh()
  return { canPublish: pg.data.canPublish, images: pg.data.images.length, title: pg.data.title, bodyLen: pg.data.bodyLen, busy: pg.data.busy }
})
log('staged:', JSON.stringify(staged))
await wait(600)

// 5. 直探发布请求
const probe = await mini.evaluate(async () => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  const html = await new Promise(res => pg.editor && pg.editor.getContents({ success: c => res(c.html), fail: () => res('') }))
  const payload = { title: String(pg.data.title || '').trim(), blocks: [{ type: 'text', html }],
    images: pg.data.images.filter(x => x.url && !x.failed).map(x => x.url),
    video: pg.data.video ? pg.data.video.url : null, topics: pg.data.topics,
    coverIndex: pg.data.coverIndex, relatedProductId: pg.data.relatedProductId }
  const r = await new Promise(res => wx.request({
    url: getApp().globalData.apiBase + '/c/notes', method: 'POST',
    header: { 'content-type': 'application/json', authorization: 'Bearer ' + (wx.getStorageSync('token') || '') },
    data: payload, success: res, fail: e => res({ statusCode: 0, data: { errMsg: e.errMsg } }) }))
  return { status: r.statusCode, resp: r.data, imgCount: payload.images.length, titleLen: payload.title.length,
    plainLen: html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length, canPublish: pg.data.canPublish }
})
log('发布探测:', JSON.stringify(probe, null, 1).slice(0, 600))
log('console errors:', errors.slice(0, 5))
await mini.mockWxMethod('chooseMedia', null)
await mini.disconnect()
