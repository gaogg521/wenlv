// 启动校验：连接多个自动化通道，确认每个小程序都真的跑起来了
// 运行：MSYS_NO_PATHCONV=1 node test/check-launch.mjs <名字:ws地址> ...
// 例：node test/check-launch.mjs mini-a:ws://127.0.0.1:9421 mini-b:ws://127.0.0.1:9422
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[launch]', ...a)
const outDir = './launch-shots'
fs.mkdirSync(outDir, { recursive: true })

const targets = process.argv.slice(2)
if (!targets.length) { console.error('用法: node test/check-launch.mjs <名字:ws地址> ...'); process.exit(1) }

let bad = 0
for (const t of targets) {
  const [name, ws] = t.split(':ws')
  const endpoint = 'ws' + ws
  let mini = null
  for (let i = 0; i < 40 && !mini; i++) {
    try { mini = await automator.connect({ wsEndpoint: endpoint }) } catch (e) { await wait(1000) }
  }
  if (!mini) { log(`✗ ${name}（${endpoint}）连不上`); bad++; continue }

  // 等首屏（冷启动时模拟器还没出页）
  let ready = ''
  for (let i = 0; i < 60; i++) {
    try { const p = await mini.currentPage(); if (p && p.path) { ready = p.path; break } } catch (e) {}
    await wait(1000)
  }
  if (!ready) { log(`✗ ${name} 连上了但 60s 没出首屏`); bad++; continue }

  const sys = await mini.systemInfo()
  const file = path.join(outDir, name + '.png')
  try { await mini.screenshot({ path: file }) } catch (e) { log('截图失败', e.message) }
  log(`✓ ${name} 已启动  SDK=${sys.SDKVersion}  首屏=${ready}  截图=${file}`)
}

log(bad === 0 ? `全部启动成功（${targets.length} 个）` : `${bad}/${targets.length} 个启动失败`)
process.exit(bad === 0 ? 0 : 1)
