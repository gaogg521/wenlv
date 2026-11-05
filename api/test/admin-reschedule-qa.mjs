// QA-01/QA-02 回归（Codex 复验场景）：改名/重名自批拒绝（不可变 UID + fail-closed）+ 并发执行恰好一次（账目判定）。
// 1) 同一 UID 改显示名后自批应拒绝（现状：名字不同即放行 → 复现绕过）
// 2) 同一申请并发 4 次执行应只成功一次（现状：全部成功、库存重复扣 → 复现竞态）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-reschedule-qa.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as bean from '../src/domain/bean.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 18095)
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const stamp = 'QP' + Math.random().toString(36).slice(2, 6)
const made = { users: [], orders: [], sessions: [] }
let failures = 0
try {
  // 建一个真实登录账号（有 uid）
  const uname = 'qarp-' + stamp
  await q("INSERT INTO admin_user (username, display_name, password_hash, role, status, token_epoch) VALUES (?,?,?,?,1,1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)",
    [uname, uname + '显示名', 'x', 'super'])
  const acct = await one('SELECT id FROM admin_user WHERE username = ?', [uname])
  const login = async (display) => {
    await q('UPDATE admin_user SET display_name = ? WHERE id = ?', [display, acct.id])
    const l = await call('POST', '/admin/login', { username: uname, password: 'admin123' })
    return l.code === 0 ? l.data.token : null
  }
  // 独立审批账号（不同 UID）
  await q("INSERT INTO admin_user (username, display_name, password_hash, role, status, token_epoch) VALUES (?,?,?,?,1,1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)", [uname + '-approver', uname + '-审批人', 'x', 'super'])
  await q('UPDATE admin_user SET password_hash = (SELECT password_hash FROM (SELECT password_hash FROM admin_user WHERE username = ?) t) WHERE username = ?', [uname, uname + '-approver']).catch(() => {})
  if (!(await login(uname + '显示名'))) {
    const { hashPassword } = await import('../src/auth.mjs')
    await q('UPDATE admin_user SET password_hash = ? WHERE id = ?', [hashPassword('admin123'), acct.id])
  }
  const T1 = await login(stamp + '申请人甲')
  // 独立审批账号（不同 UID）：QA-01 修复后同 UID 自批被拒，正常审批走这里
  const unameA = uname + '-approver'
  await q("INSERT INTO admin_user (username, display_name, password_hash, role, status, token_epoch) VALUES (?,?,?,?,1,1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)",
    [unameA, '审批乙', 'x', 'super'])
  const loginA = async () => {
    const l = await call('POST', '/admin/login', { username: unameA, password: 'admin123' })
    if (l.code === 0) return l.data.token
    const { hashPassword } = await import('../src/auth.mjs')
    const aid = await one('SELECT id FROM admin_user WHERE username = ?', [unameA])
    await q('UPDATE admin_user SET password_hash = ? WHERE id = ?', [hashPassword('admin123'), aid.id])
    return (await call('POST', '/admin/login', { username: unameA, password: 'admin123' })).data.token
  }
  const T3 = await loginA()

  const prod = await one('SELECT id, city_code FROM tour_product WHERE status=1 AND city_code IS NOT NULL ORDER BY id LIMIT 1')
  const merchant = await one('SELECT id FROM merchant WHERE status=1 ORDER BY id LIMIT 1')
  const buyer = (await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['qarp-' + stamp, stamp + '游客'])).insertId
  made.users.push(buyer)
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (budget) await bean.grant(buyer, 100000, bean.BIZ.REBATE, stamp + '-seed', budget.id).catch(() => {})
  const mkSession = async (price) => {
    for (let off = 300; off < 360; off++) {
      try { const id = (await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 20, 0, 1, ?, 1)', [prod.id, off, price])).insertId; made.sessions.push(id); return id }
      catch (e) { if (e && e.errno !== 1062) throw e }
    }
    throw new Error('no date slot')
  }
  const mkOrder = async (sessionId) => {
    const s = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sessionId])
    const p = Number(s.price_adult)
    const oid = (await q("INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name) VALUES (?,?,?,?,?,?,2,?,?,20,'QA')",
      ['WLQARP' + stamp + made.orders.length, buyer, prod.id, sessionId, prod.city_code, merchant.id, p * 2, p * 2])).insertId
    made.orders.push(oid)
    await q('UPDATE tour_session SET booked = booked + 2 WHERE id = ?', [sessionId])
    return oid
  }

  // ===== QA-01：改名自批 =====
  const s1 = await mkSession(10000), s2 = await mkSession(10000)
  const o1 = await mkOrder(s1)
  const apply = await call('POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s2, reason: stamp + ' 改名自批复现' }, T1)
  assert.equal(apply.code, 0, '申请应成功: ' + apply.msg)
  // 同名自批 → 应 1003
  const rSameName = await call('POST', `/admin/reschedules/${apply.data.id}/verdict`, { pass: true }, T1)
  assert.equal(rSameName.code, 1003, '同账号自批必须明确拒绝')
  console.log('同名自批:', rSameName.code, rSameName.msg)
  if (rSameName.code === 0) { console.log('  ✗ 意外：同名自批被放行？'); failures++ }
  // 改显示名后重新登录（同 UID）→ 自批
  const T2 = await login(stamp + '改名后审批')
  const rRenamed = await call('POST', `/admin/reschedules/${apply.data.id}/verdict`, { pass: true }, T2)
  assert.equal(rRenamed.code, 1003, '同UID改名后仍明确拒绝')
  console.log('同UID改名自批:', rRenamed.code, rRenamed.msg)
  if (rRenamed.code === 0) { failures++; console.log('  ✗ REPRODUCED QA-01：同 UID 改名自批被放行') }
  else console.log('  ✓ 已拒绝（可能已修复）')
  await q('UPDATE order_reschedule SET status = 4 WHERE id = ?', [apply.data.id]).catch(() => {})

  // ===== QA-02：并发执行 =====
  const s3 = await mkSession(10000), s4 = await mkSession(12000)
  const o2 = await mkOrder(s3)
  const balBefore = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [buyer]))?.balance || 0)
  const apply2 = await call('POST', `/admin/orders/${o2}/reschedule`, { toSessionId: s4, reason: stamp + ' 并发执行复现', diffBean: 2000 }, T1)
  assert.equal(apply2.code, 0, '第二次申请应成功: ' + apply2.msg)
  // 由另一账号（不同 UID）正常审批——同 UID 自批被拒是 QA-01 修复的预期行为
  const v = await call('POST', `/admin/reschedules/${apply2.data.id}/verdict`, { pass: true }, T3)
  if (v.code !== 0) { console.log('  前置：审批失败', v.code, v.msg); failures++ }
  // Codex 场景：原团在册充足（booked=10），执行后仍有余量 → 4 次并发都能过 booked>=qty 守卫
  await q('UPDATE tour_session SET booked = 10 WHERE id = ?', [s3])
  const before = await q('SELECT id, booked FROM tour_session WHERE id IN (?)', [[s3, s4]])
  const execs = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/admin/reschedules/${apply2.data.id}/execute`, null, T1)))
  // 幂等重入也返回 code=0（带 idempotent 标记）——真实执行次数以账目为准
  const execCount = execs.filter((e) => e.code === 0 && e.data && !e.data.idempotent).length
  const after = await q('SELECT id, booked FROM tour_session WHERE id IN (?)', [[s3, s4]])
  const b3b = Number(before.find((x) => Number(x.id) === s3).booked), b4b = Number(before.find((x) => Number(x.id) === s4).booked)
  const b3a = Number(after.find((x) => Number(x.id) === s3).booked), b4a = Number(after.find((x) => Number(x.id) === s4).booked)
  const balAfter = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [buyer]))?.balance || 0)
  const ord = await one('SELECT version, session_id, amount_pay FROM orders WHERE id = ?', [o2])
  assert.equal(Number(ord.amount_pay), 22000, '价差4000减旅豆2000只调账一次')
  assert.equal(execCount, 1, '必须恰好一次真实执行，其余幂等返回')
  const auditCount = Number((await one("SELECT COUNT(*) n FROM audit_log WHERE action='reschedule-execute' AND biz_ref=?", ['reschedule-' + apply2.data.id])).n)
  assert.equal(auditCount, 1, '执行审计恰好一条')
  const evCount = Number((await one('SELECT COUNT(*) n FROM order_event WHERE order_id = ? AND detail LIKE ?', [o2, '%改期换团：%' + s3 + '%'])).n)
  const ordVersion0 = 0 // 夹具新单 version 从 0 起
  console.log(`订单 version=${ord.version}（应+1）session=${ord.session_id}（应=${s4}）改期事件=${evCount}（应1）`)
  if (Number(ord.version) !== 1 || Number(ord.session_id) !== Number(s4) || evCount !== 1) { failures++; console.log('  ✗ 订单账目不一致') }
  console.log(`并发：实际执行 ${execCount}/4（幂等重入 ${4 - execCount}）；原团 ${b3b}→${b3a}（应-2），目标 ${b4b}→${b4a}（应+2）；旅豆变动 ${balBefore - balAfter}（应 2000）`)
  if (execCount > 1 || b3b - b3a !== 2 || b4a - b4b !== 2 || balBefore - balAfter !== 2000) { failures++; console.log('  ✗ REPRODUCED QA-02：并发重复执行') }
  else console.log('  ✓ 并发只执行一次')

  console.log(`\n${failures === 0 ? 'QA-01/QA-02 回归通过（改名自批拒绝 + 并发恰好一次）' : failures + ' 项缺陷仍在'}`)
  process.exitCode = failures > 0 ? 2 : 0
} finally {
  for (const o of made.orders) {
    const requests = await q('SELECT id FROM order_reschedule WHERE order_id=?', [o])
    for (const r of requests) await q("DELETE FROM audit_log WHERE module='order' AND biz_ref=?", ['reschedule-' + r.id])
    await q('DELETE FROM order_reschedule WHERE order_id=?', [o])
    await q('DELETE FROM order_event WHERE order_id = ?', [o]).catch(() => {})
    await q('DELETE FROM orders WHERE id = ?', [o]).catch(() => {})
  }
  await q('DELETE FROM bean_flow WHERE user_id IN (?)', [made.users]).catch(() => {})
  for (const s of made.sessions) await q('DELETE FROM tour_session WHERE id = ?', [s]).catch(() => {})
  if (made.users.length) {
    await q('DELETE FROM bean_account WHERE user_id IN (?)', [made.users]).catch(() => {})
    await q('DELETE FROM user_account WHERE id IN (?)', [made.users]).catch(() => {})
  }
  await q('DELETE FROM admin_user WHERE username LIKE ?', ['qarp-' + stamp + '%']).catch(() => {})
  await closeDb()
}
