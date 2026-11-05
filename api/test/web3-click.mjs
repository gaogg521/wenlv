// 可信存证各页「能不能点」回归（2026-11-05 用户再报：存证中心 / 链路总览事件动态 / 链与资产 / 积分台账里
// 业务单号、批次、链上编号点不进去）。web3-chain-ui.mjs 只守住了链路总览的区块节点。
//
// 做法同它：把 admin/pages/web3.js 放进 vm，桩掉 document / api，真把页面渲染出来再断言 HTML 与行为——
// grep 只能证明源码里写过 onclick，证明不了渲染出来还在。不碰数据库。
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADMIN = path.join(__dirname, '..', 'admin')
const read = (p) => fs.readFileSync(path.join(ADMIN, p), 'utf8')
const code = read('pages/web3.js'), css = read('app.css'), workspace = read('workspace.js'), dash = read('pages/dashboard.js')

let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

// ---- 桩 ----
const noop = () => {}
const mkEl = () => ({ innerHTML: '', hidden: false, dataset: {}, style: {}, classList: { add: noop, remove: noop, contains: () => false }, scrollIntoView: noop, appendChild: noop, setAttribute: noop, querySelectorAll: () => [], addEventListener: noop })
const app = mkEl()
let apiData = {}, toasts = [], calls = [], scrolls = [], domRows = [], hasDetailBox = true
const ctx = {
  document: { querySelector: () => mkEl(), getElementById: (id) => (id === 'blockDetail' && hasDetailBox ? mkEl() : null), createElement: mkEl, querySelectorAll: (sel) => (sel === '#blockDetail tbody tr' ? domRows : []), addEventListener: noop, body: mkEl() },
  window: {}, localStorage: { getItem: () => '', setItem: noop }, navigator: { clipboard: { writeText: () => Promise.resolve() } },
  console, setTimeout, clearInterval, setInterval, Date, Math, JSON, Number, String, Object, Array, Promise, innerHeight: 900, innerWidth: 1400,
}
ctx.esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))   // 与 core.js 的 esc 同一语义（不转义单引号）
ctx.toast = (m, err) => toasts.push({ m, err: !!err })
ctx.$ = (sel) => (sel === '#app' ? app : mkEl())
ctx.api = (m, url) => { calls.push(url); const v = apiData[url.split('?')[0]]; return Promise.resolve(typeof v === 'function' ? v(url) : (v ?? {})) }
ctx.go = noop
ctx.bizTag = (x) => String(x || '')
ctx.BIZ_CN = {}
ctx.skel = () => ''
ctx.emptyBox = (m) => `<div class="empty">${m}</div>`
ctx.runJob = noop
ctx.dxKey = vm.runInContext(dash.match(/^const dxKey = (.+?)\s*\/\//m)[1], vm.createContext({}))   // 从真实源码取，不手抄，免得漂移
ctx.globalThis = ctx
vm.createContext(ctx)
vm.runInContext(code, ctx, { filename: 'admin/pages/web3.js' })
const run = (src) => vm.runInContext(src, ctx)          // 顶层 const 不挂在 ctx 上，得在上下文里求值

const B = (o = {}) => ({ id: 7, seq: 3, biz_date: '2026-11-04', merkle_root: 'a'.repeat(64), prev_root: 'b'.repeat(64), leaf_count: 10, is_day_close: 0, status: 2, attempt: 0, chain_tx_ref: 'c'.repeat(64), ...o })
const EV = [
  { biz_type: 'order', biz_ref: 'WL20261104001', version_no: 50, status: 2, created_at: '2026-11-04 20:00:00', batch_id: 7, seq: 3, merkle_root: 'a'.repeat(64) },
  { biz_type: 'badge', biz_ref: 'mbadge-2-71', version_no: 1, status: 2, created_at: '2026-11-04 20:00:00', batch_id: 7, seq: 3, merkle_root: 'a'.repeat(64) },
  { biz_type: 'withdraw', biz_ref: 'wd-104', version_no: 1, status: 0, created_at: '2026-11-05 14:50:04', batch_id: null, seq: null, merkle_root: null },
]
const attrOk = (html, re, msg) => assert.match(html, re, msg)

console.log('== 存证中心 ==')
apiData['/admin/attest/center'] = { chainMode: 'real', chain: { mode: 'real', label: '蚂蚁链开放联盟链' }, queue: [], batches: [B(), B({ id: 8, seq: 4, chain_tx_ref: null, status: 1, prev_root: null })], dayRoots: [], recent: EV }
await t('批次表每一行都能点：onclick=openBlock(id) + 键盘可达 + 悬停高亮的 click-row', async () => {
  await run('attest()')
  const rows = app.innerHTML.match(/<tr class="click-row"[^>]*>/g) || []
  assert.equal(rows.length, 2, '两个批次应有两行可点')
  assert.match(rows[0], /onclick="openBlock\(7\)"/); assert.match(rows[1], /onclick="openBlock\(8\)"/)
  assert.match(rows[0], /role="link" tabindex="0"/, '键盘不可达')
  assert.match(css, /tbody tr\[onclick\]:hover, tbody tr\.click-row:hover/, '可点行没有悬停提示')
})
await t('openBlock 的落点 #blockDetail 在存证中心页里存在（否则点了也无处显示）', () => {
  assert.match(app.innerHTML, /<div id="blockDetail"><\/div>/)
})
await t('批次的 Merkle 根 / 前根 / 链上编号都能整串复制，且点复制不会冒泡触发整行', () => {
  const copies = app.innerHTML.match(/onclick="event\.stopPropagation\(\);copyText\([^"]*\)"/g) || []
  assert.ok(copies.length >= 3, '复制入口少于 3 处：' + copies.length)
  assert.ok(copies.some((c) => c.includes('c'.repeat(64))), '链上编号没有完整值可复制')
  assert.ok(app.innerHTML.includes('链起点'), '没有前根的批次应写链起点')
})
await t('最近事件：业务单号可点；已入批的事件带批次入口，待打包的没有批次入口但仍可就地验证', () => {
  const html = app.innerHTML
  assert.match(html, /onclick="openEvent\(&quot;order&quot;,&quot;WL20261104001&quot;,7,this\)"/, '已入批事件应带批次 id')
  assert.match(html, /onclick="openEvent\(&quot;withdraw&quot;,&quot;wd-104&quot;,0,this\)"/, '待打包事件批次 id 应为 0')
  assert.match(html, /<button class="ref-link"[^>]*onclick="openBlock\(7\)">#3<\/button>/, '「#3」批次号应可点')
  assert.ok(!/openBlock\(0\)|openBlock\(null\)/.test(html), '没有批次的事件不能挂一个打不开的批次入口')
})

console.log('== 链路总览·链上事件动态 ==')
apiData['/admin/web3/overview'] = { chain: { label: '蚂蚁链开放联盟链' }, chainMode: 'real', batches: 2, anchoredBatches: 2, events: 3, anchoredEvents: 2, pendingEvents: 1, badgeGrants: 0, beanGranted: 0, beanConsumed: 0, trustPath: [], recentEvents: EV }
await t('事件动态表的业务单号可点（你的截图里正是这张表点不进去）', async () => {
  await run('web3dash()')
  const sec = app.innerHTML.slice(app.innerHTML.indexOf('链上事件动态'))
  assert.equal((sec.match(/class="ref-link"/g) || []).length, 3, '三条事件的单号都该是可点的')
  assert.match(sec, /onclick="openEvent\(&quot;badge&quot;,&quot;mbadge-2-71&quot;,7,this\)"/)
})

await t('存证总览的顺序：总览与检索在最前，其后链路视图 → 区块详情 → 流水线 → 事件动态', async () => {
  await run('web3dash()')
  const h = app.innerHTML
  const seq = ['<h2>链上总览</h2>', 'id="attestQ"', 'id="attestResult"', '锚定批次', 'id="chainViz"', 'id="blockDetail"', '<h3>上链流水线</h3>', '链上事件动态'].map((k) => [k, h.indexOf(k)])
  for (const [k, i] of seq) assert.ok(i >= 0, '缺少：' + k)
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i - 1][1] < seq[i][1], seq[i - 1][0] + ' 应排在 ' + seq[i][0] + ' 前面')
})
await t('检索只有一个入口；单流程的说明只出现一次（原来有两个 flowMeta，文字跑到检索行里）；流水线默认折叠', async () => {
  await run('web3dash()')
  const h = app.innerHTML
  assert.equal((h.match(/id="flowMeta"/g) || []).length, 1)
  assert.ok(!h.includes('id="flowNo"'), '单流程不该再有第二个输入框')
  assert.match(h, /<details class="card pipe-fold" {2}ontoggle/, '流水线应默认收起')
  assert.match(h, /id="flowSec" class="flow-sec" hidden/, '没追踪订单时单流程区不占位')
})

console.log('== 验证结果：三态，不再把“待打包”说成“验证通过” ==')
const mkAnchor = () => { const chips = []; const parent = { querySelectorAll: () => ({ forEach: (f) => chips.splice(0).forEach(() => f({ remove: noop })) }) }; return { parentNode: parent, insertAdjacentHTML: (_, h) => chips.push(h), chips } }
const verify = async (resp) => { toasts = []; apiData['/admin/attest/verify'] = resp; const a = mkAnchor(); await run('verifyEventInline')('order', 'X', 0, a); return { toast: toasts[0], chip: a.chips[0] || '' } }
await t('已验证：证明与指纹都对得上 → 通过（绿）', async () => {
  const r = await verify({ found: true, proofValid: true, canonicalValid: true, note: '已锚定上链' })
  assert.match(r.toast.m, /^验证通过/); assert.equal(r.toast.err, false); assert.match(r.chip, /pill ok verify-chip/)
})
await t('待打包：没有证明路径 → 说“尚未入链”，绝不能说“验证通过”', async () => {
  const r = await verify({ found: true, proofValid: null, canonicalValid: true, note: '已入队待打包（小时级批次）' })
  assert.match(r.toast.m, /^尚未入链/); assert.ok(!r.toast.m.includes('验证通过'), '待打包被说成了验证通过')
  assert.match(r.chip, /pill warn verify-chip/); assert.match(r.chip, /已入队待打包/)
})
await t('失败：证明路径或叶指纹对不上 → 失败（红），两种原因都算', async () => {
  for (const resp of [{ found: true, proofValid: false, canonicalValid: true }, { found: true, proofValid: true, canonicalValid: false }]) {
    const r = await verify(resp)
    assert.match(r.toast.m, /^验证失败/); assert.equal(r.toast.err, true); assert.match(r.chip, /pill s70 verify-chip/)
  }
})
await t('查不到：明说未找到', async () => {
  const r = await verify({ found: false })
  assert.match(r.toast.m, /未找到/); assert.match(r.chip, /pill warn/)
})
await t('结果不只是 toast：留在被点的位置旁边，且重复点击替换旧结果而不是堆叠', async () => {
  const a = mkAnchor(); apiData['/admin/attest/verify'] = { found: true, proofValid: true, canonicalValid: true }
  await run('verifyEventInline')('order', 'X', 0, a); await run('verifyEventInline')('order', 'X', 0, a)
  assert.equal(a.chips.length, 1, '重复验证后旧 chip 没有被清掉')
})

console.log('== 点业务单号：打开所属批次、高亮、滚到可见 ==')
await t('已入批：先打开批次，再高亮批内那一行，并以 block:start 滚动（nearest/center 会被页头压住）', async () => {
  const opened = [], classes = []
  domRows = [{ children: [{}, {}, { textContent: ' WL-OTHER ' }], classList: { add: (c) => classes.push('other:' + c) }, scrollIntoView: noop, querySelector: () => null },
    { children: [{}, {}, { textContent: ' WL20261104001 ' }], classList: { add: (c) => classes.push(c) }, scrollIntoView: (o) => scrolls.push(o), querySelector: () => mkAnchor() }]
  ctx.openBlock = async (id) => { opened.push(id) }
  apiData['/admin/attest/verify'] = { found: true, proofValid: true, canonicalValid: true }
  await run('openEvent')('order', 'WL20261104001', 7, mkAnchor())
  assert.deepEqual(opened, [7]); assert.deepEqual(classes, ['ev-hit'], '只应高亮被点的那一行')
  assert.equal(scrolls.length, 1); assert.equal(scrolls[0].block, 'start')
})
await t('待打包：不开批次（它没有批次），直接就地验证给出“尚未入链”', async () => {
  const opened = []; ctx.openBlock = async (id) => { opened.push(id) }; toasts = []
  apiData['/admin/attest/verify'] = { found: true, proofValid: null, canonicalValid: true, note: '已入队待打包（小时级批次）' }
  await run('openEvent')('withdraw', 'wd-104', 0, mkAnchor())
  assert.deepEqual(opened, []); assert.match(toasts[0].m, /^尚未入链/)
})
await t('当前页没有 #blockDetail 时（例如别的页误调）不抛错、仍然验证', async () => {
  hasDetailBox = false; toasts = []; let threw = false
  ctx.openBlock = async () => {}
  try { await run('openEvent')('order', 'X', 7, mkAnchor()) } catch { threw = true } finally { hasDetailBox = true }
  assert.equal(threw, false); assert.ok(toasts.length === 1)
})

console.log('== 链与资产 / 积分发行台账 ==')
apiData['/admin/web3/assets'] = { chain: { label: '蚂蚁链开放联盟链', mode: 'real', capabilities: {} }, issued: 1, total: 1, pending: 0, failed: 0, kinds: [], channels: [],
  providers: [{ label: '蚂蚁链开放联盟链', capabilities: { anchor: true }, mode: 'real', current: true, docs: 'x' }], rows: [{ id: 1, kind: 'badge', channel: 'admin', provider: 'antchainopen', user_id: 7, tx_ref: 'd'.repeat(64), status: 1 }] }
apiData['/admin/web3/chain'] = { preflight: [{ id: 'antchainopen', label: '蚂蚁链开放联盟链', active: true, selfOk: true, missing: [], ask: ['q1'] }], summary: { ready: 1, total: 1 } }
await t('多链能力矩阵与预埋体检里的链名可点，直达链接入中心；台账交易号可整串复制', async () => {
  await run('chainAssetsPage()')
  const html = app.innerHTML
  assert.equal((html.match(/onclick="go\('chainhub'\)"/g) || []).length, 2, '矩阵 + 体检各一个入口')
  assert.match(html, /onclick="event\.stopPropagation\(\);copyText\([^"]*d{64}/, '台账交易号不能复制')
})
apiData['/admin/web3/point-assets'] = { holders: 1, budgets: [{ id: 5, name: '首批', total: 100, granted: 40, returned: 0, status: 1 }], globalCap: null, byBiz: [] }
await t('积分发行台账的发行批次可点，去预算管理', async () => {
  await run('pointassets()')
  assert.match(app.innerHTML, /<tr class="click-row"[^>]*onclick="go\('budgets'\)"/)
})
await t('跳转目标页面真实存在（不能点过去是 404）', () => {
  for (const r of ['chainhub', 'budgets', 'attest']) assert.ok(new RegExp('\\b' + r + '\\b').test(workspace), 'workspace.js 里没有 ' + r)
})

console.log('== 样式与滚动守则 ==')
await t('ref-link 像链接、ev-hit 有高亮；所有 scrollIntoView 仍是 block:start', () => {
  assert.match(css, /\.ref-link:hover \{ text-decoration: underline; \}/); assert.match(css, /tr\.ev-hit > td \{ background/); assert.match(css, /tr\.ev-hit \{ scroll-margin-top: 120px; \}/)
  const blocks = [...code.matchAll(/scrollIntoView\(\{ behavior: 'smooth', block: '(\w+)' \}\)/g)].map((m) => m[1])
  assert.ok(blocks.length >= 3 && blocks.every((b) => b === 'start'), '存在 block:' + blocks.filter((b) => b !== 'start'))
})
await t('所有放进 onclick 的业务值都经 w3Arg 转义：单号里带引号也不会拆坏属性', () => {
  const html = run(`evRefLink({ biz_type: 'order', biz_ref: 'A"B\\'C', batch_id: 1 })`)
  assert.ok(!/onclick="[^"]*A"B/.test(html), '引号没有被转义，属性被拆坏')
  assert.match(html, /A\\&quot;B/)
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
