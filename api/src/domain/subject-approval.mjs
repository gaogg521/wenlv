// 主体资源审批状态机与正式写服务(方案§4/§5)。
// 流程:保存草稿(0) → 提交审核(1) → 超管或获授权平台运营确认(4 已生效) | 退回(3,必填原因) | 撤回(2)。
// 一个有效批准即可生效;每笔提交通知全部启用超管与获授权运营(按收件人去重);
// 草稿与待审不写正式资源表;确认事务锁定申请与受影响记录,复验状态/权限/归属/版本/库存与履约约束后
// 经共享正式写服务(entity-schema.save)生效,审计与版本簿同事务写入;并发批准只生效一次。
import { q, one, tx, BizError } from '../db.mjs'
import * as entities from './entity-schema.mjs'
import { recordVersion } from './master-version.mjs'
import { sanitizePayload, buildDiff, formalSnapshot, IMPACT_KEYS } from './subject-fields.mjs'
import { resolveSubjectPerms, assertPayloadAllowed } from './subject-perms.mjs'
import { effectiveActionsFor } from './admin-capabilities.mjs'
import { invalidateStaffRole } from '../infra/staff-role.mjs'
import * as attestDomain from './attest.mjs'

export const REQ_STATUS = { draft: 0, pending: 1, withdrawn: 2, rejected: 3, effective: 4 }
export const STATUS_CN = { 0: '草稿', 1: '待审核', 2: '已撤回', 3: '已退回', 4: '已生效' }
export const KIND_CN = { product: '商品', session: '团期', stock: '直购库存', merchant: '商户资料', scenic: '景区资料' }
const SUBJECT_CN = { merchant: '商户', scenic: '景区' }

function bizDay() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '')
}

// ---------------- 身份与 actor ----------------
// actor: { type:'admin'|'staff', uid, name, role, subjectType, subjectId, channel, cityCode? }
export function actorFromAdmin(p, channel = 'pc') {
  const subjectType = p.role === 'merchant_partner' ? 'merchant' : p.role === 'scenic_partner' ? 'scenic' : null
  if (!subjectType) throw new BizError(1003, '仅主体方可发起资源申请')
  if (!p.subjectId) throw new BizError(1003, '账号未绑定主体,请联系平台管理员')
  return { type: 'admin', uid: p.uid || 0, name: p.name || p.display_name || ('uid:' + p.uid), role: p.role,
    subjectType, subjectId: Number(p.subjectId), channel }
}

export async function actorFromStaff(u, channel = 'mini') {
  const m = await one('SELECT id, city_code FROM merchant WHERE id = ?', [u.merchantId])
  if (!m) throw new BizError(1003, '门店不存在')
  const acc = await one('SELECT nickname FROM user_account WHERE id = ?', [u.uid])
  return { type: 'staff', uid: u.uid, name: acc?.nickname || ('staff:' + u.uid), role: Number(u.role),
    subjectType: 'merchant', subjectId: Number(u.merchantId), channel, cityCode: m.city_code }
}

async function subjectCity(subjectType, subjectId) {
  const r = subjectType === 'merchant'
    ? await one('SELECT city_code FROM merchant WHERE id = ?', [subjectId])
    : await one('SELECT city_code FROM scenic_spot WHERE id = ?', [subjectId])
  return r?.city_code || null
}

async function subjectNameOf(conn, subjectType, subjectId) {
  const get = conn?.one || one
  const r = subjectType === 'merchant'
    ? await get('SELECT name FROM merchant WHERE id = ?', [subjectId])
    : await get('SELECT name FROM scenic_spot WHERE id = ?', [subjectId])
  return r?.name || (SUBJECT_CN[subjectType] || '主体') + '#' + subjectId
}

// ---------------- 站内通知 ----------------
export async function pushInbox(c, { recipientType, uid, merchantId = null, kind, title, body = '', link = '', bizRef = null }) {
  const dedup = `${kind}:${bizRef || ''}:${recipientType}:${uid}`
  await c.q(`INSERT IGNORE INTO platform_inbox
    (recipient_type, recipient_uid, recipient_merchant_id, kind, title, body, link, biz_ref, dedup_key)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [recipientType, uid, merchantId, kind, String(title).slice(0, 120), String(body).slice(0, 500), String(link).slice(0, 200), bizRef, dedup])
}

/** 每笔提交通知:全部启用超管 + 具有 subject.approve 有效授权的运营(同一事件按收件人去重) */
async function notifySubmitted(c, req, subjectName) {
  const supers = await c.q("SELECT id, display_name FROM admin_user WHERE role = 'super' AND status = 1")
  const opsRows = await c.q("SELECT id, display_name FROM admin_user WHERE role = 'ops' AND status = 1")
  const recipients = supers.map((r) => ({ uid: r.id }))
  for (const o of opsRows) {
    const acts = await effectiveActionsFor(o.id, 'ops')
    if (!acts.has('subject.approve')) continue
    // 退回项2:获授权运营按其审批业务范围接收通知(范围内才收)
    const scope = await approverScopeRowsTx(c, o.id)
    if (inApproverScope(scope, req)) recipients.push({ uid: o.id })
  }
  const title = `新主体资源申请 ${req.req_no}`
  const body = `${subjectName}(${SUBJECT_CN[req.subject_type] || req.subject_type})申请${req.action === 'create' ? '新增' : '修改'}${KIND_CN[req.kind]},待审核`
  for (const r of recipients) {
    await pushInbox(c, { recipientType: 'admin', uid: r.uid, kind: 'subject_request_submitted',
      title, body, link: '#subjectapprove?no=' + req.req_no, bizRef: req.req_no })
  }
  return recipients.length
}

/** 事务连接上的 scope 读取(与 approverScopeRows 同语义) */
async function approverScopeRowsTx(c, uid) {
  return c.q('SELECT id, subject_type, subject_id, city_code FROM subject_approver_scope WHERE uid = ?', [uid])
}

/** 提交人通知(批准/退回),包含结果、退回理由及链接;平台侧待审通知转为已处理(保留历史可直达) */
async function notifySubmitter(c, req, verdict, reason = '') {
  const label = verdict === 'approved' ? '已批准生效' : '已退回'
  const body = `您的申请 ${req.req_no}(${KIND_CN[req.kind]}·${req.action === 'create' ? '新增' : '修改'})${label}${reason ? ',原因:' + reason : ''}`
  if (req.channel === 'mini') {
    await pushInbox(c, { recipientType: 'staff', uid: req.submitted_by, merchantId: req.subject_id,
      kind: 'subject_request_' + verdict, title: `申请 ${req.req_no} ${label}`, body,
      link: 'pages/requests/index?no=' + req.req_no, bizRef: req.req_no })
  } else {
    await pushInbox(c, { recipientType: 'admin', uid: req.submitted_by, kind: 'subject_request_' + verdict,
      title: `申请 ${req.req_no} ${label}`, body, link: '#subjectwork?no=' + req.req_no, bizRef: req.req_no })
  }
  await c.q("UPDATE platform_inbox SET handled_at = NOW(3) WHERE biz_ref = ? AND kind = 'subject_request_submitted' AND handled_at IS NULL", [req.req_no])
}

// ---------------- 权限与归属 ----------------
async function permsForActor(actor) {
  return resolveSubjectPerms({
    subjectType: actor.subjectType, subjectId: actor.subjectId, channel: actor.channel,
    staffRole: actor.type === 'staff' ? actor.role : null,
    accountId: actor.type === 'admin' ? actor.uid : null,
  })
}

// ---------------- 审批人业务范围(V97,退回项2) ----------------
// super 不受限(返回 null);非超管返回其 scope 行集合(可为空数组 = 无范围)。
export async function approverScopeRows(uid, role) {
  if (role === 'super') return null
  return q('SELECT id, subject_type, subject_id, city_code FROM subject_approver_scope WHERE uid = ?', [uid])
}

/** scope 行命中申请:行三维均可 NULL=不限;申请 city 为空时,限定城市的行不命中(从严) */
export function scopeRowMatches(row, req) {
  if (row.subject_type != null && String(row.subject_type) !== String(req.subject_type)) return false
  if (row.subject_id != null && Number(row.subject_id) !== Number(req.subject_id)) return false
  if (row.city_code != null && (!req.city_code || String(row.city_code) !== String(req.city_code))) return false
  return true
}

/** 审批人是否可办理该申请:super true;非超管需 scope 行命中;无 scope 行 false */
export function inApproverScope(rows, req) {
  if (rows === null) return true
  if (!rows.length) return false
  return rows.some((r) => scopeRowMatches(r, req))
}

/** 批准/退回/预审/详情统一执行授权范围(退回项2) */
export function assertInApproverScope(rows, req) {
  if (inApproverScope(rows, req)) return
  throw new BizError(1003, '该申请不在您的审批业务范围内(主体/城市未授权),请联系超级管理员调整')
}

/** 列表 SQL 的 scope 过滤(OR 并集;无 scope 行 → 恒假条件) */
export function scopeSqlWhere(rows) {
  if (rows === null) return { sql: '', params: [] }
  if (!rows.length) return { sql: ' AND 1 = 0', params: [] }
  const conds = []
  const params = []
  for (const r of rows) {
    const c = []
    if (r.subject_type != null) { c.push('subject_type = ?'); params.push(String(r.subject_type)) }
    if (r.subject_id != null) { c.push('subject_id = ?'); params.push(Number(r.subject_id)) }
    if (r.city_code != null) { c.push('city_code = ?'); params.push(String(r.city_code)) }
    conds.push('(' + (c.length ? c.join(' AND ') : '1 = 1') + ')')
  }
  return { sql: ' AND (' + conds.join(' OR ') + ')', params }
}

/** 资源归属校验(主体 ID、城市、经营归属由服务端确定;复合资源逐条验证归属) */
async function assertOwnership(actor, kind, action, resourceId) {
  const sid = Number(actor.subjectId)
  if (actor.subjectType === 'merchant') {
    if (kind === 'merchant') {
      if (Number(resourceId) !== sid) throw new BizError(1003, '仅可维护本商户资料')
      return
    }
    if (kind === 'product' && action === 'create') {
      const m = await one('SELECT status FROM merchant WHERE id = ?', [sid])
      if (!m || Number(m.status) !== 1) throw new BizError(1003, '本商户主体尚未生效,不能新增商品')
      return // 履约商户在生效时固定为本人主体,不信任表单传值
    }
    if (!resourceId) throw new BizError(1001, '缺少资源 ID')
    if (kind === 'session' && action === 'create') return // 首批团期子申请:随主申请在生效时按主商品归属校验
    if (kind === 'session') {
      const r = await one('SELECT p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ?', [resourceId])
      if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '团期不存在或不属于本店')
      return
    }
    if (kind === 'stock') {
      const r = await one("SELECT p.merchant_id, p.cat FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ? AND s.depart_date IS NULL", [resourceId])
      if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '库存不存在或不属于本店')
      if (r.cat !== 'shop') throw new BizError(1001, '仅商城直购商品使用直购库存')
      return
    }
    if (kind === 'product') {
      const r = await one('SELECT merchant_id FROM tour_product WHERE id = ?', [resourceId])
      if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '商品不存在或不属于本店')
      return
    }
  } else if (actor.subjectType === 'scenic') {
    if (kind === 'scenic') {
      if (Number(resourceId) !== sid) throw new BizError(1003, '仅可维护本景区资料')
      return
    }
    // 方案§2:景区与商品存在关联只代表展示或履约关系;归属必须用经超管确认的经营主体绑定判定。
    // 首版未建立无歧义归属前,景区主体不可提交商品/团期/库存写申请(V95 已预埋 selfrun_merchant_id)。
    throw new BizError(1003, '景区自营商品需经平台确认经营主体绑定后开放,当前仅可维护本景区资料')
  }
  throw new BizError(1003, '无该资源的提交权限')
}

function assertStatusClaim(kind, clean) {
  if (clean.status == null) return
  const ok = (kind === 'product' && [0, 1, 2].includes(Number(clean.status))) || (kind === 'session' && [1, 3].includes(Number(clean.status)))
  if (!ok) throw new BizError(1001, '不支持的状态申报(取消已订团期等履约动作请走平台履约流程)')
}

// ---------------- 草稿 ----------------
export async function saveDraft(actor, input) {
  const { kind, action = 'update', resourceId = null, payload, note = '', attachments = null,
    impactNote = '', parentId = null, baselineVersion = null } = input || {}
  if (!KIND_CN[kind]) throw new BizError(1001, '未知的资源类型')
  if (!['create', 'update'].includes(action)) throw new BizError(1001, '未知操作')
  const perms = await permsForActor(actor)
  const { payload: clean, forbidden } = sanitizePayload(kind, action, payload || {})
  assertPayloadAllowed(perms.perms, kind, action, clean)
  if (forbidden.length) {
    const e = new BizError(1003, '存在未授权字段(' + forbidden.join(', ') + '),请调整后重试或联系平台调整授权')
    e.data = { fieldErrors: Object.fromEntries(forbidden.map((k) => [k, '当前授权不包含该字段(平台专管)'])) }
    throw e
  }
  assertStatusClaim(kind, clean)
  if (resourceId) await assertOwnership(actor, kind, action, resourceId)
  if (clean.status != null) clean.status = Number(clean.status)
  const city = await subjectCity(actor.subjectType, actor.subjectId)
  const id = await tx(async (c) => {
    let rid = input.id || null
    if (rid) {
      const own = await c.one('SELECT id, status, submitted_by, channel FROM subject_resource_request WHERE id = ?', [rid])
      if (!own) throw new BizError(1004, '草稿不存在')
      if (Number(own.status) !== 0 || Number(own.submitted_by) !== Number(actor.uid) || own.channel !== actor.channel) {
        throw new BizError(1003, '仅可编辑本人未提交的草稿')
      }
      await c.q(`UPDATE subject_resource_request SET kind=?, action=?, resource_id=?, payload=?, note=?, attachments=?, impact_note=?, parent_id=?, baseline_version=?, updated_at=NOW(3) WHERE id=?`,
        [kind, action, resourceId, JSON.stringify(clean), note || null, attachments ? JSON.stringify(attachments) : null, impactNote || null, parentId, baselineVersion, rid])
    } else {
      rid = await c.ins(`INSERT INTO subject_resource_request
        (req_no, kind, action, resource_id, subject_type, subject_id, city_code, channel, status, submitted_by, submitted_by_name, submitter_role, payload, note, attachments, impact_note, parent_id, baseline_version)
        VALUES ('', ?,?,?,?,?,?,?,'0',?,?,?,?,?,?,?,?,?)`,
        [kind, action, resourceId, actor.subjectType, actor.subjectId, city, actor.channel,
          actor.uid, actor.name, String(actor.role), JSON.stringify(clean), note || null,
          attachments ? JSON.stringify(attachments) : null, impactNote || null, parentId, baselineVersion])
      await c.q('UPDATE subject_resource_request SET req_no = CONCAT(?, ?) WHERE id = ?', ['SR' + bizDay() + '-', rid, rid])
    }
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['subject:' + actor.uid, 'subject-request', 'draft-save', 'req-' + rid, null, JSON.stringify({ kind, action, resourceId, fields: Object.keys(clean) })])
    return rid
  })
  return { id, status: 0 }
}

export async function deleteDraft(actor, id) {
  const r = await one('SELECT status, submitted_by, channel FROM subject_resource_request WHERE id = ?', [id])
  if (!r) throw new BizError(1004, '草稿不存在')
  if (Number(r.status) !== 0 || Number(r.submitted_by) !== Number(actor.uid) || r.channel !== actor.channel) throw new BizError(1003, '仅可删除本人未提交的草稿')
  await q('DELETE FROM subject_resource_request WHERE id = ?', [id])
  return { deleted: true }
}

// ---------------- 提交 ----------------
// 基线在提交时刻固化;同主体同资源默认一份待审单(重放/重复提交返回既有待审单,幂等)。
export async function submitRequest(actor, id, { idemKey = null } = {}) {
  return tx(async (c) => {
    const row = await c.one('SELECT * FROM subject_resource_request WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new BizError(1004, '申请不存在')
    if (Number(row.status) === 1) return { id: row.id, reqNo: row.req_no, status: 1, idempotent: true }
    if (Number(row.status) !== 0) throw new BizError(2009, '该申请已提交处理,不能重复提交')
    if (Number(row.submitted_by) !== Number(actor.uid)) throw new BizError(1003, '仅创建人可提交草稿')
    const perms = await permsForActor(actor)
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {})
    const { payload: clean, forbidden } = sanitizePayload(row.kind, row.action, payload)
    if (forbidden.length) {
      const e = new BizError(1003, '存在未授权字段(' + forbidden.join(', ') + '),权限可能已变更,请重新核对')
      e.data = { fieldErrors: Object.fromEntries(forbidden.map((k) => [k, '当前授权不包含该字段(平台专管)'])) }
      throw e
    }
    assertPayloadAllowed(perms.perms, row.kind, row.action, clean)
    assertStatusClaim(row.kind, clean)
    if (row.resource_id) {
      await assertOwnership(actor, row.kind, row.action, row.resource_id)
    } else if (row.kind === 'product' && row.action === 'create') {
      await assertOwnership(actor, row.kind, row.action, null)
    } else if (!(row.kind === 'session' && row.action === 'create')) {
      throw new BizError(1001, '修改类申请缺少资源 ID')
    }
    // 乐观锁基线:提交时携带的 expectedVersion 必须与当前一致(拦截过期数据提交)
    let baseline = { version: null, values: {} }
    if (row.resource_id) {
      const cur = await formalSnapshot(row.kind, row.resource_id)
      if (!cur) throw new BizError(1004, '正式资源不存在')
      if (cur.version != null && row.baseline_version != null && Number(row.baseline_version) !== cur.version) {
        throw new BizError(2002, `正式资源已被更新(当前 v${cur.version}),请重新核对最新值后再提交`)
      }
      baseline = { version: cur.version, values: cur.values }
    }
    // 同主体同资源一份待审单
    if (row.resource_id) {
      const dup = await c.one(`SELECT id, req_no FROM subject_resource_request
        WHERE kind = ? AND resource_id = ? AND subject_type = ? AND subject_id = ? AND status = 1 AND id <> ?`,
        [row.kind, row.resource_id, row.subject_type, row.subject_id, row.id])
      if (dup) return { id: dup.id, reqNo: dup.req_no, status: 1, idempotent: true, duplicateOf: dup.id }
    }
    const { diffs, impacts } = buildDiff(row.kind, baseline.values, clean)
    const impactNote = String(row.impact_note || '')
    const hasImpact = IMPACT_KEYS.some((k) => impacts[k])
    if (hasImpact && row.action === 'update' && !impactNote.trim()) throw new BizError(1001, '本次变更影响在售资源,请填写受影响时段与既有订单处理说明')
    const subjectName = await subjectNameOf(c, row.subject_type, row.subject_id)
    await c.q(`UPDATE subject_resource_request SET status = 1, submitted_at = NOW(3), payload = ?, baseline_version = ?, baseline_snapshot = ?,
      field_diffs = ?, impact_flags = ?, submitted_by = ?, submitted_by_name = ?, submitter_role = ?, idem_key = ? WHERE id = ?`,
      [JSON.stringify(clean), baseline.version, JSON.stringify(baseline.values), JSON.stringify(diffs), JSON.stringify(impacts),
        actor.uid, actor.name, String(actor.role), idemKey, row.id])
    // 子申请(首批团期)随主申请一并进入待审
    await c.q(`UPDATE subject_resource_request SET status = 1, submitted_at = NOW(3), submitted_by = ?, submitted_by_name = ?, submitter_role = ?
      WHERE parent_id = ? AND status = 0`, [actor.uid, actor.name, String(actor.role), row.id])
    const fresh = await c.one('SELECT * FROM subject_resource_request WHERE id = ?', [row.id])
    await notifySubmitted(c, fresh, subjectName)
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['subject:' + actor.uid, 'subject-request', 'submit', 'req-' + row.id, null,
        JSON.stringify({ kind: row.kind, action: row.action, resourceId: row.resource_id, impacts, fields: Object.keys(clean) })])
    return { id: row.id, reqNo: fresh.req_no, status: 1 }
  })
}

// ---------------- 撤回 ----------------
export async function withdrawRequest(actor, id) {
  return tx(async (c) => {
    const row = await c.one('SELECT * FROM subject_resource_request WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new BizError(1004, '申请不存在')
    if (Number(row.status) !== 1) throw new BizError(2009, '仅待审核的申请可撤回')
    if (Number(row.submitted_by) !== Number(actor.uid) || row.subject_type !== actor.subjectType || Number(row.subject_id) !== Number(actor.subjectId)) throw new BizError(1003, '仅提交人可撤回')
    await c.q(`UPDATE subject_resource_request SET status = 2, reviewed_at = NOW(3) WHERE id = ?`, [id])
    await c.q(`UPDATE subject_resource_request SET status = 2 WHERE parent_id = ? AND status = 1`, [id])
    await c.q("UPDATE platform_inbox SET handled_at = NOW(3) WHERE biz_ref = ? AND kind = 'subject_request_submitted' AND handled_at IS NULL", [row.req_no])
    await pushInbox(c, { recipientType: row.channel === 'mini' ? 'staff' : 'admin', uid: row.submitted_by, merchantId: row.subject_id,
      kind: 'subject_request_withdrawn', title: `申请 ${row.req_no} 已撤回`,
      body: '撤回后原通知保留历史,待审任务已移除;可重新核对后再次提交。',
      link: row.channel === 'mini' ? 'pages/requests/index?no=' + row.req_no : '#subjectwork?no=' + row.req_no, bizRef: row.req_no })
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['subject:' + actor.uid, 'subject-request', 'withdraw', 'req-' + id, JSON.stringify({ status: 1 }), JSON.stringify({ status: 2 })])
    return { withdrawn: true }
  })
}

// ---------------- 预审(意见与办理记录,不改变状态) ----------------
export async function addPreaudit(admin, id, note) {
  if (!String(note || '').trim()) throw new BizError(1001, '请填写预审意见')
  const row = await one('SELECT id, status, preaudit, subject_type, subject_id, city_code FROM subject_resource_request WHERE id = ?', [id])
  if (!row) throw new BizError(1004, '申请不存在')
  if (![0, 1].includes(Number(row.status))) throw new BizError(2009, '仅草稿与待审核可添加预审意见')
  // 退回项2:预审同样执行审批业务范围
  const scope = await approverScopeRows(admin.uid, admin.role)
  assertInApproverScope(scope, row)
  const list = typeof row.preaudit === 'string' ? JSON.parse(row.preaudit || '[]') : (row.preaudit || [])
  list.push({ by: admin.uid || 0, byName: admin.name || admin.display_name || '', at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }), note: String(note).slice(0, 300) })
  await q('UPDATE subject_resource_request SET preaudit = ? WHERE id = ?', [JSON.stringify(list), id])
  await tx((c) => c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
    ['admin:' + (admin.name || admin.uid), 'subject-request', 'preaudit', 'req-' + id, null, JSON.stringify({ note })]))
  return { preaudit: list }
}

// ---------------- 生效:共享正式写服务 ----------------
const APPR_CTX = (approver, reqNo) => ({
  admin: { role: 'super', name: 'approval:' + (approver.name || approver.uid) + ':' + reqNo },
  audit: async (c, module_, action, bizRef, before, after) => {
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['approval:' + (approver.name || approver.uid), module_, action, bizRef, JSON.stringify(before || null), JSON.stringify(after || null)])
  },
})
// 在审批事务的连接上执行 entity save(版本簿/审计随同一事务提交或回滚)
const joinTx = (c) => (fn) => fn(c)

async function attestProductChange(c, productId, before, after, kind) {
  const priceChanged = after.price != null && Number(after.price) !== Number(before.price)
  const statusChanged = after.status != null && Number(after.status) !== Number(before.status)
  if (!priceChanged && !statusChanged) return
  try {
    const seq = await c.one("SELECT COUNT(*) n FROM attest_event WHERE biz_type = 'product_change' AND biz_ref = ?", ['product-' + productId])
    await attestDomain.attest('product_change', 'product-' + productId, {
      productId: Number(productId), kind, priceFrom: before.price, priceTo: after.price, statusFrom: before.status, statusTo: after.status,
    }, null, Number(seq.n) + 1)
  } catch (e) {
    console.error('[attest:product_change]', e.message) // 留痕失败不阻断业务(与现有直写口径一致)
  }
}

// 上架完整性校验(与 PC 直写 POST /admin/products/:id/status 同一口径)
async function publishCompleteness(c, pid) {
  const p = await c.one('SELECT * FROM tour_product WHERE id = ?', [pid])
  const rich = typeof p.rich_desc === 'string' ? JSON.parse(p.rich_desc || '{}') : (p.rich_desc || {})
  const stock = p.cat === 'shop' && await c.one('SELECT quota, booked, status FROM tour_session WHERE stock_product_id = ?', [pid])
  const issues = []
  if (stock ? !rich.intro : (!rich.intro || !p.meeting_point || !p.safety_note)) issues.push(stock ? '商品介绍' : '行程介绍、集合地点与安全告知')
  if (stock) { if (Number(stock.status) !== 1 || Number(stock.quota) <= Number(stock.booked)) issues.push('可售库存') }
  else if (!Number((await c.one('SELECT COUNT(*) c FROM tour_session WHERE product_id = ? AND status = 1 AND depart_date >= CURDATE() AND quota > booked', [pid]))?.c)) issues.push('可报名的未来时段')
  if (issues.length) throw new BizError(1001, '批准上架前请补齐:' + issues.join('；') + '(请先退回并联系主体补齐后再提交)')
}

// repeat 字段整值替换保护:主体提交的景区票种剔除 settle 结算价,生效时按票种名回填平台结算价
function restorePlatformOnly(kind, payload, formalValues) {
  if (kind !== 'scenic' || !Array.isArray(payload.tickets) || !Array.isArray(formalValues?.tickets)) return payload
  const formalByName = new Map(formalValues.tickets.map((t) => [t?.name, t]))
  payload.tickets = payload.tickets.map((r) => {
    const f = formalByName.get(r?.name)
    if (f && f.settle != null && r.settle == null) return { ...r, settle: f.settle }
    return r
  })
  return payload
}

/** 单个申请的正式写入(必须在审批事务内调用) */
async function applyFormalWrite(c, req, approver, parentResourceId = null) {
  const payloadRaw = typeof req.payload === 'string' ? JSON.parse(req.payload || '{}') : (req.payload || {})
  const kind = req.kind
  const ctxBase = APPR_CTX(approver, req.req_no)
  const reason = '主体申请生效 ' + req.req_no
  // 首批团期子申请:随主商品在生效时创建(parentId = 主申请生效后的商品 ID)
  if (kind === 'session' && req.action === 'create') {
    if (!parentResourceId) throw new BizError(1001, '首批团期缺少所属商品申请')
    const res = await entities.save('session', payloadRaw, { ...ctxBase, source: 'subject-approval', parentId: parentResourceId, versionReason: reason }, joinTx(c))
    return { resourceId: res.id, version: 1 }
  }
  if (kind === 'product' && req.action === 'create') {
    // 新增商品:履约商户 = 申请主体(服务端确定);firstStock 为商城直购首批库存目标(不入正式字段,审批时同事务建库存行)
    const firstStockRaw = payloadRaw.firstStock
    const saveInput = { ...payloadRaw }
    delete saveInput.firstStock
    const res = await entities.save('product', { ...saveInput, merchant_id: req.subject_id, city_code: req.city_code || '310118' },
      { ...ctxBase, source: 'subject-approval', versionReason: reason }, joinTx(c))
    const pid = res.id
    const firstStock = firstStockRaw != null && firstStockRaw !== '' ? Math.floor(Number(firstStockRaw)) : null
    if (firstStock != null && firstStock >= 0) {
      const prod = await c.one('SELECT cat, price_from FROM tour_product WHERE id = ?', [pid])
      if (prod.cat === 'shop') {
        await c.ins('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,NULL,?,1,?,1)',
          [pid, firstStock, prod.price_from])
      }
    }
    if (Number(payloadRaw.status) === 1) {
      await publishCompleteness(c, pid)
      await c.q('UPDATE tour_product SET status = 1, updated_version = updated_version + 1 WHERE id = ?', [pid])
      await recordVersion(c, { kind: 'product', refId: pid, snapshot: { source: 'subject-approval', changedFields: ['status'], before: { status: 0 }, after: { status: 1 } },
        changedBy: 'approval:' + (approver.name || ''), reason })
    }
    return { resourceId: pid, version: Number(payloadRaw.status) === 1 ? null : 1 }
  }
  if (kind === 'stock') {
    // 直购库存:quota = booked + available;乐观锁基线 = 团期行 version
    const row = await c.one('SELECT id, quota, booked, version FROM tour_session WHERE id = ? AND depart_date IS NULL FOR UPDATE', [req.resource_id])
    if (!row) throw new BizError(1004, '库存行不存在')
    const available = Math.floor(Number(payloadRaw.available))
    if (!(available >= 0 && available <= 1000000)) throw new BizError(1001, '库存须为 0–1000000 的整数')
    const n = await c.upd('UPDATE tour_session SET quota = booked + ?, status = 1, version = version + 1 WHERE id = ? AND version = ?', [available, req.resource_id, Number(req.baseline_version)])
    if (n !== 1) throw new BizError(2002, '库存刚被其他端调整,请退回后由主体重新核对提交')
    await recordVersion(c, { kind: 'session', refId: req.resource_id,
      snapshot: { source: 'subject-approval', operator: approver.name, changedFields: ['available'],
        before: { available: Number(row.quota) - Number(row.booked) }, after: { available } },
      changedBy: 'approval:' + (approver.name || ''), reason })
    return { resourceId: req.resource_id, version: Number(row.version) + 1 }
  }
  // 更新类:商品/团期/商户/景区统一走 entity save(乐观锁+版本簿+审计)
  if (!req.resource_id) throw new BizError(1001, '修改类申请缺少资源 ID')
  const before = await formalSnapshot(kind, req.resource_id)
  const payload = restorePlatformOnly(kind, payloadRaw, before?.values)
  const res = await entities.save(kind, payload,
    { ...ctxBase, source: 'subject-approval', id: req.resource_id, expectedVersion: Number(req.baseline_version), versionReason: reason }, joinTx(c))
  // 商品 status 申报(上下架)不在 product schema 中,单独落列(上架先过完整性校验)
  if (kind === 'product' && payloadRaw.status != null) {
    const cur = await c.one('SELECT status FROM tour_product WHERE id = ? FOR UPDATE', [req.resource_id])
    if (Number(cur.status) !== Number(payloadRaw.status)) {
      if (Number(payloadRaw.status) === 1) await publishCompleteness(c, req.resource_id)
      await c.q('UPDATE tour_product SET status = ?, updated_version = updated_version + 1 WHERE id = ?', [Number(payloadRaw.status), req.resource_id])
      await recordVersion(c, { kind: 'product', refId: req.resource_id, snapshot: { source: 'subject-approval', changedFields: ['status'], before: { status: Number(cur.status) }, after: { status: Number(payloadRaw.status) } },
        changedBy: 'approval:' + (approver.name || ''), reason })
    }
  }
  if (kind === 'product') {
    const cur = await c.one('SELECT price_from, status FROM tour_product WHERE id = ?', [req.resource_id])
    await attestProductChange(c, req.resource_id,
      { price: before?.values?.price_from != null ? Math.round(Number(before.values.price_from) * 100) : null, status: before?.values?.status },
      { price: cur?.price_from, status: cur?.status }, 'subject-approval')
  }
  return { resourceId: req.resource_id, version: res.version ?? null }
}

// ---------------- 批准(一个有效批准即可生效;并发批准只生效一次) ----------------
// 退回项3:生效前对提交人当前权限做完整复验——账号停用/岗位降权/字段撤权/资源归属变更,任一发生即拒绝生效。
// 服务端在生效时刻按库内最新数据重新解析(不信任提交时快照)。
async function revalidateSubmitter(c, req, payload) {
  // 测试夹具令牌无 uid(submitted_by=0):无真实账号可复验,跳过;真实提交(登录令牌)一律复验
  if (!req.submitted_by) return
  const kind = req.kind
  const action = req.action === 'create' ? 'create' : 'update'
  if (req.channel === 'mini') {
    const row = await c.one(`SELECT ua.status ua_status, ms.status staff_status, ms.role staff_role
      FROM user_account ua LEFT JOIN merchant_staff ms ON ms.user_id = ua.id AND ms.merchant_id = ?
      WHERE ua.id = ?`, [req.subject_id, req.submitted_by])
    if (!row || Number(row.ua_status) !== 1) throw new BizError(1003, '提交人账号已停用,申请不能生效;请退回并联系主体重新提交')
    if (!row.staff_status || Number(row.staff_status) !== 1) throw new BizError(1003, '提交人已不在该门店或已被停用,申请不能生效')
    const needManager = kind === 'session' || kind === 'stock' || kind === 'product'
    if (needManager && Number(row.staff_role) < 2) throw new BizError(1003, '提交人岗位已降为核销员,申请不能生效;请退回后由店长及以上重新提交')
  } else {
    const row = await c.one('SELECT status, role FROM admin_user WHERE id = ?', [req.submitted_by])
    if (!row || Number(row.status) !== 1) throw new BizError(1003, '提交人账号已停用,申请不能生效;请退回并联系主体重新提交')
  }
  // 字段授权复验:按提交人当前有效权限(基线∩grant)逐键校验 payload
  const perms = await resolveSubjectPerms({
    subjectType: req.subject_type, subjectId: req.subject_id, channel: req.channel,
    staffRole: req.channel === 'mini' ? Number(req.submitter_role) || null : null,
    accountId: req.channel === 'pc' ? req.submitted_by : null,
  })
  assertPayloadAllowed(perms.perms, kind, action, payload)
}

/** 资源归属复验:归属变更/换绑后,原申请不得按旧归属生效(复合资源逐条验证) */
async function revalidateOwnership(c, req) {
  const sid = Number(req.subject_id)
  if (!req.resource_id) return // 新增类:履约主体在 applyFormalWrite 里固定为申请主体
  if (req.subject_type !== 'merchant') return // 景区首版不开放资源写入
  if (req.kind === 'merchant') {
    if (Number(req.resource_id) !== sid) throw new BizError(1003, '资源归属已变更,申请不能生效')
    return
  }
  if (req.kind === 'session') {
    const r = await c.one('SELECT p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ?', [req.resource_id])
    if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '团期所属商品已换绑其他商户,申请不能生效;请退回后重新核对')
    return
  }
  if (req.kind === 'stock') {
    const r = await c.one('SELECT p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ? AND s.depart_date IS NULL', [req.resource_id])
    if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '库存所属商品已换绑其他商户,申请不能生效')
    return
  }
  if (req.kind === 'product') {
    const r = await c.one('SELECT merchant_id FROM tour_product WHERE id = ?', [req.resource_id])
    if (!r || Number(r.merchant_id) !== sid) throw new BizError(1003, '商品已换绑其他商户,申请不能生效;请退回后重新核对')
  }
}

export async function approveRequest(admin, id, { confirm = {}, note = '' } = {}) {
  return tx(async (c) => {
    const req = await c.one('SELECT * FROM subject_resource_request WHERE id = ? FOR UPDATE', [id])
    if (!req) throw new BizError(1004, '申请不存在')
    if (Number(req.status) === 4) return { id, effective: true, idempotent: true } // 双击/并发批准幂等
    if (Number(req.status) !== 1) throw new BizError(2009, '仅待审核的申请可批准(当前:' + (STATUS_CN[req.status] || req.status) + ')')
    // 退回项2:审批人业务范围(super 不受限;运营按 scope 行命中)
    const scope = await approverScopeRowsTx(c, admin.uid)
    assertInApproverScope(admin.role === 'super' ? null : scope, req)
    // 审批人不得审批本人提交的申请(PC 渠道提交人即后台账号)
    if (req.channel === 'pc' && Number(req.submitted_by) === Number(admin.uid)) throw new BizError(1003, '不能审批本人提交的申请')
    // 重点影响勾选确认:改价、库存、上下架、履约安排、退改须知变更须明确勾选对应影响
    const impacts = typeof req.impact_flags === 'string' ? JSON.parse(req.impact_flags || '{}') : (req.impact_flags || {})
    const missing = IMPACT_KEYS.filter((k) => impacts[k] && confirm[k] !== true)
    if (missing.length) throw new BizError(1001, '请确认以下业务影响后再批准:' + missing.join('/'))
    // 退回项3:重点影响变更的审批说明必填(生效结果随通知回到提交人,说明即审批依据)
    const hasImportantImpact = IMPACT_KEYS.some((k) => impacts[k])
    if (hasImportantImpact && !String(note || '').trim()) throw new BizError(1001, '重点影响变更须填写审批说明后再批准')
    // 归属与主体状态复验(按当前登录账号重新解析绑定范围)
    const subject = req.subject_type === 'merchant'
      ? await c.one('SELECT id, status FROM merchant WHERE id = ?', [req.subject_id])
      : await c.one('SELECT id, status FROM scenic_spot WHERE id = ?', [req.subject_id])
    if (!subject) throw new BizError(1004, '申请的主体不存在')
    if (req.subject_type === 'merchant' && Number(subject.status) !== 1) throw new BizError(1003, '主体已被停用或未生效,不能批准')
    // 退回项3:提交人当前权限复验——账号停用/岗位降权/字段撤权/资源归属变更,任一发生即不能生效
    const payload = typeof req.payload === 'string' ? JSON.parse(req.payload || '{}') : (req.payload || {})
    await revalidateSubmitter(c, req, payload)
    await revalidateOwnership(c, req)
    // 版本复验:正式资源被平台或其他端更新后,拒绝以旧版本覆盖
    if (req.resource_id) {
      const cur = await formalSnapshot(req.kind, req.resource_id)
      if (!cur) throw new BizError(1004, '正式资源不存在')
      if (cur.version != null && req.baseline_version != null && Number(req.baseline_version) !== cur.version) {
        throw new BizError(2002, `正式资源已被平台更新(当前 v${cur.version},申请基线 v${req.baseline_version}),不能以旧版本覆盖;请退回并由主体重新核对提交`)
      }
    }
    // 业务约束复验:名额不得低于当前已报名(审批时不可用提交时的订单计数替代当前计数)
    if (req.kind === 'session' && req.resource_id) {
      const s = await c.one('SELECT booked FROM tour_session WHERE id = ? FOR UPDATE', [req.resource_id])
      if (payload.quota != null && Number(payload.quota) < Number(s.booked)) {
        throw new BizError(2002, `该团期当前已报名 ${s.booked} 人,批准的名额 ${payload.quota} 不足;请退回后由主体重新核对`)
      }
    }
    const result = await applyFormalWrite(c, req, admin)
    // 首批团期子申请:同一事务合并生效(避免孤立团期)
    const children = await c.q('SELECT * FROM subject_resource_request WHERE parent_id = ? AND status = 1', [id])
    for (const ch of children) {
      const childResult = await applyFormalWrite(c, ch, admin, result.resourceId)
      await c.q(`UPDATE subject_resource_request SET status = 4, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW(3), effective_at = NOW(3),
        effective_resource_id = ?, effective_version = ? WHERE id = ? AND status = 1`,
        [admin.uid || 0, admin.name || admin.display_name || '', childResult.resourceId, childResult.version ?? null, ch.id])
    }
    await c.q(`UPDATE subject_resource_request SET status = 4, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW(3),
      review_note = ?, effective_resource_id = ?, effective_version = ?, effective_at = NOW(3) WHERE id = ?`,
      [admin.uid || 0, admin.name || admin.display_name || '', String(note || '').slice(0, 500) || null, result.resourceId, result.version, id])
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['approval:' + (admin.name || admin.uid), 'subject-request', 'effective', 'req-' + id, null,
        JSON.stringify({ status: 4, resourceId: result.resourceId, version: result.version, impacts })])
    const fresh = await c.one('SELECT * FROM subject_resource_request WHERE id = ?', [id])
    await notifySubmitter(c, fresh, 'approved', String(note || '').slice(0, 200))
    if (req.kind === 'session' || req.kind === 'stock') { try { invalidateStaffRole(req.submitted_by, req.subject_id) } catch { /* 缓存失效尽力而为 */ } }
    return { id, effective: true, resourceId: result.resourceId, version: result.version, reqNo: fresh.req_no }
  })
}

// ---------------- 退回(必填原因) ----------------
export async function rejectRequest(admin, id, reason) {
  const why = String(reason || '').trim()
  if (!why) throw new BizError(1001, '退回必须填写原因')
  return tx(async (c) => {
    const req = await c.one('SELECT * FROM subject_resource_request WHERE id = ? FOR UPDATE', [id])
    if (!req) throw new BizError(1004, '申请不存在')
    if (Number(req.status) === 3) return { id, rejected: true, idempotent: true }
    if (Number(req.status) !== 1) throw new BizError(2009, '仅待审核的申请可退回')
    // 退回项2:退回同样执行审批业务范围
    const scope = await approverScopeRowsTx(c, admin.uid)
    assertInApproverScope(admin.role === 'super' ? null : scope, req)
    if (req.channel === 'pc' && Number(req.submitted_by) === Number(admin.uid)) throw new BizError(1003, '不能审批本人提交的申请')
    await c.q(`UPDATE subject_resource_request SET status = 3, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW(3), review_note = ? WHERE id = ?`,
      [admin.uid || 0, admin.name || admin.display_name || '', why.slice(0, 500), id])
    await c.q(`UPDATE subject_resource_request SET status = 3, reviewed_at = NOW(3) WHERE parent_id = ? AND status = 1`, [id])
    const fresh = await c.one('SELECT * FROM subject_resource_request WHERE id = ?', [id])
    await notifySubmitter(c, fresh, 'rejected', why.slice(0, 200))
    await c.q(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)`,
      ['admin:' + (admin.name || admin.uid), 'subject-request', 'reject', 'req-' + id, JSON.stringify({ status: 1 }), JSON.stringify({ status: 3, reason: why.slice(0, 200) })])
    return { id, rejected: true }
  })
}

// ---------------- 退回/撤回后再提交:创建关联历史的新版本 ----------------
export async function resubmitAsNew(actor, id) {
  const row = await one('SELECT * FROM subject_resource_request WHERE id = ?', [id])
  if (!row) throw new BizError(1004, '申请不存在')
  if (![2, 3].includes(Number(row.status))) throw new BizError(1001, '仅已撤回或已退回的申请可重新发起')
  if (Number(row.submitted_by) !== Number(actor.uid)) throw new BizError(1003, '仅提交人可重新发起')
  const created = await saveDraft(actor, {
    kind: row.kind, action: row.action, resourceId: row.resource_id,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {}),
    note: row.note || '', attachments: row.attachments ? JSON.parse(row.attachments) : null,
    impactNote: row.impact_note || '', parentId: row.parent_id || null, baselineVersion: row.baseline_version,
  })
  await q('UPDATE subject_resource_request SET reentry_of = ?, version = 1 WHERE id = ?', [row.id, created.id])
  return created
}

// ---------------- 查询 ----------------
/** 列表:主体看本主体(草稿限创建人,提交后本主体授权账号可查);审批人(super/ops)看已提交申请 */
export async function listRequests(viewer, query = {}, approverScope = undefined) {
  const isApprover = viewer.type === 'admin' && ['super', 'ops'].includes(viewer.role)
  const where = []
  const args = []
  if (query.view === 'approval' || (isApprover && query.view !== 'mine')) {
    if (!isApprover) throw new BizError(1003, '无审批列表权限')
    where.push('status >= 1')
    // 退回项2:审批列表按业务范围过滤(super undefined=不限;ops 传 scope 行)
    if (approverScope !== undefined) {
      const sc = scopeSqlWhere(approverScope)
      where.push(sc.sql.replace(/^ AND /, ''))
      args.push(...sc.params)
    }
  } else {
    where.push('(status > 0 OR (status = 0 AND submitted_by = ? AND channel = ?))')
    args.push(viewer.uid, viewer.channel || 'pc')
    if (viewer.subjectType) { where.push('subject_type = ? AND subject_id = ?'); args.push(viewer.subjectType, viewer.subjectId) }
  }
  if (query.status != null && query.status !== '') { where.push('status = ?'); args.push(Number(query.status)) }
  if (query.kind) { where.push('kind = ?'); args.push(query.kind) }
  if (query.subjectType) { where.push('subject_type = ?'); args.push(query.subjectType) }
  if (query.subjectId) { where.push('subject_id = ?'); args.push(Number(query.subjectId)) }
  if (query.action) { where.push('action = ?'); args.push(query.action) }
  if (query.city) { where.push('city_code = ?'); args.push(query.city) }
  if (query.channel) { where.push('channel = ?'); args.push(query.channel) }
  if (query.submittedBy) { where.push('submitted_by = ?'); args.push(Number(query.submittedBy)) }
  if (query.from) { where.push('submitted_at >= ?'); args.push(query.from + ' 00:00:00') }
  if (query.to) { where.push('submitted_at <= ?'); args.push(query.to + ' 23:59:59') }
  const kw = String(query.kw || '').trim().slice(0, 40)
  if (kw) { where.push('(req_no LIKE ? OR submitted_by_name LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%') }
  const rows = await q(`SELECT id, req_no, kind, action, resource_id, subject_type, subject_id, city_code, channel, status,
    submitted_by, submitted_by_name, submitter_role, baseline_version, field_diffs, impact_flags, impact_note, note, preaudit,
    reviewed_by, reviewed_by_name, reviewed_at, review_note, effective_resource_id, effective_version, effective_at,
    parent_id, reentry_of, version, created_at, submitted_at
    FROM subject_resource_request ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`, args)
  return { items: rows.map(decorate), total: rows.length }
}

function parseJson(v, dflt) {
  try { return typeof v === 'string' ? JSON.parse(v || JSON.stringify(dflt)) : (v || dflt) } catch { return dflt }
}

export function decorate(r) {
  const diffs = parseJson(r.field_diffs, [])
  const impacts = parseJson(r.impact_flags, {})
  const changedLabels = diffs.slice(0, 3).map((d) => d.label)
  return { ...r, statusCn: STATUS_CN[r.status], kindCn: KIND_CN[r.kind] || r.kind,
    diffCount: diffs.length, changedLabels, impacts,
    pendingLabel: Number(r.status) === 1 && changedLabels.length ? '· ' + changedLabels.join('、') + '待审' : '' }
}

/** 详情:申请 + 当前正式值(加载时最新) + 影响数据(当前计数,不用提交时快照) */
export async function detailRequest(viewer, id) {
  const row = await one('SELECT * FROM subject_resource_request WHERE id = ?', [id])
  if (!row) throw new BizError(1004, '申请不存在')
  const isApprover = viewer.type === 'admin' && ['super', 'ops'].includes(viewer.role)
  const isSubjectOwner = viewer.subjectType === row.subject_type && Number(viewer.subjectId) === Number(row.subject_id)
  // 创建人判定必须同主体:uid 空的夹具令牌(0)不得跨主体互认
  const isCreator = viewer.subjectType === row.subject_type && Number(viewer.subjectId) === Number(row.subject_id) && Number(row.submitted_by) === Number(viewer.uid) && row.channel === viewer.channel
  if (!isApprover && !isSubjectOwner && !isCreator) throw new BizError(1003, '无权查看该申请')
  if (!isApprover && Number(row.status) === 0 && !isCreator) throw new BizError(1003, '草稿仅创建人可查')
  const formal = row.resource_id ? await formalSnapshot(row.kind, row.resource_id) : null
  const children = await q(`SELECT id, req_no, kind, action, status, payload, field_diffs, effective_resource_id, effective_version
    FROM subject_resource_request WHERE parent_id = ? ORDER BY id`, [id])
  let impact = {}
  if (row.kind === 'session' && row.resource_id) {
    const s = await one('SELECT booked, quota, status, price_adult FROM tour_session WHERE id = ?', [row.resource_id])
    impact = { bookedNow: s ? Number(s.booked) : null, quotaNow: s ? Number(s.quota) : null }
  } else if (row.kind === 'product' && (row.resource_id || row.effective_resource_id)) {
    const pid = row.resource_id || row.effective_resource_id
    const agg = await one('SELECT COUNT(*) sessions, COALESCE(SUM(booked),0) booked FROM tour_session WHERE product_id = ?', [pid])
    impact = { sessions: Number(agg?.sessions || 0), booked: Number(agg?.booked || 0) }
  } else if (row.kind === 'stock' && row.resource_id) {
    const s = await one('SELECT quota, booked FROM tour_session WHERE id = ?', [row.resource_id])
    impact = { availableNow: s ? Number(s.quota) - Number(s.booked) : null }
  }
  const baseline = parseJson(row.baseline_snapshot, {})
  const payload = parseJson(row.payload, {})
  return { ...decorate(row), payload, baseline, diffs: parseJson(row.field_diffs, []), formal, impact, children: children.map(decorate), preaudit: parseJson(row.preaudit, []) }
}

/** 审批人待审数(主申请口径,子申请不重复计数) */
export async function approvalPendingCount() {
  return Number((await one('SELECT COUNT(*) c FROM subject_resource_request WHERE status = 1 AND parent_id IS NULL'))?.c || 0)
}

export async function inboxUnread(adminUid) {
  return Number((await one('SELECT COUNT(*) c FROM platform_inbox WHERE recipient_type = ? AND recipient_uid = ? AND read_at IS NULL', ['admin', adminUid]))?.c || 0)
}
