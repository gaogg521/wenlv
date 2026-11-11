// 贡献分（CS）确认域（朱家角示范闭环 · 步骤4 贡献确认）。
// 口径（按[业务落地](docs/按景区算账与示范闭环-业务落地-20261111.md)约束"避免直接赋值或触发资金"）：
//   Q=成交维度：唯一已确认计分依据——订单完成 + 归因有效（promo_snapshot.eligible 且归因命中），
//     score=适用商品现金（元），cs=score×w_q（权重走参数中心 contribution.weights，可配置）。
//     落库幂等（uk_kind_ref），不触发任何资金动作；退款关单不记（完成时点已保证）。
//   S=内容质量、R=留存：尚无已确认计分规则——本域不赋值、不落库，状态显示"待确认"。
//     方案与算例见 docs/朱家角示范闭环-贡献确认规则方案-20261111.md。
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
  const rows = await q('SELECT kind, biz_ref, score, cs, cheated, verified_at, created_at FROM contribution_record WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, limit, offset])
  const total = Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE user_id = ?', [userId])).n)
  const csSum = Number((await one('SELECT COALESCE(SUM(cs),0) s FROM contribution_record WHERE user_id = ? AND cheated = 0', [userId])).s)
  const w = await weights()
  return {
    rows, total, csConfirmed: csSum, weights: w,
    pending: { s: '待确认（内容质量尚无已确认计分规则）', r: '待确认（留存尚无已确认计分规则）' },
  }
}
