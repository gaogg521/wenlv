// 主体资源审批与运营权限路由(方案§4/§6)。
// 主体端(PC 主体方):工作台/草稿/提交/撤回/进度;审批端(超管+获授权运营):列表/详情/预审/批准/退回;
// 权限配置(仅超管):主体资源权限 grant + 按员工动作授权;站内收件箱;商户端快照与申请进度。
import { q, one, count, tx as tx2, BizError } from '../db.mjs'
import { requireUser } from '../auth.mjs'
import { requireAdmin, requireAction, audit, scopeFilter } from './_shared.mjs'
import * as approval from '../domain/subject-approval.mjs'
import { resolveSubjectPerms, permVersion, bumpPermVersion, serializePerms } from '../domain/subject-perms.mjs'
import { effectiveActionsFor, invalidateActionCache, ADMIN_ACTIONS } from '../domain/admin-capabilities.mjs'
import { FIELD_GROUPS } from '../domain/subject-fields.mjs'
import { actorFromAdmin, actorFromStaff } from '../domain/subject-approval.mjs'

const routes = {
  // ==================== PC 主体工作台 ====================
  'GET /admin/subject-workbench': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = actorFromAdmin(a)
    const perms = await resolveSubjectPerms({ subjectType: actor.subjectType, subjectId: actor.subjectId, channel: 'pc', accountId: actor.uid })
    const sub = actor.subjectType === 'merchant'
      ? await one('SELECT id, name, city_code, status FROM merchant WHERE id = ?', [actor.subjectId])
      : await one('SELECT id, name, city_code, status, selfrun_merchant_id FROM scenic_spot WHERE id = ?', [actor.subjectId])
    if (!sub) throw new BizError(1004, '绑定的主体不存在,请联系平台管理员')
    // 资源列表:正式状态 + 申请状态(如「在售 · 价格变更待审」)
    const products = actor.subjectType === 'merchant'
      ? await q(`SELECT p.id, p.title, p.cat, p.status, p.price_from, p.updated_version
        FROM tour_product p WHERE p.merchant_id = ? ORDER BY p.id DESC LIMIT 100`, [actor.subjectId])
      : []
    const pendByResource = await q(`SELECT kind, resource_id, req_no, field_diffs FROM subject_resource_request
      WHERE status = 1 AND subject_type = ? AND subject_id = ? AND parent_id IS NULL`, [actor.subjectType, actor.subjectId])
    const pendLabel = (kind, rid) => {
      const r = pendByResource.find((x) => x.kind === kind && Number(x.resource_id) === Number(rid))
      if (!r) return null
      const diffs = typeof r.field_diffs === 'string' ? JSON.parse(r.field_diffs || '[]') : []
      return { reqNo: r.req_no, label: diffs.slice(0, 2).map((d) => d.label).join('、') + '待审' }
    }
    for (const p of products) {
      const l = pendLabel('product', p.id)
      p.pending = l
      p.statusText = (['草稿', '在售', '已下架'][p.status] || '未知') + (l ? ' · ' + l.label : '')
    }
    const mine = await approval.listRequests({ ...actor, uid: a.uid, channel: 'pc', name: a.display_name }, { view: 'mine' })
    const statusCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const r of mine.items) statusCount[r.status] = (statusCount[r.status] || 0) + 1
    const unread = await one('SELECT COUNT(*) c FROM platform_inbox WHERE recipient_type = ? AND recipient_uid = ? AND read_at IS NULL', ['admin', a.uid])
    return {
      identity: { subjectType: actor.subjectType, subjectId: actor.subjectId, name: sub.name, city: sub.city_code, status: sub.status },
      perms: serializePerms(perms.perms), permVersion: perms.version,
      unread: Number(unread?.c || 0),
      entries: {
        productCreate: !!perms.perms.product?.create?.allowed,
        productEdit: !!perms.perms.product?.update?.allowed,
        sessionEdit: !!perms.perms.session?.update?.allowed,
        stockEdit: !!perms.perms.stock?.update?.allowed,
        profileEdit: !!(actor.subjectType === 'merchant' ? perms.perms.merchant?.update?.allowed : perms.perms.scenic?.update?.allowed),
      },
      resources: { products },
      requests: { count: statusCount, recent: mine.items.slice(0, 20) },
    }
  },

  // ==================== 申请列表与详情(主体 + 审批人共用,按角色过滤) ====================
  'GET /admin/subject-requests': async (req) => {
    const a = await requireAdmin(req)
    const viewer = a.role === 'merchant_partner' || a.role === 'scenic_partner'
      ? { ...actorFromAdmin(a), channel: 'pc' }
      : { type: 'admin', uid: a.uid, role: a.role, channel: 'pc', subjectType: null, subjectId: null, name: a.display_name }
    if (viewer.type === 'admin' && !['super', 'ops', 'merchant_partner', 'scenic_partner'].includes(a.role)) {
      throw new BizError(1003, '无申请列表权限')
    }
    const city = a.scopeCity ? scopeFilter(a, 'city_code') : null
    const result = await approval.listRequests(viewer, req.query)
    if (city?.sql) result.items = result.items.filter((r) => !r.city_code || String(r.city_code) === String(a.scopeCity))
    return result
  },

  'GET /admin/subject-requests/:id': async (req) => {
    const a = await requireAdmin(req)
    const viewer = a.role === 'merchant_partner' || a.role === 'scenic_partner'
      ? { ...actorFromAdmin(a), channel: 'pc' }
      : { type: 'admin', uid: a.uid, role: a.role, channel: 'pc', subjectType: null, subjectId: null, name: a.display_name }
    return approval.detailRequest(viewer, req.params.id)
  },

  // 新建草稿(可带 submit:true 直接提交,幂等键防重放)
  'POST /admin/subject-requests': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = { ...actorFromAdmin(a), channel: 'pc' }
    const b = req.body || {}
    const draft = await approval.saveDraft(actor, {
      kind: b.kind, action: b.action, resourceId: b.resourceId != null ? Number(b.resourceId) : null,
      payload: b.payload, note: b.note, attachments: b.attachments, impactNote: b.impactNote,
      parentId: b.parentId != null ? Number(b.parentId) : null, baselineVersion: b.expectedVersion != null ? Number(b.expectedVersion) : null,
      id: b.id != null ? Number(b.id) : null,
    })
    if (b.submit) {
      const sub = await approval.submitRequest(actor, draft.id, { idemKey: b.idemKey || null })
      return { ...draft, ...sub }
    }
    return draft
  },

  'PUT /admin/subject-requests/:id': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = { ...actorFromAdmin(a), channel: 'pc' }
    const b = req.body || {}
    return approval.saveDraft(actor, {
      id: Number(req.params.id), kind: b.kind, action: b.action,
      resourceId: b.resourceId != null ? Number(b.resourceId) : null,
      payload: b.payload, note: b.note, attachments: b.attachments, impactNote: b.impactNote,
      parentId: b.parentId != null ? Number(b.parentId) : null,
      baselineVersion: b.expectedVersion != null ? Number(b.expectedVersion) : null,
    })
  },

  'POST /admin/subject-requests/:id/submit': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = { ...actorFromAdmin(a), channel: 'pc' }
    return approval.submitRequest(actor, Number(req.params.id), { idemKey: (req.body || {}).idemKey || null })
  },

  'POST /admin/subject-requests/:id/withdraw': async (req) => {
    const a = await requireAdmin(req)
    const actor = a.role === 'merchant_partner' || a.role === 'scenic_partner'
      ? { ...actorFromAdmin(a), channel: 'pc' }
      : null
    if (!actor) throw new BizError(1003, '仅提交人可撤回')
    return approval.withdrawRequest(actor, Number(req.params.id))
  },

  'POST /admin/subject-requests/:id/resubmit': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = { ...actorFromAdmin(a), channel: 'pc' }
    return approval.resubmitAsNew(actor, Number(req.params.id))
  },

  'DELETE /admin/subject-requests/:id': async (req) => {
    const a = await requireAdmin(req, ['merchant_partner', 'scenic_partner'])
    const actor = { ...actorFromAdmin(a), channel: 'pc' }
    return approval.deleteDraft(actor, Number(req.params.id))
  },

  // ==================== 审批端 ====================
  'POST /admin/subject-requests/:id/preaudit': async (req) => {
    const a = await requireAction(req, 'subject.preaudit')
    return approval.addPreaudit({ uid: a.uid, name: a.name || a.display_name }, Number(req.params.id), (req.body || {}).note)
  },

  'POST /admin/subject-requests/:id/approve': async (req) => {
    const a = await requireAction(req, 'subject.approve')
    const b = req.body || {}
    return approval.approveRequest({ uid: a.uid, name: a.name || a.display_name }, Number(req.params.id),
      { confirm: b.confirm || {}, note: b.note })
  },

  'POST /admin/subject-requests/:id/reject': async (req) => {
    const a = await requireAction(req, 'subject.approve')
    return approval.rejectRequest({ uid: a.uid, name: a.name || a.display_name }, Number(req.params.id), (req.body || {}).reason)
  },

  // ==================== 权限配置(仅超管;最新下发的权限为准) ====================
  'GET /admin/subject-perms': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { subjectType, subjectId } = req.query
    const where = []
    const args = []
    if (subjectType) { where.push('subject_type = ?'); args.push(subjectType) }
    if (subjectId) { where.push('(subject_id = ? OR subject_id IS NULL)'); args.push(Number(subjectId)) }
    const rows = await q(`SELECT * FROM subject_perm_grant ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, args)
    const actions = await q('SELECT a.id, a.uid, a.action, a.effect, a.reason, a.granted_by_name, a.granted_at, u.username, u.display_name, u.role FROM admin_user_action a JOIN admin_user u ON u.id = a.uid ORDER BY a.id DESC LIMIT 300')
    return { grants: rows, actions, fieldGroups: FIELD_GROUPS, permVersion: await permVersion(),
      actionCatalog: Object.fromEntries(Object.entries(ADMIN_ACTIONS).map(([k, v]) => [k, v.label])) }
  },

  'POST /admin/subject-perms': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const b = req.body || {}
    if (!['merchant', 'scenic'].includes(b.subjectType)) throw new BizError(1001, '主体类型无效')
    if (!b.resKind) throw new BizError(1001, '请指定资源类型')
    if (!String(b.reason || '').trim()) throw new BizError(1001, '请填写授权原因')
    const grant = await tx2(async (c) => {
      const id = await c.ins(`INSERT INTO subject_perm_grant
        (subject_type, subject_id, staff_role, account_uid, channel, res_kind, action, field_group, effect, reason, granted_by, granted_by_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.subjectType, b.subjectId != null && b.subjectId !== '' ? Number(b.subjectId) : null,
          b.staffRole != null && b.staffRole !== '' ? Number(b.staffRole) : null,
          b.accountUid != null && b.accountUid !== '' ? Number(b.accountUid) : null,
          b.channel || 'all', b.resKind, b.action || '*', b.fieldGroup || null, Number(b.effect) === 0 ? 0 : 1,
          String(b.reason).slice(0, 200), a.uid, a.display_name])
      await bumpPermVersion(c, 'admin:' + a.display_name, b.accountUid != null && b.accountUid !== '' ? Number(b.accountUid) : null)
      await audit(c, 'admin:' + a.display_name, 'subject-perm', 'grant-' + id, null, { ...b })
      return { id }
    })
    invalidateActionCache(b.accountUid)
    return grant
  },

  'DELETE /admin/subject-perms/:id': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const row = await one('SELECT * FROM subject_perm_grant WHERE id = ?', [req.params.id])
    if (!row) throw new BizError(1004, '授权记录不存在')
    await tx2(async (c) => {
      await c.q('DELETE FROM subject_perm_grant WHERE id = ?', [req.params.id])
      await bumpPermVersion(c, 'admin:' + a.display_name, row.account_uid)
      await audit(c, 'admin:' + a.display_name, 'subject-perm', 'grant-del-' + req.params.id, { ...row }, null)
    })
    invalidateActionCache(row.account_uid)
    return { deleted: true }
  },

  // 按员工动作授权(授予/撤回 subject.approve 等)
  'GET /admin/accounts/:id/actions': async (req) => {
    await requireAdmin(req, ['super'])
    const rows = await q('SELECT * FROM admin_user_action WHERE uid = ? ORDER BY id DESC', [req.params.id])
    const u = await one('SELECT id, username, display_name, role, status, token_epoch FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    const eff = await effectiveActionsFor(u.id, u.role)
    return { account: u, rows, effective: [...eff], actionCatalog: Object.fromEntries(Object.entries(ADMIN_ACTIONS).map(([k, v]) => [k, v.label])) }
  },

  'POST /admin/accounts/:id/actions': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const b = req.body || {}
    if (!ADMIN_ACTIONS[b.action]) throw new BizError(1001, '未知动作:' + b.action)
    if (!String(b.reason || '').trim()) throw new BizError(1001, '请填写授权原因')
    const u = await one('SELECT id, role FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    await tx2(async (c) => {
      await c.q(`INSERT INTO admin_user_action (uid, action, effect, reason, granted_by, granted_by_name)
        VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE effect = VALUES(effect), reason = VALUES(reason),
        granted_by = VALUES(granted_by), granted_by_name = VALUES(granted_by_name), granted_at = NOW(3)`,
        [Number(req.params.id), b.action, Number(b.effect) === 0 ? 0 : 1, String(b.reason).slice(0, 200), a.uid, a.display_name])
      // 授权变更联动 token_epoch:被调整账号旧会话立即失效,按新权限重新登录
      await c.q('UPDATE admin_user SET token_epoch = token_epoch + 1 WHERE id = ?', [Number(req.params.id)])
      await audit(c, 'admin:' + a.display_name, 'account-action', 'uid-' + req.params.id, null, { action: b.action, effect: b.effect, reason: b.reason })
    })
    invalidateActionCache(Number(req.params.id))
    return { ok: true }
  },

  'DELETE /admin/accounts/:id/actions/:action': async (req) => {
    const a = await requireAdmin(req, ['super'])
    await tx2(async (c) => {
      await c.q('DELETE FROM admin_user_action WHERE uid = ? AND action = ?', [Number(req.params.id), req.params.action])
      await c.q('UPDATE admin_user SET token_epoch = token_epoch + 1 WHERE id = ?', [Number(req.params.id)])
      await audit(c, 'admin:' + a.display_name, 'account-action', 'uid-' + req.params.id, { action: req.params.action }, null)
    })
    invalidateActionCache(Number(req.params.id))
    return { ok: true }
  },

  // ==================== 站内收件箱 ====================
  'GET /admin/inbox': async (req) => {
    const a = await requireAdmin(req)
    const unreadOnly = req.query.unread === '1'
    const rows = await q(`SELECT id, kind, title, body, link, biz_ref, read_at, handled_at, created_at FROM platform_inbox
      WHERE recipient_type = 'admin' AND recipient_uid = ? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 100`, [a.uid])
    return { items: rows }
  },

  'GET /admin/inbox/summary': async (req) => {
    const a = await requireAdmin(req)
    const unread = await one('SELECT COUNT(*) c FROM platform_inbox WHERE recipient_type = ? AND recipient_uid = ? AND read_at IS NULL', ['admin', a.uid])
    const pending = await approval.approvalPendingCount()
    return { unread: Number(unread?.c || 0), pendingApprovals: pending, canApprove: (await effectiveActionsFor(a.uid, a.role)).has('subject.approve') }
  },

  'POST /admin/inbox/:id/read': async (req) => {
    const a = await requireAdmin(req)
    await q(`UPDATE platform_inbox SET read_at = NOW(3) WHERE id = ? AND recipient_type = 'admin' AND recipient_uid = ? AND read_at IS NULL`, [req.params.id, a.uid])
    return { ok: true }
  },

  'POST /admin/inbox/read-all': async (req) => {
    const a = await requireAdmin(req)
    await q(`UPDATE platform_inbox SET read_at = NOW(3) WHERE recipient_type = 'admin' AND recipient_uid = ? AND read_at IS NULL`, [a.uid])
    return { ok: true }
  },

  // ==================== 商户小程序端 ====================
  'GET /m/perm/snapshot': async (req) => {
    const u = requireUser(req)
    const perms = await resolveSubjectPerms({ subjectType: 'merchant', subjectId: u.merchantId, channel: 'mini', staffRole: u.role })
    return { version: perms.version, role: u.role, merchantId: u.merchantId, perms: serializePerms(perms.perms) }
  },

  'GET /m/subject-requests': async (req) => {
    const u = requireUser(req)
    const paging = { size: Math.min(Number(req.query.pageSize) || 20, 50), offset: ((Math.max(Number(req.query.page) || 1, 1)) - 1) * Math.min(Number(req.query.pageSize) || 20, 50) }
    const st = req.query.status != null && req.query.status !== '' ? Number(req.query.status) : null
    const rows = await q(`SELECT id, req_no, kind, action, resource_id, status, field_diffs, note, impact_note, review_note,
      submitted_at, reviewed_at, effective_at, created_at FROM subject_resource_request
      WHERE subject_type = 'merchant' AND subject_id = ? AND channel = 'mini' AND submitted_by = ?
      ${st != null ? 'AND status = ' + st : ''} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [u.merchantId, u.uid, paging.size, paging.offset])
    const total = await count(`SELECT COUNT(*) c FROM subject_resource_request WHERE subject_type='merchant' AND subject_id = ? AND channel = 'mini' AND submitted_by = ? ${st != null ? 'AND status = ' + st : ''}`, [u.merchantId, u.uid])
    return { items: rows.map(approval.decorate), total, page: Math.floor(paging.offset / paging.size) + 1, pageSize: paging.size }
  },

  'GET /m/subject-requests/:id': async (req) => {
    const u = requireUser(req)
    const viewer = { type: 'staff', uid: u.uid, role: u.role, subjectType: 'merchant', subjectId: Number(u.merchantId), channel: 'mini' }
    return approval.detailRequest(viewer, req.params.id)
  },

  'POST /m/subject-requests/:id/withdraw': async (req) => {
    const u = requireUser(req)
    const actor = await actorFromStaff(u)
    return approval.withdrawRequest(actor, Number(req.params.id))
  },
}

export { routes }
