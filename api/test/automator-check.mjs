// 自动化自检：连接微信开发者工具模拟器，逐页驱动 + 截屏
// 运行：node test/automator-check.mjs <projectPath> <pages...>
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const project = process.argv[2]
const outDir = process.argv[3] || './automator-shots'
const pages = process.argv.slice(4)
fs.mkdirSync(outDir, { recursive: true })

const log = (...a) => console.log('[auto]', ...a)
const shot = async (mini, name) => {
  const p = path.join(outDir, name + '.png')
  const buf = await mini.screenshot({ path: p })
  log('截图', name, '->', p, buf ? '' : '')
  return p
}

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
let mini = null
// 冷启动时自动化端口可能要 30s+ 才真正可用，重试预算给足 40s（15s 会偶发连不上）
for (let i = 0; i < 40 && !mini; i++) {
  try { mini = await automator.connect({ wsEndpoint: WS }) }
  catch (e) { log('等待自动化通道…', i + 1); await new Promise((r) => setTimeout(r, 1000)) }
}
if (!mini) { console.error('无法连接自动化端口 ' + WS); process.exit(1) }
log('已连接模拟器')
const sys = await mini.systemInfo()
log('模拟器:', sys.platform, sys.SDKVersion)

// 冷启动时模拟器可能还没有活动页面；此时 reLaunch 会让自动化会话崩掉
// （报 getPageMetaByWebviewId(...) 为 null，之后整条通道失联）。等条件，不等时间。
for (let i = 0; i < 60; i++) {
  try {
    const p = await mini.currentPage()
    if (p && p.path) { log('模拟器就绪:', p.path); break }
  } catch (e) { /* 还没起来，继续等 */ }
  if (i % 10 === 0) log('等待模拟器出首屏…', i + 1)
  await new Promise((r) => setTimeout(r, 1000))
}

const results = []
for (const pg of pages) {
  try {
    const page = await mini.reLaunch(pg)
    await new Promise((r) => setTimeout(r, 1800))
    const cur = page.path
    const name = pg.replace(/\//g, '_').replace(/^_/, '') || 'home'
    await shot(mini, name)
    results.push({ pg, ok: true, cur })
    log('OK', pg, '->', cur)
  } catch (e) {
    results.push({ pg, ok: false, err: e.message })
    log('FAIL', pg, e.message)
  }
}
// 首页数据断言：线路卡片数量
try {
  await mini.reLaunch('/pages/home/index')
  await new Promise((r) => setTimeout(r, 2000))
  const page = await mini.currentPage()
  const items = await page.$$('.tour-item')
  log('首页线路卡片数:', items.length)
  const hi = await page.$('.hero .hi')
  log('首页问候语:', hi ? await hi.text() : '(未找到)')
  const cover = await page.$('.tour-cover')
  log('封面样式类:', cover ? await cover.attribute('class') : '(未找到)')
  const price = await page.$('.tour-price')
  log('首个价格:', price ? await price.text() : '(未找到)')
  await shot(mini, 'home-final')
  results.push({ home: { cards: items.length } })
} catch (e) { log('首页断言失败:', e.message) }

console.log('RESULT ' + JSON.stringify(results))
process.exit(0)
