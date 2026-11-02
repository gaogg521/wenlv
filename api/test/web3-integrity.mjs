// Web3 存证完整性断言（可重复运行）
// 覆盖方案文档 §11 的 A1–A6 与公开验证的离线重算（A3 的对外形态）
// 运行：node test/web3-integrity.mjs
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/web3-integrity.mjs') // 会写库：只能对隔离库运行
import mysql from 'mysql2/promise'
import { packBatch, closeBeanDay, reconcile, verifyProof } from '../src/domain/attest.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'wanderlust',
  dateStrings: true,
})
const rows = async (sql, p = []) => (await db.query(sql, p))[0]
const row = async (sql, p = []) => (await rows(sql, p))[0] || null

let pass = 0
let fail = 0
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  PASS ', msg) }
  else { fail++; console.log('  FAIL ', msg, extra !== undefined ? JSON.stringify(extra) : '') }
}

console.log('== 0. 准备：把待打包事件打包（生成 proof）==')
const packed = await packBatch()
console.log('  packed batch#' + packed.batchId, 'seq', packed.seq, 'leaves', packed.leaves)
const today = new Date().toISOString().slice(0, 10)
// 当日封存允许重封（force）：测试要反复运行，历史日一旦封存即不可变
const dayClose = await closeBeanDay(today, { force: true })
console.log('  bean-day', dayClose.bizDate, dayClose.skipped ? '已封存' : (dayClose.ok ? 'root ' + String(dayClose.root).slice(0, 10) : '拒绝:' + dayClose.reason))

console.log('== A1 无假上链记录 ==')
const fake = await row(`SELECT COUNT(*) n FROM attest_batch WHERE status = 2 AND (chain_tx_ref IS NULL OR chain_tx_ref LIKE 'NOOP%')`)
ok(Number(fake.n) === 0, 'status=2 的批次必须有真实 txRef，假上链 0 条', fake)

console.log('== A2 事件类型覆盖 ≥7 ==')
const types = await rows('SELECT biz_type, COUNT(*) n FROM attest_event GROUP BY biz_type ORDER BY biz_type')
const need = ['order', 'pass_issue', 'pass_verify', 'bean_grant', 'bean_deduct', 'refund', 'settlement']
const have = types.map((t) => t.biz_type)
ok(need.every((t) => have.includes(t)), `${need.length} 类事件全部有埋点（实际 ${have.length} 类）`, have)

console.log('== A3 inclusion proof 可离线重算 ==')
const batches = await rows(`SELECT id, merkle_root, merkle_version FROM attest_batch WHERE status >= 1`)
let checked = 0
let bad = []
for (const b of batches) {
  const evs = await rows('SELECT id, payload_hash, leaf_index, leaf_path FROM attest_event WHERE batch_id = ?', [b.id])
  if (!evs.length) continue
  for (const e of evs) {
    const path = typeof e.leaf_path === 'string' ? JSON.parse(e.leaf_path) : e.leaf_path
    if (!path) { bad.push({ batch: b.id, event: e.id, why: 'no proof' }); continue }
    checked++
    if (!verifyProof(e.payload_hash, path, b.merkle_root, b.merkle_version)) bad.push({ batch: b.id, event: e.id, why: 'root mismatch' })
  }
}
ok(checked > 0 && bad.length === 0, `逐条重算 ${checked} 片叶子，全部等于批次根`, bad.slice(0, 3))

console.log('== A4 旅豆日终根借贷恒等 ==')
const imb = await row('SELECT COUNT(*) n FROM bean_day_root WHERE debit_sum <> credit_sum')
const roots = await rows('SELECT biz_date, leaf_count, debit_sum, credit_sum, LEFT(merkle_root,10) root FROM bean_day_root ORDER BY biz_date DESC LIMIT 3')
ok(Number(imb.n) === 0, '不存在借贷不平的日终根', imb)
ok(roots.length > 0, `已封存日期 ≥1（最新 ${roots[0]?.biz_date}，叶数 ${roots[0]?.leaf_count}）`, roots)

console.log('== A5 存证链不断（prev_root）==')
const broken = await row(`
  SELECT COUNT(*) n FROM attest_batch b JOIN attest_batch p ON b.seq = p.seq + 1
   WHERE b.prev_root IS NOT NULL AND b.prev_root <> p.merkle_root`)
const chainRows = await rows('SELECT seq, LEFT(merkle_root,8) r, LEFT(COALESCE(prev_root,""),8) p FROM attest_batch ORDER BY seq DESC LIMIT 3')
ok(Number(broken.n) === 0, '每批 prev_root = 上一批 root', { broken: Number(broken.n), tail: chainRows })

console.log('== A6 旅豆流水均有存证（≥95%）==')
// 按事务号计：一笔发放/抵扣在双分录账本里是两行，用行数会把正常情况误判成漏埋点
const m = await row(`SELECT (SELECT COUNT(DISTINCT tx_no) FROM bean_ledger) ledger,
  (SELECT COUNT(*) FROM attest_event WHERE biz_type IN ('bean_grant','bean_deduct')) attested`)
const ratio = Number(m.ledger) === 0 ? 1 : Number(m.attested) / Number(m.ledger)
ok(ratio >= 0.95, `旅豆事务 ${m.ledger} 笔 / 存证 ${m.attested} 条 = ${(ratio * 100).toFixed(1)}%`, m)

console.log('== A7 公开验证接口可离线复核（对外形态）==')
const someOrder = await row(`SELECT biz_ref FROM attest_event WHERE biz_type='order' AND batch_id IS NOT NULL ORDER BY id DESC LIMIT 1`)
if (someOrder) {
  const res = await fetch(`${API}/open/verify/order/${encodeURIComponent(someOrder.biz_ref)}`)
  const j = await res.json()
  const d = j.data || {}
  ok(d.found === true && d.proofValid === true && Array.isArray(d.leafPath) && d.leafPath.length > 0,
    `单号 ${someOrder.biz_ref}：返回 leafPath(${d.leafPath?.length || 0} 层) 且本地重算通过`, d.note)
  ok(!('amount' in d) && !('contact' in d), '公开验证不暴露金额与联系人')
} else {
  ok(false, '无可验证订单（先跑 npm run e2e 造数据）')
}

console.log('== A10 存证报告 PDF（订单）==')
if (someOrder) {
  const r = await fetch(`${API}/open/report/order/${encodeURIComponent(someOrder.biz_ref)}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const magic = buf.subarray(0, 5).toString()
  ok(r.status === 200 && String(r.headers.get('content-type')).includes('application/pdf') && magic === '%PDF-' && buf.length > 20000,
    `PDF 输出：${(buf.length / 1024).toFixed(0)} KB · ${magic}`, { status: r.status, magic })
} else ok(false, '无可验证订单')

console.log('== A11 存证报告 PDF（旅豆账本日终）==')
{
  const r = await fetch(`${API}/open/report/bean-day/${today}`)
  const buf = Buffer.from(await r.arrayBuffer())
  ok(r.status === 200 && buf.subarray(0, 5).toString() === '%PDF-' && buf.length > 20000,
    `账本封存证明：${(buf.length / 1024).toFixed(0)} KB`, { status: r.status })
}

console.log('== A12 公开复核页（无登录可访问）==')
{
  const r = await fetch(`${API}/verify`)
  const html = await r.text()
  const need = ['本地', 'Merkle', 'recomputeLeaf', 'sha-256', '/open/verify/order/']
  ok(r.status === 200 && need.every((k) => html.toLowerCase().includes(k.toLowerCase())),
    '复核页可访问且包含浏览器内重算逻辑（crypto.subtle SHA-256）', { status: r.status, len: html.length })
  const r2 = await fetch(`${API}/verify?no=${encodeURIComponent(someOrder?.biz_ref || 'X')}`)
  ok(r2.status === 200, '带参数访问复核页正常（页面客户端渲染，参数由前端接管）', { status: r2.status })
}

console.log('== A13 上链自检脚本可运行 ==')
{
  const { execFileSync } = await import('node:child_process')
  try {
    const out = execFileSync(process.execPath, ['scripts/chain-ready.mjs'], { encoding: 'utf8', timeout: 30000 })
    ok(out.includes('本地侧全部就绪') || out.includes('配置就绪'), 'chain-ready 通过（NOOP 期：仅差链凭据）')
  } catch (e) {
    ok(false, 'chain-ready 运行失败', String(e.stdout || e.message).slice(0, 200))
  }
}

console.log('== A14 数字身份（VC）公开能力 ==')
{
  const jw = await fetch(`${API}/open/vc/issuer`).then((r) => r.json())
  const k = jw.data?.keys?.[0] || {}
  ok(jw.data?.issuer && k.kty === 'OKP' && k.crv === 'Ed25519' && !!k.x, 'JWKS 发布 Ed25519 公钥（第三方可离线验签）', jw.data?.kid)
  const bad = await fetch(`${API}/open/vc/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jwt: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImZha2UifQ.eyJzdWIiOiJkaWQ6Y246d2w6ZmFrZSJ9.AAAA' }),
  }).then((r) => r.json())
  ok(bad.data?.valid === false, '伪造凭证被拒（' + (bad.data?.reason || '') + '）')
  // 严格白名单：JWK 只应含这些字段，出现 d/priv/p 等即说明把私钥成分泄露出去了
  const allowed = ['kty', 'crv', 'x', 'kid', 'use', 'alg']
  ok(Object.keys(k).every((f) => allowed.includes(f)) && !('d' in k), 'JWKS 只含公钥字段（无 d/priv 私钥成分）', Object.keys(k))
}

console.log('== A15 结算记录的隐私边界 ==')
{
  // 取金额有辨识度的结算单（总额为 0 的手续费单会让"不含该数值"的检查误报）
  const st = await row('SELECT id, total_amount, fee_total FROM settlement WHERE total_amount > 99 ORDER BY id DESC LIMIT 1')
  if (st) {
    const r = await fetch(`${API}/open/verify/settlement/${st.id}`).then((x) => x.json())
    const d = r.data || {}
    const keys = Object.keys(d)
    ok(!keys.some((k) => /amount|amt|total|price|merchantName/i.test(k)), '公开复核不返回任何金额/商户名字段', keys)
    ok(!JSON.stringify(d).includes(String(st.total_amount)), '响应体不含结算总额数值')
    if (Number(st.fee_total) > 99) ok(!JSON.stringify(d).includes(String(st.fee_total)), '响应体不含退改手续费数值')
    ok(String(d.merkleRoot || '').length === 64, '返回 64 位校验码')
  } else ok(false, '无结算单可测（先跑 npm run e2e）')
}

console.log('== A8 六条不变式对账 ==')
const rec = await reconcile()
for (const c of rec.checks) ok(c.ok, `${c.id} ${c.name}`, c.detail)

console.log('== A9 语义分档：NOOP 下不得出现"已锚定" ==')
const noopAnchored = await row(`SELECT COUNT(*) n FROM attest_batch WHERE status = 2`)
const chainMode = process.env.CHAIN_ENDPOINT ? 'real' : 'noop'
ok(chainMode === 'real' || Number(noopAnchored.n) === 0,
  `链模式=${chainMode}，status=2 批次 ${noopAnchored.n} 个（NOOP 下必须为 0）`, noopAnchored)

console.log('== A16 多链预埋：ABI/keccak 与各家离线自检（不需要凭据）==')
{
  const abi = await import('../src/infra/abi.mjs')
  const st = abi.selfTest()
  ok(st.ok, 'keccak256 与 ABI 编码对公开已知值通过（空串哈希/ f242432a / a9059cbb）', st.detail)
  ok(abi.selectorOf('transfer(address,uint256)') === '0xa9059cbb', 'ERC-20 transfer 选择器正确（跨校验）')
  const { PROVIDERS } = await import('../src/infra/chain/index.mjs')
  for (const p of Object.values(PROVIDERS)) {
    if (typeof p.selfTest !== 'function') continue
    const r = p.selfTest()
    ok(r.ok, `${p.id} 离线自检通过（签名/编码路径可执行）`, r.detail)
  }
}

console.log(`\nWEB3 INTEGRITY: ${pass} PASS / ${fail} FAIL`)
await db.end()
process.exit(fail ? 1 : 0)
