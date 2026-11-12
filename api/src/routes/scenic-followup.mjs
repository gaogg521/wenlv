import { BizError, one, q, tx } from '../db.mjs'
import { audit, requireAdmin, scopeFilter, subjectScope } from './_shared.mjs'

const path = '/admin/scenics/:id/followups'
const roles = ['super', 'ops', 'finance', 'city_partner', 'merchant_partner', 'scenic_partner']
const staff = ['super', 'ops', 'finance']
const kinds = ['renewal', 'purchase', 'budget']

function id(value) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new BizError(1001, '编号无效')
  return n
}

function description(value, label, min = 4, max = 500) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length < min || s.length > max) throw new BizError(1001, label + '应为 ' + min + '–' + max + ' 个字')
  return s
}

async function access(req, write = false) {
  const actor = await requireAdmin(req, roles)
  if (!actor.uid || (actor.role === 'city_partner' && !actor.scopeCity)) throw new BizError(1003, '需要具名且已授权的账号')
  const scope = scopeFilter(actor)
  const scenic = await one('SELECT id,name,city_code,status FROM scenic_spot WHERE id=?' + scope.sql, [id(req.params.id), ...scope.params])
  if (!scenic) throw new BizError(1004, '景区不存在或不在授权范围')
  if (write && Number(scenic.status) !== 1) throw new BizError(1003, '仅合作中的景区可办理')
  const subject = subjectScope(actor)
  if (actor.role === 'scenic_partner' && Number(subject.scenicId) !== Number(scenic.id)) throw new BizError(1004, '景区不在授权范围')
  if (actor.role === 'merchant_partner') {
    if (!subject.merchantId || !await one(`SELECT m.id FROM merchant m JOIN tour_product p ON p.merchant_id=m.id
      WHERE m.id=? AND m.status=1 AND m.city_code=? AND p.scenic_id=? LIMIT 1`, [subject.merchantId, scenic.city_code, scenic.id])) {
      throw new BizError(1004, '商户未关联此景区')
    }
  }
  return { actor, scenic, subject }
}

function ownerScope({ actor, subject }) {
  if (staff.includes(actor.role)) return { sql: '', args: [] }
  const merchant = actor.role === 'merchant_partner'
  return {
    sql: ' AND f.applicant_id=? AND f.applicant_role=?' + (merchant ? " AND JSON_UNQUOTE(JSON_EXTRACT(r.snapshot,'$.merchant.id'))=?" : ''),
    args: [actor.uid, actor.role, ...(merchant ? [String(subject.merchantId)] : [])],
  }
}

function actions(actor, row) {
  return {
    canDecide: row.status === 'submitted' && ['super', 'finance'].includes(actor.role) && Number(row.applicant_id) !== Number(actor.uid),
    canRecord: row.status === 'approved' && staff.includes(actor.role),
  }
}

const select = `SELECT f.id,f.review_id,f.kind,f.status,f.amount_fen,f.purpose,f.decision_note,f.decided_at,
  f.record_ref,f.record_note,f.recorded_at,f.created_at,f.applicant_id
  FROM scenic_followup f JOIN scenic_review r ON r.id=f.review_id`

export const scenicFollowupRoutes = {
  ['GET ' + path]: async req => {
    const ctx = await access(req)
    const scoped = ownerScope(ctx)
    const rows = await q(select + ' WHERE f.scenic_id=?' + scoped.sql + ' ORDER BY f.id DESC LIMIT 100', [ctx.scenic.id, ...scoped.args])
    const merchant = ctx.actor.role === 'merchant_partner'
    const reviewFilter = merchant ? " AND JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.merchant.id'))=?" : ''
    const reviews = await q('SELECT id,created_at FROM scenic_review WHERE scenic_id=? AND admin_id=? AND admin_role=?' + reviewFilter + ' ORDER BY id DESC LIMIT 50',
      [ctx.scenic.id, ctx.actor.uid, ctx.actor.role, ...(merchant ? [String(ctx.subject.merchantId)] : [])])
    return { scenic: ctx.scenic, reviews, rows: rows.map(({ applicant_id, ...row }) => ({ ...row, ...actions(ctx.actor, { ...row, applicant_id }) })) }
  },
  ['POST ' + path]: async req => {
    const { actor, scenic, subject } = await access(req, true)
    const body = req.body
    const reviewId = id(body.reviewId)
    const kind = body.kind
    if (!kinds.includes(kind)) throw new BizError(1001, '请选择有效申请类型')
    const purpose = description(body.purpose, '办理依据')
    const amount = body.amountFen == null ? null : body.amountFen
    if ((kind !== 'renewal' || amount != null) && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000)) throw new BizError(1001, '请填写有效的申请金额')
    return tx(async c => {
      const review = await c.one('SELECT id,snapshot FROM scenic_review WHERE id=? AND scenic_id=? AND admin_id=? AND admin_role=? FOR UPDATE',
        [reviewId, scenic.id, actor.uid, actor.role])
      if (!review) throw new BizError(1004, '只能使用本人在当前景区保存的复盘')
      const snapshot = typeof review.snapshot === 'string' ? JSON.parse(review.snapshot) : review.snapshot
      if (actor.role === 'merchant_partner' && Number(snapshot.merchant?.id) !== Number(subject.merchantId)) throw new BizError(1004, '复盘不在本店范围')
      const prior = await c.one('SELECT id FROM scenic_followup WHERE review_id=? AND kind=?', [reviewId, kind])
      if (prior) throw new BizError(1001, '此复盘已有同类申请，请查看记录或保存新复盘后申请')
      const newId = await c.ins('INSERT INTO scenic_followup(review_id,scenic_id,applicant_id,applicant_role,kind,amount_fen,purpose) VALUES(?,?,?,?,?,?,?)',
        [reviewId, scenic.id, actor.uid, actor.role, kind, amount, purpose])
      await audit(c, actor.name, 'scenics', 'followup-submit', String(newId), null, { reviewId, kind, amount })
      return { id: Number(newId), status: 'submitted' }
    })
  },
  ['POST ' + path + '/:requestId/action']: async req => {
    const { actor, scenic } = await access(req, true)
    if (!staff.includes(actor.role)) throw new BizError(1003, '当前角色不能审批或登记办理结果')
    const requestId = id(req.params.requestId)
    const { action } = req.body
    if (!['approve', 'reject', 'record'].includes(action)) throw new BizError(1001, '无效操作')
    const note = description(req.body.note, '操作说明')
    const ref = action === 'record' ? description(req.body.reference, '合同、采购或预算单据编号', 3, 128) : null
    return tx(async c => {
      const row = await c.one('SELECT id,status,applicant_id FROM scenic_followup WHERE id=? AND scenic_id=? FOR UPDATE', [requestId, scenic.id])
      if (!row) throw new BizError(1004, '申请不存在或不在授权范围')
      const allowed = actions(actor, row)
      const next = { approve: 'approved', reject: 'rejected', record: 'recorded' }[action]
      if (action === 'record') {
        if (!allowed.canRecord) throw new BizError(1003, '只有已批准的申请可登记办理结果')
        await c.upd('UPDATE scenic_followup SET status=?,record_ref=?,record_note=?,recorded_by=?,recorded_at=NOW(3) WHERE id=?',
          [next, ref, note, actor.uid, row.id])
      } else {
        if (!allowed.canDecide) throw new BizError(1003, '需由非申请人的财务或超管审批待审申请')
        await c.upd('UPDATE scenic_followup SET status=?,decision_note=?,decided_by=?,decided_at=NOW(3) WHERE id=?',
          [next, note, actor.uid, row.id])
      }
      await audit(c, actor.name, 'scenics', 'followup-' + action, String(row.id), { status: row.status }, { status: next, note, ref })
      return { id: Number(row.id), status: next }
    })
  },
}
