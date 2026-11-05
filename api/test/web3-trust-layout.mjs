// 可信存证模块布局回归（2026-11-05 用户反馈）：
//   · 链路视图 S 型折行：块多不再靠横向滚动，奇数行反向、行尾 U 形转弯，块多自动紧凑
//   · 数字身份卡：卡上的数字可点（真实用户 → 打开档案；示例卡 → 只提示），徽章名不能注入 HTML
//   · 身份档案列表：数字身份 ↔ 旅豆账户同一行；未开户明确标注
//   · 侧栏 7 个入口合并成 4 个：子页作为页签，页签 / 合并表 / 模块清单三者一致
// 把 web3.js / operations.js 放进 vm 渲染真实函数再断言（不碰数据库、不起服务）。
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULE_GROUPS } from '../src/domain/modules.mjs'

const ADMIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'admin')
const read = (p) => fs.readFileSync(path.join(ADMIN, p), 'utf8')
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const noop = () => {}
const mkEl = () => ({ innerHTML: '', hidden: false, dataset: {}, style: {}, classList: { add: noop, remove: noop, contains: () => false }, scrollIntoView: noop, appendChild: noop, setAttribute: noop })
const toasts = [], apiCalls = [], drawers = []
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ctx = {
  document: { querySelector: () => mkEl(), getElementById: () => null, createElement: mkEl, querySelectorAll: () => [] },
  window: {}, localStorage: { getItem: () => '', setItem: noop }, navigator: {}, console, setTimeout, clearInterval, setInterval, Date, Math, JSON, Number, String, Object, Array, Promise,
  innerHeight: 900, innerWidth: 1400, esc,
  toast: (m, err) => toasts.push({ m, err: !!err }), $: () => mkEl(), go: noop, bizTag: (x) => String(x || ''), BIZ_CN: {}, skel: () => '', emptyBox: (m) => `<div class="empty">${m}</div>`,
  runJob: noop, dxKey: '', CITY_CN: { 310118: '上海·青浦' }, closeModal: noop, copyText: noop,
  drawer: (title, html) => drawers.push({ title, html }),
  api: (m, url) => { apiCalls.push(url); return Promise.resolve(ctx.__api ? ctx.__api(url) : {}) },
}
ctx.globalThis = ctx
vm.createContext(ctx)
vm.runInContext(read('pages/web3.js'), ctx, { filename: 'admin/pages/web3.js' })
const run = (src) => vm.runInContext(src, ctx)
const D = (n, branchAt = []) => Array.from({ length: n }, (_, i) => ({ html: `<div class="chain-node" id="n${i + 1}"></div>`, branch: branchAt.includes(i + 1) }))
const rowsOf = (html) => [...html.matchAll(/<div class="chain-row([^"]*)">/g)].map((m) => m[1].trim().split(/\s+/).filter(Boolean))

console.log('== 链路视图 S 型折行 ==')
await t('8 个块在 1200px：每行 4 个、2 行；第 2 行反向且是最后一行；第 1 行右侧转弯', () => {
  const html = ctx.chainTrackHTML(D(8), 1200)
  assert.match(html, /data-per="4"/); const rows = rowsOf(html)
  assert.equal(rows.length, 2); assert.deepEqual(rows[0], ['turn-r']); assert.deepEqual(rows[1], ['rev', 'last'])
  for (let i = 1; i <= 8; i++) assert.equal((html.match(new RegExp(`id="n${i}"`, 'g')) || []).length, 1, `块 ${i} 应恰好出现一次`)
})
await t('30 个块：进入紧凑模式；行反向与转弯左右交替；下一行行首是日终块时转弯多下沉一档', () => {
  const html = ctx.chainTrackHTML(D(30, [7, 13]), 1200)
  assert.match(html, /class="chain-track snake dense"/); const rows = rowsOf(html)
  assert.ok(rows.length >= 3)
  rows.forEach((r, i) => { assert.equal(r.includes('rev'), i % 2 === 1, `第 ${i + 1} 行方向`); if (i < rows.length - 1) assert.ok(r.includes(i % 2 ? 'turn-l' : 'turn-r'), `第 ${i + 1} 行转弯侧`); else assert.ok(r.includes('last')) })
  const per = Number(html.match(/data-per="(\d+)"/)[1])   // 第 7 块是第 2 行行首（per=6）→ 第 1 行应 turn-branch
  assert.equal(per, 6); assert.ok(rows[0].includes('turn-branch'), '下一行行首是日终块，转弯要多下沉')
  assert.ok(!rows[1].includes('turn-branch') || rows[2], '')
})
await t('空链给出提示；极窄也至少一行 2 个（不会退化成每行 1 个而无法折返）', () => {
  assert.match(ctx.chainTrackHTML([], 1200), /尚无区块/)
  assert.match(ctx.chainTrackHTML(D(5), 300), /data-per="2"/)
})
await t('CSS 配套：snake / 反向 / 转弯 / 紧凑都有规则，节点宽度走变量', () => {
  const css = read('app.css')
  for (const re of [/\.chain-track\.snake/, /\.chain-row\.rev \{ flex-direction: row-reverse/, /\.chain-row\.turn-r::after/, /\.chain-row\.turn-l::after/, /\.chain-node \{ width: var\(--nw, 188px\)/]) assert.match(css, re, String(re))
})

console.log('== 数字身份卡 ==')
const claims = { level: '探索者', levelNo: 3, growthBand: '1000–2999', memberSince: '2026-03', scope: 'travel', trips: 12, cities: 5, badges: ['初访古镇', '山海行者'] }
await t('真实用户的卡：等级 / 行程 / 城市 / 徽章 都可点，且带用户 id', () => {
  const svg = ctx.vcCardSvg(claims, { uid: 42, did: 'did:cn:wl:abc', status: '有效' })
  for (const k of ['level', 'trips', 'cities', 'badges']) assert.match(svg, new RegExp(`onclick="vcStatOpen\\(42,'${k}'\\)"`), k)
  assert.match(svg, /role="button" tabindex="0"/); assert.match(svg, /onkeydown=/)
})
await t('不给 uid 就不可点；basic 范围没有行程 / 城市入口；示例卡 uid=0', () => {
  assert.ok(!/vc-hit/.test(ctx.vcCardSvg(claims, {})))
  const basic = ctx.vcCardSvg({ ...claims, scope: 'basic' }, { uid: 1 })
  assert.ok(!/vcStatOpen\(1,'trips'\)/.test(basic) && !/vcStatOpen\(1,'cities'\)/.test(basic)); assert.match(basic, /vcStatOpen\(1,'level'\)/)
  assert.match(ctx.vcCardSvg(claims, { sample: true, uid: 0 }), /vcStatOpen\(0,'trips'\)/)
})
await t('徽章名含 HTML 时被转义（卡片是 innerHTML 渲染，不能注入）', () => {
  const svg = ctx.vcCardSvg({ ...claims, badges: ['<img src=x onerror=alert(1)>'] }, { uid: 1 })
  assert.ok(!/<img src=x/.test(svg)); assert.match(svg, /&lt;img src=x onerror=alert\(1\)&gt;/)
})
await t('点示例卡只提示、不请求接口；点真实卡请求档案并打开抽屉定位到对应一节', async () => {
  toasts.length = 0; apiCalls.length = 0; drawers.length = 0
  run("vcStatOpen(0, 'trips')"); assert.equal(toasts.length, 1); assert.match(toasts[0].m, /示例卡片/); assert.equal(apiCalls.length, 0)
  ctx.__api = (url) => ({ userId: 7, nickname: '旅友7', did: 'did:cn:wl:zzz', claims, level: { no: 3, name: '探索者', growth: 1500, from: 1000, to: 3000, nextName: '行者' }, memberSince: '2026-03-01 10:00:00',
    bean: { balance: 278, lifetime: 478, ledger: [{ tx_no: 't', direction: 1, amount: 278, after_bal: 278, biz_type: 1, biz_ref: 'WL1', created_at: '2026-11-05 20:32:00' }] },
    trips: [{ order_no: 'WL1', status: 40, city_code: 310118, title: '水乡一日游', at: '2026-11-05 10:00:00' }], cities: [{ city_code: 310118, n: 2 }],
    badges: [{ name: '水乡首游', rule_desc: '首次到访', granted_at: '2026-11-05 10:00:00', ref: 'WL1' }], vcs: [] })
  await run("vcStatOpen(7, 'bean')"); await new Promise((r) => setTimeout(r, 120))
  assert.ok(apiCalls.includes('/admin/web3/identity/7')); const html = drawers[drawers.length - 1].html
  for (const id of ['level', 'trips', 'cities', 'badges', 'bean', 'vcs']) assert.match(html, new RegExp(`id="vcsec-${id}"`), id)
  assert.match(html, /上海·青浦/); assert.match(html, /\+278/); assert.match(html, /消费返豆/)
})

console.log('== 身份档案列表（数字身份 ↔ 旅豆账户）==')
await t('同一行放 DID 与旅豆账户；没开户的明确写「未开户」；汇总说明账户数 ≠ 用户数', () => {
  const r = { total: 2, page: 1, size: 12, summary: { users: 40, beanAccounts: 24, vcHolders: 0 }, rows: [
    { userId: 1, nickname: '旅友1', did: 'did:cn:wl:aaaaaaaaaaaaaaaaaaaaaaaaaa', levelNo: 1, levelName: '探索者', beanBalance: 278, beanLifetime: 478, badges: 6, trips: 1, vcActive: 0, status: 1 },
    { userId: 2, nickname: '旅友2', did: 'did:cn:wl:bbbbbbbbbbbbbbbbbbbbbbbbbb', levelNo: 1, levelName: '探索者', beanBalance: null, beanLifetime: null, badges: 0, trips: 0, vcActive: 1, status: 1 }] }
  const h = ctx.idListHtml(r)
  assert.match(h, /用户 <b>40<\/b> · 旅豆账户 <b>24<\/b>/); assert.match(h, /未开户/); assert.match(h, /<b>278<\/b> \/ 478 豆/)
  assert.match(h, /vcIdentity\(1,'bean'\)/); assert.match(h, /vcIdentity\(1,'badges'\)/); assert.match(h, /vcIdentity\(1,'trips'\)/); assert.match(h, /有效 1/); assert.match(h, /未签发/)
  assert.match(h, /<button class="btn ghost sm" disabled onclick="vcIdentityList\(0\)">上一页/)
})

console.log('== 侧栏合并 ==')
const ops = vm.createContext({ document: { getElementById: () => mkEl(), querySelectorAll: () => [] }, esc })
vm.runInContext(read('operations.js'), ops, { filename: 'admin/operations.js' })
const keys = new Set(MODULE_GROUPS.flatMap(([, items]) => items.map(([k]) => k)))
const get = (n) => vm.runInContext(n, ops)
await t('页签 / 合并表 / 模块清单一致：子页都并入各自的父页；父页与子页都是真实模块；可信存证侧栏从 7 项变 4 项', () => {
  const merge = get('TRUST_MERGE'), tabs = get('TRUST_TABS'), label = get('TRUST_LABEL')
  for (const [child, parent] of Object.entries(merge)) {
    assert.ok(keys.has(child) && keys.has(parent), `${child} / ${parent} 必须是真实模块（权限模型不变）`)
    const grp = tabs.find(([p]) => p === parent); assert.ok(grp && grp[1].some(([k]) => k === child), `${child} 要出现在 ${parent} 的页签里`)
  }
  for (const [parent, list] of tabs) { assert.equal(list[0][0], parent, '首个页签就是父页'); for (const [k] of list) assert.ok(keys.has(k), k) }
  for (const p of Object.keys(label)) assert.ok(keys.has(p), p)
  const trust = MODULE_GROUPS.find(([g]) => g === '可信存证')[1].map(([k]) => k)
  assert.equal(trust.length, 7); assert.equal(trust.filter((k) => !merge[k]).length, 4)
})
await t('core.js / workspace.js 接线：隐藏合并子页但保留在 DOM；选中子页高亮父级；搜索不放出合并子页、能按别名搜到', () => {
  const core = read('core.js'), ws = read('workspace.js')
  assert.match(core, /nav-merged/); assert.match(core, /\$\{m \? 'hidden' : ''\}/); assert.match(core, /mergedUnder\(k\)/)
  assert.match(ws, /const navKey = .*TRUST_MERGE/); assert.match(ws, /button\.classList\.contains\('nav-merged'\)/); assert.match(ws, /button\.dataset\.alias/)
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
