// 链上完整性：整套业务流程做完后，所有该上链的事件是不是都上链了？
//   一、审计：每类业务动作（订单支付/完成、出票、核销、旅豆、结算、退款、勋章）是否都有对应的存证事件，一条不缺
//   二、全量上链：切自测链 → 打包 → 旅豆日终封存 → 锚定 → 确认；之后不能有事件 / 批次停在中间状态；每个事件的默克尔证明与 canonical 哈希都可复算
//   三、三端一致：后台流程视图、对外验证、游客侧可信记录、后台总览 对同一笔订单给出一致的"已锚定"
//   四、持续运行：锚定之后再走一整笔新订单，新事件同样能打包并上链；重复触发不产生重复数据
// ⚠ 已锚定的批次有触发器保护、无法回退，会让 web3-integrity 的"NOOP 下已锚定批次必须为 0"失败。
//   所以本脚本只能在【专用的全新隔离库】上、在 test:db 全部跑完之后运行，不要放进 test:db；跑完这个库就不要再跑 web3-integrity。
//   用法：PORT=… DB_NAME=… JWT_SECRET=… API_BASE=… node test/chain-e2e.mjs（服务在跑，且库里已有跑过业务流程的数据，如先 seed:scenario + test:db）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/chain-e2e.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import * as attest from '../src/domain/attest.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
const ok = (r, w = '') => { assert.equal(r.code, 0, `${w} ${r.msg || ''}`); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', String(e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const job = (name, body) => call('POST', `/admin/system/jobs/${name}/run`, body || {}, A)
const stamp = Date.now().toString(36)

const ev = (type, whereRef) => `(SELECT COUNT(*) FROM attest_event e WHERE e.biz_type = '${type}' AND ${whereRef})`
const RULES = [
  ['订单·支付成功（order v30）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='order' AND e.biz_ref=o.order_no AND e.version_no=30)) missing FROM orders o WHERE o.status IN (30,40,50,60,70)`],
  ['订单·完成（order v50，仅统计走过业务流程完成的订单）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='order' AND e.biz_ref=o.order_no AND e.version_no=50)) missing FROM orders o WHERE o.status = 50 AND EXISTS (SELECT 1 FROM order_event oe WHERE oe.order_id = o.id AND oe.to_st = 50)`],
  ['出票（pass_issue）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='pass_issue' AND e.biz_ref=CONCAT('pass-',p.id))) missing FROM travel_pass p`],
  ['核销（pass_verify，扫码 / 离线 / 人工确认 / 暗号）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='pass_verify' AND e.biz_ref LIKE CONCAT('pass-',x.pass_id,'-%'))) missing FROM (SELECT DISTINCT pass_id FROM verification_log WHERE result = 1) x`],
  ['旅豆流水（bean_grant / bean_deduct，用户户）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type IN ('bean_grant','bean_deduct') AND e.biz_ref=CONCAT('bt-',x.tx_no))) missing FROM (SELECT DISTINCT l.tx_no FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id < 999999000000) x`],
  ['结算单（settlement）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='settlement' AND e.biz_ref=CONCAT('settle-',s.id))) missing FROM settlement s`],
  ['退款（refund）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='refund' AND e.biz_ref=r.refund_no)) missing FROM refunds r`],
  ['勋章发放（badge）', `SELECT COUNT(*) total, SUM(NOT EXISTS (SELECT 1 FROM attest_event e WHERE e.biz_type='badge' AND e.biz_ref=CONCAT('badge-',ub.user_id,'-',ub.badge_id))) missing FROM user_badge ub`],
]
void ev

console.log('== 一、审计：每类业务动作都有存证事件 ==')
const audit = []
for (const [name, sql] of RULES) { const r = await one(sql); audit.push({ name, total: Number(r.total), missing: Number(r.missing || 0) }) }
console.log('  ' + '业务动作'.padEnd(40) + '数量'.padStart(6) + '缺事件'.padStart(8))
for (const a of audit) console.log('  ' + a.name.padEnd(42 - [...a.name].filter((c) => c.charCodeAt(0) > 255).length) + String(a.total).padStart(6) + String(a.missing).padStart(8))
await t('每类业务动作都有数据，且没有任何一条缺存证事件', async () => {
  const empty = audit.filter((a) => a.total === 0 && !a.name.startsWith('勋章')).map((a) => a.name) // 勋章：别的测试会清理自己建的勋章，库里可能没有
  assert.deepEqual(empty, [], '这些动作库里没有数据，审计无意义（先跑 seed:scenario 和 test:db）：' + empty)
  const bad = audit.filter((a) => a.missing > 0).map((a) => `${a.name} 缺 ${a.missing}/${a.total}`)
  assert.deepEqual(bad, [], '有业务动作没写存证：\n' + bad.join('\n'))
})
const types = await q('SELECT biz_type, COUNT(*) n FROM attest_event GROUP BY biz_type ORDER BY biz_type')
console.log('  事件类型分布：' + types.map((x) => `${x.biz_type}×${x.n}`).join('  '))

console.log('\n== 二、全量上链：自测链 打包 → 日终封存 → 锚定 → 确认 ==')
await t('切到自测链', async () => { ok(await call('POST', '/admin/chain/activate', { provider: 'mock', confirm: 'mock' }, A)); assert.equal(ok(await call('GET', '/admin/attest/center', null, A)).chain.provider, 'mock') })
const runChain = async () => {
  for (let i = 0; i < 20; i++) { const r = ok(await job('attest-pack'), 'pack'); if (!r.n) break }
  const days = await q(`SELECT DISTINCT DATE(l.created_at) d FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id < 999999000000`)
  for (const d of days) { const day = new Date(d.d).toISOString().slice(0, 10); const r = await job('bean-day-close', { date: day }); if (r.code !== 0 && !/已提交上链|已封存/.test(String(r.msg))) assert.fail('日终封存失败 ' + day + ' ' + r.msg) }
  for (let i = 0; i < 10; i++) {
    ok(await job('attest-anchor'), 'anchor')
    const left = await one('SELECT (SELECT COUNT(*) FROM attest_event WHERE status <> 2) e, (SELECT COUNT(*) FROM attest_batch WHERE status <> 2) b')
    if (!Number(left.e) && !Number(left.b)) break
    await new Promise((r) => setTimeout(r, 800))
  }
}
await t('一次跑完：事件与批次（含旅豆日终根）全部是"已锚定"，没有卡在待打包 / 已打包 / 已提交 / 重试 / 人工处理', async () => {
  await runChain()
  const es = await q('SELECT biz_type, status, COUNT(*) n FROM attest_event WHERE status <> 2 GROUP BY biz_type, status')
  const bs = await q('SELECT id, status, merkle_kind FROM attest_batch WHERE status <> 2')
  assert.equal(es.length, 0, '仍有未锚定事件：' + JSON.stringify(es)); assert.equal(bs.length, 0, '仍有未锚定批次：' + JSON.stringify(bs))
  const tot = await one('SELECT COUNT(*) n, (SELECT COUNT(*) FROM attest_batch) b FROM attest_event'); assert.ok(Number(tot.n) > 0 && Number(tot.b) > 0)
  console.log(`      事件 ${tot.n} 条 · 批次 ${tot.b} 个，全部已锚定`)
})
await t('每个批次都有链上交易号和区块，来自自测链；批次根唯一', async () => {
  const bad = await q("SELECT id FROM attest_batch WHERE chain_tx_ref IS NULL OR chain_tx_ref = '' OR chain_provider <> 'mock'")
  assert.equal(bad.length, 0, '批次缺交易号或来源异常：' + JSON.stringify(bad))
  const dup = await one('SELECT COUNT(*) n FROM (SELECT merkle_root FROM attest_batch GROUP BY merkle_root HAVING COUNT(*) > 1) x'); assert.equal(Number(dup.n), 0)
})
await t('逐个事件复算：默克尔证明有效、canonical 重算出的哈希 = 事件哈希（上链的不是一句空话）', async () => {
  const rows = await q(`SELECT e.id, e.biz_type, e.biz_ref, e.payload_hash, e.canonical, e.leaf_path, b.merkle_root, b.merkle_version, b.is_day_close
    FROM attest_event e JOIN attest_batch b ON b.id = e.batch_id`)
  assert.ok(rows.length > 0); const bad = []
  for (const r of rows) {
    const path = typeof r.leaf_path === 'string' ? JSON.parse(r.leaf_path) : r.leaf_path
    const proofOk = path && attest.verifyProof(r.payload_hash, path, r.merkle_root, Number(r.merkle_version || 1))
    const canon = typeof r.canonical === 'string' ? JSON.parse(r.canonical) : r.canonical
    const hashOk = canon && attest.hashOf(attest.canonicalize(canon)) === r.payload_hash
    if (!proofOk || !hashOk) bad.push(`${r.biz_type}/${r.biz_ref} proof=${!!proofOk} hash=${!!hashOk}`)
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length}/${rows.length} 个事件复算失败`)
  console.log(`      ${rows.length} 个事件全部复算通过`)
})
await t('canonical 里不含个人信息：没有手机号 / 身份证 / 姓名 / 昵称 / 地址类字段', async () => {
  const rows = await q('SELECT biz_type, canonical FROM attest_event'); const bad = []
  const walk = (v, keys) => { if (Array.isArray(v)) v.forEach((x) => walk(x, keys)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys) } }
  for (const r of rows) {
    const o = typeof r.canonical === 'string' ? JSON.parse(r.canonical) : r.canonical; const keys = []; walk(o, keys)
    const hit = keys.filter((k) => /phone|mobile|contact|real_?name|nickname|id_?no|email|address/i.test(k))
    const txt = JSON.stringify(o).replace(/"(orderNo|bizRef|txNo)":"[^"]*"/g, '') // 订单号 / 流水号里的长数字不是手机号
    if (hit.length || /(?<!d)1[3-9]d{9}(?!d)/.test(txt)) bad.push(r.biz_type + ' 字段 ' + hit + ' ' + txt.slice(0, 80))
  }
  assert.deepEqual(bad.slice(0, 3), [])
})

console.log('\n== 三、三端一致：同一笔订单在后台 / 对外验证 / 游客侧 / 总览 都是"已锚定" ==')
const full = await one(`SELECT o.order_no, o.user_id, o.settlement_id FROM orders o WHERE o.status = 50 AND o.settlement_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM travel_pass p JOIN verification_log v ON v.pass_id = p.id WHERE p.order_id = o.id AND v.result = 1) ORDER BY o.id DESC LIMIT 1`)
await t('一笔走完全程（支付→出票→核销→完成→返豆→结算）的订单：后台"一单六锚"每一步都已锚定', async () => {
  assert.ok(full, '需要一笔走完全程并已结算的订单（先跑 test:db）')
  const f = ok(await call('GET', '/admin/attest/flow/' + full.order_no, null, A))
  const miss = f.steps.filter((s) => ['order', 'issue', 'verify', 'grant', 'settle'].includes(s.key)).filter((s) => !(s.ev && Number(s.ev.status) === 2 && Number(s.ev.batch_status) === 2)).map((s) => s.key)
  assert.deepEqual(miss, [], '这些步骤没有已锚定的事件：' + miss)
})
await t('对外验证：订单已锚定、证明可复算、给出交易号；对外流程与后台一致', async () => {
  const v = ok(await call('GET', '/open/verify/order/' + full.order_no))
  assert.equal(v.found, true); assert.equal(v.proofValid, true); assert.equal(v.canonicalValid, true); assert.ok(v.chainRef && !String(v.chainRef).startsWith('NOOP'), '应有链上交易号')
  assert.equal(Number(v.versionNo), 50, '完成后对外验证应取最新版本（50），而不是支付时的 30')
  const pub = ok(await call('GET', '/open/attest/flow/' + full.order_no)); const adm = ok(await call('GET', '/admin/attest/flow/' + full.order_no, null, A))
  assert.equal(pub.steps.filter((s) => s.anchored || s.ev).length, adm.steps.filter((s) => s.ev).length, '对外流程与后台流程已有事件的步骤数一致')
})
await t('结算单与旅豆日终：对外验证已锚定且借贷平衡', async () => {
  const s = ok(await call('GET', '/open/verify/settlement/' + full.settlement_id)); assert.equal(s.found, true)
  const d = await one(`SELECT DATE(l.created_at) d FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id < 999999000000 ORDER BY l.id DESC LIMIT 1`)
  const day = new Date(d.d).toISOString().slice(0, 10); const bd = ok(await call('GET', '/open/verify/bean-day/' + day))
  assert.equal(bd.found, true); assert.equal(bd.balanced, true); assert.ok(bd.chainRef, '日终根应已锚定')
})
await t('游客侧"可信记录"：该订单已封存，校验码取最新版本（不是支付时的那一条）', async () => {
  const u = await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [full.user_id])
  const tok = ok(await call('POST', '/c/auth/login', { code: String(u.mini_a_openid).replace(/^mock-openid-/, '') })).token
  const id = ok(await call('GET', '/c/identity', null, tok)); const a = id.attestations.find((x) => x.orderNo === full.order_no)
  assert.ok(a, '游客身份页应有该订单的可信记录'); assert.equal(a.sealed, true)
  const latest = await one("SELECT payload_hash FROM attest_event WHERE biz_type='order' AND biz_ref=? ORDER BY version_no DESC, id DESC LIMIT 1", [full.order_no])
  assert.equal(a.code, String(latest.payload_hash).slice(0, 8).toUpperCase(), '校验码应是最新版本的')
})
await t('后台总览 / 存证中心：已锚定数 = 数据库，待处理为 0', async () => {
  const ov = ok(await call('GET', '/admin/web3/overview', null, A)); const e = await one('SELECT COUNT(*) n, SUM(status = 2) a FROM attest_event'); const b = await one('SELECT COUNT(*) n, SUM(status = 2) a FROM attest_batch')
  assert.equal(ov.events, Number(e.n)); assert.equal(ov.anchoredEvents, Number(e.a)); assert.equal(ov.pendingEvents, 0)
  assert.equal(ov.batches, Number(b.n)); assert.equal(ov.anchoredBatches, Number(b.a))
  const queue = ok(await call('GET', '/admin/attest/center', null, A)).queue // 按事件类型汇总：pending / packed / anchored / total
  assert.equal(queue.reduce((s, r) => s + Number(r.pending) + Number(r.packed), 0), 0, '没有待打包 / 已打包未锚定的事件：' + JSON.stringify(queue))
  assert.equal(queue.reduce((s, r) => s + Number(r.anchored), 0), Number(e.n))
})

console.log('\n== 四、持续运行：锚定之后再走一整笔新订单 ==')
let newOrder
await t('新订单走完全程（下单→支付→核销→完成→返豆）：新事件先是待处理，打包锚定后全部上链，且不重复', async () => {
  const sess = await one(`SELECT s.id, p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE p.status = 1 AND s.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 2 ORDER BY s.id LIMIT 1`)
  const login = async (c) => ok(await call('POST', '/c/auth/login', { code: c }))
  const buyer = await login('mock-chain-buyer-' + stamp), st = await login('mock-chain-staff-' + stamp)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [sess.merchant_id, st.user.id])
  const B = ok(await call('POST', '/m/auth/login', { code: 'mock-chain-staff-' + stamp, merchantId: sess.merchant_id })).token
  const o = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0 }, buyer.token)); newOrder = o.orderNo
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: o.orderNo }, A))
  const pid = ok(await call('GET', '/c/orders/' + o.orderNo, null, buyer.token)).passes[0].id
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: ok(await call('GET', `/c/pass/${pid}/code`, null, buyer.token)).qr }, B)).ok, true)
  ok(await call('POST', '/admin/dev/complete', { orderNo: o.orderNo }, A))
  const pend = await one("SELECT COUNT(*) n FROM attest_event WHERE status <> 2"); assert.ok(Number(pend.n) >= 5, '新订单应产生待处理的存证事件（支付/出票/核销/订单完成/返豆）：' + pend.n)
  const before = await one('SELECT COUNT(*) n FROM attest_event'); await runChain()
  assert.equal(Number((await one('SELECT COUNT(*) n FROM attest_event WHERE status <> 2')).n), 0, '新事件应全部上链')
  assert.equal(Number((await one('SELECT COUNT(*) n FROM attest_event')).n), Number(before.n), '锚定不应产生新事件')
  const f = ok(await call('GET', '/admin/attest/flow/' + o.orderNo, null, A))
  const miss = f.steps.filter((s) => ['order', 'issue', 'verify', 'grant'].includes(s.key)).filter((s) => !(s.ev && Number(s.ev.status) === 2)).map((s) => s.key)
  assert.deepEqual(miss, [])
})
await t('重复触发幂等：再打包 / 再锚定不产生新批次，数据不变', async () => {
  const before = await one('SELECT (SELECT COUNT(*) FROM attest_batch) b, (SELECT COUNT(*) FROM attest_event) e, (SELECT COUNT(*) FROM attest_event WHERE status = 2) a')
  const p = ok(await job('attest-pack')); ok(await job('attest-anchor')); ok(await job('attest-anchor'))
  const after = await one('SELECT (SELECT COUNT(*) FROM attest_batch) b, (SELECT COUNT(*) FROM attest_event) e, (SELECT COUNT(*) FROM attest_event WHERE status = 2) a')
  assert.deepEqual([Number(after.b), Number(after.e), Number(after.a)], [Number(before.b), Number(before.e), Number(before.a)]); assert.equal(Number(p.n || 0), 0)
  const rec = await attest.reconcile(); const failed = rec.checks.filter((x) => !x.ok)
  assert.deepEqual(failed.map((x) => x.name || x.label || JSON.stringify(x).slice(0, 80)), [], '存证对账有未通过项'); console.log('      对账 ' + rec.checks.length + ' 项全部通过')
})
console.log('\n== 五、链上数字权益：资产发行 与 数字身份凭证 ==')
const loginC = async (c) => ok(await call('POST', '/c/auth/login', { code: c }))
await t('资产发行（自测链）：发行成功并给出交易号；同一资产重复发行幂等；未接链时排队的"待发行"重试后也上链；台账与统计一致', async () => {
  const u = await loginC('mock-chain-asset-' + stamp); const tokenId = 'chain-e2e-' + stamp
  const r = ok(await call('POST', '/admin/web3/assets/issue', { kind: 'badge', userId: u.user.id, channel: 'ecosystem', meta: { name: '链上回归' }, tokenId }, A))
  assert.equal(r.status, 1, '自测链支持发行，应直接成功：' + JSON.stringify(r)); assert.ok(r.txRef, '应有交易号')
  const again = ok(await call('POST', '/admin/web3/assets/issue', { kind: 'badge', userId: u.user.id, channel: 'ecosystem', meta: {}, tokenId }, A))
  assert.equal(again.skipped, true); assert.equal(again.txRef, r.txRef, '重复发行不应产生新交易')
  // 未接链时排队的待发行：接链后重试，应全部上链（语义闸门：未接链时只落台账、绝不写假交易号）
  const pend = await q('SELECT id FROM asset_issue WHERE status = 0')
  for (const x of pend) { const rr = ok(await call('POST', `/admin/web3/assets/${x.id}/retry`, {}, A)); assert.equal(rr.status, 1, '待发行重试应成功：' + JSON.stringify(rr)) }
  const lst = ok(await call('GET', '/admin/web3/assets', null, A))
  assert.ok(lst.rows.some((x) => x.tx_ref === r.txRef && Number(x.status) === 1), '后台台账应有该笔')
  const st = await one('SELECT SUM(status = 0) p, SUM(status = 1) i FROM asset_issue')
  assert.equal(Number(st.p || 0), 0, '不应再有待发行')
  const noTx = await one("SELECT COUNT(*) n FROM asset_issue WHERE status = 1 AND (tx_ref IS NULL OR tx_ref = '')")
  assert.equal(Number(noTx.n), 0, '已发行的必须都有交易号')
})
await t('数字身份凭证 VC：游客取得 → 对外验证有效；声明里不含姓名 / 手机号 / 订单号 / 金额；后台吊销后验证失败；被改动的验证失败', async () => {
  const u = await loginC('mock-chain-vc-' + stamp)
  const v = ok(await call('GET', '/c/vc', null, u.token)); assert.ok(v.jwt && v.did)
  const walk = (o, ks) => { if (Array.isArray(o)) o.forEach((x) => walk(x, ks)); else if (o && typeof o === 'object') for (const [k, x] of Object.entries(o)) { ks.push(k); walk(x, ks) } }
  const ks = []; walk(v.claims, ks); assert.ok(!ks.some((k) => /name|phone|mobile|idno|order|amount|gmv/i.test(k)), '凭证声明里不应有个人信息 / 订单 / 金额字段：' + ks)
  const ver = ok(await call('POST', '/open/vc/verify', { jwt: v.jwt })); assert.equal(ver.valid, true, '应验证通过：' + JSON.stringify(ver))
  const rec = await one('SELECT id FROM vc_issue ORDER BY id DESC LIMIT 1'); assert.ok(rec)
  ok(await call('POST', `/admin/web3/vc/${rec.id}/revoke`, { reason: '链上回归吊销' }, A))
  const after = ok(await call('POST', '/open/vc/verify', { jwt: v.jwt })); assert.equal(after.valid, false); assert.match(String(after.reason), /吊销/)
  const tampered = v.jwt.slice(0, -4) + (v.jwt.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  assert.equal(ok(await call('POST', '/open/vc/verify', { jwt: tampered })).valid, false, '被改动的凭证必须验证失败')
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
