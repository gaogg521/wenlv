// T07（批次 F-3）：审核工作队列。四类待办（独立笔记 / 约稿投稿 / 举报 / 申诉）统一聚合视图 + 认领协调。
// 认领不改既有判定逻辑——判定仍走各队列原接口（content/verdict、task-entries/verdict、content-cases/verdict）；
// 认领只是"我在处理"的协调层：同一待办同时只允许一个有效认领（V52 唯一键兜底），判定完成后自动释放。
// V-04：取消对外"done"兜底清除——认领释放只发生在真实判定事务与本人主动释放，任何 staff 都不能
//       无判定地清掉他人仍待审的认领。
// V-05：认领前校验目标存在、仍在待审、（城市账号）属于本城；认领资格与各判定端点角色一致。
// V-07：待办总数独立计数，返回前 20 条只是"显示窗口"，页面不再把窗口当全部。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'

const KINDS = ['note', 'task_entry', 'report', 'appeal']
const KIND_CN = { note: '独立笔记审核', task_entry: '约稿投稿审核', report: '举报处理', appeal: '作者申诉' }
const LIST_WINDOW = 20
// 每类队列的"待审"来源 SQL（单条查询：返回 item_id, waiting_since, extra, city_code）
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
// 认领资格 = 对应判定端点的角色（能判定才能认领，不允许认领自己无权判定的待办）
const CLAIM_ROLES = {
  note: ['super', 'review'],
  task_entry: ['super', 'ops', 'review'],
  report: ['super', 'ops', 'review', 'city_partner'],
  appeal: ['super', 'ops', 'review', 'city_partner'],
}
const CLAIM_ROLE_CN = {
  note: '独立笔记审核仅限超级管理员/审核员认领',
  task_entry: '约稿投稿审核仅限超级管理员/运营/审核员认领',
  report: '举报处理仅限超级管理员/运营/审核员/城市合伙人（本城）认领',
  appeal: '申诉复核仅限超级管理员/运营/审核员/城市合伙人（本城）认领',
}
// 认领人身份比较：优先不可变 UID；存量行无 uid 时回退名字（真实登录令牌必带 uid）
const claimIsMine = (row, a) =>
  row.claimed_uid != null ? (a.uid != null && Number(row.claimed_uid) === Number(a.uid)) : row.claimed_by === 'admin:' + a.name

async function staffOf(req) {
  const a = await requireAdmin(req, ['super', 'ops', 'review', 'city_partner'])
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  return a
}

export const adminReviewQueue = {
  // 队列聚合：四类待办各返回前 20 条（含等待时长与认领状态），total 为独立计数
  'GET /admin/review-queue': async (req) => {
    const a = await staffOf(req)
    const citySql = a.scopeCity ? ' AND p.city_code = ?' : ''
    const cityArgs = a.scopeCity ? [a.scopeCity] : []
    const queues = []
    for (const kind of KINDS) {
      const sqlAll = PENDING_SQL[kind] + citySql
      const total = Number((await one(`SELECT COUNT(*) n FROM (${sqlAll}) t`, cityArgs)).n)
      const items = await q(sqlAll + ' ORDER BY waiting_since ASC LIMIT ?', cityArgs.length ? [...cityArgs, LIST_WINDOW] : [LIST_WINDOW])
      const claims = await q(`SELECT rc.item_id, rc.claimed_by, rc.claimed_uid, rc.created_at FROM review_claim rc WHERE rc.queue_kind = ? AND rc.released_at IS NULL`, [kind])
      const claimMap = Object.fromEntries(claims.map((c) => [Number(c.item_id), c]))
      queues.push({
        kind, kindCn: KIND_CN[kind],
        total,
        window: LIST_WINDOW,
        truncated: total > items.length,
        items: items.map((it) => ({
          ...it,
          claimedBy: claimMap[Number(it.item_id)]?.claimed_by || null,
          claimedUid: claimMap[Number(it.item_id)]?.claimed_uid ?? null,
          claimedAt: claimMap[Number(it.item_id)]?.created_at || null,
          waitingHours: Math.round((Date.now() - new Date(it.waiting_since).getTime()) / 3600000 * 10) / 10,
        })).map((it) => ({ ...it, overdue: it.waitingHours >= 48 })),
      })
    }
    return { queues }
  },

  // 认领：同一待办同时只允许一个有效认领（他人重复认领被拒；本人幂等）；判定完成后自动释放；释放后可重新认领
  'POST /admin/review-queue/:kind/:itemId/claim': async (req) => {
    const a = await staffOf(req)
    const { kind, itemId } = req.params
    if (!KINDS.includes(kind)) throw new BizError(1001, '队列类型无效')
    // V-05：认领资格与判定端点角色一致——无判定权的角色不能占坑
    if (!CLAIM_ROLES[kind].includes(a.role)) throw new BizError(1003, CLAIM_ROLE_CN[kind] + '；不能认领自己无权判定的待办')
    // V-05：目标必须真实存在、仍在待审；城市账号只能认领本城待办
    const target = await one(`SELECT * FROM (${PENDING_SQL[kind]}) t WHERE t.item_id = ?`, [itemId])
    if (!target) throw new BizError(1004, '待办不存在或已不在待审状态，请刷新队列')
    if (a.scopeCity && String(target.city_code || '') !== String(a.scopeCity)) throw new BizError(1003, '仅可认领本城待办')
    return tx(async (c) => {
      const existing = await c.one('SELECT id, claimed_by, claimed_uid, released_at FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL FOR UPDATE', [kind, itemId])
      if (existing) {
        if (claimIsMine(existing, a)) return { claimed: true, already: true, claimedBy: existing.claimed_by }
        throw new BizError(2002, `该待办已被 ${existing.claimed_by} 认领，请处理其他待办或等待释放`)
      }
      // 复活本人已释放行（优先按 uid；夹具令牌无 uid 按名字），避免 UNIQUE 冲突；名字快照不改写
      const revived = a.uid != null
        ? await c.q('UPDATE review_claim SET released_at = NULL, created_at = NOW(3) WHERE queue_kind = ? AND item_id = ? AND claimed_uid = ? AND released_at IS NOT NULL', [kind, itemId, a.uid])
        : await c.q('UPDATE review_claim SET released_at = NULL, created_at = NOW(3) WHERE queue_kind = ? AND item_id = ? AND claimed_by = ? AND released_at IS NOT NULL', [kind, itemId, 'admin:' + a.name])
      if (!revived.affectedRows) {
        try {
          await c.q('INSERT INTO review_claim (queue_kind, item_id, claimed_by, claimed_uid) VALUES (?,?,?,?)', [kind, itemId, 'admin:' + a.name, a.uid ?? null])
        } catch (e) {
          if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) throw new BizError(2002, '该待办刚被他人认领，请刷新队列')
          throw e
        }
      }
      return { claimed: true, claimedBy: 'admin:' + a.name }
    })
  },

  // 释放（手动放弃）：只能释放本人的认领（V-04：不存在"任一 staff 清除他人认领"的入口）
  'POST /admin/review-queue/:kind/:itemId/release': async (req) => {
    const a = await staffOf(req)
    const { kind, itemId } = req.params
    if (!KINDS.includes(kind)) throw new BizError(1001, '队列类型无效')
    const n = await q('UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL AND (claimed_uid = ? OR (claimed_uid IS NULL AND claimed_by = ?))',
      [kind, itemId, a.uid ?? -1, 'admin:' + a.name])
    return { released: n.affectedRows > 0 }
  },

  // ===== R-03：批量审批（先逐笔预检列异常，再逐笔执行给逐笔结果；并发判定事务防重复发奖）=====
  // 支持两类"相同可核验条件"的批量：note 全部通过 / report 全部不成立。task_entry 与 appeal 不进批量
  // （约稿要逐条确认审核标准、申诉要看材料），不做"一键过所有作品"。
  'POST /admin/review-queue/batch-verdict': async (req) => {
    const a = await staffOf(req)
    const { kind, itemIds, action, reason } = req.body || {}
    if (!['note', 'report'].includes(kind)) throw new BizError(1001, '批量审批仅支持独立笔记（通过）与举报（不成立）')
    const wantPass = kind === 'note'
    if (action !== (wantPass ? 'pass' : 'dismiss')) throw new BizError(1001, wantPass ? '笔记批量只支持通过' : '举报批量只支持不成立')
    if (!wantPass && String(reason || '').trim().length < 4) throw new BizError(1001, '请填写 4–300 字的统一处理意见')
    const ids = Array.isArray(itemIds) ? [...new Set(itemIds.map(Number).filter(Number.isSafeInteger))] : []
    if (!ids.length || ids.length > 50) throw new BizError(1001, '请选择 1–50 条待办')
    // 与单笔判定端点同角色：note 通过=super/review（note.review）；report 不成立=staff()（含本城城市账号）
    if (kind === 'note' && !['super', 'review'].includes(a.role)) throw new BizError(1003, '笔记批量通过仅限超级管理员/审核员')
    if (kind === 'report' && a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    // 逐笔预检（只读）：状态、城市，列异常清单
    const precheck = []
    for (const id of ids) {
      try {
        const row = await one(`SELECT * FROM (${PENDING_SQL[kind]}) t WHERE t.item_id = ?`, [id])
        if (!row) throw new BizError(2002, '已不在待审状态')
        if (a.scopeCity && String(row.city_code || '') !== String(a.scopeCity)) throw new BizError(1003, '非本城待办')
        precheck.push({ id, ok: true })
      } catch (e) { precheck.push({ id, ok: false, reason: e.message }) }
    }
    const eligible = precheck.filter((p) => p.ok).map((p) => p.id)
    // 逐笔执行：复用各判定端点同一事务语义（笔记通过/举报不成立），逐笔给结果
    const results = []
    for (const id of eligible) {
      try {
        if (kind === 'note') {
          await tx(async (c) => {
            const n = await c.upd(`UPDATE content_note SET status = 2, reject_reason = NULL, published_at = NOW(3) WHERE id = ? AND status IN (0,1)`, [id])
            if (n !== 1) throw new BizError(2002, '该笔记已处理，请刷新')
            await audit(c, 'admin:' + a.name, 'content', 'approve', 'note-' + id, null, { status: 2, batch: true })
            await c.q("UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'note' AND item_id = ? AND released_at IS NULL", [id])
            const cityRow = await c.one('SELECT p.city_code city FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id WHERE n.id=?', [id])
            const attestDomain = await import('../domain/attest.mjs')
            await attestDomain.attest('content_review', 'note-' + id, { noteId: id, result: 'pass', cityCode: cityRow?.city || null, batch: true }, c)
          })
          results.push({ id, ok: true })
        } else {
          await tx(async (c) => {
            const n = await c.upd("UPDATE content_report SET status = 1, resolution = ?, actor = ?, resolved_at = NOW(3) WHERE id = ? AND status = 0", [String(reason).trim(), 'admin:' + a.name, id])
            if (n !== 1) throw new BizError(2002, '该举报已处理，请刷新')
            await audit(c, 'admin:' + a.name, 'content', 'report-dismiss', 'report-' + id, null, { reason: String(reason).trim(), batch: true })
            await c.q("UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'report' AND item_id = ? AND released_at IS NULL", [id])
          })
          results.push({ id, ok: true })
        }
      } catch (e) { results.push({ id, ok: false, reason: e.message }) }
    }
    return {
      total: ids.length,
      precheckFailed: precheck.filter((p) => !p.ok).map((p) => ({ id: p.id, reason: p.reason })),
      ok: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      results,
    }
  },
}
