// 探针：验证能否通过 CDP 拿到高分辨率小程序截图（视频素材用）
// 目标：deviceScaleFactor 提升后截图为 375*3 = 1125 宽，替代默认 197 宽的糊图
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const OUT = path.join(process.cwd(), 'video', 'assets')
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[probe]', ...a)

let mini = null
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) }
  catch { await sleep(1000) }
}
if (!mini) { console.error('无法连接 ' + WS); process.exit(1) }
log('已连接')

for (let i = 0; i < 40; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) { log('就绪:', p.path); break } } catch {}
  await sleep(1000)
}

// 1) 默认截图（基线）
await mini.reLaunch('/pages/home/index')
await sleep(2500)
await mini.screenshot({ path: path.join(OUT, '_base-home.png') })
const sz = (f) => { const b = fs.readFileSync(f); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) }

// 2) CDP 通道：尝试设 deviceScaleFactor 后截图
try {
  const cdp = mini.CDP()
  await cdp.enable()
  log('CDP 已启用')
  let shot = null
  for (const dsf of [3, 2]) {
    try {
      await cdp.sendCommand('Emulation', 'setDeviceMetricsOverride', {
        width: 375, height: 812, deviceScaleFactor: dsf, mobile: true,
      })
      await sleep(600)
      const r = await cdp.sendCommand('Page', 'captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const buf = Buffer.from(r.data, 'base64')
      fs.writeFileSync(path.join(OUT, `_cdp-home-${dsf}x.png`), buf)
      log(`CDP ${dsf}x 截图写入`, (buf.length / 1024).toFixed(0) + 'KB', sz(path.join(OUT, `_cdp-home-${dsf}x.png`)))
      shot = dsf
      break
    } catch (e) {
      log(`CDP ${dsf}x 失败:`, String(e.message).slice(0, 120))
    }
  }
  if (!shot) log('CDP 截图未成功')
} catch (e) {
  log('CDP 不可用:', String(e.message).slice(0, 140))
}

log('基线', sz(path.join(OUT, '_base-home.png')))
process.exit(0)
