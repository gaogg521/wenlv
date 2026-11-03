// T04（批次 D）：订单售后工单 + 未支付取消。
// 工单流程：新建→认领→处理中→等待外部→已解决→关闭；转派/恢复/重开留痕；城市角色发起本城请求与补充材料，
// 平台客服（super/ops）认领与办结。未支付取消走订单状态机（WAIT_PAY--CLOSE_TIMEOUT-->CLOSED），
// 与支付回调并发时由行锁/乐观锁+状态守卫保证一致（先到先得，后者收到状态冲突）。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, scopeFilter, audit } from './_shared.mjs'
import * as order from '../domain/order.mjs'
import * as bean from '../domain/bean.mjs'

const CATEGORIES = ['refund', 'reschedule', 'contact', 'complaint', 'other']
const STATUS_CN = { 0: '待认领', 1: '处理中', 2: '等待外部', 3: '已解决', 4: '已关闭' }
// 工单状态机：每步动作允许的来源状态（close 允许误报单直接关闭，但必须写说明）
const FLOW = {
  claim: [0], transfer: [1, 2], wait: [1], resume: [2], resolve: [1, 2, 3], close: [0, 1, 2, 3], reopen: [3, 4], note: [0, 1, 2, 3, 4],
}

const ticketNo = () => 'AS' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 100000).padStart(5, '0')
const rec = (c, ticketId, actor, action, note, fromStatus, toStatus) =>
  c.q('INSERT INTO aftersales_record (ticket_id, actor, action, note, from_status, to_status) VALUES (?,?,?,?,?,?)',
    [ticketId, actor, action, note || null, fromStatus, toStatus])

async function loadTicketScoped(req, id) {
  const a = await requireAdmin(req, ['super', 'ops', 'finance', 'city_partner'])
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  const t = await one(`SELECT t.*, o.city_code order_city FROM aftersales_ticket t LEFT JOIN orders o ON o.order_no = t.order_no WHERE t.id = ?`, [id])
  if (!t) throw new BizError(1004, '工单不存在')
  if (a.scopeCity && String(a.scopeCity) !== String(t.city_code)) throw new BizError(1003, '仅可处理本城工单')
  return { a, t }
}

export const adminTickets = {
  // 工单队列：服务端分页 + 状态/关键词筛选；城市账号仅本城
  'GET /admin/tickets': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance', 'city_partner'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const sc = scopeFilter(a, 't.city_code')
    const conds = sc.sql ? [sc.sql.replace(' AND ', '')] : []
    const args = [...sc.params]
    const filters = {}
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null && [0, 1, 2, 3, 4].includes(status)) { conds.push('t.status = ?'); args.push(status); filters.status = status }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(t.ticket_no LIKE ? OR t.order_no LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const from = 'FROM aftersales_ticket t'
    const total = Number((await one(`SELECT COUNT(*) n ${from} ${W}`, args)).n)
    const rows = await q(`SELECT t.* ${from} ${W} ORDER BY FIELD(t.status, 0, 1, 2, 3, 4), t.priority ASC, t.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize])
    const countsRaw = await q(`SELECT t.status, COUNT(*) n ${from} ${sc.sql ? 'WHERE ' + sc.sql.replace(' AND ', '') : ''} GROUP BY t.status`, sc.params)
    const statusCounts = Object.fromEntries(countsRaw.map((r) => [Number(r.status), Number(r.n)]))
    statusCounts.all = countsRaw.reduce((s, r) => s + Number(r.n), 0)
    return { rows, total, page, pageSize, statusCounts, countsScope: 'city-scope-only', filters }
  },

  // 发起工单：super/ops 全局；城市合伙人限本城订单
  'POST /admin/tickets': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'city_partner'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const { orderNo, category, priority, note, promisedAt } = req.body || {}
    const why = String(note || '').trim()
    if (why.length < 4 || why.length > 500) throw new BizError(1001, '请填写 4–500 字诉求说明')
    if (!CATEGORIES.includes(category)) throw new BizError(1001, '诉求类别无效')
    const pri = [1, 2, 3].includes(Number(priority)) ? Number(priority) : 2
    const promised = promisedAt ? new Date(promisedAt) : null
    if (promisedAt && isNaN(promised.getTime())) throw new BizError(1001, '承诺时限格式无效')
    const o = await one('SELECT order_no, city_code, status FROM orders WHERE order_no = ?', [String(orderNo || '').trim()])
    if (!o) throw new BizError(2003, '订单不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可为本城订单发起售后')
    const id = await tx(async (c) => {
      const no = ticketNo()
      const tid = await c.ins(`INSERT INTO aftersales_ticket (ticket_no, order_no, category, source, city_code, priority, promised_at, created_by)
        VALUES (?,?,?,?,?,?,?,?)`,
        [no, o.order_no, category, a.scopeCity ? 'city' : 'admin', o.city_code, pri, promised, 'admin:' + a.name])
      await rec(c, tid, 'admin:' + a.name, 'create', why, null, 0)
      await audit(c, 'admin:' + a.name, 'ticket', 'create', 'ticket-' + tid, null, { ticketNo: no, orderNo: o.order_no, category, priority: pri })
      return tid
    })
    return { id, ticketNo: (await one('SELECT ticket_no FROM aftersales_ticket WHERE id = ?', [id])).ticket_no }
  },

  // 工单详情 + 时间线
  'GET /admin/tickets/:id': async (req) => {
    const { t } = await loadTicketScoped(req, req.params.id)
    const records = await q('SELECT actor, action, note, from_status, to_status, created_at FROM aftersales_record WHERE ticket_id = ? ORDER BY id', [t.id])
    return { ticket: t, records, statusCn: STATUS_CN[t.status] }
  },

  // 补充材料/处理记录：平台客服或本城城市角色（工单可回写，历史不可改写）
  // 注意：本路由必须先于 :action 注册，否则 note 会被通配动作捕获
  'POST /admin/tickets/:id/note': async (req) => {
    const { a, t } = await loadTicketScoped(req, req.params.id)
    const note = String(req.body?.note || '').trim()
    if (note.length < 2 || note.length > 500) throw new BizError(1001, '请填写 2–500 字处理记录')
    return tx(async (c) => {
      await rec(c, t.id, 'admin:' + a.name, 'note', note, Number(t.status), Number(t.status))
      return { added: true }
    })
  },

  // 状态流转（认领/转派/等待/恢复/解决/关闭/重开）：平台客服专用，每步留痕
  'POST /admin/tickets/:id/:action': async (req) => {
    const a = await requireAdmin(req, 'ticket.manage')
    const action = req.params.action
    if (!FLOW[action] || action === 'note') throw new BizError(1001, '未知工单动作')
    const note = String(req.body?.note || '').trim()
    const toAssignee = String(req.body?.assignee || '').trim()
    if (action === 'close' && note.length < 4) throw new BizError(1001, '关闭必须填写说明（4–500 字，含结论）')
    if ((action === 'resolve' || action === 'reopen' || action === 'transfer') && note.length < 4) throw new BizError(1001, '请填写 4–500 字说明（结论/原因进入时间线）')
    if (action === 'transfer' && !toAssignee) throw new BizError(1001, '转派需填写责任人')
    return tx(async (c) => {
      const t = await c.one('SELECT * FROM aftersales_ticket WHERE id = ? FOR UPDATE', [req.params.id])
      if (!t) throw new BizError(1004, '工单不存在')
      if (!FLOW[action].includes(Number(t.status))) throw new BizError(2002, `当前状态「${STATUS_CN[t.status]}」不能${action === 'claim' ? '认领' : action === 'wait' ? '转等待' : action === 'resume' ? '恢复处理' : action === 'resolve' ? '办结' : action === 'close' ? '关闭' : action === 'reopen' ? '重开' : '转派'}，请刷新`)
      const next = action === 'claim' ? 1 : action === 'wait' ? 2 : action === 'resume' ? 1 : action === 'resolve' ? 3 : action === 'close' ? 4 : action === 'reopen' ? 1 : Number(t.status)
      const sets = ['status = ?']
      const args = [next]
      if (action === 'claim' || action === 'transfer') { sets.push('assignee = ?'); args.push(action === 'transfer' ? toAssignee : 'admin:' + a.name) }
      if (action === 'resolve') { sets.push('resolution = ?'); args.push(note) }
      if (action === 'close') { sets.push('closed_at = NOW(3)') }
      if (action === 'reopen') { sets.push('closed_at = NULL, resolution = NULL') }
      await c.q(`UPDATE aftersales_ticket SET ${sets.join(', ')} WHERE id = ?`, [...args, t.id])
      await rec(c, t.id, 'admin:' + a.name, action, note || (action === 'claim' ? '认领处理' : null), Number(t.status), next)
      await audit(c, 'admin:' + a.name, 'ticket', action, 'ticket-' + t.id, { status: Number(t.status) }, { status: next, note: note || null, assignee: action === 'transfer' ? toAssignee : undefined })
      return { status: next, statusCn: STATUS_CN[next] }
    })
  },

  // 未支付订单客服取消：走状态机（WAIT_PAY--CLOSE_TIMEOUT-->CLOSED），释放名额/退回旅豆/事件留痕
  'POST /admin/orders/:no/cancel-unpaid': async (req) => {
    const a = await requireAdmin(req, 'order.service')
    const reason = String(req.body?.reason || '').trim()
    if (reason.length < 4 || reason.length > 200) throw new BizError(1001, '请填写 4–200 字取消原因')
    const o = await one('SELECT order_no, city_code, status FROM orders WHERE order_no = ?', [req.params.no])
    if (!o) throw new BizError(2003, '订单不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可处理本城订单')
    if (Number(o.status) !== 10) throw new BizError(2002, '仅待支付订单可取消；已支付订单请走退款流程')
    const r = await order.fire(o.order_no, 'CLOSE_TIMEOUT', 'admin:' + a.name, async (c, ord) => {
      // 与支付回调并发：fire 在状态守卫+乐观锁内执行，支付先到则这里抛「非法流转」
      if (Number(ord.bean_deducted) > 0) await bean.reverse(ord.user_id, Number(ord.bean_deducted), ord.order_no, c)
      await c.upd('UPDATE tour_session SET booked = booked - ? WHERE id = ?', [ord.qty, ord.session_id])
      return '客服取消未支付订单：' + reason
    })
    await tx(async (c) => audit(c, 'admin:' + a.name, 'order', 'cancel-unpaid', o.order_no, { status: 10 }, { status: 90, reason }))
    return { cancelled: true, status: r.status }
  },
}
