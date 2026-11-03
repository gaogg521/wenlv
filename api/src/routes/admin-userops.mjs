// T05+T06（批次 E）：用户运营标签 / 内部备注 + 人工权益调整申请。
// 红线：不提供"直接改余额"接口——旅豆/成长值/徽章全部走"申请→他人审批→执行（账本/成长记录+审计同事务）"；
// 审批人不能与申请人相同；内部标签与备注不下发游客接口。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { attest } from '../domain/attest.mjs'
import { cfgArr } from '../config.mjs'
import * as bean from '../domain/bean.mjs'
import * as member from '../domain/member.mjs'
import crypto from 'node:crypto'

const KINDS = ['bean_grant', 'bean_deduct', 'growth_fix', 'badge_grant', 'badge_revoke']
const KIND_CN = { bean_grant: '旅豆补发', bean_deduct: '旅豆扣回', growth_fix: '成长值更正', badge_grant: '徽章补发', badge_revoke: '徽章撤回' }
const reqNo = () => 'EQ' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 100000).padStart(5, '0') + crypto.randomBytes(1).toString('hex')

async function opsTarget(req, userId) {
  const a = await requireAdmin(req, 'user.manage')
  const u = await one('SELECT id, nickname, growth_value, member_level FROM user_account WHERE id = ?', [userId])
  if (!u) throw new BizError(1004, '用户不存在')
  return { a, u }
}

export const adminUserOps = {
  // ---- T05：运营标签 ----
  'GET /admin/users/:id/ops': async (req) => {
    const { u } = await opsTarget(req, req.params.id)
    const tags = await q('SELECT id, tag, note, created_by, created_at FROM user_ops_tag WHERE user_id = ? ORDER BY id DESC', [u.id])
    const notes = await q('SELECT actor, note, created_at FROM user_ops_note WHERE user_id = ? ORDER BY id DESC LIMIT 30', [u.id])
    let words = []
    try { words = await cfgArr('user.ops_tags') } catch { words = [] }
    return { userId: u.id, nickname: u.nickname, tags, notes, words, growth: Number(u.growth_value), memberLevel: Number(u.member_level) }
  },
  'POST /admin/users/:id/tags': async (req) => {
    const { a, u } = await opsTarget(req, req.params.id)
    const tag = String(req.body?.tag || '').trim()
    const note = String(req.body?.note || '').trim() || null
    let words = []
    try { words = await cfgArr('user.ops_tags') } catch { words = [] }
    if (!words.includes(tag)) throw new BizError(1001, '标签不在词表中：可在参数中心 user.ops_tags 维护词表')
    if (await one('SELECT id FROM user_ops_tag WHERE user_id = ? AND tag = ?', [u.id, tag])) throw new BizError(1001, '该标签已存在')
    const id = await tx(async (c) => {
      const rid = await c.ins('INSERT INTO user_ops_tag (user_id, tag, note, created_by) VALUES (?,?,?,?)', [u.id, tag, note, 'admin:' + a.name])
      await audit(c, 'admin:' + a.name, 'user', 'tag-add', 'user-' + u.id, null, { tag, note })
      return rid
    })
    return { id }
  },
  'DELETE /admin/users/:id/tags/:tagId': async (req) => {
    const { a, u } = await opsTarget(req, req.params.id)
    const t = await one('SELECT id, tag FROM user_ops_tag WHERE id = ? AND user_id = ?', [req.params.tagId, u.id])
    if (!t) throw new BizError(1004, '标签不存在')
    return tx(async (c) => {
      await c.q('DELETE FROM user_ops_tag WHERE id = ?', [t.id])
      await audit(c, 'admin:' + a.name, 'user', 'tag-remove', 'user-' + u.id, { tag: t.tag }, null)
      return { removed: true }
    })
  },
  // 内部备注：追加式（不可覆盖、不可删除），历史全留
  'POST /admin/users/:id/ops-notes': async (req) => {
    const { a, u } = await opsTarget(req, req.params.id)
    const note = String(req.body?.note || '').trim()
    if (note.length < 2 || note.length > 500) throw new BizError(1001, '请填写 2–500 字内部备注')
    if (/\d{11,}/.test(note)) throw new BizError(1001, '备注请勿录入完整手机号、证件号等敏感信息')
    return tx(async (c) => {
      await c.q('INSERT INTO user_ops_note (user_id, actor, note) VALUES (?,?,?)', [u.id, 'admin:' + a.name, note])
      await audit(c, 'admin:' + a.name, 'user', 'ops-note', 'user-' + u.id, null, { note })
      return { added: true }
    })
  },

  // ---- T06：人工权益调整申请 ----
  'GET /admin/entitlements': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = [], args = [], filters = {}
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null && [0, 1, 2, 3].includes(status)) { conds.push('r.status = ?'); args.push(status); filters.status = status }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const from = 'FROM entitlement_request r JOIN user_account u ON u.id = r.user_id'
    const total = Number((await one(`SELECT COUNT(*) n ${from} ${W}`, args)).n)
    const rows = await q(`SELECT r.*, u.nickname ${from} ${W} ORDER BY FIELD(r.status, 0, 1, 2, 3), r.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize])
    return { rows: rows.map((r) => ({ ...r, kindCn: KIND_CN[r.kind] })), total, page, pageSize, filters }
  },
  // 提交申请：运营/超管；展示当前值由前端调 GET /admin/users/:id/ops 或画像获得
  'POST /admin/entitlements': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { userId, kind, amount, badgeId, reason } = req.body || {}
    if (!KINDS.includes(kind)) throw new BizError(1001, '调整类型无效')
    const why = String(reason || '').trim()
    if (why.length < 4 || why.length > 500) throw new BizError(1001, '请填写 4–500 字业务依据与原因')
    const u = await one('SELECT id, nickname, growth_value FROM user_account WHERE id = ?', [Number(userId)])
    if (!u) throw new BizError(1004, '用户不存在')
    let amt = null, bid = null
    if (kind === 'bean_grant' || kind === 'bean_deduct') {
      amt = Number(amount)
      if (!Number.isInteger(amt) || amt <= 0) throw new BizError(1001, '旅豆数量需为正整数')
      if (kind === 'bean_deduct') {
        const bal = await one('SELECT balance FROM bean_account WHERE user_id = ?', [u.id])
        if (!bal || Number(bal.balance) < amt) throw new BizError(1001, `该用户当前旅豆余额不足（余额 ${bal ? Number(bal.balance) : 0}，申请扣回 ${amt}）；不得强行记负`)
      }
    } else if (kind === 'growth_fix') {
      amt = Number(amount)
      if (!Number.isInteger(amt) || amt === 0) throw new BizError(1001, '成长值更正需为非零整数（可为负用于冲正多记）')
      if (Number(u.growth_value) + amt < 0) throw new BizError(1001, `更正后成长值将为负（当前 ${Number(u.growth_value)}），请核对依据`)
    } else {
      bid = Number(badgeId)
      const b = await one('SELECT id, name FROM badge WHERE id = ?', [bid])
      if (!b) throw new BizError(1004, '徽章定义不存在')
    }
    const no = reqNo()
    const id = await tx(async (c) => {
      const rid = await c.ins(`INSERT INTO entitlement_request (req_no, user_id, kind, amount, badge_id, reason, applicant) VALUES (?,?,?,?,?,?,?)`,
        [no, u.id, kind, amt, bid, why, 'admin:' + a.name])
      await audit(c, 'admin:' + a.name, 'entitlement', 'submit', 'eq-' + rid, null, { reqNo: no, userId: u.id, kind, amount: amt, badgeId: bid })
      return rid
    })
    return { id, reqNo: no }
  },
  // 撤回（仅申请人本人、待审批时）
  'POST /admin/entitlements/:id/withdraw': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    return tx(async (c) => {
      const r = await c.one('SELECT * FROM entitlement_request WHERE id = ? FOR UPDATE', [req.params.id])
      if (!r) throw new BizError(1004, '申请不存在')
      if (Number(r.status) !== 0) throw new BizError(2002, '仅待审批的申请可撤回')
      if (r.applicant !== 'admin:' + a.name) throw new BizError(1003, '只能撤回本人提交的申请')
      await c.q('UPDATE entitlement_request SET status = 3, approved_at = NOW(3) WHERE id = ?', [r.id])
      await audit(c, 'admin:' + a.name, 'entitlement', 'withdraw', 'eq-' + r.id, { status: 0 }, { status: 3 })
      return { withdrawn: true }
    })
  },
  // 审批并执行：仅超管、且不能批准自己提交的申请；执行与账本/成长/徽章+审计同事务，req_no 作幂等键
  'POST /admin/entitlements/:id/approve': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const pass = req.body?.pass === true
    const note = String(req.body?.note || '').trim() || null
    return tx(async (c) => {
      const r = await c.one('SELECT * FROM entitlement_request WHERE id = ? FOR UPDATE', [req.params.id])
      if (!r) throw new BizError(1004, '申请不存在')
      if (Number(r.status) !== 0) throw new BizError(2002, '该申请已处理，请刷新')
      if (r.applicant === 'admin:' + a.name) throw new BizError(1003, '双人复核：审批人不能与申请人相同')
      if (!pass) {
        await c.q('UPDATE entitlement_request SET status = 2, approver = ?, approve_note = ?, approved_at = NOW(3) WHERE id = ?', ['admin:' + a.name, note, r.id])
        await audit(c, 'admin:' + a.name, 'entitlement', 'reject', 'eq-' + r.id, { status: 0 }, { status: 2, note })
        return { rejected: true }
      }
      // 执行前重验（余额/徽章持有），失败则整体回滚，申请保持待审
      let execResult = ''
      if (r.kind === 'bean_grant') {
        const budget = await c.one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
        if (!budget) throw new BizError(5002, '缺少可用旅豆预算批次，不能执行补发；请先在「旅豆预算」启用批次')
        await bean.grant(Number(r.user_id), Number(r.amount), bean.BIZ.RISK, r.req_no, budget.id, c)
        execResult = `旅豆 +${r.amount}（账本业务号 ${r.req_no}）`
      } else if (r.kind === 'bean_deduct') {
        const bal = await c.one('SELECT balance FROM bean_account WHERE user_id = ?', [r.user_id])
        if (!bal || Number(bal.balance) < Number(r.amount)) throw new BizError(1001, `余额不足以扣回（当前 ${bal ? Number(bal.balance) : 0}），请驳回或降低金额`)
        await bean.deduct(Number(r.user_id), Number(r.amount), bean.BIZ.RISK, r.req_no, c)
        execResult = `旅豆 -${r.amount}（账本业务号 ${r.req_no}）`
      } else if (r.kind === 'growth_fix') {
        // member.addGrowth 用全局连接不支持事务内调用——在事务内等价实现（等级重算 + 成长记录）
        const prof = await c.one('SELECT member_level, growth_value FROM user_account WHERE id = ?', [r.user_id])
        const growth = Number(prof.growth_value) + Number(r.amount)
        if (growth < 0) throw new BizError(1001, '更正后成长值为负，请驳回')
        const lvs = await member.levels()
        const to = member.levelFor(lvs, growth)
        await c.q('UPDATE user_account SET growth_value = ?, member_level = ? WHERE id = ?', [growth, to, r.user_id])
        await c.q('INSERT INTO user_growth_log (user_id, delta, biz_type, biz_ref, after_val) VALUES (?,?,?,?,?)', [r.user_id, Number(r.amount), 9, r.req_no, growth])
        execResult = `成长值 ${r.amount > 0 ? '+' : ''}${r.amount}（当前 ${growth}${Number(prof.member_level) !== to ? '，等级 ' + prof.member_level + '→' + to : ''}）`
      } else if (r.kind === 'badge_grant') {
        const b = await c.one('SELECT * FROM badge WHERE id = ?', [r.badge_id])
        if (!b) throw new BizError(1004, '徽章定义不存在')
        if (await c.one('SELECT 1 x FROM user_badge WHERE user_id = ? AND badge_id = ?', [r.user_id, b.id])) throw new BizError(1001, '该用户已拥有此勋章，补发被幂等拒绝；请驳回本申请')
        const max = Number((b.profile && (b.profile.max_issue ?? JSON.parse(b.profile || '{}').max_issue))) || 0
        if (max > 0) {
          const n = await c.one('SELECT COUNT(*) n FROM user_badge WHERE badge_id = ?', [b.id])
          if (Number(n.n) >= max) throw new BizError(1001, `「${b.name}」已达发行上限 ${max} 枚，不能补发`)
        }
        await c.q('INSERT INTO user_badge (user_id, badge_id, ref) VALUES (?,?,?)', [r.user_id, b.id, String('admin:' + a.name + '（权益申请 ' + r.req_no + '）').slice(0, 48)])
        await attest('badge', 'badge-' + r.user_id + '-' + b.id, {
          userId: Number(r.user_id), badgeId: Number(b.id), badge: b.name,
          by: 'admin:' + a.name + '（权益申请 ' + r.req_no + '）', reason: r.reason || null,
        }, c, 1)
        execResult = `勋章「${b.name}」已补发并入存证队列`
      } else {
        const ub = await c.one('SELECT badge_id FROM user_badge WHERE user_id = ? AND badge_id = ?', [r.user_id, r.badge_id])
        if (!ub) throw new BizError(1001, '该用户未持有此勋章，无法撤回')
        // user_badge 是复合主键（user_id, badge_id），无自增 id 列
        await c.q('DELETE FROM user_badge WHERE user_id = ? AND badge_id = ?', [r.user_id, r.badge_id])
        execResult = '勋章已撤回（存证历史不删改，撤回为新增事实并留审计）'
      }
      await c.q('UPDATE entitlement_request SET status = 1, approver = ?, approve_note = ?, exec_result = ?, approved_at = NOW(3) WHERE id = ?', ['admin:' + a.name, note, execResult, r.id])
      await audit(c, 'admin:' + a.name, 'entitlement', 'approve', 'eq-' + r.id, { status: 0 }, { status: 1, reqNo: r.req_no, kind: r.kind, amount: r.amount, execResult, note })
      return { approved: true, execResult }
    })
  },
}
