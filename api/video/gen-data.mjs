// 汇总视频所需的真实数据 → video/data.js（舞台用 <script> 加载，避开 file:// 的 fetch 限制）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'data.js')
const API = process.env.API || 'http://127.0.0.1:8080'

const get = async (p) => {
  const r = await fetch(API + p)
  const j = await r.json()
  return j.data !== undefined ? j.data : j
}

const db = await import('../src/db.mjs')

/* ---------- 订单：公开验证返回（含 inclusion proof） ---------- */
const order = await db.one(`SELECT biz_ref FROM attest_event WHERE biz_type='order' ORDER BY id DESC LIMIT 1`)
const verify = await get('/open/verify/order/' + encodeURIComponent(order.biz_ref))

/* ---------- 旅豆日终根 ---------- */
const day = await db.one('SELECT * FROM bean_day_root ORDER BY biz_date DESC LIMIT 1')
const dayStr = String(day.biz_date).slice(0, 10)

/* ---------- 结算单（五项恒等） ---------- */
const st = await db.one('SELECT * FROM settlement ORDER BY id DESC LIMIT 1')
const stEv = await db.one(
  `SELECT e.payload_hash, b.merkle_root FROM attest_event e LEFT JOIN attest_batch b ON b.id=e.batch_id
   WHERE e.biz_type='settlement' AND e.biz_ref=? ORDER BY e.version_no DESC LIMIT 1`, ['settle-' + st.id])

/* ---------- 链能力 ---------- */
const caps = await get('/open/chain/capabilities')

/* ---------- 数字身份 ---------- */
const vc = await db.one('SELECT * FROM vc_issue ORDER BY id DESC LIMIT 1')
let vcClaims = {}
try { vcClaims = JSON.parse(vc.claims) } catch { /* 老数据可能不是 JSON */ }

/* ---------- 事件类型统计（7 类） ---------- */
const types = await db.q(
  `SELECT biz_type, COUNT(*) n FROM attest_event GROUP BY biz_type ORDER BY n DESC`)

const num = (v) => Number(v || 0)
const yuan = (fen) => (num(fen) / 100).toFixed(2)

const data = {
  generatedAt: new Date().toISOString(),
  order: {
    no: verify.bizRef,
    versionNo: verify.versionNo,
    payloadHash: verify.payloadHash,
    merkleRoot: verify.merkleRoot,
    prevRoot: verify.prevRoot || null,
    batchSeq: verify.batchSeq,
    leafIndex: verify.leafIndex,
    leafCount: verify.leafCount,
    proofValid: verify.proofValid,
    leafPath: verify.leafPath || [],
    chainRef: verify.chainRef || null,
  },
  beanDay: {
    date: dayStr,
    leafCount: num(day.leaf_count),
    credit: num(day.credit_sum),
    debit: num(day.debit_sum),
    balanced: num(day.credit_sum) === num(day.debit_sum),
    merkleRoot: day.merkle_root,
    prevRoot: day.prev_root || null,
  },
  settlement: {
    id: num(st.id), period: st.period, orderCount: num(st.order_count),
    total: yuan(st.total_amount), totalCents: num(st.total_amount),
    fulfill: yuan(st.amt_fulfill), service: yuan(st.amt_service),
    promoter: yuan(st.amt_promoter), beanbudget: yuan(st.amt_beanbudget),
    retained: yuan(st.amt_retained),
    cents: {
      total: num(st.total_amount), fulfill: num(st.amt_fulfill), service: num(st.amt_service),
      promoter: num(st.amt_promoter), beanbudget: num(st.amt_beanbudget), retained: num(st.amt_retained),
    },
    status: num(st.status),
    code: stEv ? (stEv.merkle_root || stEv.payload_hash) : null,
  },
  vc: {
    did: vc.did, scope: vc.scope,
    claims: vcClaims,
    kid: null,
  },
  chain: {
    current: caps.current,
    providers: caps.providers.filter((p) => p.id !== 'mock'),
  },
  events: types.map((t) => ({ type: t.biz_type, count: num(t.n) })),
  totals: {
    events: types.reduce((s, t) => s + num(t.n), 0),
    types: types.length,
  },
}

const jwks = await get('/open/vc/issuer')
data.vc.kid = jwks.kid

fs.writeFileSync(OUT, 'window.DATA = ' + JSON.stringify(data, null, 2) + ';\n', 'utf8')

console.log('✓ data.js 已生成')
console.log('  订单', data.order.no, '| 版本 v' + data.order.versionNo, '| proof', data.order.leafPath.length, '层', '| 校验', data.order.proofValid)
console.log('  批次 #' + data.order.batchSeq, '第', data.order.leafIndex, '/', data.order.leafCount, '片')
console.log('  账本', data.beanDay.date, 'Σ贷', data.beanDay.credit, 'Σ借', data.beanDay.debit, '恒等', data.beanDay.balanced)
console.log('  结算 #' + data.settlement.id, '合计 ¥' + data.settlement.total, '五项',
  [data.settlement.fulfill, data.settlement.service, data.settlement.promoter, data.settlement.beanbudget, data.settlement.retained].join('/'))
console.log('  事件', data.totals.types, '类 /', data.totals.events, '条')
console.log('  链', data.chain.current.provider, data.chain.current.mode, '| provider 数', data.chain.providers.length)
console.log('  VC kid', data.vc.kid, '| scope', data.vc.scope)
process.exit(0)
