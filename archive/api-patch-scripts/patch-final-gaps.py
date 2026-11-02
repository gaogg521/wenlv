# -*- coding: utf-8 -*-
import io

# ============ 1) wxpay.mjs：商家转账 V3（提现自动打款）============
w = io.open('src/domain/wxpay.mjs', encoding='utf-8').read()
anchor = "/** 回调验签占位"
add = '''/** 商家转账（V3 /v3/transfer/batches）：提现自动打款。MOCK 返回受理号。 */
export async function merchantTransfer({ outBatchNo, totalFen, remark }) {
  if (!isLive()) return { mock: true, batchNo: 'MOCK-' + outBatchNo, status: 'ACCEPTED' }
  const r = await httpJson('POST', '/v3/transfer/batches', {
    appid: CFG().appid, out_batch_no: outBatchNo,
    batch_name: '推广服务费', batch_remark: remark || '推广服务费结算',
    total_amount: totalFen, total_num: 1,
    transfer_detail_list: [{ out_detail_no: outBatchNo + '-D1', transfer_amount: totalFen, transfer_remark: remark || '推广服务费', openid: process.env.WX_TRANSFER_OPENID || '' }],
  })
  return { mock: false, batchNo: r.data.batch_id, status: r.data.batch_status }
}

''' + anchor
assert anchor in w
w = w.replace(anchor, add, 1)
io.open('src/domain/wxpay.mjs', 'w', encoding='utf-8', newline='\n').write(w)
print('wxpay: merchantTransfer added')

# ============ 2) jobs.mjs：豆过期 + 存证打包 + 全任务心跳 ============
j = io.open('src/jobs.mjs', encoding='utf-8').read()
old_loop = """    try {
      await tickClose()
      await tickComplete()
      // 心跳：运维控制台据此判断任务进程存活
      await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES ('main-loop', NOW(3), 'ok', 1)
               ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok', run_count = run_count + 1`, [])"""
new_loop = """    try {
      await tickClose()
      await tickComplete()
      await tickExpire()
      await tickAttest()
      // 心跳：运维控制台据此判断任务进程存活
      await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES ('main-loop', NOW(3), 'ok', 1)
               ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok', run_count = run_count + 1`, [])"""
assert old_loop in j
j = j.replace(old_loop, new_loop)

old_main = "async function main() {"
new_fns = '''/** 豆过期（滚动 12 个月 FIFO）：回收超期豆（负向分录 biz=6） */
async function tickExpire() {
  const months = 12
  const rows = await q(`SELECT l.account_id, a.user_id, SUM(l.amount) amt FROM bean_ledger l
    JOIN bean_account a ON a.id = l.account_id
    WHERE l.direction = 1 AND l.biz_type IN (1,2,3) AND l.created_at < NOW() - INTERVAL ? MONTH
      AND NOT EXISTS (SELECT 1 FROM bean_ledger x WHERE x.tx_no = l.tx_no AND x.biz_type = 6)
    GROUP BY l.account_id, a.user_id HAVING amt > 0`, [months])
  const { deduct, BIZ } = await import('./domain/bean.mjs')
  for (const r of rows) {
    try { await deduct(Number(r.user_id), Number(r.amt), BIZ.EXPIRE, 'EXPIRE-' + r.account_id); console.log('[job:expire]', r.user_id, r.amt) }
    catch (e) { console.error('[job:expire:err]', e.message) }
  }
}

/** 存证打包（小时级）：Merkle 根批次（Noop 链记录；P1 anchorToChain 换真实链） */
async function tickAttest() {
  const { packBatch } = await import('./domain/attest.mjs')
  const r = await packBatch()
  if (r.leaves > 0) console.log('[job:attest] batch #' + r.batchId, 'leaves', r.leaves, 'root', String(r.root).slice(0, 12))
}

async function main() {'''
assert old_main in j
j = j.replace(old_main, new_fns, 1)
io.open('src/jobs.mjs', 'w', encoding='utf-8', newline='\n').write(j)
print('jobs: expire + attest pack')

# ============ 3) routes：提现自动打款 + 笔记发布(机审) + 手动任务扩展 + 迁移信息 ============
r = io.open('src/routes.mjs', encoding='utf-8').read()

# 3a 提现：live 时自动商家转账
old_wd = """    const st = passed ? 1 : 2
    await q('UPDATE promoter_withdraw SET status = ?, reviewed_by = ?, reviewed_at = NOW(3), pay_ref = ? WHERE id = ?',
      [st, 'admin:' + a.name, passed ? (payRef || 'MANUAL-' + Date.now()) : null, w.id])"""
new_wd = """    const st = passed ? 1 : 2
    let finalRef = passed ? (payRef || 'MANUAL-' + Date.now()) : null
    if (passed && !payRef && wxpay.isLive()) {
      // 生产：自动商家转账（V3），流水号以转账批次号留痕
      const t = await wxpay.merchantTransfer({ outBatchNo: 'WD' + w.id + '-' + Date.now(), totalFen: Number(w.amount), remark: '推广服务费提现' })
      finalRef = 'WXBATCH-' + t.batchNo
    }
    await q('UPDATE promoter_withdraw SET status = ?, reviewed_by = ?, reviewed_at = NOW(3), pay_ref = ? WHERE id = ?',
      [st, 'admin:' + a.name, finalRef, w.id])"""
assert old_wd in r
r = r.replace(old_wd, new_wd)

# 3b 笔记发布（机审前置）
old_ci = "// 用户侧数字身份（小程序 A「我的数字身份」页：Travel ID = 凭证+徽章+存证流水）"
add_notes = '''// 用户发布笔记（msgSecCheck 机审前置 → 过=发布 / 可疑=人工队列）
const cNotes = {
  'GET /c/notes': async (req) => {
    requireUser(req)
    return await q(`SELECT c.id, c.title, c.status, c.like_count, c.published_at FROM content_note c
      WHERE c.status = 2 ORDER BY c.published_at DESC LIMIT 20`)
  },
  'POST /c/notes': async (req) => {
    const u = requireUser(req)
    const { title, body } = req.body
    if (!body) throw new BizError(1001, '内容不能为空')
    const { msgSecCheck } = await import('./infra/wxsec.mjs')
    const sec = await msgSecCheck((title || '') + ' ' + body, 'mock-openid-' + u.uid)
    const status = sec.pass ? 2 : 1 // 机审过→已发布；可疑→人工审核队列
    const id = await tx(async (c) => c.ins(
      'INSERT INTO content_note (user_id, title, body, status, sec_check_id) VALUES (?,?,?,?,?)',
      [u.uid, title || null, JSON.stringify({ text: body }), status, sec.mock ? 'mock' : 'wx-sec']))
    return { id, status, secMock: sec.mock, msg: status === 2 ? '已发布' : '进入人工审核' }
  },
}

''' + old_ci
assert old_ci in r
r = r.replace(old_ci, add_notes, 1)

# 3c 手动任务扩展：complete-due / attest-pack / bean-expire
old_runjob = """    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
    else throw new BizError(1001, '未知任务: ' + name)"""
new_runjob = """    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
    else if (name === 'attest-pack') { const { packBatch } = await import('./domain/attest.mjs'); const b = await packBatch(); n = b.leaves }
    else if (name === 'complete-due') { const { completeOrder } = await import('./jobs.mjs'); const rows = await q("SELECT order_no FROM orders WHERE status = 40 AND refund_deadline <= NOW(3) LIMIT 50"); for (const x of rows) await completeOrder(x.order_no); n = rows.length }
    else if (name === 'bean-expire') { const jobsMod = await import('./jobs.mjs'); await jobsMod.tickExpire(); n = -1 }
    else throw new BizError(1001, '未知任务: ' + name)"""
assert old_runjob in r
r = r.replace(old_runjob, new_runjob)

# 3d system overview 加迁移信息
old_tables = "const tables = await count(\"SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = 'wanderlust'\")"
new_tables = old_tables + """
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migDir = path.join(import.meta.dirname, '..', 'db', 'migration')
    const migrations = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : []"""
assert old_tables in r
r = r.replace(old_tables, new_tables)
r = r.replace("ledger: tb, idempotencyKeys: idem, tables,",
              "ledger: tb, idempotencyKeys: idem, tables, migrations,")

old_exp = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...web3, ...open, ...cIdentity, ...callback }"
new_exp = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...web3, ...open, ...cIdentity, ...cNotes, ...callback }"
assert old_exp in r
r = r.replace(old_exp, new_exp)
io.open('src/routes.mjs', 'w', encoding='utf-8', newline='\n').write(r)
print('routes: transfer/notes/jobs/migrations')

# ============ 4) admin UI：运维页任务按钮 + 迁移列表；内容审核页入口已存在 ============
a = io.open('admin/app.js', encoding='utf-8').read()
old_btns = """      <div><button class="btn ghost sm" onclick="runJob('close-timeout')">执行关单</button>
      <button class="btn ghost sm" onclick="runJob('commission-due')">执行佣金到期</button></div></div>"""
new_btns = """      <div>
        <button class="btn ghost sm" onclick="runJob('close-timeout')">关单</button>
        <button class="btn ghost sm" onclick="runJob('commission-due')">佣金到期</button>
        <button class="btn ghost sm" onclick="runJob('complete-due')">完成到期单</button>
        <button class="btn ghost sm" onclick="runJob('attest-pack')">存证打包</button>
        <button class="btn ghost sm" onclick="runJob('bean-expire')">豆过期</button>
      </div></div>
    <div class="row" style="margin-top:4px"><span class="muted">迁移脚本：${(o.migrations || []).map((m) => '<code>' + esc(m) + '</code>').join(' ')}</span></div>"""
assert old_btns in a
a = a.replace(old_btns, new_btns)
io.open('admin/app.js', 'w', encoding='utf-8', newline='\n').write(a)
print('admin UI: job buttons + migrations')
