// 表单引擎接口测试：每类实体的 schema/新建/校验/清洗/审计打码/权限/联动规则
// 会新建测试数据，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/entity-engine.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const login = async (u) => (await call('POST', '/admin/login', { username: u, password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).data.token
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }

const A = await login('admin'), FIN = await login('finance')
const merchant = await one('SELECT id FROM merchant WHERE status = 1 LIMIT 1')
const product = await one('SELECT id FROM tour_product LIMIT 1')
assert.ok(merchant && product, '需要演示数据（先跑 seed:scenario）')

console.log('== 表单引擎 ==')
await t('9 类实体 schema 可取，ref 选项已填充', async () => {
  for (const k of ['product', 'session', 'merchant', 'scenic', 'supplier', 'faq', 'banner', 'badge', 'promoter']) {
    const s = ok(await call('GET', '/admin/entity-schemas/' + k, null, A))
    const fs = s.sections.flatMap((x) => x.fields)
    assert.ok(fs.length >= 8, `${k} 字段过少：${fs.length}`)
    for (const f of fs.filter((x) => x.type === 'ref')) assert.ok(Array.isArray(f.options), `${k}.${f.k} 无选项`)
  }
})
await t('未知实体报错', async () => assert.equal((await call('GET', '/admin/entity-schemas/nope', null, A)).code, 1004))

let scenicId
await t('新建景区：必填缺失返回字段级错误', async () => {
  const r = await call('POST', '/admin/entities/scenic', { values: {} }, A)
  assert.equal(r.code, 1001); assert.ok(r.data.fieldErrors.name); assert.ok(r.data.fieldErrors.city_code)
})
await t('新建景区：子表金额按分存、按元读；标签去重；富文本清洗', async () => {
  const d = ok(await call('POST', '/admin/entities/scenic', { values: {
    name: '测试景区', city_code: '310118', alias: ['桥乡', '桥乡', '水乡'],
    tickets: [{ name: '成人票', price: '60.5', settle: 48 }, { name: '', price: '' }],
    intro: '<p onclick="x()">介绍<script>alert(1)</script><img src=x></p>', geo: '31.1, 121.05',
  } }, A))
  scenicId = d.id
  const raw = await one('SELECT profile FROM scenic_spot WHERE id = ?', [scenicId])
  const pf = typeof raw.profile === 'string' ? JSON.parse(raw.profile) : raw.profile
  assert.deepEqual(pf.alias, ['桥乡', '水乡'])
  assert.deepEqual(pf.tickets, [{ name: '成人票', price: 6050, settle: 4800 }], '空行被丢弃，金额存分')
  assert.equal(pf.intro, '<p>介绍<img src="#"></p>')
  assert.equal(pf.geo, '31.100000,121.050000')
  const v = ok(await call('GET', '/admin/entities/scenic/' + scenicId, null, A)).values
  assert.equal(v.tickets[0].price, 60.5)
})
await t('字段格式校验：电话/信用代码/坐标/颜色/日期/超长', async () => {
  const r = await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: {
    service_phone: '123', biz_license: 'abc', geo: '200,1', contract_end: '2026/1/1', short_name: 'x'.repeat(30),
  } }, A)
  assert.equal(r.code, 1001)
  for (const k of ['service_phone', 'biz_license', 'geo', 'contract_end', 'short_name']) assert.ok(r.data.fieldErrors[k], k)
})
await t('子表必填：行内缺必填项定位到行号', async () => {
  const r = await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: { business_hours: [{ days: '每天', open: '09:00' }] } }, A)
  assert.equal(r.code, 1001); assert.match(r.data.fieldErrors.business_hours, /第 1 行「打烊」/)
})
await t('敏感字段在审计中打码，只记变化字段', async () => {
  const acct = '62220202' + String(Date.now()).slice(-8) // 每次不同，保证产生变化与审计
  const bank = '工商银行' + (Date.now() % 1000)
  ok(await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: { account_no: acct, bank_name: bank } }, A))
  const a = await one(`SELECT after_val FROM audit_log WHERE module = 'merchant' AND biz_ref = ? ORDER BY id DESC LIMIT 1`, ['merchant-' + merchant.id])
  const av = typeof a.after_val === 'string' ? JSON.parse(a.after_val) : a.after_val
  assert.equal(av.account_no, '***' + acct.slice(-4)); assert.equal(av.bank_name, bank); assert.equal(Object.keys(av).length, 2)
})
await t('权限：财务账号不能编辑商户资料', async () => assert.equal((await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: { short_name: 'x' } }, FIN)).code, 1003))
await t('商品：只能选已审核商户；行程子表保存', async () => {
  const pend = await q(`INSERT INTO merchant (city_code, name, kind, merchant_no, status) VALUES ('310118','未审核商户','other','MTEST${Date.now() % 100000}',0)`)
  const r = await call('PUT', '/admin/entities/product/' + product.id, { values: { merchant_id: pend.insertId } }, A)
  assert.equal(r.code, 1001); assert.ok(r.data.fieldErrors.merchant_id)
  ok(await call('PUT', '/admin/entities/product/' + product.id, { values: { itinerary: [{ time: 'D1 09:00', title: '集合', desc: '领取剧本' }], tags: ['小团'], suitable: ['family'] } }, A))
  const tour = (await call('GET', '/c/tours/' + product.id)).data || (await one('SELECT profile FROM tour_product WHERE id = ?', [product.id]))
  const pf = typeof tour.profile === 'string' ? JSON.parse(tour.profile) : tour.profile
  assert.equal(pf.itinerary[0].title, '集合')
})
await t('商品：rich_desc 内的键原位更新，不破坏其他键', async () => {
  const before = await one('SELECT rich_desc FROM tour_product WHERE id = ?', [product.id])
  const b = typeof before.rich_desc === 'string' ? JSON.parse(before.rich_desc) : before.rich_desc
  ok(await call('PUT', '/admin/entities/product/' + product.id, { values: { excludes: ['往返交通'] } }, A))
  const after = await one('SELECT rich_desc FROM tour_product WHERE id = ?', [product.id])
  const a = typeof after.rich_desc === 'string' ? JSON.parse(after.rich_desc) : after.rich_desc
  assert.deepEqual(a.excludes, ['往返交通']); assert.equal(a.intro, b.intro); assert.deepEqual(a.includes, b.includes)
})
await t('团期：早鸟价须低于成人价；名额不得少于已报名', async () => {
  const r = await call('POST', '/admin/entities/session', { parentId: product.id, values: { depart_date: bizDay(30), quota: 20, price_adult: 100, early_price: 120 } }, A)
  assert.ok(r.data.fieldErrors.early_price)
  const s = ok(await call('POST', '/admin/entities/session', { parentId: product.id, values: { depart_date: bizDay(31), quota: 20, price_adult: 100, early_price: 80, early_days: 7, leader_name: '小周' } }, A))
  await q('UPDATE tour_session SET booked = 5 WHERE id = ?', [s.id])
  const r2 = await call('PUT', '/admin/entities/session/' + s.id, { values: { quota: 3 } }, A)
  assert.ok(r2.data.fieldErrors.quota)
  await q('UPDATE tour_session SET booked = 0 WHERE id = ?', [s.id]); await q('DELETE FROM tour_session WHERE id = ?', [s.id])
})
await t('轮播：选择线路自动生成跳转路径；结束不得早于开始', async () => {
  const bad = await call('POST', '/admin/entities/banner', { values: { title: 't', image: '/uploads/a.png', start_at: '2026-12-02T10:00', end_at: '2026-12-01T10:00' } }, A)
  assert.ok(bad.data.fieldErrors.end_at)
  const d = ok(await call('POST', '/admin/entities/banner', { values: { title: '测试轮播', image: '/uploads/a.png', link_type: 'product', link_product: product.id } }, A))
  assert.equal((await one('SELECT link FROM banner WHERE id = ?', [d.id])).link, '/package-tour/pages/detail/index?id=' + product.id)
  await q('DELETE FROM banner WHERE id = ?', [d.id])
})
await t('图片字段只接受上传地址', async () => {
  const r = await call('POST', '/admin/entities/banner', { values: { title: 't', image: 'javascript:alert(1)' } }, A)
  assert.ok(r.data.fieldErrors.image)
})
await t('推广服务商：调档自动同步参数中心费率', async () => {
  const p = await one('SELECT user_id, tier FROM promoter LIMIT 1')
  ok(await call('PUT', '/admin/entities/promoter/' + p.user_id, { values: { real_name: '陈姐', mobile: '13800001111', tier: '2' } }, A))
  const rv = (await one("SELECT v FROM rule_config WHERE k = 'promoter.rate_bp'")).v
  const rates = typeof rv === 'string' ? JSON.parse(rv) : rv
  assert.equal(Number((await one('SELECT rate_bp FROM promoter WHERE user_id = ?', [p.user_id])).rate_bp), Number(rates[1]))
  ok(await call('PUT', '/admin/entities/promoter/' + p.user_id, { values: { tier: String(p.tier) } }, A))
})
await t('FAQ 答案为富文本，游客接口返回分类与热门', async () => {
  const d = ok(await call('POST', '/admin/entities/faq', { values: { question: '测试问？', answer: '<p><b>答</b></p>' } }, A))
  const f = await one('SELECT answer, category, status FROM faq WHERE id = ?', [d.id])
  assert.equal(f.answer, '<p><b>答</b></p>'); assert.equal(f.category, '通用'); assert.equal(Number(f.status), 1)
  await q('DELETE FROM faq WHERE id = ?', [d.id])
})
await t('推广服务商不支持在引擎内新建（需走开通流程）', async () => assert.equal((await call('POST', '/admin/entities/promoter', { values: {} }, A)).code, 1003))

console.log('== 第二批：预算 / 共创 / 约稿 / 暗号 / 逐品佣金 ==')
await t('旅豆预算：总额不得低于已发放、不得超过年度哨兵；结束不得早于开始', async () => {
  const d = ok(await call('POST', '/admin/entities/budget', { values: { name: '测试批次', total: 1000, biz_owner: 'content', channels: ['task'], period_start: '2026-12-01', period_end: '2026-12-31' } }, FIN))
  await q('UPDATE bean_budget SET granted = 600 WHERE id = ?', [d.id])
  assert.ok((await call('PUT', '/admin/entities/budget/' + d.id, { values: { total: 500 } }, FIN)).data.fieldErrors.total)
  assert.ok((await call('PUT', '/admin/entities/budget/' + d.id, { values: { total: 999999999 } }, FIN)).data.fieldErrors.total)
  assert.ok((await call('PUT', '/admin/entities/budget/' + d.id, { values: { period_end: '2026-11-01' } }, FIN)).data.fieldErrors.period_end)
  ok(await call('PUT', '/admin/entities/budget/' + d.id, { values: { total: 800, approver: '周颖' } }, FIN))
  await q('UPDATE bean_budget SET granted = 0 WHERE id = ?', [d.id]); await q('DELETE FROM bean_budget WHERE id = ?', [d.id])
})
await t('旅豆预算：运营账号无权编辑（财务/超管专属）', async () => {
  const OPS = await login('ops')
  assert.equal((await call('POST', '/admin/entities/budget', { values: { name: 'x', total: 1 } }, OPS)).code, 1003)
})
await t('共创人：分润按百分比填、按 bp 存，超过 50% 拒绝；编号自动生成', async () => {
  assert.ok((await call('POST', '/admin/entities/cocreator', { values: { name: '甲', mobile: '13800003333', role: '1', product_id: product.id, share_pct: 60 } }, A)).data.fieldErrors.share_pct)
  const d = ok(await call('POST', '/admin/entities/cocreator', { values: { name: '甲', mobile: '13800003333', role: '1', product_id: product.id, share_pct: 8.5, invest_amount: 10000, account_no: '6222000011112222' } }, A))
  const r = await one('SELECT share_pct, invest_amount, co_no FROM co_creator WHERE id = ?', [d.id])
  assert.equal(Number(r.share_pct), 850); assert.equal(Number(r.invest_amount), 1000000); assert.match(r.co_no, /^C\d{8}/)
  assert.equal(ok(await call('GET', '/admin/entities/cocreator/' + d.id, null, A)).values.share_pct, 8.5)
  await q('DELETE FROM co_creator WHERE id = ?', [d.id])
})
await t('约稿任务：标签存逗号串、读回数组；有人领取后仍可编辑，但名额不能少于已领取人数', async () => {
  const d = ok(await call('POST', '/admin/entities/task', { values: { title: '测试约稿', brief: '写一篇游记', tags: ['古镇', '剧本杀'], must_mention: ['集合点'], platforms: ['xhs'] } }, A))
  assert.equal((await one('SELECT tags FROM content_task WHERE id = ?', [d.id])).tags, '古镇,剧本杀')
  assert.deepEqual(ok(await call('GET', '/admin/entities/task/' + d.id, null, A)).values.tags, ['古镇', '剧本杀'])
  const users = await q('SELECT id FROM user_account ORDER BY id LIMIT 2')
  for (const u of users) await q('INSERT INTO content_task_entry (task_id, user_id, status) VALUES (?,?,1)', [d.id, u.id])
  ok(await call('PUT', '/admin/entities/task/' + d.id, { values: { title: '改标题' } }, A))
  const r = await call('PUT', '/admin/entities/task/' + d.id, { values: { max_participants: 1 } }, A)
  assert.equal(r.code, 1001); assert.ok(r.data.fieldErrors.max_participants)
  await q('DELETE FROM content_task_entry WHERE task_id = ?', [d.id])
  await q('DELETE FROM content_task WHERE id = ?', [d.id])
})
await t('暗号：上下半句须成对、不能相同；线路名称只读不被改写', async () => {
  assert.ok((await call('PUT', '/admin/entities/phrase/' + product.id, { values: { phrase_user: '上句', phrase_merchant: '' } }, A)).data.fieldErrors.phrase_merchant)
  assert.ok((await call('PUT', '/admin/entities/phrase/' + product.id, { values: { phrase_user: '同', phrase_merchant: '同' } }, A)).data.fieldErrors.phrase_merchant)
  const title = (await one('SELECT title FROM tour_product WHERE id = ?', [product.id])).title
  ok(await call('PUT', '/admin/entities/phrase/' + product.id, { values: { title: '被篡改', phrase_user: '放生桥边等船否', phrase_merchant: '漕港河里载秋来', phrase_alts: ['放生桥边等船吗'] } }, A))
  assert.equal((await one('SELECT title FROM tour_product WHERE id = ?', [product.id])).title, title)
})
await t('暗号核销：可接受变体与标点容错生效；过停用日期拒绝', async () => {
  const o = await one(`SELECT o.order_no, o.merchant_id, o.session_id FROM orders o WHERE o.product_id = ? AND o.status IN (20,30) LIMIT 1`, [product.id])
  if (!o) { console.log('    （无在途订单，跳过核销部分）'); return }
  const code = 'phrase-staff-' + Date.now()
  await call('POST', '/m/auth/login', { code })
  const u = await one('SELECT id FROM user_account WHERE mini_b_openid LIKE ?', ['%' + code])
  await q('INSERT INTO merchant_staff (merchant_id, role, status, user_id) VALUES (?,?,1,?)', [o.merchant_id, 1, u.id])
  const mt = ok(await call('POST', '/m/auth/login', { code, merchantId: o.merchant_id })).token
  // A-04：暗号只匹配当日可核销团期 —— 夹具团期拨到今天，结束后还原
  const prevDate = await one('SELECT depart_date FROM tour_session WHERE id = ?', [o.session_id])
  await q('UPDATE tour_session SET depart_date = CURDATE() WHERE id = ?', [o.session_id])
  try {
    await q(`UPDATE tour_product SET profile = JSON_SET(COALESCE(profile, '{}'), '$.phrase_end', '2000-01-01') WHERE id = ?`, [product.id])
    const stopped = ok(await call('POST', '/m/verify/phrase', { phrase: '放生桥边等船否', orderNo: o.order_no }, mt))
    assert.equal(stopped.ok, false); assert.match(stopped.reason, /停用/)
    await q(`UPDATE tour_product SET profile = JSON_REMOVE(profile, '$.phrase_end') WHERE id = ?`, [product.id])
    const wrong = ok(await call('POST', '/m/verify/phrase', { phrase: '随便说说', orderNo: o.order_no }, mt))
    assert.equal(wrong.ok, false)
    const alt = ok(await call('POST', '/m/verify/phrase', { phrase: '放生桥边，等船吗？', orderNo: o.order_no }, mt))
    assert.equal(alt.ok, true, alt.reason)
  } finally {
    await q('UPDATE tour_session SET depart_date = ? WHERE id = ?', [prevDate.depart_date, o.session_id])
    await q('DELETE FROM merchant_staff WHERE user_id = ?', [u.id])
  }
})
await t('逐品佣金：费率 >12% 拒绝；必须填原因；百分比↔bp', async () => {
  assert.ok((await call('PUT', '/admin/entities/rateov/' + product.id, { values: { promo_rate_bp: 15, rate_reason: 'x' } }, A)).data.fieldErrors.promo_rate_bp)
  assert.ok((await call('PUT', '/admin/entities/rateov/' + product.id, { values: { promo_rate_bp: 9.5, rate_reason: '' } }, A)).data.fieldErrors.rate_reason)
  ok(await call('PUT', '/admin/entities/rateov/' + product.id, { values: { promo_rate_bp: 9.5, rate_reason: '新品冷启动', rate_end: '2000-01-01' } }, A))
  assert.equal(Number((await one('SELECT promo_rate_bp FROM tour_product WHERE id = ?', [product.id])).promo_rate_bp), 950)
  const list = ok(await call('GET', '/admin/rate-overrides?pageSize=500', null, A))
  assert.equal(list.rows.find((x) => x.id === product.id).rate_reason, '新品冷启动')
  ok(await call('PUT', '/admin/entities/rateov/' + product.id, { values: { promo_rate_bp: '', rate_reason: '恢复档位', rate_end: '' } }, A))
  assert.equal((await one('SELECT promo_rate_bp FROM tour_product WHERE id = ?', [product.id])).promo_rate_bp, null)
})

console.log('== 小程序装修与用语 ==')
await t('小程序装修：公开接口无需登录即可取；旅豆数值来自参数中心', async () => {
  const site = (await (await fetch(BASE + '/c/site')).json()).data
  assert.ok(site.hero_title && Array.isArray(site.themes) && site.themes.length)
  assert.equal(site.beanRules.deductMaxPct, 10)
  assert.equal(site.merchant_notice, undefined, '商户端公告不给游客端')
})
await t('小程序可见字段拦截审核敏感词，并给出替换建议；后台专用字段不受限', async () => {
  const r = await call('PUT', '/admin/entities/site/1', { values: { hero_caption: '每一单都上链存证' } }, A)
  assert.equal(r.code, 1001); assert.match(r.data.fieldErrors.hero_caption, /敏感词「上链」|敏感词「存证」/)
  const r2 = await call('PUT', '/admin/entities/product/' + product.id, { values: { highlights: ['赠送数字藏品'] } }, A)
  assert.match(r2.data.fieldErrors.highlights, /藏品/)
  ok(await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: { remark: '内部：后续对接联盟链存证' } }, A))
})
await t('目的地名称来自装修配置', async () => {
  const orig = ok(await call('GET', '/admin/entities/site/1', null, A)).values.destinations
  ok(await call('PUT', '/admin/entities/site/1', { values: { destinations: [{ city: '310118', name: '朱家角·水乡', intro: '入戏一日' }] } }, A))
  const ct = (await (await fetch(BASE + '/c/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'mock-dest' }) })).json()).data.token
  const d = ok(await call('GET', '/c/destinations', null, ct))
  assert.equal(d.find((x) => x.city_code === '310118').cityName, '朱家角·水乡')
  ok(await call('PUT', '/admin/entities/site/1', { values: { destinations: orig } }, A))
})

await q('DELETE FROM scenic_spot WHERE id = ?', [scenicId])
await q("DELETE FROM merchant WHERE name = '未审核商户'")
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
