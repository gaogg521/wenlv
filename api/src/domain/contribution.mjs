// 贡献确认与本人汇总。启用前的 Q 仅作历史记录。
import { q, one } from '../db.mjs'
import { cfg } from '../config.mjs'
import { settledPartialFen } from './package.mjs'

export async function weights() {
  const raw = await cfg('contribution.weights')
  const w = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
  const clamp = v => Math.max(0, Math.min(1, Number(v) || 0))
  return { q: clamp(w.q), s: clamp(w.s), r: clamp(w.r) }
}

/** Q 成交贡献确认：订单完成（50）时点调用；仅归因有效单记录。
 *  幂等：uk(kind=1, biz_ref=order_no) 重复完成/重复回调只记一次。返回 {recorded, score, cs}。 */
export async function recordQ(o) {
  if (!o || Number(o.status) !== 50 || o.rebook_of) return { recorded: false }
  const queued = await one("SELECT source_id FROM contribution_job WHERE source='order' AND source_id=?", [o.id])
  if (queued) {
    const processed = await (await import('./contribution-growth.mjs')).processContribution('order', o.id)
    const award = await one('SELECT score,cs FROM contribution_record WHERE kind=1 AND biz_ref=?', [o.order_no])
    return { recorded: Boolean(processed && award), ...(award || {}) }
  }
  // 归因有效：建单快照 eligible（自购不计佣的快照 eligible=false 同样不计贡献）
  const snap = o.promo_snapshot ? (typeof o.promo_snapshot === 'string' ? JSON.parse(o.promo_snapshot) : o.promo_snapshot) : null
  if (!o.promo_scene || !snap || !snap.eligible) return { recorded: false }
  const w = await weights()
  const goodsCash = Math.max(0, Number(o.amount_pay) - Number(o.insurance_fee || 0) - await settledPartialFen(o.id)) // 与返豆/佣金同一基数（修复3 口径）
  if (!(goodsCash > 0)) return { recorded: false }
  const score = Math.round(goodsCash) / 100 // 元，2位小数
  const cs = Math.round(score * w.q * 100) / 100
  const dup = await one('SELECT id FROM contribution_record WHERE kind = 1 AND biz_ref = ?', [o.order_no])
  if (dup) return { recorded: false, score, cs }
  await q('INSERT INTO contribution_record(user_id, kind, biz_ref, score, cs) VALUES (?,1,?,?,?)', [o.user_id, o.order_no, score, cs])
  return { recorded: true, score, cs }
}

/** 贡献汇总（示范闭环步骤4）：给定用户的已确认 Q 明细 + S/R 待确认说明。只读、不触发资金。 */
export async function summary(userId, pg = {}) {
  const limit = Math.min(Math.max(Number(pg.pageSize) || 20, 1), 100)
  const offset = (Math.max(Number(pg.page) || 1, 1) - 1) * limit
  const rows = await q(`SELECT id,kind,biz_ref,score,cs,cheated,verified_at,created_at,growth_state,growth_active,reason,
    JSON_EXTRACT(rule_snapshot,'$.version') rule_version FROM contribution_record WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, [userId, limit, offset])
  const total = Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE user_id = ?', [userId])).n)
  const csSum = Number((await one('SELECT COALESCE(SUM(cs),0) s FROM contribution_record WHERE user_id = ? AND cheated = 0', [userId])).s)
  const w = await weights()
  const at = await cfg('contribution.effective_at')
  const enabled = Boolean(at && Date.now() >= Date.parse(at.replace(' ', 'T') + '+08:00'))
  return {
    enabled, rows, total, csConfirmed: csSum, weights: w,
    pending: enabled ? { s: '采纳后计分', r: '同景区合格复购后计分' } : { s: '待启用', r: '待启用' },
    growthUnit: '100 库内单位 = 1 成长点',
  }
}
