// 勋章发放：人工授予与规则自动发放共用一个入口，统一校验发行上限、幂等与存证。
// 自动规则（后台勋章编辑器「获得规则」）：
//   order_count  完成订单数 ≥ 阈值（订单状态 50 已完成）
//   city_count   打卡城市数 ≥ 阈值（已核销或已完成订单的不同城市）
//   review       发表评价数 ≥ 阈值
//   note_count   已发布的旅行笔记数 ≥ 阈值
//   level        会员等级 ≥ 阈值（等级见 member.mjs）
// 触发点：订单完成（jobs.completeOrder / 后台调试完成）、游客写评价；后台可对某个勋章"按规则补发"存量用户。
import { q, one, BizError } from '../db.mjs'
import { attest } from './attest.mjs'

export const AUTO_RULES = ['order_count', 'city_count', 'review', 'note_count', 'level']
const prof = (b) => ((typeof b.profile === 'string' ? JSON.parse(b.profile || '{}') : b.profile) || {})

/** 用户在各自动规则上的当前数值 */
export async function metrics(userId) {
  const o = await one('SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status = 50', [userId])
  const c = await one('SELECT COUNT(DISTINCT city_code) n FROM orders WHERE user_id = ? AND status IN (40, 50)', [userId])
  const r = await one('SELECT COUNT(*) n FROM review WHERE user_id = ?', [userId])
  const n = await one('SELECT COUNT(*) n FROM content_note WHERE user_id = ? AND status = 2', [userId])
  const l = await one('SELECT member_level FROM user_account WHERE id = ?', [userId])
  return { order_count: Number(o.n), city_count: Number(c.n), review: Number(r.n), note_count: Number(n.n), level: Number(l?.member_level || 1) }
}

/** 某枚勋章对该用户的达成进度（人工授予类返回 null） */
export function progressOf(badge, m) {
  if (!AUTO_RULES.includes(badge.rule_type)) return null
  const need = Number(prof(badge).threshold) || 0
  if (need <= 0) return null
  const cur = Math.min(Number(m[badge.rule_type] || 0), need)
  return { cur, need, pct: Math.floor(cur / need * 100) }
}

/**
 * 发放一枚勋章（幂等：同一用户同一勋章只发一次）
 * @returns {granted:boolean, reason?:string}
 */
export async function grant(userId, badge, { by = 'system', reason = null, strict = false } = {}) {
  if (await one('SELECT 1 x FROM user_badge WHERE user_id = ? AND badge_id = ?', [Number(userId), badge.id])) return { granted: false, reason: 'owned' }
  const max = Number(prof(badge).max_issue) || 0
  if (max > 0) {
    const n = await one('SELECT COUNT(*) n FROM user_badge WHERE badge_id = ?', [badge.id])
    if (Number(n.n) >= max) {
      if (strict) throw new BizError(1001, `「${badge.name}」已达发行上限 ${max} 枚`)
      return { granted: false, reason: 'max_issue' }
    }
  }
  const r = await q('INSERT IGNORE INTO user_badge (user_id, badge_id, ref) VALUES (?,?,?)', [Number(userId), badge.id, String(by).slice(0, 48)])
  if (!r.affectedRows) return { granted: false, reason: 'owned' }
  // 发放入存证队列（同一用户同一勋章只锚一次）
  await attest('badge', 'badge-' + userId + '-' + badge.id, {
    userId: Number(userId), badgeId: Number(badge.id), badge: badge.name, by, reason: reason || null,
  }, null, 1)
  return { granted: true }
}

/** 按自动规则检查某用户，达到阈值的未获得勋章即发放；返回本次新发的勋章名 */
export async function evaluate(userId) {
  const defs = await q(`SELECT * FROM badge WHERE rule_type IN (${AUTO_RULES.map(() => '?').join(',')})`, AUTO_RULES)
  if (!defs.length) return []
  const owned = new Set((await q('SELECT badge_id FROM user_badge WHERE user_id = ?', [userId])).map((r) => Number(r.badge_id)))
  const m = await metrics(userId)
  const out = []
  for (const b of defs) {
    if (owned.has(Number(b.id))) continue
    const th = Number(prof(b).threshold) || 0
    if (th <= 0 || m[b.rule_type] < th) continue
    const r = await grant(userId, b, { by: 'rule:' + b.rule_type, reason: `${b.rule_type} ${m[b.rule_type]} ≥ ${th}` })
    if (r.granted) out.push(b.name)
  }
  return out
}

/** 安全触发：勋章是附加奖励，任何异常都不能影响订单完成或评价提交 */
export async function evaluateSafe(userId) {
  try { return await evaluate(userId) } catch (e) { console.error('[badge:auto]', userId, e.message); return [] }
}

/** 后台"按规则补发"：对存量用户批量评估某个勋章 */
export async function backfill(badgeId) {
  const b = await one('SELECT * FROM badge WHERE id = ?', [badgeId])
  if (!b) throw new BizError(1004, '勋章不存在')
  if (!AUTO_RULES.includes(b.rule_type)) throw new BizError(1001, '人工授予类勋章没有可补发的规则')
  const th = Number(prof(b).threshold) || 0
  if (th <= 0) throw new BizError(1001, '请先在勋章编辑器里设置「达成阈值」')
  const SQL = {
    order_count: `SELECT user_id, COUNT(*) n FROM orders WHERE status = 50 GROUP BY user_id HAVING n >= ?`,
    city_count: `SELECT user_id, COUNT(DISTINCT city_code) n FROM orders WHERE status IN (40, 50) GROUP BY user_id HAVING n >= ?`,
    review: `SELECT user_id, COUNT(*) n FROM review GROUP BY user_id HAVING n >= ?`,
    note_count: `SELECT user_id, COUNT(*) n FROM content_note WHERE status = 2 GROUP BY user_id HAVING n >= ?`,
    level: `SELECT id AS user_id, member_level n FROM user_account WHERE member_level >= ?`,
  }
  const users = await q(SQL[b.rule_type], [th])
  let granted = 0, capped = 0
  for (const u of users) {
    const r = await grant(u.user_id, b, { by: 'backfill:' + b.rule_type })
    if (r.granted) granted++
    if (r.reason === 'max_issue') { capped++; break }
  }
  return { eligible: users.length, granted, capped: capped > 0 }
}
