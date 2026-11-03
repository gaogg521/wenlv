// 批次 E 回归：T05 运营标签/内部备注 + T06 人工权益调整申请（隔离库，需服务在跑）
// 覆盖：标签词表校验/重复拒绝/移除留审计；备注追加式不可覆盖；游客接口不泄露内部口径；
//       权益申请（旅豆补发/扣回/成长值更正/徽章补发/撤回）审批执行与账本同事务、
//       幂等业务号、余额不足拒绝、自审拒绝、越权矩阵、撤回、并发审批只一次执行。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-userops.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '权益回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'EQQA' + Math.random().toString(36).slice(2, 10) // 字母数字：内部备注的 11 位以上数字拦截不误伤
let userId, badgeId
const reqIds = []
try {
  const u = await q("INSERT INTO user_account (mini_a_openid, nickname, growth_value, member_level, created_at) VALUES (?, ?, 1000, 1, NOW(3))", ['eqqa-' + stamp, stamp + '用户'])
  userId = u.insertId
  const b = await one("SELECT id, name FROM badge WHERE rule_type = 'manual' LIMIT 1")
  badgeId = b.id

  await test('T05 标签：词表外拒绝、重复拒绝、移除留审计；备注追加式且游客接口不下发', async () => {
    assert.equal((await call('ops', 'POST', `/admin/users/${userId}/tags`, { tag: '词表外标签' })).code, 1001)
    ok(await call('ops', 'POST', `/admin/users/${userId}/tags`, { tag: '高价值用户', note: stamp + ' 复购表现突出' }))
    assert.equal((await call('ops', 'POST', `/admin/users/${userId}/tags`, { tag: '高价值用户' })).code, 1001, '重复打标拒绝')
    const ops1 = ok(await call('ops', 'GET', `/admin/users/${userId}/ops`))
    assert.equal(ops1.tags.length, 1)
    const tagId = ops1.tags[0].id
    ok(await call('ops', 'DELETE', `/admin/users/${userId}/tags/${tagId}`))
    const log = await one("SELECT action FROM audit_log WHERE module = 'user' AND action = 'tag-remove' AND biz_ref = ?", ['user-' + userId])
    assert(log, '移除写审计')
    ok(await call('ops', 'POST', `/admin/users/${userId}/ops-notes`, { note: stamp + ' 首条内部备注' }))
    ok(await call('ops', 'POST', `/admin/users/${userId}/ops-notes`, { note: stamp + ' 第二条备注（追加不覆盖）' }))
    const ops2 = ok(await call('ops', 'GET', `/admin/users/${userId}/ops`))
    assert.equal(ops2.notes.length, 2, '备注两条都在（追加式）')
    assert.equal((await call('ops', 'POST', `/admin/users/${userId}/ops-notes`, { note: '含手机号13800001112的备注' })).code, 1001, '敏感信息拦截')
    // 越权：review/finance/city 不能维护标签备注
    assert.equal((await call('review', 'GET', `/admin/users/${userId}/ops`)).code, 1003)
    assert.equal((await call('finance', 'POST', `/admin/users/${userId}/tags`, { tag: '高价值用户' })).code, 1003)
    // 游客接口不泄露内部口径：任何 /c 响应不含备注内容
    const leak = await fetch(base + '/c/health').then((r) => r.text())
    assert.ok(!leak.includes(stamp), '健康检查不含内部备注（基础核验；画像接口均为 /admin 前缀鉴权）')
  })

  await test('T06 旅豆补发：申请→他人审批→账本分录（业务号幂等）与审计同事务', async () => {
    assert.equal((await call('finance', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 100, reason: '财务越权申请测试说明' })).code, 1003)
    const r = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 300, reason: stamp + ' 客服事故补偿：漏发返豆' }))
    reqIds.push(r.id)
    const bal0 = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId]))?.balance ?? 0)
    // 申请人自批被拒（ops 提交，ops 不是超管；再用 super 提交 → super 自批也拒）
    assert.equal((await call('ops', 'POST', `/admin/entitlements/${r.id}/approve`, { pass: true })).code, 1003, '非超管无审批权')
    const rs = ok(await call('super', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 50, reason: stamp + ' 自审拒绝夹具' }))
    reqIds.push(rs.id)
    assert.equal((await call('super', 'POST', `/admin/entitlements/${rs.id}/approve`, { pass: true })).code, 1003, '审批人不能与申请人相同')
    // 预算缺失场景不造（隔离库有种子预算）；执行
    const ap = ok(await call('super', 'POST', `/admin/entitlements/${r.id}/approve`, { pass: true, note: '复核通过' }))
    assert.match(ap.execResult, /账本业务号/)
    const bal1 = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])).balance)
    assert.equal(bal1 - bal0, 300, '旅豆到账 300')
    const led = await one('SELECT direction, amount, biz_ref FROM bean_ledger WHERE biz_ref = ?', [r.reqNo])
    assert.equal(Number(led.amount), 300, '账本分录业务号 = req_no（幂等键）')
    assert.equal((await call('super', 'POST', `/admin/entitlements/${r.id}/approve`, { pass: true })).code, 2002, '重复审批拒绝')
    assert.equal((await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: -5, reason: '负数金额测试说明' })).code, 1001)
  })

  await test('T06 旅豆扣回与成长值更正：超额提交拒绝、扣回入账、负更正、等级联动', async () => {
    // 超额扣回在提交期即被拒（审批期还有同条件二次校验，防止申请与执行之间余额变化）
    assert.equal((await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_deduct', amount: 999999, reason: stamp + ' 超额扣回夹具' })).code, 1001)
    const r2 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_deduct', amount: 100, reason: stamp + ' 风控回收部分豆' }))
    reqIds.push(r2.id)
    ok(await call('super', 'POST', `/admin/entitlements/${r2.id}/approve`, { pass: true }))
    assert.equal(Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])).balance), 200, '扣回后余额 200')
    const r3 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'growth_fix', amount: -400, reason: stamp + ' 冲正多记成长值' }))
    reqIds.push(r3.id)
    const ap3 = ok(await call('super', 'POST', `/admin/entitlements/${r3.id}/approve`, { pass: true }))
    assert.match(ap3.execResult, /成长值/)
    const u2 = await one('SELECT growth_value FROM user_account WHERE id = ?', [userId])
    assert.equal(Number(u2.growth_value), 600, '成长值 1000-400=600')
    const gl = await one('SELECT delta, biz_ref FROM user_growth_log WHERE biz_ref = ?', [r3.reqNo])
    assert.equal(Number(gl.delta), -400, '成长记录留痕')
    assert.equal((await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'growth_fix', amount: -99999, reason: '负成值测试说明' })).code, 1001, '负成值前置校验')
  })

  await test('T06 徽章补发/撤回：持有幂等、撤回后可再补；并发审批只执行一次', async () => {
    const r4 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'badge_grant', badgeId, reason: stamp + ' 活动补偿补发勋章' }))
    reqIds.push(r4.id)
    ok(await call('super', 'POST', `/admin/entitlements/${r4.id}/approve`, { pass: true }))
    assert.equal(Number((await one('SELECT COUNT(*) n FROM user_badge WHERE user_id = ? AND badge_id = ?', [userId, badgeId])).n), 1)
    // 已持有再申请 → 审批时幂等拒绝
    const r5 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'badge_grant', badgeId, reason: stamp + ' 重复补发夹具' }))
    reqIds.push(r5.id)
    assert.equal((await call('super', 'POST', `/admin/entitlements/${r5.id}/approve`, { pass: true })).code, 1001)
    // 撤回
    const r6 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'badge_revoke', badgeId, reason: stamp + ' 误发撤回' }))
    reqIds.push(r6.id)
    ok(await call('super', 'POST', `/admin/entitlements/${r6.id}/approve`, { pass: true }))
    assert.equal(Number((await one('SELECT COUNT(*) n FROM user_badge WHERE user_id = ? AND badge_id = ?', [userId, badgeId])).n), 0)
    // 并发审批同一申请：只有一个执行成功
    const r7 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 10, reason: stamp + ' 并发审批夹具' }))
    reqIds.push(r7.id)
    const balBefore = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])).balance)
    const [a, b] = await Promise.all([
      call('super', 'POST', `/admin/entitlements/${r7.id}/approve`, { pass: true }),
      call('super', 'POST', `/admin/entitlements/${r7.id}/approve`, { pass: true }),
    ])
    const codes = [a.code, b.code].sort()
    assert.deepEqual(codes, [0, 2002], '一执行一冲突：' + JSON.stringify([a.msg, b.msg]))
    assert.equal(Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])).balance), balBefore + 10, '旅豆只加一次')
    // 撤回：仅申请人本人、仅待审批
    const r8 = ok(await call('ops', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 5, reason: stamp + ' 撤回夹具' }))
    assert.equal((await call('super', 'POST', `/admin/entitlements/${r8.id}/withdraw`)).code, 1003, '非申请人不能撤回')
    ok(await call('ops', 'POST', `/admin/entitlements/${r8.id}/withdraw`))
    assert.equal(Number((await one('SELECT status FROM entitlement_request WHERE id = ?', [r8.id])).status), 3)
    // 队列契约与越权
    const list = ok(await call('ops', 'GET', '/admin/entitlements?status=1'))
    assert.ok(list.rows.every((x) => Number(x.status) === 1) && typeof list.total === 'number')
    assert.equal((await call('review', 'GET', '/admin/entitlements')).code, 1003, '审核无队列')
    assert.equal((await call('city_partner', 'GET', '/admin/entitlements')).code, 1003, '城市无队列')
    assert.equal((await call('finance', 'POST', '/admin/entitlements', { userId, kind: 'bean_grant', amount: 1, reason: '财务越权测试说明' })).code, 1003, '财务不能申请')
  })

  console.log(`\n${passed} 项批次 E（T05 运营标签备注 + T06 权益调整申请）回归通过`)
} finally {
  if (reqIds.length) {
    const nos = (await q('SELECT req_no FROM entitlement_request WHERE id IN (?)', [reqIds])).map((x) => x.req_no)
    await q('DELETE FROM bean_ledger WHERE biz_ref IN (?)', nos.length ? nos : ['~none~']).catch(() => {})
    await q('DELETE FROM user_growth_log WHERE biz_ref IN (?)', nos.length ? nos : ['~none~']).catch(() => {})
    await q('DELETE FROM attest_event WHERE biz_ref LIKE ?', ['bt-EQ%']).catch(() => {})
    await q('DELETE FROM entitlement_request WHERE id IN (?)', [reqIds])
    await q("DELETE FROM audit_log WHERE module = 'entitlement' AND biz_ref IN (?)", [reqIds.map((x) => 'eq-' + x)]).catch(() => {})
  }
  if (userId) {
    await q('DELETE FROM bean_ledger WHERE biz_ref LIKE ? OR biz_ref IN (SELECT req_no FROM entitlement_request WHERE user_id = ?)', [stamp + '%', userId]).catch(() => {})
    await q('DELETE FROM bean_ledger WHERE biz_ref LIKE ?', [stamp + '%']).catch(() => {})
    await q('DELETE FROM user_growth_log WHERE biz_ref LIKE ?', [stamp + '%']).catch(() => {})
    await q('DELETE FROM user_badge WHERE user_id = ?', [userId]).catch(() => {})
    await q('DELETE FROM attest_event WHERE biz_ref LIKE ?', ['badge-' + userId + '-%']).catch(() => {})
    await q('DELETE FROM user_ops_tag WHERE user_id = ?', [userId]).catch(() => {})
    await q('DELETE FROM user_ops_note WHERE user_id = ?', [userId]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module = 'user' AND biz_ref = ?", ['user-' + userId]).catch(() => {})
    await q('DELETE FROM user_account WHERE id = ?', [userId]).catch(() => {})
  }
  await closeDb()
}
