// D01 商品促销折扣 + 自由豆/旅豆同单专项测试（隔离库，需先起隔离 API 服务）
// 覆盖契约：299元8折239.20；早鸟按时间生效、折扣按定价比例；叠加开关（默认关闭取低、开启先早鸟再折扣）；
// 自由豆与旅豆同单可用、独立记账；旅豆抵扣上限锚定最终实付（B ≤ r×X）；快照/支付/取消/退款/返豆全链路。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('d01-discount')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as bean from '../src/domain/bean.mjs'
import { fullRefund } from '../src/domain/refund.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'd01-qa' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'd01-ops' })
const ro = jwtSign({ end: 'admin', role: 'readonly', name: 'd01-ro' })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()
const snapOf = v => typeof v === 'string' ? JSON.parse(v) : v
const RULE = (over = {}) => ({ name: 'D01·8折-' + stamp, zhe: 8, from: date(-1) + 'T00:00', to: date(30) + 'T23:59', products: [], cities: [], channels: [], dates: [], stackEarly: false, reason: '隔离库D01折扣规则测试', ...over })
const FREEDOM_RULE = { name: 'D01满100减50', threshold: 10000, discount: 5000, from: date(-1) + ' 00:00:00', to: date(30) + ' 23:59:59', products: [], cities: [], channels: [], dates: [], perUser: 3, daily: 5 }

let pid, sStd, sE259, sE199, uid1, uid2, uid3, mid, ruleId, right1, right1b, right2, bbudget
const place = async (uid, extra = {}) => order.place({ userId: uid, sessionId: sStd.id, qty: 1, wantedBeans: 0, ...extra })

try {
  // ===== 场景准备：商户/产品/团期/用户/预算 =====
  mid = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'D01商户' + stamp, 'travel', 'D01M' + stamp])).insertId
  pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status,insurance_fee) VALUES('main','310118','theme','D01折扣品',29900,?,1,1000)", [mid])).insertId
  const mkS = (over = {}) => q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,early_price,early_days,status) VALUES(?,?,?,?,?,?,?,1)',
    [pid, date(over.depart ?? 100), 20, 1, 29900, over.earlyPrice ?? null, over.earlyDays ?? null]).then(r => r.insertId)
  sStd = { id: await mkS({ depart: 100 }) }
  sE259 = { id: await mkS({ depart: 101, earlyPrice: 25900, earlyDays: 3 }) }
  sE199 = { id: await mkS({ depart: 102, earlyPrice: 19900, earlyDays: 3 }) }
  for (const u of ['a', 'b', 'c']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['d01-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uid1 = uid; else if (u === 'b') uid2 = uid; else uid3 = uid
  }
  bbudget = (await q("INSERT INTO bean_budget(name,total,granted,returned,biz_owner,status) VALUES(?,?,0,0,'qa',1)", ['D01豆预算', 1000000])).insertId
  await q('INSERT INTO bean_global_cap(id,cap_total,issued_sum,year) VALUES(1,100000000,0,YEAR(CURDATE())) ON DUPLICATE KEY UPDATE cap_total=cap_total', [])
  await bean.grant(uid1, 500, bean.BIZ.TASK, 'D01-TASK-' + stamp, bbudget)
  const fbudget = (await q('INSERT INTO freedom_budget(name,total,status) VALUES(?,?,1)', ['D01补贴预算', 100000])).insertId
  const ftid = (await q('INSERT INTO freedom_template(name,budget_id,rule_json,status,version) VALUES(?,?,?,1,1)', ['D01满100减50', fbudget, JSON.stringify(FREEDOM_RULE)])).insertId
  // batch_id 各不相同（uk_batch_user）；uid1 两张券
  for (const [uid, bid] of [[uid1, 0], [uid1, 1], [uid2, 2]]) await q('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)', [uid, bid, ftid, fbudget, JSON.stringify(FREEDOM_RULE)])
  right1 = Number((await one('SELECT id FROM freedom_right WHERE user_id=? ORDER BY id LIMIT 1', [uid1])).id)
  right1b = Number((await one('SELECT id FROM freedom_right WHERE user_id=? ORDER BY id DESC LIMIT 1', [uid1])).id)
  right2 = Number((await one('SELECT id FROM freedom_right WHERE user_id=?', [uid2])).id)
  await q('UPDATE freedom_budget SET committed=committed+15000 WHERE id=?', [fbudget]) // 与发放流程同口径：每张券预占面额（3张）

  await check('规则校验：折数0/12/超两位小数被拒，readonly 只读，操作依据必填', async () => {
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ zhe: 0 }), ro)).code, 1003)
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ zhe: 12 }), ops)).code, 1001)
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ zhe: 8.555 }), ops)).code, 1001)
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ from: date(2) + 'T00:00', to: date(1) + 'T00:00' }), ops)).code, 1001)
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ reason: '短' }), ops)).code, 1001)
    ruleId = ok(await call('POST', '/admin/promo-discounts', RULE(), ops)).id
    const list = ok(await call('GET', '/admin/promo-discounts', null, ops))
    assert.ok(list.rows.some(x => Number(x.id) === Number(ruleId) && x.discount_bp === 8000))
  })

  await check('299元×8折＝239.20：列表/详情/试算/建单同源（priceType=discount）', async () => {
    const list = ok(await call('GET', '/c/tours?cat=theme', null, token(uid1)))
    const row = list.find(x => Number(x.id) === Number(pid))
    assert.equal(row.priceNow, 19900); assert.equal(row.hasPromo, true) // 列表取全部在售团期最低有效单价（早鸟199更低）
    const det = ok(await call('GET', '/c/tours/' + pid, null, token(uid1)))
    const std = det.sessions.find(s => Number(s.id) === Number(sStd.id))
    assert.equal(std.priceNow, 23920); assert.equal(std.promo.zhe, 8); assert.equal(std.promo.originalFen, 29900)
    const quote = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid1)))
    assert.equal(quote.goods, 23920); assert.equal(quote.priceType, 'discount'); assert.equal(quote.discountRule.zhe, 8)
    const r = await place(uid2)
    assert.equal(r.pricing.goodsFen, 23920); assert.equal(r.amountPay, 23920)
    const o = await one('SELECT amount_goods, price_snapshot FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(Number(o.amount_goods), 23920)
    const snap = snapOf(o.price_snapshot)
    assert.equal(snap.originalUnitFen, 29900); assert.equal(snap.effectiveUnitFen, 23920)
    assert.equal(snap.discount.ruleId, ruleId); assert.equal(snap.discount.discountBp, 8000); assert.equal(snap.discount.stack, false)
    assert.equal(snap.cashPayFen, 23920); assert.equal(snap.priceType, 'discount')
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
  })

  await check('早鸟259与8折取239.20（默认不叠加，择低）', async () => {
    const quote = ok(await call('POST', '/c/freedom/quote', { sessionId: sE259.id, qty: 1 }, token(uid1)))
    assert.equal(quote.goods, 23920); assert.equal(quote.priceType, 'discount')
    const r = await place(uid2, { sessionId: sE259.id }); assert.equal(r.amountPay, 23920)
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
  })

  await check('早鸟199与8折默认取199（早鸟更低保留既有早鸟规则）', async () => {
    const quote = ok(await call('POST', '/c/freedom/quote', { sessionId: sE199.id, qty: 1 }, token(uid1)))
    assert.equal(quote.goods, 19900); assert.equal(quote.priceType, 'early')
    const r = await place(uid2, { sessionId: sE199.id }); assert.equal(r.amountPay, 19900)
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
  })

  await check('开启叠加：259×8折=207.20、199×8折=159.20；未命中早鸟按原价乘折扣', async () => {
    ok(await call('POST', '/admin/promo-discounts', { id: ruleId, zhe: 8, stackEarly: true, name: 'D01·8折叠加', from: date(-1) + 'T00:00', to: date(30) + 'T23:59', reason: '开启早鸟叠加契约验证' }, ops))
    const q259 = ok(await call('POST', '/c/freedom/quote', { sessionId: sE259.id, qty: 1 }, token(uid1)))
    assert.equal(q259.goods, 20720); assert.equal(q259.priceType, 'early_discount')
    const q199 = ok(await call('POST', '/c/freedom/quote', { sessionId: sE199.id, qty: 1 }, token(uid1)))
    assert.equal(q199.goods, 15920); assert.equal(q199.priceType, 'early_discount')
    const qStd = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid1)))
    assert.equal(qStd.goods, 23920); assert.equal(qStd.priceType, 'discount')
    const r = await place(uid2, { sessionId: sE259.id }); assert.equal(r.amountPay, 20720)
    const snap = snapOf((await one('SELECT price_snapshot FROM orders WHERE order_no=?', [r.orderNo])).price_snapshot)
    assert.equal(snap.discount.stack, true); assert.equal(snap.effectiveUnitFen, 20720); assert.equal(snap.early.unitFen, 25900)
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
    ok(await call('POST', '/admin/promo-discounts', { id: ruleId, zhe: 8, stackEarly: false, name: 'D01·8折', from: date(-1) + 'T00:00', to: date(30) + 'T23:59', reason: '恢复默认不叠加' }, ops))
  })

  let orderA // 组合单（支付→完成→返豆）
  await check('自由豆+旅豆同单：239.20−券50−172旅豆17.20＝现金172.00（上限锚定实付10%）', async () => {
    const quote = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1, rightId: right1, beanDeduct: 500 }, token(uid1)))
    assert.equal(quote.goods, 23920); assert.equal(quote.discount, 5000)
    assert.equal(quote.beanCapBeans, 172) // floor(0.1×18920/1.1/10)=172，17.20恰为最终实付172.00的10%
    assert.equal(quote.beanDeductCount, 172); assert.equal(quote.cashPay, 17200)
    const r = await place(uid1, { freedomRightId: right1, wantedBeans: 500 })
    assert.equal(r.beanDeducted, 172); assert.equal(r.freedomDiscount, 5000); assert.equal(r.amountPay, 17200)
    const o = await one('SELECT amount_pay, amount_bean_ded, bean_deducted, price_snapshot FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(Number(o.amount_pay), 17200); assert.equal(Number(o.bean_deducted), 172); assert.equal(Number(o.amount_bean_ded), 1720)
    const snap = snapOf(o.price_snapshot)
    assert.equal(snap.freedom.discountFen, 5000); assert.equal(snap.beans.count, 172); assert.equal(snap.beans.capBeans, 172); assert.equal(snap.cashPayFen, 17200)
    const fo = await one('SELECT cash_pay, discount, goods, status FROM freedom_order WHERE order_no=?', [r.orderNo])
    assert.equal(Number(fo.cash_pay), 17200); assert.equal(Number(fo.discount), 5000); assert.equal(Number(fo.goods), 23920); assert.equal(fo.status, 'locked')
    assert.equal(await bean.balance(uid1), 500 - 172)
    const led = await one('SELECT amount FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=4 AND l.biz_ref=? AND l.direction=2', [uid1, r.orderNo])
    assert.equal(Number(led.amount), 172)
    await order.acceptPayment(r.orderNo, 'D01PAY-' + stamp, true)
    const fo2 = await one('SELECT status FROM freedom_order WHERE order_no=?', [r.orderNo]); assert.equal(fo2.status, 'used')
    assert.equal(await bean.balance(uid1), 500 - 172) // 支付不回补旅豆
    orderA = r.orderNo
  })

  await check('返豆按最终实付商品额：172.00元×10%＝172豆（不含保费、不用原价）', async () => {
    await q('UPDATE travel_pass SET status=2 WHERE order_id=(SELECT id FROM orders WHERE order_no=?)', [orderA])
    await order.fire(orderA, 'VERIFY_ALL', 'd01-merchant')
    const before = await bean.balance(uid1)
    const { completeOrder } = await import('../src/jobs.mjs')
    await completeOrder(orderA)
    const o = await one('SELECT amount_pay, insurance_fee FROM orders WHERE order_no=?', [orderA])
    assert.equal(Math.round((Number(o.amount_pay) - Number(o.insurance_fee || 0)) / 10 * 0.10), 172) // 商品现金17200分÷10×10%＝172豆
    assert.equal((await bean.balance(uid1)) - before, 172)
  })

  let orderB // 组合单（支付→退款）
  await check('建第二张组合单（第二张券）并支付（供退款用例）', async () => {
    orderB = (await place(uid1, { freedomRightId: right1b, wantedBeans: 172 })).orderNo
    await order.acceptPayment(orderB, 'D01PAYB-' + stamp, true)
  })

  await check('全额退款只退实收现金172.00；旅豆/权益分别归还；促销减价不是可退现金', async () => {
    const balBefore = await bean.balance(uid1)
    await fullRefund({ orderNo: orderB, reason: 'D01组合单全额退款', operator: 'd01-qa' })
    const rf = await one('SELECT amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE o.order_no=?', [orderB])
    assert.equal(Number(rf.amount), 17200)
    assert.equal((await bean.balance(uid1)) - balBefore, 172)
    const fo = await one('SELECT status FROM freedom_order WHERE order_no=?', [orderB]); assert.equal(fo.status, 'refunded')
    const rr = await one('SELECT status FROM freedom_right WHERE id=?', [right1b]); assert.equal(rr.status, 'available')
  })

  await check('只有券未选豆：189.20（无保费示例）；券+保费不打折、不凑门槛', async () => {
    const q1 = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1, rightId: right2 }, token(uid2)))
    assert.equal(q1.cashPay, 18920)
    const r1 = await place(uid2, { freedomRightId: right2 }); assert.equal(r1.amountPay, 18920)
    await order.closeUnpaid(r1.orderNo, 'd01-cleanup')
    const q2 = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1, rightId: right2, insurance: true }, token(uid2)))
    assert.equal(q2.insurance, 1000); assert.equal(q2.cashPay, 19920)
    const r2 = await place(uid2, { freedomRightId: right2, withInsurance: true }); assert.equal(r2.amountPay, 19920)
    await order.closeUnpaid(r2.orderNo, 'd01-cleanup')
  })

  await check('低于门槛的折后金额不可用券（99元×8折=79.20<100）', async () => {
    const sLow = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,9900,1)', [pid, date(103), 20, 1])).insertId
    const qr = await call('POST', '/c/freedom/quote', { sessionId: sLow, qty: 1, rightId: right2 }, token(uid2))
    assert.equal(qr.code, 1001); assert.ok(String(qr.msg).includes('门槛'))
    await assert.rejects(() => place(uid2, { sessionId: sLow, freedomRightId: right2 }), /门槛/)
    await q('UPDATE tour_session SET status=4 WHERE id=?', [sLow])
  })

  await check('生效前/停用/范围外均回原价，直链接口不能绕过规则', async () => {
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 0, reason: '先停主规则验证生效前' }, ops))
    ok(await call('POST', '/admin/promo-discounts', RULE({ name: 'D01未来', from: date(3) + 'T00:00' }), ops))
    const q1 = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid2)))
    assert.equal(q1.goods, 29900); assert.equal(q1.priceType, 'original')
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 0, reason: '停用后应回原价' }, ops))
    const q2 = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid2)))
    assert.equal(q2.goods, 29900); assert.equal(q2.priceType, 'original')
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 1, reason: '恢复用于范围外用例' }, ops))
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 0, reason: '验证范围越界' }, ops))
    const cityRule = ok(await call('POST', '/admin/promo-discounts', RULE({ name: 'D01城市限定', cities: ['440100'] }), ops)).id
    const q3 = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid2)))
    assert.equal(q3.goods, 29900) // 商品城市310118不在440100内
    ok(await call('POST', '/admin/promo-discounts/status', { id: cityRule, status: 0, reason: '隔离库清理停用' }, ops))
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 1, reason: '恢复主规则' }, ops))
  })

  await check('并发同权益同豆：只成功一次，豆/权益/名额各动一次', async () => {
    const balBefore = await bean.balance(uid1)
    const beforeBooked = Number((await one('SELECT booked FROM tour_session WHERE id=?', [sStd.id])).booked)
    const rs = await Promise.allSettled([place(uid1, { freedomRightId: right1b, wantedBeans: 100 }), place(uid1, { freedomRightId: right1b, wantedBeans: 100 })])
    assert.equal(rs.filter(x => x.status === 'fulfilled').length, 1)
    const winner = rs.find(x => x.status === 'fulfilled').value
    assert.equal(balBefore - (await bean.balance(uid1)), 100)
    assert.equal(Number((await one('SELECT booked FROM tour_session WHERE id=?', [sStd.id])).booked), beforeBooked + 1)
    await order.closeUnpaid(winner.orderNo, 'd01-cleanup')
    assert.equal(await bean.balance(uid1), balBefore) // 关单归还
  })

  await check('锚定上限整数解：r=0 为 0；整豆尾差 floor（14900→135）；无浮点漂移', async () => {
    assert.equal(bean.anchorCapBeans(23920, 0, 0), 0)
    assert.equal(bean.anchorCapBeans(23920, 30000, 0.1), 0) // 券额≥商品额
    assert.equal(bean.anchorCapBeans(19900, 5000, 0.1), 135)
    assert.equal(bean.anchorCapBeans(23920, 5000, 0.1), 172) // 契约示例
  })

  await check('试算后价格上调需显式刷新（expectedGoodsFen 守卫）', async () => {
    await assert.rejects(() => order.place({ userId: uid2, sessionId: sStd.id, qty: 1, wantedBeans: 0, expectedGoodsFen: 19900 }), /价格已更新/)
    const r = await order.place({ userId: uid2, sessionId: sStd.id, qty: 1, wantedBeans: 0, expectedGoodsFen: 23920 })
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
  })

  await check('旧单兼容：规则停用后历史订单金额与快照不变', async () => {
    const r = await place(uid2, { sessionId: sStd.id })
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 0, reason: '停用验证历史单不变' }, ops))
    const o = await one('SELECT amount_goods, amount_pay, price_snapshot FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(Number(o.amount_goods), 23920); assert.equal(Number(o.amount_pay), 23920)
    assert.equal(snapOf(o.price_snapshot).effectiveGoodsFen, 23920)
    const qAfter = ok(await call('POST', '/c/freedom/quote', { sessionId: sStd.id, qty: 1 }, token(uid2)))
    assert.equal(qAfter.goods, 29900) // 新试算回原价
    await order.closeUnpaid(r.orderNo, 'd01-cleanup')
    ok(await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 1, reason: '隔离库恢复启用' }, ops))
  })

  await check('后台规则列表含审计字段，finance/readonly 可读不可写', async () => {
    const fin = jwtSign({ end: 'admin', role: 'finance', name: 'd01-fin' })
    const d = ok(await call('GET', '/admin/promo-discounts', null, fin))
    assert.ok(d.rows.every(x => x.operator && x.version >= 1))
    assert.equal((await call('POST', '/admin/promo-discounts', RULE({ name: 'D01财务禁写' }), fin)).code, 1003)
    assert.equal((await call('POST', '/admin/promo-discounts/status', { id: ruleId, status: 1, reason: 'readonly 权限边界' }, ro)).code, 1003)
  })

  console.log(`\nD01 专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
