// 只读取隔离库 wanderlust_audit_1106 / 隔离服务 18206。逐条核实疑点，输出事实，不做判断性修复。
import assert from 'node:assert/strict'
import fs from 'node:fs'
if (!/^wanderlust_(audit|qa)_/.test(process.env.DB_NAME || '')) { console.error('拒绝运行：DB_NAME 必须是 wanderlust_audit_* 或 wanderlust_qa_*'); process.exit(2) }
const { q, one, closeDb } = await import('./src/db.mjs')
const order = await import('./src/domain/order.mjs')
const bean = await import('./src/domain/bean.mjs')
const pass = await import('./src/domain/pass.mjs')
const group = await import('./src/domain/group.mjs')
const promo = await import('./src/domain/promo.mjs')
const jobs = await import('./src/jobs.mjs')
const BASE = process.env.API_BASE
const stamp = Date.now().toString(36)
const results = []
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { raw: t.slice(0, 200) } }
  return { http: r.status, ...j }
}
const rec = (id, title, facts) => { results.push({ id, title, facts }); console.log(`\n[${id}] ${title}\n   ` + JSON.stringify(facts, (k, v) => typeof v === 'bigint' ? Number(v) : v)) }
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const probe = async (id, title, fn) => { if (ONLY && !ONLY.has(id)) return; try { rec(id, title, await fn()) } catch (e) { rec(id, title + '（探针异常）', { error: String(e.message || e).slice(0, 300) }) } }
const cLogin = async (tag) => { const r = await call('POST', '/c/auth/login', { code: 'mock-aud-' + tag + '-' + stamp }); return { token: r.data.token, id: Number(r.data.user.id), code: 'mock-aud-' + tag + '-' + stamp } }
const A = (await call('POST', '/admin/login', { username: 'admin', password: 'admin123' })).data.token
const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
const giveBeans = async (uid, n) => bean.grant(uid, n, bean.BIZ.TASK, 'aud-' + stamp + '-' + uid, budget.id)
// 夹具：可售商品与团期（远期 + 足够名额），不碰种子团期
const baseProd = await one("SELECT p.* FROM tour_product p WHERE p.status = 1 AND p.cat <> 'shop' ORDER BY p.id LIMIT 1")
let dayN = 100 + Math.floor(Math.random() * 3000)
const mkSession = async (days0, { price = 10000, quota = 50, minGo = 1, productId = baseProd.id, exact = false } = {}) => {
  const days = exact ? days0 : (dayN += 1)
  if (exact) await q('UPDATE tour_session SET depart_date = DATE_ADD(depart_date, INTERVAL ? DAY) WHERE product_id = ? AND depart_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)', [(dayN += 1) + 4000, productId, days0])
  const r = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0, ?, ?, 1)', [productId, days, quota, minGo, price])
  return Number(r.insertId)
}
const placePaid = async (uid, sid, qty = 1, beans = 0, scene) => {
  const r = await order.place({ userId: uid, sessionId: sid, qty, wantedBeans: beans, promoScene: scene, withInsurance: false })
  await order.acceptPayment(r.orderNo, 'AUD' + r.orderNo, true)
  return r.orderNo
}
const staffUser = await cLogin('staff')
await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [baseProd.merchant_id, staffUser.id])
const M = (await call('POST', '/m/auth/login', { code: staffUser.code, merchantId: Number(baseProd.merchant_id) })).data.token

await probe('T01', '游客取消未支付订单：旅豆与名额是否归还', async () => {
  const u = await cLogin('t01'); await giveBeans(u.id, 500)
  const sid = await mkSession(40)
  const b0 = await bean.balance(u.id)
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 2, wantedBeans: 200, withInsurance: false })
  const b1 = await bean.balance(u.id); const s1 = await one('SELECT booked FROM tour_session WHERE id=?', [sid])
  const c = await call('POST', `/c/orders/${r.orderNo}/refund`, { reason: '用户申请' }, u.token)
  const b2 = await bean.balance(u.id); const s2 = await one('SELECT booked FROM tour_session WHERE id=?', [sid]); const o = await order.byNo(r.orderNo)
  await jobs.tickExpire().catch(()=>{}); await order.closeTimeout()
  const b3 = await bean.balance(u.id); const s3 = await one('SELECT booked FROM tour_session WHERE id=?', [sid])
  return { 下单前余额: b0, 下单后余额: b1, 下单后已报: s1.booked, 取消响应: c.data, 取消后状态: o.status, 取消后余额: b2, 取消后已报: s2.booked, 跑超时任务后余额: b3, 跑超时任务后已报: s3.booked }
})

await probe('T02', '未成团取消：未支付订单已抵扣的旅豆是否归还', async () => {
  const u = await cLogin('t02'); await giveBeans(u.id, 500)
  const sid = await mkSession(1, { minGo: 99, exact: true })
  const b0 = await bean.balance(u.id)
  const r = await order.place({ userId: u.id, sessionId: sid, qty: 1, wantedBeans: 100, withInsurance: false })
  const b1 = await bean.balance(u.id)
  await group.cancelDueSessions()
  const o = await order.byNo(r.orderNo)
  return { 下单前: b0, 下单后: b1, 团期取消后订单状态: o.status, 关单原因: o.close_reason, 取消后余额: await bean.balance(u.id) }
})

await probe('T03', '未成团：退款后再免费改签（是否既退钱又得票；改签单能否核销；能否再退一次）', async () => {
  const u = await cLogin('t03')
  const sid = await mkSession(0, { minGo: 99, price: 10000, exact: true })
  const target = await mkSession(30, { price: 10000 })
  const no = await placePaid(u.id, sid)
  await group.cancelDueSessions()
  const old = await order.byNo(no)
  const oldRf = await one('SELECT amount, status FROM refunds WHERE order_id=?', [old.id])
  const d = await call('GET', `/c/orders/${no}`, null, u.token)
  const rb = await call('POST', `/c/orders/${no}/rebook`, { sessionId: target }, u.token)
  const nw = rb.data ? await order.byNo(rb.data.orderNo) : null
  const pay = nw ? await one('SELECT COUNT(*) c FROM payment WHERE order_id=?', [nw.id]) : null
  const passes = nw ? await q('SELECT id,status FROM travel_pass WHERE order_id=?', [nw.id]) : []
  let scan = null
  if (passes[0]) { const qr = await call('GET', `/c/pass/${passes[0].id}/code`, null, u.token); scan = await call('POST', '/m/verify/scan', { payload: qr.data.qr }, M) }
  const quote = nw ? await call('GET', `/c/orders/${nw.order_no}/refund-quote`, null, u.token) : null
  const rf2 = nw ? await call('POST', `/c/orders/${nw.order_no}/refund`, { reason: '再退一次' }, u.token) : null
  const nw2 = nw ? await order.byNo(nw.order_no) : null
  return { 原单状态: old.status, 原单已退金额分: oldRf, canRebook: d.data.canRebook, 改签响应: rb.data || rb.msg, 新单状态: nw && nw.status, 新单amount_pay: nw && nw.amount_pay, 新单支付记录数: pay && pay.c, 新单凭证: passes, 扫码核销结果: scan && scan.data, 新单退款试算: quote && quote.data && { allowed: quote.data.allowed, refundFen: quote.data.refundFen }, 再退一次: rf2 && (rf2.data || rf2.msg), 新单最终状态: nw2 && nw2.status }
})

await probe('T04', '旅豆过期任务：同一批旧豆是否被重复扣减（任务每分钟跑一次）', async () => {
  const u = await cLogin('t04'); await giveBeans(u.id, 300); await giveBeans(u.id, 700)
  const acc = await one('SELECT id FROM bean_account WHERE user_id=?', [u.id])
  const first = await one('SELECT MIN(id) id FROM bean_ledger WHERE account_id=? AND direction=1', [acc.id])
  await q('UPDATE bean_ledger SET created_at = NOW() - INTERVAL 14 MONTH WHERE id=?', [first.id])
  const b0 = await bean.balance(u.id)
  await jobs.tickExpire(); const b1 = await bean.balance(u.id)
  await jobs.tickExpire(); const b2 = await bean.balance(u.id)
  await jobs.tickExpire(); const b3 = await bean.balance(u.id)
  return { 初始余额: b0, 过期量: 300, 第1轮后: b1, 第2轮后: b2, 第3轮后: b3 }
})

await probe('T04b', '旅豆过期：已花掉的旧豆是否仍被当作过期再扣一次', async () => {
  const u = await cLogin('t04b'); await giveBeans(u.id, 300)
  const acc = await one('SELECT id FROM bean_account WHERE user_id=?', [u.id])
  const first = await one('SELECT MIN(id) id FROM bean_ledger WHERE account_id=? AND direction=1', [acc.id])
  await q('UPDATE bean_ledger SET created_at = NOW() - INTERVAL 14 MONTH WHERE id=?', [first.id])
  await bean.deduct(u.id, 300, bean.BIZ.DEDUCT, 'aud-spent-' + stamp)
  await giveBeans(u.id, 400) // 新豆
  const b0 = await bean.balance(u.id); await jobs.tickExpire()
  return { 旧豆已全部花掉后余额: b0, 过期任务后余额: await bean.balance(u.id) }
})

await probe('T05', '暗号核销：不带订单号时核销的是谁的单（商户端实际就是不带）', async () => {
  await q("UPDATE tour_product SET phrase_user = ?, phrase_merchant = ? WHERE id = ?", ['入戏暗号甲', '对答乙', baseProd.id])
  const a = await cLogin('t05a'), b = await cLogin('t05b')
  const sNear = await mkSession(10), sFar = await mkSession(60)
  const noA = await placePaid(a.id, sNear)
  const noB = await placePaid(b.id, sFar) // 较新且 60 天后才出发
  const r = await call('POST', '/m/verify/phrase', { phrase: '入戏暗号甲' }, M)
  const oa = await order.byNo(noA), ob = await order.byNo(noB)
  const logs = await q('SELECT merchant_id, method, result FROM verification_log WHERE pass_id IN (SELECT id FROM travel_pass WHERE order_id=?)', [ob.id])
  return { 到场游客A订单: noA, A状态: oa.status, 未到场B订单60天后出发: noB, B状态: ob.status, 响应: r.data, B的核销日志: logs }
})

await probe('T05b', '暗号核销：指定已退款单 / 多人单的流水', async () => {
  const c = await cLogin('t05c'); const s = await mkSession(30)
  const no = await placePaid(c.id, s, 3)
  const r1 = await call('POST', '/m/verify/phrase', { phrase: '入戏暗号甲', orderNo: no }, M)
  const oid = (await order.byNo(no)).id
  const merchantVisible = await q('SELECT id, method FROM verification_log WHERE merchant_id=? AND pass_id IN (SELECT id FROM travel_pass WHERE order_id=?)', [baseProd.merchant_id, oid])
  const zeroMerchant = await q('SELECT id, method FROM verification_log WHERE merchant_id=0 AND pass_id IN (SELECT id FROM travel_pass WHERE order_id=?)', [oid])
  const d = await cLogin('t05d'); const s2 = await mkSession(30)
  const no2 = await placePaid(d.id, s2)
  await call('POST', `/c/orders/${no2}/refund`, { reason: 'x' }, d.token)
  const r2 = await call('POST', '/m/verify/phrase', { phrase: '入戏暗号甲', orderNo: no2 }, M)
  return { 三人单响应: r1.data, 商户可见流水条数: merchantVisible.length, merchant_id为0的流水条数: zeroMerchant.length, 已退款单状态: (await order.byNo(no2)).status, 已退款单核销响应: r2.data }
})

await probe('T06', '一键获取手机号：接口返回值能否通过下单页校验', async () => {
  const u = await cLogin('t06')
  const r = await call('POST', '/c/auth/phone', { code: 'x' }, u.token)
  return { 接口返回: r.data, 通过下单校验: /^1[3-9]\d{9}$/.test((r.data || {}).phone || '') }
})

await probe('T07', '离线核销上传：断网时扫到的码，5 分钟后上传是否通过', async () => {
  const u = await cLogin('t07'); const s = await mkSession(30); const no = await placePaid(u.id, s)
  const oid = (await order.byNo(no)).id; const p = await one('SELECT id FROM travel_pass WHERE order_id=?', [oid])
  const win = pass.windowOf(Math.floor(Date.now() / 1000), 60)
  const r = await call('POST', '/m/verify/offline-batch', { items: [{ payload: pass.qrPayload(Number(p.id), win - 5), offlineAt: new Date(Date.now() - 300000).toISOString() }] }, M)
  const after = await one('SELECT status FROM travel_pass WHERE id=?', [p.id])
  return { 响应: r.data, 凭证状态: after.status, 订单状态: (await order.byNo(no)).status }
})

await probe('T08', '核销码页：接口是否带订单号（暗号依赖）；已核销凭证点「查看」', async () => {
  const u = await cLogin('t08'); const s = await mkSession(30); const no = await placePaid(u.id, s)
  const d = await call('GET', `/c/orders/${no}`, null, u.token)
  const pid = d.data.passes[0].id
  const code = await call('GET', `/c/pass/${pid}/code`, null, u.token)
  await call('POST', '/m/verify/scan', { payload: code.data.qr }, M)
  const again = await call('GET', `/c/pass/${pid}/code`, null, u.token)
  const ph = await call('GET', `/c/orders/${no}/phrase`, null, u.token)
  return { 取码字段: Object.keys(code.data), 暗号接口: ph.data, 已核销再取码: { code: again.code, msg: again.msg } }
})

await probe('T09', '跨端令牌与冻结：商户令牌调游客接口；冻结后商户令牌是否仍可用', async () => {
  const cross = await call('GET', '/c/me', null, M)
  const u = await cLogin('t09'); await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,2)', [baseProd.merchant_id, u.id])
  const mt = (await call('POST', '/m/auth/login', { code: u.code, merchantId: Number(baseProd.merchant_id) })).data.token
  await q('UPDATE user_account SET status=0 WHERE id=?', [u.id])
  const cFrozen = await call('GET', '/c/me', null, u.token)
  const mFrozen = await call('GET', '/m/workbench', null, mt)
  const crossFrozen = await call('GET', '/c/me', null, mt)
  await q('UPDATE user_account SET status=1 WHERE id=?', [u.id])
  return { 商户令牌调c_me: { code: cross.code, nick: cross.data && cross.data.nickname }, 冻结后游客令牌: { code: cFrozen.code }, 冻结后商户工作台: { code: mFrozen.code }, 冻结后商户令牌调c_me: { code: crossFrozen.code } }
})

await probe('T10', '商户早鸟价：负数/高于现价；下单金额', async () => {
  const s = await mkSession(30, { price: 10000 })
  const r = await call('POST', `/m/supply/${s}`, { action: 'early', value: { price: -500, days: 0 } }, M)
  const row1 = await one('SELECT price_adult, early_price, early_days FROM tour_session WHERE id=?', [s])
  const u = await cLogin('t10')
  const pl = await call('POST', '/c/orders', { sessionId: s, qty: 2, beanDeduct: 0, contactName: 'x', contactPhone: '13800000000' }, u.token)
  const s2 = await mkSession(30, { price: 10000 })
  await call('POST', `/m/supply/${s2}`, { action: 'early', value: { price: 9000, days: 1 } }, M)
  const r2 = await call('POST', `/m/supply/${s2}`, { action: 'price', value: 5000 }, M)
  const row2 = await one('SELECT price_adult, early_price, early_days FROM tour_session WHERE id=?', [s2])
  const u2 = await cLogin('t10b')
  const pl2 = await call('POST', '/c/orders', { sessionId: s2, qty: 1, beanDeduct: 0, contactName: 'x', contactPhone: '13800000000' }, u2.token)
  const resume = await call('POST', `/m/supply/${s2}`, { action: 'stop_sell' }, M)
  const resume2 = await call('POST', `/m/supply/${s2}`, { action: 'resume' }, M)
  const audit = await one("SELECT COUNT(*) c FROM audit_log WHERE entity = 'session' AND ref LIKE ?", ['%' + s2 + '%']).catch(() => ({ c: '表结构不同' }))
  return { 负早鸟响应: r.data || r.msg, 负早鸟落库: row1, 负价下单: pl.data ? { amountPay: pl.data.amountPay } : { code: pl.code, msg: pl.msg }, 改现价5000响应: r2.data || r2.msg, 落库: row2, 下单实付: pl2.data ? pl2.data.amountPay : pl2.msg, 停售后恢复: { code: resume2.code, msg: resume2.msg }, 改价审计: audit }
})

await probe('T11', '实名：身份证是否明文入库；校验强度', async () => {
  const u = await cLogin('t11')
  const r = await call('POST', '/c/kyc/submit', { realName: '张三丰', idNo: '11010119900307123X' }, u.token)
  const row = await one('SELECT id_no_enc, real_name FROM kyc_application WHERE user_id=?', [u.id])
  const u2 = await cLogin('t11b')
  const bad = await call('POST', '/c/kyc/submit', { realName: '李四', idNo: 'XXXXXXXXXXXXXXXXXX' }, u2.token)
  return { 响应: r.data, id_no_enc实际内容: Buffer.from(row.id_no_enc).toString('utf8'), 全X身份证: bad.data || bad.msg }
})

await probe('T12', '约稿：同一篇笔记投多个任务；字数要求；各拿多少奖励', async () => {
  const u = await cLogin('t12')
  const mk = async (tag) => (await call('POST', '/admin/content-tasks', { title: '审计约稿' + tag + stamp, brief: '审计用约稿任务说明', reward_beans: 50, min_words: 500, min_images: 3, status: 0 }, A))
  const t1 = await mk('A'), t2 = await mk('B')
  const id1 = t1.data && (t1.data.id || t1.data), id2 = t2.data && (t2.data.id || t2.data)
  if (!id1 || !id2) return { 建任务失败: [t1.msg, t2.msg] }
  await q('UPDATE content_task SET status=0 WHERE id IN (?,?)', [id1, id2])
  const n = await call('POST', '/c/notes', { title: '短', body: '就四个字呀' }, u.token)
  await call('POST', `/c/tasks/${id1}/claim`, {}, u.token); await call('POST', `/c/tasks/${id2}/claim`, {}, u.token)
  const s1 = await call('POST', `/c/tasks/${id1}/submit`, { noteId: n.data.id }, u.token)
  const s2 = await call('POST', `/c/tasks/${id2}/submit`, { noteId: n.data.id }, u.token)
  const entries = await q('SELECT id, task_id, status FROM content_task_entry WHERE user_id=?', [u.id])
  const b0 = await bean.balance(u.id); const v = []
  for (const e of entries) v.push(await call('POST', `/admin/task-entries/${e.id}/verdict`, { pass: true, verdict: 1, approve: true, reason: '审计通过' }, A))
  return { 笔记状态: n.data.status, 任务1提交: s1.data || s1.msg, 任务2提交同一笔记: s2.data || s2.msg, 裁决: v.map((x) => x.data || x.msg), 奖励前: b0, 奖励后: await bean.balance(u.id) }
})

await probe('T13', '推广：自买返佣；归因首触 vs 末次；计佣基数', async () => {
  const p1 = await cLogin('t13p1'), p2 = await cLogin('t13p2'), buyer = await cLogin('t13b')
  await promo.register(p1.id, 1); await promo.register(p2.id, 1)
  const sc1 = await promo.createScene(p1.id, 'mini'), sc2 = await promo.createScene(p2.id, 'mini')
  const s = await mkSession(30, { price: 100000 })
  // 自买
  const self = await placePaid(p1.id, s, 1, 0, sc1)
  await q('UPDATE orders SET status=40, refund_deadline=NOW() WHERE order_no=?', [self])
  await jobs.completeOrder(self)
  const selfC = await one('SELECT promoter_id, base_amount, rate_bp, amount FROM commission WHERE order_id=(SELECT id FROM orders WHERE order_no=?)', [self])
  // 首触 p1，下单时带 p2
  await promo.hit(sc1, buyer.id); await giveBeans(buyer.id, 5000)
  const no = await placePaid(buyer.id, s, 1, 1000, sc2); await promo.hit(sc2, buyer.id)
  await q('UPDATE orders SET status=40, refund_deadline=NOW() WHERE order_no=?', [no])
  await jobs.completeOrder(no)
  const o = await order.byNo(no)
  const c = await one('SELECT promoter_id, base_amount, rate_bp, amount FROM commission WHERE order_id=?', [o.id])
  const hits = await q('SELECT scene FROM attribution_hit WHERE user_id=? ORDER BY id', [buyer.id])
  return { 推广员本人下单佣金: selfC, 本人ID: p1.id, 买家命中记录: hits, 订单归因: o.promo_scene, 佣金归属: c && c.promoter_id, p1: p1.id, p2: p2.id, 商品价: o.amount_goods, 旅豆抵扣分: o.amount_bean_ded, 实付: o.amount_pay, 佣金基数: c && c.base_amount, 费率bp: c && c.rate_bp, 佣金: c && c.amount }
})

await probe('T14', '推广客户列表：未支付/已关闭订单是否被当作成交', async () => {
  const p = await cLogin('t14p'), b = await cLogin('t14b'); await promo.register(p.id, 1); const sc = await promo.createScene(p.id, 'mini')
  await promo.hit(sc, b.id)
  const s = await mkSession(30); const r = await order.place({ userId: b.id, sessionId: s, qty: 1, wantedBeans: 0, promoScene: sc, withInsurance: false })
  const l = await call('GET', '/c/promote/customers', null, p.token)
  return { 接口返回: l.data, 前端判定: (l.data || []).map((x) => x.orderNo ? '已成交' : '仅到访'), 订单真实状态: (await order.byNo(r.orderNo)).status }
})

await probe('T17', '先用商户端后用游客端（同 unionid）：游客 openid 是否写入', async () => {
  const code = 'mock-aud-t17-' + stamp
  await call('POST', '/m/auth/login', { code })
  const a = await call('POST', '/c/auth/login', { code })
  const row = await one('SELECT mini_a_openid, mini_b_openid, unionid FROM user_account WHERE id=?', [a.data.user.id])
  const ba = await one('SELECT COUNT(*) c FROM bean_account WHERE user_id=?', [a.data.user.id])
  return { 用户行: row, 旅豆账户数: ba.c }
})

await probe('T19', '列表与首页数据：主题游列表是否混入商城；首页团期是否含下架商品', async () => {
  const all = await call('GET', '/c/tours?cat=all')
  const shopInAll = all.data.filter((t) => t.cat === 'shop').length
  const off = await one("SELECT id FROM tour_product WHERE cat <> 'shop' AND status=1 ORDER BY id DESC LIMIT 1")
  const sid = await mkSession(3, { productId: off.id })
  await q('UPDATE tour_product SET status=0 WHERE id=?', [off.id])
  const home = await call('GET', '/c/home')
  const hit = home.data.groups.filter((g) => Number(g.product_id) === Number(off.id)).length
  const det = await call('GET', '/c/tours/' + off.id)
  await q('UPDATE tour_product SET status=1 WHERE id=?', [off.id]); await q('DELETE FROM tour_session WHERE id=?', [sid])
  return { 主题游全部条数: all.data.length, 其中商城商品: shopInAll, 首页团期含下架商品条数: hit, 详情接口: det.msg, 列表项字段含bean: 'bean' in (all.data[0] || {}) }
})

await probe('T20', '订单时间线下发给游客的内容', async () => {
  const u = await cLogin('t20'); const s = await mkSession(30); const no = await placePaid(u.id, s)
  await call('POST', `/c/orders/${no}/refund`, { reason: '用户申请' }, u.token)
  const d = await call('GET', `/c/orders/${no}`, null, u.token)
  return { 时间线: d.data.events.map((e) => ({ to: e.to_st, actor: e.actor, detail: e.detail })) }
})

await probe('T22', '公开接口：匿名枚举结算单', async () => {
  const s = await one('SELECT id FROM settlement ORDER BY id LIMIT 1')
  if (!s) return { 无结算单: true }
  const r = await call('GET', '/open/verify/settlement/' + s.id)
  return { http: r.http, code: r.code, data: JSON.stringify(r.data).slice(0, 500) }
})

await probe('T23', '后台登录：连续错误密码是否限制', async () => {
  let wrong = 0
  for (let i = 0; i < 30; i++) { const r = await call('POST', '/admin/login', { username: 'admin', password: 'bad' + i }); if (r.code === 1002) wrong++ }
  const ok = await call('POST', '/admin/login', { username: 'admin', password: 'admin123' })
  return { 三十次错误中按普通错误返回: wrong, 随后正确密码登录: !!(ok.data && (ok.data.token || ok.data.mfaRequired)) }
})

await probe('T25', '提现审批并发：同一申请并发通过', async () => {
  const p = await cLogin('t25'); await promo.register(p.id, 1)
  const r = await q('INSERT INTO promoter_withdraw (promoter_id, amount, proposer_note) VALUES (?,?,?)', [p.id, 20000, 'aud'])
  const [a, b] = await Promise.all([
    call('POST', `/admin/withdrawals/${r.insertId}/verdict`, { pass: true, payRef: 'PAYREF-AAA111' }, A),
    call('POST', `/admin/withdrawals/${r.insertId}/verdict`, { pass: true, payRef: 'PAYREF-BBB222' }, A),
  ])
  const row = await one('SELECT status, pay_ref FROM promoter_withdraw WHERE id=?', [r.insertId])
  return { 并发结果: [a.data || a.msg, b.data || b.msg], 最终流水号: row.pay_ref }
})

await probe('T26', '退款连点：并发两次的结果与遗留数据', async () => {
  const u = await cLogin('t26'); const s = await mkSession(30); const no = await placePaid(u.id, s)
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/c/orders/${no}/refund`, { reason: 'x' }, u.token)))
  const o = await order.byNo(no); const rf = await q('SELECT refund_no, status, amount FROM refunds WHERE order_id=?', [o.id])
  const bk = await one('SELECT booked FROM tour_session WHERE id=?', [s])
  return { 响应: rs.map((r) => r.data ? 'ok' : r.msg), 订单状态: o.status, 退款单: rf, 已报: bk.booked }
})

await probe('T27', '评价连点：并发是否产生多条', async () => {
  const u = await cLogin('t27'); const s = await mkSession(30); const no = await placePaid(u.id, s)
  await q('UPDATE orders SET status=50 WHERE order_no=?', [no])
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/c/orders/${no}/review`, { rating: 5, content: '很好很好很好' }, u.token)))
  const c = await one('SELECT COUNT(*) c FROM review WHERE order_id=(SELECT id FROM orders WHERE order_no=?)', [no])
  return { 响应码: rs.map((r) => r.code), 评价条数: c.c }
})

await probe('T28', '下单入参：联系方式服务端校验', async () => {
  const u = await cLogin('t28'); const s = await mkSession(30)
  const noContact = await call('POST', '/c/orders', { sessionId: s, qty: 1 }, u.token)
  const badPhone = await call('POST', '/c/orders', { sessionId: s, qty: 1, contactName: 'x', contactPhone: 'abc' }, u.token)
  const longName = await call('POST', '/c/orders', { sessionId: s, qty: 1, contactName: 'x'.repeat(500), contactPhone: '13800000000' }, u.token)
  const longOrder = longName.code ? await one('SELECT status FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 1', [u.id]) : null
  const qtyS = await call('POST', '/c/orders', { sessionId: s, qty: '2' }, u.token)
  return { 不填联系人: noContact.data ? '下单成功' : noContact.msg, 乱填电话: badPhone.data ? '下单成功' : badPhone.msg, 超长姓名: longName.data ? '下单成功' : { code: longName.code, msg: longName.msg }, 超长失败后遗留订单: longOrder, 数量为字符串: qtyS.data ? '下单成功' : qtyS.msg }
})

await probe('T31', '核销日期：未到出发日 / 已过出发日的凭证', async () => {
  const u = await cLogin('t31'); const s = await mkSession(60); const no = await placePaid(u.id, s)
  const d = await call('GET', `/c/orders/${no}`, null, u.token)
  const code = await call('GET', `/c/pass/${d.data.passes[0].id}/code`, null, u.token)
  const r = await call('POST', '/m/verify/scan', { payload: code.data.qr }, M)
  const u2 = await cLogin('t31b'); const s2 = await mkSession(30); const no2 = await placePaid(u2.id, s2)
  await q('UPDATE tour_session SET depart_date = CURDATE() - INTERVAL 20 DAY WHERE id=?', [s2])
  const d2 = await call('GET', `/c/orders/${no2}`, null, u2.token)
  const c2 = await call('GET', `/c/pass/${d2.data.passes[0].id}/code`, null, u2.token)
  const q2 = await call('GET', `/c/orders/${no2}/refund-quote`, null, u2.token)
  const r2 = await call('POST', '/m/verify/scan', { payload: c2.data.qr }, M)
  const job = await one("SELECT COUNT(*) c FROM travel_pass WHERE valid_to IS NOT NULL")
  return { 出发前60天扫码: r.data, 已过期20天凭证扫码: r2.data, 过期未核销退款试算: q2.data && { allowed: q2.data.allowed, reason: q2.data.reason }, 设置了有效期的凭证数: job.c }
})

await probe('T33', '笔记：详情接口是否带内部机审字段；外链图片', async () => {
  const u = await cLogin('t33')
  const n = await call('POST', '/c/notes', { title: '<b>标题</b>', body: '<p>正文正文正文</p>', images: ['http://evil.example/a.png'], relatedProductId: 99999999 }, u.token)
  const d = n.data ? await call('GET', '/c/notes/' + n.data.id, null, u.token) : null
  const list = await call('GET', '/c/notes', null, u.token)
  return { 发布: n.data || { code: n.code, msg: n.msg }, 详情body: d && d.data && d.data.body, 关联不存在商品: d && d.data && d.data.related_product_id }
})

await probe('T35', '分润回单：直接访问与受控下载', async () => {
  const up = await call('POST', '/admin/co-profits/receipt-upload', { data: Buffer.from('x').toString('base64'), ext: 'png' }, A)
  const direct = up.data ? await fetch(BASE + up.data.url) : null
  return { 上传: up.data || up.msg, 直接访问http: direct && direct.status }
})

await probe('T36', '返豆承诺 vs 实际到账', async () => {
  const u = await cLogin('t36'); await giveBeans(u.id, 2000); const b = await bean.balance(u.id)
  const s = await mkSession(30, { price: 100000 })
  await q('UPDATE tour_product SET bean_gift = 999 WHERE id=?', [baseProd.id])
  const det = await call('GET', '/c/tours/' + baseProd.id)
  const no = await placePaid(u.id, s, 1, 1000)
  await q('UPDATE orders SET status=40, refund_deadline=NOW() WHERE order_no=?', [no])
  await jobs.completeOrder(no)
  const led = await one("SELECT l.amount FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_type=1 AND l.direction=1 AND l.biz_ref=?", [u.id, no])
  return { 详情页承诺: det.data.beanGift, 实付: (await order.byNo(no)).amount_pay, 实际到账: led && led.amount }
})

await probe('T38', '核销员角色：底部标签对应接口', async () => {
  const u = await cLogin('t38'); await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,1)', [baseProd.merchant_id, u.id])
  const t = (await call('POST', '/m/auth/login', { code: u.code, merchantId: Number(baseProd.merchant_id) })).data.token
  const r = {}
  for (const p of ['/m/orders', '/m/supply', '/m/stats', '/m/settlements', '/m/verify/records', '/m/workbench']) { const x = await call('GET', p, null, t); r[p] = x.code === 0 ? 'ok' : x.msg }
  const off = await call('GET', '/m/verify/offline-list', null, t)
  r['离线名单给核销员'] = off.data ? { 凭证: off.data.passes.length, 码数: Object.keys(off.data.codes).length, 字段: Object.keys(off.data.passes[0] || {}) } : off.msg
  return r
})

await probe('T41', '头像地址：接口返回值', async () => {
  const u = await cLogin('t41')
  const up = await call('POST', '/c/upload/avatar', { data: Buffer.from('notanimage').toString('base64'), ext: 'png' }, u.token)
  await call('POST', '/c/me/profile', { avatarUrl: up.data.url }, u.token)
  const me = await call('GET', '/c/me', null, u.token)
  return { 上传返回: up.data, c_me返回: me.data.avatarUrl, 非图片内容被接受: up.code === 0 }
})

await probe('T45', '被关闭后才到账的支付：是否留痕', async () => {
  const u = await cLogin('t45'); const s = await mkSession(30)
  const r = await order.place({ userId: u.id, sessionId: s, qty: 1, wantedBeans: 0, withInsurance: false })
  await call('POST', `/c/orders/${r.orderNo}/refund`, {}, u.token)
  const before = await one('SELECT COUNT(*) c FROM risk_event')
  let err = null; try { await order.acceptPayment(r.orderNo, 'LATE' + r.orderNo, false) } catch (e) { err = e.message }
  const o = await order.byNo(r.orderNo); const pay = await one('SELECT COUNT(*) c FROM payment WHERE order_id=?', [o.id])
  return { 回调结果: err, 订单状态: o.status, 支付记录: pay.c, 风险事件增量: Number((await one('SELECT COUNT(*) c FROM risk_event')).c) - Number(before.c) }
})

await probe('T48', '轮播跳转：链接值与跳转方式', async () => {
  const rows = await q('SELECT id, title, link FROM banner WHERE status = 1 LIMIT 10')
  return { 轮播: rows }
})

await probe('T50', '商户申请：驳回路径', async () => {
  const code = 'mock-aud-t50-' + stamp
  const t = (await call('POST', '/m/auth/login', { code })).data.token
  const a = await call('POST', '/m/apply', { name: '审计门店' + stamp, contact: '王', mobile: '13800000001' }, t)
  const dup = await call('POST', '/m/apply', { name: '审计门店2' + stamp, contact: '王', mobile: '13800000001' }, t)
  const list = await call('GET', '/m/applications', null, t)
  return { 申请: a.data || a.msg, 重复: dup.msg, 列表: list.data }
})

fs.writeFileSync('./probes-' + (process.env.ONLY ? 'b' : 'a') + '.json', JSON.stringify(results, (k, v) => typeof v === 'bigint' ? Number(v) : v, 1))
await closeDb()
process.exit(0)
