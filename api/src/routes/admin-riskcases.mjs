// T12（批次 F-1）：风险案件闭环。事件升级为案件：待研判→处理中→待补材料/待协查→待复核→关闭，可重开；
// 责任人/复核人（≠责任人）/结论/时间线全留痕；冻结/解冻可引用案件；城市账号可发起本城协查并跟踪。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, scopeFilter, audit } from './_shared.mjs'

const STATUS_CN = { 0: '待研判', 1: '处理中', 2: '待补材料', 3: '待协查', 4: '待复核', 5: '已关闭' }
// 状态机：每步动作允许的来源状态。close 仅允许 4（待复核），复核人≠责任人——解冻不等于结案。
const FLOW = {
  judge: [0], need_info: [1], coordinate: [1], resume: [2, 3], review: [1], close: [4], reopen: [5], note: [0, 1, 2, 3, 4, 5],
}
const caseNo = () => 'RC' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 100000).padStart(5, '0')
// V-01：身份按不可变账号 UID 判定，显示名只是写入时的展示快照——同一账号改显示名不能再绕过双人复核，
// 两个不同账号同名也不会互相误拒。存量行（uid 为 NULL）回退旧名字比较；案件已记录 UID 而请求令牌
// 无 uid（仅测试夹具可能）时按同人处理拒绝结案——身份不可证实时不放行（fail-closed）。
const isSelf = (storedUid, storedName, a) =>
  storedUid != null ? (a.uid == null || Number(storedUid) === Number(a.uid)) : storedName === 'admin:' + a.name
const rec = (c, caseId, actor, action, note, fromStatus, toStatus) =>
  c.q('INSERT INTO risk_case_record (case_id, actor, action, note, from_status, to_status) VALUES (?,?,?,?,?,?)',
    [caseId, actor, action, note || null, fromStatus, toStatus])

async function loadCase(req, id) {
  const a = await requireAdmin(req, ['super', 'risk', 'city_partner', 'ops'])
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  const kase = await one('SELECT * FROM risk_case WHERE id = ?', [id])
  if (!kase) throw new BizError(1004, '案件不存在')
  if (a.scopeCity && String(a.scopeCity) !== String(kase.city_code)) throw new BizError(1003, '仅可查看本城案件')
  return { a, kase }
}
const canManage = (a) => ['super', 'risk'].includes(a.role)

export const adminRiskCases = {
  'GET /admin/risk-cases': async (req) => {
    const a = await requireAdmin(req, ['super', 'risk', 'city_partner', 'ops'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const sc = scopeFilter(a, 'city_code')
    const conds = sc.sql ? [sc.sql.replace(' AND ', '')] : []
    const args = [...sc.params]
    const filters = {}
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null && [0, 1, 2, 3, 4, 5].includes(status)) { conds.push('status = ?'); args.push(status); filters.status = status }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(case_no LIKE ? OR title LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const total = Number((await one(`SELECT COUNT(*) n FROM risk_case ${W}`, args)).n)
    const rows = await q(`SELECT * FROM risk_case ${W} ORDER BY FIELD(status, 0, 1, 2, 3, 4, 5), severity ASC, id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize])
    const countsRaw = await q(`SELECT status, COUNT(*) n FROM risk_case ${sc.sql ? 'WHERE ' + sc.sql.replace(' AND ', '') : ''} GROUP BY status`, sc.params)
    const statusCounts = Object.fromEntries(countsRaw.map((r) => [Number(r.status), Number(r.n)]))
    statusCounts.all = countsRaw.reduce((s, r) => s + Number(r.n), 0)
    return { rows: rows.map((r) => ({ ...r, statusCn: STATUS_CN[r.status] })), total, page, pageSize, statusCounts, countsScope: 'city-scope-only', filters }
  },

  // 建案：super/risk 全局；城市合伙人仅本城对象（source=city，协查请求）
  'POST /admin/risk-cases': async (req) => {
    const a = await requireAdmin(req, ['super', 'risk', 'city_partner'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const { sourceType, sourceId, objectType, objectId, userId, severity, title, note } = req.body || {}
    const st = String(sourceType || 'manual')
    if (!['risk_event', 'verify_conflict', 'manual', 'city'].includes(st)) throw new BizError(1001, '案件来源无效')
    if (st === 'city' && a.role !== 'city_partner') throw new BizError(1001, 'city 来源仅限城市账号发起协查')
    const why = String(note || '').trim()
    if (why.length < 4 || why.length > 500) throw new BizError(1001, '请填写 4–500 字研判/协查说明')
    const ttl = String(title || '').trim()
    if (!ttl || ttl.length > 120) throw new BizError(1001, '请填写 1–120 字案件标题')
    const sev = [1, 2, 3].includes(Number(severity)) ? Number(severity) : 2
    let city = null
    if (Number(userId)) {
      const u = await one('SELECT id FROM user_account WHERE id = ?', [Number(userId)])
      if (!u) throw new BizError(1004, '关联用户不存在')
    }
    if (st === 'risk_event' && Number(sourceId)) {
      const ev = await one('SELECT id, user_id, merchant_id FROM risk_event WHERE id = ?', [Number(sourceId)])
      if (!ev) throw new BizError(1004, '来源风控事件不存在')
    }
    if (st === 'verify_conflict' && Number(sourceId)) {
      const v = await one('SELECT id, merchant_id FROM verify_offline_conflict WHERE id = ?', [Number(sourceId)])
      if (!v) throw new BizError(1004, '来源核销冲突不存在')
    }
    if (a.scopeCity) {
      // 城市账号：对象必须在本城（用户按下单城市、商户/事件按归属城市）
      const oid = Number(objectId)
      if (objectType === 'user' && oid) {
        const u = await one('SELECT DISTINCT city_code FROM orders WHERE user_id = ? AND city_code = ? LIMIT 1', [oid, a.scopeCity])
        if (!u) throw new BizError(1003, '仅可对本城用户发起协查')
        city = a.scopeCity
      } else city = a.scopeCity
    } else if (Number(userId)) {
      const uc = await one('SELECT city_code FROM orders WHERE user_id = ? AND city_code IS NOT NULL ORDER BY id DESC LIMIT 1', [Number(userId)])
      city = uc ? uc.city_code : null
    }
    const id = await tx(async (c) => {
      const no = caseNo()
      const cid = await c.ins(`INSERT INTO risk_case (case_no, source_type, source_id, object_type, object_id, user_id, city_code, severity, title, handler, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [no, st, Number(sourceId) || null, String(objectType || 'user'), Number(objectId) || null, Number(userId) || null,
          city, sev, ttl, a.scopeCity ? null : 'admin:' + a.name, 'admin:' + a.name])
      await rec(c, cid, 'admin:' + a.name, 'create', why, null, 0)
      if (st === 'risk_event' && Number(sourceId)) {
        // risk_event 无 handled_by/handled_at 列（旧"标记已处理"因此一直报错）——处理人/时间进审计与案件时间线
        await c.q('UPDATE risk_event SET handled = 1 WHERE id = ? AND handled = 0', [Number(sourceId)])
      }
      await audit(c, 'admin:' + a.name, 'risk-case', 'create', 'case-' + cid, null, { caseNo: no, sourceType: st, sourceId: Number(sourceId) || null, title: ttl, severity: sev })
      return cid
    })
    return { id, caseNo: (await one('SELECT case_no FROM risk_case WHERE id = ?', [id])).case_no }
  },

  'GET /admin/risk-cases/:id': async (req) => {
    const { kase } = await loadCase(req, req.params.id)
    const records = await q('SELECT actor, action, note, from_status, to_status, created_at FROM risk_case_record WHERE case_id = ? ORDER BY id', [kase.id])
    let objectInfo = null
    if (kase.user_id) {
      const u = await one('SELECT id, nickname, status, risk_flag FROM user_account WHERE id = ?', [kase.user_id])
      if (u) objectInfo = { type: 'user', id: u.id, nickname: u.nickname, frozen: Number(u.status) === 0, riskFlag: Number(u.risk_flag) === 1 }
    }
    return { case: kase, statusCn: STATUS_CN[kase.status], records, objectInfo }
  },

  // 补充材料：平台角色或本城城市账号（必须先于 :action 注册，否则 note 被通配捕获）（协查反馈）；时间线不可改写
  'POST /admin/risk-cases/:id/note': async (req) => {
    const { a, kase } = await loadCase(req, req.params.id)
    const note = String(req.body?.note || '').trim()
    if (note.length < 2 || note.length > 500) throw new BizError(1001, '请填写 2–500 字补充材料')
    return tx(async (c) => {
      await rec(c, kase.id, 'admin:' + a.name, 'note', note, Number(kase.status), Number(kase.status))
      return { added: true }
    })
  },
  // 状态流转：super/risk。close 必须在待复核态、复核人≠责任人、结论必填——"标记已处理"不再是一个布尔值
  'POST /admin/risk-cases/:id/:action': async (req) => {
    const { a, kase } = await loadCase(req, req.params.id)
    if (!canManage(a)) throw new BizError(1003, '案件办理需风控或超级管理员；城市账号可补充材料')
    const action = req.params.action
    if (!FLOW[action] || action === 'note') throw new BizError(1001, '未知案件动作')
    const note = String(req.body?.note || '').trim()
    if ((action === 'close' || action === 'reopen') && note.length < 4) throw new BizError(1001, `请填写 4–500 字${action === 'close' ? '结案结论' : '重开原因'}`)
    if ((action === 'judge' || action === 'need_info' || action === 'coordinate' || action === 'review') && note.length < 2) throw new BizError(1001, '请填写处理说明（进入时间线）')
    return tx(async (c) => {
      const k = await c.one('SELECT * FROM risk_case WHERE id = ? FOR UPDATE', [kase.id])
      if (!FLOW[action].includes(Number(k.status))) throw new BizError(2002, `当前状态「${STATUS_CN[k.status]}」不能执行该动作，请刷新`)
      if (action === 'close' && isSelf(k.handler_uid, k.handler, a)) throw new BizError(1003, '双人复核：结案复核人不能与当前责任人相同')
      const next = action === 'judge' ? 1 : action === 'need_info' ? 2 : action === 'coordinate' ? 3 : action === 'resume' ? 1 : action === 'review' ? 4 : action === 'close' ? 5 : action === 'reopen' ? 1 : Number(k.status)
      const sets = ['status = ?']
      const args = [next]
      if (action === 'judge') { sets.push('handler = ?, handler_uid = ?'); args.push('admin:' + a.name, a.uid ?? null) }
      if (action === 'close') { sets.push('reviewer = ?, reviewer_uid = ?, conclusion = ?, closed_at = NOW(3)'); args.push('admin:' + a.name, a.uid ?? null, note) }
      if (action === 'reopen') { sets.push('closed_at = NULL, conclusion = NULL, reviewer = NULL, reviewer_uid = NULL, handler = ?, handler_uid = ?'); args.push('admin:' + a.name, a.uid ?? null) }
      await c.q(`UPDATE risk_case SET ${sets.join(', ')} WHERE id = ?`, [...args, k.id])
      await rec(c, k.id, 'admin:' + a.name, action, note, Number(k.status), next)
      await audit(c, 'admin:' + a.name, 'risk-case', action, 'case-' + k.id, { status: Number(k.status) }, { status: next, note: note || null })
      return { status: next, statusCn: STATUS_CN[next] }
    })
  },

}
