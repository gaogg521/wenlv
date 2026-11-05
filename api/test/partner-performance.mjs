import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/partner-performance.mjs')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { q,closeDb } from '../src/db.mjs'
import { jwtSign,hashPassword } from '../src/auth.mjs'
const base='http://127.0.0.1:'+(process.env.PORT||8080),stamp='PF'+Date.now(),city='991201',other='991202'
const token=(role='super',scopeCity)=>jwtSign({end:'admin',role,scopeCity})
const get=async(path,t=token())=>(await fetch(base+path,{headers:{authorization:'Bearer '+t}})).json()
const ok=r=>{assert.equal(r.code,0,r.msg);return r.data}
const ids={admin_user:[],user_account:[],promoter:[],merchant:[],tour_product:[],orders:[],commission:[],promoter_withdraw:[],settlement:[],co_creator:[],co_profit:[]}
const ins=async(table,sql,args)=>{const r=await q(sql,args);ids[table].push(r.insertId);return r.insertId}
let passed=0,manifest
const test=async(name,fn)=>{await fn();passed++;console.log('  ✓ '+name)}
try {
  const addAdmin=async(c)=>ins('admin_user','INSERT INTO admin_user(username,password_hash,role,scope_city,display_name) VALUES (?,?,?,?,?)',[stamp+'-'+ids.admin_user.length,hashPassword('partnerperf-qa'),'city_partner',c,stamp+'城市账号'])
  await addAdmin(city);await addAdmin(city);await addAdmin(other)
  const uid=await ins('user_account','INSERT INTO user_account(mini_a_openid,nickname,status) VALUES (?,?,1)',[stamp,stamp+'推广'])
  await q('INSERT INTO promoter(user_id,status) VALUES (?,1)',[uid]);ids.promoter.push(uid)
  const mid=await ins('merchant','INSERT INTO merchant(city_code,name,merchant_no,status) VALUES (?,?,?,1)',[city,stamp+'商户',stamp])
  const pid=await ins('tour_product',"INSERT INTO tour_product(city_code,cat,title,price_from,merchant_id,status) VALUES (?,'script',?,10000,?,1)",[city,stamp+'线路',mid])
  const settle=async(period,total=10000,paid=false)=>ins('settlement',`INSERT INTO settlement(merchant_id,period,order_count,total_amount,amt_fulfill,amt_service,amt_promoter,amt_beanbudget,amt_retained,status,payment_ref)
    VALUES (?,?,1,?,0,0,0,0,?,?,?)`,[mid,period,total,total,paid?3:0,paid?'QA-'+stamp:null])
  const s1=await settle('2090-W01',10000,true),s2=await settle('2090-W02'),mixed=await settle('2090-W03')
  const order=async(c,sid,amount=10000,status=50)=>ins('orders','INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status,settlement_id) VALUES (?,?,?,0,?,?,1,?,?,?,?)',[stamp+'-'+ids.orders.length,uid,pid,c,mid,amount,amount,status,sid])
  const o1=await order(city,s1),o2=await order(city,s2,9000),o3=await order(other,mixed)
  const comm=async(oid,status,amount=500)=>ins('commission','INSERT INTO commission(order_id,promoter_id,base_amount,rate_bp,amount,status) VALUES (?,?,10000,500,?,?)',[oid,uid,amount,status])
  await comm(o1,1);await comm(o2,2,499);await comm(o3,4)
  const refunded=await order(city,null,7000,70);await comm(refunded,3)
  const w1=await ins('promoter_withdraw','INSERT INTO promoter_withdraw(promoter_id,amount,status,pay_ref) VALUES (?,200,1,?)',[uid,'DUP-'+stamp])
  await ins('promoter_withdraw','INSERT INTO promoter_withdraw(promoter_id,amount,status,pay_ref) VALUES (?,100,1,?)',[uid,'DUP-'+stamp])
  await ins('promoter_withdraw','INSERT INTO promoter_withdraw(promoter_id,amount,status) VALUES (?,50,1)',[uid])
  await ins('promoter_withdraw','INSERT INTO promoter_withdraw(promoter_id,amount,status) VALUES (?,1000,0)',[uid])
  const co=await ins('co_creator','INSERT INTO co_creator(product_id,co_no,name,mobile,role,invest_amount,share_pct) VALUES (?,?,?,\'13812345678\',1,10000,500)',[pid,stamp,stamp+'共创'])
  // T01：夹具按新口径造数——已结清(status=1)的单 paid_amount=amount（视同登记过全额打款流水）
  const profit=async(sid,period,base,amount,status)=>ins('co_profit','INSERT INTO co_profit(settlement_id,co_creator_id,product_id,period,base_amount,amount,status,paid_amount) VALUES (?,?,?,?,?,?,?,?)',[sid,co,pid,period,base,amount,status,status===1?amount:0])
  await profit(s1,'2090-W01',10000,500,1);await profit(s2,'2090-W02',9999,500,0);await profit(999999999,'2090-W04',10000,500,0)
  for(let i=0;i<21;i++) {
    await ins('co_creator','INSERT INTO co_creator(product_id,co_no,name,mobile,role,invest_amount,share_pct) VALUES (?,?,?,\'13812345678\',1,0,500)',[pid,stamp+'-'+i,stamp+'空共创'+i])
    const s=await settle('2091-W'+String(i+1).padStart(2,'0'),0)
    await q('UPDATE settlement SET order_count=0 WHERE id=?',[s])
  }
  manifest={db:process.env.DB_NAME,stamp,city,other,uid,co,mid,pid,s1,s2,mixed,ids}
  const t=token('city_partner',city)
  await test('城市按城市去重排行，只显示本城且有效成交不含退款',async()=>{
    const d=ok(await get('/admin/partner-performance?kind=city',t))
    assert.equal(d.total,1);assert.equal(d.rows[0].id,city);assert.equal(Number(d.rows[0].gmv),19000)
    assert.equal(Number(d.rows[0].orders),2);assert.equal(Number(d.rows[0].merchants),1)
  })
  await test('推广排行按有效计佣订单，佣金放行与提现分开',async()=>{
    const d=ok(await get('/admin/partner-performance?kind=promoter&sort=earned'))
    const row=d.rows.find(x=>x.id===uid);assert.ok(row)
    assert.equal(Number(row.gmv),19000);assert.equal(Number(row.earned),999);assert.equal(Number(row.paid),350)
  })
  await test('城市结算分页、混城整单隔离、来源金额异常',async()=>{
    const a=ok(await get(`/admin/partner-reconciliation/city/${city}`,t)),b=ok(await get(`/admin/partner-reconciliation/city/${city}?page=2`,t))
    assert.equal(a.total,23);assert.equal(a.rows.length,20);assert.equal(b.rows.length,3)
    assert.ok(![...a.rows,...b.rows].some(r=>r.id===mixed))
    const good=[...a.rows,...b.rows].find(r=>r.id===s1),bad=[...a.rows,...b.rows].find(r=>r.id===s2)
    assert.deepEqual(good.issues,[]);assert.ok(bad.issues.includes('订单金额不一致'))
    assert.deepEqual(a.summary,b.summary);assert.equal(Number(a.summary.payable),0)
  })
  await test('推广计佣快照异常，提现余额、待审超额、流水重复和缺失',async()=>{
    const c=ok(await get(`/admin/partner-reconciliation/promoter/${uid}`))
    assert.equal(Number(c.summary.earned),999);assert.equal(c.summary.balance,649);assert.equal(c.summary.after_pending,-351)
    assert.ok(c.rows.some(x=>x.issues.includes('计佣快照金额不符')))
    const w=ok(await get(`/admin/partner-reconciliation/promoter/${uid}?tab=withdrawal`))
    assert.ok(w.rows.find(x=>x.id===w1).issues.includes('打款流水重复'))
    assert.ok(w.rows.some(x=>x.issues.includes('已打款缺回单号')))
    assert.ok(!JSON.stringify(c).includes('13812345678'))
  })
  await test('共创账本按来源复算基数，标记来源缺失，不用当前费率改写历史',async()=>{
    const d=ok(await get(`/admin/partner-reconciliation/cocreator/${co}`))
    assert.equal(Number(d.summary.profit),1500);assert.equal(Number(d.summary.paid),500)
    assert.deepEqual(d.rows.find(r=>r.settlement_id===s1).issues,[])
    assert.ok(d.rows.find(r=>r.settlement_id===s2).issues.includes('分润基数不符'))
    assert.ok(d.rows.some(r=>r.issues.includes('来源结算单缺失')))
    await q('UPDATE co_creator SET share_pct=1000 WHERE id=?',[co])
    assert.equal(Number(ok(await get(`/admin/partner-reconciliation/cocreator/${co}`)).summary.profit),1500)
    const first=ok(await get('/admin/partner-performance?kind=cocreator&sort=profit')),second=ok(await get('/admin/partner-performance?kind=cocreator&sort=profit&page=2'))
    assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,first.rows.length+second.rows.length)
    const ranked=[...first.rows,...second.rows].find(r=>r.id===co);assert.equal(Number(ranked.profit),1500)
  })
  await test('空明细、权限、跨城猜测ID、页码及排序校验',async()=>{
    assert.equal(ok(await get(`/admin/partner-reconciliation/cocreator/${ids.co_creator[1]}`)).total,0)
    for(const kind of ['promoter','cocreator']) assert.equal((await get('/admin/partner-performance?kind='+kind,t)).code,1003)
    assert.equal((await get(`/admin/partner-reconciliation/city/${other}`,t)).code,1003)
    assert.equal((await get('/admin/partner-performance',token('city_partner'))).code,1003)
    for(const role of ['review','risk']) assert.equal((await get('/admin/partner-performance',token(role))).code,1003)
    // R-04 修复：readonly 默认菜单含排行与对账（只读核对）——现在可达
    ok(await get('/admin/partner-performance',token('readonly')))
    for(const role of ['ops','finance']) ok(await get('/admin/partner-performance',token(role)))
    assert.equal((await get('/admin/partner-performance?sort=invalid')).code,1001)
    assert.equal((await get('/admin/partner-performance?kind=invalid')).code,1001)
    assert.equal((await get('/admin/partner-performance?page=-1')).code,1001)
    assert.equal((await get('/admin/partner-reconciliation/promoter/999999999')).code,1004)
  })
} finally {
  if(process.env.PARTNER_PERF_KEEP_FIXTURES==='1'&&manifest&&passed===6) {
    fs.writeFileSync('test/partnerperf-browser-fixture.json',JSON.stringify(manifest,null,2));console.log('保留隔离浏览器夹具：test/partnerperf-browser-fixture.json')
  } else {
    for(const table of ['co_profit','co_creator','promoter_withdraw','commission','orders','settlement','tour_product','merchant','promoter','user_account','admin_user']) if(ids[table].length) await q(`DELETE FROM ${table} WHERE ${table==='promoter'?'user_id':'id'} IN (?)`,[ids[table]])
  }
  await closeDb()
}
console.log(`${passed} 组合伙人排行与对账验证通过`)
