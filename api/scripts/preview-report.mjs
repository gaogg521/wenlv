// 预览存证报告（排版自检）：node scripts/preview-report.mjs [order|bean] [bizRef|date]
// 产出 /tmp/report-order.png、/tmp/report-order.pdf（PNG 用来肉眼查中文与版式，PDF 用来查文件有效性）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'diag-shots')
// 产出直接用中文名落在 diag-shots/，避免一堆 report-order.png 这类名字
const NAME = { order: '订单存证证明样张', bean: '账本封存证明样张', settle: '商户结算可信记录样张' }
import { q, one } from '../src/db.mjs'
import { buildSvg, svgToPdf, svgToPng, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../src/domain/report.mjs'

const kind = process.argv[2] || 'order'
const arg = process.argv[3]
const BASE = process.env.PUBLIC_BASE || 'http://127.0.0.1:8080'

async function loadOrder(bizRef) {
  const ref = bizRef || (await one(`SELECT biz_ref FROM attest_event WHERE biz_type='order' ORDER BY id DESC LIMIT 1`))?.biz_ref
  const e = await one(`SELECT e.*, b.merkle_root, b.seq, b.chain_tx_ref, b.chain_block, b.anchored_at
    FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
    WHERE e.biz_type='order' AND e.biz_ref=? ORDER BY e.version_no DESC LIMIT 1`, [ref])
  if (!e) throw new Error('找不到订单存证：' + ref)
  return {
    found: true, bizType: 'order', bizRef: e.biz_ref, versionNo: Number(e.version_no),
    payloadHash: e.payload_hash, status: Number(e.status), merkleRoot: e.merkle_root,
    leafIndex: e.leaf_index, leafPath: typeof e.leaf_path === 'string' ? JSON.parse(e.leaf_path) : e.leaf_path,
    batchSeq: e.seq, chainRef: e.chain_tx_ref && !String(e.chain_tx_ref).startsWith('NOOP') ? e.chain_tx_ref : null,
    anchoredAt: e.anchored_at,
  }
}

async function loadBeanDay(date) {
  const d = date || (await one('SELECT biz_date FROM bean_day_root ORDER BY biz_date DESC LIMIT 1'))?.biz_date
  const r = await one('SELECT * FROM bean_day_root WHERE biz_date = ?', [d])
  if (!r) throw new Error('找不到账本封存：' + d)
  const b = r.batch_id ? await one('SELECT * FROM attest_batch WHERE id = ?', [r.batch_id]) : null
  return {
    found: true, bizDate: String(r.biz_date).slice(0, 10), leafCount: Number(r.leaf_count),
    debitSum: Number(r.debit_sum), creditSum: Number(r.credit_sum),
    balanced: Number(r.debit_sum) === Number(r.credit_sum),
    merkleRoot: r.merkle_root, prevRoot: r.prev_root,
    chainRef: b && b.chain_tx_ref && !String(b.chain_tx_ref).startsWith('NOOP') ? b.chain_tx_ref : null,
    anchoredAt: b ? b.anchored_at : null,
  }
}

async function loadSettle(id) {
  const row = await one('SELECT * FROM settlement ORDER BY id DESC LIMIT 1')
  const sid = Number(id) || row.id
  const s2 = await one('SELECT * FROM settlement WHERE id = ?', [sid])
  const e = await one(`SELECT e.payload_hash, b.merkle_root FROM attest_event e LEFT JOIN attest_batch b ON b.id=e.batch_id
    WHERE e.biz_type='settlement' AND e.biz_ref=? ORDER BY e.version_no DESC LIMIT 1`, ['settle-' + sid])
  return {
    settlementId: s2.id, period: s2.period, orderCount: s2.order_count, totalAmount: s2.total_amount,
    amtFulfill: s2.amt_fulfill, amtService: s2.amt_service, amtPromoter: s2.amt_promoter,
    amtBeanbudget: s2.amt_beanbudget, amtRetained: s2.amt_retained, status: Number(s2.status),
    payloadHash: e && e.payload_hash, merkleRoot: e && e.merkle_root,
  }
}

let doc
if (kind === 'bean') doc = beanDayReportDoc(await loadBeanDay(arg), BASE)
else if (kind === 'settle') doc = settlementReportDoc(await loadSettle(arg), BASE)
else doc = orderReportDoc(await loadOrder(arg), BASE)
const svg = buildSvg(doc)
fs.mkdirSync(OUT, { recursive: true })
const base = NAME[kind] || kind
const png = svgToPng(svg)
fs.writeFileSync(path.join(OUT, base + '.png'), png)
const pdf = svgToPdf(svg)
fs.writeFileSync(path.join(OUT, base + '.pdf'), pdf)
console.log(`${base}.png/${base}.pdf  PNG ${(png.length / 1024).toFixed(0)} KB  PDF ${(pdf.length / 1024).toFixed(0)} KB  magic=${pdf.subarray(0, 5).toString()}`)
await q('SELECT 1')
process.exit(0)
