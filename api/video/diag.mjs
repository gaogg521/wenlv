// 诊断：在无头浏览器里执行 seek，把异常栈打出来
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9344
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const STAGE = process.argv[2] || 'stage-v.html'
const VW = Number(process.env.VW || 1080), VH = Number(process.env.VH || 1920)

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}/edge-diag-${Date.now()}`,
  `--window-size=${VW},${VH}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pend = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id
  pend.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)) } }, 20000)
})

for (let k = 0; k < 30; k++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const p = list.find((t) => t.type === 'page')
    if (p) {
      ws = new WebSocket(p.webSocketDebuggerUrl, { maxPayload: 1 << 28 })
      await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString())
        if (m.id && pend.has(m.id)) { const h = pend.get(m.id); pend.delete(m.id); h.res(m.result) }
        if (m.method === 'Runtime.consoleAPICalled') {
          const a = (m.params.args || []).map((x) => x.value ?? x.description).join(' ')
          console.log('  [console]', m.params.type, a)
        }
        if (m.method === 'Runtime.exceptionThrown') {
          console.log('  [exception]', JSON.stringify(m.params.exceptionDetails).slice(0, 500))
        }
      })
      break
    }
  } catch { /* wait */ }
  await sleep(400)
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: VH > VW })
await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, STAGE)).href })
await sleep(1800)

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return { val: r.result?.value }
}

for (const t of [0.2, 3, 6, 13, 19, 25, 30, 36, 41, 44]) {
  const r = await ev(`(()=>{try{window.seek(${t});return 'ok'}catch(e){return 'ERR '+e.stack.split('\\n').slice(0,3).join(' | ')}})()`)
  console.log(`t=${t}  ${r.err ? 'EXC ' + r.err.split('\n')[0] : r.val}`)
}
const dom = await ev(`(()=>{window.seek(13);return JSON.stringify({scenes:[...document.querySelectorAll('.scene')].map(s=>s.id+':'+getComputedStyle(s).display)})})()`)
console.log('DOM:', dom.val || dom.err)

try { await send('Browser.close') } catch {}
try { ws.close() } catch {}
try { browser.kill() } catch {}
process.exit(0)
