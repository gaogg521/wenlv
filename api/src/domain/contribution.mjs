// 贡献分（CS）确认域（朱家角示范闭环 · 步骤4 贡献确认）。
// 口径（[业务落地](docs/按景区算账与示范闭环-业务落地-20261111.md)约束"避免直接赋值或触发资金"；
// 负责人 2026-11-12 指示全量完成——S/R 按已交规则方案实施并接通 CS→成长值，全部可配置、留审计）：
//   Q=成交维度：订单完成 + 归因有效（promo_snapshot.eligible），score=适用商品现金（元），cs=score×w_q。
//   S=内容质量：约稿任务采纳（content_task_review verdict=1 → 投稿人），score=contribution.s_adoption，cs=score×w_s。
//     （游客好评的创作者归属在数据模型中不存在，不实现；见规则方案"前置确认点②"单列说明）
//   R=留存：完成单记 1 分、窗口内复购单记 contribution.r_rebuy 分（90 天窗，contribution.r_window_days），cs=score×w_r。
//   幂等：uk(kind, biz_ref)；全部不触发资金动作（旅豆/佣金/分润仍走各自既有路径）。
//   CS→成长值：每次确认落库成功即 member.addGrowth(user, cs×member.cs_multiplier, bizRef, bizType=2)，
//     与 Q/S/R 同一 biz_ref 幂等（重复确认不重复加成长值）。
import { q, one } from '../db.mjs'
import { cfg } from '../config.mjs'
import { settledPartialFen } from './package.mjs'
import * as member from './member.mjs'

export async function weights() {
  const raw = await cfg('contribution.weights')
  const w = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
  const clamp = v => Math.max(0, Math.min(1, Number(v) || 0))
  return { q: clamp(w.q), s: clamp(w.s), r: clamp(w.r) }
}

/** CS→成长值（member.cs_multiplier，默认10）：贡献确认落库成功后调用；bizRef 与分录一致防重复 */
async function growthFor(userId, cs, bizRef) {
  const mult = Math.max(0, Number(await cfg('member.cs_multiplier')) || 0)
  const delta = Math.round(Number(cs) * mult)
  if (!(delta > 0)) return 0
  const done = await one('SELECT id FROM user_growth_log WHERE user_id = ? AND biz_type = 2 AND biz_ref = ? LIMIT 1', [userId, bizRef])
  if (done) return 0
  await member.addGrowth(userId, delta, bizRef, 2)
  return delta
}

/** Q 成交贡献确认：订单完成（50）时点调用；仅归因有效单记录。 */
export async function recordQ(o) {
  if (!o || Number(o.status) !== 50 || o.rebook_of) return { recorded: false }
  const snap = o.promo_snapshot ? (typeof o.promo_snapshot === 'string' ? JSON.parse(o.promo_snapshot) : o.promo_snapshot) : null
  if (!o.promo_scene || !snap || !snap.eligible) return { recorded: false }
  const w = await weights()
  const goodsCash = Math.max(0, Number(o.amount_pay) - Number(o.insurance_fee || 0) - await settledPartialFen(o.id)) // 与返豆/佣金同一基数（修复3 口径）
  if (!(goodsCash > 0)) return { recorded: false }
  const score = Math.round(goodsCash) / 100 // 元，2位小数
  const cs = Math.round(score * w.q * 100) / 100
  const dup = await one('SELECT id FROM contribution_record WHERE kind = 1 AND biz_ref = ?', [o.order_no])
  if (dup) return { recorded: false, score, cs }
  await q('INSERT INTO contribution_record(user_id, kind, biz_ref, score, cs, verified_at) VALUES (?,1,?,?,?,NOW(3))', [o.user_id, o.order_no, score, cs])
  const growth = await growthFor(o.user_id, cs, o.order_no)
  return { recorded: true, score, cs, growth }
}

/** S 内容质量贡献：约稿任务采纳（审核通过）时调用；bizRef=ENTRY-投稿ID 幂等。 */
export async function recordS(userId, entryId) {
  const bizRef = 'ENTRY-' + entryId
  const dup = await one('SELECT id FROM contribution_record WHERE kind = 2 AND biz_ref = ?', [bizRef])
  if (dup) return { recorded: false }
  const w = await weights()
  const adoption = Math.max(0, Math.round(Number(await cfg('contribution.s_adoption')) || 0))
  if (!(adoption > 0)) return { recorded: false }
  const score = adoption
  const cs = Math.round(score * w.s * 100) / 100
  await q('INSERT INTO contribution_record(user_id, kind, biz_ref, score, cs, verified_at) VALUES (?,2,?,?,?,NOW(3))', [userId, bizRef, score, cs])
  const growth = await growthFor(userId, cs, bizRef)
  return { recorded: true, score, cs, growth }
}

/** R 留存贡献：订单完成时点调用；窗口内复购单记 r_rebuy 分，否则 1 分。bizRef=单号 幂等。 */
export async function recordR(o) {
  if (!o || Number(o.status) !== 50 || o.rebook_of) return { recorded: false }
  const dup = await one('SELECT id FROM contribution_record WHERE kind = 3 AND biz_ref = ?', [o.order_no])
  if (dup) return { recorded: false }
  const w = await weights()
  const rebuy = Math.max(0, Math.round(Number(await cfg('contribution.r_rebuy')) || 0))
  const windowDays = Math.max(0, Math.round(Number(await cfg('contribution.r_window_days')) || 0))
  if (!(rebuy > 0)) return { recorded: false }
  const anchor = o.paid_at || o.completed_at
  const prior = anchor
    ? await one(`SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status = 50 AND id <> ? AND rebook_of IS NULL
        AND paid_at IS NOT NULL AND paid_at < ? AND paid_at >= DATE_SUB(?, INTERVAL ? DAY)`, [o.user_id, o.id, anchor, anchor, windowDays]).catch(() => ({ n: 0 }))
    : { n: 0 }
  const score = Number(prior.n) > 0 ? rebuy : 1
  const cs = Math.round(score * w.r * 100) / 100
  await q('INSERT INTO contribution_record(user_id, kind, biz_ref, score, cs, verified_at) VALUES (?,3,?,?,?,NOW(3))', [o.user_id, o.order_no, score, cs])
  // R 的成长值 biz_ref 加前缀：与同单 Q（biz_ref=单号）区分，同单两类贡献的成长值都不少
  const growth = await growthFor(o.user_id, cs, 'R-' + o.order_no)
  return { recorded: true, score, cs, growth }
}

/** 贡献汇总（示范闭环步骤4）：给定用户的已确认明细（Q/S/R）与权重。只读、不触发资金。 */
export async function summary(userId, pg = {}) {
  const limit = Math.min(Math.max(Number(pg.pageSize) || 20, 1), 100)
  const offset = (Math.max(Number(pg.page) || 1, 1) - 1) * limit
  const rows = await q('SELECT kind, biz_ref, score, cs, cheated, verified_at, created_at FROM contribution_record WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, limit, offset])
  const total = Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE user_id = ?', [userId])).n)
  const csSum = Number((await one('SELECT COALESCE(SUM(cs),0) s FROM contribution_record WHERE user_id = ? AND cheated = 0', [userId])).s)
  const w = await weights()
  return {
    rows, total, csConfirmed: csSum, weights: w,
    basis: { q: '完成订单×归因有效（score=适用商品现金元）', s: `约稿任务采纳（score=contribution.s_adoption）`, r: `完成单1分/窗口复购单 contribution.r_rebuy 分（contribution.r_window_days 天窗）` },
  }
}
