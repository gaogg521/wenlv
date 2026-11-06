// P0 资金类回归（全量检查 20261106）：A-01 免费改签 / A-02 旅豆过期 / A-03 取消未支付单 / A-07 价格校验
// 每项先复现问题再修复；探针口径见 docs/全量检查-问题清单与验收标准-20261106.md
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/audit-p0-funds.mjs')
import assert from 'node:assert/strict'
import { q, one, tx } from '../src/db.mjs'
import * as order from '../src/domain/order.mjs'
import * as bean from '../src/domain/bean.mjs'
import * as group from '../src/domain/group.mjs'
import * as jobs from '../src/jobs.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, (r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }
let passN = 0
const t = async (name, fn) => { try { await fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const stamp = Date.now().toString(36)
const created = { sessions: [], orders: [], products: [] }

const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
const giveBeans = async (uid, n) => bean.grant(uid, n, bean.BIZ.TASK, 'audp0-' + stamp + '-' + uid + '-' + n, budget.id)

const cLogin = async (tag) => {
  const code = 'mock-audp0-' + tag + '-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  return { token: r.token, id: Number(r.user.id), code }
}

// 远期团期夹具（不碰种子团期）
const mkSession = async ({ days = 60, price = 10000, quota = 50, minGo = 1, productId, early = null } = {}) => {
  let pid = productId
  if (!pid) {
    pid = await tx(async (c) => c.ins(`INSERT INTO tour_product (title, cat, city_code, merchant_id, price_from, bean_gift, days_desc, status)
      VALUES (?, 'script', '310118', (SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1), ?, 0, '1天', 1)`, ['P0夹具·' + stamp, price]))
    created.products.push(Number(pid))
  }
  const r = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, early_price, early_days, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0, ?, ?, ?, ?, 1)',
    [pid, days, quota, minGo, price, early ? early.price : null, early ? early.days : null])
  const id = Number(r.insertId)
  created.sessions.push(id)
  return id
}
const placePaid = async (uid, sid, qty = 1, beans = 0) => {
  const r = await order.place({ userId: uid, sessionId: sid, qty, wantedBeans: beans, withInsurance: false })
  created.orders.push(r.orderNo)
  await order.acceptPayment(r.orderNo, 'P0' + r.orderNo, true)
  return r.orderNo
}
const cleanup = async () => {
  // 订单相关流水先删（verification_log 挂凭证、order_event/attest/refund/payment 挂订单），再删订单与团期
  for (const no of created.orders) {
    await q('DELETE v FROM verification_log v JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no])
    await q('DELETE attest_event FROM attest_event JOIN travel_pass tp ON tp.id = attest_event.biz_ref AND attest_event.biz_type = \'pass_issue\' WHERE tp.order_id = (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE tp FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no])
    await q('DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM payment WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM order_event WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM commission WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM orders WHERE order_no = ?', [no])
  }
  await q('DELETE FROM tour_session WHERE id IN (?)', [created.sessions.length ? created.sessions : [0]])
  await q('DELETE FROM tour_product WHERE id IN (?)', [created.products.length ? created.products : [0]])
}
process.on('exit', () => {}) // 清理由文件末尾显式执行（数据库连接在进程内）

console.log('== A-01 未成团免费改签 ==')
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

await t('A01-1 改签单实收为 0、有凭证、无支付记录、refund_deadline 已写、状态 30 可核销', async () => {
  const u = await cLogin('a01a')
  const sid = await mkSession({ days: 0, minGo: 99 }) // 立即未成团
  const target = await mkSession({ days: 30 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const old = await order.byNo(no)
  assert.equal(Number(old.status), 70, '原单应已全额退款')
  const rb = ok(await call('POST', `/c/orders/${no}/rebook`, { sessionId: target }, u.token))
  created.orders.push(rb.orderNo)
  const nw = await order.byNo(rb.orderNo)
  assert.equal(Number(nw.status), 30, '改签单应直接出票（30）')
  assert.equal(Number(nw.amount_pay), 0, '改签单实收必须为 0（商户承担成本）')
  assert.equal(Number(nw.bean_deducted), 0, '改签单不抵扣旅豆')
  assert.ok(nw.rebook_of === no, 'rebook_of 指向原单')
  assert.ok(nw.refund_deadline, '改签单必须写 refund_deadline（否则走不到完成）')
  assert.ok(nw.paid_at, '改签单应有出票时间')
  const payRows = await q('SELECT id FROM payment WHERE order_id = ?', [nw.id])
  assert.equal(payRows.length, 0, '改签单不产生支付记录')
  const passes = await q('SELECT id, status FROM travel_pass WHERE order_id = ?', [nw.id])
  assert.equal(passes.length, Number(nw.qty), '改签单凭证已出（同事务，不留半成品）')
  assert.ok(passes.every((p) => Number(p.status) === 1), '凭证可用')
  // 扫码可核销（走完 出票→核销→完成 的第一段）
  const qr = ok(await call('GET', `/c/pass/${passes[0].id}/code`, null, u.token))
  const staff = await cLogin('a01staff')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM tour_product WHERE id = (SELECT product_id FROM orders WHERE order_no = ?)), ?, 3)', [rb.orderNo, staff.id])
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: 0 })).token
  const scan = ok(await call('POST', '/m/verify/scan', { payload: qr.qr }, mTok))
  assert.equal(scan.ok, true, '改签单扫码核销成功：' + (scan.reason || ''))
})

await t('A01-2 每单只能免费改签一次；并发改签也只成功一次', async () => {
  const u = await cLogin('a01b')
  const sid = await mkSession({ days: 0, minGo: 99 })
  const t1 = await mkSession({ days: 31 })
  const t2 = await mkSession({ days: 32 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const r1 = call('POST', `/c/orders/${no}/rebook`, { sessionId: t1 }, u.token)
  const r2 = call('POST', `/c/orders/${no}/rebook`, { sessionId: t2 }, u.token)
  const [a, b] = await Promise.all([r1, r2])
  const wins = [a, b].filter((x) => x.code === 0)
  assert.equal(wins.length, 1, `并发改签只能成功一次，实际 ${wins.length}`)
  const n = await one('SELECT COUNT(*) c FROM orders WHERE rebook_of = ?', [no])
  assert.equal(Number(n.c), 1, 'rebook_of 唯一')
  for (const w of wins) created.orders.push(w.data.orderNo)
})

await t('A01-3 目标团期必须未出发、同频道、同价、有名额', async () => {
  const u = await cLogin('a01c')
  const sid = await mkSession({ days: 0, minGo: 99 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  // 已出发的团期：直接插一条昨天出发的在售团期
  const past = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES ((SELECT product_id FROM orders WHERE order_no = ?), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 10, 0, 1, 10000, 1)', [no])
  created.sessions.push(Number(past.insertId))
  const r = await call('POST', `/c/orders/${no}/rebook`, { sessionId: Number(past.insertId) }, u.token)
  assert.notEqual(r.code, 0, '已出发团期不可作为改签目标')
  // 不同价的团期
  const other = await mkSession({ days: 33, price: 12800 })
  const r2 = await call('POST', `/c/orders/${no}/rebook`, { sessionId: other }, u.token)
  assert.notEqual(r2.code, 0, '不同价团期不可改签')
})

await t('A01-4 改签单不能发起原路退款、不产生第二笔退款；游客取消改签单释放名额不退款', async () => {
  const u = await cLogin('a01d')
  const sid = await mkSession({ days: 0, minGo: 99 })
  const target = await mkSession({ days: 34 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const rb = ok(await call('POST', `/c/orders/${no}/rebook`, { sessionId: target }, u.token))
  created.orders.push(rb.orderNo)
  const nw = await order.byNo(rb.orderNo)
  const quote = await call('GET', `/c/orders/${rb.orderNo}/refund-quote`, null, u.token)
  assert.equal(quote.data.allowed, false, '改签单退款试算必须拒绝')
  const rfCountBefore = (await q('SELECT COUNT(*) c FROM refunds WHERE order_id = ?', [nw.id])).length
  const rf = await call('POST', `/c/orders/${rb.orderNo}/refund`, { reason: '再退一次' }, u.token)
  const rfCountAfter = (await q('SELECT COUNT(*) c FROM refunds WHERE order_id = ?', [nw.id])).length
  assert.equal(rfCountAfter, rfCountBefore, '改签单不得新建退款单（mock 下此前真的会再退一次）')
  const after = await order.byNo(rb.orderNo)
  assert.equal(Number(after.status), 90, '取消改签单后订单关闭')
  const sess = await one('SELECT booked FROM tour_session WHERE id = ?', [target])
  assert.equal(Number(sess.booked), 0, '取消改签单释放名额')
  const beanRows = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.biz_ref = ?`, [u.id, rb.orderNo])
  assert.equal(beanRows.length, 0, '改签单取消不退旅豆（本来就没抵扣）')
})

await t('A01-5 改签单完成不产生佣金/返豆/成长值；结算单不含这一单', async () => {
  const u = await cLogin('a01e')
  const sid = await mkSession({ days: 0, minGo: 99, price: 20000 })
  const target = await mkSession({ days: 35, price: 20000 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const rb = ok(await call('POST', `/c/orders/${no}/rebook`, { sessionId: target }, u.token))
  created.orders.push(rb.orderNo)
  const nw = await order.byNo(rb.orderNo)
  const growthBefore = Number((await one('SELECT growth_value FROM user_account WHERE id = ?', [u.id])).growth_value)
  const balBefore = await bean.balance(u.id)
  // 先扫码核销（走完 出票→核销→完成 的中间段），再把观察期拨到过去并完成
  const passes0 = await q('SELECT id FROM travel_pass WHERE order_id = ?', [nw.id])
  const qr = ok(await call('GET', `/c/pass/${passes0[0].id}/code`, null, u.token))
  const staff5 = await cLogin('a01estaff')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?, ?, 3)', [Number(nw.merchant_id), staff5.id])
  const mTok5 = ok(await call('POST', '/m/auth/login', { code: staff5.code, merchantId: Number(nw.merchant_id) })).token
  const scan5 = ok(await call('POST', '/m/verify/scan', { payload: qr.qr }, mTok5))
  assert.equal(scan5.ok, true, '改签单扫码核销成功')
  await q('UPDATE orders SET refund_deadline = NOW(3) - INTERVAL 1 DAY WHERE order_no = ?', [rb.orderNo])
  assert.equal(await jobs.completeOrder(rb.orderNo), true, '改签单应能走完观察期进入完成')
  const done = await order.byNo(rb.orderNo)
  assert.equal(Number(done.status), 50, '改签单完成后状态 50')
  const comm = await one('SELECT id FROM commission WHERE order_id = ?', [nw.id])
  assert.ok(!comm, '改签单不产生佣金')
  const rebate = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.biz_type = 1 AND l.biz_ref = ?`, [u.id, rb.orderNo])
  assert.equal(rebate.length, 0, '改签单不返旅豆')
  const growthAfter = Number((await one('SELECT growth_value FROM user_account WHERE id = ?', [u.id])).growth_value)
  assert.equal(growthAfter, growthBefore, '改签单不加成长值')
  assert.equal(await bean.balance(u.id), balBefore, '旅豆余额不变')
  // 结算：该商户所有应结算订单（50、未结算、非改签）之和必须等于结算单总额
  const mid = Number(nw.merchant_id)
  const period = '2026-W00'
  const { generateSettlement } = await import('../src/domain/promo.mjs')
  const settleId = await generateSettlement(mid, period)
  assert.ok(settleId > 0, '结算单已生成')
  const s = await one('SELECT * FROM settlement WHERE id = ?', [settleId])
  const expected = await one(`SELECT COALESCE(SUM(o.amount_pay - o.insurance_fee),0) s FROM orders o
    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id = ?`, [mid, settleId])
  assert.equal(Number(s.total_amount), Number(expected.s), '结算单总额 = 本单明细之和（改签单金额为 0 不计入）')
  const rebookIn = await one('SELECT id FROM orders WHERE settlement_id = ? AND rebook_of IS NOT NULL', [settleId])
  assert.ok(!rebookIn, '改签单不进结算明细')
  const co = await one('SELECT id FROM co_profit WHERE settlement_id = ?', [settleId])
  assert.ok(!co || Number(s.total_amount) === 0, '改签单不触发共创分润（本夹具无共创配置）')
  await q('UPDATE orders SET settlement_id = NULL WHERE settlement_id = ?', [settleId])
  await q('UPDATE refunds SET settlement_id = NULL WHERE settlement_id = ?', [settleId])
  await q('DELETE FROM co_profit WHERE settlement_id = ?', [settleId])
  await q("DELETE FROM attest_event WHERE biz_type = 'settlement' AND biz_ref = ?", ['settle-' + settleId])
  await q('DELETE FROM settlement WHERE id = ?', [settleId])
})

await t('A01-6 商户端订单详情/结算明细可见「免费改签单·实收 ¥0」标记', async () => {
  const u = await cLogin('a01f')
  const sid = await mkSession({ days: 0, minGo: 99 })
  const target = await mkSession({ days: 36 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const rb = ok(await call('POST', `/c/orders/${no}/rebook`, { sessionId: target }, u.token))
  created.orders.push(rb.orderNo)
  const staff = await cLogin('a01fstaff')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM orders WHERE order_no = ?), ?, 2)', [rb.orderNo, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM orders WHERE order_no = ?', [rb.orderNo])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  const list = ok(await call('GET', '/m/orders', null, mTok))
  const row = list.find((x) => x.order_no === rb.orderNo)
  assert.ok(row, '商户端订单列表可见改签单')
  assert.equal(row.rebook, true, '列表行带 rebook 标记')
  const det = ok(await call('GET', `/m/orders/${rb.orderNo}`, null, mTok))
  assert.equal(det.rebook, true, '详情带 rebook 标记')
  assert.equal(Number(det.amount_pay), 0, '详情实收为 0')
})

await t('A01-7 游客详情页文案：全额退款，并可免费改签（不再是「或」）', async () => {
  const fs = await import('node:fs')
  const wxml = fs.readFileSync(new URL('../../mini-a/package-tour/pages/detail/index.wxml', import.meta.url), 'utf8')
  assert.ok(!/改签同类团期或全额退款|免费改签同类团期或全额退款/.test(wxml), '不应再出现「改签…或全额退款」的二选一文案')
  assert.ok(/全额退款/.test(wxml) && /免费改签/.test(wxml), '文案应同时包含全额退款与免费改签')
})

console.log('== A-02 旅豆过期（FIFO、幂等） ==')

const ageGrant = async (uid, n) => {
  const acc = await one('SELECT id FROM bean_account WHERE user_id = ?', [uid])
  const first = await one('SELECT id, tx_no FROM bean_ledger WHERE account_id = ? AND direction = 1 AND biz_type = 2 AND biz_ref LIKE ? ORDER BY id LIMIT 1', [acc.id, 'audp0-' + stamp + '-%'])
  const rows = await q('SELECT amount FROM bean_ledger WHERE account_id = ? AND id = ?', [acc.id, first.id])
  // 双侧分录（用户+哨兵）一起拨时间：单边拨会破坏日终根的按日借贷恒等（closeBeanDay 拒绝封存）
  await q('UPDATE bean_ledger SET created_at = NOW() - INTERVAL 14 MONTH WHERE tx_no = ?', [first.tx_no])
  return Number(rows[0].amount)
}

await t('A02-1 连跑 3 轮过期任务只扣一次', async () => {
  const u = await cLogin('a02a')
  await giveBeans(u.id, 300)
  await giveBeans(u.id, 700)
  assert.equal(await ageGrant(u.id, 300), 300)
  await jobs.tickExpire()
  const b1 = await bean.balance(u.id)
  await jobs.tickExpire()
  await jobs.tickExpire()
  const b3 = await bean.balance(u.id)
  assert.equal(b1, 700, '第一轮应扣 300')
  assert.equal(b3, 700, `第二、三轮不得再扣（当前 ${b3}）`)
})

await t('A02-2 已花掉的旧豆不再扣；部分消费只扣剩余', async () => {
  const u = await cLogin('a02b')
  await giveBeans(u.id, 1000)
  assert.ok((await ageGrant(u.id, 1000)) === 1000)
  // 以 deduct(4) 模拟真实消费 400（下单→支付→核销链路太重，FIFO 消费口径一致）
  await bean.deduct(u.id, 400, bean.BIZ.DEDUCT, 'AUDSPEND-' + stamp)
  await jobs.tickExpire()
  const b1 = await bean.balance(u.id)
  assert.equal(b1, 0, `旧豆 1000 已花 400，过期扣剩余 600 后应为 0（当前 ${b1}）`)
  await jobs.tickExpire()
  assert.equal(await bean.balance(u.id), 0, '第二轮不得再扣')
  // 恒等校验只针对本夹具账户（全库试算可能含其他测试的夹具残留）
  const mine = await one(`SELECT a.balance, COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), 0) derived
    FROM bean_account a LEFT JOIN bean_ledger l ON l.account_id = a.id WHERE a.user_id = ? GROUP BY a.id, a.balance`, [u.id])
  assert.equal(Number(mine.balance), Number(mine.derived), '夹具账户借贷恒等（余额 = 台账净额）')
})

await t('A02-3 旧豆花完后新豆不被误扣', async () => {
  const u = await cLogin('a02c')
  await giveBeans(u.id, 300)
  await giveBeans(u.id, 400)
  assert.ok((await ageGrant(u.id, 300)) === 300)
  await bean.deduct(u.id, 300, bean.BIZ.DEDUCT, 'AUDSPEND2-' + stamp)
  await jobs.tickExpire()
  const b = await bean.balance(u.id)
  assert.equal(b, 400, `旧豆 300 已全部花掉，新豆 400 不得被扣（当前 ${b}）`)
})

console.log('== A-03 取消未支付订单：退豆 + 释放名额 ==')

await t('A03-1 游客取消未支付单：旅豆全额退回、名额释放、幂等', async () => {
  const u = await cLogin('a03a')
  await giveBeans(u.id, 500)
  const sid = await mkSession({ days: 41 })
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 2, wantedBeans: 200, withInsurance: false })
  created.orders.push(r.orderNo)
  assert.equal(await bean.balance(u.id), 300)
  const b1 = ok(await call('POST', `/c/orders/${r.orderNo}/refund`, { reason: '用户申请' }, u.token))
  assert.equal(Number((await order.byNo(r.orderNo)).status), 90, '取消后关单')
  assert.equal(await bean.balance(u.id), 500, '抵扣旅豆应全额退回')
  assert.equal(Number((await one('SELECT booked FROM tour_session WHERE id = ?', [sid])).booked), 0, '名额应释放')
  await jobs.tickExpire().catch(() => {}); await order.closeTimeout()
  assert.equal(await bean.balance(u.id), 500, '跑超时任务后不得再退')
  const again = await call('POST', `/c/orders/${r.orderNo}/refund`, { reason: '重复调用' }, u.token)
  assert.equal(await bean.balance(u.id), 500, '重复取消不得重复退豆')
  const rev = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.biz_type = 5 AND l.biz_ref = ? AND l.direction = 1`, [u.id, r.orderNo])
  assert.equal(rev.length, 1, '退豆台账只有一条')
})

await t('A03-2 并发取消只退一次', async () => {
  const u = await cLogin('a03b')
  await giveBeans(u.id, 300)
  const sid = await mkSession({ days: 42 })
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 1, wantedBeans: 100, withInsurance: false })
  created.orders.push(r.orderNo)
  const [x, y] = await Promise.all([
    call('POST', `/c/orders/${r.orderNo}/refund`, { reason: '并发1' }, u.token),
    call('POST', `/c/orders/${r.orderNo}/refund`, { reason: '并发2' }, u.token),
  ])
  const rev = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.biz_type = 5 AND l.biz_ref = ? AND l.direction = 1`, [u.id, r.orderNo])
  assert.equal(rev.length, 1, `并发取消只能有一条退豆分录，实际 ${rev.length}`)
  assert.equal(await bean.balance(u.id), 300, '并发取消后余额正确')
})

await t('A03-3 未成团自动取消：未支付单的抵扣旅豆同样退回', async () => {
  const u = await cLogin('a03c')
  await giveBeans(u.id, 500)
  const sid = await mkSession({ days: 1, minGo: 99 })
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 1, wantedBeans: 100, withInsurance: false })
  created.orders.push(r.orderNo)
  assert.equal(await bean.balance(u.id), 400)
  await group.cancelDueSessions()
  const o = await order.byNo(r.orderNo)
  assert.equal(Number(o.status), 90, '未成团取消关单')
  assert.equal(await bean.balance(u.id), 500, '未成团取消应退抵扣旅豆')
})

console.log('== A-07 价格校验 ==')

await t('A07-1 早鸟价必须为正整数且低于现价；天数非负整数', async () => {
  const staff = await cLogin('a07a')
  const sid = await mkSession({ days: 43, price: 10000 })
  const pid = Number((await one('SELECT product_id FROM tour_session WHERE id = ?', [sid])).product_id)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM tour_product WHERE id = ?), ?, 3)', [pid, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  for (const bad of [{ price: -500, days: 3 }, { price: 0, days: 3 }, { price: 10000, days: 3 }, { price: 20000, days: 3 }, { price: 500.5, days: 3 }]) {
    const r = await call('POST', `/m/supply/${sid}`, { action: 'early', value: bad }, mTok)
    assert.notEqual(r.code, 0, `早鸟价 ${JSON.stringify(bad)} 应被拒绝`)
  }
  for (const bad of [{ price: 8000, days: -1 }, { price: 8000, days: 1.5 }]) {
    const r = await call('POST', `/m/supply/${sid}`, { action: 'early', value: bad }, mTok)
    assert.notEqual(r.code, 0, `early_days ${JSON.stringify(bad.days)} 应被拒绝`)
  }
  const good = await call('POST', `/m/supply/${sid}`, { action: 'early', value: { price: 8000, days: 3 } }, mTok)
  assert.equal(good.code, 0, '合法早鸟价应成功')
})

await t('A07-2 改现价时同步校验：不得低于已设早鸟价；priceForSession 取较低价', async () => {
  const staff = await cLogin('a07b')
  const sid = await mkSession({ days: 44, price: 10000 })
  const pid = Number((await one('SELECT product_id FROM tour_session WHERE id = ?', [sid])).product_id)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM tour_product WHERE id = ?), ?, 3)', [pid, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  ok(await call('POST', `/m/supply/${sid}`, { action: 'early', value: { price: 9000, days: 30 } }, mTok))
  const r = await call('POST', `/m/supply/${sid}`, { action: 'price', value: 5000 }, mTok)
  assert.notEqual(r.code, 0, '现价改到早鸟价之下应被拒绝（此前会造成实付 ¥90 还显示早鸟）')
  ok(await call('POST', `/m/supply/${sid}`, { action: 'price', value: 9500 }, mTok))
  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sid])
  const { price } = order.priceForSession({ ...s, depart_date: String(s.depart_date).slice(0, 10) })
  assert.ok(price <= Number(s.price_adult), 'priceForSession 必须取较低价')
  assert.equal(price, 9000, '早鸟窗口内取早鸟价')
})

await t('A07-3 下单兜底：金额非正的团期下单被拒', async () => {
  const u = await cLogin('a07c')
  // 直接把夹具团期价格改成 0（绕过商户接口），模拟“负价/零价已落库”的最坏情况
  const sid = await mkSession({ days: 45, price: 10000 })
  await q('UPDATE tour_session SET price_adult = 0 WHERE id = ?', [sid])
  let err = null, placed = null
  try { placed = await order.place({ userId: u.id, sessionId: sid, qty: 1, wantedBeans: 0, withInsurance: false }) } catch (e) { err = e }
  if (placed) created.orders.push(placed.orderNo)
  assert.ok(err, 'amount_pay <= 0 的下单必须被拒')
})

await cleanup()
console.log(`\n${passN} 项通过`)
const { closeDb } = await import('../src/db.mjs')
await closeDb()
process.exit(process.exitCode || 0)
