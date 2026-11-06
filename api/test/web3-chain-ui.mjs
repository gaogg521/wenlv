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

console.log('== 区块上显示业务环节 / 单流程与链路视图对上号 ==')

await t('区块节点直接画出批内业务环节（订单 / 出票…），多于 2 类折成 +N', () => {
  const html = ctx.blockNodeHTML({ ...B, mix: { order: 8, pass_issue: 4, pass_verify: 3, bean_grant: 2, settlement: 1 } })
  assert.match(html, /blk-mix/)
  for (const w of ['订单 <b>8</b>', '出票 <b>4</b>']) assert.ok(html.includes(w), '缺少环节标签：' + w)
  assert.match(html, /\+6/, '其余三类（3+2+1）折成 +6')
  assert.ok(!html.includes('核销 <b>3</b>'), '超出 2 类的不该直接画（块只有 132px 宽）')
})

await t('业务主线环节排在前面：勋章数量再多也不挤掉订单/出票/核销', () => {
  const html = ctx.blockNodeHTML({ ...B, mix: { badge: 35, order: 3, pass_verify: 2, pass_issue: 2, merchant_join: 9 } })
  const i = (w) => html.indexOf(w)
  assert.ok(i('订单 <b>3</b>') > 0 && i('订单 <b>3</b>') < i('出票 <b>2</b>'), '应按 订单→出票 顺序')
  assert.ok(!html.includes('勋章 <b>35</b>'), '旁路事件排在主线之后，超出 2 类折成 +N')
  assert.match(html, /\+46/, '核销 2 + 勋章 35 + 准入 9')
})

await t('账本日终块标「旅豆账本封存」，没有构成数据的旧接口也不报错', () => {
  assert.match(ctx.blockNodeHTML({ ...DAY, mix: { bean_ledger: 6 } }), /旅豆账本封存/)
  assert.doesNotThrow(() => ctx.blockNodeHTML(B))
})

await t('演示链的每个业务块自带业务构成，且合计 = 事件数', () => {
  for (const b of ctx.mockChain().filter((x) => !Number(x.is_day_close))) {   // 日终批的叶子是旅豆流水，没有业务构成（和真实接口一致）
    const n = Object.values(b.mix).reduce((a, c) => a + c, 0)
    assert.equal(n, Number(b.leaf_count), `演示块 #${b.seq} 构成合计 ${n} ≠ ${b.leaf_count}`)
  }
})

await t('单流程每一步的「批 #N」可点，回到链路视图里这个区块', () => {
  const html = ctx.flowStepHTML({ no: '②', label: '支付成功', hint: '', ev: { biz_type: 'order', biz_ref: 'WL1', version_no: 1, status: 2, payload_hash: 'f'.repeat(64), created_at: '2026-11-01 10:00:00', seq: 3, batch_id: 7, merkle_root: B.merkle_root } }, 1)
  assert.match(html, /event\.stopPropagation\(\);focusBlock\(7\)/, '批次号没挂定位')
  assert.match(html, />批 #3</)
  assert.ok(!/focusBlock/.test(ctx.flowStepHTML({ no: '②', label: '支付成功', hint: '', ev: { biz_type: 'order', biz_ref: 'WL1', status: 0, payload_hash: 'f'.repeat(64), created_at: '2026-11-01 10:00:00', seq: null, batch_id: null } }, 1)), '待打包的步骤没有区块，不该有定位入口')
})

await t('flowMarkChain：这一单经过的区块被打上 ①② 角标并高亮，其余区块不受影响', () => {
  const mkNode = () => { const n = { cls: new Set(), html: '', classList: { add: (c) => n.cls.add(c), remove: (c) => n.cls.delete(c), contains: (c) => n.cls.has(c) }, querySelector: () => null, insertAdjacentHTML: (_p, h) => { n.html += h } }; return n }
  const nodes = { 'bnode-7': mkNode(), 'bnode-9': mkNode(), 'bnode-11': mkNode() }
  documentStub.getElementById = (id) => nodes[id] || null
  documentStub.querySelectorAll = () => Object.values(nodes)
  const ev = (batch_id, seq) => ({ batch_id, seq, status: 2 })
  ctx.window.__flowData = { steps: [{ no: '①', ev: ev(7, 3) }, { no: '②', ev: ev(7, 3) }, { no: '③', ev: ev(9, 4) }, { no: '④', ev: null }, { no: '⑤', ev: ev(99, 8) }], refunds: [{ batch_id: 9, seq: 4 }] }
  const marks = ctx.flowMarkChain()
  assert.ok(nodes['bnode-7'].cls.has('trace-hit') && nodes['bnode-9'].cls.has('trace-hit'))
  assert.ok(!nodes['bnode-11'].cls.has('trace-hit'), '没经过的区块不该高亮')
  assert.match(nodes['bnode-7'].html, /<i>①<\/i><i>②<\/i>/)
  assert.match(nodes['bnode-9'].html, /<i>③<\/i><i>退<\/i>/)
  assert.equal(JSON.stringify(marks.map((m) => [m.id, m.onChain])), '[[7,true],[9,true],[99,false]]', '不在最近区块里的也要列出来（点开直接看批内事件）')
  documentStub.getElementById = () => null; documentStub.querySelectorAll = () => []
})

await t('演示单的每一步都落在演示链的区块上：批次号 / 状态 / 区块 id 一一对应', async () => {
  ctx.window.__demoChain = true   // 已处于演示链：只渲染单流程，不重画整页
  await ctx.loadFlowDemo()
  const d = ctx.window.__flowData
  const chain = Object.fromEntries(ctx.mockChain().map((b) => [b.id, b]))
  assert.equal(d.steps.length, 6)
  assert.equal(d.steps.map((s) => s.no).join(''), '①②③④⑤⑥', '演示单的步骤编号应是 ①~⑥，不是业务单号')
  for (const s of d.steps) {
    const b = chain[s.ev.batch_id]
    assert.ok(b, `${s.label} 的 batch_id ${s.ev.batch_id} 不在演示链里`)
    assert.equal(b.seq, s.ev.seq, `${s.label} 批次号对不上`)
    assert.equal(Number(b.status), Number(s.ev.status), `${s.label} 状态与所在区块不一致`)
    assert.ok(String(s.ev.created_at).slice(0, 10) >= String(b.biz_date).slice(0, 10), `${s.label} 发生时间早于所在区块的业务日`)
  }
  ctx.window.__demoChain = false; ctx.window.__flowData = null
})

await t('「看一条真实单的六步」取真实订单，不是偷偷放演示数据；退出演示时一并收掉演示单', () => {
  assert.match(code, /onclick="loadFlowSample\(\)">看一条真实单的六步/)
  assert.match(code, /c\.latestOrder\) return loadFlow\(c\.latestOrder/, '没有用后端给的真实订单')
  assert.match(code, /退出演示时，演示单[\s\S]{0,200}window\.__flowData = null/, '退出演示没收掉演示单')
})

await t('后端：批次带业务构成 mix，单流程事件带 batch_id（前端靠它对上区块）', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'web3.mjs'), 'utf8')
  assert.match(route, /for \(const b of batches\) b\.mix =/, '存证中心批次没带 mix')
  assert.match(route, /GROUP BY batch_id, biz_type/)
  assert.match(route, /const COLS = '[^']*e\.batch_id,/, '单流程 COLS 没带 batch_id')
})

console.log('== 页面排布 ==')

await t('上链流水线取最新的 8 批（batches 是升序，原来取成了最旧的 8 批）', () => {
  const bs = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, biz_date: '2026-11-05', leaf_count: 1, merkle_root: 'f'.repeat(64), status: 2 }))
  const html = ctx.pipelineHtml(bs, [], false)
  assert.ok(html.indexOf('<b>#10</b>') > 0 && html.indexOf('<b>#10</b>') < html.indexOf('<b>#3</b>'), '应从最新一批开始')
  assert.ok(!html.includes('<b>#2</b>'), '不该再画最旧的批次')
})

await t('数字身份页顶部卡片：有有效凭证就放真实卡（数字可点），没有才放示例；吊销 / 过期的不算', () => {
  const v = (x) => ({ id: 1, user_id: 7, nickname: '陈姐', did: 'did:cn:wl:AAA', claims: { scope: 'travel', level: '探索者', levelNo: 3, trips: 2, cities: 1, badges: [] }, expires_at: '2099-01-01 00:00:00', ...x })
  const real = ctx.vcHeroCard([v({})])
  assert.match(real, /陈姐/); assert.match(real, /vcStatOpen\(7,/, '真实卡的数字应可点'); assert.ok(!real.includes('示例卡片'))
  for (const dead of [v({ revoked_at: '2026-01-01' }), v({ expires_at: '2020-01-01 00:00:00' })]) assert.match(ctx.vcHeroCard([dead]), /示例卡片/)
  assert.match(ctx.vcHeroCard([]), /示例卡片/)
})

await t('身份列表带头像：有图用图，没图用昵称首字；恶意头像地址不进 src', () => {
  const r = { total: 3, size: 12, page: 1, summary: { users: 3, beanAccounts: 0, vcHolders: 0 }, rows: [
    { userId: 1, nickname: '小满', avatar: 'https://x.test/a.png', did: 'did:a', levelNo: 1, levelName: 'L', status: 1, beanBalance: null, badges: 0, trips: 0, vcActive: 0 },
    { userId: 2, nickname: '陈姐', avatar: null, did: 'did:b', levelNo: 1, levelName: 'L', status: 1, beanBalance: null, badges: 0, trips: 0, vcActive: 0 },
    { userId: 3, nickname: '坏人', avatar: 'javascript:alert(1)', did: 'did:c', levelNo: 1, levelName: 'L', status: 1, beanBalance: null, badges: 0, trips: 0, vcActive: 0 },
  ] }
  const html = ctx.idListHtml(r)
  assert.match(html, /<img class="id-ava" src="https:\/\/x\.test\/a\.png"/)
  assert.match(html, /<span class="id-ava"[^>]*>陈<\/span>/)
  assert.ok(!html.includes('javascript:'), '非 http(s) 头像不能进 src')
})

console.log('== 区块配色：颜色 = 业务环节 ==')
const facesOf = (html) => [...html.matchAll(/class="fc" style="--edge:(#[0-9a-f]{6})/g)].map((m) => m[1])

await t('只含一种业务的区块整块一个色：抵扣绿、支付金、出票蓝、核销紫', () => {
  const zone = (type) => ctx.blockNodeHTML({ ...B, mix: { [type]: 3 } })
  for (const [type, hex] of [['bean_deduct', '#34d399'], ['order', '#fbbf24'], ['pass_issue', '#60a5fa'], ['pass_verify', '#c084fc']]) {
    assert.match(zone(type), new RegExp('cube-zone[^"]*" style="--edge:' + hex), type)
    assert.equal(facesOf(zone(type)).length, 0, '单一业务不需要分面上色')
  }
})
await t('一批含多种业务时六个面分别上色，且顺序按业务主线', () => {
  const faces = facesOf(ctx.blockNodeHTML({ ...B, mix: { badge: 30, pass_issue: 2, order: 3 } }))
  assert.equal(faces.length, 6)
  assert.equal(faces.slice(0, 3).join(), '#fbbf24,#60a5fa,#f472b6', '订单→出票→勋章')
  assert.equal(faces[3], faces[0], '不够六种就循环')
})
await t('状态优先：待打包是灰的，需要人处理是红的，已打包未锚定半透明，账本日终银白', () => {
  assert.match(ctx.blockNodeHTML({ ...B, status: 0, mix: { order: 1 } }), /cube-zone t-gray/)
  for (const st of [3, 4]) assert.match(ctx.blockNodeHTML({ ...B, status: st, mix: { order: 1 } }), /cube-zone t-red/, '异常不能被业务色盖住')
  assert.match(ctx.blockNodeHTML({ ...B, status: 1, mix: { order: 1 } }), /cube-zone dim/)
  assert.ok(!/cube-zone dim/.test(ctx.blockNodeHTML({ ...B, status: 2, mix: { order: 1 } })), '已锚定不该半透明')
  assert.match(ctx.blockNodeHTML({ ...DAY, mix: {} }), /--edge:#e2e8f0/)
})
await t('单流程每一步按业务配色；演示单也用真实业务类型', async () => {
  const ev = (biz_type, status = 2) => ({ biz_type, biz_ref: 'x', version_no: 1, status, payload_hash: 'f'.repeat(64), created_at: '2026-11-01 10:00:00', seq: 3, batch_id: 7 })
  assert.match(ctx.flowStepHTML({ no: '①', label: '旅豆抵扣', hint: '', ev: ev('bean_deduct') }, 0), /--edge:#34d399/)
  assert.match(ctx.flowStepHTML({ no: '④', label: '核销', hint: '', ev: ev('pass_verify') }, 3), /--edge:#c084fc/)
  assert.match(ctx.flowStepHTML({ no: '②', label: '支付', hint: '', ev: ev('order', 0) }, 1), /cube-zone sm dim" style="--edge:#fbbf24/, '还没锚定：保留业务色，半透明')
  ctx.window.__demoChain = true; await ctx.loadFlowDemo()
  assert.equal(ctx.window.__flowData.steps.map((s) => s.ev.biz_type).join(), 'bean_deduct,order,pass_issue,pass_verify,bean_grant,settlement')
  ctx.window.__demoChain = false; ctx.window.__flowData = null
})
await t('环节标签的颜色与区块一致；图例覆盖这些颜色', () => {
  assert.match(ctx.blockNodeHTML({ ...B, mix: { pass_verify: 2 } }), /class="mx" style="--c:#c084fc"/)
  assert.match(code, /CHAIN_LEGEND\.map/, '图例要从同一份配色生成')
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
