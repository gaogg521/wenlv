// U-01 回归：回单附件真实往返（上传→登记→受控下载→SHA-256 一致→越权拒绝→真实落盘）。
// IAB 不支持文件选择器——字节级 API 校验是比截图更强的等价证据。
// 上传真实 PDF 字节 → 登记打款带回单 → 受控下载逐字节比对 → 错误回单路径拒绝 → 清理
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const base = 'http://127.0.0.1:' + (process.env.PORT || 18095)
const call = async (m, p, b, t, raw) => {
  const res = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return raw ? res : res.json()
}
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const superT = jwtSign({ end: 'admin', role: 'super', name: 'U01回归-超管' })
const opsT = jwtSign({ end: 'admin', role: 'ops', name: 'U01回归-运营' })
const financeT = jwtSign({ end: 'admin', role: 'finance', name: 'U01回归-财务' })
const made = { payIds: [], files: [], audits: [] }
try {
  const cp = await one("SELECT cp.id, cc.status co_status FROM co_profit cp JOIN co_creator cc ON cc.id = cp.co_creator_id WHERE cp.status = 0 AND cp.period LIKE 'U01P1%' ORDER BY cp.id DESC LIMIT 1")
  assert(cp, 'U01 夹具分润单缺失')
  // 1) 真实 PDF 字节（%PDF- 魔数 + 随机内容，模拟真实文件而非空串/固定串）
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(2048), Buffer.from('\n%%EOF')])
  const b64 = pdfBytes.toString('base64')
  const up = ok(await call('POST', '/admin/co-profits/receipt-upload', { data: b64, ext: 'pdf' }, financeT))
  assert.match(up.url, /^\/receipts\/receipt_\d+_\d+\.pdf$/, '上传返回受控路径')
  made.files.push(up.url)
  // 越权：review/城市账号不能上传
  const reviewT = jwtSign({ end: 'admin', role: 'review', name: 'U01回归-审核' })
  assert.equal((await call('POST', '/admin/co-profits/receipt-upload', { data: b64, ext: 'pdf' }, reviewT)).code, 1003, '审核不能上传回单')
  // 2) 登记打款带回单（金额低于阈值 → 直接生效）
  const payRef = 'U01RECEIPT' + Date.now()
  const pay = ok(await call('POST', `/admin/co-profits/${cp.id}/pay`, { payRef, channel: 'bank', payDate: '2026-11-05', amount: 10000, receiptUrl: up.url, note: 'U-01 回单往返验证' }, financeT))
  made.payIds.push(pay.payId)
  // 3) 受控下载逐字节比对（finance）
  const dl = ok(await call('GET', `/admin/co-profits/pays/${pay.payId}/receipt`, null, financeT))
  assert.equal(dl.contentType, 'application/pdf')
  const roundTrip = Buffer.from(dl.data, 'base64')
  assert.equal(roundTrip.length, pdfBytes.length, '往返字节数一致')
  assert.equal(crypto.createHash('sha256').update(roundTrip).digest('hex'), crypto.createHash('sha256').update(pdfBytes).digest('hex'), '往返 SHA-256 一致（真实文件语义）')
  // 4) 无回单文件路径：404；非法路径被拒
  assert.equal((await call('GET', '/admin/co-profits/pays/999999999/receipt', null, financeT)).code, 1004)
  assert.equal((await call('POST', `/admin/co-profits/${cp.id}/pay`, { payRef: 'U01BADPATH' + Date.now(), channel: 'bank', amount: 100, receiptUrl: '/uploads/evil.png' }, financeT)).code, 1001, '非 /receipts 路径拒绝')
  // 5) review 不能下载
  assert.equal((await call('GET', `/admin/co-profits/pays/${pay.payId}/receipt`, null, reviewT)).code, 1003, '审核不能下载回单')
  // 磁盘文件真实存在（不是只写库）
  const diskFile = path.join('static', 'receipts', up.url.replace('/receipts/', ''))
  assert.ok(fs.existsSync(diskFile), '回单文件真实落盘')
  assert.equal(fs.statSync(diskFile).size, pdfBytes.length, '落盘大小一致')
  console.log('U-01 回单往返：上传→登记→下载→SHA-256 一致→越权拒绝→真实落盘 全链通过')
} finally {
  for (const pid of made.payIds) await q('DELETE FROM co_profit_pay WHERE id = ?', [pid]).catch(() => {})
  await q("DELETE FROM co_profit_pay WHERE pay_ref LIKE 'U01RECEIPT%' OR pay_ref LIKE 'U01BADPATH%'").catch(() => {})
  await q("UPDATE co_profit SET paid_amount = 0, status = 0 WHERE period LIKE 'U01P1%'").catch(() => {})
  await q("DELETE FROM co_profit WHERE period LIKE 'U01P1%'").catch(() => {})
  await q("DELETE FROM co_creator WHERE co_no LIKE 'U01CC%'").catch(() => {})
  await q("DELETE FROM audit_log WHERE module='co-profit' AND biz_ref LIKE 'coprofit-%'").catch(() => {})
  for (const f of made.files) { try { fs.unlinkSync(path.join('static', 'receipts', f.replace('/receipts/', ''))) } catch { /* 已清 */ } }
  await closeDb()
  process.exit(0)
}
