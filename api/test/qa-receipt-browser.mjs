// QA-06 浏览器文件选择流程（真实 Chrome + Playwright setInputFiles）：
// 共创分润页 → 登记打款 → 文件选择器选择真实 PDF → 提交 → 数据库读回 receipt_url → 受控下载。
// 依赖本机 Chrome（与 Codex 验收脚本同一路径）；仅对隔离库 18095 运行。
import { chromium } from 'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/qa06-file-browser.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const base = 'http://127.0.0.1:' + (process.env.PORT || 18095)
const stamp = 'QAFB' + Math.random().toString(36).slice(2, 8)
const made = { payIds: [], files: [], coCreatorIds: [], coProfitIds: [] }
try {
  // 夹具
  const prod = await one('SELECT id FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  const cc = (await q('INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct, status) VALUES (?,?,?,?,?,100000,500,1)',
    [prod.id, stamp + '-CC', stamp + '共创人', '13800000001', 2, 100000, 500])).insertId
  made.coCreatorIds.push(cc)
  const cp = (await q('INSERT INTO co_profit (co_creator_id, product_id, settlement_id, period, base_amount, amount, pay_channel, pay_ref, paid_at, paid_by, pay_note, paid_amount, status) VALUES (?,?,?,?,?,?,\'\',\'\',NULL,\'\',\'\',0,0)',
    [cc, prod.id, 0, stamp + '-P1', 50000, 50000])).insertId
  made.coProfitIds.push(cp)
  // 真实临时 PDF 文件（浏览器将经由真实 file input 选择它）
  const tmpPdf = path.join('test', `qa06-${stamp}.pdf`)
  fs.writeFileSync(tmpPdf, Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(1024), Buffer.from('\n%%EOF')]))
  made.files.push(tmpPdf)

  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const p = await ctx.newPage()
    await p.goto(base + '/admin-ui')
    await p.locator('#luser').fill('admin')
    await p.locator('#lpass').fill('admin123')
    await p.locator('#loginSubmit').click()
    await p.locator('#frame').waitFor({ state: 'visible' })
    await p.evaluate(() => go('cocreate'))
    await p.waitForTimeout(800)
    // 打开登记打款弹窗（找本夹具分润单所在行的「登记打款」按钮）
    const rowBtn = p.locator(`tr:has-text("${stamp}-P1") button:has-text("登记打款")`)
    await rowBtn.first().click()
    await p.waitForTimeout(600)
    // 填表单并经真实 <input type=file> 选择文件
    await p.locator('#cpRef').fill(stamp + '-BROWSERPAY')
    await p.locator('#cpAmount').fill('100')
    await p.locator('#cpReceipt').setInputFiles(path.resolve(tmpPdf))
    await p.locator('#cpSubmit').click()
    await p.waitForTimeout(1200)
    // 数据库读回
    const y = await one('SELECT id, receipt_url, amount FROM co_profit_pay WHERE pay_ref = ?', [stamp + '-BROWSERPAY'])
    assert.ok(y, '浏览器提交的打款登记已落库')
    assert.match(y.receipt_url, /^\/receipts\/receipt_\d+_\d+\.pdf$/, '回单 URL 已随登记落库')
    made.payIds.push(y.id)
    made.files.push(y.receipt_url)
    // 受控下载核对字节数
    const T = jwtSign({ end: 'admin', role: 'super', name: 'QA06-浏览器' })
    const dlRaw = await (await fetch(base + `/admin/co-profits/pays/${y.id}/receipt`, { headers: { authorization: 'Bearer ' + T } })).json()
    const dl = dlRaw.data || dlRaw
    assert.equal(dl.contentType, 'application/pdf')
    const srcSize = fs.statSync(tmpPdf).size
    assert.equal(Buffer.from(dl.data, 'base64').length, srcSize, '浏览器所选文件经上传/下载字节数一致')
    assert.equal(crypto.createHash('sha256').update(Buffer.from(dl.data, 'base64')).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(tmpPdf)).digest('hex'), '文件SHA-256一致')
    await p.screenshot({ path: 'test/evidence-qa-final/receipt-file-select.png', fullPage: false })
    console.log(`QA-06 浏览器文件选择通过：真实 input[type=file] 选择 PDF → 上传 → 落库 receipt_url → 下载字节一致（${srcSize}B）`)
  } finally { await browser.close() }
} finally {
  for (const pid of made.payIds) await q('DELETE FROM co_profit_pay WHERE id = ?', [pid]).catch(() => {})
  for (const cpId of made.coProfitIds) {
    await q('DELETE FROM co_profit_pay WHERE co_profit_id = ?', [cpId]).catch(() => {})
    await q('DELETE FROM co_profit WHERE id = ?', [cpId]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='co-profit' AND biz_ref = ?", ['coprofit-' + cpId]).catch(() => {})
  }
  for (const ccId of made.coCreatorIds) await q('DELETE FROM co_creator WHERE id = ?', [ccId]).catch(() => {})
  for (const f of made.files) { try { fs.unlinkSync(f.startsWith('/receipts/') ? path.join('static', 'receipts', f.replace('/receipts/', '')) : f) } catch { /* 已清 */ } }
  await closeDb()
}
