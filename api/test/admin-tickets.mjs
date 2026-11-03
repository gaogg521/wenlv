// 批次 D 回归：T04 售后工单 + 未支付取消（隔离库，需服务在跑）
// 覆盖：工单全生命周期（创建→认领→等待→恢复→办结→关闭→重开）、转派、时间线留痕、
//       城市角色发起本城/仅看本城/不能办理、越权矩阵、并发认领只一人成功、
//       未支付取消（名额释放/旅豆退回/事件留痕/已支付拒绝/与支付回调并发一致）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-tickets.mjs')
import assert from 'node:assert/strict'
import { q, one, tx, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '工单回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'TKQA' + Date.now()
const created = { tickets: [], orders: [], orderNos: [], users: [] }
try {
  const row = await one('SELECT * FROM orders WHERE status = 50 ORDER BY id DESC LIMIT 1')
  assert(row, '隔离库需要场景订单')
  const cityA = row.city_code
  const mkOrder = async (status, city) => {
    const no = stamp + '-' + created.orders.length
    const r = await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name, bean_deducted)
      SELECT ?,?,?,?,?,p.merchant_id,1,10000,10000,?,NULL,? FROM tour_product p WHERE p.city_code = ? LIMIT 1`,
      [no, row.user_id, row.product_id, row.session_id, city, status, 0, city])
    created.orders.push(r.insertId)
    created.orderNos.push(no)
    // 夹具与真实下单同权：占用名额，取消时才能扣减（chk_quota 要求 booked >= 0）
    if (Number(status) === 10) await q('UPDATE tour_session SET booked = booked + 1 WHERE id = ?', [row.session_id])
    return no
  }
  const tk = (role, id, action, body) => call(role, 'POST', `/admin/tickets/${id}/${action}`, body)

  await test('发起工单：类别/说明校验；城市账号仅本城；finance/review/risk 不能发起', async () => {
    assert.equal((await call('ops', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'bogus', note: '类别无效测试' })).code, 1001)
    assert.equal((await call('ops', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'refund', note: '短' })).code, 1001)
    assert.equal((await call('finance', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'refund', note: '财务不能发起' })).code, 1003)
    assert.equal((await call('review', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'refund', note: '审核不能发起' })).code, 1003)
    const r = ok(await call('ops', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'refund', priority: 1, note: stamp + ' 游客来电要求退款，请核实', promisedAt: '2026-12-01T18:00' }))
    created.tickets.push(r.id)
    assert.match(r.ticketNo, /^AS\d{12,}$/)
    // 城市账号：本城可发起、外城拒绝
    const other = await one('SELECT order_no, city_code FROM orders WHERE city_code <> ? LIMIT 1', [cityA])
    if (other) {
      const cityTokB = jwtSign({ end: 'admin', role: 'city_partner', name: '工单回归-城市B', scopeCity: String(other.city_code) })
      assert.equal((await call(null, 'POST', '/admin/tickets', { orderNo: other.order_no, category: 'complaint', note: '本城发起测试说明' }, cityTokB)).code, 0)
      // 城市A（本城 cityA）不能给外城订单发起售后
      assert.equal((await call(null, 'POST', '/admin/tickets', { orderNo: other.order_no, category: 'complaint', note: '外城订单发起测试说明' }, jwtSign({ end: 'admin', role: 'city_partner', name: '工单回归-城市A', scopeCity: String(cityA) }))).code, 1003, '外城订单拒绝')
    }
  })

  await test('全生命周期：认领→等待→恢复→办结→关闭→重开，时间线完整不可改写', async () => {
    const id = created.tickets[0]
    assert.equal((await tk('finance', id, 'claim', {})).code, 1003, '财务不能认领')
    assert.equal((await tk('city_partner', id, 'claim', {})).code, 1003, '城市不能认领')
    assert.equal((await tk('ops', id, 'resolve', { note: '越序办结测试说明' })).code, 2002, '待认领不能直接办结')
    ok(await tk('ops', id, 'claim', {}))
    assert.equal((await tk('ops', id, 'claim', {})).code, 2002, '重复认领拒绝')
    ok(await tk('ops', id, 'wait', { note: '等待游客提供凭证照片' }))
    ok(await call(null, 'POST', `/admin/tickets/${id}/note`, { note: stamp + ' 游客已补材料' }, jwtSign({ end: 'admin', role: 'city_partner', name: '工单回归-城市A', scopeCity: String(cityA) })), '城市可补充材料')
    ok(await tk('ops', id, 'resume', { note: '材料齐了继续处理' }))
    ok(await tk('ops', id, 'resolve', { note: stamp + ' 已按退款流程办结' }))
    ok(await tk('ops', id, 'close', { note: '回访完成关闭' }))
    assert.equal((await tk('ops', id, 'close', { note: '重复关闭测试说明' })).code, 2002)
    ok(await tk('ops', id, 'reopen', { note: '游客再次来电，重开跟进' }))
    const d = ok(await call('ops', 'GET', `/admin/tickets/${id}`))
    assert.equal(d.ticket.status, 1); assert.equal(d.ticket.assignee, 'admin:工单回归-ops')
    const actions = d.records.map((r) => r.action)
    assert.deepEqual(actions, ['create', 'claim', 'wait', 'note', 'resume', 'resolve', 'close', 'reopen'], '时间线完整：' + actions.join(','))
    // 转派
    ok(await tk('ops', id, 'transfer', { assignee: 'admin:工单回归-ops2', note: '转派给当班客服处理' }))
    const d2 = ok(await call('ops', 'GET', `/admin/tickets/${id}`))
    assert.equal(d2.ticket.assignee, 'admin:工单回归-ops2')
  })

  await test('队列契约：状态筛选/关键词/城市只看本城；详情越权拒绝', async () => {
    const list = ok(await call('ops', 'GET', '/admin/tickets?status=1'))
    assert.ok(list.rows.every((t) => Number(t.status) === 1) && list.statusCounts[1] >= 1)
    assert.equal(list.countsScope, 'city-scope-only')
    const kw = ok(await call('ops', 'GET', '/admin/tickets?kw=' + encodeURIComponent(row.order_no.slice(0, 12))))
    assert.ok(kw.total >= 1, '按订单号前缀命中工单：' + kw.total)
    const cityTokA = jwtSign({ end: 'admin', role: 'city_partner', name: '工单回归-城市A', scopeCity: String(cityA) })
    const cityList = ok(await call(null, 'GET', '/admin/tickets', null, cityTokA))
    assert.ok(cityList.rows.every((t) => String(t.city_code) === String(cityA)), '城市账号只看本城工单')
    assert.equal((await call(null, 'GET', '/admin/tickets', null, jwtSign({ end: 'admin', role: 'city_partner', name: '无城' }))).code, 1003)
    assert.equal((await call('finance', 'GET', '/admin/tickets/' + created.tickets[0])).code, 0, '财务可读（等待财务步骤）')
    assert.equal((await call('review', 'GET', '/admin/tickets', null)).code, 1003, '审核无队列')
    assert.equal((await call('risk', 'GET', '/admin/tickets/' + created.tickets[0])).code, 1003, '风控无详情')
  })

  await test('并发认领：两会话同时认领同一工单只一人成功', async () => {
    const r = ok(await call('ops', 'POST', '/admin/tickets', { orderNo: row.order_no, category: 'other', note: stamp + ' 并发认领夹具说明' }))
    created.tickets.push(r.id)
    const [a, b] = await Promise.all([
      call('ops', 'POST', `/admin/tickets/${r.id}/claim`, {}),
      call('super', 'POST', `/admin/tickets/${r.id}/claim`, {}),
    ])
    const codes = [a.code, b.code].sort()
    assert.deepEqual(codes, [0, 2002], '一成功一冲突：' + JSON.stringify([a.msg, b.msg]))
    const d = ok(await call('ops', 'GET', `/admin/tickets/${r.id}`))
    assert.equal(d.records.filter((x) => x.action === 'claim').length, 1, '认领记录只有一条')
  })

  await test('未支付取消：状态机流转、名额释放、旅豆退回、事件留痕；越权与已支付拒绝', async () => {
    const sessBefore = await one('SELECT booked FROM tour_session WHERE id = ?', [row.session_id])
    const no10 = await mkOrder(10, cityA)
    await q('UPDATE orders SET bean_deducted = 500 WHERE order_no = ?', [no10])
    assert.equal((await call('finance', 'POST', `/admin/orders/${no10}/cancel-unpaid`, { reason: '财务越权取消测试说明' })).code, 1003)
    assert.equal((await call(null, 'POST', `/admin/orders/${no10}/cancel-unpaid`, { reason: '城市越权取消测试说明' }, jwtSign({ end: 'admin', role: 'city_partner', name: '工单回归-城市A', scopeCity: String(cityA) }))).code, 1003, '城市不能取消平台订单')
    assert.equal((await call('ops', 'POST', `/admin/orders/${no10}/cancel-unpaid`, { reason: '短' })).code, 1001, '原因必填')
    ok(await call('ops', 'POST', `/admin/orders/${no10}/cancel-unpaid`, { reason: stamp + ' 游客放弃出行，客服取消' }))
    const o = await one('SELECT status FROM orders WHERE order_no = ?', [no10])
    assert.equal(Number(o.status), 90, '订单关闭')
    const ev = await one("SELECT detail FROM order_event WHERE order_id = ? AND to_st = 90 ORDER BY id DESC LIMIT 1", [created.orders[created.orders.length - 1]])
    let evText = String(ev.detail)
    try { evText = JSON.parse(evText) } catch { /* 旧路径写入的是裸字符串 */ }
    assert.ok(String(evText).includes('客服取消'), '事件留痕：' + ev.detail)
    const sessAfter = await one('SELECT booked FROM tour_session WHERE id = ?', [row.session_id])
    assert.equal(Number(sessAfter.booked), Number(sessBefore.booked), '名额释放（booked 回到取消前）')
    const beanLedger = await one("SELECT direction, amount FROM bean_ledger WHERE biz_ref = ? LIMIT 1", [no10])
    assert.equal(Number(beanLedger.amount), 500, '旅豆退回 500')
    // 已支付订单拒绝取消
    const no20 = await mkOrder(20, cityA)
    assert.equal((await call('ops', 'POST', `/admin/orders/${no20}/cancel-unpaid`, { reason: '已支付订单取消测试说明' })).code, 2002, '已支付走退款')
    // 与支付回调并发：先取消后回调 → 回调被状态机拒绝（不出现已付款却无订单）
    const noC = await mkOrder(10, cityA)
    ok(await call('ops', 'POST', `/admin/orders/${noC}/cancel-unpaid`, { reason: stamp + ' 并发夹具取消' }))
    const latePay = await call('ops', 'POST', '/admin/dev/mock-pay', { orderNo: noC })
    assert.notEqual(latePay.code, 0, '取消后支付回调被拒：' + latePay.msg)
    const oC = await one('SELECT status FROM orders WHERE order_no = ?', [noC])
    assert.equal(Number(oC.status), 90, '订单保持已取消')
    const payRow = await one('SELECT id FROM payment WHERE order_id = ?', [created.orders[created.orders.length - 1]])
    assert.ok(!payRow, '没有支付入账')
  })

  console.log(`\n${passed} 项批次 D（T04 售后工单 + 未支付取消）回归通过`)
} finally {
  if (created.orders.length) {
    await q('DELETE FROM bean_ledger WHERE biz_ref IN (?)', [created.orderNos]).catch(() => {})
    await q('DELETE FROM order_event WHERE order_id IN (?)', [created.orders]).catch(() => {})
    await q('DELETE FROM orders WHERE id IN (?)', [created.orders])
  }
  if (created.tickets.length) {
    await q('DELETE FROM aftersales_record WHERE ticket_id IN (?)', [created.tickets])
    await q('DELETE FROM aftersales_ticket WHERE id IN (?)', [created.tickets])
    await q("DELETE FROM audit_log WHERE module = 'ticket' AND biz_ref IN (?)", [created.tickets.map((x) => 'ticket-' + x)]).catch(() => {})
  }
  await q("DELETE FROM audit_log WHERE module = 'order' AND action = 'cancel-unpaid'").catch(() => {})
  await closeDb()
}
