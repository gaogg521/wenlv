import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/partners.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const token = (role, scopeCity) => jwtSign({ end: 'admin', role, scopeCity })
const call = async (path, auth = token('super')) => (await fetch(base + path, { headers: { authorization: 'Bearer ' + auth } })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name) }
let coId
try {
  const product = await one('SELECT id FROM tour_product LIMIT 1')
  const insert = await q("INSERT INTO co_creator(product_id,co_no,name,mobile,role,invest_amount,share_pct) VALUES (?,?,'画像测试共创','13812345678',1,100000,500)", [product.id, 'PC' + Date.now()])
  coId = insert.insertId
  await q("INSERT INTO co_profit(settlement_id,co_creator_id,product_id,period,base_amount,amount,status,paid_amount) VALUES (999999,?,?,'2026-W44',10000,5000,1,5000),(999998,?,?,'2026-W45',10000,3000,0,0)", [coId, product.id, coId, product.id])
  await test('统一列表、分类、搜索及统计一致', async () => {
    const all = ok(await call('/admin/partners'))
    assert.equal(all.total, all.counts.reduce((s, r) => s + Number(r.n), 0))
    for (const kind of ['city','promoter','cocreator']) {
      const list = ok(await call('/admin/partners?kind=' + kind))
      assert.ok(list.rows.length > 0, kind)
      assert.ok(list.rows.every(r => r.kind === kind))
    }
    const search = ok(await call('/admin/partners?kw=' + encodeURIComponent('画像测试共创')))
    assert.equal(search.total, 1); assert.equal(search.rows[0].id, coId)
    assert.equal((await call('/admin/partners?kind=invalid')).code, 1001)
    assert.equal(ok(await call('/admin/partners?page=99999')).rows.length, 0)
  })
  await test('同名共创登记不合并；分页无重复且总数稳定', async () => {
    const prefix = 'PG' + Date.now()
    try {
      const values = Array.from({ length: 31 }, (_, i) => [product.id, prefix + i, prefix, '13812345678', 1])
      await q('INSERT INTO co_creator(product_id,co_no,name,mobile,role) VALUES ?', [values])
      const first = ok(await call('/admin/partners?kw=' + prefix))
      const second = ok(await call('/admin/partners?kw=' + prefix + '&page=2'))
      assert.equal(first.total, 31); assert.equal(second.total, 31)
      assert.equal(first.rows.length, 30); assert.equal(second.rows.length, 1)
      assert.equal(new Set([...first.rows, ...second.rows].map(x => x.id)).size, 31)
    } finally { await q('DELETE FROM co_creator WHERE name=?', [prefix]) }
  })
  await test('城市画像的订单金额与商户数均来自本城', async () => {
    const city = ok(await call('/admin/partners?kind=city')).rows[0]
    const p = ok(await call(`/admin/partners/city/${city.id}`))
    const expected = await one('SELECT COUNT(*) orders, COALESCE(SUM(amount_pay),0) gmv FROM orders WHERE city_code=? AND status IN (20,30,40,50)', [city.city_code])
    assert.equal(Number(p.kpi.gmv), Number(expected.gmv)); assert.equal(Number(p.kpi.orders), Number(expected.orders))
    assert.equal(Number(p.merchants.total), Number((await one('SELECT COUNT(*) n FROM merchant WHERE city_code=?', [city.city_code])).n))
  })
  await test('推广画像按计佣订单统计，佣金状态不混算', async () => {
    const row = ok(await call('/admin/partners?kind=promoter')).rows[0]
    const p = ok(await call('/admin/partners/promoter/' + row.id))
    const c = await one('SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount FROM commission WHERE promoter_id=?', [row.id])
    assert.equal(p.commissions.reduce((s, x) => s + Number(x.n), 0), Number(c.n))
    assert.equal(p.commissions.reduce((s, x) => s + Number(x.amount), 0), Number(c.amount))
    assert.ok(p.hits.users >= 0 && p.trade.buyers >= 0)
  })
  await test('共创已付/待付分开，回款比例及手机号脱敏', async () => {
    const p = ok(await call('/admin/partners/cocreator/' + coId))
    assert.equal(p.paid, 5000); assert.equal(p.returnRate, 0.05)
    assert.equal(Number(p.profits.find(x => x.status === 0).amount), 3000)
    assert.equal(p.co.mobile, '138****5678'); assert.ok(!JSON.stringify(p).includes('13812345678'))
    await q('UPDATE co_creator SET invest_amount=0 WHERE id=?', [coId])
    assert.equal(ok(await call('/admin/partners/cocreator/' + coId)).returnRate, null)
  })
  await test('城市账号列表、计数、详情禁止跨城和全局资金画像', async () => {
    const auth = token('city_partner', '310118')
    const l = ok(await call('/admin/partners', auth))
    assert.ok(l.rows.length); assert.ok(l.rows.every(x => x.kind === 'city' && x.city_code === '310118'))
    assert.equal(ok(await call('/admin/partners?kind=promoter', auth)).total, 0)
    assert.equal((await call('/admin/partners/cocreator/' + coId, auth)).code, 1003)
    const city = l.rows[0]
    assert.equal((await call('/admin/partners/city/' + city.id, token('city_partner', '000000'))).code, 1004)
    assert.equal((await call('/admin/partners', token('city_partner'))).code, 1003)
  })
  await test('角色权限与缺失主体处理', async () => {
    for (const role of ['ops','finance']) ok(await call('/admin/partners', token(role)))
    for (const role of ['review','risk','readonly']) assert.equal((await call('/admin/partners', token(role))).code, 1003)
    assert.equal((await call('/admin/partners/city/999999999')).code, 1004)
    assert.equal((await call('/admin/partners', 'invalid')).code, 1002)
  })
} finally {
  if (coId) { await q('DELETE FROM co_profit WHERE co_creator_id=?', [coId]); await q('DELETE FROM co_creator WHERE id=?', [coId]) }
  await closeDb()
}
console.log(`${passed} 项合伙人中心验证通过`)
