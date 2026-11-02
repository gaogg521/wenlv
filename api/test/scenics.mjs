import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/scenics.mjs')
import assert from 'node:assert/strict'
import { q, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { CONFIG_NAMES, DEFAULTS } from '../src/config.mjs'
const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const auth = (role = 'super', scopeCity) => jwtSign({ end: 'admin', role, scopeCity })
const get = async (path, token = auth()) => (await fetch(base + path, { headers: { authorization: 'Bearer ' + token } })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const ids = { scenic_spot: [], tour_product: [], orders: [], travel_pass: [] }
async function ins(table, sql, values) { const r = await q(sql, values); ids[table].push(r.insertId); return r.insertId }
const stamp = 'SC' + Date.now()
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name) }
try {
  const scenic = await ins('scenic_spot', 'INSERT INTO scenic_spot(city_code,name) VALUES (?,?)', ['310118', stamp])
  const empty = await ins('scenic_spot', 'INSERT INTO scenic_spot(city_code,name) VALUES (?,?)', ['310118', stamp + '空'])
  const other = await ins('scenic_spot', 'INSERT INTO scenic_spot(city_code,name) VALUES (?,?)', ['320508', stamp + '外城'])
  const product = async (city, title) => ins('tour_product', 'INSERT INTO tour_product(city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES (?,\'script\',?,10000,1,?,1)', [city, title, scenic])
  const p1 = await product('310118', stamp + '线路一'), p2 = await product('310118', stamp + '线路二'), p3 = await product('320508', stamp + '跨城线路')
  const order = async (p, status, qty, city = '310118') => ins('orders', 'INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status) VALUES (?,1,?,0,?,1,?,?,?,?)', [stamp + '-' + ids.orders.length, p, city, qty, qty * 10000, qty * 10000, status])
  const o1 = await order(p1,20,3), o2 = await order(p1,50,2), refunded = await order(p1,70,4)
  await order(p1,90,9)
  const wrongCity = await order(p1,30,8,'320508'), o3 = await order(p2,40,1), outside = await order(p3,50,7,'320508')
  const pass = async (o,p,results,kind=1,city='310118') => {
    const id = await ins('travel_pass', 'INSERT INTO travel_pass(user_id,order_id,kind,name,product_id,status) VALUES (1,?,?,?, ?,2)', [o, kind, stamp, p])
    for (const result of results) await q('INSERT INTO verification_log(pass_id,merchant_id,staff_id,method,result,city_code) VALUES (?,1,1,1,?,?)', [id, result,city])
  }
  await pass(o1,p1,[1,1,2]); await pass(o1,p1,[4]); await pass(o1,p1,[1],2)
  await pass(refunded,p1,[1]); await pass(o3,p2,[1]); await pass(wrongCity,p1,[1]); await pass(outside,p3,[1])
  await pass(o2,p1,[1],1,'320508')
  for (const [o,p,rating,status] of [[o1,p1,5,1],[o2,p1,1,1],[o3,p2,3,1],[refunded,p1,1,0],[wrongCity,p1,2,1],[outside,p3,5,1]]) await q('INSERT INTO review(order_id,user_id,product_id,rating,content,status) VALUES (?,1,?,?,?,?)', [o,p,rating,stamp,status])
  await test('scenic_id 聚合不重复，排除退款/关闭销量，评价按条加权', async () => {
    const p = ok(await get(`/admin/scenics/${scenic}/overview`))
    assert.equal(p.products.length,3); assert.equal(p.kpi.sold,21); assert.equal(p.kpi.gmv,210000)
    assert.equal(p.kpi.reviews,5); assert.ok(Math.abs(p.kpi.rating-3.2)<0.001)
    assert.equal(p.daily.reduce((s,x)=>s+Number(x.n),0),21)
  })
  await test('核销按成功服务凭证去重，排除失败/重复/非服务权益，保留退款前历史到访', async () => {
    assert.equal(ok(await get(`/admin/scenics/${scenic}/overview`)).kpi.verified,6)
  })
  await test('城市权限覆盖景区、线路、订单、评价及列表关联数量', async () => {
    const t = auth('city_partner','310118'), p = ok(await get(`/admin/scenics/${scenic}/overview`,t))
    assert.equal(p.products.length,2); assert.equal(p.kpi.sold,6); assert.equal(p.kpi.gmv,60000)
    assert.equal(p.kpi.verified,3); assert.equal(p.kpi.reviews,3); assert.equal(p.kpi.rating,3)
    const list = ok(await get('/admin/scenics',t))
    assert.ok(!list.some(x=>x.id===other)); assert.equal(list.find(x=>x.id===scenic).product_count,2)
    assert.equal((await get(`/admin/scenics/${other}/overview`,t)).code,1004)
    assert.equal((await get('/admin/scenics',auth('city_partner'))).code,1003)
    assert.equal((await get(`/admin/scenics/${scenic}/overview`,auth('city_partner'))).code,1003)
  })
  await test('空景区、缺失景区、角色鉴权', async () => {
    const p = ok(await get(`/admin/scenics/${empty}/overview`))
    assert.equal(p.kpi.sold,0); assert.equal(p.kpi.verified,0); assert.equal(p.kpi.rating,null); assert.deepEqual(p.products,[])
    assert.equal((await get('/admin/scenics/999999999/overview')).code,1004)
    assert.equal((await get(`/admin/scenics/${scenic}/overview`,'bad')).code,1002)
    assert.equal((await get(`/admin/scenics/${scenic}/overview`,auth('review'))).code,1003)
  })
  await test('全部默认参数有中文名称，API 名称与键/值/说明分离', async () => {
    for (const k of Object.keys(DEFAULTS)) assert.ok(CONFIG_NAMES[k],k)
    const rows = ok(await get('/admin/config'))
    assert.ok(rows.every(r=>r.name && /[\u4e00-\u9fff]/.test(r.name)))
    const r = rows.find(r=>r.k==='bean.order_rate')
    assert.equal(r.name,'消费返豆率'); assert.ok(r.memo); assert.ok(r.v)
  })
} finally {
  if (ids.travel_pass.length) await q('DELETE FROM verification_log WHERE pass_id IN (?)',[ids.travel_pass])
  if (ids.orders.length) await q('DELETE FROM review WHERE order_id IN (?)',[ids.orders])
  for (const table of ['travel_pass','orders','tour_product','scenic_spot']) if (ids[table].length) await q(`DELETE FROM ${table} WHERE id IN (?)`,[ids[table]])
  await closeDb()
}
console.log(`${passed} 组景点数据与参数名称验证通过`)
