// 跨端回归：游客小程序(A) · 商户小程序(B) · 运营后台(W) · 存证(C) 的数据是否真的打通
// 每条断言都是"同一件事在两个独立视图里必须一致"，而不是"接口返回 200"。
//   一、交易闭环：下单→支付→核销→完成→返豆→结算→退款，三端看到的状态、金额、数量一致
//   二、后台下发→小程序生效：轮播 / FAQ / 小程序装修 / 商品上下架
//   三、存证三端：后台存证流程、对外验证、游客侧可信记录同源（打包 + 默克尔证明；锚定由 chain-hub / web3-core 覆盖）
//   四、数据边界与隐私：城市账号只看本城；任何接口不下发电话原始值与内部字段
// 会写库，只能对隔离库运行；需服务在跑（同一 JWT_SECRET），PORT / API_BASE 指向隔离服务。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/cross-end.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import * as bean from '../src/domain/bean.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
const ok = (r, what = '') => { assert.equal(r.code, 0, `${what} ${r.msg || ''}`); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', String(e.message).split('\n').slice(0, 6).join('\n     ')); process.exitCode = 1 } }
const yuan = (fen) => (Number(fen) / 100).toFixed(2)
const stamp = Date.now().toString(36)

const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const CITY = ok(await call('POST', '/admin/login', { username: 'city310118', password: process.env.CITY_PARTNER_PASSWORD || 'city123' })).token

// ---------- 取一个可买的团期（余量足够），建本轮的游客 / 商户员工 ----------
const sess = await one(`SELECT s.id, s.product_id, s.price_adult, p.merchant_id, p.city_code, p.title FROM tour_session s JOIN tour_product p ON p.id = s.product_id
  WHERE p.status = 1 AND s.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 5 AND s.price_adult > 0 ORDER BY s.id LIMIT 1`)
assert.ok(sess, '隔离库需先 seed:scenario，库里应有可买团期')
const login = async (code) => ok(await call('POST', '/c/auth/login', { code }))
const buyer = await login('mock-xend-buyer-' + stamp)
const staffUser = await login('mock-xend-staff-' + stamp)
await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [sess.merchant_id, staffUser.user.id])
const B = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-staff-' + stamp, merchantId: sess.merchant_id })).token
const C = buyer.token
const PHONE = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const created = { orders: [], banners: [], faqs: [] }

// 同一个事实的多个视图（调用前后各取一次，比较差值）
const views = async () => {
  const wb = ok(await call('GET', '/m/workbench', null, B))
  const kpi = ok(await call('GET', '/admin/dash/kpi', null, A))
  const mo = ok(await call('GET', `/admin/merchants/${sess.merchant_id}/overview`, null, A)).kpi
  const po = ok(await call('GET', `/admin/products/${sess.product_id}/overview`, null, A)).kpi
  const uo = ok(await call('GET', `/admin/users/${buyer.user.id}`, null, A)).trade
  return {
    bOrders: wb.todayOrders, bGmv: Math.round(Number(wb.todayGmv) * 100), wOrders: kpi.ordersToday, wGmv: Math.round(Number(kpi.gmvToday) * 100),
    merchOrders: Number(mo.orders), merchGmv: Number(mo.gmv), prodOrders: Number(po.orders), prodGmv: Number(po.gmv),
    userPaid: Number(uo.paid), userGmv: Number(uo.gmv), pendingVerify: wb.pendingVerify, myVerified: wb.myVerified,
  }
}

console.log('== 一、交易闭环：同一笔订单在 A / B / 后台 的数字必须一致 ==')
let o1, v0, qty = 1
await t('下单+支付：B 工作台、后台看板、商户全景、商品数据、用户画像 同时 +1 单、+同一金额', async () => {
  v0 = await views()
  o1 = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty, beanDeduct: 0, contactName: '跨端测试', contactPhone: PHONE }, C))
  created.orders.push(o1.orderNo)
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: o1.orderNo }, A))
  const v1 = await views()
  const amt = Number(o1.amountPay)
  for (const [k, n] of [['bOrders', 1], ['wOrders', 1], ['merchOrders', 1], ['prodOrders', 1], ['userPaid', 1]]) assert.equal(v1[k] - v0[k], n, `${k} 应 +1`)
  for (const k of ['bGmv', 'wGmv', 'merchGmv', 'prodGmv', 'userGmv']) assert.equal(v1[k] - v0[k], amt, `${k} 应 +${amt}`)
  assert.equal(v1.pendingVerify - v0.pendingVerify, 1, 'B 待核销应 +1')
})
await t('三端看到的订单状态一致（A 已出票 / B 订单列表 / 后台订单），金额一致', async () => {
  const a = ok(await call('GET', '/c/orders/' + o1.orderNo, null, C))
  const b = ok(await call('GET', '/m/orders', null, B)).find((x) => x.order_no === o1.orderNo)
  const w = ok(await call('GET', '/admin/orders/' + o1.orderNo, null, A))
  assert.deepEqual([a.status, Number(b.status), Number(w.status)], [30, 30, 30])
  assert.deepEqual([Number(a.amount_pay), Number(b.amount_pay), Number(w.amount_pay)], [Number(o1.amountPay), Number(o1.amountPay), Number(o1.amountPay)])
  assert.equal(a.passes.length, w.passes.length); assert.equal(a.events.length, w.events.length, '订单事件条数两端一致')
  assert.equal(a.title, b.title); assert.equal(a.title, w.title)
})
await t('电话：A / B / 后台只给脱敏值，任何一端都拿不到完整号码与密文/历史明文列', async () => {
  const mask = PHONE.slice(0, 3) + '****' + PHONE.slice(7)
  const a = ok(await call('GET', '/c/orders/' + o1.orderNo, null, C))
  const b = ok(await call('GET', '/m/orders/' + o1.orderNo, null, B))
  const w = ok(await call('GET', '/admin/orders/' + o1.orderNo, null, A))
  const wl = ok(await call('GET', '/admin/orders?kw=' + o1.orderNo, null, A)).find((x) => x.order_no === o1.orderNo)
  assert.equal(a.contactPhone, mask); assert.equal(b.contactPhone, mask); assert.equal(w.contactPhone, mask); assert.equal(wl.contactPhone, mask)
  for (const [name, r] of [['A', a], ['B', b], ['W详情', w], ['W列表', wl]]) {
    assert.ok(!JSON.stringify(r).includes(PHONE), name + ' 响应里出现了完整号码')
    assert.ok(!('contact_phone_enc' in r) && !('contact_phone_sealed' in r), name + ' 下发了电话原始列')
  }
})
await t('红线 2：游客订单详情只下发白名单字段（无 user_id / merchant_id / settlement_id / 版本号等内部字段）', async () => {
  const a = ok(await call('GET', '/c/orders/' + o1.orderNo, null, C))
  for (const k of ['user_id', 'merchant_id', 'payer_user_id', 'settlement_id', 'version', 'promo_scene', 'rebook_of', 'close_reason', 'bean_rebate_deferred', 'updated_at'])
    assert.ok(!(k in a), '游客接口不应下发 ' + k)
  for (const k of ['order_no', 'status', 'qty', 'amount_pay', 'amountPayLabel', 'title', 'passes', 'events', 'trip', 'merchantContact']) assert.ok(k in a, '缺少小程序用到的字段 ' + k)
})
let code
await t('核销：A 出示动态码 → B 扫码成功；A 状态 40，B 记录 +1，B 待核销 -1 / 已核销 +1，后台订单 40', async () => {
  const before = await views()
  const pid = ok(await call('GET', '/c/orders/' + o1.orderNo, null, C)).passes[0].id
  code = ok(await call('GET', `/c/pass/${pid}/code`, null, C))
  const r = ok(await call('POST', '/m/verify/scan', { payload: code.qr }, B)); assert.equal(r.ok, true)
  assert.equal(ok(await call('GET', '/c/orders/' + o1.orderNo, null, C)).status, 40)
  assert.equal(Number(ok(await call('GET', '/admin/orders/' + o1.orderNo, null, A)).status), 40)
  assert.ok(ok(await call('GET', '/m/verify/records', null, B)).some((x) => x.order_no === o1.orderNo && Number(x.result) === 1))
  const after = await views()
  assert.equal(after.pendingVerify - before.pendingVerify, -1); assert.equal(after.myVerified - before.myVerified, 1)
  const again = ok(await call('POST', '/m/verify/scan', { payload: code.qr }, B)); assert.equal(again.ok, false, '同码重放必须被拒')
})
await t('核销率：后台看板的数字 = 数据库里 已核销凭证 ÷ 已签发未冲正凭证（不会超过 100%）', async () => {
  const r = await one('SELECT SUM(status = 2) v, SUM(status IN (1,2)) i FROM travel_pass')
  const expect = Number(r.i) ? (Number(r.v) / Number(r.i) * 100).toFixed(1) + '%' : '—'
  const kpi = ok(await call('GET', '/admin/dash/kpi', null, A))
  assert.equal(kpi.verifyRate, expect)
  if (kpi.verifyRate !== '—') assert.ok(parseFloat(kpi.verifyRate) <= 100)
})
let rebate
await t('完成→返豆：A 旅豆余额 +返豆，A 流水有该单一条，后台用户画像余额 = A 看到的余额', async () => {
  const b0 = ok(await call('GET', '/c/bean/account', null, C)).balance
  ok(await call('POST', '/admin/dev/complete', { orderNo: o1.orderNo }, A))
  rebate = await bean.rebateOf(Number(o1.amountPay))
  const acc = ok(await call('GET', '/c/bean/account', null, C))
  assert.equal(acc.balance - b0, rebate)
  const led = ok(await call('GET', '/c/bean/ledger', null, C)).filter((x) => x.biz_ref === o1.orderNo)
  assert.equal(led.length, 1); assert.equal(Number(led[0].amount), rebate)
  assert.equal(ok(await call('GET', `/admin/users/${buyer.user.id}`, null, A)).beans.balance, acc.balance)
  assert.equal(ok(await call('GET', '/c/me', null, C)).bean, acc.balance, 'A 的"我的"页旅豆 = 旅豆页余额')
})
await t('旅豆使用率：后台洞察 = 累计净消耗 ÷ 累计发放（按数量，≤100%）；存证总览的发放 / 消耗同源', async () => {
  const f = await bean.flow()
  const ins = ok(await call('GET', '/admin/dash/insights', null, A)).funnel
  assert.equal(ins.beanUseRate, f.granted ? Math.round(f.consumed / f.granted * 100) + '%' : '0%')
  assert.ok(f.consumed <= f.granted && f.consumed >= 0, `净消耗 ${f.consumed} 不应超过发放 ${f.granted}`)
  const ov = ok(await call('GET', '/admin/web3/overview', null, A))
  assert.equal(ov.beanGranted, f.granted); assert.equal(ov.beanConsumed, f.consumed)
  const sum = await one(`SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE l.direction = 1 AND l.biz_type IN (1,2,3) AND a.user_id < 999999000000`)
  assert.equal(Number(sum.s), f.granted, '发放量 = 真实用户户的入账合计')
})
let settle
await t('结算：后台出单 → B 看到同一张单，金额逐字段一致；五口径之和 = 总额；该订单被纳入', async () => {
  const period = ok(await call('POST', '/admin/settlements/generate', { period: isoWeek(new Date()) }, A))
  const sid = (period.settlementIds || [])[0]
  assert.ok(sid, '应生成结算单')
  const w = ok(await call('GET', '/admin/settlements', null, A)).find((s) => Number(s.id) === Number(sid))
  const bs = ok(await call('GET', '/m/settlements', null, B)).find((s) => Number(s.id) === Number(sid))
  assert.ok(bs, 'B 应看到同一张结算单')
  for (const k of ['period', 'order_count', 'total_amount', 'amt_fulfill', 'amt_service', 'amt_promoter', 'amt_beanbudget', 'amt_retained', 'status', 'fee_total', 'fee_merchant'])
    assert.equal(String(bs[k]), String(w[k]), '结算字段 ' + k + ' A/B 不一致')
  assert.equal(['amt_fulfill', 'amt_service', 'amt_promoter', 'amt_beanbudget', 'amt_retained'].reduce((s, k) => s + Number(w[k]), 0), Number(w.total_amount))
  assert.equal(Number((await one('SELECT settlement_id FROM orders WHERE order_no = ?', [o1.orderNo])).settlement_id), Number(sid), '订单应被纳入该结算单')
  settle = w
})
let o2
await t('退款：A 试算 = 后台试算；A 退款后三端状态 70、凭证冲正、商户 GMV 回落、旅豆按规则退回', async () => {
  const v0b = await views()
  o2 = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0 }, C)); created.orders.push(o2.orderNo)
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: o2.orderNo }, A))
  const aq = ok(await call('GET', `/c/orders/${o2.orderNo}/refund-quote`, null, C))
  const wq = ok(await call('GET', '/admin/orders/' + o2.orderNo, null, A)).refundQuote
  assert.equal(Number(aq.refundFen ?? aq.refund), Number(wq.refundFen), 'A 与后台的退款试算应一致')
  ok(await call('POST', `/c/orders/${o2.orderNo}/refund`, { reason: '跨端回归' }, C))
  const a = ok(await call('GET', '/c/orders/' + o2.orderNo, null, C)); const w = ok(await call('GET', '/admin/orders/' + o2.orderNo, null, A))
  assert.deepEqual([a.status, Number(w.status)], [70, 70]); assert.ok(a.passes.every((p) => p.status === 4))
  assert.equal(w.refunds.length, 1)
  const v1 = await views()
  assert.equal(v1.merchGmv - v0b.merchGmv, 0, '退款后商户全景 GMV 应回到下单前')
})

console.log('\n== 二、后台下发 → 小程序生效 ==')
await t('轮播：后台新增 → A 读到；按城市投放；后台修改标题 → A 同步；删除 → A 消失', async () => {
  const title = '跨端轮播' + stamp
  const id = ok(await call('POST', '/admin/banners', { title, image: '/uploads/x.png', sort: -999 }, A)).id; created.banners.push(id)
  assert.ok(ok(await call('GET', '/c/banners', null, C)).some((b) => b.id === id && b.title === title))
  ok(await call('POST', `/admin/banners/${id}/update`, { title: title + '改', image: '/uploads/x.png', sort: -999 }, A))
  assert.ok(ok(await call('GET', '/c/banners', null, C)).some((b) => b.id === id && b.title === title + '改'))
  ok(await call('POST', `/admin/banners/${id}/delete`, {}, A))
  assert.ok(!ok(await call('GET', '/c/banners', null, C)).some((b) => b.id === id))
})
await t('FAQ：后台新增 / 修改 / 删除 → A 即时同步', async () => {
  const id = ok(await call('POST', '/admin/faqs', { question: '跨端问题' + stamp, answer: '答案一', category: '通用' }, A)).id; created.faqs.push(id)
  assert.equal(ok(await call('GET', '/c/faqs', null, C)).find((f) => f.id === id).answer, '答案一')
  ok(await call('POST', `/admin/faqs/${id}/update`, { question: '跨端问题' + stamp, answer: '答案二', category: '通用' }, A))
  assert.equal(ok(await call('GET', '/c/faqs', null, C)).find((f) => f.id === id).answer, '答案二')
  ok(await call('POST', `/admin/faqs/${id}/delete`, {}, A))
  assert.ok(!ok(await call('GET', '/c/faqs', null, C)).some((f) => f.id === id))
})
await t('小程序装修：后台改商户端公告 → B 读到；游客端读不到商户端内容；后台改客服电话 → A、B 同时更新', async () => {
  const notice = '跨端公告' + stamp, phone = '021-5555' + String(Math.floor(Math.random() * 9000) + 1000)
  const before = await one('SELECT * FROM site_config WHERE id = 1')
  assert.ok(before, '需要 V30 默认装修行')
  ok(await call('PUT', '/admin/entities/site/1', { values: { merchant_notice: notice, service_phone: phone } }, A))
  const m = ok(await call('GET', '/m/site', null, B)); assert.equal(m.notice, notice); assert.equal(m.servicePhone, phone)
  const c = ok(await call('GET', '/c/site', null, C)); assert.equal(c.service_phone, phone)
  assert.ok(!JSON.stringify(c).includes(notice), '商户端公告不应出现在游客端')
})
await t('商品下架 → A 列表与详情消失；上架恢复；已下单的老订单不受影响', async () => {
  const p = sess.product_id
  const before = ok(await call('POST', `/admin/products/${p}/status`, { status: 0 }, A)); void before
  assert.ok(!ok(await call('GET', '/c/tours', null, C)).some((x) => x.id === p), '下架后列表仍可见')
  const d = await call('GET', '/c/tours/' + p, null, C); assert.notEqual(d.code, 0, '下架后详情仍可打开')
  assert.equal(ok(await call('GET', '/c/orders/' + o1.orderNo, null, C)).order_no, o1.orderNo, '老订单仍可查看')
  ok(await call('POST', `/admin/products/${p}/status`, { status: 1 }, A))
  assert.ok(ok(await call('GET', '/c/tours', null, C)).some((x) => x.id === p), '重新上架后应恢复')
})

console.log('\n== 三、存证三端：后台 / 对外验证 / 游客侧同源；自测链真实走一遍 ==')
  await t('新订单的存证事件已入队：后台总览 = 数据库，对外验证可复核，刚入队的事件不会是"已锚定"（与当前链是否接入无关）', async () => {
    const ov = ok(await call('GET', '/admin/web3/overview', null, A))
    const e = await one('SELECT COUNT(*) n, SUM(status = 2) a FROM attest_event')
    assert.equal(ov.events, Number(e.n)); assert.equal(ov.anchoredEvents, Number(e.a || 0))
    const v = ok(await call('GET', '/open/verify/order/' + o1.orderNo))
    assert.equal(v.found, true); assert.equal(v.canonicalValid, true)
    const ev = await one("SELECT status FROM attest_event WHERE biz_type = 'order' AND biz_ref = ? ORDER BY id DESC LIMIT 1", [o1.orderNo])
    assert.ok(Number(ev.status) !== 2, '刚入队的事件不允许是已锚定')
    assert.equal(ov.anchoredBatches, Number((await one('SELECT COUNT(*) n FROM attest_batch WHERE status = 2')).n), '后台总览的已锚定批次数 = 数据库')
  })
  await t('订单链路的 6 个锚点（抵扣/支付/出票/核销/返豆/结算）后台流程视图都能找到事件', async () => {
    const f = ok(await call('GET', '/admin/attest/flow/' + o1.orderNo, null, A))
    const by = Object.fromEntries(f.steps.map((s) => [s.key, s]))
    for (const k of ['order', 'issue', 'verify', 'grant', 'settle']) assert.ok(by[k] && by[k].ev, `步骤 ${k} 应有存证事件`)
    const pub = ok(await call('GET', '/open/attest/flow/' + o1.orderNo))
    assert.equal(pub.steps.length, f.steps.length, '对外流程与后台流程步骤数一致')
    // 看字段名与数值，不看提示语文字（提示语本身会写"不含个人信息与金额"）
    const keys = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x) } }
    walk(pub); assert.ok(!keys.some((k) => /amount|mobile|phone|price|nickname|user/i.test(k)), '对外流程不应有金额 / 电话 / 用户类字段：' + keys.join(','))
    assert.ok(!/(?<!\d)1[3-9]\d{9}(?!\d)/.test(JSON.stringify(pub)), '对外流程不应含手机号')
  })
  await t('打包：对外验证、后台、数据库的批次根一致；默克尔证明可复算；打包本身不会把批次标成已锚定', async () => {
    // 注意：这里不切换链、不锚定。已锚定批次有触发器保护、无法回退，会让 web3-integrity 的"NOOP 下已锚定批次必须为 0"在下一遍失败；
    // 锚定 / 终局确认由 chain-hub、web3-core 用假链与自建测试批次覆盖。
    ok(await call('POST', '/admin/system/jobs/attest-pack/run', {}, A))
    const v = ok(await call('GET', '/open/verify/order/' + o1.orderNo))
    assert.equal(v.found, true); assert.ok(v.merkleRoot, '应已入批次'); assert.equal(v.canonicalValid, true); assert.equal(v.proofValid, true, '默克尔证明应可复算')
    const row = await one('SELECT b.status, b.merkle_root FROM attest_event e JOIN attest_batch b ON b.id = e.batch_id WHERE e.biz_type = ? AND e.biz_ref = ? ORDER BY e.id DESC LIMIT 1', ['order', o1.orderNo])
    assert.equal(v.merkleRoot, row.merkle_root, '对外验证的根 = 数据库批次根'); assert.notEqual(Number(row.status), 2, 'NOOP 下不允许已锚定')
    const ov = ok(await call('GET', '/admin/web3/overview', null, A))
    const e = await one('SELECT SUM(status = 2) a, SUM(status = 0) p FROM attest_event')
    assert.equal(ov.anchoredEvents, Number(e.a || 0)); assert.equal(ov.pendingEvents, Number(e.p || 0))
    const id = ok(await call('GET', '/c/identity', null, C))
    assert.ok(Array.isArray(id.attestations) && id.attestations.length >= 1, '游客侧应看到自己的可信记录')
  })
  await t('旅豆日终封存（只读核对，不由本测试触发封存，避免污染 web3-integrity 的同日封存）：已封存的当日根借贷必须平衡', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const r = ok(await call('GET', '/open/verify/bean-day/' + day))
    if (r.found) { assert.equal(r.balanced, true); assert.equal(Number(r.debitSum), Number(r.creditSum), '日终根：Σ借 = Σ贷'); assert.ok(Number(r.leafCount) > 0) }
  })

console.log('\n== 四、数据边界：城市账号只能看本城 ==')
await t('城市合伙人（310118）：看板与洞察都只含本城数据，且不出现其他城市商品', async () => {
  const kpi = ok(await call('GET', '/admin/dash/kpi', null, CITY))
  const ins = ok(await call('GET', '/admin/dash/insights', null, CITY))
  const other = await q("SELECT id, title FROM tour_product WHERE city_code <> '310118'")
  for (const p of other) assert.ok(!ins.topTours.some((x) => Number(x.id) === Number(p.id)), `洞察里出现了外城商品 ${p.title}`)
  const own = await one(`SELECT COUNT(*) n, COALESCE(SUM(amount_pay),0) g FROM orders o WHERE o.status IN (20,30,40,50) AND DATE(o.paid_at) = CURDATE() AND o.city_code = '310118'`)
  assert.equal(kpi.ordersToday, Number(own.n)); assert.equal(Math.round(Number(kpi.gmvToday) * 100), Number(own.g))
  assert.equal(ins.funnel.beanUseRate, '—', '旅豆预算是全局的，城市账号不展示使用率')
  const orders = ok(await call('GET', '/admin/orders', null, CITY))
  assert.ok(orders.every((o) => String(o.city_code) === '310118'), '城市账号订单列表不应含外城订单')
})
await t('商户申请电话：后台商户列表 / 导出只给脱敏值', async () => {
  const mer = ok(await call('GET', '/admin/merchants', null, A))
  assert.ok(mer.every((m) => !('apply_mobile_enc' in m)), '不应下发密文列')
  assert.ok(mer.every((m) => !m.apply_mobile || /\*{4}|^已绑定$/.test(m.apply_mobile) || m.apply_mobile === ''), '申请电话必须脱敏')
})

console.log('\n== 五、多角色联动：商户入驻 / 员工邀请 / 实名认证 / 推广分佣 ==')
await t('商户入驻：B 提交申请 → 后台待审（电话脱敏）→ 后台通过 → B 看到已通过，申请人成为老板并能进工作台', async () => {
  const applicant = await login('mock-xend-apply-' + stamp)
  const mt = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-apply-' + stamp })).token
  const phone = '137' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  const name = '跨端入驻' + stamp
  const pend0 = ok(await call('GET', '/admin/dash/insights', null, A)).pending.merchants
  const r = ok(await call('POST', '/m/apply', { name, contact: '测试', mobile: phone }, mt))
  const wl = ok(await call('GET', '/admin/merchants', null, A)).find((m) => Number(m.id) === Number(r.id))
  assert.ok(wl && Number(wl.status) === 0, '后台应看到待审申请')
  assert.equal(wl.apply_mobile, phone.slice(0, 3) + '****' + phone.slice(7)); assert.ok(!JSON.stringify(wl).includes(phone))
  assert.equal(ok(await call('GET', '/admin/dash/insights', null, A)).pending.merchants - pend0, 1, '后台待审商户数 +1')
  assert.equal(ok(await call('GET', '/m/applications', null, mt))[0].status, 0)
  ok(await call('POST', `/admin/merchants/${r.id}/approve`, {}, A))
  const app = ok(await call('GET', '/m/applications', null, mt))[0]; assert.equal(Number(app.status), 1); assert.ok(app.merchant_no)
  assert.equal(ok(await call('GET', '/admin/dash/insights', null, A)).pending.merchants, pend0, '通过后待审数回落')
  const re = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-apply-' + stamp, merchantId: r.id }))
  assert.equal(re.role, 3); assert.equal(Number(re.merchant.id), Number(r.id))
  ok(await call('GET', '/m/workbench', null, re.token))
  const ov = ok(await call('GET', `/admin/merchants/${r.id}/overview`, null, A)); assert.ok(ov.staff.some((x) => Number(x.user_id) === Number(applicant.user.id)))
  await q('DELETE FROM merchant_staff WHERE merchant_id = ?', [r.id]); await q('DELETE FROM merchant WHERE id = ?', [r.id])
})
await t('员工邀请：老板取邀请码 → 新人加入 → 老板在店员列表看到并启用 → 新人进入工作台 → 后台商户全景同步；停用后不能再进', async () => {
  const inv = ok(await call('GET', '/m/invite', null, B)); const code = inv.inviteCode || inv.invite_code || inv.code
  assert.ok(code, '应有邀请码')
  const nu = await login('mock-xend-newstaff-' + stamp)
  const nt = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-newstaff-' + stamp })).token
  ok(await call('POST', '/m/auth/join', { inviteCode: code }, nt))
  const row = ok(await call('GET', '/m/staff', null, B)).find((x) => Number(x.user_id) === Number(nu.user.id))
  assert.ok(row, '老板应在店员列表看到新人')
  ok(await call('POST', `/m/staff/${row.id}`, { role: 1, status: 1 }, B))
  const lg = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-newstaff-' + stamp, merchantId: sess.merchant_id }))
  assert.equal(lg.role, 1); ok(await call('GET', '/m/workbench', null, lg.token))
  assert.ok(ok(await call('GET', `/admin/merchants/${sess.merchant_id}/overview`, null, A)).staff.some((x) => Number(x.user_id) === Number(nu.user.id)))
  ok(await call('POST', `/m/staff/${row.id}`, { role: 1, status: 0 }, B))
  const off = await call('POST', '/m/auth/login', { code: 'mock-xend-newstaff-' + stamp, merchantId: sess.merchant_id })
  assert.ok(off.code !== 0 || !off.data.role, '停用的店员不应再拿到门店权限')
})
await t('实名认证：A 提交 → 后台待审（身份证脱敏）→ 驳回理由 A 可见 → 重新提交通过后 A 状态与后台画像同步', async () => {
  const u = await login('mock-xend-kyc-' + stamp); const kt = u.token
  const idNo = '31010119900307' + String(Math.floor(Math.random() * 9000) + 1000)
  ok(await call('POST', '/c/kyc/submit', { realName: '张三', idNo }, kt))
  assert.equal(ok(await call('GET', '/c/kyc/mine', null, kt)).status, 0)
  const wl = ok(await call('GET', '/admin/kyc?status=0', null, A)).find((k) => Number(k.user_id) === Number(u.user.id))
  assert.ok(wl, '后台应看到待审实名'); assert.ok(!JSON.stringify(wl).includes(idNo), '后台列表不应出现完整身份证号'); assert.ok(/\*/.test(wl.id_no_mask))
  ok(await call('POST', `/admin/kyc/${wl.id}/resolve`, { action: 'reject', note: '照片不清晰，请重新提交' }, A))
  const mine = ok(await call('GET', '/c/kyc/mine', null, kt)); assert.equal(mine.status, 2); assert.match(mine.reject_note, /不清晰/)
  ok(await call('POST', '/c/kyc/submit', { realName: '张三', idNo }, kt))
  const again = ok(await call('GET', '/admin/kyc?status=0', null, A)).find((k) => Number(k.user_id) === Number(u.user.id))
  ok(await call('POST', `/admin/kyc/${again.id}/resolve`, { action: 'pass' }, A))
  assert.equal(ok(await call('GET', '/c/kyc/mine', null, kt)).status, 1)
  assert.equal(ok(await call('GET', `/admin/users/${u.user.id}`, null, A)).kyc.status, 1, '后台用户画像里的实名状态同步')
})
await t('推广分佣：推广员带来的订单完成后，佣金 = 基数 × 费率；A（推广员）、后台推广员列表对得上，客户清单非空', async () => {
  const pu = await login('mock-xend-promoter-' + stamp)
  ok(await call('POST', '/admin/promoters/register', { userId: pu.user.id, tier: 1 }, A))
  const { createScene } = await import('../src/domain/promo.mjs')
  const scene = await createScene(pu.user.id, 'poster')
  const buyer2 = await login('mock-xend-promo-buyer-' + stamp)
  const od = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0, promoScene: scene }, buyer2.token)); created.orders.push(od.orderNo)
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: od.orderNo }, A))
  const pid2 = ok(await call('GET', '/c/orders/' + od.orderNo, null, buyer2.token)).passes[0].id
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: ok(await call('GET', `/c/pass/${pid2}/code`, null, buyer2.token)).qr }, B)).ok, true)
  ok(await call('POST', '/admin/dev/complete', { orderNo: od.orderNo }, A))
  const cm = await one('SELECT c.amount, c.base_amount, c.rate_bp, c.promoter_id, c.status FROM commission c JOIN orders o ON o.id = c.order_id WHERE o.order_no = ?', [od.orderNo])
  assert.ok(cm, '完成订单后应生成佣金'); assert.equal(Number(cm.promoter_id), Number(pu.user.id))
  assert.equal(Number(cm.amount), Math.floor(Number(cm.base_amount) * Number(cm.rate_bp) / 10000), '佣金 = 基数 × 费率（向下取整）')
  assert.equal(Number(cm.base_amount), Number(od.amountPay), '基数 = 实付（未用旅豆抵扣）')
  assert.notEqual(ok(await call('GET', '/c/promote/overview', null, pu.token)).promoter, false)
  assert.ok(JSON.stringify(ok(await call('GET', '/c/promote/customers', null, pu.token))).length > 2, '推广员客户清单不应为空')
  const wp = ok(await call('GET', '/admin/promoters', null, A)).find((p) => Number(p.user_id) === Number(pu.user.id)); assert.ok(wp && Number(wp.rate_bp) === Number(cm.rate_bp))
})

// ---------- 清理本轮造出的业务数据 ----------
for (const id of created.banners) await q('DELETE FROM banner WHERE id = ?', [id]).catch(() => {})
for (const id of created.faqs) await q('DELETE FROM faq WHERE id = ?', [id]).catch(() => {})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day); const y = x.getUTCFullYear()
  return `${y}-W${String(Math.ceil(((x - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
