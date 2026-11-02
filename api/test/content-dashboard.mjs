import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/content-dashboard.mjs')
import assert from 'node:assert/strict'
import { q, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const auth = (role='super',scopeCity) => jwtSign({end:'admin',role,scopeCity})
const get = async (token=auth(),query='') => (await fetch(base+'/admin/content-dashboard'+query,{headers:{authorization:'Bearer '+token}})).json()
const ok = r => {assert.equal(r.code,0,r.msg);return r.data}
const ids={tour_product:[],content_note:[],orders:[]}, stamp='CD'+Date.now(), city='991101'
const insert=async(table,sql,args)=>{const r=await q(sql,args);ids[table].push(r.insertId);return r.insertId}
let passed=0
const test=async(name,fn)=>{await fn();passed++;console.log('  ✓ '+name)}
try {
  const before=ok(await get())
  const product=async(c=city)=>insert('tour_product',"INSERT INTO tour_product(city_code,cat,title,price_from,merchant_id,status) VALUES (?,'script',?,10000,1,1)",[c,stamp+'线路'+ids.tour_product.length])
  const note=async(p,status,likes)=>insert('content_note',"INSERT INTO content_note(user_id,title,body,related_product_id,status,like_count,published_at) VALUES (1,?,'{}',?,?,?,IF(? IN (2,4),NOW(3),NULL))",[stamp+'笔记'+ids.content_note.length,p,status,likes,status])
  const order=async(p,c,qty,status)=>insert('orders',"INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status) VALUES (?,1,?,0,?,1,?,?,?,?)",[stamp+'-'+ids.orders.length,p,c,qty,qty*10000,qty*10000,status])
  const p1=await product(),p2=await product(),outside=await product('991102')
  await note(p1,2,5);await note(p1,2,7);await note(p2,2,4);await note(p1,4,3)
  await note(p1,3,2);await note(p1,0,1);await note(p1,1,0)
  await note(outside,2,100);await note(null,2,200);await note(999999999,2,300)
  for(let i=0;i<20;i++) await note(await product(),2,1)
  await order(p1,city,2,20);await order(p1,city,1,70);await order(p2,city,1,40)
  await order(p1,'991102',9,20);await order(outside,'991102',7,50)
  const token=auth('city_partner',city)
  await test('发布/审核/获赞统计及发布趋势口径一致',async()=>{
    const d=ok(await get(token))
    assert.equal(d.stats.total,27);assert.equal(d.stats.published,23);assert.equal(d.stats.reviewed,25)
    assert.equal(d.stats.pending,2);assert.equal(d.stats.passed,24);assert.equal(d.stats.passRate,24/25)
    assert.equal(d.stats.likes,42);assert.equal(d.stats.unlinked,0)
    assert.equal(d.daily.reduce((s,x)=>s+Number(x.n),0),24)
  })
  await test('同一线路多篇笔记不重复计成交；排除退款及异城订单',async()=>{
    const d=ok(await get(token))
    assert.equal(Number(d.trade.orders),2);assert.equal(Number(d.trade.travelers),3);assert.equal(Number(d.trade.gmv),30000)
    const row=d.products.find(x=>x.id===p1);assert.equal(Number(row.notes),2);assert.equal(Number(row.gmv),20000)
  })
  await test('平台包含未关联/已删除线路笔记；城市隔离所有榜单和聚合',async()=>{
    const all=ok(await get()),mine=ok(await get(token))
    assert.equal(all.stats.published-before.stats.published,26)
    assert.equal(all.stats.unlinked-before.stats.unlinked,2)
    assert.equal(Number(all.trade.gmv)-Number(before.trade.gmv),190000)
    assert.ok(mine.products.every(p=>p.city_code===city));assert.equal(mine.notes.length,10)
    assert.ok(mine.notes.every(n=>n.title.startsWith(stamp)&&n.product_title?.startsWith(stamp)))
  })
  await test('线路榜分页无重复，统计不随翻页改变',async()=>{
    const first=ok(await get(token)),second=ok(await get(token,'?page=2'))
    assert.equal(first.total,22);assert.equal(first.products.length,20);assert.equal(second.products.length,2)
    assert.equal(new Set([...first.products,...second.products].map(x=>x.id)).size,22)
    assert.deepEqual(first.stats,second.stats);assert.deepEqual(first.trade,second.trade)
  })
  await test('零数据/零分母、无城市绑定、角色与参数验证',async()=>{
    const empty=ok(await get(auth('city_partner','000000')))
    assert.equal(empty.stats.total,0);assert.equal(empty.stats.passRate,null);assert.equal(Number(empty.trade.gmv),0)
    assert.deepEqual(empty.products,[]);assert.deepEqual(empty.notes,[])
    assert.equal((await get(auth('city_partner'))).code,1003)
    for(const role of ['ops','review','readonly']) ok(await get(auth(role)))
    for(const role of ['finance','risk']) assert.equal((await get(auth(role))).code,1003)
    assert.equal((await get('bad')).code,1002)
    for(const page of ['-1','1.5','NaN','1000001']) assert.equal((await get(token,'?page='+page)).code,1001)
  })
} finally {
  for(const table of ['content_note','orders','tour_product']) if(ids[table].length) await q(`DELETE FROM ${table} WHERE id IN (?)`,[ids[table]])
  await closeDb()
}
console.log(`${passed} 组内容看板验证通过`)
