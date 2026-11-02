// 退改梯度端到端：真实 HTTP 下单 → MOCK 支付 → 试算 → 自助退款 → 核对退款单/旅豆/名额/存证
// 会新建订单并修改团期出发日，只能对隔离库运行（守卫见 _guard.mjs）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/refund-e2e.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const adminT = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).data.token
const buyerT = (await api('POST', '/c/auth/login', { code: 'mock-refund-tier' })).data.token
const sess = await one(`SELECT s.id, s.depart_date, s.price_adult, s.product_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id
  WHERE s.status = 1 AND p.status = 1 AND s.quota - s.booked >= 3 ORDER BY s.id LIMIT 1`)
assert.ok(sess, '需要至少一个可预订团期（先跑 seed:scenario）')
const origDepart = String(sess.depart_date).slice(0, 10)
const shift = (days) => q('UPDATE tour_session SET depart_date = ? WHERE id = ?', [bizDay(days), sess.id])
async function paidOrder() {
  const o = (await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0, contactName: '梯度测试', contactPhone: '13800002222' }, buyerT)).data
  await api('POST', '/admin/dev/mock-pay', { orderNo: o.orderNo }, adminT)
  return o.orderNo
}

console.log('== 退改梯度 · 端到端 ==')
try {
  await t('距出发 4 天：试算 10% 手续费，确认后实际退回金额 = 试算金额', async () => {
    await shift(4)
    const no = await paidOrder()
    const qt = (await api('GET', `/c/orders/${no}/refund-quote`, null, buyerT)).data
    assert.equal(qt.allowed, true); assert.equal(qt.daysToDepart, 4); assert.equal(qt.rate, 0.1)
    const pay = Number((await one('SELECT amount_pay FROM orders WHERE order_no = ?', [no])).amount_pay)
    assert.equal(qt.feeFen, Math.round(pay * 0.1)); assert.equal(qt.refundFen + qt.feeFen, pay)
    const r = await api('POST', `/c/orders/${no}/refund`, { reason: '行程变更' }, buyerT)
    assert.equal(r.code, 0, r.msg)
    const rf = await one('SELECT r.amount, r.fee_amount, r.fee_rate, r.days_to_depart, r.status FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = ?', [no])
    assert.equal(Number(rf.amount), qt.refundFen); assert.equal(Number(rf.fee_amount), qt.feeFen)
    assert.equal(Number(rf.fee_rate), 0.1); assert.equal(Number(rf.days_to_depart), 4); assert.equal(Number(rf.status), 2)
    assert.equal(Number((await one('SELECT status FROM orders WHERE order_no = ?', [no])).status), 70)
    const ev = await one(`SELECT canonical FROM attest_event WHERE biz_type = 'refund' AND version_no = 2 ORDER BY id DESC LIMIT 1`)
    const c = typeof ev.canonical === 'string' ? JSON.parse(ev.canonical) : ev.canonical
    assert.equal(c.feeAmount, qt.feeFen, '存证记录了手续费')
  })
  await t('距出发 10 天：免手续费全额退', async () => {
    await shift(10)
    const no = await paidOrder()
    const qt = (await api('GET', `/c/orders/${no}/refund-quote`, null, buyerT)).data
    assert.equal(qt.feeFen, 0)
    assert.equal((await api('POST', `/c/orders/${no}/refund`, {}, buyerT)).code, 0)
    const rf = await one('SELECT r.fee_amount FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = ?', [no])
    assert.equal(Number(rf.fee_amount), 0)
  })
  await t('出发当天：试算不允许，自助退款被拒，订单状态不变', async () => {
    await shift(0)
    const no = await paidOrder()
    const before = Number((await one('SELECT status FROM orders WHERE order_no = ?', [no])).status)
    const qt = (await api('GET', `/c/orders/${no}/refund-quote`, null, buyerT)).data
    assert.equal(qt.allowed, false)
    const r = await api('POST', `/c/orders/${no}/refund`, {}, buyerT)
    assert.equal(r.code, 2002); assert.match(r.msg, /联系客服/)
    assert.equal(Number((await one('SELECT status FROM orders WHERE order_no = ?', [no])).status), before)
    assert.equal(await one('SELECT r.id FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = ?', [no]), null, '被拒时不落退款单')
    // 客服后台仍可全额处理
    const ar = await api('POST', `/admin/orders/${no}/refund`, { reason: '客服特批' }, adminT)
    assert.equal(ar.code, 0, ar.msg)
    const rf = await one('SELECT r.fee_amount, r.fee_rate FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = ?', [no])
    assert.equal(Number(rf.fee_amount), 0); assert.equal(rf.fee_rate, null)
  })
  await t('参数中心拒绝非法梯度配置', async () => {
    const r = await api('POST', '/admin/config/proposal', { key: 'order.refund_policy', newValue: '{"d7":2}', reason: 't' }, adminT)
    assert.equal(r.code, 1001); assert.match(r.msg, /非法/)
  })
  console.log('== 手续费计入结算 ==')
  const prod = await one('SELECT merchant_id FROM tour_product WHERE id = ?', [sess.product_id])
  const mid = Number(prod.merchant_id)
  const unsettled = async () => Number((await one(`SELECT COALESCE(SUM(r.fee_amount),0) s FROM refunds r JOIN orders o ON o.id = r.order_id
    WHERE o.merchant_id = ? AND r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL`, [mid])).s)
  const gen = async (period) => {
    const r = await api('POST', '/admin/settlements/generate', { period }, adminT)
    assert.equal(r.code, 0, r.msg)
    return await one('SELECT * FROM settlement WHERE merchant_id = ? AND period = ?', [mid, period])
  }
  await t('商户单独约定分成 40%：手续费按比例计入结算单，应付 = 履约 + 分成', async () => {
    await shift(4)
    const no = await paidOrder()
    assert.equal((await api('POST', `/c/orders/${no}/refund`, {}, buyerT)).code, 0)
    assert.equal((await api('PUT', '/admin/entities/merchant/' + mid, { values: { refund_fee_share: 40 } }, adminT)).code, 0)
    const expected = await unsettled()
    assert.ok(expected > 0)
    const st = await gen('FT' + Date.now().toString(36))
    assert.equal(Number(st.fee_total), expected); assert.equal(Number(st.fee_share_bp), 4000)
    assert.equal(Number(st.fee_merchant), Math.floor(expected * 0.4)); assert.equal(Number(st.fee_merchant) + Number(st.fee_platform), expected)
    assert.equal(await unsettled(), 0, '计入后不再是未结算')
    const ev = await one(`SELECT canonical FROM attest_event WHERE biz_type = 'settlement' AND biz_ref = ? ORDER BY id DESC LIMIT 1`, ['settle-' + st.id])
    const c = typeof ev.canonical === 'string' ? JSON.parse(ev.canonical) : ev.canonical
    assert.equal(c.feeMerchant, Number(st.fee_merchant), '存证快照包含手续费分成')
  })
  await t('同一笔手续费不会计入第二张结算单', async () => {
    const st = await gen('FT2' + Date.now().toString(36))
    assert.ok(!st || Number(st.fee_total) === 0)
  })
  await t('清除商户约定后按参数中心比例（默认 0 = 全部归平台）；只有手续费也能出账', async () => {
    assert.equal((await api('PUT', '/admin/entities/merchant/' + mid, { values: { refund_fee_share: '' } }, adminT)).code, 0)
    await shift(4)
    const no = await paidOrder()
    assert.equal((await api('POST', `/c/orders/${no}/refund`, {}, buyerT)).code, 0)
    const fee = await unsettled()
    const st = await gen('FT3' + Date.now().toString(36))
    assert.equal(Number(st.fee_total), fee); assert.equal(Number(st.fee_merchant), 0); assert.equal(Number(st.fee_platform), fee)
  })
  await t('参数中心拒绝超出 0~1 的分成比例', async () => {
    const r = await api('POST', '/admin/config/proposal', { key: 'settlement.refund_fee_merchant_pct', newValue: '1.5', reason: 't' }, adminT)
    assert.equal(r.code, 1001)
  })
} finally {
  await q('UPDATE tour_session SET depart_date = ? WHERE id = ?', [origDepart, sess.id])
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
