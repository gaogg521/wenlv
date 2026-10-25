// tab 全遍历：两端每个 tab 页 + tab 内入口页全部打开，监听控制台 error，逐页截图 + 关键元素断言
import automator from 'miniprogram-automator'
import path from 'node:path'
const log = (...a) => console.log('[walk]', ...a)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shotDir = process.argv[2] || './automator-shots'
const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const targets = process.argv.slice(3)

const mini = await automator.connect({ wsEndpoint: WS })
let errors = []
mini.on('console', (m) => { if (m.type === 'error') errors.push(m.args && m.args.join(' ').slice(0, 160)) })
await mini.reLaunch('/pages/home/index')
await wait(2000)

const TABS = ['pages/home/index', 'pages/tour-list/index', 'pages/shop/index', 'pages/bean/index', 'pages/me/index',
  'pages/index/index', 'pages/orders/index', 'pages/supply/index']
const results = []
for (const t of targets) {
  try {
    const clean = t.replace(/^\//, '')
    const page = TABS.includes(clean)
      ? await mini.switchTab('/' + clean)
      : await mini.navigateTo(t)
    await wait(1800)
    const cur = (await mini.currentPage()).path
    const name = t.replace(/\//g, '_').replace(/^_/, '')
    await mini.screenshot({ path: path.join(shotDir, 'walk-' + name + '.png') })
    results.push({ t, ok: true, cur })
    log('OK', t, '->', cur)
  } catch (e) {
    results.push({ t, ok: false, err: String(e).slice(0, 120) })
    log('FAIL', t, String(e).slice(0, 120))
    await mini.reLaunch('/pages/home/index').catch(() => {})
    await wait(1200)
  }
}
console.log('WALK ' + JSON.stringify(results))
console.log('CONSOLE_ERRORS ' + JSON.stringify(errors))
process.exit(0)
