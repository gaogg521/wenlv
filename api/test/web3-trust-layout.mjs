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
await t('30 个块：每行 10 个、正好 3 行；行反向与转弯左右交替；下一行行首是日终块时转弯多下沉一档', () => {
  const html = ctx.chainTrackHTML(D(30, [11, 21]), 1200)
  assert.match(html, /class="chain-track snake tier-sm"/); const rows = rowsOf(html)
  assert.equal(rows.length, 3); assert.match(html, /data-per="10"/)
  rows.forEach((r, i) => { assert.equal(r.includes('rev'), i % 2 === 1, `第 ${i + 1} 行方向`); if (i < rows.length - 1) assert.ok(r.includes(i % 2 ? 'turn-l' : 'turn-r'), `第 ${i + 1} 行转弯侧`); else assert.ok(r.includes('last')) })
  assert.ok(rows[0].includes('turn-branch') && rows[1].includes('turn-branch'), '下一行行首是日终块，转弯要多下沉')
  for (let i = 1; i <= 30; i++) assert.equal((html.match(new RegExp(`id="n${i}"`, 'g')) || []).length, 1, `块 ${i} 应恰好出现一次`)
})
await t('高度上限：不同数量 / 宽度下的行数与档位（块少用大块，放不下 3 行才缩小；缩小后每行最多 10 块）', () => {
  const plan = (n, W) => { const p = ctx.chainPlan(n, W); return { per: p.per, nw: p.nw, tier: p.tier, rows: Math.ceil(n / p.per) } }
  const sample = [[12, 1200], [13, 1200], [20, 1200], [29, 1050], [30, 1050], [30, 1400], [30, 2400], [8, 1200], [1, 1200]]
  for (const [n, W] of sample) assert.ok(plan(n, W).rows <= 3, `${n} 块 / ${W}px 超过了 3 行：${JSON.stringify(plan(n, W))}`)
  for (const [n, W] of sample) assert.ok(plan(n, W).per <= 10, '每行不超过 10')
  assert.equal(plan(12, 1200).tier, 'full'); assert.equal(plan(12, 1200).nw, 188, '12 块还放得下大块，不缩')
  assert.equal(plan(20, 1200).per, 7); assert.equal(plan(20, 1200).tier, 'md')
  assert.equal(plan(30, 1050).per, 10); assert.equal(plan(30, 1050).tier, 'sm'); assert.ok(plan(30, 1050).nw >= 70)
  assert.ok(plan(30, 1050).nw * 10 + 14 * 9 + 80 <= 1050, '10 块必须真的放得进 1050px')
  for (const W of [993, 1106, 1300, 1600]) { const p = plan(30, W); assert.equal(p.per, 10, W + 'px 也要排满 10 块'); assert.equal(p.rows, 3); assert.ok(p.nw * 10 + 14 * 9 + 80 <= W, W + 'px 放得进') }
  const narrow = plan(30, 700)
  assert.ok(narrow.per < 10 && narrow.rows > 3, '窄屏放不下 10 块时按宽度折行（兜底），而不是溢出')
  assert.ok(narrow.nw * narrow.per + 14 * (narrow.per - 1) + 80 <= 700)
  assert.match(ctx.chainTrackHTML(D(8), 1200), /tier-full/)
})
await t('缩小后纵向尺寸跟着降：连线 / 转弯 / 分支下沉都走 CSS 变量，不写死 59 / 133', () => {
  const link = ctx.blockLinkHTML(false, true)
  assert.match(link, /height:var\(--sink\)/); assert.match(link, /top:calc\(var\(--cy\) - 1px\)/)
  assert.match(ctx.blockLinkHTML(false, false), /top:calc\(var\(--cy\) - 1px\)/)
  assert.match(ctx.blockLinkHTML(true, true), /var\(--cy\) \+ var\(--sink\)/)
  assert.ok(!/\b(59|133)px/.test(link + ctx.blockLinkHTML(true, false)), '不该再写死像素位置')
  const css = read('app.css')
  for (const re of [/\.chain-track\.tier-sm \{ --cy: \d+px; --sink: \d+px;/, /\.chain-track\.tier-md \{ --cy:/, /top: var\(--cy\); width: 30px; height: calc\(100% \+ var\(--te\) - var\(--cy\)\)/, /\.chain-node\.branch \{ margin-top: var\(--sink/, /--te: calc\(var\(--cy\) \+ var\(--sink\)\)/]) assert.match(css, re, String(re))
})
await t('档位里的节点内容：sm 只留标题 / 月日 / 事件数 / 1 个环节 / 状态；full 全有；日终块 sm 写「封存」', () => {
  const b = { id: 5, seq: 9, biz_date: '2026-11-05', merkle_root: 'a'.repeat(64), prev_root: 'b'.repeat(64), leaf_count: 20, is_day_close: 0, status: 2, mix: { order: 11, pass_issue: 6, pass_verify: 3 } }
  const chips = (h) => (h.match(/class="mx"/g) || []).length
  assert.equal(chips(ctx.blockNodeHTML(b, { tier: 'full' })), 3); assert.equal(chips(ctx.blockNodeHTML(b, { tier: 'md' })), 2)
  const sm = ctx.blockNodeHTML(b, { tier: 'sm' })
  assert.equal(chips(sm), 1); assert.match(sm, /\+9/, '被收起的环节折成 +N'); assert.match(sm, /d-short">11-05</)
  assert.match(ctx.blockNodeHTML({ ...b, is_day_close: 1 }, { tier: 'sm' }), />封存</)
  assert.match(ctx.blockNodeHTML({ ...b, is_day_close: 1 }, { tier: 'full' }), />旅豆账本封存</)
  const css = read('app.css')
  assert.match(css, /\.tier-sm \.x, \.tier-sm \.blk-root/); assert.match(css, /\.d-short \{ display: none; \}/)
})
await t('翻页切片：第一页 29 批（留 1 格给「下一区块」）、其后每页 30；不重不漏；最新页空时给空', () => {
  const asc = Array.from({ length: 120 }, (_, i) => ({ seq: i + 1 }))
  const seqs = (p) => ctx.chainPageSlice(asc, p).map((x) => x.seq)
  const p0 = seqs(0), p1 = seqs(1), p2 = seqs(2)
  assert.equal(p0.length, 29); assert.equal(p0[28], 120); assert.equal(p0[0], 92)
  assert.equal(p1.length, 30); assert.equal(p1[29], 91); assert.equal(p1[0], 62)
  assert.equal(p2[29], 61)
  assert.equal(new Set([...p0, ...p1, ...p2]).size, 89, '三页之间不重复')
  assert.equal(ctx.chainPageSlice([], 0).length, 0)
  assert.equal(ctx.chainFetchLimit(0), 29); assert.equal(ctx.chainFetchLimit(1), 59); assert.equal(ctx.chainFetchLimit(9), 200, '接口一次最多 200 批')
  const html = ctx.chainPagerHtml(1, [{ seq: 62 }, { seq: 91 }], 120)
  assert.match(html, /本页 #62–#91 · 共 120 批/); assert.ok(!/disabled onclick="chainPage\(1\)"/.test(html)); assert.ok(!/disabled onclick="chainPage\(-1\)"/.test(html))
  assert.match(ctx.chainPagerHtml(0, [{ seq: 92 }, { seq: 120 }], 120), /disabled onclick="chainPage\(-1\)"/)
  assert.match(ctx.chainPagerHtml(0, [{ seq: 1 }, { seq: 29 }], 29), /disabled onclick="chainPage\(1\)"/, '没有更早的了')
  assert.match(ctx.chainPagerHtml(6, [{ seq: 1 }, { seq: 2 }], 500), /最多翻 200 批/)
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

await t('侧栏每个模块配的图标都真实存在（数字身份配了不存在的 kyc，侧栏一直没图）', () => {
  const coreSrc = fs.readFileSync(path.join(ADMIN, 'core.js'), 'utf8')
  const iconSrc = coreSrc.slice(coreSrc.indexOf('const ICONS = {'), coreSrc.indexOf('// 按"谁在什么场景'))
  const icons = new Set([...iconSrc.matchAll(/^\s*(\w+): '<svg/gm)].map((m) => m[1]))
  const used = MODULE_GROUPS.flatMap(([, items]) => items.map(([k, , ic]) => [k, ic]))
  assert.ok(used.length > 40, '模块清单没解析出来')
  assert.deepEqual(used.filter(([, ic]) => !icons.has(ic)).map(([k, ic]) => k + '→' + ic), [])
})

console.log('== 卡面体系 ==')
await t('等级 → 卡种：最高一级固定黑金，其余从普卡往上；等级数变了自动跟着变', () => {
  const T = (r, n) => ctx.cardTierOf(r, n)
  assert.equal([1, 2, 3, 4].map((r) => T(r, 4)).join(), 'classic,gold,platinum,black')
  assert.equal([1, 2, 3].map((r) => T(r, 3)).join(), 'classic,gold,black')
  assert.equal([1, 2, 3, 4, 5].map((r) => T(r, 5)).join(), 'classic,gold,platinum,diamond,black')
  assert.equal(T(9, 4), 'black', '超出范围收到最高级'); assert.equal(T(0, 4), 'classic'); assert.equal(T(1, 1), 'classic', '只有一级时不算黑金')
})
await t('同一角色不同等级卡种不同；不同角色系列不同；同页多张卡渐变 id 不重名', () => {
  ctx.window.__cardScale = { traveler: { levels: [1, 2, 3, 4].map((lv) => ({ lv, name: 'L' + lv, n: lv })) } }
  const a = ctx.vcCardSvg({ ...claims, levelNo: 1 }, {}), b = ctx.vcCardSvg({ ...claims, levelNo: 4 }, {})
  assert.match(a, /data-role="traveler" data-tier="classic"/); assert.match(a, /普卡/)
  assert.match(b, /data-role="traveler" data-tier="black"/); assert.match(b, /黑金卡/)
  const m = ctx.roleCardSvg({ role: 'merchant', rank: 2, total: 4, levelName: '优选商户', sub: '示例店 · 老板', stats: [{ label: '完成订单', val: 3 }] })
  assert.match(m, /data-role="merchant" data-tier="gold"/); assert.match(m, /商户系列/); assert.match(m, /未签发角色凭证/, '没签发要明说')
  const id = (x) => x.match(/<linearGradient id="(vc\d+)"/)[1]
  assert.notEqual(id(a), id(b))
})
await t('吊销 / 过期的卡有印章并去色；有效不带印章', () => {
  for (const st of ['已吊销', '已过期']) { const s = ctx.vcCardSvg(claims, { status: st }); assert.match(s, /grayscale/); assert.match(s, new RegExp('letter-spacing="6">' + st)) }
  assert.ok(!/grayscale/.test(ctx.vcCardSvg(claims, { status: '有效' })))
})
await t('卡面图鉴：每个系列五种卡面，用不上的标预留；等级名与人数取自配置', () => {
  ctx.window.__cardScale = { traveler: { levels: [{ lv: 1, name: '探索者', n: 18 }, { lv: 2, name: '旅行家', n: 4 }, { lv: 3, name: '城市探索官', n: 8 }, { lv: 4, name: '环球探索家', n: 10 }] } }
  const html = ctx.vcGalleryHtml('traveler')
  assert.equal((html.match(/class="vc-tile (reserved)?"/g) || []).length, 5)
  assert.equal((html.match(/vc-tile reserved/g) || []).length, 1, '4 级时只有钻石卡预留')
  assert.match(html, /Lv\.4 环球探索家<\/span><b>10 人/); assert.match(html, /预留：等级加到 5 级后启用/)
  for (const k of ['creator', 'promoter', 'merchant']) assert.match(html, new RegExp("vcGallery\\('" + k + "'\\)"), '缺系列入口 ' + k)
})

await t('后台前端和服务端的卡种规则一致（小程序用服务端那份）', async () => {
  const { cardTierOf } = await import('../src/domain/card-tier.mjs')
  for (let n = 1; n <= 6; n++) for (let r = 0; r <= 7; r++) assert.equal(ctx.cardTierOf(r, n), cardTierOf(r, n), r + '/' + n)
})
await t('角色凭证出对应系列的卡；推广卡不画金额，商户卡带门店名', () => {
  const p = ctx.vcCardSvg({ role: 'promoter', level: '金牌服务商', levelNo: 3, scope: 'promoter' }, { did: 'did:cn:wl:abc', status: '有效' })
  assert.match(p, /data-role="promoter" data-tier="black"/); assert.match(p, /不含金额与联系方式/); assert.ok(!/¥/.test(p))
  assert.match(ctx.vcCardSvg({ role: 'merchant', level: '优选商户', levelNo: 2, merchantName: '朱家角小店', position: '老板', scope: 'merchant' }, {}), /朱家角小店 · 老板/)
  const c = ctx.vcCardSvg({ role: 'creator', level: '签约创作者', levelNo: 2, works: 7, tasks: 2, scope: 'creator' }, {})
  assert.match(c, /data-role="creator"/); assert.match(c, />7</)
})
await t('档案里的角色卡：已签发显示有效，未签发说明未签发', () => {
  const card = { role: 'promoter', rank: 1, total: 3, levelName: '基础服务商', sub: 'x', stats: [] }
  assert.match(ctx.roleCardSvg(card), /未签发角色凭证/)
  const on = ctx.roleCardSvg(card, { vc: { expires_at: '2099-01-01 00:00:00' }, did: 'did:cn:wl:abc' })
  assert.match(on, />有效</); assert.match(on, /2099-01-01/); assert.ok(!/未签发角色凭证/.test(on))
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
