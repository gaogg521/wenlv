import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig } from '../config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
import * as order from '../domain/order.mjs'
import * as bean from '../domain/bean.mjs'
import * as pass from '../domain/pass.mjs'
import * as promo from '../domain/promo.mjs'
import * as refund from '../domain/refund.mjs'
import * as group from '../domain/group.mjs'
import * as wxpay from '../domain/wxpay.mjs'
import * as attestDomain from '../domain/attest.mjs'
import * as merkleLib from '../domain/merkle.mjs'
import * as refundPolicy from '../domain/refund-policy.mjs'
import { sanitizeRich } from '../infra/sanitize.mjs'
import { bizDay, settlementPeriod } from '../infra/bizdate.mjs'
import * as entities from '../domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../domain/report.mjs'
import * as vc from '../domain/vc.mjs'
import * as asset from '../domain/asset.mjs'
import * as badgeDomain from '../domain/badge.mjs'
import * as taskReview from '../domain/task-review.mjs'
import { findBanned, SUGGEST } from '../domain/wording.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from '../domain/onepager.mjs'
import * as chain from '../infra/chain.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import * as wxsec from '../infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'
import { actionRoles } from '../domain/admin-capabilities.mjs'

// 以 co_profit_pay 有效流水（status=1）为唯一事实源，重算分润单的已付额与结清状态。
// 冲正流水是负向金额，SUM 天然抵扣；调用方必须已持有 co_profit 行锁并在事务内。
// 最近打款展示取最近一笔有效正向流水；结清后清空由冲正导致的部分状态自动回待打款。
async function recalcCoProfitPay(c, cpId, operatorName) {
  const cp = await c.one('SELECT * FROM co_profit WHERE id = ? FOR UPDATE', [cpId])
  const paid = Number((await c.one('SELECT COALESCE(SUM(amount),0) s FROM co_profit_pay WHERE co_profit_id = ? AND status = 1', [cpId])).s)
  const last = await c.one("SELECT pay_ref, channel, note FROM co_profit_pay WHERE co_profit_id = ? AND status = 1 AND direction = 1 ORDER BY id DESC LIMIT 1", [cpId])
  const wasSettled = Number(cp.status) === 1
  const settled = Number(cp.status) !== 2 && paid >= Number(cp.amount)
  await c.upd(`UPDATE co_profit SET paid_amount = ?, status = ?, pay_ref = ?, pay_channel = ?, pay_note = ?,
    paid_at = ?, paid_by = ? WHERE id = ?`,
    [paid, Number(cp.status) === 2 ? 2 : (settled ? 1 : 0),
      last ? last.pay_ref : null, last ? last.channel : null, last ? last.note : null,
      settled && !wasSettled ? new Date() : (settled ? cp.paid_at : null),
      settled && !wasSettled ? (operatorName ? 'admin:' + operatorName : cp.paid_by) : (settled ? cp.paid_by : null),
      cpId])
  return { paid, settled }
}

// ---------- /admin 系统工作区（SRE）与生态/财务审批 ----------
const adminSys = {
  // 小程序数据分析（官方 getDailyVisitTrend；未配置凭据=MOCK 曲线）
  'GET /admin/wxdata/visit-trend': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'city_partner'])
    // days 由驾驶舱按所选周期传入（微信按日产出，最长 30 天，当日数据次日可见）
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7))
    return await wxapi.getDailyVisitTrend(days)
  },
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
    const { trialBalance } = await import('../domain/bean.mjs')
    const tb = await trialBalance()
    const tables = await count('SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE()')
    const { secretsHealth } = await import('../infra/secrets.mjs')
    const secrets = await secretsHealth()
    const mfaChannels = await (await import('../infra/mfa.mjs')).channelStatus()
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migDir = path.join(import.meta.dirname, '..', '..', 'db', 'migration')
    const migrations = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : []
    return {
      db: { ok: true, latencyMs: dbLatency },
      service: { uptimeSec: Math.round(process.uptime()), node: process.version, payMode: wxpay.isLive() ? 'WECHAT-PAY-V3' : 'MOCK' },
      jobs: { alive: !!jobsAlive, lastRunAt: mainLoop?.last_run_at || null, runCount: mainLoop?.run_count || 0, detail: jobs },
      attestQueue: { pending: Number(attest?.pending || 0), anchored: Number(attest?.anchored || 0), failed: Number(attest?.failed || 0) },
      payment: { total: Number(pay?.total || 0), ok: Number(pay?.ok || 0) },
      ordersHealth: { total: Number(orders?.total || 0), stuckWaitPay30m: Number(orders?.stuck10 || 0) },
      ledger: tb, idempotencyKeys: idem, tables, migrations, secrets, mfaChannels,
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
    // P-03/P-04：与页面按钮共用 system.jobRun 规则（开发账号看不到也可调用的假按钮）
    await requireAdmin(req, actionRoles('system.jobRun'))
    const { name } = req.params
    const { closeTimeout } = await import('../domain/order.mjs')
    const { settleDue } = await import('../domain/promo.mjs')
    let n = -1
    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
    else if (name === 'merchant-level') { n = 0; for (const m of await q('SELECT id FROM merchant WHERE status = 1')) { await badgeDomain.evaluateMerchantSafe(Number(m.id)); n++ } }
    else if (name === 'attest-pack') { const b = await attestDomain.packBatch(); n = b.leaves }
    else if (name === 'attest-anchor') { const c = await attestDomain.confirmPending(50); const r = await attestDomain.reanchorPending(50); n = [...c, ...r].filter((x) => x.anchored).length }
    else if (name === 'bean-day-close') { const r = await attestDomain.closeBeanDay(req.body && req.body.date); n = r.leaves || 0 }
    else if (name === 'attest-reconcile') { const r = await attestDomain.reconcile(); n = r.checks.filter((x) => x.ok).length }
    else if (name === 'complete-due') { const { completeOrder } = await import('../jobs.mjs'); const rows = await q("SELECT order_no FROM orders WHERE status = 40 AND refund_deadline <= NOW(3) LIMIT 50"); for (const x of rows) await completeOrder(x.order_no); n = rows.length }
    else if (name === 'bean-expire') { const jobsMod = await import('../jobs.mjs'); await jobsMod.tickExpire(); n = -1 }
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
  // T03/T10：服务端检索 + 分页契约 { rows, total, page, pageSize, statusCounts, countsScope, filters }
  'GET /admin/content': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const sc = scopeFilter(a, 'p.city_code')
    const conds = sc.sql ? [sc.sql.replace(' AND ', '')] : []
    const args = [...sc.params]
    const filters = {}
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null) { conds.push('c.status = ?'); args.push(status); filters.status = status }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(c.title LIKE ? OR u.nickname LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const from = `FROM content_note c JOIN user_account u ON u.id = c.user_id LEFT JOIN tour_product p ON p.id = c.related_product_id`
    const total = Number((await one(`SELECT COUNT(*) n ${from} ${W}`, args)).n)
    const rows = await q(`SELECT c.*, u.nickname, u.creator_tag ${from} ${W} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    const condsNoStatus = conds.filter((c) => c !== 'c.status = ?')
    const argsNoStatus = (() => { const out = []; let ai = 0; for (const c of conds) { const n = (c.match(/\?/g) || []).length; if (c === 'c.status = ?') { ai += n; continue } for (let k = 0; k < n; k++) out.push(args[ai++]); ai += n } return out })()
    const countsRaw = await q(`SELECT c.status, COUNT(*) n ${from} ${condsNoStatus.length ? 'WHERE ' + condsNoStatus.join(' AND ') : ''} GROUP BY c.status`, argsNoStatus)
    const statusCounts = Object.fromEntries(countsRaw.map((r) => [Number(r.status), Number(r.n)]))
    statusCounts.all = countsRaw.reduce((s, r) => s + Number(r.n), 0)
    return { rows, total, page, pageSize, statusCounts, countsScope: 'same-filters-except-status', filters }
  },

  // 评价管理（内容审核工作区）
  'GET /admin/reviews': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q(`SELECT r.*, u.nickname, p.title FROM review r
      JOIN user_account u ON u.id = r.user_id JOIN tour_product p ON p.id = r.product_id
      ORDER BY r.id DESC LIMIT 100`)
  },
  'POST /admin/reviews/:id/hide': async (req) => {
    const a = await requireAdmin(req, 'review.moderate')
    const st = req.body.show ? 1 : 0
    await q('UPDATE review SET status = ? WHERE id = ?', [st, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'review', st ? 'show' : 'hide', 'review-' + req.params.id, null, null))
    return { status: st }
  },

  // 笔记审核材料：全文（清洗后）、图片、字数、机审结果、作者、被哪些约稿任务引用
  'GET /admin/content/:id': async (req) => {
    const a=await requireAdmin(req, ['super', 'ops', 'review'])
    const n = await one('SELECT n.*,p.city_code FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id WHERE n.id=?', [req.params.id])
    if (!n) throw new BizError(1004, '笔记不存在')
    if(a.scopeCity&&a.scopeCity!==n.city_code)throw new BizError(1003,'仅可查看本城内容')
    const author = await one(`SELECT u.id, u.nickname, u.creator_tag,
        (SELECT COUNT(*) FROM content_note x WHERE x.user_id = u.id AND x.status = 2) published,
        (SELECT COUNT(*) FROM content_note x WHERE x.user_id = u.id AND x.status = 3) rejected
      FROM user_account u WHERE u.id = ?`, [n.user_id])
    if(a.scopeCity) {
      const counts=await one('SELECT SUM(x.status=2) published,SUM(x.status=3) rejected FROM content_note x JOIN tour_product p ON p.id=x.related_product_id WHERE x.user_id=? AND p.city_code=?',[n.user_id,a.scopeCity])
      author.published=Number(counts.published||0);author.rejected=Number(counts.rejected||0)
    }
    const product = n.related_product_id ? await one('SELECT id, title FROM tour_product WHERE id = ?', [n.related_product_id]) : null
    const tasks = await q(`SELECT t.id,t.title,e.status FROM content_task_entry e JOIN content_task t ON t.id=e.task_id LEFT JOIN tour_product p ON p.id=t.product_id WHERE e.note_id=?${a.scopeCity?' AND p.city_code=?':''}`,a.scopeCity?[n.id,a.scopeCity]:[n.id])
    return { note: taskReview.noteView(n, (u) => apiImg(u, req)), author, product, tasks }
  },
  'POST /admin/content/:id/verdict': async (req) => {
    const a = await requireAdmin(req, 'note.review')
    const passed = req.body.pass === true
    const reason = String(req.body.reason || '').trim()
    if (!passed && reason.length < 4) throw new BizError(1001, '请填写驳回原因（至少 4 个字），作者会在小程序里看到')
    if (reason.length > 300) throw new BizError(1001, '原因最多 300 字')
    const bad = findBanned(reason)
    if (bad) throw new BizError(1001, `原因会展示在小程序里，不能出现「${bad}」${SUGGEST[bad] ? '，可改为「' + SUGGEST[bad] + '」' : ''}`)
    const st = passed ? 2 : 3
    return tx(async (c) => {
      const row=await c.one('SELECT n.id,p.city_code FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id WHERE n.id=? FOR UPDATE',[req.params.id])
      if(a.scopeCity&&a.scopeCity!==row?.city_code)throw new BizError(1003,'仅可处理本城内容')
      const n = await c.upd(`UPDATE content_note SET status = ?, reject_reason = ?, published_at = IF(? = 2, NOW(3), published_at)
        WHERE id = ? AND status IN (0,1)`, [st, passed ? null : reason, st, req.params.id])
      if (n !== 1) throw new BizError(2002, '该笔记已处理，请刷新')
      await audit(c, 'admin:' + a.name, 'content', passed ? 'approve' : 'reject', 'note-' + req.params.id, null, { status: st, reason: reason || null })
      await c.q("UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'note' AND item_id = ? AND released_at IS NULL", [req.params.id])
      // 审核结论入存证：内容是平台对外承诺的一部分，"谁在什么时候放行/驳回"必须可追溯
      await attestDomain.attest('content_review', 'note-' + req.params.id, {
        noteId: Number(req.params.id), result: passed ? 'pass' : 'reject', cityCode: row?.city_code || null,
      }, c)
      return { status: st }
    })
  },
  'POST /admin/merchants/:id/approve': async (req) => {
    const a = await requireAdmin(req, 'merchant.approve')
    return tx(async cc => {
      const m = await cc.one('SELECT * FROM merchant WHERE id = ? AND status = 0 FOR UPDATE', [req.params.id])
      if (!m) throw new BizError(2002, '进件已处理或不存在')
      await cc.upd('UPDATE merchant SET status = 1, approved_at = NOW(3) WHERE id = ?', [m.id])
      if (m.applicant_user_id) await cc.q('INSERT INTO merchant_staff (merchant_id,user_id,role) VALUES (?,?,3) ON DUPLICATE KEY UPDATE role=3,status=1', [m.id, m.applicant_user_id])
      await audit(cc, 'admin:' + a.name, 'merchant', 'approve', 'merchant-' + m.id, { status: 0 }, { status: 1, owner: m.applicant_user_id })
      // R-01：商户准入状态变化入版本簿（关键归属/准入字段）
      const vseq = await cc.one('SELECT COALESCE(MAX(version_no), 0) v FROM master_data_version WHERE kind = ? AND ref_id = ?', ['merchant', m.id])
      await cc.q('INSERT INTO master_data_version (kind, ref_id, version_no, snapshot, changed_by, reason) VALUES (?,?,?,?,?,?)',
        ['merchant', m.id, Number(vseq.v) + 1, JSON.stringify({ before: { status: 0 }, after: { status: 1, owner: m.applicant_user_id || null }, changedFields: ['status'] }), 'admin:' + a.name, '进件审核通过'])
      // 主体准入入存证：一家商户什么时候被谁放进平台，是责任链的起点
      await attestDomain.attest('merchant_join', 'merchant-' + m.id, {
        merchantId: Number(m.id), applicantUserId: m.applicant_user_id ? Number(m.applicant_user_id) : null,
        cityCode: m.city_code || null, by: 'admin:' + a.name,
      }, cc)
      return { approved: true }
    })
  },
  'GET /admin/agreements': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
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

// ---------- 后台编辑能力（V14 补齐：风控处理/商户编辑/预算停用/推广商调档） ----------
const adminEdit = {
  // 风控事件处理（T12：必须有处理结论，不再以 handled=1 作为完整结案；复杂处置请升级为风险案件）
  'POST /admin/risk/:id/handle': async (req) => {
    const a = await requireAdmin(req, ['super', 'risk'])
    const reason = String(req.body?.reason || '').trim()
    if (reason.length < 4 || reason.length > 200) throw new BizError(1001, '请填写 4–200 字处理结论（进入审计）；复杂处置请升级为风险案件')
    const n = await q('UPDATE risk_event SET handled = 1 WHERE id = ? AND handled = 0', [req.params.id])
    if (!n.affectedRows) throw new BizError(2002, '事件已处理，请刷新')
    await tx(async (c) => audit(c, 'admin:' + a.name, 'risk', 'handle', 'risk-event-' + req.params.id, { handled: 0 }, { handled: 1, reason }))
    return { handled: true }
  },

  // 商户编辑（名称/城市/收付通子商户号）
  'POST /admin/merchants/:id': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { name, cityCode, wxpaySubMchid, kind } = req.body
    await q('UPDATE merchant SET name = ?, city_code = ?, wxpay_sub_mchid = ?, kind = ? WHERE id = ?',
      [name, cityCode, wxpaySubMchid || null, kind || 'other', req.params.id])
    return { updated: true }
  },

  // ===== 资源池（景区 / 供应商）：供给侧资源台账，独立于履约商户；城市合伙人行级隔离 =====
  'GET /admin/scenics': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a, 's.city_code'), ps = scopeFilter(a, 'p.city_code')
    return await q(`SELECT s.*, (SELECT COUNT(*) FROM tour_product p WHERE p.scenic_id = s.id${ps.sql}) product_count
      FROM scenic_spot s WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, [...ps.params, ...sc.params])
  },
  'POST /admin/scenics': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, level, coopMode, ticketInterface, contactName, contactPhone, profitTerms } = req.body
    if (!String(name || '').trim()) throw new BizError(1001, '景区名称必填')
    const id = await tx(async (c) => {
      const rid = await c.ins('INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, ticket_interface, contact_name, contact_phone, profit_terms, status) VALUES (?,?,?,?,?,?,?,?,1)',
        [cityCode || '310118', String(name).trim(), level || '', coopMode || '', ticketInterface || null, contactName || null, contactPhone || null, profitTerms || null])
      await audit(c, 'admin:' + a.name, 'scenic', 'create', 'scenic-' + rid, null, { name })
      return rid
    })
    return { id }
  },
  'PUT /admin/scenics/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const row = await one('SELECT * FROM scenic_spot WHERE id = ?', [req.params.id])
    if (!row) throw new BizError(1201, '景区不存在')
    const b = req.body
    const next = {
      name: b.name ?? row.name, city_code: b.cityCode ?? row.city_code, scenic_level: b.level ?? row.scenic_level,
      coop_mode: b.coopMode ?? row.coop_mode, ticket_interface: b.ticketInterface ?? row.ticket_interface,
      contact_name: b.contactName ?? row.contact_name, contact_phone: b.contactPhone ?? row.contact_phone,
      profit_terms: b.profitTerms ?? row.profit_terms, status: Number(b.status ?? row.status),
    }
    await tx(async (c) => {
      await c.q('UPDATE scenic_spot SET name=?, city_code=?, scenic_level=?, coop_mode=?, ticket_interface=?, contact_name=?, contact_phone=?, profit_terms=?, status=? WHERE id=?',
        [next.name, next.city_code, next.scenic_level, next.coop_mode, next.ticket_interface, next.contact_name, next.contact_phone, next.profit_terms, next.status, req.params.id])
      await audit(c, 'admin:' + a.name, 'scenic', 'update', 'scenic-' + row.id, { status: row.status }, { status: next.status })
    })
    return { updated: true }
  },

  'GET /admin/suppliers': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a)
    return await q(`SELECT s.*, (SELECT COUNT(*) FROM tour_product p WHERE p.supplier_id = s.id) product_count
      FROM supplier s WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },
  'POST /admin/suppliers': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, category, licenseNo, contactName, contactPhone, settleMode, note } = req.body
    if (!String(name || '').trim()) throw new BizError(1001, '供应商名称必填')
    const cat = SUP_CATS.includes(category) ? category : 'other'
    const settle = ['monthly', 'per_order', 'prepaid'].includes(settleMode) ? settleMode : 'monthly'
    const id = await tx(async (c) => {
      const sid = await c.ins('INSERT INTO supplier (city_code, name, category, license_no, contact_name, contact_phone, settle_mode, status, note) VALUES (?,?,?,?,?,?,?,1,?)',
        [cityCode || '310118', String(name).trim(), cat, licenseNo || null, contactName || null, contactPhone || null, settle, note || null])
      await audit(c, 'admin:' + a.name, 'supplier', 'create', 'supplier-' + sid, null, { name, category: cat })
      return sid
    })
    return { id }
  },
  'PUT /admin/suppliers/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const row = await one('SELECT * FROM supplier WHERE id = ?', [req.params.id])
    if (!row) throw new BizError(1201, '供应商不存在')
    const b = req.body
    const next = {
      name: b.name ?? row.name, city_code: b.cityCode ?? row.city_code,
      category: SUP_CATS.includes(b.category) ? b.category : row.category,
      license_no: b.licenseNo ?? row.license_no, contact_name: b.contactName ?? row.contact_name,
      contact_phone: b.contactPhone ?? row.contact_phone,
      settle_mode: ['monthly', 'per_order', 'prepaid'].includes(b.settleMode) ? b.settleMode : row.settle_mode,
      status: Number(b.status ?? row.status), note: b.note ?? row.note,
    }
    await tx(async (c) => {
      await c.q('UPDATE supplier SET name=?, city_code=?, category=?, license_no=?, contact_name=?, contact_phone=?, settle_mode=?, status=?, note=? WHERE id=?',
        [next.name, next.city_code, next.category, next.license_no, next.contact_name, next.contact_phone, next.settle_mode, next.status, next.note, req.params.id])
      await audit(c, 'admin:' + a.name, 'supplier', 'update', 'supplier-' + row.id, { status: row.status }, { status: next.status })
    })
    return { updated: true }
  },

  // 创作者池（UGC 运营）：按用户聚合内容产出；标签=资源状态（none/signed/star/limited）。T03：服务端检索 + 分页
  'GET /admin/creators': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 30)))
    const conds = [`(u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id) OR EXISTS (SELECT 1 FROM review r WHERE r.user_id = u.id))`]
    const args = []
    const filters = {}
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('u.nickname LIKE ?'); args.push('%' + kw + '%'); filters.kw = kw }
    const tag = String(req.query.tag || '').trim()
    if (tag && CREATOR_TAGS.includes(tag)) { conds.push('u.creator_tag = ?'); args.push(tag); filters.tag = tag }
    const W = 'WHERE ' + conds.join(' AND ')
    const base = `FROM user_account u`
    const total = Number((await one(`SELECT COUNT(*) n ${base} ${W}`, args)).n)
    const rows = await q(`SELECT u.id, u.nickname, u.creator_tag, u.member_level, u.status,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id) note_count,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) published_count,
      (SELECT COUNT(*) FROM review r WHERE r.user_id = u.id) review_count,
      (SELECT COUNT(*) FROM content_task_entry t WHERE t.user_id = u.id AND t.status = 3) task_done,
      (SELECT MAX(c.published_at) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) last_published
      ${base} ${W} ORDER BY published_count DESC, note_count DESC, u.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, filters }
  },
  'PUT /admin/creators/:id/tag': async (req) => {
    const a = await requireAdmin(req, 'creator.manage')
    const tag = String(req.body.tag || '')
    if (!CREATOR_TAGS.includes(tag)) throw new BizError(1001, '未知创作者标签')
    const u = await one('SELECT id, creator_tag FROM user_account WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1201, '用户不存在')
    await tx(async (c) => {
      await c.q('UPDATE user_account SET creator_tag = ? WHERE id = ?', [tag, req.params.id])
      await audit(c, 'admin:' + a.name, 'creator', 'tag', 'user-' + u.id, { tag: u.creator_tag }, { tag })
    })
    return { updated: true }
  },

  // 预算批次停用/启用
  'POST /admin/budgets/:id/status': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const { status } = req.body
    await q('UPDATE bean_budget SET status = ? WHERE id = ?', [Number(status), req.params.id])
    return { status: Number(status) }
  },

  // 推广商冻结/解冻
  'POST /admin/promoters/:userId/status': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { status } = req.body
    await q('UPDATE promoter SET status = ? WHERE user_id = ?', [Number(status), req.params.userId])
    return { status: Number(status) }
  },

  // 推广商调档
  'POST /admin/promoters/:userId/tier': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { tier } = req.body
    const rates = await cfgArr('promoter.rate_bp')
    const rate = rates[Math.max(1, Math.min(Number(tier), rates.length)) - 1]
    await q('UPDATE promoter SET tier = ?, rate_bp = ? WHERE user_id = ?', [Number(tier), rate, req.params.userId])
    return { tier: Number(tier), rateBp: rate }
  },
}

// ---------- 旧后台评估吸收：暗号/逐品佣金/KYC/共创（治理后台专用，词汇走 Web3 口径） ----------
const adminNew = {
  // 暗号管理（产品级一对）：剧本游"入戏"凭证
  // R-05：暗号列表服务端分页 + 关键字；?unconfigured=1 返回未配置产品（供「为线路配置暗号」下拉）
  'GET /admin/phrases': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    if (req.query.unconfigured != null) {
      const rows = await q(`SELECT p.id, p.title FROM tour_product p WHERE p.phrase_user IS NULL AND p.status = 1 ORDER BY p.id DESC LIMIT 100`)
      return { rows, total: rows.length }
    }
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = ['p.phrase_user IS NOT NULL'], args = []
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('p.title LIKE ?'); args.push('%' + kw + '%') }
    const W = 'WHERE ' + conds.join(' AND ')
    const total = Number((await one(`SELECT COUNT(*) n FROM tour_product p ${W}`, args)).n)
    const rows = await q(`SELECT p.id, p.title, p.phrase_user, p.phrase_merchant, p.channel FROM tour_product p ${W} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, filters: kw ? { kw } : {} }
  },
  'POST /admin/phrases/:pid': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { userPhrase, merchantPhrase } = req.body
    await q('UPDATE tour_product SET phrase_user = ?, phrase_merchant = ? WHERE id = ?',
      [String(userPhrase || '').trim() || null, String(merchantPhrase || '').trim() || null, req.params.pid])
    return { saved: true }
  },

  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶。
  // R-05：服务端分页 + 关键字；需要全量（如共创页下拉）显式传 pageSize 上限 500
  'GET /admin/rate-overrides': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(500, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = ['p.promo_rate_bp IS NOT NULL'], args = []
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('p.title LIKE ?'); args.push('%' + kw + '%') }
    const W = 'WHERE ' + conds.join(' AND ')
    const total = Number((await one(`SELECT COUNT(*) n FROM tour_product p ${W}`, args)).n)
    const avgBp = Number((await one(`SELECT AVG(p.promo_rate_bp) a FROM tour_product p ${W}`, args)).a) || 0
    const rows = await q(`SELECT p.id, p.title, p.promo_rate_bp, p.price_from,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_start')) rate_start, JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_end')) rate_end,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_reason')) rate_reason
      FROM tour_product p ${W} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, avgBp, filters: kw ? { kw } : {} }
  },
  'POST /admin/rate-overrides/:pid': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { rateBp } = req.body
    const v = rateBp == null ? null : Number(rateBp)
    if (v != null && (v <= 0 || v > 1200)) throw new BizError(1001, '单品费率需在 (0, 12%] 区间（bp ≤ 1200）')
    await q('UPDATE tour_product SET promo_rate_bp = ? WHERE id = ?', [v, req.params.pid])
    return { saved: true, rateBp: v }
  },

  // KYC 实名审核
  'GET /admin/kyc': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const status = req.query.status != null ? Number(req.query.status) : null
    return await q(`SELECT k.id, k.user_id, k.real_name, k.id_no_mask, k.status, k.reject_note, k.created_at,
      k.reviewed_at, u.nickname FROM kyc_application k JOIN user_account u ON u.id = k.user_id
      ${status != null ? 'WHERE k.status = ' + status : ''} ORDER BY k.id DESC LIMIT 200`)
  },
  'POST /admin/kyc/:id/resolve': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { action, note } = req.body // pass / reject
    const st = action === 'pass' ? 1 : 2
    const n = await q('UPDATE kyc_application SET status = ?, reject_note = ?, reviewed_by = ?, reviewed_at = NOW(3) WHERE id = ? AND status = 0',
      [st, action === 'reject' ? String(note || '').slice(0, 120) : null, a.uid || 0, req.params.id])
    if (!n.affectedRows) throw new BizError(1004, '申请不存在或已处理')
    // 实名结论入存证：不存证件号（只存结论与主体），链上更是只有一个哈希
    const k = await one('SELECT user_id FROM kyc_application WHERE id = ?', [req.params.id])
    if (k) await attestDomain.attest('kyc', 'kyc-' + req.params.id, {
      userId: Number(k.user_id), result: action === 'pass' ? 'pass' : 'reject',
    })
    return { resolved: action }
  },

  // 共创人登记（资金商/商品商）
  'GET /admin/co-creators': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    return await q(`SELECT cc.*, p.title FROM co_creator cc JOIN tour_product p ON p.id = cc.product_id
      ORDER BY cc.id DESC LIMIT 200`)
  },
  'POST /admin/co-creators': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { productId, name, mobile, role, investAmount, sharePct } = req.body
    if (!productId || !name || !mobile || ![1, 2].includes(Number(role))) throw new BizError(1001, '产品/姓名/电话/角色必填')
    const pct = Number(sharePct) || 0
    if (pct < 0 || pct > 5000) throw new BizError(1001, '分润比例 0-50%（bp ≤ 5000）')
    const coNo = 'C' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 1000).padStart(3, '0')
    const id = await tx(async (c) => c.ins(`INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct)
      VALUES (?,?,?,?,?,?,?)`, [productId, coNo, name, mobile, Number(role), Number(investAmount) || 0, pct]))
    return { id, coNo }
  },
  'POST /admin/co-creators/:id/status': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { status } = req.body
    await q('UPDATE co_creator SET status = ? WHERE id = ?', [Number(status) ? 1 : 0, req.params.id])
    return { status: Number(status) ? 1 : 0 }
  },

  // ===== 共创分润打款闭环（T01）：运营/财务核对台账，财务或超管登记真实打款 =====
  // 唯一事实源是 co_profit_pay（每笔真实支付一行，流水号全局唯一）；co_profit.paid_amount/status 由有效流水重算。
  'GET /admin/co-profits': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    return await q(`SELECT cp.*, cc.co_no, cc.name, cc.status co_status, p.title, p.city_code,
        s.period settle_period,
        (SELECT COUNT(*) FROM co_profit_pay y WHERE y.co_profit_id = cp.id AND y.status = 0) pending_approvals
      FROM co_profit cp
      JOIN co_creator cc ON cc.id = cp.co_creator_id
      JOIN tour_product p ON p.id = cp.product_id
      LEFT JOIN settlement s ON s.id = cp.settlement_id
      ORDER BY cp.id DESC LIMIT 200`)
  },
  // 分润打款回单附件：存 static/receipts（/uploads 静态服务不覆盖该目录，URL 不对外）
  'POST /admin/co-profits/receipt-upload': async (req) => {
    await requireAdmin(req, 'coProfit.pay')
    const { data, ext = 'jpg' } = req.body || {}
    if (!['png', 'jpg', 'jpeg', 'webp', 'pdf'].includes(ext)) throw new BizError(1001, '回单仅支持 jpg/png/webp/pdf')
    const buf = Buffer.from(String(data || ''), 'base64')
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) throw new BizError(1001, '回单附件需在 5MB 内')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'receipts')
    fs.mkdirSync(dir, { recursive: true })
    const name = `receipt_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}.${ext === 'jpeg' ? 'jpg' : ext}`
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/receipts/' + name }
  },
  'POST /admin/co-profits/:id/pay': async (req) => {
    const a = await requireAdmin(req, 'coProfit.pay')
    const payRef = String(req.body.payRef || '').trim()
    const channel = ['bank', 'alipay', 'wechat', 'cash', 'other'].includes(req.body.channel) ? req.body.channel : 'bank'
    const payDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.payDate || '')) ? String(req.body.payDate) : bizDay()
    const receiptUrl = String(req.body.receiptUrl || '').trim() || null
    const note = String(req.body.note || '').trim().slice(0, 255) || null
    const amount = Number(req.body.amount)
    if (!/^[\w-]{6,64}$/.test(payRef)) throw new BizError(1001, '请填写真实支付流水号（6–64 位字母、数字、- 或 _），以银行/渠道回单为准')
    if (!Number.isInteger(amount) || amount <= 0) throw new BizError(1001, '实付金额需为大于 0 的整数（分）')
    if (receiptUrl && !/^\/receipts\/[\w.-]+$/.test(receiptUrl)) throw new BizError(1001, '回单附件需先上传（登记表单内选择文件）')
    return tx(async (c) => {
      const cp = await c.one(`SELECT cp.*, cc.status co_status, cc.name co_name FROM co_profit cp
        JOIN co_creator cc ON cc.id = cp.co_creator_id WHERE cp.id = ? FOR UPDATE`, [req.params.id])
      if (!cp) throw new BizError(1004, '分润单不存在')
      if (Number(cp.status) === 2) throw new BizError(2002, '该分润单已作废，不能登记打款')
      if (Number(cp.status) === 1) throw new BizError(2002, '该分润单已结清，请刷新后核对')
      // 合作方停用即暂停打款（对应"用户/合作方冻结"检查；停用恢复或走冲正/作废流程后才能继续）
      if (Number(cp.co_status) !== 1) throw new BizError(6001, `共创人「${cp.co_name}」合作已停用，暂停打款。请先恢复合作生效，或走冲正/作废流程`)
      const remaining = Number(cp.amount) - Number(cp.paid_amount)
      if (amount > remaining) throw new BizError(1001, `实付金额超过未付余额：应付 ${(Number(cp.amount) / 100).toFixed(2)} 元，已付 ${(Number(cp.paid_amount) / 100).toFixed(2)} 元，本次最多 ${(remaining / 100).toFixed(2)} 元，不可超付`)
      if (await c.one('SELECT id FROM co_profit_pay WHERE pay_ref = ?', [payRef])) throw new BizError(2002, '该支付流水号已登记过，请核对银行回单，不能重复登记')
      const threshold = await cfgNum('coprofit.pay_approve_min')
      const needsApprove = threshold > 0 && amount >= threshold
      const payId = await c.ins(`INSERT INTO co_profit_pay (co_profit_id, direction, pay_ref, channel, pay_date, amount, receipt_url, note, status, operator)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [cp.id, 1, payRef, channel, payDate, amount, receiptUrl, note, needsApprove ? 0 : 1, 'admin:' + a.name])
      if (needsApprove) {
        await audit(c, 'admin:' + a.name, 'co-profit', 'pay-submit', 'coprofit-' + cp.id, null, { payId, payRef, amount, channel, threshold })
        return { pending: true, payId, message: '已提交登记：达到审批阈值，等待超级管理员复核后生效' }
      }
      const { paid, settled } = await recalcCoProfitPay(c, cp.id, a.name)
      await audit(c, 'admin:' + a.name, 'co-profit', 'pay', 'coprofit-' + cp.id,
        { status: Number(cp.status), paidAmount: Number(cp.paid_amount) }, { payId, payRef, amount, channel, paid, settled })
      return { paid: true, payId, settled }
    })
  },
  // 超阈值登记的复核：提案人与审批人不能相同；通过前重验状态/冻结/余额/流水唯一
  'POST /admin/co-profits/pays/:payId/approve': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const pass = req.body.pass === true
    const note = String(req.body.note || '').trim().slice(0, 255) || null
    return tx(async (c) => {
      const y = await c.one('SELECT * FROM co_profit_pay WHERE id = ? FOR UPDATE', [req.params.payId])
      if (!y) throw new BizError(1004, '打款登记不存在')
      if (Number(y.status) !== 0) throw new BizError(2002, '该笔登记已处理，请刷新')
      if (y.operator === 'admin:' + a.name) throw new BizError(1003, '双人复核：复核人不能与登记人相同')
      if (!pass) {
        await c.upd('UPDATE co_profit_pay SET status = 2, approver = ?, approve_note = ? WHERE id = ?', ['admin:' + a.name, note, y.id])
        await audit(c, 'admin:' + a.name, 'co-profit', 'pay-reject', 'coprofit-' + y.co_profit_id, { payId: y.id, payRef: y.pay_ref }, { note })
        return { rejected: true }
      }
      const cp = await c.one(`SELECT cp.*, cc.status co_status FROM co_profit cp JOIN co_creator cc ON cc.id = cp.co_creator_id WHERE cp.id = ? FOR UPDATE`, [y.co_profit_id])
      if (!cp) throw new BizError(1004, '分润单不存在')
      if (Number(cp.status) !== 0) throw new BizError(2002, '分润单状态已变化（已结清或已作废），该登记不能生效，请驳回')
      if (Number(cp.co_status) !== 1) throw new BizError(6001, '共创人合作已停用，不能通过该打款登记')
      if (Number(cp.paid_amount) + Number(y.amount) > Number(cp.amount)) throw new BizError(2002, '分润单剩余额度不足以让该登记生效，请驳回后重新登记')
      if (await c.one('SELECT id FROM co_profit_pay WHERE pay_ref = ? AND id <> ?', [y.pay_ref, y.id])) throw new BizError(2002, '该支付流水号已被其他登记使用')
      await c.upd('UPDATE co_profit_pay SET status = 1, approver = ?, approve_note = ? WHERE id = ?', ['admin:' + a.name, note, y.id])
      const { paid, settled } = await recalcCoProfitPay(c, cp.id, a.name)
      await audit(c, 'admin:' + a.name, 'co-profit', 'pay-approve', 'coprofit-' + cp.id, { status: Number(cp.status), paidAmount: Number(cp.paid_amount) },
        { payId: y.id, payRef: y.pay_ref, amount: Number(y.amount), paid, settled, note })
      return { approved: true, settled }
    })
  },
  // 撤回：登记人可在复核前撤回自己的待复核登记（登记人不能自批/自驳，撤回是唯一出口）
  'POST /admin/co-profits/pays/:payId/withdraw': async (req) => {
    const a = await requireAdmin(req, 'coProfit.pay')
    return tx(async (c) => {
      const y = await c.one('SELECT * FROM co_profit_pay WHERE id = ? FOR UPDATE', [req.params.payId])
      if (!y) throw new BizError(1004, '打款登记不存在')
      if (y.operator !== 'admin:' + a.name) throw new BizError(1003, '只能撤回本人登记的记录')
      if (Number(y.status) !== 0) throw new BizError(2002, '仅待复核的登记可撤回')
      await c.upd('UPDATE co_profit_pay SET status = 4, approver = ?, approve_note = ? WHERE id = ?', ['admin:' + a.name, '登记人撤回', y.id])
      await audit(c, 'admin:' + a.name, 'co-profit', 'pay-withdraw', 'coprofit-' + y.co_profit_id, { payId: y.id, payRef: y.pay_ref, amount: Number(y.amount) }, { status: 4 })
      return { withdrawn: true }
    })
  },
  // 冲正：已生效打款登记错误时登记一笔负向流水，历史实付不改写；冲正后分润单回到待打款
  'POST /admin/co-profits/pays/:payId/reverse': async (req) => {
    const a = await requireAdmin(req, 'coProfit.pay')
    const payRef = String(req.body.payRef || '').trim()
    const note = String(req.body.note || '').trim().slice(0, 255) || null
    if (!/^[\w-]{6,64}$/.test(payRef)) throw new BizError(1001, '请填写冲正流水的真实支付流水号（6–64 位），以银行/渠道冲正回单为准')
    return tx(async (c) => {
      const y = await c.one('SELECT * FROM co_profit_pay WHERE id = ? FOR UPDATE', [req.params.payId])
      if (!y || Number(y.direction) !== 1 || Number(y.status) !== 1) throw new BizError(2002, '仅有效的打款登记可冲正')
      if (await c.one('SELECT id FROM co_profit_pay WHERE pay_ref = ?', [payRef])) throw new BizError(2002, '该冲正流水号已登记过')
      if (await c.one('SELECT id FROM co_profit_pay WHERE reversed_pay_id = ? AND status = 1', [y.id])) throw new BizError(2002, '该笔打款已被冲正，不能重复冲正')
      await c.ins(`INSERT INTO co_profit_pay (co_profit_id, direction, pay_ref, channel, amount, note, status, operator, reversed_pay_id)
        VALUES (?,?,?,?,-?,?,?,?,?)`,
        [y.co_profit_id, 2, payRef, y.channel, y.amount, note, 1, 'admin:' + a.name, y.id])
      const { paid, settled } = await recalcCoProfitPay(c, y.co_profit_id, a.name)
      await audit(c, 'admin:' + a.name, 'co-profit', 'pay-reverse', 'coprofit-' + y.co_profit_id,
        { payId: y.id, payRef: y.pay_ref, amount: Number(y.amount) }, { reverseRef: payRef, paid, settled, note })
      return { reversed: true, paid, settled }
    })
  },
  // 作废：未付的分润单整单作废（错单/重复生成）；已打款走冲正
  'POST /admin/co-profits/:id/void': async (req) => {
    const a = await requireAdmin(req, 'coProfit.void')
    const reason = String(req.body.reason || '').trim()
    if (reason.length < 4 || reason.length > 200) throw new BizError(1001, '请填写作废原因（4–200 字）')
    return tx(async (c) => {
      const cp = await c.one('SELECT * FROM co_profit WHERE id = ? FOR UPDATE', [req.params.id])
      if (!cp) throw new BizError(1004, '分润单不存在')
      if (Number(cp.status) !== 0) throw new BizError(2002, '仅待打款的分润单可作废；已打款请走冲正')
      if (Number(cp.paid_amount) > 0) throw new BizError(2002, '该分润单已有部分打款，不能作废，请走冲正')
      await c.upd('UPDATE co_profit SET status = 2 WHERE id = ?', [cp.id])
      await audit(c, 'admin:' + a.name, 'co-profit', 'void', 'coprofit-' + cp.id, { status: 0 }, { status: 2, reason })
      return { voided: true }
    })
  },
  // 打款历史（含待审批/驳回/冲正全轨迹）
  'GET /admin/co-profits/:id/pays': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    return await q(`SELECT id, direction, pay_ref, channel, pay_date, amount, receipt_url, note, status, operator, approver, approve_note, reversed_pay_id, created_at
      FROM co_profit_pay WHERE co_profit_id = ? ORDER BY id DESC`, [req.params.id])
  },
  // 回单附件受控下载（super/ops/finance；文件在 static/receipts，不进公开静态目录）
  'GET /admin/co-profits/pays/:payId/receipt': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const y = await one('SELECT receipt_url FROM co_profit_pay WHERE id = ?', [req.params.payId])
    if (!y || !y.receipt_url) throw new BizError(1004, '该笔登记没有回单附件')
    const name = String(y.receipt_url).replace('/receipts/', '')
    if (!/^[\w.-]+$/.test(name)) throw new BizError(1001, '回单地址无效')
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'receipts', name)
    if (!file.startsWith(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'receipts')) || !fs.existsSync(file)) throw new BizError(1004, '回单文件不存在')
    const ext = name.split('.').pop()
    const data = fs.readFileSync(file).toString('base64')
    return { name, contentType: ext === 'pdf' ? 'application/pdf' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext), data }
  },
}

const adminFin = {
  // T03/T10：提现审批服务端分页 + 状态筛选（旧数组契约同步为对象契约）
  'GET /admin/withdrawals': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = ['1=1'], args = [], filters = {}
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null && [0, 1, 2, 3].includes(status)) { conds.push('w.status = ?'); args.push(status); filters.status = status }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('u.nickname LIKE ?'); args.push('%' + kw + '%'); filters.kw = kw }
    const W = 'WHERE ' + conds.join(' AND ')
    const from = 'FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id'
    const total = Number((await one(`SELECT COUNT(*) n ${from} ${W}`, args)).n)
    const rows = await q(`SELECT w.*, u.nickname, u.status AS user_status ${from} ${W} ORDER BY w.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, filters }
  },

  // A-11：过期未核销订单的后台手动入口（定时任务每分钟自动跑；这里供运营/超管手动触发与核查）
  'POST /admin/orders/expire-vouchers': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const jobs = await import('../jobs.mjs')
    return { processed: await jobs.tickExpireVouchers() }
  },
}


export { adminSys, adminEco, adminEdit, adminNew, adminFin, fundWorkbenchAgg }

// ===== T11（批次 F-2）：统一资金工作台（只读聚合）=====
// 把商户结算、推广提现、创作奖励、共创分润汇成待办入口；保留各自账本语义，不做可改金额总表。
// 口径声明：登记已付 ≠ 外部确认到账（外部支付通道未接入，均为人工回单登记）。
const fundWorkbenchAgg = {
  'GET /admin/fund-workbench': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance', 'ops'])
    const N = (v) => Number(v || 0)
    // 商户结算：status 2=财务复核通过待支付；3=已登记回单；缺回单不可能（登记强制 ref），查重复流水
    const settlePending = await one(`SELECT COUNT(*) n, COALESCE(SUM(amt_fulfill + COALESCE(fee_merchant,0)),0) amt FROM settlement WHERE status = 2`)
    const settlePaid = await one(`SELECT COUNT(*) n FROM settlement WHERE status = 3`)
    const settleDupRef = N((await one(`SELECT COUNT(*) n FROM (SELECT payment_ref FROM settlement WHERE status = 3 AND payment_ref IS NOT NULL GROUP BY payment_ref HAVING COUNT(*) > 1) x`)).n)
    // 推广提现：0=待审；1=已打款；冻结账号挂起的待审单
    const wdPending = await one(`SELECT COUNT(*) n, COALESCE(SUM(w.amount),0) amt FROM promoter_withdraw w WHERE w.status IN (0,3)`)
    const wdFrozen = N((await one(`SELECT COUNT(*) n FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id WHERE w.status IN (0,3) AND u.status = 0`)).n)
    const wdDupRef = N((await one(`SELECT COUNT(*) n FROM (SELECT pay_ref FROM promoter_withdraw WHERE status = 1 AND pay_ref IS NOT NULL GROUP BY pay_ref HAVING COUNT(*) > 1) x`)).n)
    // 现金加奖（约稿投稿通过后的待打款）
    const cashPending = await one(`SELECT COUNT(*) n, COALESCE(SUM(cash_reward),0) amt FROM content_task_entry WHERE cash_status = 1`)
    const cashFrozen = N((await one(`SELECT COUNT(*) n FROM content_task_entry e JOIN user_account u ON u.id = e.user_id WHERE e.cash_status = 1 AND u.status = 0`)).n)
    // 共创分润：待付 = status 0 的未付余额；已结清 status 1
    const coPending = await one(`SELECT COUNT(*) n, COALESCE(SUM(amount - paid_amount),0) amt FROM co_profit WHERE status = 0`)
    const coSettled = N((await one(`SELECT COUNT(*) n FROM co_profit WHERE status = 1`)).n)
    const coPendingApprovals = N((await one(`SELECT COUNT(*) n FROM co_profit_pay WHERE status = 0`)).n)
    return {
      scopeCity: a.scopeCity || null,
      lines: [
        { key: 'settlements', label: '商户结算', goto: 'settlements', unit: '分',
          pending: { count: N(settlePending.n), amount: N(settlePending.amt) }, paidCount: N(settlePaid.n),
          issues: [settleDupRef ? `重复回单流水 ${settleDupRef} 组` : ''] },
        { key: 'withdrawals', label: '推广提现', goto: 'withdrawals', unit: '分',
          pending: { count: N(wdPending.n), amount: N(wdPending.amt) },
          issues: [wdFrozen ? `冻结账号挂起待审 ${wdFrozen} 笔（可驳回）` : '', wdDupRef ? `重复打款流水 ${wdDupRef} 组` : ''] },
        { key: 'taskcash', label: '现金加奖', goto: 'taskcash', unit: '分',
          pending: { count: N(cashPending.n), amount: N(cashPending.amt) },
          issues: [cashFrozen ? `冻结账号待打款 ${cashFrozen} 笔（暂停发放）` : ''] },
        { key: 'cocreate', label: '共创分润', goto: 'cocreate', unit: '分',
          pending: { count: N(coPending.n), amount: N(coPending.amt) }, paidCount: N(coSettled.n),
          issues: [coPendingApprovals ? `超阈值待复核登记 ${coPendingApprovals} 笔` : ''] },
      ].map((l) => ({ ...l, issues: l.issues.filter(Boolean) })),
      metricNote: '金额为"登记已付/待付"口径：均为人工回单登记，不等于外部渠道确认到账（外部支付/代付通道未接入）',
    }
  },
}
