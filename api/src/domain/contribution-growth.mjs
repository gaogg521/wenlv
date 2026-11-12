import { q, tx } from '../db.mjs'
import { cfg } from '../config.mjs'
import { levels, levelFor } from './member.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const DAY = 86400000
const monthStart = day => day.slice(0, 7) + '-01'
const nextMonth = day => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10)
const stamp = value => Date.parse(String(value || '').replace(' ', 'T') + '+08:00')
const json = value => typeof value === 'string' ? JSON.parse(value) : value
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max
const net = o => Math.max(0, Number(o.amount_pay) - Number(o.insurance_fee || 0) - Number(o.part || 0))
const eligible = o => o && Number(o.status) === 50 && !Number(o.cs_invalid) && !o.rebook_of && net(o) > 0 && o.paid_at && o.completed_at
const orderFields = `o.*,COALESCE(o.contribution_scenic_id,p.scenic_id,0) AS cs_scenic,
  (SELECT COALESCE(SUM(pr.cash_fen),0) FROM partial_refund pr WHERE pr.order_id=o.id AND pr.status=2) part,
  EXISTS(SELECT 1 FROM contribution_record cr WHERE cr.kind=1 AND cr.biz_ref=o.order_no AND cr.cheated=1) cs_invalid,
  EXISTS(SELECT 1 FROM refunds f WHERE f.order_id=o.id AND f.status IN (0,1)) pending_refund`
const orderFrom = ' FROM orders o JOIN tour_product p ON p.id=o.product_id'

const defaults = { monthCap: 10000, sScore: 500, sCap: 10, rScore: 300, rCap: 3, windowDays: 90 }

function basisPoints(value) {
  const raw = json(value)
  const bp = ['q', 's', 'r'].map(k => {
    const ratio = raw?.[k]
    const n = Math.round(ratio * 10000)
    if (typeof ratio !== 'number' || !integer(n, 0, 10000) || Math.abs(ratio * 10000 - n) > 1e-8) throw new Error('贡献权重需为有效基点')
    return n
  })
  if (bp.reduce((a,b) => a+b,0) !== 10000) throw new Error('贡献权重合计须为100%')
  return bp
}

function limits(value) {
  const raw = json(value)
  const result = {}
  for (const [key, max] of Object.entries({ monthCap: 100000, sScore: 10000, sCap: 100, rScore: 10000, rCap: 20, windowDays: 365 })) {
    if (!integer(raw?.[key], 1, max)) throw new Error(key + ' 超出有效范围 1–' + max)
    result[key] = raw[key]
  }
  return result
}

export function validateContributionConfig(key, value) {
  if (key === 'contribution.effective_at' && value !== '' &&
      (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ||
       !Number.isFinite(stamp(value)) || new Date(stamp(value) + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') !== value)) {
    throw new Error('生效时间应为北京时间 YYYY-MM-DD HH:mm:ss 或留空')
  }
  if (key === 'contribution.weights') basisPoints(value)
  if (key === 'contribution.sr_limits') limits(value)
  if (key === 'member.cs_multiplier' && (value === '' || !integer(Number(value), 0, 100))) throw new Error('贡献成长倍数须为0–100的整数')
}

async function policy() {
  const at = await cfg('contribution.effective_at')
  validateContributionConfig('contribution.effective_at', at)
  if (!at || Date.now() < stamp(at)) return null
  const bp = basisPoints(await cfg('contribution.weights'))
  const multiplier = Number(await cfg('member.cs_multiplier'))
  validateContributionConfig('member.cs_multiplier', multiplier)
  return { version: 1, effectiveAt: at, bp, multiplier, ...defaults, ...limits(await cfg('contribution.sr_limits')) }
}

export async function enqueueContribution(c, source, id) {
  let rules
  try { rules = await policy() } catch (error) {
    console.error('[contribution-config]', error.message)
    return false
  }
  if (!rules) return false
  await c.q(`INSERT IGNORE INTO contribution_job(source,source_id,event_day,rules,run_after) VALUES(?,?,?,?,NOW(3))`,
    [source, id, bizDay(), JSON.stringify(rules)])
  return true
}

export async function recheckOrderContribution(c, orderId) {
  await c.q(`UPDATE contribution_job SET run_after=NOW(3) WHERE source='order'
    AND (source_id=? OR source_id IN (SELECT source_id FROM contribution_record WHERE anchor_id=? AND kind=3))`, [orderId, orderId])
}

export async function recheckNoteContribution(c, noteId) {
  await c.q(`UPDATE contribution_job j JOIN content_task_entry e ON e.id=j.source_id
    SET j.run_after=NOW(3) WHERE j.source='entry' AND e.note_id=?`, [noteId])
}

function rounded(n, d) { return Math.floor((n + d / 2) / d) }

async function applyAward(c, { job, rules, user, levelConfig, kind, ref, raw, scenic = null, anchor = null, hold = false, reason = null }) {
  const old = await c.one('SELECT * FROM contribution_record WHERE kind=? AND biz_ref=? FOR UPDATE', [kind, ref])
  if (old && old.growth_state === 'legacy') return
  if (!old && raw === 0) return
  if (old && (Number(old.cheated) || old.growth_state === 'revoked')) {
    raw = 0
    reason = old.reason || reason || '贡献已失效'
  }
  const snap = old ? json(old.rule_snapshot) : rules
  const cs = rounded(raw * snap.bp[kind - 1], 10000)
  const theoretical = rounded(cs * snap.multiplier, 100)
  let granted = Number(old?.growth_granted || 0)
  let active = Number(old?.growth_active || 0)
  const firstCredit = !granted && (!old || old.growth_state === 'pending')
  let state
  if (!raw) {
    state = 'revoked'
    active = 0
  } else if (hold && firstCredit) {
    state = 'pending'
  } else if (firstCredit) {
    const used = await c.one(`SELECT COALESCE(SUM(growth_granted),0) n FROM contribution_record
      WHERE user_id=? AND event_day>=? AND event_day<?`, [user.id, monthStart(job.event_day), nextMonth(job.event_day)])
    granted = active = Math.max(0, Math.min(theoretical, snap.monthCap - Number(used.n)))
    state = active < theoretical ? 'limited' : 'credited'
  } else {
    active = Math.min(active, theoretical)
    state = active < theoretical ? 'limited' : 'credited'
  }
  const delta = active - Number(old?.growth_active || 0)
  const values = [raw / 100, cs / 100, state, granted, active, reason]
  if (old) {
    if (Number(old.score) !== raw / 100 || Number(old.cs) !== cs / 100 || old.growth_state !== state || delta !== 0) {
      await c.ins(`INSERT INTO audit_log(actor,module,action,biz_ref,before_val,after_val)
        VALUES ('system','user','contribution-reconcile',?,?,?)`, ['CS' + kind + '-' + ref,
        JSON.stringify({ score: old.score, cs: old.cs, state: old.growth_state, active: old.growth_active }),
        JSON.stringify({ score: raw / 100, cs: cs / 100, state, active, reason })])
    }
    await c.upd('UPDATE contribution_record SET score=?,cs=?,growth_state=?,growth_granted=?,growth_active=?,reason=? WHERE id=?', [...values, old.id])
  } else {
    await c.ins(`INSERT INTO contribution_record (user_id,kind,biz_ref,source_id,scenic_id,anchor_id,event_day,rule_snapshot,
      score,cs,growth_state,growth_granted,growth_active,reason,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))`,
    [user.id, kind, ref, job.source_id, scenic, anchor, job.event_day, JSON.stringify({ ...rules, originalScoreCent: raw }), ...values])
  }
  if (delta) {
    const after = Math.max(0, Number(user.growth_value) + delta)
    const actual = after - Number(user.growth_value)
    if (actual) {
      await c.upd('UPDATE user_account SET growth_value=?,member_level=? WHERE id=?', [after, levelFor(levelConfig, after), user.id])
      await c.ins('INSERT INTO user_growth_log(user_id,delta,biz_type,biz_ref,after_val) VALUES(?,?,?,?,?)',
        [user.id, actual, delta > 0 ? 2 : 3, 'CS' + kind + '-' + ref, after])
      user.growth_value = after
    }
  }
}

async function readOrder(c, id) {
  return c.one('SELECT ' + orderFields + orderFrom + ' WHERE o.id=?', [id])
}

async function retention(c, o, job, rules) {
  const scenic = Number(o.cs_scenic)
  const old = await c.one('SELECT anchor_id FROM contribution_record WHERE kind=3 AND biz_ref=?', [o.order_no])
  if (old) {
    const anchor = await readOrder(c, old.anchor_id)
    return { raw: eligible(o) && eligible(anchor) ? rules.rScore : 0, anchor: old.anchor_id, anchorPending: Boolean(Number(anchor?.pending_refund)) }
  }
  if (!eligible(o) || !scenic || Number(o.pending_refund)) return { raw: 0 }
  const window = await c.one('SELECT anchor_id FROM contribution_retention_window WHERE user_id=? AND scenic_id=? FOR UPDATE', [o.user_id, scenic])
  let anchor = window ? await readOrder(c, window.anchor_id) : null
  if (!window) {
    // 只有首次建立窗口时才用可核实的历史首单；后续以已锁定锚点为准。
    anchor = await c.one(`SELECT ${orderFields}${orderFrom}
      WHERE o.user_id=? AND o.status=50 AND o.rebook_of IS NULL AND COALESCE(o.contribution_scenic_id,p.scenic_id,0)=?
        AND NOT EXISTS(SELECT 1 FROM contribution_record bad WHERE bad.kind=1 AND bad.biz_ref=o.order_no AND bad.cheated=1)
        AND o.paid_at>=DATE_SUB(?,INTERVAL ? DAY) AND o.completed_at < ? AND o.paid_at < ?
        AND o.amount_pay-o.insurance_fee-COALESCE((SELECT SUM(pr.cash_fen) FROM partial_refund pr WHERE pr.order_id=o.id AND pr.status=2),0)>0
      ORDER BY o.paid_at,o.id LIMIT 1`, [o.user_id, scenic, o.paid_at, rules.windowDays, o.paid_at, o.paid_at])
  }
  const diff = anchor ? stamp(o.paid_at) - stamp(anchor.paid_at) : NaN
  if (anchor && Number(anchor.pending_refund)) return { raw: 0, anchorPending: true }
  if (!eligible(anchor) || diff > rules.windowDays * DAY) {
    await c.q(`INSERT INTO contribution_retention_window(user_id,scenic_id,anchor_id) VALUES(?,?,?)
      ON DUPLICATE KEY UPDATE anchor_id=VALUES(anchor_id)`, [o.user_id, scenic, o.id])
    return { raw: 0 }
  }
  if (!window) await c.ins('INSERT INTO contribution_retention_window(user_id,scenic_id,anchor_id) VALUES(?,?,?)', [o.user_id, scenic, anchor.id])
  if (diff < DAY || stamp(o.paid_at) <= stamp(anchor.completed_at)) return { raw: 0 }
  if (Number(anchor.pending_refund)) return { raw: 0, anchorPending: true }
  const paidDay = String(o.paid_at).slice(0, 10)
  const used = await c.one(`SELECT COUNT(*) n,COALESCE(SUM(DATE(o.paid_at)=?),0) same_day FROM contribution_record r JOIN orders o ON o.id=r.source_id
    WHERE r.kind=3 AND r.user_id=? AND r.scenic_id=? AND r.anchor_id=?`, [paidDay, o.user_id, scenic, anchor.id])
  if (Number(used.n) >= rules.rCap || Number(used.same_day)) return { raw: 0 }
  return { raw: rules.rScore, anchor: anchor.id }
}

export async function processContribution(source, id) {
  const levelConfig = await levels()
  const table = source === 'order' ? 'orders' : 'content_task_entry'
  const [owner] = await q('SELECT user_id FROM ' + table + ' WHERE id=?', [id])
  return tx(async c => {
    const job = await c.one('SELECT * FROM contribution_job WHERE source=? AND source_id=? AND run_after<=NOW(3) FOR UPDATE', [source, id])
    if (!job) return false
    const rules = json(job.rules)
    const user = owner ? await c.one('SELECT id,status,risk_flag,growth_value FROM user_account WHERE id=? FOR UPDATE', [owner.user_id]) : null
    const o = source === 'order' ? await readOrder(c, id) : null
    const e = source === 'entry' ? await c.one(`SELECT e.id,e.user_id,e.status,n.status note_status
      FROM content_task_entry e LEFT JOIN content_note n ON n.id=e.note_id WHERE e.id=?`, [id]) : null
    const hold = user && (Number(user.status) === 0 || Number(user.risk_flag) !== 0)
    let retry = false
    if (user && o) {
      if (Number(o.pending_refund)) retry = true
      else {
        const snap = json(o.promo_snapshot)
        const raw = eligible(o) && o.promo_scene && snap?.eligible ? net(o) : 0
        await applyAward(c, { job, rules, user, levelConfig, kind: 1, ref: o.order_no, raw, hold, reason: raw ? null : '订单已失效' })
        const r = await retention(c, o, job, rules)
        if (r.anchorPending) retry = true
        else await applyAward(c, { job, rules, user, levelConfig,
          kind: 3, ref: o.order_no, raw: r.raw, scenic: Number(o.cs_scenic), anchor: r.anchor, hold, reason: r.raw ? null : '首单或复购已失效' })
      }
    } else if (user && e) {
      const used = await c.one(`SELECT COUNT(*) n FROM contribution_record WHERE user_id=? AND kind=2 AND event_day>=? AND event_day<?
        AND biz_ref<>?`, [user.id, monthStart(job.event_day), nextMonth(job.event_day), 'ENTRY-' + id])
      const raw = Number(e.status) === 3 && Number(e.note_status) === 2 && Number(used.n) < rules.sCap ? rules.sScore : 0
      await applyAward(c, { job, rules, user, levelConfig, kind: 2, ref: 'ENTRY-' + id, raw, hold, reason: raw ? null : '采纳已撤销' })
    }
    const pending = hold && await c.one("SELECT id FROM contribution_record WHERE user_id=? AND source_id=? AND kind " +
      (source === 'order' ? 'IN (1,3)' : '=2') + " AND growth_state='pending' LIMIT 1", [user.id, id])
    await c.upd(`UPDATE contribution_job SET run_after=${retry || pending ? 'DATE_ADD(NOW(3),INTERVAL 60 SECOND)' : 'NULL'} WHERE source=? AND source_id=?`, [source, id])
    return true
  })
}

export async function tickContributionGrowth() {
  const rows = await q('SELECT source,source_id FROM contribution_job WHERE run_after<=NOW(3) ORDER BY run_after,source,source_id LIMIT 100')
  for (const row of rows) {
    try { await processContribution(row.source, row.source_id) }
    catch (error) { console.error('[job:contribution-growth]', row.source, row.source_id, error.message) }
  }
  return rows.length
}
