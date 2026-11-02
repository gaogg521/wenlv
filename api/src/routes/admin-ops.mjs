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

// ---------- /admin 系统工作区（SRE）与生态/财务审批 ----------
const adminSys = {
  // 小程序数据分析（官方 getDailyVisitTrend；未配置凭据=MOCK 曲线）
  'GET /admin/wxdata/visit-trend': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'city_partner'])
    return await wxapi.getDailyVisitTrend(7)
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
      ledger: tb, idempotencyKeys: idem, tables, migrations, secrets,
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
    const { closeTimeout } = await import('../domain/order.mjs')
    const { settleDue } = await import('../domain/promo.mjs')
    let n = -1
    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
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
  'GET /admin/content': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q('SELECT c.*, u.nickname, u.creator_tag FROM content_note c JOIN user_account u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 100')
  },

  // 评价管理（内容审核工作区）
  'GET /admin/reviews': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q(`SELECT r.*, u.nickname, p.title FROM review r
      JOIN user_account u ON u.id = r.user_id JOIN tour_product p ON p.id = r.product_id
      ORDER BY r.id DESC LIMIT 100`)
  },
  'POST /admin/reviews/:id/hide': async (req) => {
    const a = await requireAdmin(req, ['super', 'review'])
    const st = req.body.show ? 1 : 0
    await q('UPDATE review SET status = ? WHERE id = ?', [st, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'review', st ? 'show' : 'hide', 'review-' + req.params.id, null, null))
    return { status: st }
  },

  // 笔记审核材料：全文（清洗后）、图片、字数、机审结果、作者、被哪些约稿任务引用
  'GET /admin/content/:id': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    const n = await one('SELECT * FROM content_note WHERE id = ?', [req.params.id])
    if (!n) throw new BizError(1004, '笔记不存在')
    const author = await one(`SELECT u.id, u.nickname, u.creator_tag,
        (SELECT COUNT(*) FROM content_note x WHERE x.user_id = u.id AND x.status = 2) published,
        (SELECT COUNT(*) FROM content_note x WHERE x.user_id = u.id AND x.status = 3) rejected
      FROM user_account u WHERE u.id = ?`, [n.user_id])
    const product = n.related_product_id ? await one('SELECT id, title FROM tour_product WHERE id = ?', [n.related_product_id]) : null
    const tasks = await q('SELECT t.id, t.title, e.status FROM content_task_entry e JOIN content_task t ON t.id = e.task_id WHERE e.note_id = ?', [n.id])
    return { note: taskReview.noteView(n, (u) => apiImg(u, req)), author, product, tasks }
  },
  'POST /admin/content/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'review'])
    const passed = req.body.pass === true
    const reason = String(req.body.reason || '').trim()
    if (!passed && reason.length < 4) throw new BizError(1001, '请填写驳回原因（至少 4 个字），作者会在小程序里看到')
    if (reason.length > 300) throw new BizError(1001, '原因最多 300 字')
    const bad = findBanned(reason)
    if (bad) throw new BizError(1001, `原因会展示在小程序里，不能出现「${bad}」${SUGGEST[bad] ? '，可改为「' + SUGGEST[bad] + '」' : ''}`)
    const st = passed ? 2 : 3
    return tx(async (c) => {
      const n = await c.upd(`UPDATE content_note SET status = ?, reject_reason = ?, published_at = IF(? = 2, NOW(3), published_at)
        WHERE id = ? AND status IN (0,1)`, [st, passed ? null : reason, st, req.params.id])
      if (n !== 1) throw new BizError(2002, '该笔记已处理，请刷新')
      await audit(c, 'admin:' + a.name, 'content', passed ? 'approve' : 'reject', 'note-' + req.params.id, null, { status: st, reason: reason || null })
      return { status: st }
    })
  },
  'POST /admin/merchants/:id/approve': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    return tx(async cc => {
      const m = await cc.one('SELECT * FROM merchant WHERE id = ? AND status = 0 FOR UPDATE', [req.params.id])
      if (!m) throw new BizError(2002, '进件已处理或不存在')
      await cc.upd('UPDATE merchant SET status = 1, approved_at = NOW(3) WHERE id = ?', [m.id])
      if (m.applicant_user_id) await cc.q('INSERT INTO merchant_staff (merchant_id,user_id,role) VALUES (?,?,3) ON DUPLICATE KEY UPDATE role=3,status=1', [m.id, m.applicant_user_id])
      await audit(cc, 'admin:' + a.name, 'merchant', 'approve', 'merchant-' + m.id, { status: 0 }, { status: 1, owner: m.applicant_user_id })
      return { approved: true }
    })
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

// ---------- 后台编辑能力（V14 补齐：风控处理/商户编辑/预算停用/推广商调档） ----------
const adminEdit = {
  // 风控事件处理
  'POST /admin/risk/:id/handle': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'risk'])
    await q('UPDATE risk_event SET handled = 1, handled_by = ?, handled_at = NOW(3) WHERE id = ?', [a.uid || 0, req.params.id])
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
    const sc = scopeFilter(a)
    return await q(`SELECT s.*, (SELECT COUNT(*) FROM tour_product p WHERE p.scenic_id = s.id) product_count
      FROM scenic_spot s WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
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

  // 创作者池（UGC 运营）：按用户聚合内容产出；标签=资源状态（none/signed/star/limited）
  'GET /admin/creators': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q(`SELECT u.id, u.nickname, u.creator_tag, u.member_level, u.status,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id) note_count,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) published_count,
      (SELECT COUNT(*) FROM review r WHERE r.user_id = u.id) review_count,
      (SELECT COUNT(*) FROM content_task_entry t WHERE t.user_id = u.id AND t.status = 3) task_done,
      (SELECT MAX(c.published_at) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) last_published
      FROM user_account u
      WHERE u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id) OR EXISTS (SELECT 1 FROM review r WHERE r.user_id = u.id)
      ORDER BY published_count DESC, note_count DESC, u.id DESC LIMIT 200`)
  },
  'PUT /admin/creators/:id/tag': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
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
  'GET /admin/phrases': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT p.id, p.title, p.phrase_user, p.phrase_merchant, p.channel FROM tour_product p
      WHERE p.phrase_user IS NOT NULL ORDER BY p.id DESC`)
  },
  'POST /admin/phrases/:pid': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { userPhrase, merchantPhrase } = req.body
    await q('UPDATE tour_product SET phrase_user = ?, phrase_merchant = ? WHERE id = ?',
      [String(userPhrase || '').trim() || null, String(merchantPhrase || '').trim() || null, req.params.pid])
    return { saved: true }
  },

  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶
  'GET /admin/rate-overrides': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT p.id, p.title, p.promo_rate_bp, p.price_from,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_start')) rate_start, JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_end')) rate_end,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_reason')) rate_reason
      FROM tour_product p WHERE p.promo_rate_bp IS NOT NULL ORDER BY p.id DESC`)
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
    return { resolved: action }
  },

  // 共创人登记（资金商/商品商）
  'GET /admin/co-creators': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
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

  // 共创分润台账（结算期生成）
  'GET /admin/co-profits': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT cp.*, cc.co_no, cc.name, p.title FROM co_profit cp
      JOIN co_creator cc ON cc.id = cp.co_creator_id JOIN tour_product p ON p.id = cp.product_id
      ORDER BY cp.id DESC LIMIT 200`)
  },
  'POST /admin/co-profits/:id/pay': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    await q('UPDATE co_profit SET status = 1 WHERE id = ? AND status = 0', [req.params.id])
    return { paid: true }
  },
}

const adminFin = {
  'GET /admin/withdrawals': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    return await q('SELECT w.*, u.nickname, u.status AS user_status FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id ORDER BY w.id DESC LIMIT 100')
  },
  'POST /admin/withdrawals/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const { pass: passed, payRef } = req.body
    const w = await one('SELECT * FROM promoter_withdraw WHERE id = ? AND status = 0', [req.params.id])
    if (!w) throw new BizError(1004, '申请不存在或已处理')
    // 账号冻结期间暂停打款：可以驳回，不能通过；解冻后再审批
    if (passed && await promo.isUserFrozen(w.promoter_id)) throw new BizError(6001, '该推广员账号已冻结，暂停打款。请先解冻，或驳回本次申请')
    const st = passed ? 1 : 2
    const finalRef = passed ? String(payRef || '').trim() : null
    if (passed && (!finalRef || finalRef.length < 6 || finalRef.length > 64)) throw new BizError(1001, '请先完成实际支付，再填写真实打款流水号')
    await q('UPDATE promoter_withdraw SET status = ?, reviewed_by = ?, reviewed_at = NOW(3), pay_ref = ? WHERE id = ?',
      [st, 'admin:' + a.name, finalRef, w.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'withdraw', passed ? 'pay' : 'reject', 'wd-' + w.id, { status: 0 }, { status: st, amount: w.amount }))
    return { status: st }
  },
}

export { adminSys, adminEco, adminEdit, adminNew, adminFin }
