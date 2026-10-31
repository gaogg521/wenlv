// 逐帧渲染：CDP 驱动无头 Edge，按时间轴 seek 后截图
// ── 为什么不用 CSS 动画录制 ──
//   录屏会受到机器负载抖动，同一段文字两次跑出来的帧不一样；
//   而这里的每一帧都由 seek(t) 算出来，可重跑、可对比、可定点返工。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRAMES = path.join(__dirname, 'frames')
const OUT_QA = path.join(__dirname, 'qa')
const PORT = Number(process.env.CDP_PORT || 9333)
const FPS = Number(process.env.FPS || 30)
const DURATION = Number(process.env.DURATION || 90)
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
// 竖版 9:16 与横版 16:9 共用同一套时间轴：只换画布与舞台文件
const VW = Number(process.env.VW || 1920)
const VH = Number(process.env.VH || 1080)
const STAGE = process.env.STAGE || 'stage.html'

const mode = process.argv[2] || 'all'
const QA_TIMES = (process.argv[3] || '2,12,26,38,50,63,74,82,88').split(',').map(Number)

fs.mkdirSync(FRAMES, { recursive: true })
fs.mkdirSync(OUT_QA, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 启动浏览器 ── */
const userDir = path.join(process.env.TEMP || 'C:/tmp', 'edge-video-' + Date.now())
const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${VW},${VH}`, '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' })

let ws = null
const pending = new Map()
let msgId = 0

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)) } }, 60000)
})

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
        ws.on('message', (raw) => {
          const m = JSON.parse(raw.toString())
          if (m.id && pending.has(m.id)) {
            const { resolve, reject } = pending.get(m.id)
            pending.delete(m.id)
            m.error ? reject(new Error(m.error.message)) : resolve(m.result)
          }
        })
        return
      }
    } catch { /* 还没起来 */ }
    await sleep(400)
  }
  throw new Error('无法连接 CDP ' + PORT)
}

async function main() {
  await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: 1, mobile: VH > VW,
  })

  const url = pathToFileURL(path.join(__dirname, STAGE)).href
  console.log(`▶ 打开舞台 ${STAGE} @ ${VW}×${VH}`)
  await send('Page.navigate', { url })
  await sleep(1200)

  // 等字体与图片就绪（缺图会渲成空白，必须挡住）
  await send('Runtime.evaluate', {
    expression: 'window.__ready', awaitPromise: true, timeout: 30000,
  })
  await send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(()=>1)', awaitPromise: true, timeout: 30000,
  })
  const dim = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,dpr:devicePixelRatio})',
    returnByValue: true,
  })
  console.log('  画布尺寸', dim.result.value)

  const shoot = async (t, quality = 92) => {
    await send('Runtime.evaluate', { expression: `window.seek(${t})` })
    const r = await send('Page.captureScreenshot', {
      format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false,
    })
    return Buffer.from(r.data, 'base64')
  }

  /* ── QA 模式：只出几个时间点的静帧 ── */
  if (mode === 'qa') {
    for (const t of QA_TIMES) {
      const buf = await shoot(t, 95)
      const f = path.join(OUT_QA, `t${String(t).padStart(5, '0')}.jpg`)
      fs.writeFileSync(f, buf)
      console.log(`  静帧 ${t}s → ${f} (${(buf.length / 1024).toFixed(0)}KB)`)
    }
    await finish(0)
    return
  }

  /* ── 全量渲染 ── */
  const total = Math.round(DURATION * FPS)
  const t0 = Date.now()
  for (let i = 0; i < total; i++) {
    const t = i / FPS
    const buf = await shoot(t)
    fs.writeFileSync(path.join(FRAMES, 'f' + String(i + 1).padStart(5, '0') + '.jpg'), buf)
    if (i % 90 === 0 || i === total - 1) {
      const el = (Date.now() - t0) / 1000
      const eta = i > 0 ? (el / i) * (total - i) : 0
      console.log(`  帧 ${i + 1}/${total} · ${(i / FPS).toFixed(1)}s · 已用 ${el.toFixed(0)}s · 预计余 ${eta.toFixed(0)}s`)
    }
  }
  console.log(`✓ ${total} 帧完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  await finish(0)
}

async function finish(code) {
  try { await send('Browser.close') } catch { /* ignore */ }
  try { ws && ws.close() } catch { /* ignore */ }
  try { browser.kill() } catch { /* ignore */ }
  await sleep(500)
  try { fs.rmSync(userDir, { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(code)
}

main().catch(async (e) => {
  console.error('✗ 渲染失败:', e.message)
  await finish(1)
})
