// compose 视频剪辑面板 automator 走查（三期收尾）
import automator from 'miniprogram-automator'
import fs from 'node:fs'
const wait = ms => new Promise(r => setTimeout(r, ms))
const outDir = '../automator-shots-ux-pages'
const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const shot = async name => { await mini.screenshot({ path: outDir + '/' + name + '.png' }); console.log('截图', name) }
let pass = 0, fail = 0
const check = async (name, fn) => { try { await fn(); pass++; console.log('✓', name) } catch (e) { fail++; console.log('✗', name, e.message) } }
const data = async () => { const p = await mini.currentPage(); return { p, d: await p.data() } }

// 视频夹具写入沙箱
const mp4b64 = fs.readFileSync('test/fixtures/vtrim-src.mp4').toString('base64')
const vpath = await mini.evaluate(async (b64) => {
  const fsm = wx.getFileSystemManager()
  const dir = wx.env.USER_DATA_PATH + '/vetest'
  try { fsm.mkdirSync(dir, true) } catch (e) { }
  const p = dir + '/v.mp4'
  const step = 700000
  for (let i = 0; i < b64.length; i += step) {
    if (i === 0) fsm.writeFileSync(p, b64.slice(0, step), 'base64')
    else fsm.appendFileSync(p, b64.slice(i, i + step), 'base64')
  }
  return p
}, mp4b64)
console.log('夹具:', vpath)

await mini.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: vpath, size: 15257, duration: 3, fileType: 'video' }], tempFilePaths: [vpath] })
await mini.reLaunch('/package-content/pages/compose/index')
await wait(3600)
let page = await mini.currentPage()
// 进页自动 pickImages 会因 mock 是 video 被过滤 → 点「视频」入口
const entries = await page.$$('.entry-card')
for (const eCard of entries) { const s = await eCard.text(); if (s.includes('视频')) { await eCard.tap(); break } }
await wait(3200)
page = await mini.currentPage()

await check('视频稿就位（剪辑入口可见）', async () => {
  const { d } = await data()
  if (!d.video || !d.video.url) throw new Error('视频未上传: ' + JSON.stringify(d.video || {}))
})
await shot('u1-video-entry')

await mini.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.openVideoEdit() })
await wait(2200)
await check('剪辑面板打开（slider/滤镜/贴纸/BGM 就绪）', async () => {
  const { d } = await data()
  if (!d.videoEdit) throw new Error('面板未开')
  if (!d.videoEdit.duration) throw new Error('duration 未就绪')
})
await shot('u2-ve-panel')

await mini.evaluate(() => {
  const pg = getCurrentPages()[getCurrentPages().length - 1]
  pg.setData({ 'videoEdit.end': 2, 'videoEdit.look': 'warm', 'videoEdit.sticker': 'scenic', 'videoEdit.music': true, 'videoEdit.caption': '剪辑走查片段' })
  return pg.applyVeTrim()
})
await wait(14000) // ffmpeg 出片预算
await check('剪辑生成成功（视频位替换为新 url + 票据 src）', async () => {
  const { d } = await data()
  if (d.videoEdit) throw new Error('面板未关闭')
  if (!d.video || !d.video.url) throw new Error('视频位空')
  if (!d.video.src.includes('media=')) throw new Error('src 未带票据: ' + d.video.src)
})
await shot('u3-ve-done')
console.log('剪辑走查:', pass, '/', pass + fail)
await mini.disconnect()
process.exit(fail ? 1 : 0)
