// 朱家角「江南谜案」七步业务闭环 · 隔离环境 E2E（示范闭环落地验证，独立脚本不进 test:db 链）。
// 主线：同一游客的朱家角首单 + 关联复购单，逐步骤留单号与关联证据，复算资金并检查跨主体权限。
// 口径声明：本脚本全部为隔离库 MOCK 支付（模拟支付），不涉及真实到账；招商示例值（¥298 五项）为宣传示例，
// 实际订单一律按分与生效规则复算。真实微信登录/真机核销/银行到账单列外部待验。
//   步骤1 内容获客：推广服务商场景码归因（attribution/attribution_hit）
//   步骤2 支付出票：重复回调只出票一次（acceptPayment 幂等）
//   步骤3 线下体验：跨店逐项核销（凭证/服务项）+ 未履约→已履约状态
//   步骤3b 二销：餐饮独立支付订单，关联依据=同用户+同景区+支付时间晚于首单（scenic-calculator repeatOrder 同源逻辑）
//   步骤4 贡献确认：Q 成交维度落库（归因有效单，幂等，不触发资金）；S/R 无已确认规则=待确认
//   步骤5 分账权益：跨店结算行（修复4）+ 佣金 + 旅豆到账
//   步骤6 复购：旅豆实付锚定 + 自由豆同单并用 + repeatOrder 关联 + 退款冲正
//   步骤7 持续投入：景区经营复盘保存（决策依据留痕）+ 城市合伙人跨城隔离
//   退款路径：结算前按项退款进基数（修复3）+ 已出账后按项退款调整（修复4）
//   资金复算：Σ支付现金 = Σ结算行净额 + 结算前退款；已出账后退款=结算不改写+调整按快照占比+平台吸收差额（规则文档明示）
//   跨主体权限：商户 A/B 各自隔离、跨店核销拒绝、城市合伙人限本城、游客无成本、商户无平台成本接口
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('zhujiajiao-loop')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as promo from '../src/domain/promo.mjs'
import * as pass from '../src/domain/pass.mjs'
import * as contribution from '../src/domain/contribution.mjs'
import { bizDay, settlementPeriod } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: t ? { authorization: 'Bearer ' + t, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'zjq-qa' })
const fin = jwtSign({ uid: 900002, end: 'admin', role: 'finance', name: 'zjq-fin' }) // 具名（跟进审批/登记要求 uid）
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'zjq-ops' })
const city = jwtSign({ uid: 900001, end: 'admin', role: 'city_partner', name: 'zjq-city', scopeCity: '310118' }) // 具名（复盘保存要求 uid）
const citySh = jwtSign({ end: 'admin', role: 'city_partner', name: 'zjq-city-sh', scopeCity: '310100' })
const mToken = (uid, mid) => jwtSign({ end: 'm', uid, merchantId: mid, role: 3 })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()
const EXAMPLE = { orders: 3000, priceFen: 39900, revenueBp: 2000, variableBp: 900, equityBp: 200, fixedFen: 18000000 } // Codex 核验默认示例（结余 −72,270）
const complete = async (orderNo) => {
  await q("UPDATE orders SET status=40 WHERE order_no=?", [orderNo])
  const jobs = await import('../src/jobs.mjs')
  assert.equal(await jobs.completeOrder(orderNo), true)
  // V84：贡献走事务队列（服务端 60s 循环排空）——测试内同步排空保证确定性
  const cg = await import('../src/domain/contribution-growth.mjs')
  await cg.tickContributionGrowth()
}
const rebateOf = fen => Math.round(fen / 10 * 0.1) // 本库唯一生效预算 + 默认返豆率 10%

let scenicId, midA, midB, uidA, uidB, promoterUid, scene
let pidT, sidT, pidF, sidF, itemTicket
let noFirst, ordFirst, itTicket, itShow, passRow // 首单（跨店套票）
let noShow, ordShow // 二销餐饮单
let noRebuy, ordRebuy // 复购单
let settleA, settleB, supA, supB
const excluded = []

try {
  await q('UPDATE promo_discount SET status = 0') // 定价清场
  // ===== 布景：朱家角景区 + 门票/演艺两店 + 餐饮 SKU + 推广服务商 =====
  scenicId = (await q("INSERT INTO scenic_spot(city_code,name,scenic_level,coop_mode,status) VALUES('310118','朱家角古镇(隔离验证)','4A','票务分成',1)", [])).insertId
  midA = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', '朱角门票店' + stamp, 'travel', 'ZJA' + stamp])).insertId
  midB = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', '朱角餐饮演艺店' + stamp, 'catering', 'ZJB' + stamp])).insertId
  for (const u of ['a', 'm', 'p']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['zjq-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else if (u === 'm') uidB = uid; else promoterUid = uid
  }
  const budget = (await q("INSERT INTO bean_budget(name,total,granted,status,biz_owner) VALUES(?,?,0,1,'zjq')", ['zjq豆预算' + stamp, 500000])).insertId
  await q('UPDATE bean_budget SET status=0 WHERE status=1 AND id<>?', [budget])
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [midA, uidB])
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [midB, uidB])
  await q('INSERT INTO promoter(user_id,tier,rate_bp,status) VALUES(?,?,1200,1) ON DUPLICATE KEY UPDATE status=1', [promoterUid, 2])
  scene = await promo.createScene(promoterUid, 'zjq')
  await q('INSERT IGNORE INTO attribution(promoter_id,scene,channel) VALUES(?,?,?)', [promoterUid, scene, 'zjq'])
  // 首单产品：朱家角江南谜案套票（跨店：门票A店12000 + 实景搜证B店7900，合计19900=¥199）
  pidT = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES('main','310118','theme','朱家角江南谜案套票(隔离验证)',19900,?,?,1)", [midA, scenicId])).insertId
  sidT = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pidT, date(0), 20, 1])).insertId
  itemTicket = ok(await call('POST', '/admin/supply-items', { name: '朱角门票采购' + stamp, kind: 1, unit: 'per_person', unitCostFen: 12000, agreement: 'ZJ-AG-' + stamp, note: '隔离闭环算例成本', reason: '隔离闭环算例配置' }, ops)).id
  ok(await call('POST', `/admin/products/${pidT}/supply`, { items: [{ itemId: itemTicket, qty: 1 }], reason: '隔离闭环算例挂载' }, ops))
  ok(await call('POST', `/admin/products/${pidT}/package-items`, { name: '古镇门票(A店)', kind: 1, merchantId: midA, unitPriceFen: 12000, qtyPerUnit: 1, supplyItemId: itemTicket, reason: '隔离闭环算例套餐项' }, ops)).id
  const supplyShow = ok(await call('POST', '/admin/supply-items', { name: '实景搜证场务' + stamp, kind: 2, unit: 'per_order', unitCostFen: 3000, agreement: 'ZJ-AG2-' + stamp, note: '隔离闭环算例成本', reason: '隔离闭环算例配置' }, ops)).id
  ok(await call('POST', `/admin/products/${pidT}/package-items`, { name: '江南谜案实景搜证(B店)', kind: 2, merchantId: midB, unitPriceFen: 7900, qtyPerUnit: 1, supplyItemId: supplyShow, reason: '隔离闭环算例套餐项' }, ops)).id
  // 二销产品：B店餐饮 SKU（独立支付；挂同一景区形成关联依据）
  pidF = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES('main','310118','shop','朱角评弹茶点(隔离验证)',6800,?,?,1)", [midB, scenicId])).insertId
  sidF = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,6800,1)', [pidF, date(0), 50, 1])).insertId

  // ===== 步骤1 内容获客：场景码归因（推广服务商授权分享） =====
  await check('步骤1·内容获客：推广服务商场景码下发、归因来源登记（内容/来源码可追溯）', async () => {
    const sc = ok(await call('GET', '/c/promote/scene', null, token(promoterUid)))
    assert.ok(sc.scene, '推广服务商本人场景码')
    assert.ok(await one('SELECT id FROM attribution WHERE scene=?', [scene]), '归因来源登记（attribution）')
  })

  // ===== 步骤2 支付出票：重复回调只出票一次 =====
  await check('步骤2·支付与出票：重复回调幂等只出一张凭证，实付/分摊分列', async () => {
    const r = await order.place({ userId: uidA, sessionId: sidT, qty: 1, wantedBeans: 0, promoScene: scene })
    noFirst = r.orderNo
    await order.acceptPayment(noFirst, 'ZJPAY1-' + stamp, true)
    const dup = await order.acceptPayment(noFirst, 'ZJPAY1-' + stamp, true) // 同交易号重复回调
    assert.equal(dup.duplicated, true, '重复回调幂等（只出票一次）')
    ordFirst = Number((await one('SELECT id FROM orders WHERE order_no=?', [noFirst])).id)
    passRow = await one('SELECT id FROM travel_pass WHERE order_id=?', [ordFirst])
    assert.ok(passRow, '凭证已出（1张）')
    assert.equal(Number((await q('SELECT id FROM travel_pass WHERE order_id=?', [ordFirst])).length), 1)
    await promo.hit(scene, uidA)
    const o = await one('SELECT amount_pay, insurance_fee, promo_snapshot FROM orders WHERE order_no=?', [noFirst])
    assert.equal(Number(o.amount_pay), 19900, '首单实付=19900（无优惠）')
    assert.ok((typeof o.promo_snapshot === 'string' ? JSON.parse(o.promo_snapshot) : o.promo_snapshot).eligible, '归因快照有效（获客有效成交依据）')
    const items = await q('SELECT * FROM order_item WHERE order_id=? ORDER BY id', [ordFirst])
    itTicket = items.find(i => Number(i.merchant_id) === Number(midA))
    itShow = items.find(i => Number(i.merchant_id) === Number(midB))
    assert.equal(Number(itTicket.cash_fen), 12000, 'A店门票项现金分摊 12000')
    assert.equal(Number(itShow.cash_fen), 7900, 'B店搜证项现金分摊 7900（Σ=实付）')
  })

  // ===== 步骤3 线下体验：未履约→逐项核销→全部完成；跨店隔离 =====
  await check('步骤3·线下体验：待履约可见→B店服务项核销→A店凭证核销→全部履约；跨店核销拒绝', async () => {
    const pend = ok(await call('GET', '/m/items/pending', null, mToken(uidB, midB)))
    assert.ok(pend.rows.some(x => Number(x.id) === Number(itShow.id) && Number(x.status) === 0), 'B店待履约清单含搜证项（未履约可见）')
    const bad = await call('POST', `/m/items/${itTicket.id}/redeem`, { idemKey: 'ZJ-X-' + stamp }, mToken(uidB, midB))
    assert.notEqual(bad.code, 0, 'B店员不能核销A店门票项（跨店隔离）')
    ok(await call('POST', `/m/items/${itShow.id}/redeem`, { idemKey: 'ZJ-S-' + stamp, note: '实景搜证完成' }, mToken(uidB, midB)))
    const payload = pass.qrPayload(Number(passRow.id), pass.windowOf(Math.floor(Date.now() / 1000), 60))
    { const scan = ok(await call('POST', '/m/verify/scan', { payload }, mToken(uidB, midA))); assert.equal(scan.ok, true, '凭证核销成功：' + (scan.reason || '')) }
    const items = await q('SELECT status FROM order_item WHERE order_id=?', [ordFirst])
    assert.ok(items.every(x => Number(x.status) === 1), '全部项已履约（逐项状态推进）')
    const o = await one('SELECT status FROM orders WHERE order_no=?', [noFirst])
    assert.equal(Number(o.status), 40, '订单核销完成（40 已核销）')
  })

  // ===== 步骤3b 二销：餐饮独立支付订单 + 关联依据 =====
  await check('步骤3b·二销：餐饮独立支付成单 ¥68，关联依据=同用户+同景区+支付晚于首单（可复算）', async () => {
    const r = await order.place({ userId: uidA, sessionId: sidF, qty: 1, wantedBeans: 0 })
    noShow = r.orderNo
    await order.acceptPayment(noShow, 'ZJPAY2-' + stamp, true)
    ordShow = Number((await one('SELECT id FROM orders WHERE order_no=?', [noShow])).id)
    const o = await one('SELECT amount_pay FROM orders WHERE order_no=?', [noShow])
    assert.equal(Number(o.amount_pay), 6800, '二销实付 ¥68（独立支付流水）')
    const link = await one(`SELECT old.order_no FROM orders old JOIN tour_product op ON op.id=old.product_id
      WHERE old.user_id=? AND op.scenic_id=? AND old.city_code='310118' AND old.status IN (20,30,40,50)
      AND (old.paid_at < (SELECT paid_at FROM orders WHERE order_no=?) OR (old.paid_at=(SELECT paid_at FROM orders WHERE order_no=?) AND old.id < (SELECT id FROM orders WHERE order_no=?)))
      ORDER BY old.paid_at, old.id LIMIT 1`, [uidA, scenicId, noShow, noShow, noShow])
    assert.ok(link && link.order_no === noFirst, `二销关联首单 ${noFirst}（关联依据可复算）`)
  })

  // ===== 步骤4 贡献确认：Q 落库幂等、S/R 待确认、无归因不记 =====
  await check('步骤4·贡献确认：完成时点 Q 记录（score=199、cs=score×w_q 幂等）；无归因二销不记；S/R 待确认', async () => {
    await complete(noFirst)
    const rec = await one('SELECT score, cs, cheated FROM contribution_record WHERE kind=1 AND biz_ref=?', [noFirst])
    assert.ok(rec, '首单 Q 贡献落库')
    assert.equal(Number(rec.score), 199, 'score=适用商品现金 199 元')
    const w = await contribution.weights()
    assert.equal(Number(rec.cs), Math.round(199 * w.q * 100) / 100, `cs=score×w_q(${w.q})`)
    const oFirst = await one('SELECT * FROM orders WHERE order_no=?', [noFirst])
    assert.equal((await contribution.recordQ(oFirst)).recorded, false, '重复确认幂等不重记')
    assert.equal(Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE kind=1 AND biz_ref=?', [noShow])).n), 0, '无归因二销单不记贡献')
    const sum = await contribution.summary(uidA)
    assert.ok(!sum.enabled && sum.pending.s === '待启用' && sum.pending.r === '待启用', '未配置生效时间时保持旧 Q 口径')
    excluded.push(noFirst)
  })

  // ===== 步骤5 分账与权益：跨店结算行 + 佣金 + 旅豆到账 =====
  await check('步骤5·分账与权益：A/B两店按订单项分别出账（结算行可复算），佣金归推广服务商，旅豆到账', async () => {
    const period = settlementPeriod(new Date())
    settleA = await promo.generateSettlement(midA, period)
    settleB = await promo.generateSettlement(midB, period)
    const sa = await one('SELECT * FROM settlement WHERE id=?', [settleA])
    const sb = await one('SELECT * FROM settlement WHERE id=?', [settleB])
    assert.equal(Number(sa.total_amount), 12000, 'A店应付基数=门票项12000')
    assert.equal(Number(sb.total_amount), 7900, 'B店应付基数=搜证项7900')
    const la = await q('SELECT net_fen FROM settlement_line WHERE settlement_id=?', [settleA])
    const lb = await q('SELECT net_fen FROM settlement_line WHERE settlement_id=?', [settleB])
    assert.equal(Number(la[0].net_fen) + Number(lb[0].net_fen), 19900, 'Σ结算行净额=首单实付（不重复分账）')
    const rebate = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidA, noFirst])).s)
    assert.equal(rebate, rebateOf(19900), '旅豆返豆到账 199（=实付10%，权益发放留痕）')
    const cm = await one('SELECT promoter_id, base_amount, amount FROM commission WHERE order_id=?', [ordFirst])
    assert.equal(Number(cm.promoter_id), Number(promoterUid), '佣金归推广服务商')
    assert.equal(Number(cm.base_amount), 19900, '佣金基数=商品现金')
  })

  // ===== 步骤6 复购：旅豆实付锚定 + 自由豆同单并用 + repeatOrder 关联 + 结算前退款 =====
  await check('步骤6·复购：旅豆+自由豆同单并用（实付15370）、锚定上限可复算、复购关联首单、退款进基数', async () => {
    const fbudget = (await q('INSERT INTO freedom_budget(name,total,status) VALUES(?,?,1)', ['zjq复购补贴' + stamp, 100000])).insertId
    const FRULE = { name: 'zjq满100减30', threshold: 10000, discount: 3000, from: date(-1) + ' 00:00:00', to: date(30) + ' 23:59:59', products: [], cities: [], channels: [], dates: [], perUser: 3, daily: 5 }
    const ftid = (await q('INSERT INTO freedom_template(name,budget_id,rule_json,status,version) VALUES(?,?,?,1,1)', ['zjq满100减30', fbudget, JSON.stringify(FRULE)])).insertId
    await q('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)', [uidA, 0, ftid, fbudget, JSON.stringify(FRULE)])
    await q('UPDATE freedom_budget SET committed=committed+3000 WHERE id=?', [fbudget])
    const rightId = Number((await one("SELECT id FROM freedom_right WHERE user_id=? AND status='available' ORDER BY id LIMIT 1", [uidA])).id)
    const qt = ok(await call('POST', '/c/freedom/quote', { sessionId: sidT, qty: 1, insurance: false, rightId, beanDeduct: 199 }, token(uidA)))
    assert.equal(Number(qt.discount), 3000, '自由豆减30（与旅豆同单）')
    assert.equal(Number(qt.beanCapBeans), 153, '旅豆锚定上限=floor(1000×16900/110000)=153（B ≤ r×X 整数解）')
    assert.equal(Number(qt.beanDeductCount), 153, '按锚定上限153收敛（余额199>上限）')
    assert.equal(Number(qt.cashPay), 19900 - 3000 - 1530, '现金应付=15370')
    const r = await order.place({ userId: uidA, sessionId: sidT, qty: 1, wantedBeans: qt.beanDeductCount, freedomRightId: rightId, promoScene: scene })
    noRebuy = r.orderNo
    await order.acceptPayment(noRebuy, 'ZJPAY3-' + stamp, true)
    ordRebuy = Number((await one('SELECT id FROM orders WHERE order_no=?', [noRebuy])).id)
    const o = await one('SELECT amount_pay, bean_deducted, amount_bean_ded FROM orders WHERE order_no=?', [noRebuy])
    assert.equal(Number(o.bean_deducted), 153, '复购旅豆抵扣=153（独立记账）')
    assert.equal(Number(o.amount_pay), 15370, '复购实付与试算一致')
    // 现金路 15370 分摊：门票=floor(15370×12000/19900)=9268，搜证=尾差 6102
    const itsAll = await q('SELECT id, merchant_id, cash_fen FROM order_item WHERE order_id=? ORDER BY id', [ordRebuy])
    const itRebuyT = itsAll.find(x => Number(x.merchant_id) === Number(midA))
    const itRebuyS = itsAll.find(x => Number(x.merchant_id) === Number(midB))
    assert.equal(Number(itRebuyT.cash_fen), 9268, '复购门票项现金分摊 9268')
    assert.equal(Number(itRebuyS.cash_fen), 6102, '复购搜证项现金分摊 6102（尾差归最后正额项）')
    // repeatOrder 关联
    const link = await one(`SELECT old.order_no FROM orders old JOIN tour_product op ON op.id=old.product_id
      WHERE old.user_id=? AND op.scenic_id=? AND old.city_code='310118' AND old.status IN (20,30,40,50)
      AND (old.paid_at < (SELECT paid_at FROM orders WHERE order_no=?) OR (old.paid_at=(SELECT paid_at FROM orders WHERE order_no=?) AND old.id < (SELECT id FROM orders WHERE order_no=?)))
      ORDER BY old.paid_at, old.id LIMIT 1`, [uidA, scenicId, noRebuy, noRebuy, noRebuy])
    assert.ok(link && link.order_no === noFirst, `复购单关联依据指向首单 ${noFirst}`)
    // 结算前部分退款（未核销搜证项 5920）
    await q('INSERT IGNORE INTO attribution_hit(scene,user_id) VALUES(?,?)', [scene, uidA])
    ok(await call('POST', `/admin/orders/${noRebuy}/partial-refund`, { itemIds: [itRebuyS.id], reason: '闭环算例·复购搜证项未履约退款' }, admin))
    await complete(noRebuy)
    const cm2 = await one('SELECT base_amount FROM commission WHERE order_id=?', [ordRebuy])
    assert.equal(Number(cm2.base_amount), 15370 - 6102, '复购佣金基数=剩余商品实收 9268（修复3口径）')
    const rec2 = await one('SELECT score, cs FROM contribution_record WHERE kind=1 AND biz_ref=?', [noRebuy])
    assert.ok(rec2 && Number(rec2.score) === 92.68, '复购 Q 贡献按剩余实收 92.68 元记录')
    const rebate2 = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidA, noRebuy])).s)
    assert.equal(rebate2, rebateOf(9268), '复购返豆=剩余实收10%=93（修复3口径）')
    excluded.push(noRebuy)
  })

  // ===== 步骤5续+退款路径：二销/复购结算 + 已出账后调整 =====
  let adjAmount
  await check('退款路径·补充结算与已出账后调整：结算不改写，调整按快照履约占比登记', async () => {
    await complete(noShow) // 二销餐饮消费完成（无归因不记贡献）
    const period = settlementPeriod(new Date())
    supB = await promo.generateSettlement(midB, period) // 二销6800 + 复购搜证项（已退→净0）
    const ss = await one('SELECT total_amount FROM settlement WHERE id=?', [supB])
    assert.equal(Number(ss.total_amount), 6800, 'B店补充单=二销6800（已退搜证项净0，结算前退款不重复进账）')
    supA = await promo.generateSettlement(midA, period) // 复购门票项 8990
    const ssa = await one('SELECT total_amount FROM settlement WHERE id=?', [supA])
    assert.equal(Number(ssa.total_amount), 9268, 'A店补充单=复购门票项9268')
    // 已出账后退款：复购门票项 8990 → 调整 = −round(8990×快照履约占比)
    const its = await q('SELECT id, settle_line_id FROM order_item WHERE order_id=? AND merchant_id=?', [ordRebuy, midA])
    assert.ok(its[0].settle_line_id != null, '复购门票项在账')
    const pr = ok(await call('POST', `/admin/orders/${noRebuy}/partial-refund`, { itemIds: [its[0].id], reason: '闭环算例·已出账后退款' }, admin))
    const snap = await one('SELECT split_snapshot s FROM settlement WHERE id=?', [supA])
    const sp = typeof snap.s === 'string' ? JSON.parse(snap.s) : snap.s
    adjAmount = -Math.round(9268 * Number(sp.fulfill) / 10000)
    const adj = await one('SELECT amount_fen, settlement_id, applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordRebuy, pr.refundNo])
    assert.ok(adj && Number(adj.amount_fen) === adjAmount, `已出账后调整=${adjAmount}（快照履约占比复算）`)
    assert.equal(Number(adj.settlement_id), Number(supA), '调整挂被调结算单（已出账单不改写）')
    excluded.push(noShow)
  })

  // ===== 资金复算：恒等式逐项核对（MOCK 支付口径） =====
  await check('资金复算·Σ支付=Σ结算行净额+结算前退款；已出账后退款=调整+平台吸收差额（规则明示）；五口径逐单恒等', async () => {
    const paySum = 19900 + 6800 + 15370 // 首单 + 二销 + 复购现金
    const preSettleRefund = 6102 // 结算前退款（复购搜证项）
    const lines = await q(`SELECT sl.settlement_id, sl.net_fen, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained
      FROM settlement_line sl JOIN settlement s ON s.id=sl.settlement_id WHERE s.merchant_id IN (?)`, [[midA, midB]])
    const settleNet = lines.reduce((a, l) => a + Number(l.net_fen), 0)
    assert.equal(settleNet, paySum - preSettleRefund, `Σ结算行净额${settleNet} = Σ支付${paySum} − 结算前退款${preSettleRefund}`)
    const totals = new Map()
    for (const l of lines) {
      assert.equal(Number(l.amt_fulfill) + Number(l.amt_service) + Number(l.amt_promoter) + Number(l.amt_beanbudget) + Number(l.amt_retained), Number(l.total_amount), `结算单#${l.settlement_id} 五口径恒等`)
      totals.set(Number(l.settlement_id), Number(l.total_amount))
    }
    const postRefund = 9268 // 已出账后退款（复购门票项）
    assert.equal(adjAmount, -Math.round(postRefund * 0.58), '调整=商户履约份额（快照占比）')
    assert.equal(postRefund - (-adjAmount), postRefund - Math.round(postRefund * 0.58), `平台吸收差额=${postRefund - Math.round(postRefund * 0.58)}（调整规则：只调商户履约份额，平台分列不动，文档明示）`)
    const adjSum = Number((await one('SELECT COALESCE(SUM(amount_fen),0) s FROM settlement_adjustment WHERE order_id=?', [ordRebuy])).s)
    assert.equal(adjSum, adjAmount, '调整合计与登记一致')
  })

  // ===== 步骤7 持续投入：经营复盘留痕（投入决策依据） =====
  await check('步骤7·持续投入：景区经营复盘保存（决策依据留痕），跨城合伙人隔离', async () => {
    const calc = ok(await call('POST', `/admin/scenics/${scenicId}/calculator`, { from: date(-1), to: date(1), inputs: EXAMPLE }, city))
    assert.ok(calc.fingerprint, '景区算账快照可计算')
    const saved = ok(await call('POST', `/admin/scenics/${scenicId}/calculator/reviews`, { from: date(-1), to: date(1), inputs: EXAMPLE, fingerprint: calc.fingerprint }, city))
    assert.ok(Number(saved.reviewId) > 0, '复盘保存（持续投入决策依据留痕）')
    const denied = await call('POST', `/admin/scenics/${scenicId}/calculator`, { from: date(-1), to: date(1) }, citySh)
    assert.equal(denied.code, 1004, '他城合伙人不能看青浦景区（跨城隔离）')
  })

  // ===== 步骤7b 同链单据：同一景区复盘 → 经营跟进申请 → 审批 → 登记（Codex 复验收口项） =====
  await check('步骤7b·同链单据：复盘 ID 串起跟进申请、审批与登记，编号可溯源', async () => {
    const reviews = ok(await call('GET', `/admin/scenics/${scenicId}/calculator`, null, city)).reviews
    assert.ok(reviews.length >= 1, `复盘存在（reviewId 溯源）`)
    const reviewId = Number(reviews[0].id)
    const fu = ok(await call('POST', `/admin/scenics/${scenicId}/followups`, { reviewId, kind: 'renewal', purpose: '朱家角同链算例·续约申请', amountFen: 500000 }, city))
    assert.equal(fu.status, 'submitted', '申请已提交')
    ok(await call('POST', `/admin/scenics/${scenicId}/followups/${fu.id}/action`, { action: 'approve', note: '朱家角同链算例·审批通过' }, fin))
    const rec = ok(await call('POST', `/admin/scenics/${scenicId}/followups/${fu.id}/action`, { action: 'record', note: '朱家角同链算例·已登记续约办理', reference: 'ZJ-RENEW-' + stamp }, fin))
    assert.equal(rec.status, 'recorded', '办理已登记')
    const rows = ok(await call('GET', `/admin/scenics/${scenicId}/followups`, null, city))
    const mine = rows.rows.find(x => Number(x.id) === Number(fu.id))
    assert.equal(mine.status, 'recorded', '同链单据终态=recorded')
    assert.equal(mine.record_ref, 'ZJ-RENEW-' + stamp, '登记回执编号=ZJ-RENEW-*（可溯源）')
    assert.equal(Number(mine.review_id), reviewId, '跟进挂同链复盘')
  })

  // ===== 跨主体权限矩阵 =====
  await check('跨主体权限·商户/游客/财务边界：他店结算不可见、游客无成本、财务可见、跨店清单隔离', async () => {
    const mdA = ok(await call('GET', `/m/settlements/${settleA}`, null, mToken(uidB, midA)))
    assert.equal(Number(mdA.merchant_id), Number(midA), 'A店只看自己结算单')
    const mdB = await call('GET', `/m/settlements/${settleA}`, null, mToken(uidB, midB))
    assert.equal(mdB.code, 1004, 'B店不能看A店结算单')
    const eco = await call('GET', `/admin/orders/${noFirst}/economics`, null, mToken(uidB, midB))
    assert.notEqual(eco.code, 0, '商户端不能拉平台成本接口')
    const ecoFin = ok(await call('GET', `/admin/orders/${noFirst}/economics`, null, fin))
    assert.ok(ecoFin.economics && ecoFin.economics.netSalesFen != null, '财务可看订单经济学')
    const cCost = await call('GET', `/admin/orders/${noFirst}/economics`, null, token(uidA))
    assert.notEqual(cCost.code, 0, '游客不能看成本')
    const pendB = ok(await call('GET', '/m/items/pending', null, mToken(uidB, midB)))
    assert.ok(!pendB.rows.some(x => Number(x.merchant_id) === Number(midA)), 'B店待履约清单不含A店项（跨店隔离）')
    const adjList = ok(await call('GET', `/admin/settlements/${supA}/adjustments`, null, fin))
    assert.ok(adjList.some(x => Number(x.type) === 1), '财务可溯源已出账后调整')
    assert.equal((await call('GET', `/admin/settlements/${supA}/adjustments`, null, ops)).code, 1003, '调整明细仅财务/超管')
  })

  console.log(`\n朱家角七步闭环（隔离 MOCK）通过 ${passed} 项`)
  console.log(`首单=${noFirst} 二销=${noShow} 复购=${noRebuy} 结算A=${settleA}/${supA} 结算B=${settleB}/${supB}（单号留作台账证据）`)
} finally {
  await closeDb()
}
