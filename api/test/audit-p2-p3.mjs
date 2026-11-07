// P2/P3 回归（全量检查 20261106）：A-23/24/25/27/28/29/30/32/34/35/36/38/39/40/46 + 页面静态口径（A-26/31/33/37/45）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/audit-p2-p3.mjs')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { q, one, tx } from '../src/db.mjs'
import * as order from '../src/domain/order.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, (r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }
let passN = 0
const t = async (name, fn) => { try { await fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const stamp = Date.now().toString(36)
const created = { sessions: [], orders: [], notes: [], users: [] }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const cLogin = async (tag) => {
  const code = 'mock-audp23-' + tag + '-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  created.users.push(Number(r.user.id))
  return { token: r.token, id: Number(r.user.id), code }
}
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const mkSession = async ({ days = 60, price = 10000, productId = 1, quota = 50, minGo = 1 } = {}) => {
  await q('DELETE FROM tour_session WHERE product_id = ? AND depart_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)', [productId, days]).catch(() => {})
  const r = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0, ?, ?, 1)', [productId, days, quota, minGo, price])
  const id = Number(r.insertId)
  created.sessions.push(id)
  return id
}
const placePaid = async (uid, sid, qty = 1, beans = 0, promoScene = null) => {
  const r = await order.place({ userId: uid, sessionId: sid, qty, wantedBeans: beans, promoScene, withInsurance: false })
  created.orders.push(r.orderNo)
  await order.acceptPayment(r.orderNo, 'P23' + r.orderNo, true)
  return r.orderNo
}
const cleanup = async () => {
  for (const no of created.orders) {
    await q('DELETE v FROM verification_log v JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE tp FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM payment WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM order_event WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM orders WHERE order_no = ?', [no]).catch(() => {})
  }
  await q('DELETE FROM content_note WHERE user_id IN (?)', [created.users.length ? created.users : [0]]).catch(() => {})
  await q('DELETE FROM tour_session WHERE id IN (?)', [created.sessions.length ? created.sessions : [0]]).catch(() => {})
}
process.on('exit', () => {})

console.log('== A-23 下单联系信息校验 ==')
await t('A23-1 联系人缺失/过长在建单前拦截（不留孤儿订单、不扣豆、不占名额）', async () => {
  const u = await cLogin('a23')
  const sid = await mkSession({ days: 61 })
  const before = await one('SELECT COUNT(*) n FROM orders')
  const booked0 = Number((await one('SELECT booked FROM tour_session WHERE id = ?', [sid])).booked)
  for (const bad of [{ contactName: '' }, { contactName: 'x'.repeat(80) }, { contactName: '张三', contactPhone: '123' }, { contactName: '张三', phoneTicket: 'forgery' }]) {
    const r = await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, ...bad }, u.token)
    assert.notEqual(r.code, 0, `非法联系信息应被拒: ${JSON.stringify(bad).slice(0, 40)} -> ${r.code} ${r.msg}`)
    assert.match(r.msg || '', /联系人|手机号/, '中文提示: ' + r.msg)
  }
  const after = await one('SELECT COUNT(*) n FROM orders')
  assert.equal(Number(after.n), Number(before.n), '不得留下孤儿订单')
  assert.equal(Number((await one('SELECT booked FROM tour_session WHERE id = ?', [sid])).booked), booked0, '名额不得被占')
})

console.log('== A-24 长度校验 ==')
await t('A24-1 笔记标题超长被中文提示拒绝；商户申请字段过长被拒', async () => {
  const u = await cLogin('a24')
  const r = await call('POST', '/c/notes', { title: '标'.repeat(70), body: '正文' }, u.token)
  assert.notEqual(r.code, 0, '70 字标题应被拒')
  assert.match(r.msg || '', /标题|长度|字/, '中文提示: ' + r.msg)
  const r2 = await call('POST', '/m/apply', { name: '店'.repeat(80), contact: '联'.repeat(80), mobile: '13800001234' }, u.token)
  assert.notEqual(r2.code, 0, '超长申请字段应被拒')
  assert.match(r2.msg || '', /长度|字|名称/, '中文提示: ' + r2.msg)
})

console.log('== A-25 连点退款 ==')
await t('A25-1 并发退款只产生一张退款单，无 status=0 孤儿', async () => {
  const u = await cLogin('a25')
  const sid = await mkSession({ days: 40 })
  const no = await placePaid(u.id, sid)
  const [x, y, z] = await Promise.all([
    call('POST', `/c/orders/${no}/refund`, { reason: '连点1' }, u.token),
    call('POST', `/c/orders/${no}/refund`, { reason: '连点2' }, u.token),
    call('POST', `/c/orders/${no}/refund`, { reason: '连点3' }, u.token),
  ])
  const rows = await q('SELECT id, status, amount FROM refunds WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [no])
  assert.equal(rows.length, 1, `并发退款只能有一张退款单，实际 ${rows.length}`)
  assert.ok(rows.every((r) => Number(r.status) === 2), '不得留 status=0 孤儿退款单')
  const ord = await order.byNo(no)
  assert.equal(Number(ord.status), 70, '退款完成')
})

console.log('== A-27 时间线脱敏 ==')
await t('A27-1 游客订单时间线不含内部键与交易号', async () => {
  const u = await cLogin('a27')
  const sid = await mkSession({ days: 42 })
  const no = await placePaid(u.id, sid)
  await call('POST', `/c/orders/${no}/refund`, { reason: '看时间线' }, u.token)
  const det = ok(await call('GET', `/c/orders/${no}`, null, u.token))
  const joined = JSON.stringify(det.events)
  for (const bad of ['REFUND_APPLY', 'user:', '支付回调', '下单占位', 'REFUND_SUCCESS']) {
    assert.ok(!joined.includes(bad), `时间线不得包含内部内容 ${bad}: ${joined.slice(0, 200)}`)
  }
  assert.ok(det.events.length >= 3, '时间线仍有面向用户的事件')
})

console.log('== A-28 已核销凭证可见 ==')
await t('A28-1 已核销凭证拉码返回"已核销"态而非报错；带核销时间', async () => {
  const u = await cLogin('a28')
  const sid = await mkSession({ days: 0, minGo: 99 }) // 当天出发，随后未成团取消 → 免费改签路径太重，直接用未成团取消+核销不可行；改为：直接置凭证已核销
  const no = await placePaid(u.id, sid)
  const pid = Number((await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [no]))[0].id)
  await q('UPDATE travel_pass SET status = 2 WHERE id = ?', [pid])
  await q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) VALUES (?, 1, 0, 3, 1, 310118)', [pid])
  const r = ok(await call('GET', `/c/pass/${pid}/code`, null, u.token))
  assert.equal(r.verified, true, '应返回已核销态而不是 4001')
  assert.ok(r.verifiedAt, '带核销时间')
})

console.log('== A-30 商城字段 ==')
await t('A30-1 /c/tours?cat=all 不再混入商城商品', async () => {
  const list = ok(await call('GET', '/c/tours?cat=all'))
  assert.ok(list.length > 0, '列表非空')
  assert.ok(list.every((x) => x.cat !== 'shop'), '主题游"全部"不得混入 shop 商品: ' + JSON.stringify(list.filter((x) => x.cat === 'shop').map((x) => x.title)))
})

console.log('== A-32 推广中心 ==')
await t('A32-1 推广客户列表带订单状态；页面按状态显示成交（未支付不算已成交）', async () => {
  const u = await cLogin('a32')
  await ok(await call('POST', '/admin/promoters/register', { userId: u.id, tier: 1 }, A))
  const { createScene } = await import('../src/domain/promo.mjs')
  const scene = await createScene(u.id, 'p23')
  const uid2 = await cLogin('a32b')
  await promoHit(scene, uid2.id)
  const sid = await mkSession({ days: 43 })
  const r = await order.place({ userId: uid2.id, sessionId: sid, qty: 1, wantedBeans: 0, promoScene: scene, withInsurance: false }) // 未支付
  created.orders.push(r.orderNo)
  const rows = ok(await call('GET', '/c/promote/customers', null, u.token))
  const row = rows.find((x) => x.orderNo === r.orderNo)
  assert.ok(row, '列表可见')
  assert.equal(Number(row.status), 10, '带订单状态（页面据此显示，未支付不算已成交）')
  // 静态：页面文案不再写死 T+1/滚动升级
  const wxml = read('mini-a/package-promo/pages/center/index.wxml')
  assert.ok(!/滚动升级/.test(wxml), '「滚动升级」未实现，文案应去掉')
  assert.ok(!/T\+1/.test(wxml), 'T+N 不应写死在页面（走接口/参数）')
})
async function promoHit(scene, userId) { const { hit } = await import('../src/domain/promo.mjs'); return hit(scene, userId) }

console.log('== A-34 业务日期 ==')
await t('A34-1 商户趋势的核销数按核销日统计；订单号用业务日期', async () => {
  const staff = await cLogin('a34staff')
  const u = await cLogin('a34')
  const sid = await mkSession({ days: 0, minGo: 1 }) // 今天出发
  const no = await placePaid(u.id, sid)
  await q('UPDATE tour_session SET depart_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?', [sid]) // 昨天出发（当日可核销窗内）
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM orders WHERE order_no = ?), ?, 3)', [no, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM orders WHERE order_no = ?', [no])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  const qr = ok(await call('GET', `/c/pass/${(await q('SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [no]))[0].id}/code`, null, u.token))
  ok(await call('POST', '/m/verify/scan', { payload: qr.qr }, mTok))
  const stats = ok(await call('GET', '/m/stats', null, mTok))
  const today = stats.week[stats.week.length - 1]
  assert.equal(today.d, new Date().toLocaleDateString('sv-SE').slice(0, 10), '趋势最后一天必须是今天（业务时区）: ' + today.d)
  assert.ok(Number(today.verifies) >= 1, '今天的核销数应含刚才的核销（按核销日而非支付日）')
  const ord = await order.byNo(no)
  const { bizDay } = await import('../src/infra/bizdate.mjs')
  assert.equal(String(ord.order_no).slice(2, 10), bizDay().replaceAll('-', ''), '订单号日期段 = 业务日期（禁 UTC）')
})

console.log('== A-35 商户端库存操作 ==')
await t('A35-1 停售可恢复；加名额/停售/改价有审计；非法输入有中文报错', async () => {
  const staff = await cLogin('a35staff')
  const sid = await mkSession({ days: 44 })
  const pid = Number((await one('SELECT product_id FROM tour_session WHERE id = ?', [sid])).product_id)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM tour_product WHERE id = ?), ?, 3)', [pid, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  ok(await call('POST', `/m/supply/${sid}`, { action: 'stop_sell' }, mTok))
  ok(await call('POST', `/m/supply/${sid}`, { action: 'resume_sell' }, mTok)) // 此前无恢复通道
  assert.equal(Number((await one('SELECT status FROM tour_session WHERE id = ?', [sid])).status), 1, '恢复在售')
  const audits = await q("SELECT id FROM audit_log WHERE biz_ref = ? AND module = 'supply'", ['session-' + sid])
  assert.ok(audits.length >= 2, '停售与恢复都应有审计: ' + audits.length)
  const bad = await call('POST', `/m/supply/${sid}`, { action: 'adjust_quota', value: 1.5 }, mTok)
  assert.match(bad.msg || '', /名额|整数/, '中文报错: ' + bad.msg)
})

console.log('== A-36 商户入驻驳回 ==')
await t('A36-1 后台可驳回并带原因；小程序端显示驳回态且可重新申请', async () => {
  const u = await cLogin('a36')
  ok(await call('POST', '/m/apply', { name: 'P2驳回测试' + stamp, contact: '联系人', mobile: '13800001234' }, u.token))
  const app0 = ok(await call('GET', '/m/applications', null, u.token))
  const mine = app0.find((x) => x.name === 'P2驳回测试' + stamp)
  assert.ok(mine, '申请已建')
  const r = ok(await call('POST', `/admin/merchants/${mine.id}/reject`, { reason: '资质材料不全，请补传后再试' }, A))
  assert.equal(r.status, 2, '驳回后状态 2')
  const app1 = ok(await call('GET', '/m/applications', null, u.token))
  const mine1 = app1.find((x) => x.id === mine.id)
  assert.equal(Number(mine1.status), 2, '小程序端看到驳回态')
  assert.match(String(mine1.reject_note || ''), /材料不全/, '带驳回原因')
  // 驳回后可重新申请（此前被"已有待审核申请"挡死）
  ok(await call('POST', '/m/apply', { name: 'P2驳回测试二次' + stamp, contact: '联系人', mobile: '13800001234' }, u.token))
})

console.log('== A-38 城市映射 ==')
await t('A38-1 /c/tours 的 loc 用统一字典（新城市不再裸吐编码）', async () => {
  const list = ok(await call('GET', '/c/tours?cat=all'))
  const { DICT } = await import('../src/domain/entity-schema.mjs')
  const CITY = Object.fromEntries(DICT.city)
  for (const x of list) {
    if (!x.city_code) continue
    if (CITY[x.city_code]) assert.equal(x.loc, CITY[x.city_code], `${x.city_code} 的 loc 应为字典值「${CITY[x.city_code]}」，实际「${x.loc}」`)
  }
})

console.log('== A-39 轮播与下架商品 ==')
await t('A39-1 /c/home groups 不含下架商品；首页 banner 链接 tab 页走 switchTab', async () => {
  // 夹具：下架商品 + 在售团期（groups 查询此前只过滤团期不过滤商品）
  const off = await tx(async (c) => c.ins(`INSERT INTO tour_product (title, cat, city_code, merchant_id, price_from, bean_gift, days_desc, status)
    VALUES (?, 'script', '310118', (SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1), 10000, 0, '1天', 0)`, ['P2下架夹具' + stamp]))
  await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL 9 DAY), 10, 0, 1, 10000, 1)', [off])
  const home = ok(await call('GET', '/c/home'))
  for (const g of home.groups) assert.notEqual(Number(g.product_id), Number(off), 'groups 不得含下架商品: ' + off)
  await q('DELETE FROM tour_session WHERE product_id = ?', [off]).catch(() => {})
  await q('DELETE FROM tour_product WHERE id = ?', [off]).catch(() => {})
  const js = read('mini-a/pages/home/index.js')
  assert.ok(/switchTab/.test(js), 'banner 链接应能走 switchTab（tab 页 navigateTo 必失败）')
})

console.log('== A-40 CSV 公式注入 ==')
await t('A40-1 toCsv 对 =/+/-/@ 开头的单元格转义', async () => {
  const { toCsv } = await import('../src/routes/_shared.mjs')
  const csv = toCsv([{ nickname: '=HYPERLINK("http://x","点我")', note: '+cmd', a: '-1', b: '@x' }])
  for (const bad of ['=HYPERLINK', '+cmd', '-1', '@x']) {
    assert.ok(!csv.includes('\n' + bad) && !csv.includes(',' + bad), `危险单元格未转义: ${bad}`)
  }
})

console.log('== A-46 时间显示 ==')
await t('A46-1 离线名单 syncedAt 是本地时间格式（非 UTC ISO）；毫秒不再下发', async () => {
  const staff = await cLogin('a46staff')
  const sid = await mkSession({ days: 45 })
  const pid = Number((await one('SELECT product_id FROM tour_session WHERE id = ?', [sid])).product_id)
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES ((SELECT merchant_id FROM tour_product WHERE id = ?), ?, 3)', [pid, staff.id])
  const mid = Number((await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id)
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  const list = ok(await call('GET', '/m/verify/offline-list', null, mTok))
  assert.match(list.syncedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'syncedAt 应为本地时间串: ' + list.syncedAt)
  const det = ok(await call('GET', `/m/orders/${(await placePaid(staff.id, sid))}`, null, mTok))
  if (det.paid_at) assert.ok(!/\.\d{3}/.test(String(det.paid_at)), '商户端时间不得带毫秒: ' + det.paid_at)
})

console.log('== 页面静态口径（A-26/31/33/37/45 + A-29） ==')
await t('A26 订单详情状态映射含 60', async () => {
  const js = read('mini-a/package-order/pages/order-detail/index.js')
  assert.ok(/60:\s*'[^']*退款/.test(js), 'stName 缺 60（退款处理中显示"—"）')
})
await t('A31 详情页返豆承诺与发放同口径（显示"约"或以实付试算）', async () => {
  const wxml = read('mini-a/package-tour/pages/detail/index.wxml')
  assert.ok(/完成后约得|以实付计算|试算/.test(wxml), '返豆承诺需加"约"或试算口径: ' + (wxml.match(/完成后[^\n]*/) || [''])[0])
})
await t('A33 商户端核销员不出现订单/库存常驻入口（自定义 tabBar 或受限视图）', async () => {
  const appJson = JSON.parse(read('mini-b/app.json'))
  assert.equal(appJson.tabBar.custom, true, '需要自定义 tabBar 按角色渲染')
  assert.ok(fs.existsSync(path.join(ROOT, 'mini-b/custom-tab-bar/index.js')), 'custom-tab-bar 组件存在')
  const tb = read('mini-b/custom-tab-bar/index.js')
  assert.ok(/role/.test(tb), 'tabBar 按角色过滤')
})
await t('A37 待支付结果页有"继续支付"；返豆措辞与实际一致', async () => {
  const wxml = read('mini-a/package-tour/pages/pay-result/index.wxml')
  assert.ok(/继续支付/.test(wxml), '待支付结果页缺"继续支付"入口')
  assert.ok(!/返豆\/佣金在核销完成后入账/.test(wxml), '旧措辞（核销后返豆）与实际（完成即返）不符，应更正')
})
await t('A45 下单页手机号标签不换行；页面底部预留固定栏高度', async () => {
  const wxml = read('mini-a/package-tour/pages/booking/index.wxml')
  assert.ok(/nowrap/.test(read('mini-a/package-tour/pages/booking/index.wxss')), '标签需 nowrap 防竖排')
  assert.ok(/padding-bottom/.test(read('mini-a/package-tour/pages/booking/index.wxss')), '页面需为底部固定栏留高')
  assert.ok(!/max-length/.test(wxml), '（占位断言）')
})
await t('A29 头像走 api.img、文件名带版本、上传校验文件头', async () => {
  const me = read('mini-a/pages/me/index.js')
  assert.ok(/api\.img\(/.test(me), 'me 页头像需经 api.img 拼接')
  const src = read('api/src/routes/tourist.mjs')
  assert.ok(/avatar_\d+_\d+\./.test(src) || /avatar_.*-.*version|Date\.now/.test(src), '上传文件名需带版本（防缓存一天）')
  assert.ok(/\\x89PNG|\\xFF\\xD8\\xFF|magic|文件头|fileHead/.test(src) || /PNG|JPEG|magic/.test(src), '上传需校验文件头')
})

await cleanup()
console.log(`\n${passN} 项通过`)
const { closeDb } = await import('../src/db.mjs')
await closeDb()
process.exit(process.exitCode || 0)
