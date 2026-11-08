import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('merchant-history')
import assert from 'node:assert/strict'
import {q,one,closeDb} from '../src/db.mjs'
import {jwtSign} from '../src/auth.mjs'
const base=process.env.API_BASE
assert.ok(base && !base.endsWith(':8080'))
const ids=[],users=[],passes=[],sessions=[],stamp='MRANGE-'+Date.now()
const req=async(path,token)=>{let r=await(await fetch(base+path,{headers:{authorization:'Bearer '+token}})).json();assert.equal(r.code,0,path+JSON.stringify(r));return r.data}
try{
  const products=await q('SELECT p.id,p.merchant_id,p.city_code,s.id sid FROM tour_product p JOIN tour_session s ON s.product_id=p.id WHERE p.merchant_id IN (1,2) ORDER BY p.id,s.id')
  const a=products.find(p=>Number(p.merchant_id)===1),b=products.find(p=>Number(p.merchant_id)===2);assert.ok(a&&b)
  for(let i=0;i<2;i++){await q('INSERT INTO user_account(nickname) VALUES (?)',[stamp+'-'+i]);users.push((await one('SELECT id FROM user_account WHERE nickname=?',[stamp+'-'+i])).id)}
  await q('INSERT INTO merchant_staff(merchant_id,user_id,role,status) VALUES (1,?,3,1),(1,?,1,1),(2,?,3,1)',[users[0],users[1],users[0]])
  const token=jwtSign({uid:users[0],end:'m',merchantId:1,role:3}),clerk=jwtSign({uid:users[1],end:'m',merchantId:1,role:1})
  const historical=await q("INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES (?,'2024-02-29',12,1,100,3)",[a.id]);sessions.push(historical.insertId)
  assert.ok((await req('/m/supply?history=1',token)).some(s=>Number(s.id)===Number(historical.insertId)))
  assert.ok(!(await req('/m/supply',token)).some(s=>Number(s.id)===Number(historical.insertId)))
  for(let i=0;i<61;i++){
    const p=i===60?b:a,no=stamp+'-'+String(i).padStart(3,'0')
    const r=await q("INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status,paid_at,created_at) VALUES (?,?,?,?,?,?,1,100,100,20,'2024-02-29 10:00:00','2024-02-29 09:00:00')",[no,users[0],p.id,p.sid,p.city_code,p.merchant_id]);ids.push(r.insertId)
  }
  const seen=[]
  for(let page=1;page<=5;page++){const rows=await req('/m/orders?from=2024-02-29&to=2024-02-29&pageSize=12&page='+page+'&kw='+stamp,token);assert.equal(rows.length,12);seen.push(...rows.map(x=>x.order_no));assert.ok(rows.every(x=>!x.order_no.endsWith('-060')))}
  assert.equal(new Set(seen).size,60,'历史分页不可遗漏或重复')
  const summary=await req('/m/workbench?from=2024-02-29&to=2024-02-29',token);assert.equal(summary.todayOrders,60);assert.equal(summary.todayGmv,'60.00')
  const stats=await req('/m/stats?from=2024-02-29&to=2024-02-29',token);assert.equal(stats.week.length,1);assert.equal(stats.week[0].orders,60)
  const denied=await(await fetch(base+'/m/orders?from=2024-02-30&to=2024-02-30',{headers:{authorization:'Bearer '+token}})).json();assert.notEqual(denied.code,0)
  const r=await q("INSERT INTO travel_pass(user_id,order_id,kind,name,product_id,status) VALUES (?,?,1,?,?,1)",[users[0],ids[0],stamp,a.id]);passes.push(r.insertId)
  for(const uid of users)await q("INSERT INTO verification_log(pass_id,merchant_id,staff_id,method,result,city_code,created_at) VALUES (?,1,?,1,1,?,'2024-02-29 12:00:00')",[passes[0],uid,a.city_code])
  const own=await req('/m/verify/records?from=2024-02-29&to=2024-02-29&pageSize=1',clerk);assert.equal(own.length,1)
  const page2=await req('/m/verify/records?from=2024-02-29&to=2024-02-29&pageSize=1&page=2',clerk);assert.equal(page2.length,0,'核销员不能翻到其他员工记录')
  await q("INSERT INTO verification_log(pass_id,merchant_id,staff_id,method,result,city_code,created_at) VALUES (?,1,?,1,1,?,'2024-03-01 12:00:00')",[passes[0],users[0],a.city_code])
  const later=await req('/m/stats?from=2024-03-01&to=2024-03-01',token);assert.equal(later.week[0].orders,0);assert.equal(later.week[0].verifies,1,'核销按核销日统计，不能被早先支付日漏掉')
  console.log('历史跨50条翻页、指定历史日经营/趋势、日期校验、门店隔离与核销员记录隔离：通过')
}finally{
  for(const pid of passes){await q('DELETE FROM verification_log WHERE pass_id=?',[pid]);await q('DELETE FROM travel_pass WHERE id=?',[pid])}
  for(const id of ids)await q('DELETE FROM orders WHERE id=?',[id])
  for(const id of sessions)await q('DELETE FROM tour_session WHERE id=?',[id])
  for(const uid of users){await q('DELETE FROM merchant_staff WHERE user_id=?',[uid]);await q('DELETE FROM user_account WHERE id=?',[uid])}
  await closeDb()
}
