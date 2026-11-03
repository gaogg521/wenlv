// T07（批次 F-3）：审核工作队列。四类待办（独立笔记 / 约稿投稿 / 举报 / 申诉）统一聚合视图 + 认领协调。
// 认领不改既有判定逻辑——判定仍走各队列原接口（content/verdict、task-entries/verdict、content-cases/verdict）；
// 认领只是"我在处理"的协调层：同一待办同时只允许一个有效认领，判定完成后自动释放。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin } from './_shared.mjs'

const KINDS = ['note', 'task_entry', 'report', 'appeal']
const KIND_CN = { note: '独立笔记审核', task_entry: '约稿投稿审核', report: '举报处理', appeal: '作者申诉' }
// 每类队列的"待审"来源 SQL（单条查询：返回 item_id, waiting_since, extra）
const PENDING_SQL = {
  note: `SELECT n.id item_id, n.created_at waiting_since, u.nickname extra, p.city_code
    FROM content_note n JOIN user_account u ON u.id = n.user_id LEFT JOIN tour_product p ON p.id = n.related_product_id
    WHERE n.status IN (0, 1)`,
  task_entry: `SELECT e.id item_id, e.submitted_at waiting_since, u.nickname extra, p.city_code
    FROM content_task_entry e JOIN content_task t ON t.id = e.task_id JOIN user_account u ON u.id = e.user_id
    LEFT JOIN tour_product p ON p.id = t.product_id
    WHERE e.status = 2`,
  report: `SELECT r.id item_id, r.created_at waiting_since, r.reason extra, p.city_code
    FROM content_report r JOIN content_note n ON n.id = r.note_id LEFT JOIN tour_product p ON p.id = n.related_product_id
    WHERE r.status = 0`,
  appeal: `SELECT ap.id item_id, ap.created_at waiting_since, ap.reason extra, p.city_code
    FROM content_appeal ap JOIN content_moderation m ON m.id = ap.moderation_id
    JOIN content_note n ON n.id = m.note_id LEFT JOIN tour_product p ON p.id = n.related_product_id
    WHERE ap.status = 0`,
}
// 各队列判定完成的释放条件（verdict 后自动释放）
const DONE_SQL = {
  note: `UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'note' AND item_id = ? AND released_at IS NULL`,
  task_entry: `UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'task_entry' AND item_id = ? AND released_at IS NULL`,
  report: `UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'report' AND item_id = ? AND released_at IS NULL`,
  appeal: `UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'appeal' AND item_id = ? AND released_at IS NULL`,
}

async function staffOf(req) {
  const a = await requireAdmin(req, ['super', 'ops', 'review', 'city_partner'])
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  return a
}

export const adminReviewQueue = {
  // 队列聚合：四类待办各取前 N 条（含等待时长），加各队列认领状态
  'GET /admin/review-queue': async (req) => {
    const a = await staffOf(req)
    const cs = a.scopeCity ? ' AND p.city_code = ?' : ''
    const args0 = a.scopeCity ? [a.scopeCity] : []
    const queues = []
    for (const kind of KINDS) {
      const sql = PENDING_SQL[kind] + (a.scopeCity ? ' AND p.city_code = ?' : '') + ' ORDER BY waiting_since ASC LIMIT 20'
      const args = a.scopeCity ? [...args0] : []
      const items = await q(sql, args)
      const claims = await q(`SELECT rc.item_id, rc.claimed_by, rc.created_at FROM review_claim rc WHERE rc.queue_kind = ? AND rc.released_at IS NULL`, [kind])
      const claimMap = Object.fromEntries(claims.map((c) => [Number(c.item_id), c]))
      queues.push({
        kind, kindCn: KIND_CN[kind],
        total: items.length,
        items: items.map((it) => ({
          ...it,
          claimedBy: claimMap[Number(it.item_id)]?.claimed_by || null,
          claimedAt: claimMap[Number(it.item_id)]?.created_at || null,
          waitingHours: Math.round((Date.now() - new Date(it.waiting_since).getTime()) / 3600000 * 10) / 10,
        })).map((it) => ({ ...it, overdue: it.waitingHours >= 48 })),
      })
    }
    return { queues }
  },

  // 认领：同一待办同时只允许一个有效认领（不同人重复认领被拒）；判定完成后自动释放；释放后可重新认领（upsert）
  'POST /admin/review-queue/:kind/:itemId/claim': async (req) => {
    const a = await staffOf(req)
    const { kind, itemId } = req.params
    if (!KINDS.includes(kind)) throw new BizError(1001, '队列类型无效')
    return tx(async (c) => {
      const existing = await c.one('SELECT id, claimed_by, released_at FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL FOR UPDATE', [kind, itemId])
      if (existing) {
        if (existing.claimed_by === 'admin:' + a.name) return { claimed: true, already: true, claimedBy: existing.claimed_by }
        throw new BizError(2002, `该待办已被 ${existing.claimed_by} 认领，请处理其他待办或等待释放`)
      }
      // upsert：同(队列,待办,人)的历史已释放行直接复活（released_at=NULL），避免 UNIQUE 冲突
      await c.q(`INSERT INTO review_claim (queue_kind, item_id, claimed_by) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE released_at = NULL, created_at = NOW(3)`, [kind, itemId, 'admin:' + a.name])
      return { claimed: true, claimedBy: 'admin:' + a.name }
    })
  },

  // 释放（手动放弃）
  'POST /admin/review-queue/:kind/:itemId/release': async (req) => {
    const a = await staffOf(req)
    const { kind, itemId } = req.params
    if (!KINDS.includes(kind)) throw new BizError(1001, '队列类型无效')
    const n = await q('UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = ? AND item_id = ? AND claimed_by = ? AND released_at IS NULL',
      [kind, itemId, 'admin:' + a.name])
    return { released: n.affectedRows > 0 }
  },

  // 判定完成后自动释放（由 content/verdict 等判定接口在事务内调用；此处提供独立释放入口兜底）
  'POST /admin/review-queue/:kind/:itemId/done': async (req) => {
    await staffOf(req)
    const { kind, itemId } = req.params
    if (!KINDS.includes(kind) || !DONE_SQL[kind]) throw new BizError(1001, '队列类型无效')
    await q(DONE_SQL[kind], [itemId])
    return { released: true }
  },
}
