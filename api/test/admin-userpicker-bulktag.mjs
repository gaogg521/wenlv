// 批次 F-4 回归：T08 用户选择器 + T05 批量打标签（隔离库，需服务在跑）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-userpicker-bulktag.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '选择器回归-' + role })]))
const call = async (role, method, path, body) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + tokens[role], 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'UPQA' + Math.random().toString(36).slice(2, 10)
const created = { users: [] }
try {
  const phone = '139' + String(Date.now()).slice(-8)
  const u1 = await q("INSERT INTO user_account (mini_a_openid, nickname, mobile_enc, mobile_hmac, status) SELECT ?, ?, mobile_enc, mobile_hmac, 1 FROM user_account WHERE id = (SELECT MIN(id) FROM user_account) LIMIT 1", ['upqa1-' + stamp, stamp + '张三'])
  created.users.push(u1.insertId)
  const u2 = await q("INSERT INTO user_account (mini_a_openid, nickname, status) VALUES (?, ?, 0)", ['upqa2-' + stamp, stamp + '李四冻结'])
  created.users.push(u2.insertId)
  // 给 u1 设置手机号（sealMobile 生成密文+盲索引，与 bindMobile 同一加密路径）
  const { sealMobile } = await import('../src/infra/mobile.mjs')
  const sealed = sealMobile(phone)
  await q('UPDATE user_account SET mobile_enc = ?, mobile_hmac = ? WHERE id = ?', [sealed.enc, sealed.hmac, u1.insertId])

  await test('T08 用户选择器：昵称/ID/手机号搜索；返回脱敏手机号与冻结/已有资格标记', async () => {
    const byNick = ok(await call('ops', 'GET', `/admin/user-picker?kw=${encodeURIComponent(stamp + '张三')}`))
    assert.equal(byNick.rows.length, 1)
    assert.equal(byNick.rows[0].nickname, stamp + '张三')
    assert.ok(byNick.rows[0].mobile.match(/^139\*\*\*\*\d{4}$/), '脱敏手机号：' + byNick.rows[0].mobile)
    assert.equal(byNick.rows[0].frozen, false)
    const byPhone = ok(await call('ops', 'GET', `/admin/user-picker?kw=${phone}`))
    assert.equal(byPhone.rows.length, 1)
    assert.ok(!JSON.stringify(byPhone).includes(phone), '响应不含完整手机号')
    const byFrozen = ok(await call('ops', 'GET', `/admin/user-picker?kw=${encodeURIComponent(stamp + '李四')}`))
    assert.equal(byFrozen.rows[0].frozen, true, '冻结标记')
    assert.equal((await call('review', 'GET', '/admin/user-picker?kw=x')).code, 1003, '审核无选择器')
    assert.equal((await call('city_partner', 'GET', '/admin/user-picker?kw=x')).code, 1003)
  })

  await test('T05 批量打标签：词表校验/逐笔结果（成功+已存在+不存在）/越权', async () => {
    assert.equal((await call('ops', 'POST', '/admin/users/bulk-tags', { userIds: [u1.insertId], tag: '词表外', note: 'x' })).code, 1001)
    assert.equal((await call('finance', 'POST', '/admin/users/bulk-tags', { userIds: [u1.insertId], tag: '高价值用户', note: 'x' })).code, 1003)
    const r = ok(await call('ops', 'POST', '/admin/users/bulk-tags', { userIds: [u1.insertId, u2.insertId, 999999], tag: '高价值用户', note: stamp + ' 批量打标' }))
    assert.equal(r.total, 3); assert.equal(r.ok, 2); assert.equal(r.fail, 1)
    const dup = ok(await call('ops', 'POST', '/admin/users/bulk-tags', { userIds: [u1.insertId], tag: '高价值用户', note: '重复打标' }))
    assert.equal(dup.results[0].ok, false); assert.equal(dup.results[0].reason, '已有该标签')
    const missing = ok(await call('ops', 'POST', '/admin/users/bulk-tags', { userIds: [999999], tag: '高价值用户', note: '不存在用户' }))
    assert.equal(missing.results[0].ok, false); assert.equal(missing.results[0].reason, '用户不存在')
    // 审计按 biz_ref 精确计数（避免跨次运行残留干扰）
    const auditLog = await one("SELECT COUNT(*) n FROM audit_log WHERE module = 'user' AND action = 'tag-add' AND biz_ref IN (?, ?)", ['user-' + u1.insertId, 'user-' + u2.insertId])
    assert.ok(Number(auditLog.n) >= 2, '批量打标留审计（u1+u2 各一条）：' + Number(auditLog.n))
  })

  console.log(`\n${passed} 项批次 F-4（T08 选择器 + T05 批量打标）回归通过`)
} finally {
  if (created.users.length) {
    for (const uid of created.users) {
      await q('DELETE FROM user_ops_tag WHERE user_id = ?', [uid]).catch(() => {})
      await q("DELETE FROM audit_log WHERE module = 'user' AND biz_ref = ?", ['user-' + uid]).catch(() => {})
    }
    await q('DELETE FROM user_account WHERE id IN (?)', [created.users]).catch(() => {})
  }
  await closeDb()
}
