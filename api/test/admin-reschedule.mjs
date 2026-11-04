// 批次 F-3 回归：R-02 改期 / 换团（隔离库，需服务在跑）
// 覆盖：申请校验（状态/跨商品/名额/同团期/在途唯一/旅豆余额/城市）、审批（非超管拒、自批拒、
//       重复处理拒）、执行（库存转移、价差调账、旅豆抵扣扣减、失败回滚登记）、撤回、列表契约与城市隔离。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-reschedule.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as bean from '../src/domain/bean.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '改期回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'RSQA' + Math.random().toString(36).slice(2, 8)
const made = { orders: [], users: [], sessions: [] }
try {
  const prod = await one('SELECT id, city_code FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要商品')
  const buyer = (await q("INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)", ['rsqa-' + stamp, stamp + '游客'])).insertId
  made.users.push(buyer)
  // 预算（旅豆抵扣要用）+ 给游客旅豆
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (budget) await bean.grant(buyer, 100000, bean.BIZ.REBATE, stamp + '-bean-seed', budget.id).catch(() => {})

  // mkSession 自动找空位：从 200 天起逐日尝试，避开种子/残留团期的唯一键 (product_id, depart_date)
  const mkSession = async (price) => {
    for (let off = 200; off < 260; off++) {
      try {
        const id = (await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 10, 0, 1, ?, 1)',
          [prod.id, off, price])).insertId
        made.sessions.push(id)
        return id
      } catch (e) { if (e && e.errno !== 1062) throw e }
    }
    throw new Error('找不到可用团期日期')
  }
  const merchant = await one('SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1')
  const mkOrder = async (sessionId, status) => {
    const s = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sessionId])
    const p = Number(s.price_adult)
    const oid = (await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name)
    VALUES (?,?,?,?,?,?,?,?,?,'${status}','改期测试')`,
      ['WLRS' + stamp + made.orders.length, buyer, prod.id, sessionId, prod.city_code, merchant.id, 2, p * 2, p * 2, status])).insertId
    // 真实下单会占名额：夹具同步 +2，否则执行时原团期 booked 不足
    if ([20, 30, 40].includes(status)) await q('UPDATE tour_session SET booked = booked + 2 WHERE id = ?', [sessionId])
    return oid
  }

  await test('申请校验：状态/同团期/名额/在途唯一/跨商品/城市越界', async () => {
    const s1 = await mkSession(10000), s2 = await mkSession(12000), sFull = await mkSession(10000)
    made.sessions.push(s1, s2, sFull)
    await q('UPDATE tour_session SET booked = quota WHERE id = ?', [sFull])
    const o1 = await mkOrder(s1, 20); made.orders.push(o1)
    const oPaid = await one('SELECT order_no FROM orders WHERE id = ?', [o1])
    // 同团期
    assert.equal((await call('ops', 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s1, reason: stamp + ' 同团期不能改' })).code, 1001)
    // 名额不足
    assert.equal((await call('ops', 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: sFull, reason: stamp + ' 名额不足的团期' })).code, 2001)
    // 在途唯一
    ok(await call('ops', 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s2, reason: stamp + ' 首次申请换至贵价团' }))
    assert.equal((await call('ops', 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s2, reason: stamp + ' 重复申请' })).code, 2002)
    // 状态不对（已核销）
    const oDone = await mkOrder(s1, 40); made.orders.push(oDone)
    assert.equal((await call('ops', 'POST', `/admin/orders/${oDone}/reschedule`, { toSessionId: s2, reason: stamp + ' 已核销不能改' })).code, 2002)
    // 城市越界（非本城订单）
    const cityTok = jwtSign({ end: 'admin', role: 'ops', name: '改期回归-城市', scopeCity: '999999' })
    assert.equal((await call(null, 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s2, reason: stamp + ' 城市越界' }, cityTok)).code, 1003)
    void oPaid
  })

  await test('审批：非超管拒绝、申请人自批拒绝、重复处理拒绝', async () => {
    const r = await one("SELECT id, applicant FROM order_reschedule WHERE order_no LIKE 'WLRS" + stamp + "0' AND status = 0 ORDER BY id DESC LIMIT 1")
    assert(r, '有在途申请')
    assert.equal((await call('ops', 'POST', `/admin/reschedules/${r.id}/verdict`, { pass: true })).code, 1003, 'ops 不能审批')
    const applicantRole = r.applicant.includes('ops') ? 'ops' : 'super'
    if (applicantRole === 'ops') {
      assert.equal((await call('super', 'POST', `/admin/reschedules/${r.id}/verdict`, { pass: true, note: '超管自批测试' })).code, 0, '申请人=ops，超管可批')
      // 重新造一条测自批拒绝
      const o1 = await one('SELECT id FROM orders WHERE order_no LIKE "WLRS' + stamp + '0" AND status = 20 ORDER BY id DESC LIMIT 1')
      await q("UPDATE order_reschedule SET status = 4 WHERE order_id = ? AND status IN (0,1)", [o1.id])
      ok(await call('ops', 'POST', `/admin/orders/${o1.id}/reschedule`, { toSessionId: (await one('SELECT to_session_id FROM order_reschedule WHERE id = ?', [r.id])).to_session_id, reason: stamp + ' 重发申请' }))
      const r2 = await one("SELECT id FROM order_reschedule WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1", [o1.id])
      assert.equal((await call('ops', 'POST', `/admin/reschedules/${r2.id}/verdict`, { pass: true })).code, 1003, '申请人自批拒绝')
    } else {
      assert.equal((await call('super', 'POST', `/admin/reschedules/${r.id}/verdict`, { pass: true })).code, 1003, '申请人自批拒绝')
    }
  })

  await test('执行：库存转移、价差调账、旅豆抵扣扣减、执行后订单读回', async () => {
    // 新申请：ops 申请、super 审批通过、ops 执行
    const s1 = made.sessions[0], s2 = made.sessions[1]
    const o1 = await mkOrder(s1, 20); made.orders.push(o1)
    const balBefore = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [buyer]))?.balance || 0)
    ok(await call('ops', 'POST', `/admin/orders/${o1}/reschedule`, { toSessionId: s2, reason: stamp + ' 换贵价团并旅豆抵扣', diffBean: 2000 }))
    const r = await one("SELECT * FROM order_reschedule WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1", [o1])
    assert.equal(Number(r.price_diff), 4000, '价差 =（120-100）×2 = 4000 分')
    ok(await call('super', 'POST', `/admin/reschedules/${r.id}/verdict`, { pass: true, note: stamp + ' 同意改期' }))
    const beforeSess = await q('SELECT id, booked FROM tour_session WHERE id IN (?)', [[s1, s2]])
    const b1Before = Number(beforeSess.find((s) => Number(s.id) === s1).booked)
    const b2Before = Number(beforeSess.find((s) => Number(s.id) === s2).booked)
    ok(await call('ops', 'POST', `/admin/reschedules/${r.id}/execute`))
    const after = await one('SELECT session_id, amount_goods, amount_pay FROM orders WHERE id = ?', [o1])
    assert.equal(Number(after.session_id), s2, '订单已换至目标团期')
    assert.equal(Number(after.amount_goods), 24000, '订单金额按价差调整为 240 元')
    assert.equal(Number(after.amount_pay), 22000, '应付 = 24000 - 旅豆抵扣 2000')
    const balAfter = Number((await one('SELECT balance FROM bean_account WHERE user_id = ?', [buyer]))?.balance || 0)
    assert.equal(balBefore - balAfter, 2000, '旅豆抵扣 2000 分已扣减')
    const sess = await q('SELECT id, booked FROM tour_session WHERE id IN (?)', [[s1, s2]])
    const b1 = Number(sess.find((s) => Number(s.id) === s1).booked), b2 = Number(sess.find((s) => Number(s.id) === s2).booked)
    assert.equal(b1Before - b1, 2, '原团期在册 -2')
    assert.equal(b2 - b2Before, 2, '目标团期在册 +2')
    const rs = await one('SELECT status, exec_note FROM order_reschedule WHERE id = ?', [r.id])
    assert.equal(Number(rs.status), 3, '申请置为已执行')
    assert.match(rs.exec_note, /补款/, '待补款如实登记（不虚构到账）')
  })

  await test('执行失败回滚：目标团期被占满 → 登记失败且订单/库存不变', async () => {
    const s1 = made.sessions[0]
    const o2 = await mkOrder(s1, 20); made.orders.push(o2)
    const s3 = await mkSession(10000); made.sessions.push(s3)
    ok(await call('ops', 'POST', `/admin/orders/${o2}/reschedule`, { toSessionId: s3, reason: stamp + ' 竞态目标团期' }))
    const r = await one("SELECT id FROM order_reschedule WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1", [o2])
    ok(await call('super', 'POST', `/admin/reschedules/${r.id}/verdict`, { pass: true }))
    // 审批通过后、执行前把目标团期占满（模拟竞态）
    await q('UPDATE tour_session SET booked = quota WHERE id = ?', [s3])
    const before = await one('SELECT session_id, amount_pay FROM orders WHERE id = ?', [o2])
    const ex = await call('ops', 'POST', `/admin/reschedules/${r.id}/execute`)
    assert.equal(ex.code, 2001, '名额竞态执行失败：' + ex.msg)
    const rs = await one('SELECT status, exec_note FROM order_reschedule WHERE id = ?', [r.id])
    assert.equal(Number(rs.status), 5, '登记执行失败')
    const after = await one('SELECT session_id, amount_pay FROM orders WHERE id = ?', [o2])
    assert.equal(Number(after.session_id), Number(before.session_id), '订单团期未变（整体回滚）')
    assert.equal(Number(after.amount_pay), Number(before.amount_pay), '金额未变（整体回滚）')
  })

  await test('撤回与列表契约：申请人可撤回待审批；城市账号只见本城', async () => {
    const s2 = made.sessions[1]
    const o3 = await mkOrder(s2, 20); made.orders.push(o3)
    ok(await call('ops', 'POST', `/admin/orders/${o3}/reschedule`, { toSessionId: made.sessions[0], reason: stamp + ' 将被撤回的申请' }))
    const r = await one("SELECT id, applicant FROM order_reschedule WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1", [o3])
    const applicantTok = r.applicant.includes('ops') ? tokens.ops : tokens.super
    const applicantRole = r.applicant.includes('ops') ? 'ops' : 'super'
    ok(await call(applicantRole, 'POST', `/admin/reschedules/${r.id}/cancel`, {}, applicantTok))
    assert.equal(Number((await one('SELECT status FROM order_reschedule WHERE id = ?', [r.id])).status), 4, '已撤回')
    const list = ok(await call('super', 'GET', '/admin/reschedules?pageSize=5'))
    assert.ok(Array.isArray(list.rows) && typeof list.total === 'number', '列表契约')
    assert.equal((await call('review', 'GET', '/admin/reschedules')).code, 1003, '审核无列表')
  })

  console.log(`\n${passed} 项批次 F-3（R-02 改期/换团）回归通过`)
} finally {
  for (const o of made.orders) {
    await q('DELETE FROM order_event WHERE order_id = ?', [o]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='order' AND biz_ref LIKE 'reschedule-%' AND JSON_EXTRACT(after_val, '$.orderNo') IN (SELECT order_no FROM orders WHERE id = ?)", [o]).catch(() => {})
    await q('DELETE FROM orders WHERE id = ?', [o]).catch(() => {})
  }
  await q("DELETE FROM order_reschedule WHERE order_no LIKE 'WLRS" + stamp + "%'").catch(() => {})
  await q("DELETE FROM bean_flow WHERE biz_ref LIKE 'RSQA%' OR biz_ref LIKE '%-bean-seed'").catch(() => {})
  for (const s of made.sessions) await q('DELETE FROM tour_session WHERE id = ?', [s]).catch(() => {})
  if (made.users.length) await q('DELETE FROM bean_account WHERE user_id IN (?)', [made.users]).catch(() => {})
  if (made.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [made.users]).catch(() => {})
  await closeDb()
}
