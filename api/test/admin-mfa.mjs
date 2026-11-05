// 批次 B 回归：C-01/C-02/C-03 账号与 MFA 重设计 + U-02（隔离库，需服务在跑）
// 覆盖：全局三档 × 豁免/强制 × 绑定/未绑定登录矩阵、force>exempt 优先级、
//       登录受限态绑定引导（challenge 不能办业务、setup→verify→通行令牌）、
//       mfa-flags 接口（越权/最后超管保护/epoch 失效）、mfa-mode 敏感参数提案（不直接生效）、
//       U-02 must_change_pwd 接口层强制（未改密只能改密，改后重新登录）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-mfa.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (tok, method, path, body) => (await fetch(base + path, {
  method, headers: { authorization: tok ? 'Bearer ' + tok : '', 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const superTok = jwtSign({ end: 'admin', role: 'super', name: 'MFA回归-超管' })
const tok = (role) => jwtSign({ end: 'admin', role, name: 'MFA回归-' + role })
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'MFAQA' + Math.random().toString(36).slice(2, 8)
const made = { admins: [], audits: [], histories: [], codes: [] }
// admin.mfa.mode 可能不在 rule_config（回落代码默认 optional）：测试前保存原状，结束后精确恢复
const modeRowBefore = await one("SELECT v FROM rule_config WHERE k = 'admin.mfa.mode'").catch(() => null)
const setGlobalMode = async (mode) => {
  if (mode == null) { await q("DELETE FROM rule_config WHERE k = 'admin.mfa.mode'"); return }
  await q("INSERT INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES ('admin.mfa.mode', CAST(? AS JSON), 'security', 1, '后台多因素认证策略（测试夹具）') ON DUPLICATE KEY UPDATE v = CAST(? AS JSON)", [JSON.stringify(mode), JSON.stringify(mode)])
  // 服务侧 cfgAll() 每次强制重读，无需额外清缓存
}
const mkAdmin = async (role = 'ops') => {
  const name = 'mfaqa-' + stamp + '-' + Math.random().toString(36).slice(2, 6)
  const r = ok(await call(superTok, 'POST', '/admin/accounts', { username: name, displayName: name + '显示名', role, password: 'Mfaqa!' + stamp + 'A1', note: '回归夹具' }))
  made.audits.push('admin-' + r.id)
  return { id: r.id, username: name, password: 'Mfaqa!' + stamp + 'A1' }
}
const login = async (username, password) => call(null, 'POST', '/admin/login', { username, password })
try {
  await test('全局 optional（默认）：未绑定不要求 MFA；绑定后要求', async () => {
    const u = await mkAdmin()
    made.admins.push(u.id)
    const l1 = await login(u.username, u.password)
    assert.equal(l1.code, 0); assert.ok(l1.data.token, '未绑定直接登录')
    assert.ok(!l1.data.mfaRequired, 'optional 未绑定不要求')
    // 绑定 TOTP（超管代绑，真实场景走账号页「验证方式」或安全中心）
    const setup = ok(await call(superTok, 'POST', '/admin/security/mfa/setup', { userId: u.id }))
    made.codes.push(u.id)
    const l2 = await login(u.username, u.password)
    assert.equal(l2.data.mfaRequired, true, 'optional 已绑定要求两步验证')
    assert.ok(!l2.data.mfaSetupRequired, '已绑定不需要引导')
    assert.equal(l2.data.channel, 'totp')
    const l3 = ok(await call(null, 'POST', '/admin/login/mfa', { challenge: l2.data.challenge, code: setup.current }))
    assert.ok(l3.token, '动态码验证通过拿到达标会话')
  })

  await test('C-03 单账号强制：全局关闭/可选下仍要求；未绑定进入引导；challenge 不能办业务', async () => {
    const u = await mkAdmin()
    made.admins.push(u.id)
    const l0 = ok(await login(u.username, u.password))
    assert.ok(!l0.mfaRequired, '强制前正常登录')
    // 设强制：epoch+1 → 旧会话下一个请求失效
    ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { force: 1 }))
    const blocked = await call(l0.token, 'GET', '/admin/accounts')
    assert.equal(blocked.code, 1002, 'flags 变更后旧会话失效：' + blocked.msg)
    const l1 = await login(u.username, u.password)
    assert.equal(l1.data.mfaRequired, true, '单账号强制生效（全局 optional）')
    assert.equal(l1.data.mfaSetupRequired, true, '未绑定进入绑定引导')
    assert.equal(l1.data.channel, 'totp')
    // 受限临时凭证（end=mfa）不能调后台业务接口
    const biz = await call(l1.data.challenge, 'GET', '/admin/accounts')
    assert.equal(biz.code, 1002, 'challenge 不能办理业务：' + biz.msg)
    // 引导绑定 → 验证 → 通行令牌
    const setup = ok(await call(null, 'POST', '/admin/login/mfa/setup', { challenge: l1.data.challenge }))
    assert.ok(setup.secret && setup.uri, '引导 setup 返回密钥与 URI')
    const l2 = ok(await call(null, 'POST', '/admin/login/mfa', { challenge: l1.data.challenge, code: setup.current }))
    assert.ok(l2.token, '引导绑定后验证通过')
    const l3 = await login(u.username, u.password)
    assert.ok(!l3.data.mfaSetupRequired, '绑定后登录不再引导')
    ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { force: 0 }))
  })

  await test('C-03 豁免：全局强制下不要求；force 优先于 exempt', async () => {
    const u = await mkAdmin()
    made.admins.push(u.id)
    await setGlobalMode('required')
    try {
      const l1 = await login(u.username, u.password)
      assert.equal(l1.data.mfaRequired, true, '全局强制：未绑定要求')
      ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { exempt: 1 }))
      const l2 = await login(u.username, u.password)
      assert.ok(l2.data.token && !l2.data.mfaRequired, '豁免：全局强制下不要求')
      ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { force: 1 }))
      const l3 = await login(u.username, u.password)
      assert.equal(l3.data.mfaRequired, true, '同时设置时 force 优先于 exempt')
      ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { force: 0, exempt: 1 }))
    } finally {
      await setGlobalMode(modeRowBefore ? JSON.parse(modeRowBefore.v) : null)
    }
  })

  await test('C-03 接口边界：非超管拒绝；最后有效超管不能设强制；审计与 flags 读回', async () => {
    const u = await mkAdmin()
    made.admins.push(u.id)
    assert.equal((await call('x', 'POST', `/admin/accounts/${u.id}/mfa-flags`, { force: 1 })).code, 1002)
    const superId = Number((await one("SELECT id FROM admin_user WHERE username = 'admin'")).id)
    const nSuper = Number((await one("SELECT COUNT(*) n FROM admin_user WHERE role='super' AND status=1")).n)
    if (nSuper <= 1) {
      const r = await call(superTok, 'POST', `/admin/accounts/${superId}/mfa-flags`, { force: 1 })
      assert.equal(r.code, 1001, '最后有效超管不能设强制：' + r.msg)
    }
    ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/mfa-flags`, { exempt: 1 }))
    const row = await one('SELECT mfa_exempt, mfa_force FROM admin_user WHERE id = ?', [u.id])
    assert.equal(Number(row.mfa_exempt), 1)
    const auditRow = await one("SELECT id FROM audit_log WHERE module='account' AND action='mfa-flags' AND biz_ref = ?", ['admin-' + u.id])
    assert.ok(auditRow, 'mfa-flags 写审计')
  })

  await test('C-02：全局三档走敏感参数提案——校验取值、重复/待复核互斥、不直接生效', async () => {
    assert.equal((await call('x', 'POST', '/admin/security/mfa-mode', { mode: 'required' })).code, 1002, '非超管拒绝')
    assert.equal((await call(superTok, 'POST', '/admin/security/mfa-mode', { mode: 'bogus' })).code, 1001, '取值校验')
    assert.equal((await call(superTok, 'POST', '/admin/security/mfa-mode', { mode: 'optional' })).code, 2002, '与当前一致拒绝')
    const sub = ok(await call(superTok, 'POST', '/admin/security/mfa-mode', { mode: 'off', reason: stamp + ' 回归提案' }))
    assert.equal(sub.pendingReview, true, '提交后待复核')
    made.histories.push(sub.historyId)
    assert.equal((await call(superTok, 'POST', '/admin/security/mfa-mode', { mode: 'required' })).code, 2002, '已有待复核提案时互斥')
    const chn = ok(await call(superTok, 'GET', '/admin/security/channels'))
    assert.equal(chn.mode, 'optional', '提案未审批前全局策略不生效')
    assert.equal(chn.pendingReview.newValue, 'off', 'channels 返回待复核提案')
    const modeBefore = await one("SELECT v FROM rule_config WHERE k='admin.mfa.mode'")
    assert.ok(!modeBefore || String(modeBefore.v).includes('optional'), 'rule_config 仍是旧值或未落行（未绕过复核）')
  })

  await test('M-03：通道状态五态字段齐全——未配置即 unconfigured，探针记录只含脱敏目标', async () => {
    const ch = ok(await call(superTok, 'GET', '/admin/security/channels'))
    for (const c of ['totp', 'sms', 'email']) {
      assert.ok(ch[c] && typeof ch[c].state === 'string', c + ' 有 state 字段')
      assert.ok(['unconfigured', 'mock', 'ready', 'verified', 'fault'].includes(ch[c].state), c + ' state 在五态内：' + ch[c].state)
    }
    assert.equal(ch.totp.state, 'verified', 'TOTP 无需外部凭据')
    if (ch.email && ch.email.lastProbe) {
      assert.ok(!/@[^@]*$/.test(ch.email.lastProbe.target_masked) || /\*/.test(ch.email.lastProbe.target_masked), '探针目标为脱敏值')
      assert.ok(!/[0-9]{6}/.test(ch.email.lastProbe.detail || ''), '探针摘要不含验证码')
    }
    const denied = await call(tok('finance'), 'GET', '/admin/security/channels')
    assert.equal(denied.code, 1003, '非授权角色不能读通道状态')
  })

  await test('U-02：must_change_pwd 接口层强制——未改密只能改密，改后重新登录', async () => {
    const u = await mkAdmin()
    made.admins.push(u.id)
    const rst = ok(await call(superTok, 'POST', `/admin/accounts/${u.id}/password-reset`))
    const l1 = await login(u.username, rst.tempPassword)
    assert.ok(l1.data.token, '临时密码可登录')
    assert.equal(l1.data.user.mustChangePassword, true)
    // 未改密：其他接口全部拒绝（不能只靠前端弹窗）
    const blocked1 = await call(l1.data.token, 'GET', '/admin/accounts')
    assert.equal(blocked1.code, 1002, '未改密不能调后台接口：' + blocked1.msg)
    const blocked2 = await call(l1.data.token, 'GET', '/admin/capabilities')
    assert.equal(blocked2.code, 1002, 'capabilities 也在限制内')
    // 改密（唯一放行接口）
    ok(await call(l1.data.token, 'POST', '/admin/account/password', { oldPassword: rst.tempPassword, newPassword: 'NewPwd!' + stamp + 'B2' }))
    const blocked3 = await call(l1.data.token, 'GET', '/admin/accounts')
    assert.equal(blocked3.code, 1002, '改密后旧会话仍失效（epoch+1），需重新登录')
    const l2 = await login(u.username, 'NewPwd!' + stamp + 'B2')
    assert.ok(l2.data.token && !l2.data.user.mustChangePassword, '新密码登录且不再要求改密')
    ok(await call(l2.data.token, 'GET', '/admin/capabilities'))
  })

  console.log(`\n${passed} 项批次 B（账号与 MFA 重设计 C-01/C-02/C-03 + U-02）回归通过`)
} finally {
  // 清夹具：账号、其审计、验证码、提案历史；admin.mfa.mode 精确恢复测试前状态（行存在则还原值，不存在则删行）
  for (const id of made.admins) {
    await q('DELETE FROM admin_user WHERE id = ?', [id]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='account' AND biz_ref = ?", ['admin-' + id]).catch(() => {})
  }
  for (const h of made.histories) await q("DELETE FROM config_history WHERE id = ?", [h]).catch(() => {})
  await q("DELETE FROM audit_log WHERE module='security' AND action='mfa-mode-proposal' AND proposer = 'admin:MFA回归-超管'").catch(() => {})
  await q("DELETE FROM mfa_code WHERE purpose IN ('login','bind-test')").catch(() => {})
  try {
    if (modeRowBefore) await q("UPDATE rule_config SET v = ? WHERE k = 'admin.mfa.mode'", [modeRowBefore.v])
    else await q("DELETE FROM rule_config WHERE k = 'admin.mfa.mode'")
  } catch { /* 恢复失败不掩盖测试结果 */ }
  await closeDb()
}
