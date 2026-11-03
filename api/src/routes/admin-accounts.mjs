// T02（批次 B）：后台账号与城市授权生命周期。
// 仅超管可操作；不下发密码哈希 / MFA 密钥；停用、改角色、改城市、重置密码都会使已登录会话立即失效（token_epoch）。
// 红线：不打印密码明文进审计/日志；重置的临时密码只在本次响应返回一次。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { hashPassword, verifyPassword } from '../auth.mjs'
import crypto from 'node:crypto'

// 可分配角色（sre/dev 是历史遗留系统角色，不在授权矩阵开放新建）
export const ACCOUNT_ROLES = ['super', 'ops', 'finance', 'review', 'risk', 'city_partner', 'readonly']
const ROLE_CN = { super: '超级管理员', ops: '运营管理员', finance: '财务管理员', review: '审核管理员', risk: '风控管理员', city_partner: '城市合伙人', readonly: '只读账号' }

const activeSuperCount = async () => Number((await one("SELECT COUNT(*) n FROM admin_user WHERE role = 'super' AND status = 1")).n)

// 随机临时密码：12 位无歧义字符（不进审计/日志，仅在响应中返回一次）
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(12)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

const adminAccounts = {
  'GET /admin/accounts': async (req) => {
    await requireAdmin(req, ['super'])
    // 不下发 password_hash / mfa_secret（红线：密钥哈希不出接口）
    return await q(`SELECT id, username, display_name, role, scope_city, status, note, mfa_enabled, mfa_channel,
        mobile, email, last_login_at, token_epoch, must_change_pwd, created_at
      FROM admin_user ORDER BY FIELD(role, 'super', 'ops', 'finance', 'review', 'risk', 'city_partner', 'readonly'), id`)
  },

  // 创建账号：登录名唯一；城市合伙人必填城市；初始密码 ≥8 位；创建即写入审计（不含密码）
  'POST /admin/accounts': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { username, displayName, role, scopeCity, password, note } = req.body || {}
    const name = String(username || '').trim()
    if (!/^[\w-]{3,32}$/.test(name)) throw new BizError(1001, '登录名需 3–32 位字母、数字、下划线或 -')
    if (!ACCOUNT_ROLES.includes(role)) throw new BizError(1001, '角色无效')
    const display = String(displayName || '').trim()
    if (!display || display.length > 64) throw new BizError(1001, '请填写 1–64 字显示名')
    const city = role === 'city_partner' ? String(scopeCity || '').trim() : null
    if (role === 'city_partner' && !/^\d{4,8}$/.test(city || '')) throw new BizError(1001, '城市合伙人必须绑定城市编码')
    if (String(password || '').length < 8 || String(password).length > 64) throw new BizError(1001, '初始密码需 8–64 位')
    if (await one('SELECT id FROM admin_user WHERE username = ?', [name])) throw new BizError(1001, '登录名已存在')
    const id = await tx(async (c) => {
      const rid = await c.ins('INSERT INTO admin_user (username, display_name, password_hash, role, scope_city, status, note, token_epoch) VALUES (?,?,?,?,?,1,?,1)',
        [name, display, hashPassword(String(password)), role, city, String(note || '').trim() || null])
      await audit(c, 'admin:' + a.name, 'account', 'create', 'admin-' + rid, null, { username: name, role, scopeCity: city || null, note: String(note || '').trim() || null })
      return rid
    })
    return { id }
  },

  // 展示资料（显示名 / 备注）
  'PUT /admin/accounts/:id': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const display = String(req.body.displayName || '').trim()
    const note = String(req.body.note || '').trim() || null
    if (!display || display.length > 64) throw new BizError(1001, '请填写 1–64 字显示名')
    const u = await one('SELECT id, display_name, note FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    await tx(async (c) => {
      await c.q('UPDATE admin_user SET display_name = ?, note = ? WHERE id = ?', [display, note, u.id])
      await audit(c, 'admin:' + a.name, 'account', 'update-profile', 'admin-' + u.id, { displayName: u.display_name, note: u.note }, { displayName: display, note })
    })
    return { updated: true }
  },

  // 改角色 / 城市：原因必填；已登录会话立即失效；最后一个有效超管不可降级；不能改自己
  'POST /admin/accounts/:id/role': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { role, scopeCity, reason } = req.body || {}
    const why = String(reason || '').trim()
    if (why.length < 4 || why.length > 200) throw new BizError(1001, '请填写 4–200 字变更原因（进入审计）')
    if (!ACCOUNT_ROLES.includes(role)) throw new BizError(1001, '角色无效')
    const city = role === 'city_partner' ? String(scopeCity || '').trim() : null
    if (role === 'city_partner' && !/^\d{4,8}$/.test(city || '')) throw new BizError(1001, '城市合伙人必须绑定城市编码')
    const u = await one('SELECT id, username, role, scope_city, status FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    if (Number(u.id) === Number(a.uid)) throw new BizError(1001, '不能修改自己的角色/城市：请由另一位超级管理员操作')
    if (u.role === 'super' && u.role !== role && (await activeSuperCount()) <= 1) throw new BizError(1001, '不能降级最后一个有效超级管理员')
    await tx(async (c) => {
      await c.q('UPDATE admin_user SET role = ?, scope_city = ?, token_epoch = token_epoch + 1 WHERE id = ?', [role, city, u.id])
      await audit(c, 'admin:' + a.name, 'account', 'change-role', 'admin-' + u.id,
        { role: u.role, scopeCity: u.scope_city }, { role, scopeCity: city || null, reason: why, sessionsRevoked: true })
    })
    return { updated: true, role, scopeCity: city || null, sessionsRevoked: true }
  },

  // 停用 / 恢复：停用后全部会话立即拒绝；恢复同样 +1 epoch（恢复需新登录）；最后超管保护；不能停用自己
  'POST /admin/accounts/:id/status': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const st = Number(req.body.status)
    const why = String(req.body.reason || '').trim()
    if (![0, 1].includes(st)) throw new BizError(1001, '状态只能是停用或恢复')
    if (st === 0 && (why.length < 4 || why.length > 200)) throw new BizError(1001, '停用需要填写 4–200 字原因')
    const u = await one('SELECT id, username, role, status FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    if (Number(u.id) === Number(a.uid)) throw new BizError(1001, '不能停用/恢复自己的账号')
    if (st === 0 && u.role === 'super' && (await activeSuperCount()) <= 1) throw new BizError(1001, '不能停用最后一个有效超级管理员')
    await tx(async (c) => {
      await c.q('UPDATE admin_user SET status = ?, token_epoch = token_epoch + 1 WHERE id = ?', [st, u.id])
      await audit(c, 'admin:' + a.name, 'account', st === 0 ? 'disable' : 'enable', 'admin-' + u.id, { status: Number(u.status) }, { status: st, reason: why || null, sessionsRevoked: true })
    })
    return { status: st, sessionsRevoked: true }
  },

  // 重置密码：生成随机临时密码，本次响应返回一次；全部会话失效；置 must_change_pwd；审计不含明文
  'POST /admin/accounts/:id/password-reset': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const u = await one('SELECT id, username FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    if (Number(u.id) === Number(a.uid)) throw new BizError(1001, '不能重置自己的密码：请用「修改密码」')
    const temp = tempPassword()
    await tx(async (c) => {
      await c.q('UPDATE admin_user SET password_hash = ?, must_change_pwd = 1, token_epoch = token_epoch + 1 WHERE id = ?', [hashPassword(temp), u.id])
      await audit(c, 'admin:' + a.name, 'account', 'password-reset', 'admin-' + u.id, null, { operator: 'admin:' + a.name, sessionsRevoked: true, mustChangePwd: true })
    })
    return { tempPassword: temp, note: '临时密码仅此一次显示，请线下安全渠道交付本人；本人下次登录后须立即修改。审计不记录密码。' }
  },

  // 重置 MFA：清除绑定（重置后按全局策略重新绑定）；全部会话失效
  'POST /admin/accounts/:id/mfa-reset': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const u = await one('SELECT id, username, mfa_enabled FROM admin_user WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1004, '账号不存在')
    await tx(async (c) => {
      await c.q("UPDATE admin_user SET mfa_enabled = 0, mfa_secret = NULL, mfa_channel = 'totp', token_epoch = token_epoch + 1 WHERE id = ?", [u.id])
      await audit(c, 'admin:' + a.name, 'account', 'mfa-reset', 'admin-' + u.id, { mfaEnabled: Number(u.mfa_enabled) }, { mfaEnabled: 0, sessionsRevoked: true })
    })
    return { reset: true }
  },

  // 本人改密：验旧密码，清 must_change_pwd；改完需重新登录（epoch+1 使旧会话失效）
  'POST /admin/account/password': async (req) => {
    const a = await requireAdmin(req)
    if (a.uid == null) throw new BizError(1002, '请重新登录后再修改密码')
    const { oldPassword, newPassword } = req.body || {}
    const u = await one('SELECT id, username, password_hash, must_change_pwd FROM admin_user WHERE id = ?', [a.uid])
    if (!u) throw new BizError(1004, '账号不存在')
    if (!u.password_hash || !verifyPassword(String(oldPassword || ''), u.password_hash)) throw new BizError(1001, '原密码不正确')
    if (String(newPassword || '').length < 8 || String(newPassword).length > 64) throw new BizError(1001, '新密码需 8–64 位')
    if (String(newPassword) === String(oldPassword)) throw new BizError(1001, '新密码不能与原密码相同')
    await tx(async (c) => {
      await c.q('UPDATE admin_user SET password_hash = ?, must_change_pwd = 0, token_epoch = token_epoch + 1 WHERE id = ?', [hashPassword(String(newPassword)), u.id])
      await audit(c, 'admin:' + a.name, 'account', 'password-change', 'admin-' + u.id, null, { self: true, mustChangePwd: Number(u.must_change_pwd) === 1 })
    })
    return { changed: true, reloginRequired: true }
  },
}

export { adminAccounts, ROLE_CN }
