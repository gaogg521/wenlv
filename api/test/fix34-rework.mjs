// Codex 三、四批退回修复专项（隔离库，需先起隔离 API 服务）：
//   修复1 D01 预订页豆抵扣分/元换算（静态源码断言 + 试算/建单整豆链路）
//   修复2 B04 按项退款：首笔成功后第二个独立项可退；同项幂等；处理中拦截；累计不超实收；手续费按项分摊
//   修复3 退款后返豆/成长值/佣金基数统一扣已结算按项退款（完成时点复算）
//   修复4 多方结算：跨店按订单项复算各提供方应付；已出账/已付款后按项退款写调整并由补充单冲抵；确认成本更正留痕
//   修复5 B14 冻结专属奖励解冻补发（有无普通返豆两种情况）
//   修复6 B11 渠道空数组口径：列表/详情/试算/建单/首页统一（限定=隐藏，空数组/缺失=全部）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('fix34-rework')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as promo from '../src/domain/promo.mjs'
import * as bean from '../src/domain/bean.mjs'
import { bizDay, settlementPeriod } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: t ? { authorization: 'Bearer ' + t, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'st-qa' })
const fin = jwtSign({ end: 'admin', role: 'finance', name: 'st-fin' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'st-ops' })
const mToken = (uid, mid) => jwtSign({ end: 'm', uid, merchantId: mid, role: 3 })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()
const complete = async (orderNo) => { // 与定时任务/后台完成同源（40 已核销 → OBSERVE_END）
  await q("UPDATE orders SET status=40 WHERE order_no=?", [orderNo])
  const jobs = await import('../src/jobs.mjs')
  assert.equal(await jobs.completeOrder(orderNo), true)
}
const rebateOf = fen => Math.round(fen / 10 * 0.1) // 本库唯一生效预算 + 默认返豆率 10%（bonus 0）

const bookingSrc = fs.readFileSync(new URL('../../mini-a/package-tour/pages/booking/index.js', import.meta.url), 'utf8')
const detailSrc = fs.readFileSync(new URL('../../mini-a/package-tour/pages/detail/index.js', import.meta.url), 'utf8')

let midA, midB, pid, sid, uidA, uidB, uidM, promoterUid, scene
let itemA
let noW2, ordW2, itemA2, itemB2 // 主算例跨店单（修复2 全退算例）
let noW3, ordW3 // 修复2 处理中/累计算例单
let noW8, ordW8 // 修复4 跨店结算算例单（不退款）
let noW9, ordW9 // 修复4 补充单算例单（跨店，触发 A/B 双边补充结算）
const exclQ = [] // 排除标记的落库队列（rebook_of 唯一键）
const excluded = [] // 完成但排除出结算算例的单（rebook_of 标记，唯一键需逐单唯一）

try {
  await q('UPDATE promo_discount SET status = 0') // 定价清场：契约算例需精确售价
  // ===== 基础数据：两店、跨店套餐品（门票A店12000 + 讲解B店7900）、豆预算、推广员 =====
  midA = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'fix34A店' + stamp, 'travel', 'F3A' + stamp])).insertId
  midB = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'fix34B店' + stamp, 'travel', 'F3B' + stamp])).insertId
  pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status,profile) VALUES('main','310118','theme','fix34跨店结算品',19900,?,1,'{}')", [midA])).insertId
  sid = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pid, date(3), 20, 1])).insertId
  for (const u of ['a', 'b', 'm', 'p']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['f34-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else if (u === 'b') uidB = uid; else if (u === 'm') uidM = uid; else promoterUid = uid
  }
  const budget = (await q("INSERT INTO bean_budget(name,total,granted,status,biz_owner) VALUES(?,?,0,1,'fix34')", ['fix34豆预算' + stamp, 500000])).insertId
  await q('UPDATE bean_budget SET status=0 WHERE status=1 AND id<>?', [budget]) // 本库唯一生效预算，返豆算例可精确
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [midA, uidM])
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role) VALUES(?,?,3)', [midB, uidM])
  await q('INSERT INTO promoter(user_id,tier,rate_bp,status) VALUES(?,?,1200,1) ON DUPLICATE KEY UPDATE status=1', [promoterUid, 2])
  scene = await promo.createScene(promoterUid, 'fix34')
  await q('INSERT IGNORE INTO attribution(promoter_id,scene,channel) VALUES(?,?,?)', [promoterUid, scene, 'fix34'])
  itemA = ok(await call('POST', '/admin/supply-items', { name: 'fix34门票采购' + stamp, kind: 1, unit: 'per_person', unitCostFen: 12000, agreement: 'F3-AG-' + stamp, note: '隔离库fix34算例成本', reason: '隔离库fix34算例配置' }, ops)).id
  ok(await call('POST', `/admin/products/${pid}/supply`, { items: [{ itemId: itemA, qty: 1 }], reason: '隔离库fix34算例挂载' }, ops))
  ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '门票项(A店)', kind: 1, merchantId: midA, unitPriceFen: 12000, qtyPerUnit: 1, supplyItemId: itemA, reason: '隔离库fix34算例套餐项' }, ops)).id
  ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '讲解项(B店)', kind: 2, merchantId: midB, unitPriceFen: 7900, qtyPerUnit: 1, reason: '隔离库fix34算例套餐项' }, ops)).id

  // ===== 修复1：预订页分/元换算（静态源码断言 + 折扣提示 8折=80%） =====
  await check('修复1·预订页源码：抵扣按分换元(/100)、提交用 beanDeductCount 整豆、折扣提示8折=80%', async () => {
    assert.ok(bookingSrc.includes('deduct:(d.beanDeduct/100).toFixed(2)'), '试算抵扣按分换元（此前/10 十倍错显）')
    assert.ok(bookingSrc.includes('beanDeductCount'), '提交数量使用服务端整豆回包')
    assert.ok(!/quoted\.deduct\)\s*\*\s*10/.test(bookingSrc), '不再从展示金额反推豆数')
    assert.ok(bookingSrc.includes('* 10 * 10) / 10') || bookingSrc.includes('* 100) / 10'), '预订页 promoText 8折=80%')
    assert.ok(!bookingSrc.includes("* 100) + '%付款'"), '预订页不再出现 800% 错误提示')
    assert.ok(detailSrc.includes('* 100) / 10') && !detailSrc.includes("* 100) + '%付款'"), '详情页折扣提示 8折=80%')
  })
  await check('修复1·试算/建单整豆一致：beanDeduct=beanDeductCount×10分，按整豆建单实付一致', async () => {
    await q('UPDATE bean_account SET balance=172 WHERE user_id=?', [uidA]) // 172豆
    const qt = ok(await call('POST', '/c/freedom/quote', { sessionId: sid, qty: 1, insurance: false, beanDeduct: 172 }, token(uidA)))
    assert.equal(Number(qt.beanDeduct), 1720, 'beanDeduct 为现金分（1720分=¥17.20，页面按 /100 展示 ¥17.20）')
    assert.equal(Number(qt.beanDeductCount), 172, 'beanDeductCount 为整豆')
    assert.equal(Number(qt.cashPay), 19900 - 1720, '现金应付=商品−豆抵')
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: qt.beanDeductCount })
    await order.acceptPayment(r.orderNo, 'F3PAY1-' + stamp, true)
    const o = await one('SELECT id, amount_pay, bean_deducted FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(Number(o.bean_deducted), 172, '建单按整豆收敛')
    assert.equal(Number(o.amount_pay), 18180, '实付与试算现金一致')
    await q('DELETE FROM order_item WHERE order_id=?', [o.id]) // 本单仅验证修复1链路，拆除项避免干扰
    await q('UPDATE bean_account SET balance=0 WHERE user_id=?', [uidA])
  })

  // ===== 修复6：渠道口径（限定=全入口隐藏；空数组/缺失=不限制） =====
  await check('修复6·渠道限定 ["pc"]：列表/详情/试算/建单/首页全部不可见（建单不可绕列表直链）', async () => {
    await q("UPDATE tour_product SET profile='{\"visible_channels\":[\"pc\"]}' WHERE id=?", [pid])
    const list = ok(await call('GET', '/c/tours', null, null))
    assert.ok(!list.some(r => Number(r.id) === Number(pid)), '列表不出现')
    assert.equal((await call('GET', '/c/tours/' + pid, null, null)).code, 1004, '详情 1004')
    assert.equal((await call('POST', '/c/freedom/quote', { sessionId: sid, qty: 1, insurance: false }, token(uidB))).code, 1004, '试算 1004')
    await assert.rejects(order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0 }), e => e.code === 1004, '建单拒绝（同口径）')
    const home = ok(await call('GET', '/c/home', null, null))
    assert.ok(!home.groups.some(g => Number(g.product_id) === Number(pid)), '首页 groups 不出现')
    assert.ok(!home.hot.some(h => Number(h.id) === Number(pid)), '首页 hot 不出现')
  })
  await check('修复6·空数组/缺失=不限制：同品跨入口全部可见（口径统一）', async () => {
    await q("UPDATE tour_product SET profile='{\"visible_channels\":[]}' WHERE id=?", [pid])
    assert.ok(ok(await call('GET', '/c/tours', null, null)).some(r => Number(r.id) === Number(pid)), '空数组=列表可见')
    assert.equal((await call('GET', '/c/tours/' + pid, null, null)).code, 0, '空数组=详情可见')
    assert.equal((await call('POST', '/c/freedom/quote', { sessionId: sid, qty: 1, insurance: false }, token(uidB))).code, 0, '空数组=试算可用')
    await q("UPDATE tour_product SET profile='{}' WHERE id=?", [pid])
    assert.ok(ok(await call('GET', '/c/tours', null, null)).some(r => Number(r.id) === Number(pid)), '缺失=列表可见（与空数组同口径）')
  })

  // ===== 主算例单 W2：跨店199单，首触归因；修复2 全退两独立项 =====
  await check('主算例·跨店下单+首触归因：三路分摊 12000/7900', async () => {
    const r = await order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0, promoScene: scene })
    await order.acceptPayment(r.orderNo, 'F3PAY2-' + stamp, true)
    await promo.hit(scene, uidB) // 首触归因（路由层在建单后调用）
    noW2 = r.orderNo
    ordW2 = Number((await one('SELECT id FROM orders WHERE order_no=?', [noW2])).id)
    const items = await q('SELECT * FROM order_item WHERE order_id=? ORDER BY id', [ordW2])
    assert.equal(items.length, 2)
    itemA2 = items.find(i => Number(i.merchant_id) === Number(midA))
    itemB2 = items.find(i => Number(i.merchant_id) === Number(midB))
    assert.equal(Number(itemA2.cash_fen), 12000, 'A店项现金分摊')
    assert.equal(Number(itemB2.cash_fen), 7900, 'B店项现金分摊（Σ=19900 恒等）')
  })
  await check('修复2·首笔按项退款成功后，第二个独立待履约项可退（不再被 2002「处理中」误拦）', async () => {
    const pr1 = ok(await call('POST', `/admin/orders/${noW2}/partial-refund`, { itemIds: [itemA2.id], reason: 'fix34首项退款' }, admin))
    assert.equal(pr1.cashFen, 12000)
    assert.equal(pr1.refunded, true, 'MOCK 通道即时成功')
    const pr2 = ok(await call('POST', `/admin/orders/${noW2}/partial-refund`, { itemIds: [itemB2.id], reason: 'fix34第二项独立退款' }, admin))
    assert.equal(pr2.cashFen, 7900, '第二项独立退款成功（修复前被首笔已成功的 status=2 误拦 2002）')
    assert.equal((await call('POST', `/admin/orders/${noW2}/partial-refund`, { itemIds: [itemA2.id], reason: '同项重复提交' }, admin)).code, 1001, '已退项再提交被拒（同项幂等）')
  })
  await check('修复2·处理中（status=0）拦截 + 恢复后可退 + 累计不超实收', async () => {
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    noW3 = r.orderNo
    await order.acceptPayment(noW3, 'F3PAY3-' + stamp, true)
    ordW3 = Number((await one('SELECT id FROM orders WHERE order_no=?', [noW3])).id)
    const its = await q('SELECT id, cash_fen FROM order_item WHERE order_id=? ORDER BY id', [ordW3])
    const prA = ok(await call('POST', `/admin/orders/${noW3}/partial-refund`, { itemIds: [its[0].id], reason: '处理中拦截算例' }, admin))
    await q('UPDATE refunds SET status=0 WHERE refund_no=?', [prA.refundNo]) // 模拟退款通道处理中
    await q('UPDATE partial_refund SET status=0 WHERE refund_no=?', [prA.refundNo])
    assert.equal((await call('POST', `/admin/orders/${noW3}/partial-refund`, { itemIds: [its[1].id], reason: '处理中再提交' }, admin)).code, 2002, '处理中拦截')
    await q('UPDATE refunds SET status=2, settled_at=NOW(3) WHERE refund_no=?', [prA.refundNo])
    await q('UPDATE partial_refund SET status=2, settled_at=NOW(3) WHERE refund_no=?', [prA.refundNo])
    const prB = ok(await call('POST', `/admin/orders/${noW3}/partial-refund`, { itemIds: [its[1].id], reason: '恢复后第二项' }, admin))
    assert.equal(prB.cashFen, Number(its[1].cash_fen))
    const settledSum = Number((await one('SELECT COALESCE(SUM(cash_fen),0) s FROM partial_refund WHERE order_id=? AND status=2', [ordW3])).s)
    const pay = Number((await one('SELECT amount_pay - insurance_fee pay FROM orders WHERE order_no=?', [noW3])).pay)
    assert.ok(settledSum <= pay, `累计退款 ${settledSum} ≤ 实收现金 ${pay}`)
  })
  await check('修复2·游客路径手续费按项净额分摊（尾差归最后正额项，Σ净额=实退）', async () => {
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'F3PAY3b-' + stamp, true)
    const oid = Number((await one('SELECT id FROM orders WHERE order_no=?', [r.orderNo])).id)
    const its = await q('SELECT id FROM order_item WHERE order_id=? ORDER BY id', [oid])
    // 游客自助：距出发≥3天 → 10% 手续费（订单级一次计费，按项现金占比分摊）
    const pr = ok(await call('POST', `/c/orders/${r.orderNo}/partial-refund`, { itemIds: [its[0].id, its[1].id], reason: 'fix34手续费分摊算例' }, token(uidA)))
    assert.equal(pr.cashFen, Math.round(19900 * 0.9), '实退=项现金合计−10%手续费')
    const prRow = await one('SELECT item_ids, item_nets, fee_fen, cash_fen FROM partial_refund WHERE refund_no=?', [pr.refundNo])
    const nets = Array.isArray(prRow.item_nets) ? prRow.item_nets : JSON.parse(prRow.item_nets || '[]')
    assert.equal(nets.reduce((a, b) => a + Number(b), 0), pr.cashFen, 'Σ项净额=实退（恒等）')
    assert.equal(nets.length, 2, '项净额逐项落表（提供方归属复算依据）')
    await q('UPDATE orders SET rebook_of=? WHERE order_no=?', ['F3-EX-' + stamp + '-a', r.orderNo])
  })

  await check('修复3补·分项退款异步收口：处理中→确认（状态/基数/幂等一致）、CLOSED→转人工恢复项与凭证', async () => {
    const pkg = await import('../src/domain/package.mjs')
    const mk = async (payRef) => {
      const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
      await order.acceptPayment(r.orderNo, payRef, true)
      return { orderNo: r.orderNo, oid: Number((await one('SELECT id FROM orders WHERE order_no=?', [r.orderNo])).id) }
    }
    const mkPending = async (oid, refundNo) => { // 模拟通道处理中：退款单/分项单 status 0、项置已退
      const its = await q('SELECT id, cash_fen FROM order_item WHERE order_id=? ORDER BY id', [oid])
      const nets = its.map(x => Number(x.cash_fen))
      await q('INSERT INTO refunds (order_id, refund_no, amount, fee_amount, reason, status, operator) VALUES (?,?,?,0,?,0,?)',
        [oid, refundNo, nets.reduce((a, b) => a + b, 0), '异步收口算例', 'st-qa'])
      await q('INSERT INTO partial_refund (order_id, refund_no, item_ids, item_nets, cash_fen, fee_fen, reason, operator, status) VALUES (?,?,?,?,?,0,?,?,0)',
        [oid, refundNo, JSON.stringify(its.map(x => Number(x.id))), JSON.stringify(nets), nets.reduce((a, b) => a + b, 0), '异步收口算例', 'st-qa'])
      await q(`UPDATE order_item SET status = 2 WHERE id IN (${its.map(x => Number(x.id)).join(',')})`, [])
      return its.map(x => Number(x.id))
    }
    // 情形一：处理中 → 回执 SUCCESS → 确认（状态 2；项未结算故无调整登记；基数扣减一致）
    const ok1 = await mk('F3ASYNC1-' + stamp)
    const rn1 = 'PRX1' + stamp
    await mkPending(ok1.oid, rn1)
    const c1 = await pkg.confirmPartialRefund(ok1.oid, rn1)
    assert.equal(c1.confirmed, true, '确认成功')
    assert.equal(Number((await one('SELECT status FROM refunds WHERE refund_no=?', [rn1])).status), 2, '退款单置 2')
    assert.equal(Number((await one('SELECT status FROM partial_refund WHERE refund_no=?', [rn1])).status), 2, '分项单置 2')
    const dup1 = await pkg.confirmPartialRefund(ok1.oid, rn1)
    assert.equal(dup1.confirmed, false, '重复确认幂等不重复登记')
    assert.equal(Number((await one('SELECT COUNT(*) n FROM settlement_adjustment WHERE refund_no=?', [rn1])).n), 0, '项未结算 → 无调整登记（无来源不加调整）')
    await complete(ok1.orderNo)
    const rebA = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidA, ok1.orderNo])).s)
    assert.equal(rebA, 0, '确认后净收基数=0 → 完成不返豆（退款单/净收/项状态一致）')
    excluded.push(ok1.orderNo)
    // 情形二：处理中 → 回执 CLOSED → 转人工：项恢复待履约、凭证恢复有效、风险事件留痕
    const ok2 = await mk('F3ASYNC2-' + stamp)
    const rn2 = 'PRX2' + stamp
    const its2 = await mkPending(ok2.oid, rn2)
    const pass2 = await one('SELECT id, status FROM travel_pass WHERE order_id=?', [ok2.oid])
    await q('UPDATE travel_pass SET status=4 WHERE id=?', [pass2.id]) // 提交时已冲正的凭证
    const f1 = await pkg.failPartialRefund(rn2, '微信退款回执关闭（CLOSED）')
    assert.equal(f1.failed, true, '失败转人工')
    assert.equal(Number((await one('SELECT status FROM refunds WHERE refund_no=?', [rn2])).status), 3, '退款单置 3')
    assert.ok(await one('SELECT id FROM order_item WHERE id=? AND status=0', [its2[0]]), '订单项恢复待履约（可重新履约/再退）')
    assert.ok(await one('SELECT id FROM travel_pass WHERE id=? AND status=1', [pass2.id]), '凭证恢复有效')
    assert.ok(await one("SELECT id FROM risk_event WHERE detail LIKE ?", ['%' + rn2 + '%']), '风险事件留痕')
    await q('UPDATE orders SET rebook_of=? WHERE order_no=?', ['F3-EX-' + stamp + '-b', ok2.orderNo])
  })

  // ===== 修复3：退款后完成——返豆/成长值/佣金按剩余商品实收 =====
  await check('修复3·全退后完成：返豆0、成长值0、佣金基数0（不读退款前19900）', async () => {
    await complete(noW2)
    const o = await one('SELECT status FROM orders WHERE order_no=?', [noW2])
    assert.equal(Number(o.status), 50)
    const reb = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidB, noW2])).s)
    assert.equal(reb, 0, '剩余实收0不返豆（修复前会错返199豆）')
    const gro = Number((await one('SELECT COALESCE(SUM(delta),0) s FROM user_growth_log WHERE user_id=? AND biz_type=1 AND biz_ref=?', [uidB, noW2])).s)
    assert.equal(gro, 0, '成长值不加（修复前会错加19900）')
    const cm = await one('SELECT base_amount FROM commission WHERE order_id=?', [ordW2])
    assert.equal(Number(cm.base_amount), 0, '佣金基数=剩余实收0（修复前 19900）')
  })
  await check('修复3·部分退后完成（退12000剩7900）：返豆79、成长值7900、佣金基数7900；未退对照=199/19900', async () => {
    const mk = async (uid, payRef, refundFirst) => {
      const r = await order.place({ userId: uid, sessionId: sid, qty: 1, wantedBeans: 0, promoScene: scene })
      await order.acceptPayment(r.orderNo, payRef, true)
      await q('INSERT IGNORE INTO attribution_hit(scene,user_id) VALUES(?,?)', [scene, uid])
      if (refundFirst) {
        const oid = Number((await one('SELECT id FROM orders WHERE order_no=?', [r.orderNo])).id)
        const its = await q('SELECT id FROM order_item WHERE order_id=? AND merchant_id=?', [oid, midA])
        ok(await call('POST', `/admin/orders/${r.orderNo}/partial-refund`, { itemIds: [its[0].id], reason: 'fix34基数算例部分退款' }, admin))
      }
      await complete(r.orderNo)
      const oid2 = Number((await one('SELECT id FROM orders WHERE order_no=?', [r.orderNo])).id)
      const reb = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uid, r.orderNo])).s)
      const gro = Number((await one('SELECT COALESCE(SUM(delta),0) s FROM user_growth_log WHERE user_id=? AND biz_type=1 AND biz_ref=?', [uid, r.orderNo])).s)
      const cm = await one('SELECT base_amount FROM commission WHERE order_id=?', [oid2])
      return { no: r.orderNo, reb, gro, base: Number(cm.base_amount) }
    }
    const full = await mk(uidA, 'F3PAY4-' + stamp, false)
    assert.equal(full.reb, rebateOf(19900), '未退单返豆=实付10%（199）')
    assert.equal(full.gro, 19900, '成长值=实付')
    assert.equal(full.base, 19900, '佣金基数=实付')
    const partial = await mk(uidA, 'F3PAY5-' + stamp, true)
    assert.equal(partial.reb, rebateOf(7900), '退12000后返豆=79（修复前199）')
    assert.equal(partial.gro, 7900, '成长值=剩余实收7900')
    assert.equal(partial.base, 7900, '佣金基数=剩余实收7900（同佣金/返豆同一基数口径）')
    excluded.push(noW2, full.no, partial.no) // 完成但排除出后续结算算例
  })

  // ===== 修复5：冻结专属奖励解冻补发（有无普通返豆两种情况） =====
  let pidR, sidR
  await check('修复5·冻结→解冻：普通返豆与产品专属奖励都补发（此前专属奖励被清标记丢弃）', async () => {
    pidR = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status,profile) VALUES('main','310118','theme','fix34专属奖励品',10000,?,1,?)", [midA, JSON.stringify({ reward_extra_beans: 200, reward_note: 'fix34算例专属奖励' })])).insertId
    sidR = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,10000,1)', [pidR, date(3), 20, 1])).insertId
    const r = await order.place({ userId: uidA, sessionId: sidR, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'F3PAY6-' + stamp, true)
    await q('UPDATE user_account SET status=0 WHERE id=?', [uidA]) // 冻结
    await complete(r.orderNo)
    const oR = await one('SELECT bean_rebate_deferred f FROM orders WHERE order_no=?', [r.orderNo])
    assert.equal(Number(oR.f), 1, '冻结时记待补发')
    assert.equal(Number((await one("SELECT COUNT(*) n FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type IN (1,2) AND (l.biz_ref=? OR l.biz_ref=?)", [uidA, r.orderNo, 'PXTRA-' + r.orderNo])).n), 0, '冻结期间两类都不发')
    await q('UPDATE user_account SET status=1 WHERE id=?', [uidA]) // 解冻
    const n = await bean.releaseDeferredRebates(uidA)
    assert.ok(n >= 1, '补发动作发生')
    const reb = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidA, r.orderNo])).s)
    const extra = Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=2 AND l.biz_ref=?", [uidA, 'PXTRA-' + r.orderNo])).s)
    assert.equal(reb, 100, '普通返豆补发=100（10000×10%）')
    assert.equal(extra, 200, '产品专属奖励补发=200（修复前被清标记丢弃）')
    assert.equal(Number((await one('SELECT bean_rebate_deferred f FROM orders WHERE order_no=?', [r.orderNo])).f), 0, '标记已清')
    await bean.releaseDeferredRebates(uidA) // 幂等
    assert.equal(Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=2 AND l.biz_ref=?", [uidA, 'PXTRA-' + r.orderNo])).s), 200, '重复触发不重发')
    excluded.push(r.orderNo)
  })
  await check('修复5·无普通返豆（返豆四舍五入为0）也补专属奖励；退款单解冻只清标记不发', async () => {
    // 情形一：实付30分（返豆 round(30/100)=0）→ 解冻只补专属奖励200
    const pidR2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status,profile) VALUES('main','310118','theme','fix34微额奖励品',30,?,1,?)", [midA, JSON.stringify({ reward_extra_beans: 200 })])).insertId
    const sidR2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,30,1)', [pidR2, date(3), 20, 1])).insertId
    const r1 = await order.place({ userId: uidA, sessionId: sidR2, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r1.orderNo, 'F3PAY7-' + stamp, true)
    await q('UPDATE user_account SET status=0 WHERE id=?', [uidA])
    await complete(r1.orderNo)
    await q('UPDATE user_account SET status=1 WHERE id=?', [uidA])
    await bean.releaseDeferredRebates(uidA)
    assert.equal(Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.biz_ref=?", [uidA, r1.orderNo])).s), 0, '30分实付返豆=0')
    assert.equal(Number((await one("SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=2 AND l.biz_ref=?", [uidA, 'PXTRA-' + r1.orderNo])).s), 200, '专属奖励仍补发（有无普通返豆两种情况都正确）')
    assert.equal(Number((await one('SELECT bean_rebate_deferred f FROM orders WHERE order_no=?', [r1.orderNo])).f), 0, '标记清')
    excluded.push(r1.orderNo)
    // 情形二：完成时冻结 → 之后退款关单（70，模拟客服退款终态）→ 解冻：只清标记、两类都不发
    const r2 = await order.place({ userId: uidA, sessionId: sidR, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r2.orderNo, 'F3PAY8-' + stamp, true)
    await q('UPDATE user_account SET status=0 WHERE id=?', [uidA])
    await complete(r2.orderNo)
    assert.equal(Number((await one('SELECT bean_rebate_deferred f FROM orders WHERE order_no=?', [r2.orderNo])).f), 1, '完成时冻结记待补发')
    await q("UPDATE orders SET status=70, close_reason='ops_refund_sim' WHERE order_no=?", [r2.orderNo]) // 模拟退款关单终态（release 的"非完成态只清标记"分支）
    await q('UPDATE user_account SET status=1 WHERE id=?', [uidA])
    await bean.releaseDeferredRebates(uidA)
    assert.equal(Number((await one("SELECT COUNT(*) n FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type IN (1,2) AND (l.biz_ref=? OR l.biz_ref=?)", [uidA, r2.orderNo, 'PXTRA-' + r2.orderNo])).n), 0, '退款单两类都不发（与普通返豆同一"非完成态只清标记"口径）')
    assert.equal(Number((await one('SELECT bean_rebate_deferred f FROM orders WHERE order_no=?', [r2.orderNo])).f), 0, '标记清')
    excluded.push(r2.orderNo)
  })

  // ===== 修复4：跨店结算——各提供方应付从订单项复算 =====
  let settleA, settleB
  await check('修复4·跨店结算：A店结算只含本店项净额12000，B店独立出账7900，结算行逐项可复算', async () => {
    excluded.forEach((no, i) => exclQ.push(q('UPDATE orders SET rebook_of=? WHERE order_no=?', ['F3-EXCLUDE-' + stamp + '-' + i, no])))
    await Promise.all(exclQ) // 排除非算例完成单（rebook_of 唯一键逐单标记）
    const r = await order.place({ userId: uidB, sessionId: sid, qty: 1, wantedBeans: 0 })
    noW8 = r.orderNo
    await order.acceptPayment(noW8, 'F3PAY9-' + stamp, true)
    await q('INSERT IGNORE INTO attribution_hit(scene,user_id) VALUES(?,?)', [scene, uidB])
    ordW8 = Number((await one('SELECT id FROM orders WHERE order_no=?', [noW8])).id)
    await complete(noW8)
    const period = settlementPeriod(new Date())
    settleA = await promo.generateSettlement(midA, period)
    settleB = await promo.generateSettlement(midB, period)
    assert.ok(Number(settleA) > 0 && Number(settleB) > 0 && Number(settleA) !== Number(settleB), '两店分别出账')
    const sa = await one('SELECT * FROM settlement WHERE id=?', [settleA])
    const sb = await one('SELECT * FROM settlement WHERE id=?', [settleB])
    assert.equal(Number(sa.total_amount), 12000, 'A店结算=A店项现金12000（修复前整单19900重复计入）')
    assert.equal(Number(sb.total_amount), 7900, 'B店结算=B店项现金7900（修复前缺失）')
    assert.equal(Number(sa.amt_fulfill) + Number(sa.amt_service) + Number(sa.amt_promoter) + Number(sa.amt_beanbudget) + Number(sa.amt_retained), Number(sa.total_amount), 'A店五口径恒等')
    assert.equal(Number(sb.amt_fulfill) + Number(sb.amt_service) + Number(sb.amt_promoter) + Number(sb.amt_beanbudget) + Number(sb.amt_retained), Number(sb.total_amount), 'B店五口径恒等')
    const linesA = await q('SELECT * FROM settlement_line WHERE settlement_id=?', [settleA])
    const linesB = await q('SELECT * FROM settlement_line WHERE settlement_id=?', [settleB])
    assert.ok(linesA.some(l => Number(l.merchant_id) === Number(midA) && Number(l.net_fen) === 12000 && Number(l.cross_store) === 0), 'A店结算行（主单商户）净额12000')
    assert.ok(linesB.some(l => Number(l.merchant_id) === Number(midB) && Number(l.net_fen) === 7900 && Number(l.cross_store) === 1), 'B店结算行（跨店提供方）净额7900')
    const o8 = await one('SELECT settlement_id FROM orders WHERE order_no=?', [noW8])
    assert.equal(Number(o8.settlement_id), Number(settleA), 'orders.settlement_id 挂主单商户结算')
    const marked = await q('SELECT merchant_id, settle_line_id FROM order_item WHERE order_id=?', [ordW8])
    assert.ok(marked.every(it => it.settle_line_id != null), '每个订单项落结算行（防重复分账）')
    let netSum = 0
    for (const it of marked) netSum += Number((await one('SELECT net_fen n FROM settlement_line WHERE id=?', [it.settle_line_id])).n)
    assert.equal(netSum, 19900, 'Σ结算行净额=订单商品现金（跨店不重复不遗漏）')
    assert.equal(Number(sa.cost_total), 12000, 'A店确认成本=A店项成本（跨店成本不串店）')
    assert.equal(Number(sb.cost_total), 0, 'B店项未挂成本=0（不强填）')
  })

  // ===== 修复4：已出账后按项退款 → 调整记录 + 补充单冲抵（不重复分账） =====
  let supA
  await check('修复4·已出账后按项退款：已出账单不改写，调整按快照履约占比登记并随补充单冲抵', async () => {
    const sa0 = await one('SELECT total_amount, split_snapshot FROM settlement WHERE id=?', [settleA])
    const its = await q('SELECT id, merchant_id, settle_line_id FROM order_item WHERE order_id=? ORDER BY id', [ordW8])
    const itA = its.find(x => Number(x.merchant_id) === Number(midA))
    assert.ok(itA.settle_line_id != null, '被退项在账')
    const pr = ok(await call('POST', `/admin/orders/${noW8}/partial-refund`, { itemIds: [itA.id], reason: '已出账后退款算例' }, admin))
    assert.equal(pr.cashFen, 12000)
    const sa1 = await one('SELECT total_amount, amt_fulfill FROM settlement WHERE id=?', [settleA])
    assert.equal(Number(sa1.total_amount), Number(sa0.total_amount), '已出账单快照不改写')
    const snap = typeof sa0.split_snapshot === 'string' ? JSON.parse(sa0.split_snapshot) : sa0.split_snapshot
    const expAdj = -Math.round(12000 * Number(snap.fulfill) / 10000)
    const adj = await one('SELECT amount_fen, settlement_id, applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW8, pr.refundNo])
    assert.ok(adj, '调整记录已登记')
    assert.equal(Number(adj.amount_fen), expAdj, `调整金额=−12000×履约${Number(snap.fulfill) / 100}%=${expAdj}（快照比例，不随参数漂移）`)
    assert.equal(Number(adj.settlement_id), Number(settleA), '调整挂被调结算单')
    assert.equal(adj.applied_settlement_id, null, '尚未冲抵')
    // 补充单冲抵：再造一笔跨店单完成 → A店补充单 total=新单A项12000+调整
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    noW9 = r.orderNo
    await order.acceptPayment(noW9, 'F3PAY10-' + stamp, true)
    ordW9 = Number((await one('SELECT id FROM orders WHERE order_no=?', [noW9])).id)
    await complete(noW9)
    supA = await promo.generateSettlement(midA, settlementPeriod(new Date()))
    assert.ok(Number(supA) > 0 && Number(supA) !== Number(settleA), '补充单生成（同周期补充编号）')
    const ss = await one('SELECT * FROM settlement WHERE id=?', [supA])
    assert.equal(Number(ss.total_amount), 12000, `补充单 total=新单A项净额12000（调整不进五口径基数）`)
    assert.equal(Number(ss.amt_fulfill), 0, `同额冲零：履约应付=round(12000×58%)−6960=0（Codex复验条件，不二次乘比例）`)
    assert.equal(Number(ss.amt_fulfill) + Number(ss.amt_service) + Number(ss.amt_promoter) + Number(ss.amt_beanbudget) + Number(ss.amt_retained), Number(ss.total_amount), '补充单五口径恒等（调整进履约列、留存兜底）')
    const adj2 = await one('SELECT applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW8, pr.refundNo])
    assert.equal(Number(adj2.applied_settlement_id), Number(supA), '调整标记冲抵去向')
    const lines = await q('SELECT * FROM settlement_line WHERE settlement_id=?', [supA])
    assert.ok(lines.some(l => Number(l.net_fen) === 12000), '补充单结算行=新单A项净额（调整不落行、只进总额）')
  })

  // ===== 修复4：已付款（status=3）后按项退款：调整登记 + 随补充单冲抵；纯负调整本轮跳过 =====
  let supB
  await check('修复4·已付款结算单后退款：调整登记不阻塞，随下一张补充单冲抵（不重复扣已付款）', async () => {
    await q("UPDATE settlement SET status=3, payment_ref=?, paid_by='st-qa', paid_at=NOW(3) WHERE id=?", ['F3PAYREF-' + stamp, settleB])
    const its = await q('SELECT id, merchant_id FROM order_item WHERE order_id=? ORDER BY id', [ordW8])
    const itB = its.find(x => Number(x.merchant_id) === Number(midB))
    const pr = ok(await call('POST', `/admin/orders/${noW8}/partial-refund`, { itemIds: [itB.id], reason: '已付款后退款算例' }, admin))
    assert.equal(pr.cashFen, 7900)
    const adj = await one('SELECT amount_fen, settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW8, pr.refundNo])
    assert.ok(adj && Number(adj.amount_fen) < 0, '已付款结算单的退款调整同样登记')
    assert.equal(Number(adj.settlement_id), Number(settleB), '调整挂在已付款结算单上')
    // B店补充单：W9 的 B店项（7900，未结算）+ 已付款后调整 → 履约应付同额冲零
    supB = await promo.generateSettlement(midB, settlementPeriod(new Date()))
    assert.ok(Number(supB) > 0 && Number(supB) !== Number(settleB), 'B店补充单生成')
    const ssb = await one('SELECT total_amount, amt_fulfill FROM settlement WHERE id=?', [supB])
    const snapB = await one('SELECT split_snapshot s FROM settlement WHERE id=?', [settleB])
    const spB = typeof snapB.s === 'string' ? JSON.parse(snapB.s) : snapB.s
    const expAdjB = -Math.round(7900 * Number(spB.fulfill) / 10000)
    assert.equal(Number(ssb.total_amount), 7900, '已付款后：补充单 total=W9的B店项7900（调整不进基数）')
    assert.equal(Number(ssb.amt_fulfill), 0, '已付款后同额冲零：履约应付=round(7900×58%)−4582=0')
    const adjNow = await one('SELECT applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW8, pr.refundNo])
    assert.equal(Number(adjNow.applied_settlement_id), Number(supB), '调整冲抵去向=补充单')
  })
  await check('修复4·纯负调整且无新增可结算项：本轮跳过不出负数单，调整保持未冲抵', async () => {
    // W9 的 A店项已进补充单 supA → 出账后再退 → 调整挂 supA；A店再生成：无新增可结算项、纯负调整 → 跳过
    const w9its = await q('SELECT oi.id, oi.settle_line_id FROM order_item oi JOIN orders o ON o.id=oi.order_id WHERE o.order_no=? AND oi.merchant_id=?', [noW9, midA])
    const itA9 = w9its[0]
    assert.ok(itA9 && itA9.settle_line_id != null, 'W9 A店项已在补充单内')
    const pr = ok(await call('POST', `/admin/orders/${noW9}/partial-refund`, { itemIds: [itA9.id], reason: '补充单出账后退款算例' }, admin))
    assert.equal(pr.cashFen, 12000)
    const adj = await one('SELECT amount_fen, settlement_id, applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW9, pr.refundNo])
    assert.ok(adj && Number(adj.amount_fen) < 0, '调整挂在补充单 supA')
    await promo.generateSettlement(midA, settlementPeriod(new Date()))
    const adjNow = await one('SELECT applied_settlement_id FROM settlement_adjustment WHERE order_id=? AND refund_no=?', [ordW9, pr.refundNo])
    assert.equal(adjNow.applied_settlement_id, null, '无正额可出账时保持未冲抵（不出负数单）')
  })

  // ===== Codex 二次复验：R3 故障注入（调整写失败→补偿补登）/ R2a 跨两景区投影 =====
  await check('R3·调整写失败可恢复：确认成功但漏登→补偿任务幂等补登→挂正确结算单', async () => {
    const pkg = await import('../src/domain/package.mjs')
    const jobs = await import('../src/jobs.mjs')
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'F3FAIL-' + stamp, true)
    const oidF = Number((await one('SELECT id FROM orders WHERE order_no=?', [r.orderNo])).id)
    await complete(r.orderNo)
    const periodF = settlementPeriod(new Date())
    const supF = await promo.generateSettlement(midA, periodF)
    assert.ok(Number(supF) > 0, '结算单（含结算行）生成')
    const itsF = await q('SELECT id, cash_fen FROM order_item WHERE order_id=? AND merchant_id=?', [oidF, midA])
    const rnF = 'PRFAIL' + stamp
    const nets = itsF.map(x => Number(x.cash_fen))
    await q('INSERT INTO refunds (order_id, refund_no, amount, fee_amount, reason, status, operator) VALUES (?,?,?,0,?,0,?)',
      [oidF, rnF, nets.reduce((a, b) => a + b, 0), '故障注入算例', 'st-qa'])
    await q('INSERT INTO partial_refund (order_id, refund_no, item_ids, item_nets, cash_fen, fee_fen, reason, operator, status) VALUES (?,?,?,?,?,0,?,?,0)',
      [oidF, rnF, JSON.stringify(itsF.map(x => Number(x.id))), JSON.stringify(nets), nets.reduce((a, b) => a + b, 0), '故障注入算例', 'st-qa'])
    await q(`UPDATE order_item SET status = 2 WHERE id IN (${itsF.map(x => Number(x.id)).join(',')})`, [])
    // 故障注入：调整 INSERT 对该单号 SIGNAL 失败
    await q(`CREATE TRIGGER trg_fail_adj_${stamp} BEFORE INSERT ON settlement_adjustment FOR EACH ROW BEGIN IF NEW.refund_no = '${rnF}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inject fail'; END IF; END`, [])
    const c1 = await pkg.confirmPartialRefund(oidF, rnF)
    assert.equal(c1.confirmed, true, '确认返回成功（资金已退不可回滚）')
    assert.equal(c1.adjustmentRetried, true, '登记失败被标记重试')
    assert.equal(Number((await one('SELECT COUNT(*) n FROM settlement_adjustment WHERE refund_no=?', [rnF])).n), 0, '故障期调整确实漏登')
    await q(`DROP TRIGGER trg_fail_adj_${stamp}`, [])
    const dup = await pkg.confirmPartialRefund(oidF, rnF)
    assert.equal(dup.confirmed, false, '重复确认幂等')
    await jobs.tickPartialRefundRefresh()
    const adj = await one('SELECT amount_fen, settlement_id FROM settlement_adjustment WHERE refund_no=? AND type=1', [rnF])
    assert.ok(adj && Number(adj.amount_fen) < 0, '补偿任务补登调整（漏单恢复）')
    await jobs.tickPartialRefundRefresh()
    assert.equal(Number((await one('SELECT COUNT(*) n FROM settlement_adjustment WHERE refund_no=? AND type=1', [rnF])).n), 1, '重复补登幂等不重复')
    assert.ok(adj.settlement_id != null, '补登调整挂被调结算单')
    excluded.push(r.orderNo)
  })
  await check('R2a·跨两景区投影：只含本景区行的账单可见、无整单订单数、调整按景区行+未冲抵过滤', async () => {
    const scA = (await q('INSERT INTO scenic_spot(city_code,name,scenic_level,coop_mode,status) VALUES(?,?,?,?,1)', ['310118', 'R2景区A' + stamp, '4A', '', 1])).insertId
    const scB = (await q('INSERT INTO scenic_spot(city_code,name,scenic_level,coop_mode,status) VALUES(?,?,?,?,1)', ['310118', 'R2景区B' + stamp, '3A', '', 1])).insertId
    const pA2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES('main','310118','theme','R2-A品',8000,?,?,1)", [midA, scA])).insertId
    const pB2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES('main','310118','theme','R2-B品',6000,?,?,1)", [midA, scB])).insertId
    const sA2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,8000,1)', [pA2, date(0), 10, 1])).insertId
    const sB2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,6000,1)', [pB2, date(0), 10, 1])).insertId
    // 单项套餐化（有 order_item 才能按项部分退款）
    ok(await call('POST', '/admin/products/' + pA2 + '/package-items', { name: 'R2-A项', kind: 2, merchantId: midA, unitPriceFen: 8000, qtyPerUnit: 1, reason: 'R2a算例' }, admin))
    ok(await call('POST', '/admin/products/' + pB2 + '/package-items', { name: 'R2-B项', kind: 2, merchantId: midA, unitPriceFen: 6000, qtyPerUnit: 1, reason: 'R2a算例' }, admin))
    const mk = async (sidX, ref) => {
      const r = await order.place({ userId: uidA, sessionId: sidX, qty: 1, wantedBeans: 0 })
      await order.acceptPayment(r.orderNo, 'F3R2-' + ref + '-' + stamp, true)
      await complete(r.orderNo)
      return r.orderNo
    }
    const orderNoA = await mk(sA2, 'A')
    await mk(sB2, 'B')
    const periodX = settlementPeriod(new Date())
    const bill1 = await promo.generateSettlement(midA, periodX) // 同商户同周期：A/B 两景区行进同一张账单
    const bill2 = await promo.generateSettlement(midA, periodX)
    assert.ok(Number(bill2) > 0, '重复生成幂等返回有效单（无新增可结算内容时不重复分账）')
    const netA = Number((await one('SELECT COALESCE(SUM(sl.net_fen),0) n FROM settlement_line sl JOIN orders o ON o.id=sl.order_id WHERE sl.settlement_id=? AND o.product_id=?', [bill1, pA2])).n)
    const netB = Number((await one('SELECT COALESCE(SUM(sl.net_fen),0) n FROM settlement_line sl JOIN orders o ON o.id=sl.order_id WHERE sl.settlement_id=? AND o.product_id=?', [bill1, pB2])).n)
    assert.equal(netA, 8000, '账单含 A 景区行 8000')
    assert.equal(netB, 6000, '账单含 B 景区行 6000')
    // 无本景区行的账单（Codex复验案例）：第三方商品订单（无 scenic）单独成账
    const pC2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','R2-无景区品',9000,?,1)", [midA])).insertId
    const sC2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,9000,1)', [pC2, date(0), 10, 1])).insertId
    const rC = await order.place({ userId: uidA, sessionId: sC2, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(rC.orderNo, 'F3R2-C-' + stamp, true)
    await complete(rC.orderNo)
    const periodY = 'R2Y' + String(stamp).slice(-6) // period 列 VARCHAR(12)
    const billC = await promo.generateSettlement(midA, periodY)
    assert.ok(Number(billC) > 0, '无景区品账单生成')
    const tokSA = jwtSign({ uid: 900002, end: 'admin', role: 'scenic_partner', name: 'r2-sa', scopeCity: '310118', subjectType: 'scenic', subjectId: scA })
    const tokSB = jwtSign({ uid: 900004, end: 'admin', role: 'scenic_partner', name: 'r2-sb', scopeCity: '310118', subjectType: 'scenic', subjectId: scB })
    const rowsA = ok(await call('GET', '/admin/settlements', null, tokSA))
    assert.ok(rowsA.some(x => Number(x.id) === Number(bill1)), '含本景区行的账单可见')
    assert.ok(!rowsA.some(x => Number(x.id) === Number(billC)), '无本景区行的账单不可见（Codex复验案例）')
    const rowA = rowsA.find(x => Number(x.id) === Number(bill1))
    assert.ok(!('order_count' in rowA), '整单订单数不下发')
    assert.ok('scenic_orders' in rowA, '按本景区行复算的订单数在')
    assert.equal(Number(rowA.scenic_net_fen), 8000, 'A 主体只取本景区行净额')
    const rowsB = ok(await call('GET', '/admin/settlements', null, tokSB))
    const rowB = rowsB.find(x => Number(x.id) === Number(bill1))
    assert.ok(rowB && Number(rowB.scenic_net_fen) === 6000, '同账单 B 景区主体只取 B 行净额（同城不同主体）')
    const itsA = await q('SELECT id, settle_line_id FROM order_item WHERE order_id IN (SELECT id FROM orders WHERE product_id=?) AND merchant_id=?', [pA2, midA])
    assert.ok(itsA[0].settle_line_id != null)
    const orderA = (await one('SELECT order_id FROM settlement_line WHERE id=?', [itsA[0].settle_line_id])).order_id
    const orderA2 = (await one('SELECT order_no FROM orders WHERE id=?', [orderA])).order_no
    const prA = ok(await call('POST', `/admin/orders/${orderA2}/partial-refund`, { itemIds: [itsA[0].id], reason: 'R2a调整过滤算例' }, admin))
    assert.equal(prA.cashFen, 8000)
    const adjA = await one('SELECT amount_fen FROM settlement_adjustment WHERE refund_no=? AND type=1', [prA.refundNo])
    assert.ok(adjA && Number(adjA.amount_fen) < 0, 'A账调整已登记')
    const tokSA2 = jwtSign({ uid: 900003, end: 'admin', role: 'scenic_partner', name: 'r2-sa2', scopeCity: '310118', subjectType: 'scenic', subjectId: scA })
    const rowsA2 = ok(await call('GET', '/admin/settlements', null, tokSA2))
    const rowA2 = rowsA2.find(x => Number(x.id) === Number(bill1))
    assert.ok(Number(rowA2.adjust_pending) < 0, 'A账待冲抵调整（未冲抵口径）')
    assert.equal(Number(rowA2.scenic_net_fen), 8000, '已出账行净额快照不改写（冲减由调整行承担，见 adjust_pending）')
    excluded.push(orderNoA)
  })

  // ===== 修复4：确认成本更正（已出账后成本变化走调整记录） =====
  await check('修复4·确认成本更正：finance 专用、orders 同步、type=2 调整留痕、不改商户应付', async () => {
    assert.equal((await call('POST', '/admin/settlements/cost-adjust', { orderNo: noW8, costConfirmedFen: 99000, reason: '越权测试' }, ops)).code, 1003, 'ops 无权')
    const r = ok(await call('POST', '/admin/settlements/cost-adjust', { orderNo: noW8, costConfirmedFen: 9000, reason: 'fix34隔离库成本复核更正' }, fin))
    assert.equal(r.changed, true)
    const o = await one('SELECT cost_confirmed_fen FROM orders WHERE order_no=?', [noW8])
    assert.equal(Number(o.cost_confirmed_fen), 9000, '确认成本已更正')
    const adj = await one('SELECT type, cost_fen, amount_fen FROM settlement_adjustment WHERE order_id=? AND type=2 ORDER BY id DESC LIMIT 1', [ordW8])
    assert.ok(adj, '成本调整留痕')
    assert.equal(Number(adj.cost_fen), -3000, '成本变动=9000−12000（更正前确认成本）')
    assert.equal(adj.amount_fen, null, '成本调整不改商户应付五口径')
    assert.equal((await call('POST', '/admin/settlements/cost-adjust', { orderNo: noW8, costConfirmedFen: -5, reason: '非法值' }, fin)).code, 1001, '负数拒绝')
  })

  // ===== 修复4：对账可见性（admin 列表 + 商户端明细） =====
  await check('修复4·对账可见性：admin 结算列表带 adjust_pending/payable_after_adjust，商户端明细含调整与结算行订单', async () => {
    const rows = ok(await call('GET', '/admin/settlements', null, admin))
    const sa = rows.find(r => Number(r.id) === Number(settleA))
    const sb = rows.find(r => Number(r.id) === Number(settleB))
    assert.ok(sa && Number(sa.adjust_pending) === 0, 'A店调整已随补充单冲抵（applied 不再挂起，金额进补充单履约列）')
    assert.ok('payable_after_adjust' in sa, '调整后应付字段在')
    assert.ok(sb && Number(sb.adjust_pending) === 0, 'B店（已付款后）调整已冲抵；明细仍可溯源（调整明细接口）')
    const md = ok(await call('GET', `/m/settlements/${settleA}`, null, mToken(uidM, midA)))
    assert.ok(md.adjustments && md.adjustments.length >= 1, '商户端可见调整明细')
    assert.ok(md.items.length >= 1, '结算单明细含订单（跨店按结算行联合查询）')
    const xrows = ok(await call('GET', `/admin/settlements/${settleA}/adjustments`, null, fin))
    assert.ok(xrows.some(x => Number(x.type) === 1), '调整明细接口可溯源')
    assert.equal((await call('GET', `/admin/settlements/${settleA}/adjustments`, null, ops)).code, 1003, '调整明细仅财务/超管')
  })

  console.log(`\nfix34 退回修复专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
