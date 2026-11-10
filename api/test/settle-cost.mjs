// B04 结算单元专项（隔离库，需先起隔离 API 服务）：确认成本回填、部分退款冲减进结算、资金桥表恒等。
// 契约算例：199 商品、满100减50 实付149、部分核销后退门票8984 → 结算 total=5916、确认成本=12000；
//   桥表：收入149−退8984→净销售5916−成本120→负毛利保留；佣金同源不重复扣。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('settle-cost')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as pkg from '../src/domain/package.mjs'
import * as promo from '../src/domain/promo.mjs'
import { fullRefund } from '../src/domain/refund.mjs'
import { bizDay, settlementPeriod } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'st-qa' })
const fin = jwtSign({ end: 'admin', role: 'finance', name: 'st-fin' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'st-ops' })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()

let mid, pid, sid, uidA, uidB, itemTicket, itemSvc, tplT, tplS
try {
  await q('UPDATE promo_discount SET status = 0') // 定价清场（契约算例需精确售价）
  mid = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'ST店' + stamp, 'travel', 'STM' + stamp])).insertId
  pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','ST结算品',19900,?,1)", [mid])).insertId
  sid = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pid, date(0), 20, 1])).insertId
  for (const u of ['a', 'b']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['st-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else uidB = uid
  }
  // 成本供给项 + 套餐项（门票12000成本挂B01，讲解服务项）
  itemTicket = ok(await call('POST', '/admin/supply-items', { name: 'ST门票采购' + stamp, kind: 1, unit: 'per_person', unitCostFen: 12000, agreement: 'ST-AG-' + stamp, note: '隔离库结算算例成本', reason: '隔离库结算算例配置' }, ops)).id
  ok(await call('POST', `/admin/products/${pid}/supply`, { items: [{ itemId: itemTicket, qty: 1 }], reason: '隔离库结算算例挂载' }, ops))
  tplT = ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '门票项', kind: 1, merchantId: mid, unitPriceFen: 12000, qtyPerUnit: 1, supplyItemId: itemTicket, reason: '隔离库结算算例套餐项' }, ops)).id
  tplS = ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '讲解项', kind: 2, merchantId: mid, unitPriceFen: 7900, qtyPerUnit: 1, reason: '隔离库结算算例套餐项' }, ops)).id
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [mid, uidB]) // 店员绑定（服务项核销）
  // 自由豆券
  const fbudget = (await q('INSERT INTO freedom_budget(name,total,status) VALUES(?,?,1)', ['ST补贴', 100000])).insertId
  const FRULE = { name: 'ST满100减50', threshold: 10000, discount: 5000, from: date(-1) + ' 00:00:00', to: date(30) + ' 23:59:59', products: [], cities: [], channels: [], dates: [], perUser: 3, daily: 5 }
  const ftid = (await q('INSERT INTO freedom_template(name,budget_id,rule_json,status,version) VALUES(?,?,?,1,1)', ['ST满100减50', fbudget, JSON.stringify(FRULE)])).insertId
  for (const bid of [0, 1]) await q('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)', [uidA, bid, ftid, fbudget, JSON.stringify(FRULE)])
  await q('UPDATE freedom_budget SET committed=committed+10000 WHERE id=?', [fbudget])

  let no1, order1Id
  await check('契约算例下单：199+券50实付149，核销讲解项后退门票项8984', async () => {
    const right1 = Number((await one("SELECT id FROM freedom_right WHERE user_id=? AND status='available' ORDER BY id LIMIT 1", [uidA])).id)
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0, freedomRightId: right1 })
    no1 = r.orderNo
    await order.acceptPayment(no1, 'STPAY-' + stamp, true)
    const items = await q('SELECT * FROM order_item WHERE order_id = (SELECT id FROM orders WHERE order_no=?) ORDER BY id', [no1])
    order1Id = Number((await one('SELECT id FROM orders WHERE order_no=?', [no1])).id)
    const t = items.find(i => i.kind === 1), s = items.find(i => i.kind === 2)
    assert.equal(Number(t.cash_fen), 8984); assert.equal(Number(s.cash_fen), 5916)
    // 核销讲解服务项（本店）→ 退未核销门票项
    ok(await call('POST', `/m/items/${s.id}/redeem`, { idemKey: 'ST-SVC-' + stamp }, jwtSign({ end: 'm', uid: uidB, merchantId: mid, role: 3 })))
    const pr = ok(await call('POST', `/admin/orders/${no1}/partial-refund`, { itemIds: [t.id], reason: '隔离库结算算例部分退款' }, admin))
    assert.equal(pr.cashFen, 8984)
  })

  let settleId
  await check('结算生成：total=实付−部分退款=5916；确认成本回填12000；五口径恒等', async () => {
    // 完成订单（观察期结束→50）后生成结算
    await q("UPDATE orders SET status = 50, completed_at = NOW(3) WHERE order_no = ?", [no1])
    settleId = await promo.generateSettlement(mid, settlementPeriod(new Date()))
    assert.ok(Number(settleId) > 0)
    const st = await one('SELECT * FROM settlement WHERE id=?', [settleId])
    assert.equal(Number(st.total_amount), 5916, '结算基数=实付−部分退款冲减')
    assert.equal(Number(st.partial_deduct), 8984)
    assert.equal(Number(st.cost_total), 12000, '确认成本快照')
    assert.equal(Number(st.amt_fulfill) + Number(st.amt_service) + Number(st.amt_promoter) + Number(st.amt_beanbudget) + Number(st.amt_retained), Number(st.total_amount), '五口径恒等')
    const o = await one('SELECT cost_confirmed_fen, settlement_id FROM orders WHERE order_no=?', [no1])
    assert.equal(Number(o.cost_confirmed_fen), 12000, '订单确认成本回填')
    assert.equal(Number(o.settlement_id), Number(settleId))
  })

  await check('资金桥表：内部恒等（净销售=收入−全退−部分退；收益=毛利−佣金）；本单经济学含已退项成本冲减', async () => {
    const d = ok(await call('GET', `/admin/economics/bridge?from=${date(-1)}&to=${date(1)}`, null, fin))
    const byLabel = Object.fromEntries(d.rows.map(r => [r.label, r]))
    const income = byLabel['商品现金收入（总实收）'].fen, fullR = byLabel['− 全额退款冲减'].fen, partR = byLabel['− 部分退款冲减'].fen, net = byLabel['＝ 商品净销售额'].fen
    const cost = byLabel['− 直接成本'].fen, profit = byLabel['＝ 商品经营毛利'].fen, comm = byLabel['− 推广佣金'].fen, op = byLabel['＝ 已知费用后经营收益'].fen
    assert.equal(net, income + fullR + partR, '桥表内部恒等：净销售=收入−全退−部分退')
    if (cost != null) {
      assert.equal(profit, net + cost, '毛利=净销售−成本')
      assert.equal(op, profit + comm, '收益=毛利−佣金（同源不重复扣）')
    } else {
      assert.equal(profit, null); assert.equal(op, null)
      assert.ok(byLabel['− 直接成本'].note.includes('未维护'), '缺成本单提示')
    }
    assert.ok(byLabel['（另列）平台承担补贴责任累计'].fen >= 5000)
    assert.ok(byLabel['− 直接成本'].caliber.includes('确认成本'), '确认成本口径标注')
    assert.equal((await call('GET', `/admin/economics/bridge?from=${date(-1)}&to=${date(1)}`, null, ops)).code, 1003)
    assert.equal((await call('GET', '/admin/economics/bridge?from=bad&to=bad', null, fin)).code, 1001)
    // 本单经济学（链上安全）：netSales=5916、部分退8984；已退项成本同步冲减→剩余成本0
    const e = ok(await call('GET', `/admin/orders/${no1}/economics`, null, fin))
    assert.equal(e.economics.netSalesFen, 5916)
    assert.equal(e.economics.partialRefundFen, 8984)
    assert.equal(e.economics.profitFen, 5916, '毛利=净销售5916−已退项成本冲减12000→0')
    // 隔离库（桥表收入恰为本单实收时）才做契约绝对值断言
    if (income === 14900) {
      assert.equal(fullR, 0); assert.equal(partR, -8984); assert.equal(cost, 0, '已退项成本同步冲减')
    }
  })

  await check('全退订单不进结算、确认成本不回填；桥表冲减为0（实付原额）', async () => {
    const r2 = await order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0 })
    const no2 = r2.orderNo
    await order.acceptPayment(no2, 'STPAY2-' + stamp, true)
    await fullRefund({ orderNo: no2, reason: '隔离库全退不进结算验证', operator: 'st-qa' })
    const o = await one('SELECT status, cost_confirmed_fen, settlement_id FROM orders WHERE order_no=?', [no2])
    assert.equal(Number(o.status), 70); assert.equal(o.cost_confirmed_fen, null); assert.equal(o.settlement_id, null)
    // 再次生成结算：只含已完成单（幂等返回）
    const sid2 = await promo.generateSettlement(mid, settlementPeriod(new Date()))
    assert.equal(Number(sid2), Number(settleId), '全退单不产生新结算单')
  })

  await check('桥表快照只增不改：两次查询落两行且行数递增', async () => {
    const n1 = Number((await one('SELECT COUNT(*) n FROM econ_bridge')).n)
    ok(await call('GET', `/admin/economics/bridge?from=${date(-1)}&to=${date(1)}`, null, fin))
    const n2 = Number((await one('SELECT COUNT(*) n FROM econ_bridge')).n)
    assert.equal(n2, n1 + 1)
  })

  console.log(`\n结算成本口径专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
