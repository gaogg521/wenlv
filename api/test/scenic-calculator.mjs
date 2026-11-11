import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
import { calculate, example } from '../src/domain/scenic-calculator.mjs'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

assertIsolatedDb('test/scenic-calculator.mjs')
assert.ok(process.env.PORT && process.env.PORT !== '8080', '使用隔离 API 端口')
const origin = 'http://127.0.0.1:' + process.env.PORT
const raw = async (method, path, body, token) => (await fetch(origin + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})).json()
async function call(...args) {
  const response = await raw(...args)
  assert.equal(response.code, 0, JSON.stringify(response))
  return response.data
}

try {
  const base = calculate(example)
  assert.equal(base.balanceFen, -7227000)
  assert.equal(base.breakEvenOrders, 5013)
  assert.equal(base.paths.price.value, 66667)
  assert.equal(base.paths.rate.value, 2604)
  assert.equal(base.paths.fixed.value, 10773000)
  assert.equal(base.paths.orders.balanceFen, 1683)
  assert.deepEqual(base.sensitivity.map(row => row.priceFen), [29900, 39900, 49900])
  assert.deepEqual(base.sensitivity[2].cells.map(cell => cell.balanceFen), [-8119800, -4527000, -934200])
  assert.equal(calculate({ ...example, orders: 5012 }).balanceFen, -1908)
  assert.equal(calculate({ ...example, fixedFen: 18002000 }).breakEvenOrders, 5014)
  assert.equal(calculate({ ...example, revenueBp: 1100 }).paths.rate.value, 2604)
  assert.equal(calculate({ ...example, fixedFen: 0, priceFen: 0 }).breakEvenOrders, 0)
  assert.equal(calculate({ ...example, orders: 0 }).sensitivity[0].cells.length, 1)
  assert.equal(calculate({ ...example, orders: 1, priceFen: 1, revenueBp: 9999, variableBp: 0, equityBp: 0, fixedFen: 1 }).status, 'loss')
  assert.throws(() => calculate({ ...example, revenueBp: 10001 }))
  console.log('公式、达标值回代、零值及显示舍入边界通过')

  const admin = (await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const first = await one(`SELECT o.order_no,o.session_id,o.product_id,o.promo_scene,o.settlement_id,p.scenic_id
    FROM orders o JOIN tour_product p ON p.id=o.product_id
    WHERE p.title LIKE '朱家角%江南谜案%' AND o.status=50 ORDER BY o.id LIMIT 1`)
  assert.ok(first?.promo_scene && first.settlement_id, '先运行 test/scenario-populate.mjs')
  let scenicId = first.scenic_id
  if (!scenicId) {
    scenicId = (await q("INSERT INTO scenic_spot(city_code,name) VALUES('310118','朱家角古镇 · 隔离验收')")).insertId
    await q('UPDATE tour_product SET scenic_id=? WHERE id=?', [scenicId, first.product_id])
  }
  const root = '/admin/scenics/' + scenicId + '/calculator'
  const day = bizDay()
  const params = { from: day, to: day, inputs: example }
  const current = await call('POST', root, params, admin)
  const order = current.sources.find(x => x.orderNo === first.order_no)
  assert.equal(order.goodsFen, 27800)
  assert.equal(order.promoScene, first.promo_scene)
  assert.equal(order.verifiedPasses, 1)
  assert.ok(order.settlement.status >= 2)
  assert.equal(current.actual.netFen, 27800)
  const saved = await call('POST', root + '/reviews', { ...params, fingerprint: current.fingerprint }, admin)
  assert.ok(saved.reviewId)
  const sameCity = jwtSign({ end: 'admin', role: 'city_partner', scopeCity: '310118' })
  const otherCity = jwtSign({ end: 'admin', role: 'city_partner', scopeCity: '320508' })
  assert.equal((await raw('POST', root, params, otherCity)).code, 1004)
  assert.equal((await call('POST', root, params, sameCity)).actual.costsVisible, false)
  assert.notEqual((await raw('GET', root + '/reviews/' + saved.reviewId, null, sameCity)).code, 0)

  const buyer = (await call('POST', '/c/auth/login', { code: 'mock-xiaoman' })).token
  const repeat = await call('POST', '/c/orders', { sessionId: first.session_id, qty: 1, beanDeduct: 100,
    contactName: '验收复购', contactPhone: '13800001111' }, buyer)
  assert.equal(repeat.beanDeducted, 100)
  await call('POST', '/admin/dev/mock-pay', { orderNo: repeat.orderNo }, admin)
  const live = await call('POST', root, params, admin)
  assert.equal(live.actual.repeatOrders, 1)
  assert.equal(live.actual.netFen, current.actual.netFen + repeat.amountPay)
  assert.equal(live.sources.find(x => x.orderNo === repeat.orderNo).beanDeductFen, 1000)
  assert.equal(live.sources.find(x => x.orderNo === repeat.orderNo).firstOrderNo, first.order_no)
  assert.notEqual((await raw('POST', root + '/reviews', { ...params, fingerprint: current.fingerprint }, admin)).code, 0)
  const history = await call('GET', root + '/reviews/' + saved.reviewId, null, admin)
  assert.equal(history.actual.netFen, 27800)
  assert.equal(history.sources.length, 1)
  console.log(JSON.stringify({ scenicId, firstOrder: first.order_no, settlementId: first.settlement_id, repeatOrder: repeat.orderNo, firstFen: 27800, repeatFen: repeat.amountPay, actualFen: live.actual.netFen, reviewId: saved.reviewId }))

  await call('POST', '/admin/orders/' + repeat.orderNo + '/refund', { reason: '隔离景区复盘退款验证' }, admin)
  const refunded = await call('POST', root, params, admin)
  assert.equal(refunded.actual.netFen, 27800)
  assert.equal(refunded.sources.find(x => x.orderNo === repeat.orderNo).refundFen, repeat.amountPay)
  assert.equal((await call('GET', root + '/reviews/' + saved.reviewId, null, admin)).actual.netFen, 27800)
  console.log('景区来源单据、结算、复购、退款重算、快照与角色隔离通过')
} finally {
  await closeDb()
}
