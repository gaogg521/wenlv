// 跨端界面层回归：在微信开发者工具模拟器里同时跑 A（游客）与 B（商户）两个小程序，读页面 data，
// 验证"后台/接口的数据真的显示在两端界面上，并且一端的动作会让另一端的界面变化"。
// 依赖（本机手动，不在 npm test 里）：
//   1) 隔离库 + 隔离服务（PORT 指向它），已 seed:scenario；
//   2) 把 mini-a、mini-b 复制到临时目录：app.js 里的 apiBase 换成隔离服务地址；mini-b 的 project.config.json 的 appid 换成 mini-a 的真实 appid
//      （touristappid 在 CLI 下会 APPID_ERROR，副本只在本机模拟器里看，不上传，仓库文件不动）；
//   3) cli auto --project <副本A> --auto-port 9421 与 cli auto --project <副本B> --auto-port 9422；
//   4) 本脚本：PORT=<隔离服务端口> DB_NAME=<隔离库> JWT_SECRET=<同服务> node test/automator-cross-end.mjs <截图目录>
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/automator-cross-end.mjs')
import automator from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { q, one } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + process.env.PORT
const OUT = process.argv[2] || './automator-shots-cross'; fs.mkdirSync(OUT, { recursive: true })
const api = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r, w = '') => { assert.equal(r.code, 0, w + ' ' + (r.msg || '')); return r.data }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', String(e.message).split('\n').slice(0, 5).join('\n     ')); process.exitCode = 1 } }
const stamp = Date.now().toString(36)
const A = ok(await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

// ---- 造数据（经接口）----
const sess = await one(`SELECT s.id, s.product_id, p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id
  WHERE p.status = 1 AND s.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 5 ORDER BY s.id LIMIT 1`)
const login = async (code) => ok(await api('POST', '/c/auth/login', { code }))
const buyer = await login('mock-ui-buyer-' + stamp), staffU = await login('mock-ui-staff-' + stamp)
await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [sess.merchant_id, staffU.user.id])
const B = ok(await api('POST', '/m/auth/login', { code: 'mock-ui-staff-' + stamp, merchantId: sess.merchant_id }))
const o = ok(await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0, contactName: '界面测试', contactPhone: '13911112222' }, buyer.token))
ok(await api('POST', '/admin/dev/mock-pay', { orderNo: o.orderNo }, A))
const bannerTitle = '界面轮播' + stamp, notice = '界面公告' + stamp
const bannerId = ok(await api('POST', '/admin/banners', { title: bannerTitle, image: '/uploads/x.png', sort: -999 }, A)).id
ok(await api('PUT', '/admin/entities/site/1', { values: { merchant_notice: notice } }, A))

const ma = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.AUTO_A || 9421) })
const mb = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.AUTO_B || 9422) })
await ma.callWxMethod('setStorageSync', 'token', buyer.token); await ma.evaluate((x) => { getApp().globalData.token = x }, buyer.token)
await mb.callWxMethod('setStorageSync', 'mtoken', B.token); await mb.callWxMethod('setStorageSync', 'merchant', B.merchant); await mb.callWxMethod('setStorageSync', 'mrole', B.role)
await mb.evaluate((x, m, r) => { const a = getApp(); a.globalData.token = x; a.globalData.merchant = m; a.globalData.role = r }, B.token, B.merchant, B.role)
// 页面刚出现时数据可能还在加载：轮询到 pred 成立或超时
const open = async (mini, path, pred, ms = 6000) => {
  const p = await mini.reLaunch(path); const t0 = Date.now()
  for (;;) { await sleep(400); const d = await p.data(); if (!pred || pred(d) || Date.now() - t0 > ms) return { p, d } }
}
const shot = (mini, name) => mini.screenshot({ path: OUT + '/' + name + '.png' }).catch(() => {})
const wbApi = async () => ok(await api('GET', '/m/workbench', null, B.token))

console.log('== 界面层：后台下发 → 两端界面显示 ==')
await t('A 首页：后台新增的轮播出现在界面数据里；线路卡数 = 接口返回的线路数', async () => {
  const { d } = await open(ma, '/pages/home/index', (x) => !x.loading)
  assert.ok((d.banners || []).some((b) => b.title === bannerTitle), 'A 首页没有显示后台新增的轮播')
  const ids = ok(await api('GET', '/c/tours', null, buyer.token)).map((x) => Number(x.id))
  assert.ok((d.tours || []).length > 0, 'A 首页没有线路卡'); assert.ok(d.tours.every((x) => ids.includes(Number(x.id))), 'A 首页显示了接口里没有的线路')
  await shot(ma, 'a-home')
})
await t('B 工作台：后台设置的商户端公告显示在界面上；今日订单 / 待核销 = 接口', async () => {
  const { d } = await open(mb, '/pages/index/index', (x) => x.wb)
  assert.equal(d.notice, notice)
  const w = await wbApi(); assert.equal(Number(d.wb.todayOrders), Number(w.todayOrders)); assert.equal(Number(d.wb.pendingVerify), Number(w.pendingVerify))
  await shot(mb, 'b-index')
})

console.log('\n== 界面层：同一笔订单两端一致，一端动作另一端界面变化 ==')
let pendingBefore
await t('A 订单详情与订单列表显示该单（待核销）；B 订单列表也有这一单；A 页面数据里没有内部字段', async () => {
  const a = (await open(ma, '/package-order/pages/order-detail/index?no=' + o.orderNo, (x) => x.o)).d
  assert.equal(a.o.order_no, o.orderNo); assert.equal(Number(a.o.status), 30)
  for (const k of ['user_id', 'merchant_id', 'settlement_id', 'contact_phone_enc', 'contact_phone_sealed', 'version']) assert.ok(!(k in a.o), 'A 页面数据含内部字段 ' + k)
  assert.ok(!JSON.stringify(a).includes('13911112222'), 'A 页面数据含完整手机号')
  await shot(ma, 'a-order-detail')
  const al = (await open(ma, '/package-order/pages/orders/index', (x) => !x.loading && x.orders)).d
  assert.ok(al.orders.some((x) => x.order_no === o.orderNo && Number(x.status) === 30))
  const bl = (await open(mb, '/pages/orders/index', (x) => x.loaded)).d
  assert.ok(bl.orders.some((x) => x.order_no === o.orderNo && Number(x.status) === 30))
  pendingBefore = Number((await wbApi()).pendingVerify)
})
await t('B 核销（走接口，相机扫码无法自动化）后：A 订单详情变"已核销"，B 订单列表变已核销，B 工作台待核销 -1 / 我的核销 +1', async () => {
  const pid = ok(await api('GET', '/c/orders/' + o.orderNo, null, buyer.token)).passes[0].id
  const code = ok(await api('GET', `/c/pass/${pid}/code`, null, buyer.token))
  assert.equal(ok(await api('POST', '/m/verify/scan', { payload: code.qr }, B.token)).ok, true)
  const a = (await open(ma, '/package-order/pages/order-detail/index?no=' + o.orderNo, (x) => x.o && Number(x.o.status) === 40)).d
  assert.equal(Number(a.o.status), 40); assert.equal(Number(a.passes[0].status), 2)
  assert.ok((await open(mb, '/pages/orders/index', (x) => x.orders && x.orders.some((y) => y.order_no === o.orderNo && Number(y.status) === 40))).d.orders.some((y) => y.order_no === o.orderNo && Number(y.status) === 40))
  const w = (await open(mb, '/pages/index/index', (x) => x.wb && Number(x.wb.pendingVerify) === pendingBefore - 1)).d.wb
  assert.equal(Number(w.pendingVerify), pendingBefore - 1); assert.equal(Number(w.myVerified), 1)
  await shot(ma, 'a-order-verified'); await shot(mb, 'b-index-verified')
})
await t('完成→返豆：A 旅豆页余额 = 接口余额；结算后 B 结算页显示后台同一张结算单的金额', async () => {
  ok(await api('POST', '/admin/dev/complete', { orderNo: o.orderNo }, A))
  const bal = ok(await api('GET', '/c/bean/account', null, buyer.token)).balance; assert.ok(bal > 0)
  const bean = (await open(ma, '/pages/bean/index', (x) => JSON.stringify(x).includes(String(bal)))).d
  assert.ok(JSON.stringify(bean).includes(String(bal)), 'A 旅豆页没有显示余额 ' + bal)
  await shot(ma, 'a-bean')
  const g = ok(await api('POST', '/admin/settlements/generate', { period: isoWeek(new Date()) }, A))
  const sid = (g.settlementIds || [])[0]; assert.ok(sid, '应生成结算单')
  const w = ok(await api('GET', '/admin/settlements', null, A)).find((s) => Number(s.id) === Number(sid))
  const bs = (await open(mb, '/pages/settlement/index', (x) => JSON.stringify(x).includes(w.period))).d
  const txt = JSON.stringify(bs); assert.ok(txt.includes(w.period), 'B 结算页没有这一期'); assert.ok(txt.includes(String(w.total_amount)) || txt.includes(String(Number(w.total_amount) / 100)), 'B 结算页金额与后台不一致')
  await shot(mb, 'b-settlement')
})
await t('后台撤回：删除轮播 → A 首页消失；改商户端公告 → B 工作台同步', async () => {
  ok(await api('POST', `/admin/banners/${bannerId}/delete`, {}, A))
  assert.ok(!((await open(ma, '/pages/home/index', (x) => !x.loading && !(x.banners || []).some((b) => b.title === bannerTitle))).d.banners || []).some((b) => b.title === bannerTitle))
  const n2 = '界面公告改' + stamp
  ok(await api('PUT', '/admin/entities/site/1', { values: { merchant_notice: n2 } }, A))
  assert.equal((await open(mb, '/pages/index/index', (x) => x.notice === n2)).d.notice, n2)
})

console.log('\n== 界面层：相机扫码 / 勋章弹窗 / 当前城市 / 举报申诉 ==')
// 说明：这个版本的开发者工具里，reLaunch 返回的页面对象等一会儿就会"No context"，page.callMethod 也不可靠。
// 所以读数据每次重新取当前页，操作用 evaluate 在服务层直接调用当前页的方法（等价于用户点击后触发的 handler）。
const cur = async (mini) => mini.currentPage()
const until = async (mini, pred, ms = 8000) => { const t0 = Date.now(); for (;;) { let d = {}; try { d = await (await cur(mini)).data() } catch { /* 页面切换中 */ } if (pred(d) || Date.now() - t0 > ms) return d; await sleep(300) } }
const callPage = (mini, method, data, ...args) => mini.evaluate((m, d, a) => { const p = getCurrentPages().slice(-1)[0]; if (d) p.setData(d); return p[m] ? (p[m](...a), 'called') : 'no method ' + m }, method, data || null, args)
const asBuyer = async (tok) => { await ma.callWxMethod('setStorageSync', 'token', tok); await ma.evaluate((x) => { getApp().globalData.token = x }, tok) }
const paid = async (tok) => {
  const od = ok(await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0 , contactName: '回归测试', contactPhone: '13800009999' }, tok))
  ok(await api('POST', '/admin/dev/mock-pay', { orderNo: od.orderNo }, A))
  const passId = ok(await api('GET', '/c/orders/' + od.orderNo, null, tok)).passes[0].id
  return { orderNo: od.orderNo, passId }
}
await t('B 核销页：mock 相机扫码并点击"打开相机扫码"→ 界面显示核销成功、连扫计数；A 订单变已核销；再用手动输 6 位码核销另一单', async () => {
  const x = await paid(buyer.token)
  const qr = ok(await api('GET', `/c/pass/${x.passId}/code`, null, buyer.token)).qr
  await mb.mockWxMethod('scanCode', { result: qr })
  await mb.reLaunch('/pages/verify/index'); await sleep(1500)
  let tapped = false
  for (const b of await (await cur(mb)).$$('.btn')) { if ((await b.text()).includes('打开相机扫码')) { await b.tap(); tapped = true; break } }
  assert.ok(tapped, '核销页应有"打开相机扫码"按钮')
  const d = await until(mb, (z) => z.result && z.result.ok)
  assert.equal(d.result.ok, true, '界面应显示核销成功'); assert.ok(d.streak >= 1, '连扫计数应 ≥ 1')
  await shot(mb, 'b-verify-scan')
  // 连续扫码模式会在 800ms 后重开相机：用一个无效的手动码结束连扫，并还原 mock
  await callPage(mb, 'submit', { input: '000000' }); await sleep(700); await mb.restoreWxMethod('scanCode')
  assert.equal(ok(await api('GET', '/c/orders/' + x.orderNo, null, buyer.token)).status, 40, 'A 订单应已核销')
  const y = await paid(buyer.token)
  const display = ok(await api('GET', `/c/pass/${y.passId}/code`, null, buyer.token)).display
  await callPage(mb, 'submit', { input: display })
  await until(mb, (z) => z.result && z.result.ok && z.lastQr === display)
  assert.equal(ok(await api('GET', '/c/orders/' + y.orderNo, null, buyer.token)).status, 40, '手动输码核销后 A 订单应已核销')
})
await t('A 订单页写评价：界面真的弹出"获得新勋章"；身份页显示勋章；后台勋章发放数 +1', async () => {
  const bname = '界面勋章' + stamp
  const dropBadges = async () => { await q("DELETE FROM user_badge WHERE badge_id IN (SELECT id FROM badge WHERE name LIKE '界面勋章%')").catch(() => {}); await q("DELETE FROM badge WHERE name LIKE '界面勋章%'").catch(() => {}) }
  await dropBadges() // 清掉历史运行残留的同名规则，否则一次评价会把它们全部触发
  ok(await api('POST', '/admin/entities/badge', { values: { name: bname, icon_key: 'ui' + stamp, rule_type: 'review', threshold: 1, rule_desc: '发表 1 条评价' } }, A))
  const u = await login('mock-ui-badge-' + stamp); const x = await paid(u.token)
  assert.equal(ok(await api('POST', '/m/verify/scan', { payload: ok(await api('GET', `/c/pass/${x.passId}/code`, null, u.token)).qr }, B.token)).ok, true)
  ok(await api('POST', '/admin/dev/complete', { orderNo: x.orderNo }, A))
  const g0 = ok(await api('GET', '/admin/web3/overview', null, A)).badgeGrants
  await asBuyer(u.token)
  await ma.evaluate(() => { getApp().globalData.__modal = null })
  await ma.mockWxMethod('showModal', function (opt) { getApp().globalData.__modal = opt; return { confirm: true } })
  await ma.reLaunch('/package-order/pages/order-detail/index?no=' + x.orderNo)
  await until(ma, (z) => z.o && Number(z.o.status) === 50)
  await callPage(ma, 'submitReview', { rating: 5, rvText: '界面回归的评价内容' })
  await until(ma, (z) => z.reviewDone === true)
  const modal = await ma.evaluate(() => getApp().globalData.__modal)
  await ma.restoreWxMethod('showModal')
  assert.ok(modal && modal.title === '获得新勋章' && String(modal.content).includes(bname), '界面应弹出新勋章：' + JSON.stringify(modal))
  assert.ok(ok(await api('GET', '/admin/web3/overview', null, A)).badgeGrants - g0 >= 1, '后台勋章发放数应增加')
  await ma.reLaunch('/package-content/pages/identity/index')
  const idp = await until(ma, (z) => JSON.stringify(z).includes(bname))
  assert.ok(JSON.stringify(idp).includes(bname), 'A 身份页应显示勋章')
  await shot(ma, 'a-identity-badge')
  await asBuyer(buyer.token); await dropBadges()
})
await t('A 当前城市：在目的地页选外城 → 首页记为当前城市，轮播按该城市投放（限定外城的显示、限定其他城市的不显示）', async () => {
  const mk = async (title, cities) => ok(await api('POST', '/admin/entities/banner', { values: { title, image: '/uploads/x.png', cities, sort: 0, status: '1' } }, A)).id
  const t330 = '界面外城轮播' + stamp, t310 = '界面本城轮播' + stamp
  const id330 = await mk(t330, ['330500']), id310 = await mk(t310, ['310118'])
  try {
    await ma.reLaunch('/pages/destination/index')
    await until(ma, (z) => !z.loading && (z.list || []).length)
    await callPage(ma, 'goList', null, { currentTarget: { dataset: { city: '330500' } } }); await sleep(1200)
    const hc = await ma.callWxMethod('getStorageSync', 'homeCity'); assert.equal((hc && hc.code) || (hc && hc.data && hc.data.code), '330500')
    await ma.reLaunch('/pages/home/index')
    const home = await until(ma, (z) => !z.loading && z.homeCity)
    assert.equal(home.homeCity.code, '330500')
    const titles = (home.banners || []).map((b) => b.title)
    assert.ok(titles.includes(t330), '首页应显示限定 330500 的轮播：' + titles); assert.ok(!titles.includes(t310), '首页不应显示只限定 310118 的轮播')
    await shot(ma, 'a-home-city')
  } finally {
    await ma.callWxMethod('removeStorageSync', 'homeCity')
    for (const id of [id330, id310]) await q('DELETE FROM banner WHERE id = ?', [id]).catch(() => {})
  }
})
await t('A 举报与申诉界面：读者在笔记页举报 → 后台下架 → 作者创作中心看到"已下架"并提交申诉 → 后台恢复 → 创作中心显示已发布', async () => {
  const author = await login('mock-ui-author-' + stamp), reader = await login('mock-ui-reader-' + stamp)
  const n = ok(await api('POST', '/c/notes', { title: '界面笔记' + stamp, body: '<p>旅行事实与体验正文</p>', relatedProductId: sess.product_id }, author.token))
  try {
    await asBuyer(reader.token)
    await ma.reLaunch('/package-content/pages/note/index?id=' + n.id)
    await until(ma, (z) => z.n)
    await callPage(ma, 'toggleReport'); await until(ma, (z) => z.reporting === true)
    await callPage(ma, 'submitReport', { reportReason: '涉嫌虚假宣传，请核实事实' })
    const nd = await until(ma, (z) => z.reporting === false && !z.reportBusy)
    assert.equal(nd.reporting, false, '提交举报后举报框应收起')
    const rp = (await q('SELECT id FROM content_report WHERE note_id = ? ORDER BY id DESC LIMIT 1', [n.id]))[0]; assert.ok(rp, '举报应已入库')
    ok(await api('POST', `/admin/content-cases/reports/${rp.id}/verdict`, { action: 'takedown', reason: '已核实相关内容事实并完成处理' }, A))
    await asBuyer(author.token)
    await ma.reLaunch('/package-content/pages/create/index')
    let d = await until(ma, (z) => (z.notes || []).some((x) => x.id === n.id && Number(x.status) === 4))
    const mine = d.notes.find((x) => x.id === n.id)
    assert.equal(mine.statusText, '已下架'); assert.ok(mine.offline_reason, '创作中心应显示下架原因')
    await shot(ma, 'a-create-offline')
    await callPage(ma, 'openAppeal', null, { currentTarget: { dataset: { id: n.id } } })
    await callPage(ma, 'submitAppeal', { appealReason: '内容为本人真实体验，请重新核实' })
    d = await until(ma, (z) => (z.notes || []).some((x) => x.id === n.id && x.appealText === '申诉复核中'))
    assert.equal(d.notes.find((x) => x.id === n.id).appealText, '申诉复核中', '申诉后创作中心应显示申诉复核中')
    const ap = (await q('SELECT id FROM content_appeal ORDER BY id DESC LIMIT 1'))[0]
    ok(await api('POST', `/admin/content-cases/appeals/${ap.id}/verdict`, { action: 'restore', reason: '已复核作品事实及相关依据' }, A))
    await ma.reLaunch('/package-content/pages/create/index')
    d = await until(ma, (z) => (z.notes || []).some((x) => x.id === n.id && Number(x.status) === 2))
    assert.equal(d.notes.find((x) => x.id === n.id).statusText, '已发布', '恢复后创作中心应显示已发布')
  } finally { await asBuyer(buyer.token); await q('DELETE FROM content_note WHERE id = ?', [n.id]).catch(() => {}) }
})

ma.disconnect(); mb.disconnect()
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day); const y = x.getUTCFullYear()
  return `${y}-W${String(Math.ceil(((x - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
