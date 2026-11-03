// 批次 B 回归：T02 后台账号与城市授权生命周期（隔离库，需服务在跑）
// 覆盖：创建（城市必填/唯一/密码强度）、会话立即失效（改角色/改城市/停用/恢复/重置密码）、
//       最后超管保护、不能操作自己、临时密码一次性与强制改密、密钥哈希不下发、MFA 重置留痕。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-accounts.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '账号回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const login = async (username, password) => { const j = await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).json(); return { code: j.code, msg: j.msg, ...(j.data || {}) } }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'ACQA' + Date.now()
const createdIds = []
try {
  // 真实超管会话（带 uid+ver）：用于"不能操作自己"与最后超管保护的边界
  const seeded = await one("SELECT id, username FROM admin_user WHERE role = 'super' AND status = 1 ORDER BY id LIMIT 1")
  assert(seeded, '隔离库需要有效超管账号')
  const sup = await login(seeded.username, process.env.ADMIN_INIT_PASSWORD || 'admin123')
  assert.equal(sup.code, 0, '超管登录：' + sup.msg)
  assert.ok(sup.token && sup.user?.uid, '真实登录令牌应携带 uid+ver')
  const supTok = sup.token

  await test('能力与菜单：账号管理仅超管（capability + 接口双面）', async () => {
    assert.equal(ok(await call('super', 'GET', '/admin/capabilities')).actions['account.manage'].allowed, true)
    assert.equal(ok(await call('ops', 'GET', '/admin/capabilities')).actions['account.manage'].allowed, false)
    assert.equal((await call('ops', 'GET', '/admin/accounts')).code, 1003)
    assert.equal((await call('finance', 'GET', '/admin/accounts')).code, 1003)
    assert.equal((await call('city_partner', 'GET', '/admin/accounts')).code, 1003)
  })

  await test('创建校验：城市合伙人必绑城市、登录名唯一、密码强度；密钥哈希不下发', async () => {
    assert.equal((await call('super', 'POST', '/admin/accounts', { username: stamp + 'c1', displayName: '缺城市', role: 'city_partner', password: 'longenough1' })).code, 1001)
    assert.equal((await call('super', 'POST', '/admin/accounts', { username: stamp + 'c2', displayName: '弱密码', role: 'ops', password: '123' })).code, 1001)
    assert.equal((await call('super', 'POST', '/admin/accounts', { username: seeded.username, displayName: '重复登录名', role: 'ops', password: 'longenough1' })).code, 1001)
    const r = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'ops', displayName: '账号回归·运营', role: 'ops', password: 'TempPass2026', note: 'T02 夹具' }))
    createdIds.push(r.id)
    const list = JSON.stringify(ok(await call('super', 'GET', '/admin/accounts')))
    assert.ok(!list.includes('password_hash') && !list.includes('mfa_secret'), '列表不得含哈希/密钥字段')
    assert.ok(!list.includes('$2'), '不得出现哈希值')
  })

  await test('城市账号：只能看本城；改城后旧令牌立即失效，新登录生效', async () => {
    const c1 = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'c310118', displayName: '账号回归·青浦', role: 'city_partner', scopeCity: '310118', password: 'TempPass2026' }))
    createdIds.push(c1.id)
    const lg1 = await login(stamp + 'c310118', 'TempPass2026')
    assert.equal(lg1.code, 0, '登录应成功：' + JSON.stringify(lg1).slice(0, 200)); assert.equal(lg1.user.role, 'city_partner'); assert.equal(lg1.user.scopeCity, '310118')
    // 310118 有种子的商户与订单：全部必须是本城
    const merchants = ok(await call(null, 'GET', '/admin/merchants', null, lg1.token))
    assert.ok(merchants.length >= 1, '本城应有商户')
    assert.ok(merchants.every((m) => String(m.city_code) === '310118'), '城市账号只看本城商户')
    // 改城 → 旧令牌立即失效
    ok(await call('super', 'POST', `/admin/accounts/${c1.id}/role`, { role: 'city_partner', scopeCity: '320508', reason: '账号回归：调往姑苏' }))
    assert.equal((await call(null, 'GET', '/admin/merchants', null, lg1.token)).code, 1002, '改城后旧令牌拒绝')
    const lg2 = await login(stamp + 'c310118', 'TempPass2026')
    assert.equal(lg2.user.scopeCity, '320508')
    const merchants2 = ok(await call(null, 'GET', '/admin/merchants', null, lg2.token))
    assert.ok(merchants2.every((m) => String(m.city_code) === '320508'), '改城后只看新城')
  })

  await test('停用/恢复：旧会话即时拒绝；恢复后仍需新登录（epoch 不回退）', async () => {
    const r = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'ops2', displayName: '账号回归·运营', role: 'ops', password: 'TempPass2026' }))
    createdIds.push(r.id)
    const lg = await login(stamp + 'ops2', 'TempPass2026')
    assert.equal(lg.code, 0)
    assert.equal((await call('super', 'POST', `/admin/accounts/${r.id}/status`, { status: 0, reason: '' })).code, 1001, '停用缺原因拒绝')
    assert.equal((await call('super', 'POST', `/admin/accounts/${r.id}/status`, { status: 0, reason: '账号回归：停用会话失效验证' })).code, 0)
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg.token)).code, 1002, '停用后旧会话拒绝')
    assert.equal((await login(stamp + 'ops2', 'TempPass2026')).code, 1002, '停用后不能登录')
    ok(await call('super', 'POST', `/admin/accounts/${r.id}/status`, { status: 1 }))
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg.token)).code, 1002, '恢复后旧令牌仍失效（epoch 已两次递增）')
    assert.equal((await login(stamp + 'ops2', 'TempPass2026')).code, 0, '恢复后可重新登录')
  })

  await test('角色/城市变更原因必填；改角色后 UI 令牌失效（ver 校验）', async () => {
    const r = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'rv', displayName: '账号回归·审核', role: 'review', password: 'TempPass2026' }))
    createdIds.push(r.id)
    const lg = await login(stamp + 'rv', 'TempPass2026')
    assert.equal((await call('super', 'POST', `/admin/accounts/${r.id}/role`, { role: 'ops', reason: '' })).code, 1001, '原因必填')
    assert.equal((await call('super', 'POST', `/admin/accounts/${r.id}/role`, { role: 'city_partner', scopeCity: '', reason: '账号回归：改成城市' })).code, 1001, '城市合伙人必绑城市')
    ok(await call('super', 'POST', `/admin/accounts/${r.id}/role`, { role: 'ops', scopeCity: null, reason: '账号回归：审核转运营' }))
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg.token)).code, 1002, '改角色后旧令牌失效')
    const lg2 = await login(stamp + 'rv', 'TempPass2026')
    assert.equal(lg2.user.role, 'ops')
    assert.equal(ok(await call(null, 'GET', '/admin/capabilities', null, lg2.token)).role, 'ops', '变更后能力表一致')
  })

  await test('不能操作自己；最后一个有效超管不可停用/降级', async () => {
    const id = sup.user.uid
    assert.equal((await call(null, 'POST', `/admin/accounts/${id}/role`, { role: 'ops', reason: '尝试自我降级' }, supTok)).code, 1001, '不能改自己角色')
    assert.equal((await call(null, 'POST', `/admin/accounts/${id}/status`, { status: 0, reason: '尝试自停' }, supTok)).code, 1001, '不能停用自己')
    assert.equal((await call(null, 'POST', `/admin/accounts/${id}/password-reset`, null, supTok)).code, 1001, '不能重置自己密码')
    // 当前仅一个有效超管（seeded）时：夹具超管令牌停用/降级 seeded 都必须被拒
    const count1 = Number((await one("SELECT COUNT(*) n FROM admin_user WHERE role = 'super' AND status = 1")).n)
    assert.equal((await call('super', 'POST', `/admin/accounts/${seeded.id}/status`, { status: 0, reason: '最后超管保护测试' })).code, 1001)
    assert.equal((await call('super', 'POST', `/admin/accounts/${seeded.id}/role`, { role: 'ops', reason: '最后超管保护测试' })).code, 1001)
    // 有两个超管时可以降级/停用其中一个
    const s2 = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 's2', displayName: '账号回归·二超管', role: 'super', password: 'TempPass2026' }))
    createdIds.push(s2.id)
    assert.equal(Number((await one("SELECT COUNT(*) n FROM admin_user WHERE role = 'super' AND status = 1")).n), count1 + 1)
    ok(await call('super', 'POST', `/admin/accounts/${s2.id}/role`, { role: 'ops', reason: '双超管下调级安全' }))
    assert.equal(Number((await one("SELECT COUNT(*) n FROM admin_user WHERE role = 'super' AND status = 1")).n), count1)
  })

  await test('重置密码：临时密码一次性下发、审计不含明文、旧会话失效、强制改密闭环', async () => {
    const r = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'fin', displayName: '账号回归·财务', role: 'finance', password: 'FirstPass2026' }))
    createdIds.push(r.id)
    const lg1 = await login(stamp + 'fin', 'FirstPass2026')
    assert.equal(lg1.code, 0)
    const reset = ok(await call(null, 'POST', `/admin/accounts/${r.id}/password-reset`, null, supTok))
    assert.ok(/^[A-Za-z0-9]{12}$/.test(reset.tempPassword), '临时密码 12 位')
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg1.token)).code, 1002, '重置后旧会话失效')
    const log = await one("SELECT after_val FROM audit_log WHERE module = 'account' AND action = 'password-reset' AND biz_ref = ? ORDER BY id DESC LIMIT 1", ['admin-' + r.id])
    assert.ok(!JSON.stringify(log).includes(reset.tempPassword), '审计不得记录密码明文')
    const lg2 = await login(stamp + 'fin', reset.tempPassword)
    assert.equal(lg2.code, 0); assert.equal(lg2.user.mustChangePassword, true, '重置后登录必须改密')
    // 旧密码不能再用；新密码闭环
    assert.equal((await call(null, 'POST', '/admin/account/password', { oldPassword: reset.tempPassword, newPassword: reset.tempPassword }, lg2.token)).code, 1001, '新密码不能与临时密码相同')
    ok(await call(null, 'POST', '/admin/account/password', { oldPassword: reset.tempPassword, newPassword: 'NewPass2026x' }, lg2.token))
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg2.token)).code, 1002, '改密后旧会话失效')
    assert.equal((await login(stamp + 'fin', reset.tempPassword)).code, 1002, '临时密码作废')
    const lg3 = await login(stamp + 'fin', 'NewPass2026x')
    assert.equal(lg3.code, 0); assert.equal(lg3.user.mustChangePassword, false)
  })

  await test('MFA 重置留痕：绑定清除、会话失效、审计可查', async () => {
    const r = ok(await call('super', 'POST', '/admin/accounts', { username: stamp + 'mfa', displayName: '账号回归·MFA', role: 'ops', password: 'TempPass2026' }))
    createdIds.push(r.id)
    await q("UPDATE admin_user SET mfa_enabled = 1, mfa_channel = 'totp', mfa_secret = 'JBSWY3DPEHPK3PXP' WHERE id = ?", [r.id])
    const lg = await login(stamp + 'mfa', 'TempPass2026')
    ok(await call('super', 'POST', `/admin/accounts/${r.id}/mfa-reset`))
    const u = await one('SELECT mfa_enabled, mfa_secret FROM admin_user WHERE id = ?', [r.id])
    assert.equal(Number(u.mfa_enabled), 0); assert.equal(u.mfa_secret, null)
    assert.equal((await call(null, 'GET', '/admin/dash/kpi', null, lg.token)).code, 1002, 'MFA 重置后会话失效')
    const log = await one("SELECT action FROM audit_log WHERE module = 'account' AND action = 'mfa-reset' AND biz_ref = ?", ['admin-' + r.id])
    assert(log, 'MFA 重置写审计')
  })

  console.log(`\n${passed} 项批次 B（T02 账号生命周期）回归通过`)
} finally {
  if (createdIds.length) {
    await q('DELETE FROM admin_user WHERE id IN (?)', [createdIds])
    await q("DELETE FROM audit_log WHERE module = 'account' AND biz_ref IN (?)", [createdIds.map((x) => 'admin-' + x)])
  }
  await closeDb()
}
