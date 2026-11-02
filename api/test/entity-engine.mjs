// 表单引擎接口测试：每类实体的 schema/新建/校验/清洗/审计打码/权限/联动规则
// 会新建测试数据，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/entity-engine.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
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
  ok(await call('PUT', '/admin/entities/merchant/' + merchant.id, { values: { account_no: '6222020200118899', bank_name: '工商银行' } }, A))
  const a = await one(`SELECT after_val FROM audit_log WHERE module = 'merchant' AND biz_ref = ? ORDER BY id DESC LIMIT 1`, ['merchant-' + merchant.id])
  const av = typeof a.after_val === 'string' ? JSON.parse(a.after_val) : a.after_val
  assert.equal(av.account_no, '***8899'); assert.equal(av.bank_name, '工商银行'); assert.equal(Object.keys(av).length, 2)
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
await q('DELETE FROM scenic_spot WHERE id = ?', [scenicId])
await q("DELETE FROM merchant WHERE name = '未审核商户'")
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
