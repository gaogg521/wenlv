// U-01 / QA-06 回归：回单附件真实往返（上传→登记→受控下载→SHA-256 一致→越权拒绝→真实落盘）。
// Codex 复验整改点：
//  1) 隔离库守卫（此前缺失）；
//  2) 测试自建全部夹具（专用用户/共创人/分润单），不依赖旧库遗留；
//  3) finally 只释放资源，绝不 process.exit(0) 吞失败——断言失败自然非零退出；
//  4) 审计清理按本次夹具 ID 精确缩窄（不再整模块 'coprofit-%'）；
//  5) 配套故意失败对照运行证明退出码非零（见台账/交回材料中的对照记录）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-receipt-roundtrip.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const stamp = 'QARC' + Math.random().toString(36).slice(2, 8)
const superT = jwtSign({ end: 'admin', role: 'super', name: '回单回归-超管' })
const financeT = jwtSign({ end: 'admin', role: 'finance', name: '回单回归-财务' })
const reviewT = jwtSign({ end: 'admin', role: 'review', name: '回单回归-审核' })
const made = { payIds: [], files: [], coCreatorIds: [], coProfitIds: [], auditRefs: [] }
try {
  // ===== 自建夹具：商品/共创人/分润单（不依赖旧库遗留）=====
  const prod = await one('SELECT id FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要至少一个在架商品')
  const cc = (await q('INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct, status) VALUES (?,?,?,?,?,100000,500,1)',
    [prod.id, stamp + '-CC', stamp + '共创人', '13800000001', 2, 100000, 500])).insertId
  made.coCreatorIds.push(cc)
  const cp = (await q('INSERT INTO co_profit (co_creator_id, product_id, settlement_id, period, base_amount, amount, pay_channel, pay_ref, paid_at, paid_by, pay_note, paid_amount, status) VALUES (?,?,?,?,?,?,\'\',\'\',NULL,\'\',\'\',0,0)',
    [cc, prod.id, 0, stamp + '-P1', 50000, 50000])).insertId
  made.coProfitIds.push(cp)

  // 1) 真实 PDF 字节（%PDF- 魔数 + 随机内容）
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(2048), Buffer.from('\n%%EOF')])
  const up = ok(await call('POST', '/admin/co-profits/receipt-upload', { data: pdfBytes.toString('base64'), ext: 'pdf' }, financeT))
  assert.match(up.url, /^\/receipts\/receipt_\d+_\d+\.pdf$/, '上传返回受控路径')
  made.files.push(up.url)
  // 越权：review 不能上传
  assert.equal((await call('POST', '/admin/co-profits/receipt-upload', { data: pdfBytes.toString('base64'), ext: 'pdf' }, reviewT)).code, 1003, '审核不能上传回单')

  // 2) 登记打款带回单
  const payRef = stamp + '-PAY1'
  made.auditRefs.push('coprofit-' + cp)
  const pay = ok(await call('POST', `/admin/co-profits/${cp}/pay`, { payRef, channel: 'bank', payDate: '2026-11-05', amount: 10000, receiptUrl: up.url, note: stamp + ' 回单往返验证' }, financeT))
  made.payIds.push(pay.payId)

  // 3) 受控下载逐字节比对（finance）
  const dl = ok(await call('GET', `/admin/co-profits/pays/${pay.payId}/receipt`, null, financeT))
  assert.equal(dl.contentType, 'application/pdf')
  const roundTrip = Buffer.from(dl.data, 'base64')
  assert.equal(roundTrip.length, pdfBytes.length, '往返字节数一致')
  assert.equal(crypto.createHash('sha256').update(roundTrip).digest('hex'), crypto.createHash('sha256').update(pdfBytes).digest('hex'), '往返 SHA-256 一致')
  // 4) 不存在/非法路径
  assert.equal((await call('GET', '/admin/co-profits/pays/999999999/receipt', null, financeT)).code, 1004)
  assert.equal((await call('POST', `/admin/co-profits/${cp}/pay`, { payRef: stamp + '-BAD', channel: 'bank', amount: 100, receiptUrl: '/uploads/evil.png' }, financeT)).code, 1001, '非 /receipts 路径拒绝')
  // 5) review 不能下载
  assert.equal((await call('GET', `/admin/co-profits/pays/${pay.payId}/receipt`, null, reviewT)).code, 1003, '审核不能下载回单')
  // 6) 文件真实落盘
  const diskFile = path.join('static', 'receipts', up.url.replace('/receipts/', ''))
  assert.ok(fs.existsSync(diskFile), '回单文件真实落盘')
  assert.equal(fs.statSync(diskFile).size, pdfBytes.length, '落盘大小一致')

  console.log(`U-01/QA-06 回单往返通过：上传→登记→下载 SHA-256 一致→越权拒绝→真实落盘（夹具 ${stamp}）`)
} finally {
  // 精确清理：只删本次夹具的 pay/分润/共创人/审计（按 biz_ref=本次 coprofit-ID）与文件
  for (const pid of made.payIds) await q('DELETE FROM co_profit_pay WHERE id = ?', [pid]).catch(() => {})
  for (const cpId of made.coProfitIds) {
    await q('DELETE FROM co_profit_pay WHERE co_profit_id = ?', [cpId]).catch(() => {})
    await q('DELETE FROM co_profit WHERE id = ?', [cpId]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='co-profit' AND biz_ref = ?", ['coprofit-' + cpId]).catch(() => {})
  }
  for (const ccId of made.coCreatorIds) await q('DELETE FROM co_creator WHERE id = ?', [ccId]).catch(() => {})
  for (const f of made.files) { try { fs.unlinkSync(path.join('static', 'receipts', f.replace('/receipts/', ''))) } catch { /* 已清 */ } }
  await closeDb()
}
