# -*- coding: utf-8 -*-
import io

s = io.open('src/routes.mjs', encoding='utf-8').read()

anchor = "// ---------- 微信支付回调 ----------"
add = '''// ---------- /admin 系统工作区（SRE）与生态/财务审批 ----------
const adminSys = {
  'GET /admin/system/overview': async (req) => {
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const t0 = Date.now()
    await q('SELECT 1')
    const dbLatency = Date.now() - t0
    const jobs = await q('SELECT * FROM sys_job')
    const mainLoop = jobs.find((j) => j.name === 'main-loop')
    const jobsAlive = mainLoop && Date.now() - new Date(mainLoop.last_run_at).getTime() < 180_000
    const attest = await one(`SELECT
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) failed FROM attest_event`)
    const pay = await one(`SELECT COUNT(*) total,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) ok FROM payment`)
    const orders = await one(`SELECT COUNT(*) total,
      SUM(CASE WHEN status = 10 AND created_at < NOW() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) stuck10 FROM orders`)
    const idem = await count('SELECT COUNT(*) c FROM idempotency_key')
    const { trialBalance } = await import('./domain/bean.mjs')
    const tb = await trialBalance()
    const tables = await count("SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = 'wanderlust'")
    return {
      db: { ok: true, latencyMs: dbLatency },
      service: { uptimeSec: Math.round(process.uptime()), node: process.version, payMode: wxpay.isLive() ? 'WECHAT-PAY-V3' : 'MOCK' },
      jobs: { alive: !!jobsAlive, lastRunAt: mainLoop?.last_run_at || null, runCount: mainLoop?.run_count || 0, detail: jobs },
      attestQueue: { pending: Number(attest?.pending || 0), anchored: Number(attest?.anchored || 0), failed: Number(attest?.failed || 0) },
      payment: { total: Number(pay?.total || 0), ok: Number(pay?.ok || 0) },
      ordersHealth: { total: Number(orders?.total || 0), stuckWaitPay30m: Number(orders?.stuck10 || 0) },
      ledger: tb, idempotencyKeys: idem, tables,
    }
  },

  'GET /admin/system/logs': async (req) => {
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const { q: kw } = req.query
    if (!kw) return { orderEvents: [], audits: [], verifies: [] }
    const orderEvents = await q(`SELECT o.order_no, e.from_st, e.to_st, e.actor, e.detail, e.created_at
      FROM order_event e JOIN orders o ON o.id = e.order_id WHERE o.order_no LIKE ? ORDER BY e.id DESC LIMIT 50`, ['%' + kw + '%'])
    const audits = await q(`SELECT * FROM audit_log WHERE actor LIKE ? OR biz_ref LIKE ? ORDER BY id DESC LIMIT 50`, ['%' + kw + '%', '%' + kw + '%'])
    const verifies = await q(`SELECT v.*, p.name pass_name FROM verification_log v JOIN travel_pass p ON p.id = v.pass_id
      WHERE CAST(v.pass_id AS CHAR) LIKE ? ORDER BY v.id DESC LIMIT 20`, ['%' + kw + '%'])
    return { orderEvents, audits, verifies }
  },

  'POST /admin/system/jobs/:name/run': async (req) => {
    await requireAdmin(req, ['super', 'sre'])
    const { name } = req.params
    const { closeTimeout } = await import('./domain/order.mjs')
    const { settleDue } = await import('./domain/promo.mjs')
    let n = -1
    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
    else throw new BizError(1001, '未知任务: ' + name)
    await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES (?, NOW(3), 'ok', 1)
             ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok'`, [name])
    return { affected: n }
  },

  'GET /admin/features': async (req) => {
    await requireAdmin(req)
    const rows = await q("SELECT k, v, memo FROM rule_config WHERE group_name = 'feature' ORDER BY k")
    return rows.map((r) => ({ key: r.k, on: String(r.v).includes('on'), memo: r.memo }))
  },
  'POST /admin/features/:key/toggle': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const cur = await one("SELECT v FROM rule_config WHERE k = ? AND group_name = 'feature'", [req.params.key])
    if (!cur) throw new BizError(1004, '开关不存在')
    const next = String(cur.v).includes('on') ? '"off"' : '"on"'
    await tx(async (c) => {
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ? WHERE k = ?', [next, 'admin:' + a.name, req.params.key])
      await audit(c, 'admin:' + a.name, 'feature', 'toggle', req.params.key, String(cur.v), next)
    })
    await loadConfig(true)
    return { key: req.params.key, on: next.includes('on') }
  },
}

const adminEco = {
  'GET /admin/content': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q('SELECT c.*, u.nickname FROM content_note c JOIN user_account u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 100')
  },
  'POST /admin/content/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'review'])
    const passed = req.body.pass
    const st = passed ? 2 : 3
    const n = await q('UPDATE content_note SET status = ? WHERE id = ? AND status IN (0,1)', [st, req.params.id])
    if (n.affectedRows === 1 && passed) await q('UPDATE content_note SET published_at = NOW(3) WHERE id = ? AND status = 2', [req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'content', passed ? 'approve' : 'reject', 'note-' + req.params.id, null, { status: st }))
    return { status: st }
  },
  'POST /admin/merchants/:id/approve': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    await q('UPDATE merchant SET status = 1 WHERE id = ? AND status = 0', [req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'merchant', 'approve', 'merchant-' + req.params.id, { status: 0 }, { status: 1 }))
    return { approved: true }
  },
  'GET /admin/agreements': async (req) => {
    await requireAdmin(req)
    return await q('SELECT ac.*, m.name merchant_name FROM agreement_change ac JOIN merchant m ON m.id = ac.merchant_id ORDER BY ac.id DESC')
  },
  'POST /admin/agreements/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const passed = req.body.pass
    const st = passed ? 1 : 2
    await q('UPDATE agreement_change SET status = ?, approved_by = ?, approved_at = NOW(3) WHERE id = ? AND status = 0', [st, 'admin:' + a.name, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'agreement', passed ? 'approve' : 'reject', 'agreement-' + req.params.id, { status: 0 }, { status: st }))
    return { status: st }
  },
}

const adminFin = {
  'GET /admin/withdrawals': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    return await q('SELECT w.*, u.nickname FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id ORDER BY w.id DESC LIMIT 100')
  },
  'POST /admin/withdrawals/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const { pass: passed, payRef } = req.body
    const w = await one('SELECT * FROM promoter_withdraw WHERE id = ? AND status = 0', [req.params.id])
    if (!w) throw new BizError(1004, '申请不存在或已处理')
    const st = passed ? 1 : 2
    await q('UPDATE promoter_withdraw SET status = ?, reviewed_by = ?, reviewed_at = NOW(3), pay_ref = ? WHERE id = ?',
      [st, 'admin:' + a.name, passed ? (payRef || 'MANUAL-' + Date.now()) : null, w.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'withdraw', passed ? 'pay' : 'reject', 'wd-' + w.id, { status: 0 }, { status: st, amount: w.amount }))
    return { status: st }
  },
}

const cWithdraw = {
  'GET /c/promote/overview': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT tier, rate_bp, status FROM promoter WHERE user_id = ?', [u.uid])
    if (!p) return { promoter: false }
    const agg = await one(`SELECT COALESCE(SUM(CASE WHEN status IN (1,2) THEN amount ELSE 0 END),0) earned,
      COALESCE(SUM(CASE WHEN status IN (3,4) THEN amount ELSE 0 END),0) reversed FROM commission WHERE promoter_id = ?`, [u.uid])
    const paid = await one(`SELECT COALESCE(SUM(w.amount),0) paid FROM promoter_withdraw w WHERE w.promoter_id = ? AND w.status = 1`, [u.uid])
    const pending = await count('SELECT COUNT(*) c FROM promoter_withdraw WHERE promoter_id = ? AND status = 0', [u.uid])
    return { promoter: true, tier: p.tier, rateBp: p.rate_bp, earned: Number(agg.earned), withdrawn: Number(paid.paid),
      withdrawable: Number(agg.earned) - Number(paid.paid), pendingRequests: pending }
  },
  'POST /c/promote/withdraw': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT status FROM promoter WHERE user_id = ? AND status = 1', [u.uid])
    if (!p) throw new BizError(6001, '非生效推广服务商')
    const cfgs = await cfgAll()
    if (String(cfgs['feature.withdraw'] || '"on"').includes('off')) throw new BizError(1003, '提现入口维护中')
    const ov = await cWithdraw['GET /c/promote/overview'](req)
    if (ov.withdrawable < 10000) throw new BizError(6001, '可提现余额不足 ¥100')
    const id = await tx(async (c) => c.ins(
      'INSERT INTO promoter_withdraw (promoter_id, amount, proposer_note) VALUES (?,?,?)',
      [u.uid, ov.withdrawable, req.body.note || '']))
    return { id, amount: ov.withdrawable }
  },
}

'''
assert anchor in s, 'anchor not found'
s = s.replace(anchor, add + anchor)
old_exp = "export const routes = { ...c, ...m, ...admin, ...callback }"
new_exp = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...callback }"
assert old_exp in s, 'export line not found'
s = s.replace(old_exp, new_exp)
io.open('src/routes.mjs', 'w', encoding='utf-8', newline='\n').write(s)
print('routes extended: system/eco/finance/withdraw')
