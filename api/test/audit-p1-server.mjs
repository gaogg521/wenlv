// P1 回归（全量检查 20261106）：A-08 手机号凭证 / A-09 暗号可见 / A-10 离线核销 / A-11 日期窗与过期
// A-12 提现并发与限额 / A-13 迟到支付 / A-14 退款异步 / A-15 佣金 / A-16 约稿 / A-17 跨端令牌 / A-20 openid 补写 / A-21 防爆破 / A-22 生产密钥
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/audit-p1-server.mjs')
import assert from 'node:assert/strict'
import { q, one, tx } from '../src/db.mjs'
import * as order from '../src/domain/order.mjs'
import * as bean from '../src/domain/bean.mjs'
import * as promo from '../src/domain/promo.mjs'
import * as jobs from '../src/jobs.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, (r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }
let passN = 0
const t = async (name, fn) => { try { await fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const stamp = Date.now().toString(36)
const created = { sessions: [], orders: [], users: [] }

const cLogin = async (tag) => {
  const code = 'mock-audp1-' + tag + '-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  created.users.push(Number(r.user.id))
  return { token: r.token, id: Number(r.user.id), code }
}
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

const mkSession = async ({ days = 60, price = 10000, quota = 50, minGo = 1, productId } = {}) => {
  // 先清同商品同日期的历史残留（uk_prod_date 唯一键），再插入
  await q('DELETE FROM tour_session WHERE product_id = ? AND depart_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)', [productId, days]).catch(() => {})
  const r = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0, ?, ?, 1)',
    [productId, days, quota, minGo, price])
  const id = Number(r.insertId)
  created.sessions.push(id)
  return id
}
const placePaid = async (uid, sid, qty = 1, beans = 0, promoScene = null) => {
  const r = await order.place({ userId: uid, sessionId: sid, qty, wantedBeans: beans, promoScene, withInsurance: false })
  created.orders.push(r.orderNo)
  await order.acceptPayment(r.orderNo, 'P1' + r.orderNo, true)
  return r.orderNo
}
const cleanup = async () => {
  for (const no of created.orders) {
    await q('DELETE v FROM verification_log v JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE tp FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM payment WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM order_event WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM commission WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM risk_event WHERE detail LIKE ?', ['%' + no + '%']).catch(() => {})
    await q('DELETE FROM orders WHERE order_no = ?', [no]).catch(() => {})
  }
  await q('DELETE FROM tour_session WHERE id IN (?)', [created.sessions.length ? created.sessions : [0]]).catch(() => {})
}
process.on('exit', () => {})

console.log('== A-08 一键获取手机号 ==')
await t('A08-1 /c/auth/phone 下发短期凭证（不回传明文号码）；下单用凭证落库加密、后台见脱敏值', async () => {
  const u = await cLogin('a08')
  const r = await call('POST', '/c/auth/phone', { code: 'get-phone-mock' }, u.token)
  assert.equal(r.code, 0, r.msg)
  assert.ok(r.data.ticket, '应下发短期凭证')
  assert.ok(!/\d{11}/.test(JSON.stringify(r.data)), '响应不得包含完整 11 位号码: ' + JSON.stringify(r.data))
  const sid = await mkSession({ days: 50, price: 10000, productId: 1 })
  const placed = ok(await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '凭证测试', phoneTicket: r.data.ticket }, u.token))
  created.orders.push(placed.orderNo)
  const o = await one('SELECT contact_phone_sealed, contact_name FROM orders WHERE order_no = ?', [placed.orderNo])
  assert.ok(o && o.contact_phone_sealed && o.contact_phone_sealed.length > 0, '联系电话已加密落库')
  const det = ok(await call('GET', `/c/orders/${placed.orderNo}`, null, u.token))
  assert.ok(/\*\*\*\*/.test(det.contactPhone || ''), '游客端展示脱敏值: ' + det.contactPhone)
  // 过期/伪造凭证被拒
  const bad = await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '伪造', phoneTicket: r.data.ticket.slice(0, -2) + 'xx' }, u.token)
  assert.notEqual(bad.code, 0, '篡改凭证必须被拒')
})

console.log('== A-09 游客可见入戏暗号 ==')
await t('A09-1 /c/pass/:id/code 返回 orderNo；订单详情→核销码真实路径能拿到暗号', async () => {
  const u = await cLogin('a09')
  const pid = await one("SELECT id FROM tour_product WHERE phrase_user IS NOT NULL AND status = 1 ORDER BY id LIMIT 1")
  if (!pid) { console.log('    （无暗号商品，跳过）'); return }
  const sid = await mkSession({ days: 20, productId: Number(pid.id) })
  const no = await placePaid(u.id, sid)
  const passes = await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [no])
  const code = ok(await call('GET', `/c/pass/${passes[0].id}/code`, null, u.token))
  assert.ok(code.orderNo === no, 'code 接口必须返回订单号（pass-code 页 loadPhrase 依赖）: ' + JSON.stringify(code).slice(0, 120))
  const ph = ok(await call('GET', `/c/orders/${no}/phrase`, null, u.token))
  assert.equal(ph.enabled, true, '剧本游暗号可用')
})

console.log('== A-10 离线核销恢复上传 ==')
await t('A10-1 名单有效期内的离线记录按 offlineAt 窗口核销成功；伪造 offlineAt 进冲突；重复进冲突', async () => {
  const u = await cLogin('a10')
  const staff = await cLogin('a10staff')
  const sid = await mkSession({ days: 0, productId: 1 })
  const no = await placePaid(u.id, sid)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM orders WHERE order_no = ?), ?, 3)', [no, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM orders WHERE order_no = ?', [no])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  // 断网前同步名单（服务端记录签发时间），再回拨签发时间模拟"离线了 10 分钟才扫的码"
  const list = ok(await call('GET', '/m/verify/offline-list', null, mTok))
  await q('UPDATE verify_offline_sync SET issued_at = NOW(3) - INTERVAL 10 MINUTE WHERE merchant_id = ?', [mid])
  const passes = await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?) AND status = 1', [no])
  const passId = Number(passes[0].id)
  const winSec = 60
  const offlineAt = new Date(Date.now() - 8 * 60000).toISOString() // 名单签发 2 分钟后扫的码（离线 8 分钟）
  const win = Math.floor(new Date(offlineAt).getTime() / 1000 / winSec)
  const sign = (await import('../src/domain/pass.mjs')).sign(passId, win)
  const payload = `wl://v/${passId}/${win}/${sign}`
  // 在线扫码该“离线时刻”的码：应失败（窗口不匹配）——证明 offlineAt 通道是必要的
  const online = await call('POST', '/m/verify/scan', { payload }, mTok)
  assert.equal(online.data.ok, false, '在线校验当前窗口，离线时刻的码不该直接通过')
  // 恢复上传：按 offlineAt 校验 → 成功
  const up = ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload, offlineAt }] }, mTok))
  assert.equal(up.uploaded, 1, '名单有效期内的离线记录应核销成功: ' + JSON.stringify(up.results))
  // 伪造 offlineAt（早于名单签发）：进冲突
  const passes2 = await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?) AND status = 1', [no])
  if (passes2.length) {
    const passId2 = Number(passes2[0].id)
    const win2 = Math.floor((Date.now() - 10 * 60000) / 1000 / winSec)
    const payload2 = `wl://v/${passId2}/${win2}/${(await import('../src/domain/pass.mjs')).sign(passId2, win2)}`
    const forged = ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload: payload2, offlineAt: new Date(Date.now() - 10 * 60000).toISOString() }] }, mTok))
    assert.equal(forged.conflicts, 1, '早于名单签发时间的 offlineAt 必须进冲突: ' + JSON.stringify(forged.results))
    await q('DELETE FROM verify_offline_conflict WHERE pass_id = ?', [passId2])
  }
  // 重复上传同一条：进冲突（已核销）
  const dup = ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload, offlineAt }] }, mTok))
  assert.equal(dup.conflicts, 1, '重复上传进冲突')
  await q('DELETE FROM verify_offline_conflict WHERE pass_id = ?', [passId])
})

console.log('== A-11 凭证日期窗与过期终态 ==')
await t('A11-1 提前/过期扫码被拒（提示明确）；过期未核销任务自动全额退款+凭证作废+通知', async () => {
  const u = await cLogin('a11')
  const staff = await cLogin('a11staff')
  const future = await mkSession({ days: 60, productId: 1 })
  const noF = await placePaid(u.id, future)
  const qrF = ok(await call('GET', `/c/pass/${(await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [noF]))[0].id}/code`, null, u.token))
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM orders WHERE order_no = ?), ?, 3)', [noF, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM orders WHERE order_no = ?', [noF])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  const rF = await call('POST', '/m/verify/scan', { payload: qrF.qr }, mTok)
  assert.equal(rF.data.ok, false, '出发前 60 天不可核销')
  assert.ok(/未到出发日/.test(rF.data.reason || ''), '提示明确: ' + rF.data.reason)
  // 过期的：先在远期团期下单出票，再把团期拨到 20 天前（place 不接受过去日期，走真实路径后再拨）
  const past = await mkSession({ days: 30, productId: 1 })
  const noP = await placePaid(u.id, past)
  await q('UPDATE tour_session SET depart_date = DATE_SUB(CURDATE(), INTERVAL 20 DAY) WHERE id = ?', [past])
  const qrP = ok(await call('GET', `/c/pass/${(await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [noP]))[0].id}/code`, null, u.token))
  const rP = await call('POST', '/m/verify/scan', { payload: qrP.qr }, mTok)
  assert.equal(rP.data.ok, false, '过出发日 20 天不可核销')
  assert.ok(/核销有效期/.test(rP.data.reason || ''), '提示明确: ' + rP.data.reason)
  // 任务：过期未核销自动处理
  const n = await jobs.tickExpireVouchers()
  assert.ok(n >= 1, '至少处理 1 单')
  const oP = await order.byNo(noP)
  assert.equal(Number(oP.status), 70, '过期未核销应全额退款进入终态 70')
  assert.equal(oP.close_reason, 'verify_expired', '终态原因可追溯')
  const rf = await one('SELECT amount, status FROM refunds WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [noP])
  assert.ok(rf && Number(rf.amount) === Number(oP.amount_pay) && Number(rf.status) === 2, '自动全额退款')
  const tp = await q('SELECT status FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [noP])
  assert.ok(tp.every((x) => Number(x.status) === 4), '凭证作废')
  const oF = await order.byNo(noF)
  assert.equal(Number(oF.status), 30, '未过期的单不受影响')
  // 后台入口
  const adm = ok(await call('POST', '/admin/orders/expire-vouchers', {}, A))
  assert.ok(typeof adm.processed === 'number', '后台手动入口可用')
})

console.log('== A-12 提现并发与日限额 ==')
await t('A12-1 并发审批只有一次成功；审计/存证各一条；超日限额申请被拒', async () => {
  const u = await cLogin('a12')
  await ok(await call('POST', '/admin/promoters/register', { userId: u.id, tier: 1 }, A))
  const { createScene } = await import('../src/domain/promo.mjs')
  const scene = await createScene(u.id, 'p1test')
  // 造一笔可提现佣金：直接插 commission（status 0 → 放行）
  const uid2 = await cLogin('a12b')
  const sid = await mkSession({ days: 30, price: 200000, productId: 1 }) // ¥2000 → 5% 佣金 = ¥100，够起提
  await promo.hit(scene, uid2.id)
  const no = await placePaid(uid2.id, sid, 1, 0, scene) // 带 scene 下单（佣金链路用）
  await q('UPDATE orders SET status = 50, completed_at = NOW(3), refund_deadline = NOW(3) WHERE order_no = ?', [no])
  await promo.createCommission(no)
  await q('UPDATE commission SET status = 1, payable_at = NOW(3) WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [no]) // 放行为可提现
  const wd = ok(await call('POST', '/c/promote/withdraw', { note: 'p1测试' }, u.token))
  assert.ok(wd.id, '提现申请已建')
  // 并发审批
  const [r1, r2] = await Promise.all([
    call('POST', `/admin/withdrawals/${wd.id}/verdict`, { pass: true, payRef: 'P1TEST-' + stamp + '-A' }, A),
    call('POST', `/admin/withdrawals/${wd.id}/verdict`, { pass: true, payRef: 'P1TEST-' + stamp + '-B' }, A),
  ])
  const wins = [r1, r2].filter((x) => x.code === 0)
  assert.equal(wins.length, 1, `并发审批只能成功一次，实际 ${wins.length}`)
  const w = await one('SELECT status, pay_ref FROM promoter_withdraw WHERE id = ?', [wd.id])
  assert.equal(Number(w.status), 1, '已打款')
  const audits = await q("SELECT id FROM audit_log WHERE biz_ref = ? AND action = 'pay'", ['wd-' + wd.id])
  assert.equal(audits.length, 1, '审计只有一条')
  const atts = await q("SELECT id FROM attest_event WHERE biz_type = 'withdraw' AND biz_ref = ?", ['wd-' + wd.id])
  assert.equal(atts.length, 1, '存证只有一条')
  // 日限额：把参数调到 1 分，再申请应被拒（随后恢复；参数中心有双人复核，这里直接改库测口径）
  await q("UPDATE rule_config SET v = '1' WHERE k = 'promoter.withdraw_daily_max'")
  const over = await call('POST', '/c/promote/withdraw', { note: '超限' }, u.token)
  assert.notEqual(over.code, 0, '超过单日限额的申请必须被拒')
  await q("UPDATE rule_config SET v = '500000' WHERE k = 'promoter.withdraw_daily_max'")
})

console.log('== A-13 迟到支付 ==')
await t('A13-1 关单后的支付：留痕（payment+风险事件）+ 自动原路退款 + 回调幂等成功', async () => {
  const u = await cLogin('a13')
  const sid = await mkSession({ days: 40, productId: 1 })
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 1, wantedBeans: 0, withInsurance: false })
  created.orders.push(r.orderNo)
  await q('UPDATE orders SET created_at = NOW() - INTERVAL 1 HOUR WHERE order_no = ?', [r.orderNo])
  await order.closeTimeout()
  assert.equal(Number((await order.byNo(r.orderNo)).status), 90, '订单已超时关闭')
  // 直接走支付回调（迟到支付）
  const shared = await import('../src/routes/_shared.mjs')
  const resp = await shared.handlePayNotify(r.orderNo, 'LATETX-' + stamp, false)
  assert.equal(resp.code, 0, '回调必须返回成功（微信不再重试）')
  const pay = await one('SELECT status, amount FROM payment WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [r.orderNo])
  assert.ok(pay, '迟到支付有支付记录')
  const risk = await one("SELECT id FROM risk_event WHERE kind = 'late_payment' AND detail LIKE ?", ['%' + r.orderNo + '%'])
  assert.ok(risk, '有风险事件留痕')
  const rf = await one('SELECT amount, status FROM refunds WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [r.orderNo])
  assert.ok(rf && Number(rf.status) === 2 && Number(rf.amount) === pay.amount, '迟到支付已自动全额原路退回')
  // 幂等：同一交易号再来一次不重复
  const again = await shared.handlePayNotify(r.orderNo, 'LATETX-' + stamp, false)
  assert.equal(again.code, 0)
  const pays = await q('SELECT id FROM payment WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [r.orderNo])
  assert.equal(pays.length, 1, '同一交易号不重复入账')
})

console.log('== A-14 退款异步 ==')
await t('A14-1 假微信服务：PROCESSING 保持 60 → SUCCESS 自动完成并写 close_reason；CLOSED 转人工（refunds 3 + 风险事件）', async () => {
  const http = await import('node:http')
  // 假微信：可编程的退款查询结果（测试进程内驱动域函数，服务进程不参与）
  const state = { status: 'PROCESSING', orderNo: null }
  const srv = http.createServer((req, res) => {
    let buf = ''
    req.on('data', (c) => (buf += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url.startsWith('/v3/refund/domestic/refunds/')) {
        return res.end(JSON.stringify({ refund_id: 'FAKE', out_refund_no: decodeURIComponent(req.url.split('/').pop()), out_trade_no: state.orderNo, status: state.status, amount: { refund: 10000 } }))
      }
      res.end(JSON.stringify({ message: 'ok' }))
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.WXPAY_API_HOST = '127.0.0.1:' + srv.address().port
  process.env.WXPAY_API_HTTP = '1'
  // 生成真 RSA 私钥（请求需要 RSA-SHA256 签名；假服务不验签但签名本身要能算出来）
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  process.env.WX_APPID = 'wx-fake'; process.env.WX_MCHID = 'mch-fake'; process.env.WX_SERIAL = 'sn-fake'; process.env.WX_PRIVATE_KEY = privateKey
  await (await import('../src/domain/wxpay.mjs')).invalidateConfig()
  const refundNoOf = (no) => one('SELECT refund_no FROM refunds WHERE order_id = (SELECT id FROM orders WHERE order_no = ?) ORDER BY id DESC LIMIT 1', [no])
  try {
    const { refresh } = await import('../src/domain/refund.mjs')
    // 场景一：PROCESSING → 补偿任务不动 → SUCCESS 完成 + close_reason
    const u = await cLogin('a14')
    const sid = await mkSession({ days: 25, productId: 1 })
    const no = await placePaid(u.id, sid)
    state.orderNo = no
    const rfNo = 'RFP1' + stamp + 'A'
    await q(`INSERT INTO refunds (order_id, refund_no, amount, fee_amount, reason, status, operator, close_reason) VALUES ((SELECT id FROM orders WHERE order_no = ?), ?, 10000, 0, '异步退款测试', 0, 'test', 'group_cancel')`, [no, rfNo])
    await order.fire(no, 'REFUND_APPLY', 'test') // 30 → 60（模拟已提交微信、结果 PROCESSING）
    await refresh(no)
    assert.equal(Number((await order.byNo(no)).status), 60, 'PROCESSING 不应完成')
    await jobs.tickRefundRefresh()
    assert.equal(Number((await order.byNo(no)).status), 60, 'PROCESSING 下补偿任务也不动')
    state.status = 'SUCCESS'
    await jobs.tickRefundRefresh()
    const o1 = await order.byNo(no)
    assert.equal(Number(o1.status), 70, 'SUCCESS 后补偿任务完成退款')
    assert.ok(o1.close_reason, 'close_reason 已落库（异步路径不丢改签资格）')
    // 场景二：CLOSED → 退款单失败（3）+ 风险事件（人工入口），订单保持 60
    const u2 = await cLogin('a14b')
    const sid2 = await mkSession({ days: 26, productId: 1 })
    const no2 = await placePaid(u2.id, sid2)
    const rfNo2 = 'RFP1' + stamp + 'B'
    await q(`INSERT INTO refunds (order_id, refund_no, amount, fee_amount, reason, status, operator, close_reason) VALUES ((SELECT id FROM orders WHERE order_no = ?), ?, 10000, 0, 'CLOSED 测试', 0, 'test', NULL)`, [no2, rfNo2])
    await order.fire(no2, 'REFUND_APPLY', 'test')
    state.status = 'CLOSED'
    await jobs.tickRefundRefresh()
    const rf2 = await one('SELECT status FROM refunds WHERE refund_no = ?', [rfNo2])
    assert.equal(Number(rf2.status), 3, 'CLOSED → 退款单转失败（3），进人工队列')
    const risk = await one("SELECT id FROM risk_event WHERE kind = 'refund_failed' AND detail LIKE ?", ['%' + no2 + '%'])
    assert.ok(risk, '有风险事件（人工入口）')
    created.orders.push(no2)
  } finally {
    delete process.env.WXPAY_API_HOST; delete process.env.WXPAY_API_HTTP
    delete process.env.WX_APPID; delete process.env.WX_MCHID; delete process.env.WX_SERIAL; delete process.env.WX_PRIVATE_KEY
    await (await import('../src/domain/wxpay.mjs')).invalidateConfig()
    srv.close()
  }
})

console.log('== A-15 佣金 ==')
await t('A15-1 自买不计佣；按首触归因；基数 = 实付 − 保费（旅豆只减一次）', async () => {
  const p1u = await cLogin('a15p1')
  const p2u = await cLogin('a15p2')
  const buyer = await cLogin('a15buyer')
  await ok(await call('POST', '/admin/promoters/register', { userId: p1u.id, tier: 1 }, A))
  await ok(await call('POST', '/admin/promoters/register', { userId: p2u.id, tier: 1 }, A))
  const { createScene } = await import('../src/domain/promo.mjs')
  const s1 = await createScene(p1u.id, 'p1a'), s2 = await createScene(p2u.id, 'p1b')
  const sid = await mkSession({ days: 30, price: 100000, productId: 1 }) // ¥1000
  // 首触 p1，末触 p2
  await promo.hit(s1, buyer.id)
  await promo.hit(s2, buyer.id)
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  await bean.grant(buyer.id, 1000, bean.BIZ.TASK, 'a15-' + stamp, budget.id)
  const r = await order.place({ userId: buyer.id, sessionId: sid, qty: 1, wantedBeans: 1000, promoScene: s2, withInsurance: false }) // 带末触场景下单，佣金必须归首触 p1
  created.orders.push(r.orderNo)
  await order.acceptPayment(r.orderNo, 'P15' + r.orderNo, true)
  await q('UPDATE orders SET status = 50, completed_at = NOW(3), refund_deadline = NOW(3) WHERE order_no = ?', [r.orderNo])
  await promo.createCommission(r.orderNo)
  const c = await one('SELECT promoter_id, base_amount, amount FROM commission WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [r.orderNo])
  assert.ok(c, '佣金已计')
  assert.equal(Number(c.promoter_id), p1u.id, `佣金归首触 p1（实际 ${c.promoter_id} vs p1=${p1u.id}）`)
  // 决策口径：基数 = 实付 − 保费。¥1000 商品豆抵 ¥100 → 实付 ¥900 = 90000 分（旅豆只减一次）
  assert.equal(Number(c.base_amount), 90000, `基数 = 实付 900 元（旅豆只减一次），实际 ${c.base_amount}`)
  // 自买不计佣
  const sid2 = await mkSession({ days: 31, price: 10000, productId: 1 })
  await promo.hit(s1, p1u.id)
  const r2 = await order.place({ userId: p1u.id, sessionId: sid2, qty: 1, wantedBeans: 0, withInsurance: false })
  created.orders.push(r2.orderNo)
  await order.acceptPayment(r2.orderNo, 'P15B' + r2.orderNo, true)
  await q('UPDATE orders SET status = 50, completed_at = NOW(3), refund_deadline = NOW(3) WHERE order_no = ?', [r2.orderNo])
  await promo.createCommission(r2.orderNo)
  const c2 = await one('SELECT id FROM commission WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [r2.orderNo])
  assert.ok(!c2, '推广员本人下单不计佣')
})

console.log('== A-16 约稿奖励 ==')
await t('A16-1 一篇笔记只能投一个任务；字数/图片不足被拒；已截止/下线任务不能提交', async () => {
  const u = await cLogin('a16')
  const mkTask = async (name, extra = {}) => ok(await call('POST', '/admin/entities/task', { values: { title: name, brief: '拍够素材发笔记', category: 'note', reward_beans: 100, status: 0, min_words: 500, min_images: 3, ...extra } }, A)).id
  const t1 = await mkTask('任务一' + stamp)
  const t2 = await mkTask('任务二' + stamp)
  ok(await call('POST', `/c/tasks/${t1}/claim`, {}, u.token))
  ok(await call('POST', `/c/tasks/${t2}/claim`, {}, u.token))
  // 太短、无图
  const short = ok(await call('POST', '/c/notes', { title: '短笔记', body: '五个字' }, u.token))
  const s1 = await call('POST', `/c/tasks/${t1}/submit`, { noteId: short.id }, u.token)
  assert.notEqual(s1.code, 0, '不满足字数/图片要求的提交必须被拒')
  // 合格笔记投任务一（notes 接口的 body 是纯文本、images 单独传）
  const good = ok(await call('POST', '/c/notes', { title: '合格', body: '长'.repeat(520), images: ['a.png', 'b.png', 'c.png'] }, u.token))
  ok(await call('POST', `/c/tasks/${t1}/submit`, { noteId: good.id }, u.token))
  // 同一篇投任务二 → 拒
  const dup = await call('POST', `/c/tasks/${t2}/submit`, { noteId: good.id }, u.token)
  assert.notEqual(dup.code, 0, '一篇笔记只能用于一个任务')
  // 已截止任务不能提交（实体校验拒绝过去时间 → 先领取，再用 SQL 把截止时间拨到过去）
  const t3 = await mkTask('已截止' + stamp)
  ok(await call('POST', `/c/tasks/${t3}/claim`, {}, u.token))
  await q("UPDATE content_task SET deadline = '2020-01-01 00:00:00' WHERE id = ?", [t3])
  const late = await call('POST', `/c/tasks/${t3}/submit`, { noteId: short.id }, u.token)
  assert.notEqual(late.code, 0, '已截止任务不能提交')
  assert.ok(/截止/.test(late.msg || ''), '提示明确: ' + late.msg)
  await q('DELETE FROM content_task_entry WHERE user_id = ?', [u.id])
  await q('DELETE FROM content_note WHERE user_id = ?', [u.id])
  for (const tid of [t1, t2, t3]) await q('DELETE FROM content_task WHERE id = ?', [tid])
})

console.log('== A-17 跨端令牌 ==')
await t('A17-1 商户令牌调 /c/* 被拒；冻结账号的商户令牌立即失效', async () => {
  const u = await cLogin('a17')
  const code = 'mock-audp1-m17-' + stamp
  await call('POST', '/m/auth/login', { code }) // 造 mini_b 用户
  const mu = await one('SELECT id FROM user_account WHERE mini_b_openid = ?', ['mock-openid-' + code])
  created.users.push(Number(mu.id))
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (1, ?, 1)', [mu.id])
  const mTok = ok(await call('POST', '/m/auth/login', { code, merchantId: 1 })).token
  const cross = await call('GET', '/c/me', null, mTok)
  assert.notEqual(cross.code, 0, '商户令牌不得调游客接口（此前直接成功）')
  // 冻结后商户端立即失效
  await q('UPDATE user_account SET status = 0 WHERE id = ?', [mu.id])
  const wb = await call('GET', '/m/workbench', null, mTok)
  assert.notEqual(wb.code, 0, '冻结账号的商户令牌必须立即失效')
  await q('UPDATE user_account SET status = 1 WHERE id = ?', [mu.id])
})

console.log('== A-20 openid 补写 ==')
await t('A20-1 先 B 后 A：A 端登录补写 mini_a_openid 与旅豆账户（幂等）', async () => {
  const code = 'mock-audp1-x20-' + stamp
  await call('POST', '/m/auth/login', { code }) // 先 B 端
  const before = await one('SELECT id, mini_a_openid FROM user_account WHERE mini_b_openid = ?', ['mock-openid-' + code])
  created.users.push(Number(before.id))
  assert.equal(before.mini_a_openid, null, 'B 端登录不写 A openid（现状）')
  const r = ok(await call('POST', '/c/auth/login', { code }))
  assert.equal(Number(r.user.id), Number(before.id), 'unionid 归到同一账号')
  const after = await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [before.id])
  assert.equal(after.mini_a_openid, 'mock-openid-' + code, 'A 端登录补写 openid')
  const acct = await one('SELECT id FROM bean_account WHERE user_id = ?', [before.id])
  assert.ok(acct, '旅豆账户已建')
  // 幂等：再次登录不产生新账号
  const again = ok(await call('POST', '/c/auth/login', { code }))
  assert.equal(Number(again.user.id), Number(before.id), '重复登录同账号')
  const accts = await q('SELECT id FROM bean_account WHERE user_id = ?', [before.id])
  assert.equal(accts.length, 1, '旅豆账户不重复')
})

console.log('== A-21 后台登录防爆破 ==')
await t('A21-1 连续错误密码触发锁定（正确密码也被拒）；不泄露账号存在性；超管可解锁', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await call('POST', '/admin/login', { username: 'finance', password: 'wrong-' + i })
    assert.notEqual(r.code, 0)
  }
  const locked = await call('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })
  assert.notEqual(locked.code, 0, '锁定期间正确密码也不能登录')
  const lockedMsg = String(locked.msg || '')
  assert.ok(!/不存在/.test(lockedMsg), '提示不暴露账号是否存在')
  // 超管解锁
  const unl = ok(await call('POST', '/admin/login/unlock', { username: 'finance' }, A))
  assert.ok(unl.unlocked !== false, '解锁接口可用')
  const again = await call('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })
  assert.equal(again.code, 0, '解锁后可正常登录')
})

console.log('== A-22 生产密钥护栏 ==')
await t('A22-1 NODE_ENV=production 缺失/默认密钥拒绝启动（函数级）', async () => {
  const { assertProductionSecrets } = await import('../src/infra/boot-guard.mjs')
  const PROD = { NODE_ENV: 'production' }
  assert.throws(() => assertProductionSecrets({ ...PROD }), '缺 JWT_SECRET 必须拒启')
  assert.throws(() => assertProductionSecrets({ ...PROD, JWT_SECRET: 'wanderlust-dev-jwt-secret-change-me' }), '默认 JWT_SECRET 必须拒启')
  assert.throws(() => assertProductionSecrets({ ...PROD, JWT_SECRET: 'x'.repeat(40), PASS_SECRET: 'wanderlust-pass-code-secret' }), '默认 PASS_SECRET 必须拒启')
  assert.throws(() => assertProductionSecrets({ ...PROD, JWT_SECRET: 'x'.repeat(40), PASS_SECRET: 'y'.repeat(40) }), '缺 SECRETS_KEY 必须拒启')
  assert.doesNotThrow(() => assertProductionSecrets({ ...PROD, JWT_SECRET: 'x'.repeat(40), PASS_SECRET: 'y'.repeat(40), SECRETS_KEY: 'a'.repeat(64) }), '齐备时放行')
  assert.doesNotThrow(() => assertProductionSecrets({ NODE_ENV: 'development', JWT_SECRET: 'dev' }), '非生产不拦')
})

await cleanup()
console.log(`\n${passN} 项通过`)
const { closeDb } = await import('../src/db.mjs')
await closeDb()
process.exit(process.exitCode || 0)
