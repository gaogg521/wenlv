import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
import { q, closeDb } from '../src/db.mjs'
import { place, closeUnpaid } from '../src/domain/order.mjs'
import { cancelDueSessions } from '../src/domain/group.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

assertIsolatedDb('test/shop-stock.mjs')
const base = process.env.API_BASE || 'http://127.0.0.1:' + (process.env.PORT || 8080)
async function call(method, path, body, token) {
  const response = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || '') },
    body: body && JSON.stringify(body)
  })
  const r = await response.json()
  assert.equal(r.code, 0, JSON.stringify(r))
  return r.data
}

try {
  const admin = (await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const visitor = await call('POST', '/c/auth/login', { code: 'mock-stock-qa-' + Date.now() })
  const userId = visitor.user.id
  const product = async title => (await q(`INSERT INTO tour_product
    (title, channel, city_code, cat, price_from, merchant_id, status) VALUES (?,'main','310118','shop',8800,1,1)`, [title])).insertId
  const productId = await product('直购库存测试')
  const appointmentId = await product('预约时段测试')
  const sid = (await q('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult) VALUES (?,?,2,9,8800)', [appointmentId, bizDay()])).insertId
  const legacySid = (await q('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult) VALUES (?,?,2,9,8800)', [productId, bizDay()])).insertId
  await call('PUT', '/admin/products/' + productId + '/stock', { available: 1, previous: null }, admin)
  const detail = () => call('GET', '/c/tours/' + productId)
  const stock = await detail()
  assert.deepEqual(stock.sessions, [])
  assert.equal(stock.purchase.left_seats, 1)
  const slotDetail = await call('GET', '/c/tours/' + appointmentId)
  assert.equal(slotDetail.purchase, null)
  assert.equal(Number(slotDetail.sessions[0].id), Number(sid))
  assert.equal(slotDetail.sessions[0].groupProgress, undefined)
  const order = { userId, qty: 1, expectedGoodsFen: 8800 }
  await assert.rejects(place({ ...order, sessionId: legacySid }), /不可售/)
  await assert.rejects(place({ ...order, productId: appointmentId }), /不可购买/)
  const attempted = await Promise.allSettled([place({ ...order, productId }), place({ ...order, productId })])
  const accepted = attempted.filter(x => x.status === 'fulfilled')
  const rejected = attempted.filter(x => x.status === 'rejected')
  assert.equal(accepted.length, 1)
  assert.match(rejected[0].reason.message, /库存不足/)
  assert.equal((await detail()).purchase.left_seats, 0)
  await closeUnpaid(accepted[0].value.orderNo, 'user_cancel', 'test')
  assert.equal((await detail()).purchase.left_seats, 1)
  const booked = await place({ ...order, sessionId: sid })
  await cancelDueSessions()
  const [row] = await q('SELECT status FROM orders WHERE order_no=?', [booked.orderNo])
  assert.equal(row.status, 10)
  const [session] = await q('SELECT status FROM tour_session WHERE id=?', [sid])
  assert.equal(session.status, 1)
  await closeUnpaid(booked.orderNo, 'user_cancel', 'test')
  console.log('商城直购、并发防超卖、关闭释放、到店时段与成团隔离通过')
} finally {
  await closeDb()
}
