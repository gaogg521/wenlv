// 链路总览的「能不能点」回归：节点必须真的是按钮、必须键盘可达、不可点的要说清，
// 且自动刷新不能把用户展开的事件表抹掉（2026-11-04 用户报「可信存证里没有一个能点」）。
//
// 做法：把 admin/pages/web3.js 在 vm 里跑起来（stub 掉 document/api），直接渲染节点 HTML 来断言，
// 而不是 grep 源码 —— grep 只能证明写了 onclick，证明不了渲染出来还在。
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'admin', 'pages', 'web3.js')
const CSS = path.join(__dirname, '..', 'admin', 'app.css')
const code = fs.readFileSync(SRC, 'utf8')
const css = fs.readFileSync(CSS, 'utf8')

let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

// ---- 最小 DOM / 接口 stub：只够让 web3.js 载入并渲染 ----
const noop = () => {}
const fakeEl = () => ({ innerHTML: '', hidden: false, dataset: {}, style: {}, classList: { add: noop, remove: noop, contains: () => false }, scrollIntoView: noop, appendChild: noop, setAttribute: noop, querySelectorAll: () => [], addEventListener: noop })
const documentStub = {
  querySelector: () => fakeEl(),
  getElementById: () => null,
  createElement: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener: noop,
  body: fakeEl(),
}
const ctx = {
  document: documentStub, window: {}, localStorage: { getItem: () => '', setItem: noop },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ code: 0, data: {} }) }),
  console, setTimeout, clearInterval, setInterval, Date, Math, JSON, Number, String, Object, Array, Promise, escape: globalThis.escape,
  innerHeight: 900, innerWidth: 1400,
}
// core.js 里的公共工具（esc/toast/api/$）在真实页面是全局的，这里按同样语义注入
ctx.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
ctx.toast = noop
ctx.$ = () => fakeEl()
ctx.api = () => Promise.resolve({})
ctx.go = noop
ctx.bizTag = (t) => String(t || '')
ctx.BIZ_CN = {}
ctx.skel = () => ''
ctx.globalThis = ctx
vm.createContext(ctx)
vm.runInContext(code, ctx, { filename: 'admin/pages/web3.js' })

const B = { id: 7, seq: 3, biz_date: '2026-11-01', merkle_root: 'a'.repeat(64), prev_root: 'b'.repeat(64),
  leaf_count: 12, is_day_close: 0, status: 2, attempt: 0, chain_tx_ref: 'c'.repeat(64), chain_block: '185033127' }
const DAY = { ...B, id: 8, seq: 4, is_day_close: 1, prev_root: 'a'.repeat(64) }

console.log('== 链路总览可点性 ==')

await t('区块节点渲染出来带 onclick + role=button + 键盘 Enter（不是只有一个 tabindex）', () => {
  const html = ctx.blockNodeHTML(B)
  assert.match(html, /onclick="openBlock\(7\)"/, '缺少点击入口')
  assert.match(html, /role="button"/, '缺少按钮语义')
  assert.match(html, /onkeydown="[^"]*Enter/, '键盘不可达')
  assert.match(html, /aria-label="区块 3/, '缺少可读名称')
})

await t('可点的节点有「查看批内事件 ›」可见提示，用户不用猜哪里能点', () => {
  assert.match(ctx.blockNodeHTML(B), /node-open/)
  assert.match(css, /\.chain-node:not\(\.ghost\):hover \.node-open \{ opacity: 1; \}/)
})

await t('账本日终节点同样可点（分支块不能变成死块）', () => {
  const html = ctx.blockNodeHTML(DAY)
  assert.match(html, /onclick="openBlock\(8\)"/)
  assert.match(html, /账本日终/)
})

await t('流程步骤节点带 onclick + role=button + 键盘 Enter', () => {
  const html = ctx.flowStepHTML({ no: 'WL1', label: '支付成功', hint: '订单事实入链', ev: { biz_type: 'order', biz_ref: 'WL1', version_no: 1, status: 2, payload_hash: 'f'.repeat(64), created_at: '2026-11-01 10:00:00', seq: 3, merkle_root: B.merkle_root } }, 0)
  assert.match(html, /onclick="openFlowStep\(0\)"/)
  assert.match(html, /role="button"/)
  assert.match(html, /onkeydown="[^"]*Enter/)
})

await t('不可点的节点必须说明原因（待打包/待产生），且不挂 onclick', () => {
  const ghost = ctx.flowStepHTML({ no: 'bt-2', label: '返豆', hint: '消费奖励', ev: null }, 5)
  assert.match(ghost, /aria-disabled="true"/)
  assert.match(ghost, /暂不可点/)
  assert.ok(!/onclick=/.test(ghost), '待产生的步骤不该有点击入口')
  assert.match(css, /\.chain-node\.ghost \{ cursor: not-allowed; \}/)
})

await t('自动刷新会重画 #app，但必须把用户正看着的区块原样恢复', () => {
  assert.match(code, /window\.__openBlockId = id/, 'openBlock 没有记住展开的区块')
  assert.match(code, /if \(window\.__openBlockId != null\) openBlock\(window\.__openBlockId, \{ silent: true \}\)/, '刷新后没有恢复展开的区块')
  assert.match(code, /if \(window\.__openFlowStep != null\) openFlowStep\(window\.__openFlowStep, \{ silent: true \}\)/, '刷新后没有恢复展开的步骤')
})

await t('点开后必须有可见结果：滚动到 block:start（nearest 多数情况下等于不滚动）', () => {
  const scrolls = [...code.matchAll(/scrollIntoView\(\{ behavior: 'smooth', block: '(\w+)' \}\)/g)].map((m) => m[1])
  assert.ok(scrolls.length >= 2, '找不到滚动调用')
  assert.ok(scrolls.every((b) => b === 'start'), '仍有 block:nearest')
  assert.match(css, /#blockDetail \{ scroll-margin-top: 88px; \}/, '滚到顶会被页头压住')
})

await t('证据数字可整串复制（哈希 64 位手选必漏字符）', () => {
  assert.match(code, /function copyText\(/, '缺少复制工具')
  const html = ctx.blockNodeHTML(B)
  assert.ok(html.length > 0)
  // 详情卡里的复制芯片在 openBlock 内，这里检查源码具备三处：根 / 前根 / 交易号
  assert.ok((code.match(/copy-chip/g) || []).length >= 3, '复制芯片少于 3 处')
})

await t('订单号错了要给人话，不是把后端「订单不存在」原样甩出来', () => {
  assert.match(code, /没找到订单 \$\{no\}/)
})

await t('存证检索：一个入口能吃订单号/批次/哈希/根/凭证/手机号/用户ID/DID，不是只有订单号', () => {
  const html = ctx.web3dashSource || ''
  assert.match(code, /id="attestQ"[\s\S]{0,200}批次 #12/, '检索框没提批次')
  assert.match(code, /交易哈希/, '检索框没提交易哈希')
  for (const k of ['手机号', '用户ID', 'DID', '凭证']) assert.ok(code.includes(k), '缺少可查类型：' + k)
  assert.match(code, /function attestSearch\(/, '缺少检索实现')
  assert.match(code, /\/admin\/attest\/search\?q=/, '没有调用检索接口')
})

await t('检索结果按「对象 / 批次 / 事件」三类展示，且批次可直接打开批内事件', () => {
  const r = {
    q: 'batch:3', matched: ['批次'], chain: { label: '蚂蚁链开放联盟联盟链' },
    order: { orderNo: 'WL1', status: 30, productName: '朱家角', amountPay: 39800 },
    user: { id: 7, nickname: '陈姐', did: 'did:cn:wl:ABC', memberLevel: 2, status: 1 },
    pass: null,
    batches: [{ id: 9, seq: 3, biz_date: '2026-11-04', leaf_count: 20, status: 2, merkle_root: 'f'.repeat(64), chain_tx_ref: 'e'.repeat(64), chain_block: '185034002', is_day_close: 0 }],
    events: [{ id: 1, biz_type: 'order', biz_ref: 'WL1', version_no: 50, status: 2, payload_hash: 'a'.repeat(64), created_at: '2026-11-04 10:00:00', batch_id: 9, seq: 3 }],
    capability: { canSearch: ['订单号', '批次 #N'], noContract: '当前链走内置存证（DEPOSIT），没有合约地址可查' },
  }
  const html = ctx.attestResultHtml(r)
  assert.match(html, /命中的批次（1）/, '缺批次分区')
  assert.match(html, /命中的存证事件（1）/, '缺事件分区')
  assert.match(html, /openBlock\(9\)/, '批次不可点开')
  assert.match(html, /did:cn:wl:ABC/, '用户命中时没给出 DID（链上标识）')
  assert.match(html, /copyText\('eeee/, '交易哈希无复制入口')
  assert.match(html, /没有合约地址可查/, '没说明"合约地址查不到"这件事')
})

await t('查不到时给空态 + 可查类型清单，不是一片空白', () => {
  const html = ctx.attestResultHtml({ q: 'zzz', matched: [], batches: [], events: [], capability: { canSearch: ['订单号', '批次 #N', '手机号'], noContract: '' } })
  assert.match(html, /没查到「zzz」/)
  assert.match(html, /可查：/)
})

await t('上链流水线：五段真实路径齐全（事件→根→交易→出块→确认），已锚定批次五段全绿', () => {
  const html = ctx.pipelineHtml([{ seq: 3, biz_date: '2026-11-04', leaf_count: 20, merkle_root: 'f'.repeat(64),
    prev_root: 'a'.repeat(64), status: 2, chain_tx_ref: 'e'.repeat(64), chain_block: '185034002', anchored_at: '2026-11-04 19:55:00' }], [{ pending: 0 }], false)
  for (const seg of ['条事件入队', '本地打包出根', '提交交易', '链上出块', '确认锚定']) assert.ok(html.includes(seg), '缺少段位：' + seg)
  assert.equal((html.match(/pipe-step done/g) || []).length, 5, '已锚定批次应当五段全 done')
  assert.match(html, /185034002/, '没有块高')
  assert.match(html, /prev → aaaaaaaa/, '没有显示前根指向')
})

await t('上链流水线：各段严格按库里 status 画，不按"看起来差不多"（5=已提交待确认 / 1=仅打包 / 3=异常）', () => {
  const base = { seq: 9, biz_date: '2026-11-04', leaf_count: 5, merkle_root: 'f'.repeat(64), prev_root: null, chain_tx_ref: 'e'.repeat(64), chain_block: null }
  const s5 = ctx.pipelineHtml([{ ...base, status: 5 }], [], false)
  assert.equal((s5.match(/pipe-step done/g) || []).length, 3, '已提交待确认 = 事件/根/提交 三段 done')
  const s1 = ctx.pipelineHtml([{ ...base, status: 1, chain_tx_ref: null }], [], false)
  assert.equal((s1.match(/pipe-step done/g) || []).length, 2, '仅打包 = 事件/根 两段 done')
  const s3 = ctx.pipelineHtml([{ ...base, status: 3 }], [], false)
  assert.match(s3, /pipe-step bad/, '锚定失败必须标红，不能显示成待确认')
  assert.match(s3, /异常·已转人工/)
})

await t('上链流水线：没有批次时给出下一步动作，不是空白；在途数量显示出来', () => {
  const html = ctx.pipelineHtml([], [{ pending: 7 }], false)
  assert.match(html, /还没有批次/)
  assert.match(html, /在途 7 条待打包/)
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
