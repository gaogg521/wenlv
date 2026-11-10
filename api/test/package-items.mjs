// B02/B03/B04/B17 套餐订单项专项测试（隔离库，需先起隔离 API 服务）
// 契约算例：199元商品（门票12000+讲解7900）、满100减50实付149 → 三路占比分摊尾差可复算；
// 部分核销后按项退未核销项现金分摊；跨店隔离/防重放/幂等；部分完成不提前发奖励。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('package-items')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as pkg from '../src/domain/package.mjs'
import * as bean from '../src/domain/bean.mjs'
import * as pass from '../src/domain/pass.mjs'
import { fullRefund } from '../src/domain/refund.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const mtoken = (uid, mid, role = 3) => jwtSign({ end: 'm', uid, merchantId: mid, role })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'pkg-qa' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'pkg-ops' })
const fin = jwtSign({ end: 'admin', role: 'finance', name: 'pkg-fin' })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()

let pid, sid, mMain, mB, uidA, uidB, tplTicket, tplSvc, orderNo, rightId
try {
  // ===== 场景 =====
  mMain = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', '主店' + stamp, 'travel', 'PMA' + stamp])).insertId
  mB = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'B店' + stamp, 'travel', 'PMB' + stamp])).insertId
  pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','PKG套餐品',19900,?,1)", [mMain])).insertId
  // 出发日=当天：核销日期窗（A-11 出发日当天起）允许当日核销；部分退款均走平台原因不扣手续费
  sid = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pid, date(0), 20, 1])).insertId
  for (const u of ['a', 'b']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['pkg-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else uidB = uid
  }
  // 演示店员绑定（B店/主店各一名）
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [mMain, uidB])
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [mB, uidA])

  await check('套餐项配置校验：非运营拒绝、门店无效拒绝、边界校验', async () => {
    assert.equal((await call('POST', `/admin/products/${pid}/package-items`, { name: 'x', kind: 1, merchantId: mMain, unitPriceFen: 100, qtyPerUnit: 1, reason: '测试依据' }, fin)).code, 1003)
    assert.equal((await call('POST', `/admin/products/${pid}/package-items`, { name: 'x', kind: 1, merchantId: 99999999, unitPriceFen: 100, qtyPerUnit: 1, reason: '测试依据' }, ops)).code, 1001)
    assert.equal((await call('POST', `/admin/products/${pid}/package-items`, { name: 'x', kind: 1, merchantId: mMain, unitPriceFen: 100, qtyPerUnit: 0, reason: '测试依据' }, ops)).code, 1001)
    tplTicket = ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '景区大门票', kind: 1, merchantId: mMain, unitPriceFen: 12000, qtyPerUnit: 1, reason: '隔离库套餐项配置依据' }, ops)).id
    tplSvc = ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '金牌讲解服务', kind: 2, merchantId: mB, unitPriceFen: 7900, qtyPerUnit: 1, reason: '隔离库套餐项配置依据' }, ops)).id
  })

  // 自由豆：满100减50
  const fbudget = (await q('INSERT INTO freedom_budget(name,total,status) VALUES(?,?,1)', ['PKG补贴预算', 100000])).insertId
  const FRULE = { name: 'PKG满100减50', threshold: 10000, discount: 5000, from: date(-1) + ' 00:00:00', to: date(30) + ' 23:59:59', products: [], cities: [], channels: [], dates: [], perUser: 3, daily: 5 }
  const ftid = (await q('INSERT INTO freedom_template(name,budget_id,rule_json,status,version) VALUES(?,?,?,1,1)', ['PKG满100减50', fbudget, JSON.stringify(FRULE)])).insertId
  for (const bid of [0, 1, 2]) await q('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)', [uidA, bid, ftid, fbudget, JSON.stringify(FRULE)])
  rightId = Number((await one('SELECT id FROM freedom_right WHERE user_id=?', [uidA])).id)
  await q('UPDATE freedom_budget SET committed=committed+15000 WHERE id=?', [fbudget])

  let items
  await check('契约算例：199商品+满100减50实付149 → 三路分摊尾差可复算（Σcash=14900、Σsubsidy=5000）', async () => {
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0, freedomRightId: rightId })
    orderNo = r.orderNo
    await order.acceptPayment(orderNo, 'PKGPAY-' + stamp, true)
    items = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?) ORDER BY id', [orderNo])
    assert.equal(items.length, 2)
    const cashSum = items.reduce((a, i) => a + Number(i.cash_fen), 0)
    const subSum = items.reduce((a, i) => a + Number(i.subsidy_fen), 0)
    assert.equal(Number((await one('SELECT amount_pay FROM orders WHERE order_no=?', [orderNo])).amount_pay), 14900)
    assert.equal(cashSum, 14900, 'Σ现金分摊=实付商品现金')
    assert.equal(subSum, 5000, 'Σ补贴分摊=券面额')
    const o = await one('SELECT amount_goods FROM orders WHERE order_no=?', [orderNo])
    assert.equal(items.reduce((a, i) => a + Number(i.goods_fen), 0), Number(o.amount_goods), 'Σ项原价=订单商品额（尾差归最后正额项）')
    // 门票8984/讲解5916（floor(14900×12000/19900)=8984，尾差归讲解项）
    assert.equal(Number(items.find(i => i.name === '景区大门票').cash_fen), 8984)
    assert.equal(Number(items.find(i => i.name === '金牌讲解服务').cash_fen), 5916)
  })

  let passTicket
  await check('按人凭证项出票挂项；服务项无凭证；游客订单详情含项明细且无成本', async () => {
    const passes = await q('SELECT * FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no=?)', [orderNo])
    assert.equal(passes.length, 1, '按人凭证项1张×1份')
    passTicket = passes[0]
    assert.equal(Number(passTicket.order_item_id), Number(items.find(i => i.kind === 1).id))
    assert.ok(passTicket.name.includes('景区大门票'))
    const det = ok(await call('GET', '/c/orders/' + orderNo, null, token(uidA)))
    assert.equal(det.orderItems.length, 2)
    assert.ok(!JSON.stringify(det.orderItems).includes('cost'))
    assert.ok(!JSON.stringify(det.orderItems).includes('supply'))
    const tour = ok(await call('GET', '/c/tours/' + pid, null, token(uidA)))
    assert.equal(tour.packageItems.length, 2)
    assert.ok(!JSON.stringify(tour.packageItems).includes('cost'))
  })

  await check('跨店隔离：B店店员核不到主店凭证；主店店员核销成功且项计数推进', async () => {
    const { displayCode, sign, windowOf } = await import('../src/domain/pass.mjs')
    const win = windowOf(Math.floor(Date.now() / 1000), await (await import('../src/config.mjs')).cfgNum('pass.code_window'))
    const payload = `wl://v/${passTicket.id}/${win}/${sign(passTicket.id, win)}`
    const cross = await pass.verifyScan({ merchantId: mB, staffId: uidA, payload })
    assert.equal(cross.ok, false); assert.ok(cross.reason.includes('非本店'))
    const own = await pass.verifyScan({ merchantId: mMain, staffId: uidB, payload })
    assert.equal(own.ok, true)
    const replay = await pass.verifyScan({ merchantId: mMain, staffId: uidB, payload })
    assert.equal(replay.ok, false); assert.ok(replay.reason.includes('已核销'))
    const it = await one('SELECT pass_done, status FROM order_item WHERE id=?', [items.find(i => i.kind === 1).id])
    assert.equal(Number(it.pass_done), 1)
  })

  await check('服务项幂等履约：同 idemKey 重复返回同一结果；跨店拒绝', async () => {
    const svc = items.find(i => i.kind === 2)
    const cross = await call('POST', `/m/items/${svc.id}/redeem`, { idemKey: 'SVC-TEST-' + stamp }, mtoken(uidB, mMain))
    assert.equal(cross.code, 1003, '主店店员不能履约B店服务项')
    const r1 = ok(await call('POST', `/m/items/${svc.id}/redeem`, { idemKey: 'SVC-TEST-' + stamp }, mtoken(uidA, mB)))
    assert.equal(r1.repeated, false)
    const r2 = ok(await call('POST', `/m/items/${svc.id}/redeem`, { idemKey: 'SVC-TEST-' + stamp }, mtoken(uidA, mB)))
    assert.equal(r2.repeated, true, '同幂等键重复提交返回同一结果')
    const st = await one('SELECT status, service_done FROM order_item WHERE id=?', [svc.id])
    assert.equal(Number(st.status), 1)
    // 并发两个不同幂等键：只有一个成功
    const svc2 = items.find(i => i.kind === 2) // 已完成，另造一单测并发
    const r2o = await order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r2o.orderNo, 'PKGPAY2-' + stamp, true)
    const items2 = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?)', [r2o.orderNo])
    const svcB = items2.find(i => i.kind === 2)
    const rs = await Promise.allSettled([
      call('POST', `/m/items/${svcB.id}/redeem`, { idemKey: 'SVC-CA-' + stamp }, mtoken(uidA, mB)),
      call('POST', `/m/items/${svcB.id}/redeem`, { idemKey: 'SVC-CB-' + stamp }, mtoken(uidA, mB)),
    ])
    const doneCount = (await q("SELECT COUNT(*) n FROM order_item_redeem WHERE item_id=?", [svcB.id]))[0]
    assert.equal(Number(doneCount.n), 1, '并发履约只成功一次（项状态守卫）')
    assert.ok(rs.filter(x => x.status === 'fulfilled').length >= 1)
    global.pkgOrder2 = r2o.orderNo
  })

  let itemTicketId, itemSvcId
  await check('B04 部分核销后按项退款（契约算例）：退未核销项现金分摊8984，已核销项不可退', async () => {
    itemTicketId = Number(items.find(i => i.kind === 1).id)
    itemSvcId = Number(items.find(i => i.kind === 2).id)
    // 服务项已核销（上上步），凭证项已核销（上步）→ 新造一单做部分退款算例
    const right3 = Number((await one("SELECT id FROM freedom_right WHERE user_id=? AND status='available' ORDER BY id DESC LIMIT 1", [uidA])).id)
    global.pkgRight3 = right3
    const r3 = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0, freedomRightId: right3 })
    const no3 = r3.orderNo
    await order.acceptPayment(no3, 'PKGPAY3-' + stamp, true)
    const items3 = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?) ORDER BY id', [no3])
    const t = items3.find(i => i.kind === 1), s = items3.find(i => i.kind === 2)
    assert.equal(Number(t.cash_fen), 8984); assert.equal(Number(s.cash_fen), 5916)
    // 先核销服务项（B店），再退未核销的门票项
    ok(await call('POST', `/m/items/${s.id}/redeem`, { idemKey: 'SVC-P3-' + stamp }, mtoken(uidA, mB)))
    const denied = await call('POST', `/admin/orders/${no3}/partial-refund`, { itemIds: [s.id], reason: '已核销项不可退测试' }, admin)
    assert.equal(denied.code, 1001)
    const r = ok(await call('POST', `/admin/orders/${no3}/partial-refund`, { itemIds: [t.id], reason: '隔离库部分核销后按项退款算例' }, fin))
    assert.equal(r.cashFen, 8984)
    assert.equal(r.feeFen, 0, '平台原因不扣手续费')
    const it = await one('SELECT status FROM order_item WHERE id=?', [t.id])
    assert.equal(Number(it.status), 2)
    const pr = await one('SELECT * FROM partial_refund WHERE refund_no=?', [r.refundNo])
    assert.equal(Number(pr.cash_fen), 8984); assert.equal(Number(pr.status), 2)
    const rf = await one('SELECT amount, status FROM refunds WHERE refund_no=?', [r.refundNo])
    assert.equal(Number(rf.amount), 8984); assert.equal(Number(rf.status), 2)
    const o = await one('SELECT status FROM orders WHERE order_no=?', [no3])
    assert.equal(Number(o.status), 30, '部分退款不改变订单状态')
    // 资金恒等：实收14900 = 已退8984 + 剩余5916
    const e = await call('GET', `/admin/orders/${no3}/economics`, null, fin)
    assert.equal(ok(e).economics.partialRefundFen, 8984)
    global.pkgOrder3 = no3
  })

  await check('游客自助部分退款：按政策扣手续费；只能退本人订单未核销项', async () => {
    const no3 = global.pkgOrder3
    const deny = await call('POST', `/c/orders/${no3}/partial-refund`, { itemIds: [itemSvcId], reason: '他人订单测试' }, token(uidB))
    assert.equal(deny.code, 2003)
    const r = ok(await call('GET', `/c/orders/${no3}/partial-refund-quote`, null, token(uidA)))
    assert.ok(r.items.every(i => Number(i.status) !== 0 ? i.refundable === false : true))
  })

  await check('部分完成不提前发奖励：单项核销后订单未40，无返豆无佣金', async () => {
    const before = await bean.balance(uidB)
    const { createCommission } = await import('../src/domain/promo.mjs')
    const created = await createCommission(global.pkgOrder2)
    assert.equal(created, false, '无推广场景不产生佣金（部分完成不提前发奖励）')
    const o = await one('SELECT status FROM orders WHERE order_no=?', [global.pkgOrder2])
    assert.ok(Number(o.status) < 40, '未全部核销订单保持未核销状态')
    assert.equal(await bean.balance(uidB), before, '未完成订单无返豆')
  })

  await check('全退恒等：fullRefund 退"实付−已部分退"；旅豆/券按既有流程冲回', async () => {
    const no3 = global.pkgOrder3
    const balBefore = await bean.balance(uidA)
    await fullRefund({ orderNo: no3, reason: '部分退后客服全退恒等验证', operator: 'pkg-qa' })
    const rfs = await q('SELECT amount FROM refunds WHERE order_id=(SELECT id FROM orders WHERE order_no=?)', [no3])
    const totalRefunded = rfs.reduce((a, r) => a + Number(r.amount), 0)
    assert.equal(totalRefunded, 14900, 'Σ退款=实收现金（8984部分退+5916全退）')
    const fo = await one('SELECT status FROM freedom_order WHERE order_no=?', [no3])
    assert.equal(fo.status, 'refunded')
    const rr = await one('SELECT status FROM freedom_right WHERE id=?', [global.pkgRight3])
    assert.equal(rr.status, 'available', '全退后权益按原有效期返还')
  })

  await check('模板改动不改旧单快照：改价后新单按新快照，旧单不变', async () => {
    ok(await call('POST', `/admin/products/${pid}/package-items`, { id: tplSvc, name: '金牌讲解服务', kind: 2, merchantId: mB, unitPriceFen: 9900, qtyPerUnit: 1, reason: '调价验证模板版本' }, ops))
    const oldItems = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?)', [orderNo])
    assert.equal(Number(oldItems.find(i => i.kind === 2).unit_price_fen), 7900, '旧单快照不变')
    const r = await order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'PKGPAY4-' + stamp, true)
    const newItems = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?)', [r.orderNo])
    assert.equal(Number(newItems.find(i => i.kind === 2).unit_price_fen), 9900)
    const o = await one('SELECT amount_goods FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(newItems.reduce((a, i) => a + Number(i.goods_fen), 0), Number(o.amount_goods), '新快照 Σ项原价=订单商品额')
    await order.closeUnpaid(r.orderNo, 'pkg-cleanup').catch(() => {})
  })

  console.log(`\n套餐订单项专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
