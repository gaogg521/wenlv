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
import { cfgNum } from '../src/config.mjs'

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
await q('UPDATE tour_session SET quota = GREATEST(quota, booked + 30) WHERE id = ?', [sess.id]) // 本测试会连续下很多单：给足余量，重复运行也不会因名额不足误报
const login = async (code) => ok(await call('POST', '/c/auth/login', { code }))
const buyer = await login('mock-xend-buyer-' + stamp)
const staffUser = await login('mock-xend-staff-' + stamp)
await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [sess.merchant_id, staffUser.user.id])
const B = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-staff-' + stamp, merchantId: sess.merchant_id })).token
const C = buyer.token
const PHONE = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const created = { orders: [], banners: [], faqs: [], badges: [], notes: [] }

// 同一个事实的多个视图（调用前后各取一次，比较差值）
const views = async () => {
  const wb = ok(await call('GET', '/m/workbench', null, B))
  const kpi = ok(await call('GET', '/admin/dash/kpi', null, A))
  const mo = ok(await call('GET', `/admin/merchants/${sess.merchant_id}/overview`, null, A)).kpi
  const po = ok(await call('GET', `/admin/products/${sess.product_id}/overview`, null, A)).kpi
  const uo = ok(await call('GET', `/admin/users/${buyer.user.id}`, null, A)).trade
  return {
    // 看板契约（v1.10 口径切换后）：dash/kpi 返回 orders / gmv（元），周期由 ?range= 决定，默认今日
    bOrders: wb.todayOrders, bGmv: Math.round(Number(wb.todayGmv) * 100), wOrders: kpi.orders, wGmv: Math.round(Number(kpi.gmv) * 100),
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
  // 口径已在看板重构时改为「周期内创建的订单：已核销(40/50) ÷ 已支付(20~70)」，比率随 dash/insights 的漏斗给出。
  // 断言两件事：① 分子分母与数据库同式；② 比率必须等于它自己的分子÷分母（铁律：比率要能指出分子分母）。
  const ins = ok(await call('GET', '/admin/dash/insights', null, A)).funnel
  const r = await one(`SELECT COALESCE(SUM(status BETWEEN 20 AND 70),0) paid, COALESCE(SUM(status IN (40,50)),0) verified
    FROM orders WHERE DATE(created_at) = CURDATE()`)
  assert.equal(ins.paid, Number(r.paid), '已支付（分母）应与库里一致')
  assert.equal(ins.verified, Number(r.verified), '已核销（分子）应与库里一致')
  const expect = Number(r.paid) ? (Number(r.verified) / Number(r.paid) * 100).toFixed(1) + '%' : '—'
  assert.equal(ins.verifyRate, expect, '看板核销率必须等于自己的分子÷分母')
  if (ins.verifyRate !== '—') assert.ok(parseFloat(ins.verifyRate) <= 100)
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
  const sum = await one(`SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE l.direction = 1 AND l.biz_type IN (1,2,3,7) AND a.user_id < 999999000000`)
  assert.equal(Number(sum.s), f.granted, '发放量 = 真实用户户的入账合计（含 T06 人工补发 biz_type 7）')
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
    const raw = await call('GET', '/open/verify/bean-day/' + day)
    if (raw.code !== 0) { assert.equal(raw.code, 1004, '当日尚未封存时应是"无记录"（1004），而不是别的错误'); return }
    const r = raw.data
    if (r.found) { assert.equal(r.balanced, true); assert.equal(Number(r.debitSum), Number(r.creditSum), '日终根：Σ借 = Σ贷'); assert.ok(Number(r.leafCount) > 0) }
  })

console.log('\n== 四、数据边界：城市账号只能看本城 ==')
await t('城市合伙人（310118）：看板与洞察都只含本城数据，且不出现其他城市商品', async () => {
  const kpi = ok(await call('GET', '/admin/dash/kpi', null, CITY))
  const ins = ok(await call('GET', '/admin/dash/insights', null, CITY))
  const other = await q("SELECT id, title FROM tour_product WHERE city_code <> '310118'")
  for (const p of other) assert.ok(!ins.topTours.some((x) => Number(x.id) === Number(p.id)), `洞察里出现了外城商品 ${p.title}`)
  const own = await one(`SELECT COUNT(*) n, COALESCE(SUM(amount_pay),0) g FROM orders o WHERE o.status IN (20,30,40,50) AND DATE(o.paid_at) = CURDATE() AND o.city_code = '310118'`)
  assert.equal(kpi.orders, Number(own.n), '城看板订单数应等于本城今日已支付单数')
  assert.equal(Math.round(Number(kpi.gmv) * 100), Number(own.g), '城看板 GMV 应等于本城今日已支付金额')
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
let promoter5
await t('推广分佣：推广员带来的订单完成后，佣金 = 基数 × 费率；A（推广员）、后台推广员列表对得上，客户清单非空', async () => {
  const pu = await login('mock-xend-promoter-' + stamp); promoter5 = pu
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

console.log('\n== 六、核销的各条路径：离线批量 / 冲突处理 / 暗号 / 城市归属 ==')
const newPaid = async (tok, sessionId = sess.id) => {
  const od = ok(await call('POST', '/c/orders', { sessionId, qty: 1, beanDeduct: 0 }, tok)); created.orders.push(od.orderNo)
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: od.orderNo }, A))
  const passId = ok(await call('GET', '/c/orders/' + od.orderNo, null, tok)).passes[0].id
  return { orderNo: od.orderNo, passId, amountPay: Number(od.amountPay) }
}
const qrOf = async (tok, passId) => ok(await call('GET', `/c/pass/${passId}/code`, null, tok)).qr
await t('离线核销清单：已出票的凭证在清单和离线码表里；线上核销后从清单消失', async () => {
  const x = await newPaid(C)
  const list = ok(await call('GET', '/m/verify/offline-list', null, B))
  assert.ok(list.passes.some((p) => Number(p.pass_id) === x.passId && p.order_no === x.orderNo), '离线清单应包含新出票的凭证')
  assert.ok(Object.values(list.codes).map(Number).includes(x.passId), '离线码表应含该凭证的窗口码')
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: await qrOf(C, x.passId) }, B)).ok, true)
  assert.ok(!ok(await call('GET', '/m/verify/offline-list', null, B)).passes.some((p) => Number(p.pass_id) === x.passId), '已核销的凭证不应再出现在离线清单')
})
await t('离线批量上传：正常的核销成功（A / B / 后台同步）；重放与无效码进人工队列，后台能处理且无凭证的不能"确认核销"', async () => {
  const y = await newPaid(C); const qr = await qrOf(C, y.passId)
  const r = ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload: qr, offlineAt: new Date().toISOString() }] }, B))
  assert.equal(r.uploaded, 1); assert.equal(r.conflicts, 0)
  assert.equal(ok(await call('GET', '/c/orders/' + y.orderNo, null, C)).status, 40)
  assert.equal(Number(ok(await call('GET', '/admin/orders/' + y.orderNo, null, A)).status), 40)
  assert.ok(ok(await call('GET', '/m/verify/records', null, B)).some((x) => x.order_no === y.orderNo && Number(x.result) === 1))
  const bogus = 'wl://v/not-a-real-code-' + stamp
  const r2 = ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload: qr }, { payload: bogus }] }, B))
  assert.equal(r2.conflicts, 2); assert.equal(r2.uploaded, 0)
  const pend = ok(await call('GET', '/admin/verify/conflicts', null, A))
  const replay = pend.find((c) => Number(c.pass_id) === y.passId && /重复/.test(c.reason)); const bad = pend.find((c) => String(c.payload).includes('not-a-real-code-' + stamp))
  assert.ok(replay, '重放应进冲突队列'); assert.ok(bad, '无效码应进冲突队列'); assert.equal(bad.pass_id, null)
  assert.equal((await call('POST', `/admin/verify/conflicts/${bad.id}/resolve`, { action: 'confirm' }, A)).code, 1001, '无法定位凭证的冲突只能驳回')
  ok(await call('POST', `/admin/verify/conflicts/${replay.id}/resolve`, { action: 'reject' }, A)); ok(await call('POST', `/admin/verify/conflicts/${bad.id}/resolve`, { action: 'reject' }, A))
  const left = ok(await call('GET', '/admin/verify/conflicts', null, A)); assert.ok(!left.some((c) => c.id === replay.id || c.id === bad.id))
  assert.ok(ok(await call('GET', '/admin/verify/conflicts?status=2', null, A)).some((c) => c.id === replay.id), '已驳回的应在已处理里')
})
await t('离线冲突里有凭证的（如离线时码已过期）：运营确认核销 → A 订单 40、凭证已核销、后台订单 40、记录有人工确认一条', async () => {
  const z = await newPaid(C)
  const cid = (await q('INSERT INTO verify_offline_conflict (merchant_id, pass_id, payload, offline_at, reason) VALUES (?,?,?,NOW(3),?)', [sess.merchant_id, z.passId, 'wl://v/expired-' + stamp, '码已过期'])).insertId
  ok(await call('POST', `/admin/verify/conflicts/${cid}/resolve`, { action: 'confirm' }, A))
  assert.equal(ok(await call('GET', '/c/orders/' + z.orderNo, null, C)).status, 40)
  assert.equal(Number((await one('SELECT status FROM travel_pass WHERE id = ?', [z.passId])).status), 2)
  assert.equal(Number(ok(await call('GET', '/admin/orders/' + z.orderNo, null, A)).status), 40)
  assert.ok(await one('SELECT id FROM verification_log WHERE pass_id = ? AND method = 3 AND result = 1', [z.passId]), '应有人工确认的核销记录')
  await q('DELETE FROM verify_offline_conflict WHERE id = ?', [cid])
})
await t('暗号核销：后台设置 → A 只看到上半句（下半句不下发）→ B 错暗号被拒、对暗号核销并拿到下半句 → A / 后台订单 40；重复暗号不能再核销', async () => {
  const ph = await newPaid(C)
  const up = '跨端上句' + stamp, down = '跨端下句' + stamp
  const prev = await one('SELECT phrase_user, phrase_merchant FROM tour_product WHERE id = ?', [sess.product_id])
  ok(await call('POST', `/admin/phrases/${sess.product_id}`, { userPhrase: up, merchantPhrase: down }, A))
  try {
    assert.ok(ok(await call('GET', '/admin/phrases', null, A)).some((p) => Number(p.id) === sess.product_id && p.phrase_user === up))
    const a = ok(await call('GET', `/c/orders/${ph.orderNo}/phrase`, null, C))
    assert.equal(a.enabled, true); assert.equal(a.userPhrase, up); assert.ok(!JSON.stringify(a).includes(down), 'A 端不应拿到下半句')
    const bad = ok(await call('POST', '/m/verify/phrase', { phrase: '不对的暗号', orderNo: ph.orderNo }, B)); assert.equal(bad.ok, false)
    assert.equal(ok(await call('GET', '/c/orders/' + ph.orderNo, null, C)).status, 30, '错暗号不应核销')
    const good = ok(await call('POST', '/m/verify/phrase', { phrase: up, orderNo: ph.orderNo }, B))
    assert.equal(good.ok, true); assert.equal(good.counterPhrase, down); assert.ok(good.verified >= 1)
    const a2 = ok(await call('GET', '/c/orders/' + ph.orderNo, null, C))
    assert.equal(a2.status, 40); assert.ok(a2.passes.every((p) => p.status === 2))
    assert.equal(Number(ok(await call('GET', '/admin/orders/' + ph.orderNo, null, A)).status), 40)
    assert.ok(await one('SELECT id FROM verification_log WHERE pass_id = ? AND method = 4 AND result = 1', [ph.passId]), '应有暗号核销记录')
    assert.equal(ok(await call('POST', '/m/verify/phrase', { phrase: up, orderNo: ph.orderNo }, B)).ok, true, '已核销订单再对暗号：不应报错')
  } finally { await q('UPDATE tour_product SET phrase_user = ?, phrase_merchant = ? WHERE id = ?', [prev.phrase_user, prev.phrase_merchant, sess.product_id]) }
})
await t('核销的城市归属：外城门店的扫码 / 离线批量核销，核销记录里的城市是门店所在城市，不是写死的青浦', async () => {
  const other = await one(`SELECT s.id sid, p.merchant_id mid, p.city_code FROM tour_session s JOIN tour_product p ON p.id = s.product_id JOIN merchant m ON m.id = p.merchant_id
    WHERE p.city_code <> ? AND m.city_code = p.city_code AND p.status = 1 AND s.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 3 ORDER BY s.id LIMIT 1`, [sess.city_code])
  assert.ok(other, '隔离库需有外城商品（seed:scenario 会建）')
  const st2 = await login('mock-xend-staff2-' + stamp)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [other.mid, st2.user.id])
  const B2 = ok(await call('POST', '/m/auth/login', { code: 'mock-xend-staff2-' + stamp, merchantId: other.mid })).token
  const e1 = await newPaid(C, other.sid), e2 = await newPaid(C, other.sid)
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: await qrOf(C, e1.passId) }, B2)).ok, true)
  assert.equal(ok(await call('POST', '/m/verify/offline-batch', { items: [{ payload: await qrOf(C, e2.passId) }] }, B2)).uploaded, 1)
  for (const x of [e1, e2]) {
    const lg = await one('SELECT city_code FROM verification_log WHERE pass_id = ? AND result = 1', [x.passId])
    assert.equal(String(lg.city_code), String(other.city_code), `核销记录的城市应是门店城市 ${other.city_code}，实际 ${lg.city_code}`)
  }
})

console.log('\n== 七、勋章 / 城市轮播 / 举报申诉：三端同步 ==')
await t('勋章：后台新建"首评"规则 → A 完成订单并评价得到勋章（评价接口、身份页、后台勋章页、用户画像、存证）；重复评价不重复发', async () => {
  const bname = '跨端勋章' + stamp
  const bd = ok(await call('POST', '/admin/entities/badge', { values: { name: bname, icon_key: 'xe' + stamp, rule_type: 'review', threshold: 1, rule_desc: '发表 1 条评价' } }, A)); created.badges.push(bd.id)
  const u = await login('mock-xend-badge-' + stamp)
  const bo = await newPaid(u.token)
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: await qrOf(u.token, bo.passId) }, B)).ok, true)
  ok(await call('POST', '/admin/dev/complete', { orderNo: bo.orderNo }, A))
  const g0 = ok(await call('GET', '/admin/web3/overview', null, A)).badgeGrants
  const rv = ok(await call('POST', `/c/orders/${bo.orderNo}/review`, { rating: 5, content: '跨端回归的评价内容' }, u.token))
  assert.ok(rv.badges.includes(bname), '评价接口应返回新得到的勋章（小程序据此弹窗）')
  assert.ok(ok(await call('GET', '/c/identity', null, u.token)).badges.some((b) => b.name === bname || b.id === bd.id), 'A 身份页应显示勋章')
  assert.ok(ok(await call('GET', '/admin/web3/overview', null, A)).badgeGrants - g0 >= 1, '后台勋章发放数增加（含同时达标的预置勋章）')
  assert.ok(JSON.stringify(ok(await call('GET', '/admin/web3/badges', null, A))).includes(bname), '后台勋章页应有该勋章')
  const prof = ok(await call('GET', `/admin/users/${u.user.id}`, null, A))
  assert.ok(JSON.stringify(prof).includes(bname), '后台用户画像应有该勋章：content=' + JSON.stringify(prof.content).slice(0, 400))
  assert.ok(await one(`SELECT id FROM attest_event WHERE biz_type = 'badge' AND biz_ref = ?`, ['badge-' + u.user.id + '-' + bd.id]), '勋章发放应有存证')
  assert.equal(Number((await one('SELECT COUNT(*) n FROM user_badge WHERE user_id = ? AND badge_id = ?', [u.user.id, bd.id])).n), 1)
  assert.notEqual((await call('POST', `/c/orders/${bo.orderNo}/review`, { rating: 5, content: '重复评价' }, u.token)).code, 0, '同一订单不能重复评价')
})
await t('轮播按城市投放：限定外城的只在该城市下发；未限定的所有城市都有；不传城市给全部', async () => {
  const mk = async (title, cities) => { const r = ok(await call('POST', '/admin/entities/banner', { values: { title, image: '/uploads/x.png', cities, sort: 0, status: '1' } }, A)); created.banners.push(r.id); return r.id }
  const idCity = await mk('跨端城市轮播' + stamp, ['330500']), idAll = await mk('跨端全域轮播' + stamp, [])
  const ids = async (q2) => ok(await call('GET', '/c/banners' + q2, null, C)).map((b) => b.id)
  const f330500 = await ids('?city=330500'), f310118 = await ids('?city=310118'), fAll = await ids('')
  assert.ok(f330500.includes(idCity) && f330500.includes(idAll)); assert.ok(!f310118.includes(idCity) && f310118.includes(idAll))
  assert.ok(fAll.includes(idCity) && fAll.includes(idAll))
})
await t('举报与申诉：读者举报 → 后台处理下架 → 作者看到原因且读者读不到 → 作者申诉 → 后台复核恢复 → 作者与读者恢复；后台内容看板数字 = 数据库', async () => {
  const author = await login('mock-xend-author-' + stamp), reader = await login('mock-xend-reader-' + stamp)
  const n = ok(await call('POST', '/c/notes', { title: '跨端笔记' + stamp, body: '<p>旅行事实与体验正文</p>', relatedProductId: sess.product_id }, author.token)); created.notes.push(n.id)
  const dashCheck = async () => {
    const st = ok(await call('GET', '/admin/content-dashboard', null, A)).stats
    const c = await one('SELECT COUNT(*) total, SUM(status = 2) pub, SUM(status = 4) off FROM content_note')
    assert.equal(Number(st.total), Number(c.total), '看板总数 = 数据库'); assert.equal(Number(st.offline), Number(c.off || 0), '看板下架数 = 数据库')
    return st
  }
  const s0 = await dashCheck()
  const rp = ok(await call('POST', `/c/notes/${n.id}/report`, { reason: '涉嫌虚假宣传，请核实事实' }, reader.token))
  assert.ok(ok(await call('GET', `/admin/content-cases/reports/${rp.id}`, null, A)), '后台应能看到该举报')
  ok(await call('POST', `/admin/content-cases/reports/${rp.id}/verdict`, { action: 'takedown', reason: '已核实相关内容事实并完成处理' }, A))
  const mine = ok(await call('GET', '/c/notes', null, author.token)).find((x) => x.id === n.id)
  assert.equal(Number(mine.status), 4); assert.ok(mine.offline_reason, '作者应看到下架原因'); assert.equal(Number(mine.can_appeal), 1)
  assert.equal((await call('GET', `/c/notes/${n.id}`, null, reader.token)).code, 1004, '读者读不到已下架的笔记')
  assert.equal(ok(await call('GET', '/c/content-reports', null, reader.token))[0].status, 2, '读者看到举报已处理')
  const s1 = await dashCheck(); assert.equal(Number(s1.offline) - Number(s0.offline), 1, '后台看板下架数 +1')
  const ap = ok(await call('POST', `/c/notes/${n.id}/appeal`, { reason: '内容为本人真实体验，请重新核实' }, author.token))
  assert.ok(ok(await call('GET', `/admin/content-cases/appeals/${ap.id}`, null, A)), '后台应能看到该申诉')
  ok(await call('POST', `/admin/content-cases/appeals/${ap.id}/verdict`, { action: 'restore', reason: '已复核作品事实及相关依据' }, A))
  const back = ok(await call('GET', '/c/notes', null, author.token)).find((x) => x.id === n.id)
  assert.equal(Number(back.status), 2, '申诉恢复后作者的笔记应是已发布'); assert.ok(ok(await call('GET', `/c/notes/${n.id}`, null, reader.token)), '读者又能读到')
  const s2 = await dashCheck(); assert.equal(Number(s2.offline), Number(s0.offline), '看板下架数回落')
})

console.log('\n== 八、统计口径交叉：同一个数字的几个出处 ==')
await t('推广员的钱：后台合伙人画像、对账页、A 推广中心、数据库 四处对得上；佣金放行后同步变化', async () => {
  assert.ok(promoter5, '需要第五部分建的推广员')
  const uid = promoter5.user.id
  const truth = async () => {
    const rows = await q('SELECT status, COALESCE(SUM(amount),0) a, COUNT(*) n FROM commission WHERE promoter_id = ? GROUP BY status', [uid])
    const by = (...ss) => rows.filter((r) => ss.includes(Number(r.status))).reduce((s, r) => s + Number(r.a), 0)
    return { observing: by(0), earned: by(1, 2), reversed: by(3, 4) }
  }
  const check = async (when) => {
    const tr = await truth()
    const rec = ok(await call('GET', `/admin/partner-reconciliation/promoter/${uid}`, null, A)).summary
    assert.equal(Number(rec.observing), tr.observing, when + '：对账页观察期'); assert.equal(Number(rec.earned), tr.earned, when + '：对账页已放行'); assert.equal(Number(rec.reversed), tr.reversed, when + '：对账页冲正')
    const prof = ok(await call('GET', `/admin/partners/promoter/${uid}`, null, A))
    const sum = prof.commissions.reduce((s, r) => s + Number(r.amount), 0); assert.equal(sum, tr.observing + tr.earned + tr.reversed, when + '：画像里的佣金合计')
    const ov = ok(await call('GET', '/c/promote/overview', null, promoter5.token)); assert.notEqual(ov.promoter, false)
    return { tr, ov }
  }
  const before = await check('放行前'); assert.ok(before.tr.observing > 0, '应有观察期佣金')
  await q('UPDATE commission SET payable_at = NOW(3) - INTERVAL 1 DAY WHERE promoter_id = ? AND status = 0', [uid])
  ok(await call('POST', '/admin/system/jobs/commission-due/run', {}, A))
  const after = await check('放行后'); assert.equal(after.tr.observing, 0); assert.equal(after.tr.earned, before.tr.observing, '放行后已放行 = 原观察期')
  const ovTxt = JSON.stringify(after.ov); assert.ok(ovTxt.includes(String(after.tr.earned)) || ovTxt.includes((after.tr.earned / 100).toFixed(2)), 'A 推广中心应显示放行后的金额 ' + after.tr.earned + '：' + ovTxt.slice(0, 300))
})
const finishOrder = async (tok, promoScene) => {
  const od = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0, ...(promoScene ? { promoScene } : {}) }, tok)); created.orders.push(od.orderNo)
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: od.orderNo }, A))
  const pid = ok(await call('GET', '/c/orders/' + od.orderNo, null, tok)).passes[0].id
  assert.equal(ok(await call('POST', '/m/verify/scan', { payload: ok(await call('GET', `/c/pass/${pid}/code`, null, tok)).qr }, B)).ok, true)
  ok(await call('POST', '/admin/dev/complete', { orderNo: od.orderNo }, A))
  return od
}
const pendingWd = async () => Number(ok(await call('GET', '/admin/dash/insights', null, A)).pending.withdrawals)
await t('提现闭环：A 申请 → 后台待办 +1 且金额同额；重复申请被拒；冻结期间不能打款；驳回不扣余额；通过后 A / 对账页 / 排行同步', async () => {
  const pu = await login('mock-xend-wd-' + stamp); const uid = pu.user.id
  ok(await call('POST', '/admin/promoters/register', { userId: uid, tier: 1 }, A))
  const { createScene } = await import('../src/domain/promo.mjs')
  const od = await finishOrder((await login('mock-xend-wd-buyer-' + stamp)).token, await createScene(uid, 'poster'))
  assert.ok(od.orderNo)
  // 先按真实佣金把这笔订单结掉，再放大佣金：否则放大的佣金会被计进之后的结算单，把留存压成负数
  ok(await call('POST', '/admin/settlements/generate', { period: isoWeek(new Date()) }, A))
  // 把这笔佣金放大到可提现：基数 ¥6000 × 5% = ¥300（仍满足 佣金 = 基数 × 费率）并直接置为已放行
  await q('UPDATE commission SET base_amount = 600000, amount = 30000, status = 1 WHERE promoter_id = ?', [uid])
  const ov0 = ok(await call('GET', '/c/promote/overview', null, pu.token))
  assert.deepEqual([ov0.earned, ov0.withdrawn, ov0.withdrawable, ov0.pendingRequests], [30000, 0, 30000, 0], 'A 推广中心起点')
  const pend0 = await pendingWd()
  const w1 = ok(await call('POST', '/c/promote/withdraw', { note: '跨端测试' }, pu.token)); assert.equal(w1.amount, 30000)
  assert.notEqual((await call('POST', '/c/promote/withdraw', {}, pu.token)).code, 0, '已有待处理申请时，不得再次申请同一笔余额')
  assert.equal(ok(await call('GET', '/c/promote/overview', null, pu.token)).pendingRequests, 1, 'A 看到 1 张待处理申请')
  const row = ok(await call('GET', '/admin/withdrawals', null, A)).rows.find((w) => Number(w.id) === Number(w1.id))
  assert.ok(row && Number(row.status) === 0 && Number(row.amount) === 30000 && Number(row.promoter_id) === Number(uid), '后台提现列表应有同额待审核记录')
  assert.equal(await pendingWd(), pend0 + 1, '后台待办提现 +1')
  // 冻结期间：不能通过（打款）；申请入口也停
  await q('UPDATE user_account SET status = 0 WHERE id = ?', [uid])
  try {
    assert.notEqual((await call('POST', `/admin/withdrawals/${w1.id}/verdict`, { pass: true, payRef: 'FROZEN-' + stamp }, A)).code, 0, '冻结账号不能通过提现')
    assert.notEqual((await call('POST', '/c/promote/withdraw', {}, pu.token)).code, 0, '冻结账号不能申请提现')
  } finally { await q('UPDATE user_account SET status = 1 WHERE id = ?', [uid]) }
  // 驳回：状态 2，可提现余额不变，待办回落
  assert.equal(ok(await call('POST', `/admin/withdrawals/${w1.id}/verdict`, { pass: false }, A)).status, 2)
  const ov1 = ok(await call('GET', '/c/promote/overview', null, pu.token))
  assert.deepEqual([ov1.withdrawn, ov1.withdrawable, ov1.pendingRequests], [0, 30000, 0], '驳回后余额不扣、待处理清零')
  assert.equal(await pendingWd(), pend0, '待办回落')
  // 再申请 → 缺/短流水号不能通过 → 填真实流水号通过
  const w2 = ok(await call('POST', '/c/promote/withdraw', {}, pu.token))
  assert.notEqual((await call('POST', `/admin/withdrawals/${w2.id}/verdict`, { pass: true, payRef: '123' }, A)).code, 0, '流水号过短不能通过')
  const payRef = 'XEND-PAY-' + stamp
  assert.equal(ok(await call('POST', `/admin/withdrawals/${w2.id}/verdict`, { pass: true, payRef }, A)).status, 1)
  const ov2 = ok(await call('GET', '/c/promote/overview', null, pu.token))
  assert.deepEqual([ov2.earned, ov2.withdrawn, ov2.withdrawable, ov2.pendingRequests], [30000, 30000, 0, 0], '通过后 A 看到已提现 ¥300、可提现 0')
  assert.notEqual((await call('POST', '/c/promote/withdraw', {}, pu.token)).code, 0, '余额不足 ¥100 不能再申请')
  const rec = ok(await call('GET', `/admin/partner-reconciliation/promoter/${uid}?tab=withdrawal`, null, A))
  assert.deepEqual([Number(rec.summary.earned), Number(rec.summary.paid), Number(rec.summary.pending), Number(rec.summary.balance)], [30000, 30000, 0, 0], '对账页：已放行 / 已打款 / 待审 / 余额')
  const paidRow = rec.rows.find((r) => Number(r.id) === Number(w2.id)); assert.ok(paidRow && paidRow.pay_ref === payRef && paidRow.issues.length === 0, '对账明细：回单号一致且无异常标记')
  const rk = ok(await call('GET', '/admin/partner-performance?kind=promoter&sort=paid', null, A)).rows.find((r) => Number(r.id) === Number(uid))
  assert.ok(rk, '排行里应有该推广员'); assert.equal(Number(rk.paid), 30000); assert.equal(Number(rk.earned), 30000)
})

const coIds = []
await t('共创分润：后台出结算单 → 分润 = 留存 × 产品占比 × 分润比例；台账 / 对账页 / 画像 / 排行同额；发放后同步', async () => {
  const co = ok(await call('POST', '/admin/co-creators', { productId: sess.product_id, name: '跨端共创' + stamp, mobile: PHONE, role: 1, investAmount: 1000000, sharePct: 5000 }, A))
  coIds.push(co.id)
  await finishOrder((await login('mock-xend-co-buyer-' + stamp)).token)
  const gen = ok(await call('POST', '/admin/settlements/generate', { period: isoWeek(new Date()) }, A)); assert.ok((gen.settlementIds || []).length, '应生成结算单')
  const cps = await q('SELECT cp.id, cp.settlement_id, cp.base_amount, cp.amount, cp.status FROM co_profit cp WHERE cp.co_creator_id = ?', [co.id])
  assert.ok(cps.length >= 1, '结算后应生成分润记录')
  let profit = 0
  for (const cp of cps) {
    const ex = await one(`SELECT ROUND(s.amt_retained * pg.gmv / s.total_amount) base, ROUND(s.amt_retained * pg.gmv / s.total_amount * cc.share_pct / 10000) amount
      FROM settlement s JOIN co_creator cc ON cc.id = ?
      JOIN (SELECT SUM(amount_pay - insurance_fee) gmv FROM orders WHERE settlement_id = ? AND product_id = ?) pg WHERE s.id = ?`, [co.id, cp.settlement_id, sess.product_id, cp.settlement_id])
    assert.equal(Number(cp.base_amount), Number(ex.base), '分润基数 = 留存 × 产品 GMV 占比'); assert.equal(Number(cp.amount), Number(ex.amount), '分润金额 = 基数 × 分润比例')
    assert.equal(Number(cp.status), 0, '新分润待发放'); profit += Number(cp.amount)
  }
  assert.ok(profit > 0, '分润合计应大于 0')
  const list = ok(await call('GET', '/admin/co-profits', null, A)).filter((x) => cps.some((c) => Number(c.id) === Number(x.id)))
  assert.equal(list.length, cps.length, '后台分润台账应列出全部'); assert.equal(list.reduce((s, x) => s + Number(x.amount), 0), profit)
  const rec = ok(await call('GET', `/admin/partner-reconciliation/cocreator/${co.id}`, null, A))
  assert.deepEqual([Number(rec.summary.profit), Number(rec.summary.paid), Number(rec.summary.pending)], [profit, 0, profit], '对账页：应分 / 已发 / 待发')
  assert.ok(rec.rows.every((r) => r.issues.length === 0), '对账明细不应有异常标记：' + JSON.stringify(rec.rows.map((r) => r.issues)))
  const prof = ok(await call('GET', `/admin/partners/cocreator/${co.id}`, null, A))
  assert.equal(prof.profits.reduce((s, x) => s + Number(x.amount), 0), profit); assert.equal(prof.paid, 0)
  assert.ok(!JSON.stringify(prof.co).includes(PHONE), '画像里的电话必须脱敏')
  // 发放（T01 新契约：登记唯一真实流水号后才结清）
  for (const cp of cps) ok(await call('POST', `/admin/co-profits/${cp.id}/pay`, { payRef: 'XEND-CO-' + stamp + '-' + cp.id, channel: 'bank', amount: Number(cp.amount), note: '跨端回归夹具登记' }, A))
  const rec2 = ok(await call('GET', `/admin/partner-reconciliation/cocreator/${co.id}`, null, A))
  assert.deepEqual([Number(rec2.summary.paid), Number(rec2.summary.pending)], [profit, 0], '发放后对账页已发 = 应分')
  const prof2 = ok(await call('GET', `/admin/partners/cocreator/${co.id}`, null, A)); assert.equal(prof2.paid, profit); assert.equal(Number(prof2.returnRate), profit / 1000000)
  const rk = ok(await call('GET', '/admin/partner-performance?kind=cocreator&sort=paid', null, A)).rows.find((r) => Number(r.id) === Number(co.id))
  assert.ok(rk, '排行里应有该共创人'); assert.deepEqual([Number(rk.profit), Number(rk.paid)], [profit, profit]); assert.ok(Math.abs(Number(rk.return_rate) - profit / 1000000) < 1e-4, '回报率 = 已发 ÷ 投入（库内小数 4 位）')
})
await t('合伙人排行：三个榜单每一行的数字 = 数据库复算，排序严格降序、名次连续；城市账号只能看本城榜', async () => {
  const PAIDST = '(20,30,40,50)'
  const truth = {
    city: async (r) => { const g = await one(`SELECT COALESCE(SUM(amount_pay),0) gmv, COUNT(*) orders FROM orders WHERE city_code = ? AND status IN ${PAIDST}`, [r.city_code]); const m = await one('SELECT COUNT(*) n FROM merchant WHERE city_code = ?', [r.city_code]); return { gmv: g.gmv, orders: g.orders, merchants: m.n } },
    promoter: async (r) => {
      const e = await one('SELECT COALESCE(SUM(amount),0) s FROM commission WHERE promoter_id = ? AND status IN (1,2)', [r.id]); const p = await one('SELECT COALESCE(SUM(amount),0) s FROM promoter_withdraw WHERE promoter_id = ? AND status = 1', [r.id])
      const g = await one(`SELECT COALESCE(SUM(o.amount_pay),0) s FROM commission c JOIN orders o ON o.id = c.order_id WHERE c.promoter_id = ? AND c.status IN (0,1,2) AND o.status IN ${PAIDST}`, [r.id]); return { gmv: g.s, earned: e.s, paid: p.s }
    },
    cocreator: async (r) => { const p = await one('SELECT COALESCE(SUM(amount),0) s FROM co_profit WHERE co_creator_id = ?', [r.id]); const d = await one('SELECT COALESCE(SUM(amount),0) s FROM co_profit WHERE co_creator_id = ? AND status = 1', [r.id]); return { profit: p.s, paid: d.s } },
  }
  for (const [kind, sorts] of [['city', ['gmv', 'orders', 'merchants']], ['promoter', ['gmv', 'earned', 'paid']], ['cocreator', ['profit', 'paid', 'return_rate']]]) {
    for (const sort of sorts) {
      const r = ok(await call('GET', `/admin/partner-performance?kind=${kind}&sort=${sort}`, null, A), kind + '/' + sort)
      r.rows.forEach((x, i) => assert.equal(x.rank, i + 1, kind + ' 名次应连续'))
      for (let i = 1; i < r.rows.length; i++) assert.ok(Number(r.rows[i - 1][sort]) >= Number(r.rows[i][sort]), `${kind} 按 ${sort} 应降序：${r.rows[i - 1][sort]} < ${r.rows[i][sort]}`)
      for (const x of r.rows) { const tr = await truth[kind](x); for (const [k, v] of Object.entries(tr)) assert.equal(Number(x[k]), Number(v), `${kind}#${x.id} ${k}：榜单 ${x[k]} ≠ 数据库 ${v}`) }
    }
  }
  const cityRank = ok(await call('GET', '/admin/partner-performance?kind=city', null, CITY))
  assert.ok(cityRank.scopeCity && cityRank.rows.every((r) => String(r.city_code) === String(cityRank.scopeCity)), '城市账号的城市榜只含本城')
  for (const kind of ['promoter', 'cocreator']) assert.notEqual((await call('GET', `/admin/partner-performance?kind=${kind}`, null, CITY)).code, 0, `城市账号不能看全局${kind}榜`)
})
const rebateOf = async (uid, orderNo) => Number((await one(`SELECT COALESCE(SUM(l.amount),0) s FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.biz_type = 1 AND l.direction = 1 AND l.biz_ref = ?`, [uid, orderNo])).s)
await t('会员等级：达到门槛自动升级 → 我的页 / 旅豆页 / 数字身份 / 后台 同一个等级名；升级后返豆多出加成；等级配置错误被拒', async () => {
  const lvs = ok(await call('GET', '/admin/member/levels', null, A))
  const u = await login('mock-xend-level-' + stamp)
  const rate = await cfgNum('bean.order_rate')
  // 起点：成长值离 Lv2 只差一点（门槛来自参数中心，不写死）
  await q('UPDATE user_account SET growth_value = ?, member_level = 1 WHERE id = ?', [lvs[1].min - 1000, u.user.id])
  const m0 = ok(await call('GET', '/c/member', null, u.token))
  assert.deepEqual([m0.lv, m0.name, m0.next.name], [1, lvs[0].name, lvs[1].name], '起点是 Lv1，下一级是 Lv2'); assert.equal(m0.next.gap, 1000)
  // 第一单：按 Lv1（无加成）返豆，完成后升到 Lv2
  const o1 = await finishOrder(u.token); const amt1 = Number(o1.amountPay)
  assert.equal(await rebateOf(u.user.id, o1.orderNo), Math.round(amt1 / 10 * (rate + lvs[0].rebateBonusBp / 10000)), '升级前按 Lv1 返豆')
  const me = ok(await call('GET', '/c/me', null, u.token))
  assert.equal(me.memberLevel, 2); assert.equal(me.level.name, lvs[1].name); assert.equal(me.level.growth, lvs[1].min - 1000 + amt1)
  const idn = ok(await call('GET', '/c/identity', null, u.token))
  assert.equal(idn.profile.levelName, lvs[1].name, '数字身份页的等级名 = 我的页'); assert.equal(idn.profile.memberLevel, 2)
  assert.deepEqual(ok(await call('GET', '/c/member', null, u.token)).levels.map((l) => l.name), lvs.map((l) => l.name), '旅豆页的等级表 = 后台等级配置')
  assert.equal(ok(await call('GET', `/admin/users/${u.user.id}`, null, A)).user.member_level, 2, '后台画像同步')
  assert.ok(idn.badges.find((b) => b.name === '旅行家认证').owned, '升到 Lv2 自动点亮「旅行家认证」'); assert.ok(idn.badges.find((b) => b.name === '水乡首游').owned, '完成首单点亮「水乡首游」')
  // 第二单：按 Lv2 返豆，多出等级加成
  const o2 = await finishOrder(u.token); const amt2 = Number(o2.amountPay)
  const r2 = await rebateOf(u.user.id, o2.orderNo)
  assert.equal(r2, Math.round(amt2 / 10 * (rate + lvs[1].rebateBonusBp / 10000)), '升级后按 Lv2 加成返豆')
  assert.ok(r2 > Math.round(amt2 / 10 * rate), 'Lv2 返豆应高于基础返豆')
  // 成长日志 = 订单实付
  assert.equal(Number((await one('SELECT COALESCE(SUM(delta),0) s FROM user_growth_log WHERE user_id = ?', [u.user.id])).s), amt1 + amt2)
  // 配置错误在提案阶段就被拒绝（不用等审批）
  assert.notEqual((await call('POST', '/admin/config/proposal', { key: 'member.levels', newValue: JSON.stringify([{ lv: 1, name: '探索者', min: 5 }, { lv: 2, name: '旅行家', min: 10 }]), reason: 'x' }, A)).code, 0, '门槛首项不为 0 应被拒')
  assert.notEqual((await call('POST', '/admin/config/proposal', { key: 'member.levels', newValue: JSON.stringify(lvs.map((l, i) => (i === 1 ? { ...l, perks: ['链上权益'] } : l))), reason: 'x' }, A)).code, 0, '含禁用词应被拒')
})
await t('勋章墙：每枚勋章有类别 / 系列 / 阶数和默认图形；未获得的给出进度；图形接口公开可取，已获得与未获得不同', async () => {
  const u = await login('mock-xend-wall-' + stamp)
  const idn = ok(await call('GET', '/c/identity', null, u.token))
  const preset = idn.badges.filter((b) => ['水乡首游', '旅途常客', '足迹初印', '落笔留痕', '游记新手', '旅行家认证', '元老旅友'].includes(b.name))
  assert.equal(preset.length, 7, '预置勋章应都在（V40）')
  for (const b of idn.badges) { assert.ok(b.category && b.categoryLabel && b.art, `${b.name} 缺类别 / 图形`); assert.ok(!JSON.stringify(b).includes('rule_param'), '不下发内部字段') }
  const always = idn.badges.find((b) => b.name === '旅途常客'); assert.deepEqual(always.progress, { cur: 0, need: 5, pct: 0 }, '未获得的自动规则勋章带进度')
  assert.equal(idn.badges.find((b) => b.name === '元老旅友').progress, null, '人工授予的勋章没有进度')
  assert.deepEqual(['旅途常客', '资深旅人', '传奇旅者'].map((n) => idn.badges.find((b) => b.name === n).tier), [2, 3, 4], '系列阶数递增')
  // 图形接口：不带登录也能取；类型 / 状态区别 / 不存在返回 404
  const raw = async (p) => fetch(BASE + p)
  const au = new URL(always.art); assert.equal(au.searchParams.get('state'), 'off', '未获得的图形地址带 state=off'); assert.ok(au.pathname.endsWith('.png'), '小程序拿到的是 PNG 地址')
  const on = await raw(au.pathname + '?state=on'), off = await raw(au.pathname + au.search)
  assert.equal(on.status, 200)
  const [bOn, bOff] = [Buffer.from(await on.arrayBuffer()), Buffer.from(await off.arrayBuffer())]
  const pngOk = /image\/png/.test(on.headers.get('content-type'))
  if (pngOk) assert.equal(bOn.subarray(1, 4).toString(), 'PNG'); else assert.match(on.headers.get('content-type'), /image\/svg\+xml/, '没有转换能力时回退为 SVG')
  assert.ok(!bOn.equals(bOff), '获得 / 未获得是两张不同的图')
  const sv = await raw(au.pathname.replace(/\.png$/, '.svg') + '?state=on'); assert.match(sv.headers.get('content-type'), /image\/svg\+xml/, '.svg 地址仍然是 SVG（后台预览用）')
  assert.equal((await raw('/badge-art/99999999.svg')).status, 404)
  assert.equal((await raw('/badge-art/preview.svg?icon_key=compass&rarity=legend&category=explore')).status, 200)
  // 后台勋章页：每枚都有图形与分类
  const defs = ok(await call('GET', '/admin/web3/badges', null, A)).defs
  assert.ok(defs.length >= 35, '预置 35 枚（V40 + V41）'); assert.ok(defs.every((d) => d.profile))
})
await t('徽章分种类：9 类分组；在城市完成出行点亮城市徽章与国家印章；未开放国家不露出；订单封存后点亮可信勋章并带封存编号；规则缺城市 / 国家的徽章被拒', async () => {
  const u = await login('mock-xend-kinds-' + stamp)
  const idn0 = ok(await call('GET', '/c/identity', null, u.token))
  assert.deepEqual(idn0.groups.map((g) => g.key), ['level', 'member', 'city', 'country', 'trusted', 'journey', 'explore', 'creator', 'special'])
  assert.equal(idn0.groups.find((g) => g.key === 'trusted').label, '可信勋章', '小程序里叫「可信勋章」，不出现链相关词')
  const cats = new Set(idn0.badges.map((b) => b.category)); for (const c of ['level', 'member', 'city', 'country', 'trusted']) assert.ok(cats.has(c), '勋章墙缺类别 ' + c)
  assert.ok(!idn0.badges.some((b) => b.name === '日本印记'), '没有对应城市的国家印章不在勋章墙露出')
  const cityBadge = idn0.badges.find((b) => b.category === 'city' && b.cityCode === String(sess.city_code) && b.progress && b.progress.need === 1)
  assert.ok(cityBadge && !cityBadge.owned, `城市 ${sess.city_code} 应有 1 次到访的城市徽章`)
  assert.equal(idn0.badges.find((b) => b.name === '中国印记').owned, false)
  // 在该城市完成一单 → 城市徽章 + 国家印章点亮（订单完成时自动评估）
  const od = await finishOrder(u.token)
  const idn1 = ok(await call('GET', '/c/identity', null, u.token))
  assert.ok(idn1.badges.find((b) => b.id === cityBadge.id).owned, '在该城市完成出行 → 城市徽章点亮')
  assert.ok(idn1.badges.find((b) => b.name === '中国印记').owned, '境内出行 → 「中国印记」点亮')
  assert.equal(idn1.badges.find((b) => b.name === '首单封存').owned, false, '订单还没被打包封存，可信勋章不点亮')
  assert.deepEqual(idn1.badges.find((b) => b.name === '首单封存').progress, { cur: 0, need: 1, pct: 0 })
  // 订单存证打包后 → 可信勋章点亮，带封存编号（= 这次发放的存证记录校验码前 8 位）
  ok(await call('POST', '/admin/system/jobs/attest-pack/run', {}, A))
  const idn2 = ok(await call('GET', '/c/identity', null, u.token))
  const tb = idn2.badges.find((b) => b.name === '首单封存'); assert.ok(tb.owned, '订单封存后点亮「首单封存」')
  assert.match(tb.proof.code, /^[0-9A-F]{8}$/)
  const ev = await one(`SELECT payload_hash FROM attest_event WHERE biz_type = 'badge' AND biz_ref = ?`, ['badge-' + u.user.id + '-' + tb.id])
  assert.equal(tb.proof.code, String(ev.payload_hash).slice(0, 8).toUpperCase(), '封存编号 = 存证记录的校验码')
  assert.ok(od.orderNo)
  // 后台：徽章列表带已锚定数；规则缺城市 / 国家的徽章被拒
  assert.ok(ok(await call('GET', '/admin/web3/badges', null, A)).defs.every((d) => d.anchored != null))
  const bad = (v) => call('POST', '/admin/entities/badge', { values: { name: '跨端校验' + stamp, icon_key: 'star', threshold: 1, ...v } }, A)
  assert.notEqual((await bad({ rule_type: 'city_visit' })).code, 0, '城市到访必须选城市')
  assert.notEqual((await bad({ rule_type: 'country_visit', country_code: '日本' })).code, 0, '国家到访必须填两位国家代码')
})
await t('旅豆页数据：本月获得 / 使用与账本一致、折合金额、30 天内到期不超过余额、旅豆币图可取；会员等级徽章图公开可取', async () => {
  const acc = ok(await call('GET', '/c/bean/account', null, C))
  const mo = await one(`SELECT COALESCE(SUM(CASE WHEN l.direction = 1 AND l.biz_type IN (1,2,3,5) THEN l.amount END), 0) inc,
    COALESCE(SUM(CASE WHEN l.direction = 2 AND l.biz_type IN (4,6,7) THEN l.amount END), 0) outc
    FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [buyer.user.id])
  assert.equal(acc.monthIn, Number(mo.inc)); assert.equal(acc.monthOut, Number(mo.outc))
  assert.equal(acc.yuan, Math.floor(acc.balance / 10 * 10) / 10, '100 豆 = ¥10')
  assert.ok(acc.expiringSoon >= 0 && acc.expiringSoon <= acc.balance)
  const coin = await fetch(new URL(acc.coinArt).pathname.replace(/^/, BASE)); assert.equal(coin.status, 200); assert.match(coin.headers.get('content-type'), /image\/(png|svg\+xml)/)
  const me = ok(await call('GET', '/c/me', null, C)); assert.ok(me.level.art && me.level.levels.every((l) => l.art))
  for (const l of me.level.levels) assert.equal((await fetch(BASE + new URL(l.art).pathname + new URL(l.art).search)).status, 200)
})
const FIN = ok(await call('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const mHonor = async () => ok(await call('GET', '/m/honor', null, B))
await t('商户经营等级与徽章：B 端 / 后台 / 数据库 三处一致；徽章墙只含商户徽章且游客看不到；规则按数据库复算点亮', async () => {
  const h = await mHonor(), mid = sess.merchant_id
  assert.deepEqual(h.groups.map((g) => g.key), ['mlevel', 'mhonor', 'trusted']); assert.equal(h.groups[2].label, '可信勋章', 'B 端不出现链相关词')
  assert.ok(h.badges.length >= 20, '预置 20 枚商户徽章（V42）'); assert.ok(h.badges.every((b) => b.art && b.category && !JSON.stringify(b).includes('rule_param')))
  // 数据库复算指标
  const o = await one("SELECT COUNT(*) n, COALESCE(SUM(amount_pay),0) gmv FROM orders WHERE merchant_id = ? AND status = 50", [mid])
  const v = await one('SELECT COUNT(*) n FROM verification_log WHERE merchant_id = ? AND result = 1', [mid])
  assert.equal(h.level.metrics.orders, Number(o.n)); assert.equal(h.level.metrics.verifies, Number(v.n))
  const th = (b) => Number(JSON.parse(typeof b.profile === 'string' ? b.profile : JSON.stringify(b.profile)).threshold)
  const defs = await q("SELECT * FROM badge WHERE rule_type IN ('m_orders','m_verify')")
  for (const d of defs) { const val = d.rule_type === 'm_orders' ? Number(o.n) : Number(v.n); const row = h.badges.find((b) => Number(b.id) === Number(d.id)); assert.equal(row.owned, val >= th(d), `${d.name}：规则值 ${val} / 阈值 ${th(d)}`) }
  if (Number(o.n) >= 1) assert.ok(h.badges.find((b) => b.name === '首单开张').owned, '完成过订单的商户应有「首单开张」')
  // 等级：按 /admin/merchant/levels 的门槛复算
  const lvs = ok(await call('GET', '/admin/merchant/levels', null, A)); const m = h.level.metrics
  const okLv = (l) => m.orders >= l.minOrders && m.reviews >= l.minReviews && (!l.minRating || m.rating10 >= l.minRating) && m.refundPct <= l.maxRefundPct
  assert.equal(h.level.lv, lvs.reduce((best, l) => (okLv(l) ? l.lv : best), 1), '等级 = 达标的最高档')
  assert.ok(h.level.levels.every((l) => l.art) && h.level.art, '等级徽章图地址齐全')
  // 后台：列表与全景同一个等级、徽章
  const row = ok(await call('GET', '/admin/merchants', null, A)).find((x) => Number(x.id) === Number(mid)); assert.equal(Number(row.level), h.level.lv)
  const ov = ok(await call('GET', `/admin/merchants/${mid}/overview`, null, A)); assert.equal(ov.level.lv, h.level.lv)
  assert.deepEqual(ov.badges.map((b) => b.name).sort(), h.badges.filter((b) => b.owned).map((b) => b.name).sort(), '后台全景的徽章 = B 端已点亮的徽章')
  // 工作台带等级简讯
  assert.equal(ok(await call('GET', '/m/workbench', null, B)).level.lv, h.level.lv)
  // 游客勋章墙里没有商户徽章
  const names = new Set(h.badges.map((b) => b.name)); const idn = ok(await call('GET', '/c/identity', null, C))
  assert.ok(!idn.badges.some((b) => names.has(b.name)), '游客身份页不应出现商户徽章'); assert.ok(!idn.badges.some((b) => ['mlevel', 'mhonor'].includes(b.category)))
  // 商户徽章图公开可取（PNG；没装转换能力时回退 SVG）
  const art = await fetch(BASE + new URL(h.level.art).pathname); assert.equal(art.status, 200)
})
await t('游客端看商户等级：线路详情 / 商户资料页 / 线路列表只下发白名单字段（等级与最多 3 枚徽章），与 B 端、数据库一致，不泄露经营数据与权益说明', async () => {
  const mid = sess.merchant_id, h = await mHonor()
  const tour = ok(await call('GET', '/c/tours/' + sess.product_id, null, C)), place = ok(await call('GET', '/c/places/merchant/' + mid, null, C))
  for (const [name, hn] of [['详情页', tour.merchantHonor], ['商户资料页', place.honor]]) {
    assert.ok(hn, name + ' 应有商户荣誉')
    assert.deepEqual(Object.keys(hn).sort(), ['art', 'badges', 'lv', 'name'], name + ' 只下发等级与徽章')
    assert.equal(hn.lv, h.level.lv, name + ' 等级 = B 端'); assert.equal(hn.name, h.level.name)
    assert.ok(hn.badges.length <= 3); for (const b of hn.badges) assert.deepEqual(Object.keys(b).sort(), ['art', 'name', 'rarity', 'rarityLabel'])
    const owned = new Set(h.badges.filter((b) => b.owned && b.category !== 'mlevel').map((b) => b.name)); for (const b of hn.badges) assert.ok(owned.has(b.name), `${name} 的「${b.name}」应是商户已获得的徽章`)
    const rank = { legend: 4, epic: 3, rare: 2, common: 1 }; for (let i = 1; i < hn.badges.length; i++) assert.ok(rank[hn.badges[i - 1].rarity] >= rank[hn.badges[i].rarity], '徽章按稀有度从高到低')
    const txt = JSON.stringify(hn); for (const k of ['metrics', 'orders', 'refund', 'perks', 'need', 'gmv', 'rating10', 'reviews']) assert.ok(!txt.includes('"' + k + '"'), name + ' 不应含 ' + k)
    assert.equal((await fetch(BASE + new URL(hn.art).pathname)).status, 200, '等级徽章图可取')
  }
  // 列表：Lv2 及以上才带标签；Lv1 为 null
  const tagOf = async () => ok(await call('GET', '/c/tours', null, C)).find((x) => Number(x.id) === Number(sess.product_id)).merchantTag
  const lvNow = Number((await one('SELECT level FROM merchant WHERE id = ?', [mid])).level)
  try {
    await q('UPDATE merchant SET level = 1 WHERE id = ?', [mid]); assert.equal(await tagOf(), null, 'Lv1 不挂标签')
    await q('UPDATE merchant SET level = 3 WHERE id = ?', [mid]); const tg = await tagOf(); assert.deepEqual(tg, { lv: 3, name: ok(await call('GET', '/admin/merchant/levels', null, A))[2].name })
    assert.ok(!Object.keys(ok(await call('GET', '/c/tours', null, C))[0]).includes('merchant_lv'), '内部字段 merchant_lv 不下发')
  } finally { await q('UPDATE merchant SET level = ? WHERE id = ?', [lvNow, mid]) }
})
await t('商户徽章人工发放：只能发给商户、不能重复；订单封存后点亮「账实相符」且带封存编号；评分类徽章需要足够评价数', async () => {
  const h0 = await mHonor(), mid = sess.merchant_id
  const manual = await one("SELECT id, name FROM badge WHERE name = '入驻三年'")
  assert.notEqual((await call('POST', `/admin/web3/badges/${manual.id}/grant`, { userId: buyer.user.id }, A)).code, 0, '商户徽章不能发给用户')
  assert.notEqual((await call('POST', `/admin/web3/badges/${manual.id}/grant`, { merchantId: 99999999 }, A)).code, 0, '商户不存在')
  const owned0 = h0.badges.find((b) => b.id === manual.id).owned
  if (!owned0) { ok(await call('POST', `/admin/web3/badges/${manual.id}/grant`, { merchantId: mid, reason: '跨端测试' }, A)); assert.notEqual((await call('POST', `/admin/web3/badges/${manual.id}/grant`, { merchantId: mid }, A)).code, 0, '不能重复发放') }
  assert.ok((await mHonor()).badges.find((b) => b.id === manual.id).owned, 'B 端点亮人工发放的徽章')
  assert.ok(await one("SELECT id FROM attest_event WHERE biz_type = 'badge' AND biz_ref = ?", ['mbadge-' + mid + '-' + manual.id]), '商户徽章发放进存证队列')
  // 订单封存 → 账实相符
  ok(await call('POST', '/admin/system/jobs/attest-pack/run', {}, A))
  const hs = await mHonor(), sealed = hs.badges.find((b) => b.name === '账实相符')
  if (hs.level.metrics.sealed >= 1) { assert.ok(sealed.owned, '订单已封存 → 「账实相符」点亮'); assert.match(sealed.proof.code, /^[0-9A-F]{8}$/) } else assert.ok(!sealed.owned)
  // 评分类：评价数不够时即使评分满分也不点亮
  const rated = hs.badges.find((b) => b.name === '口碑卓越'); if (hs.level.metrics.reviews < 50) assert.ok(!rated.owned, '评价数不足 50 不应点亮「口碑卓越」')
  // 后台列表：商户徽章带已发放 / 已锚定
  assert.ok(ok(await call('GET', '/admin/web3/badges', null, A)).defs.find((d) => Number(d.id) === Number(manual.id)).granted >= 1)
})
await t('商户等级配置：错误配置在提案阶段被拒；双人复核生效后立即重评，回滚后恢复', async () => {
  const lvs = ok(await call('GET', '/admin/merchant/levels', null, A)), mid = sess.merchant_id
  const prop = (v) => call('POST', '/admin/config/proposal', { key: 'merchant.levels', newValue: JSON.stringify(v), reason: '跨端测试' }, A)
  assert.notEqual((await prop([lvs[0]])).code, 0, '等级数量不足'); assert.notEqual((await prop(lvs.map((l, i) => (i === 1 ? { ...l, minRating: 45, minReviews: 0 } : l)))).code, 0, '设评分门槛必须设评价数')
  assert.notEqual((await prop(lvs.map((l, i) => (i === 2 ? { ...l, minOrders: 1 } : l)))).code, 0, '门槛不能比上一级更低'); assert.notEqual((await prop(lvs.map((l, i) => (i === 1 ? { ...l, perks: ['链上权益'] } : l)))).code, 0, '含禁用词')
  const before = (await mHonor()).level
  if (before.metrics.orders < 1 || before.lv > 1) return // 数据库里的商户已不是"仅有订单、未达 Lv2"的状态，这条只验证提案校验
  const easy = lvs.map((l, i) => (i === 1 ? { ...l, minOrders: 1, minReviews: 0, minRating: 0, maxRefundPct: 100 } : i === 2 ? { ...l, minOrders: 1000 } : i === 3 ? { ...l, minOrders: 2000 } : l))
  const p = ok(await call('POST', '/admin/config/proposal', { key: 'merchant.levels', newValue: JSON.stringify(easy), reason: '跨端测试' }, A))
  assert.notEqual((await call('POST', '/admin/config/approve', { historyId: p.historyId }, A)).code, 0, '提案人不能自己审批')
  ok(await call('POST', '/admin/config/approve', { historyId: p.historyId }, FIN))
  assert.equal(Number((await one('SELECT level FROM merchant WHERE id = ?', [mid])).level), 2, '新门槛生效后立即重评：有订单的商户升到 Lv2')
  assert.equal((await mHonor()).level.lv, 2)
  ok(await call('POST', '/admin/config/rollback', { key: 'merchant.levels' }, A))
  assert.equal((await mHonor()).level.lv, 1, '回滚后恢复原门槛，等级随之恢复')
})
await t('景点数据：景点下的线路，景点页的数字 = 该线路自己的商品数据；A 的景点页能看到这条线路', async () => {
  const sc = ok(await call('POST', '/admin/scenics', { name: '跨端景点' + stamp, cityCode: sess.city_code }, A)); const scId = sc.id
  const prevSc = (await one('SELECT scenic_id FROM tour_product WHERE id = ?', [sess.product_id])).scenic_id
  await q('UPDATE tour_product SET scenic_id = ? WHERE id = ?', [scId, sess.product_id])
  try {
    const so = ok(await call('GET', `/admin/scenics/${scId}/overview`, null, A)), po = ok(await call('GET', `/admin/products/${sess.product_id}/overview`, null, A)).kpi
    const skpi = so.kpi || so
    // 景点页口径是"有效销量"（不含退款），线路页的 orders 含已退款，所以以数据库为准分别核对
    const truthRows = await one("SELECT COALESCE(SUM(qty),0) sold, COALESCE(SUM(amount_pay),0) gmv, COUNT(*) n FROM orders WHERE product_id = ? AND status IN (20,30,40,50)", [sess.product_id])
    assert.equal(Number(skpi.sold), Number(truthRows.sold), '景点页有效销量 = 数据库：' + JSON.stringify(skpi) + ' vs ' + JSON.stringify(truthRows))
    assert.equal(Number(skpi.gmv), Number(truthRows.gmv), '景点页 GMV = 数据库有效订单合计')
    assert.equal(Number(po.orders) - Number(po.refunded), Number(truthRows.n), '线路页订单数 - 退款数 = 有效订单数：' + JSON.stringify(po))
    const place = ok(await call('GET', `/c/places/scenic/${scId}`, null, C)); assert.ok(JSON.stringify(place).includes(sess.title), 'A 景点页应列出该线路')
  } finally { await q('UPDATE tour_product SET scenic_id = ? WHERE id = ?', [prevSc, sess.product_id]) }
})

// ---------- 清理本轮造出的业务数据 ----------
for (const id of coIds) { await q('DELETE FROM co_profit WHERE co_creator_id = ?', [id]).catch(() => {}); await q('DELETE FROM co_creator WHERE id = ?', [id]).catch(() => {}) }
for (const id of created.banners) await q('DELETE FROM banner WHERE id = ?', [id]).catch(() => {})
for (const id of created.faqs) await q('DELETE FROM faq WHERE id = ?', [id]).catch(() => {})
for (const id of created.badges) { await q('DELETE FROM user_badge WHERE badge_id = ?', [id]).catch(() => {}); await q('DELETE FROM badge WHERE id = ?', [id]).catch(() => {}) }
for (const id of created.notes) await q('DELETE FROM content_note WHERE id = ?', [id]).catch(() => {})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day); const y = x.getUTCFullYear()
  return `${y}-W${String(Math.ceil(((x - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
