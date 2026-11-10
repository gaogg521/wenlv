// B01/B12 供给项台账 + 成本/售价/毛利/毛利率/经营收益 口径专项测试（隔离库，需先起隔离 API 服务）
// 契约算例：售价199成本120→毛利79/39.70%；满100减50→现金149→29/19.46%；两单合计348/240/108/31.03%。
// 覆盖：成本缺失不可计算（不默认0）、零成本须依据、改成本不改旧单、房晚/每单单位、全退冲减、
//       负毛利保留、汇总毛利率≠平均、权限隔离（城市合伙人/游客/推广不可见）、游客接口无成本泄露。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('supply-cost')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as bean from '../src/domain/bean.mjs'
import * as supply from '../src/domain/supply.mjs'
import { fullRefund } from '../src/domain/refund.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'sc-qa' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'sc-ops' })
const fin = jwtSign({ end: 'admin', role: 'finance', name: 'sc-fin' })
const ro = jwtSign({ end: 'admin', role: 'readonly', name: 'sc-ro' })
const city = jwtSign({ end: 'admin', role: 'city_partner', name: 'sc-city', scopeCity: '310118' })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()
const snapOf = v => typeof v === 'string' ? JSON.parse(v) : v

let mid, pid, sid, itemTicket, uidA, uidB, uidC
const ITEM = over => ({ name: '门票采购' + stamp, kind: 1, unit: 'per_person', unitCostFen: 12000, refRetailFen: null, validFrom: null, validTo: null, agreement: 'QA-AG-' + stamp, note: '隔离库采购协议依据', reason: '隔离库供给项创建测试依据', ...over })

try {
  // 定价清场：链上可能有其他用例留下的全品折扣规则，契约算例要求精确售价 199/149
  await q('UPDATE promo_discount SET status=0')
  mid = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'SC商户' + stamp, 'travel', 'SCM' + stamp])).insertId
  for (const u of ['a', 'b', 'c']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['sc-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else if (u === 'b') uidB = uid; else uidC = uid
  }

  await check('供给项校验：零成本须依据、readonly 只读、城市合伙人不可见不可写', async () => {
    assert.equal((await call('POST', '/admin/supply-items', ITEM({ unitCostFen: 0, note: '' }), ops)).code, 1001)
    assert.equal((await call('POST', '/admin/supply-items', ITEM(), ro)).code, 1003)
    assert.equal((await call('GET', '/admin/supply-items', null, city)).code, 1003)
    assert.equal((await call('POST', '/admin/supply-items', ITEM(), city)).code, 1003)
    assert.equal((await call('POST', '/admin/supply-items', ITEM({ validFrom: date(5), validTo: date(1) }), ops)).code, 1001)
    itemTicket = ok(await call('POST', '/admin/supply-items', ITEM(), ops)).id
    const list = ok(await call('GET', '/admin/supply-items', null, fin))
    assert.ok(list.rows.some(x => Number(x.id) === Number(itemTicket) && x.unit_cost_fen === 12000))
    assert.ok(!JSON.stringify(list).includes('bank_account'))
  })

  await check('产品挂载成本构成；cost-preview 实时预计毛利（199售价−120成本=79/39.70%）', async () => {
    pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','SC口径品',19900,?,1)", [mid])).insertId
    sid = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pid, date(60), 20, 1])).insertId
    ok(await call('POST', `/admin/products/${pid}/supply`, { items: [{ itemId: itemTicket, qty: 1 }], reason: '隔离库挂载门票成本' }, ops))
    const prev = ok(await call('GET', `/admin/products/${pid}/cost-preview`, null, ops))
    assert.equal(prev.breakdown.perUnitFen, 12000)
    const row = prev.rows.find(r => Number(r.sessionId) === Number(sid))
    assert.equal(row.unitFen, 19900); assert.equal(row.costFen, 12000)
    assert.equal(row.profitFen, 7900); assert.equal(row.marginPct, 39.7) // 79÷199=39.70%
    assert.equal((await call('GET', `/admin/products/${pid}/cost-preview`, null, city)).code, 1003)
  })

  // 官方补贴：满100减50（发给 uidA），供契约第二例
  const fbudget = (await q('INSERT INTO freedom_budget(name,total,status) VALUES(?,?,1)', ['SC补贴预算', 100000])).insertId
  const FRULE = { name: 'SC满100减50', threshold: 10000, discount: 5000, from: date(-1) + ' 00:00:00', to: date(30) + ' 23:59:59', products: [], cities: [], channels: [], dates: [], perUser: 3, daily: 5 }
  const ftid = (await q('INSERT INTO freedom_template(name,budget_id,rule_json,status,version) VALUES(?,?,?,1,1)', ['SC满100减50', fbudget, JSON.stringify(FRULE)])).insertId
  await q('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)', [uidA, 0, ftid, fbudget, JSON.stringify(FRULE)])
  const rightA = Number((await one('SELECT id FROM freedom_right WHERE user_id=?', [uidA])).id)
  await q('UPDATE freedom_budget SET committed=committed+5000 WHERE id=?', [fbudget])

  let orderFull, orderCoupon // 契约两单
  await check('下单成本快照：199售价/120成本落 cost_snapshot；orderEconomics=79/39.70%', async () => {
    orderFull = (await order.place({ userId: uidC, sessionId: sid, qty: 1, wantedBeans: 0 })).orderNo
    await order.acceptPayment(orderFull, 'SC1-' + stamp, true)
    const o = await one('SELECT * FROM orders WHERE order_no=?', [orderFull])
    assert.equal(Number(o.cost_total_fen), 12000)
    const e = supply.orderEconomics(o)
    assert.equal(e.goodsCashFen, 19900); assert.equal(e.costFen, 12000)
    assert.equal(e.profitFen, 7900); assert.equal(e.marginPct, 39.7)
    const det = ok(await call('GET', `/admin/orders/${orderFull}/economics`, null, fin))
    assert.equal(det.economics.profitFen, 7900); assert.ok(det.costSnapshot.items.length === 1)
    assert.equal(det.economics.costConfirmedFen, null) // 确认成本未接入（B04）
    assert.equal((await call('GET', `/admin/orders/${orderFull}/economics`, null, ops)).code, 1003) // 经营明细仅 super/finance
  })

  await check('契约第二例：满100减50 现金149 → 毛利29/19.46%（补贴50另列不混入）', async () => {
    orderCoupon = (await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0, freedomRightId: rightA })).orderNo
    await order.acceptPayment(orderCoupon, 'SC2-' + stamp, true)
    const o = await one('SELECT * FROM orders WHERE order_no=?', [orderCoupon])
    assert.equal(Number(o.amount_pay), 14900)
    const e = supply.orderEconomics(o)
    assert.equal(e.goodsCashFen, 14900); assert.equal(e.freedomDiscountFen, 5000)
    assert.equal(e.profitFen, 2900); assert.equal(e.marginPct, 19.46) // 29÷149=19.4634→19.46
  })

  await check('契约合计：两单净销售348/成本240/毛利108/汇总毛利率31.03%（非平均）', async () => {
    const o1 = await one('SELECT * FROM orders WHERE order_no=?', [orderFull])
    const o2 = await one('SELECT * FROM orders WHERE order_no=?', [orderCoupon])
    const s = supply.summarizeEconomics([o1, o2], new Map())
    assert.equal(s.netSalesFen, 34800); assert.equal(s.costFen, 24000)
    assert.equal(s.profitFen, 10800); assert.equal(s.marginPct, 31.03) // 108÷348=31.034→31.03
    assert.equal(s.byProduct.length, 1); assert.equal(s.byCity.length, 1)
    assert.equal(s.byProduct[0].profitFen, 10800); assert.equal(s.byCity[0].marginPct, 31.03)
  })

  await check('改成本不改旧单：停用供给项后新单按新口径，历史订单快照不变', async () => {
    const item2 = ok(await call('POST', '/admin/supply-items', ITEM({ name: '新协议门票' + stamp, unitCostFen: 15000, note: '新协议成本上调依据' }), ops)).id
    ok(await call('POST', `/admin/products/${pid}/supply`, { items: [{ itemId: item2, qty: 1 }], reason: '换新协议供给项' }, ops))
    const o = await one('SELECT cost_total_fen, cost_snapshot FROM orders WHERE order_no=?', [orderFull])
    assert.equal(Number(o.cost_total_fen), 12000) // 旧单仍按120
    const snap = snapOf(o.cost_snapshot)
    assert.equal(snap.items[0].itemId, itemTicket)
    const no = (await order.place({ userId: uidC, sessionId: sid, qty: 1, wantedBeans: 0 })).orderNo
    await order.acceptPayment(no, 'SC3-' + stamp, true)
    assert.equal(Number((await one('SELECT cost_total_fen FROM orders WHERE order_no=?', [no])).cost_total_fen), 15000)
    await order.closeUnpaid(no, 'sc-cleanup') // 不会执行（已支付）——改为直接全额退款纳入冲减用例
    global.scOrder3 = no
  })

  await check('房晚与每单单位：per_order 固定 + room_night 随人数放大', async () => {
    const iRoom = ok(await call('POST', '/admin/supply-items', ITEM({ name: '民宿房晚' + stamp, unit: 'room_night', unitCostFen: 8000, note: '隔离库房价依据' }), ops)).id
    const iFixed = ok(await call('POST', '/admin/supply-items', ITEM({ name: '保险采购' + stamp, unit: 'per_order', unitCostFen: 3000, note: '隔离库固定成本依据' }), ops)).id
    ok(await call('POST', `/admin/products/${pid}/supply`, { items: [{ itemId: iRoom, qty: 2 }, { itemId: iFixed, qty: 1 }], reason: '混合单位验证' }, ops))
    const no = (await order.place({ userId: uidC, sessionId: sid, qty: 3, wantedBeans: 0 })).orderNo
    await order.acceptPayment(no, 'SC4-' + stamp, true)
    // room_night: 8000×2×3=48000；per_order: 3000×1=3000 → 51000
    assert.equal(Number((await one('SELECT cost_total_fen FROM orders WHERE order_no=?', [no])).cost_total_fen), 51000)
    global.scOrder4 = no
  })

  await check('全退订单冲减：净销售额与成本计0，退款另列；负毛利保留并提示', async () => {
    await fullRefund({ orderNo: global.scOrder3, reason: '隔离库全额退款冲减验证', operator: 'sc-qa' })
    const o3 = await one('SELECT * FROM orders WHERE order_no=?', [global.scOrder3])
    const e3 = supply.orderEconomics(o3)
    assert.equal(e3.netSalesFen, 0); assert.equal(e3.costFen, 0); assert.equal(e3.refunded, true)
    // 负毛利单：当前构成 per_order 3000 + room_night 8000×2=19000/份 > 现价10000
    const sidNeg = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,10000,1)', [pid, date(70), 20, 1])).insertId
    const noNeg = (await order.place({ userId: uidC, sessionId: sidNeg, qty: 1, wantedBeans: 0 })).orderNo
    await order.acceptPayment(noNeg, 'SCN-' + stamp, true)
    const oNeg = await one('SELECT * FROM orders WHERE order_no=?', [noNeg])
    const eNeg = supply.orderEconomics(oNeg)
    assert.equal(eNeg.profitFen, -9000); assert.equal(eNeg.marginPct, -90)
    const s = supply.summarizeEconomics([oNeg], new Map())
    assert.equal(s.negativeProfit, 1)
    global.scOrderNeg = noNeg
  })

  await check('看板汇总=明细之和；缺失成本不按0计；待支付/退款中不计入实际口径', async () => {
    // 造一张成本缺失产品订单
    const pid2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','320508','theme','SC缺成本品',9900,?,1)", [mid])).insertId
    const sid2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,9900,1)', [pid2, date(60), 20, 1])).insertId
    const noMiss = (await order.place({ userId: uidC, sessionId: sid2, qty: 1, wantedBeans: 0 })).orderNo
    await order.acceptPayment(noMiss, 'SCM-' + stamp, true)
    const o = await one('SELECT * FROM orders WHERE order_no=?', [noMiss])
    assert.equal(o.cost_total_fen, null)
    const e = supply.orderEconomics(o)
    assert.equal(e.costKnown, false); assert.equal(e.profitFen, null); assert.equal(e.marginPct, null)
    // 看板（含全部场景单）
    const d = ok(await call('GET', `/admin/economics/dashboard?from=${date(-1)}&to=${date(1)}`, null, fin))
    assert.ok(d.costMissing >= 1, '缺成本单计数≥1')
    assert.equal(d.profitFen, null, '存在缺失成本时汇总毛利不可计算')
    assert.equal(d.confirmed.status, 'not_available')
    assert.ok(d.incomeNote.includes('不冒充'))
    // 排除缺失单的产品维度：与明细一致
    const dP = ok(await call('GET', `/admin/economics/dashboard?from=${date(-1)}&to=${date(1)}&productId=${pid}`, null, fin))
    const expectRows = await q(`SELECT * FROM orders WHERE product_id=? AND status IN (20,30,40,50,70) AND paid_at>=? AND paid_at<? + INTERVAL 1 DAY`, [pid, date(-1) + ' 00:00:00', date(1)])
    const s = supply.summarizeEconomics(expectRows, new Map())
    assert.equal(dP.netSalesFen, s.netSalesFen)
    if (!s.costMissing) assert.equal(dP.profitFen, s.profitFen)
    assert.equal((await call('GET', `/admin/economics/dashboard?from=${date(-1)}&to=${date(1)}`, null, ro)).code, 1003)
    assert.equal((await call('GET', `/admin/economics/dashboard?from=${date(-1)}&to=${date(1)}`, null, city)).code, 1003)
    assert.equal((await call('GET', '/admin/economics/dashboard?from=bad&to=bad', null, fin)).code, 1001)
  })

  await check('游客接口无成本泄露：详情/列表/订单 JSON 不含供给项与成本字段', async () => {
    const det = JSON.stringify(ok(await call('GET', '/c/tours/' + pid, null, token(uidA))))
    const list = JSON.stringify(ok(await call('GET', '/c/tours?cat=theme', null, token(uidA))))
    for (const s of [det, list]) {
      assert.ok(!/"[a-z_]*cost[a-z_]*"s*:/.test(s), '游客响应含 cost 字段')
      assert.ok(!/"supply[a-z_]*"s*:/i.test(s), '游客响应含 supply 字段')
      assert.ok(!/"price_snapshot"|"cost_snapshot"/.test(s), '游客响应含快照字段')
      assert.ok(!s.includes('采购'), '游客响应含成本表述')
    }
    const ord = JSON.stringify(ok(await call('GET', '/c/orders/' + orderFull, null, token(uidC))))
    assert.ok(!/"[a-z_]*cost[a-z_]*"s*:/.test(ord), '订单响应含 cost 字段')
    assert.ok(!/"supply[a-z_]*"s*:/i.test(ord), '订单响应含 supply 字段')
  })

  console.log(`\n供给成本口径专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
