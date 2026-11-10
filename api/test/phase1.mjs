import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/phase1.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { place } from '../src/domain/order.mjs'
import { bookingOpen, bookingNow, validDeadline } from '../src/domain/booking-window.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'
const base = process.env.API_BASE || `http://127.0.0.1:${process.env.PORT}`
const call = async (m,p,b,t) => (await fetch(base+p,{method:m,headers:{'content-type':'application/json',authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json()
const ok = r => {assert.equal(r.code,0,r.msg);return r.data}
const admin=jwtSign({end:'admin',role:'super',name:'phase1'}),ro=jwtSign({end:'admin',role:'readonly',name:'phase1-ro'})
const stamp=Date.now(), ids=[], subjects=[];let sid,oid,resourceMerchant,passed=0
async function check(name,fn){await fn();console.log('✓ '+name);passed++}
try {
  await check('业务时区、截止前后及非法日期',async()=>{
    assert.equal(bookingNow(new Date('2026-11-10T16:00:00Z')),'2026-11-11 00:00:00')
    assert.equal(bookingOpen({sign_deadline:'2026-11-11T00:00'},'2026-11-10 23:59:59'),true)
    assert.equal(bookingOpen({sign_deadline:'2026-11-11T00:00'},'2026-11-11 00:00:00'),false)
    assert.equal(validDeadline('2026-02-30T12:00'),false);assert.equal(bookingOpen({sign_deadline:'bad'}),false)
  })
  for(let i=0;i<2;i++)ids.push((await q('INSERT INTO user_account(nickname) VALUES(?)',['phase1-'+stamp+'-'+i])).insertId)
  const user=jwtSign({end:'c',uid:ids[0]}),other=jwtSign({end:'c',uid:ids[1]})
  for(let i=0;i<2;i++)subjects.push(ok(await call('POST','/admin/work-access/subjects',{name:'阶段一主体'+stamp+'-'+i},admin)).id)
  resourceMerchant=(await q("INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES('310118','阶段一资源夹具','hotel',?,1)",['P1'+stamp])).insertId
  await check('主体创建仅超管，非法类型不拼接SQL',async()=>{
    assert.equal((await call('GET','/admin/work-access',null,ro)).code,1003)
    assert.equal((await call('POST','/admin/work-access/resources',{subjectId:subjects[0],resourceId:1,kind:'constructor',reason:'测试拒绝类型'},admin)).code,1001)
  })
  await check('资源关联与解除、重复关联不转移主体',async()=>{
    ok(await call('POST','/admin/work-access/resources',{subjectId:subjects[0],resourceId:resourceMerchant,kind:'merchant',reason:'核对原门店档案'},admin))
    assert.equal((await call('POST','/admin/work-access/resources',{subjectId:subjects[1],resourceId:resourceMerchant,kind:'merchant',reason:'测试防止误合并'},admin)).code,1001)
  })
  const grant={subjectId:subjects[0],userId:ids[0],status:1,reason:'本人经办关系核实',validFrom:'2026-01-01T00:00'}
  await check('本人授权查询且跨主体/跨用户/跨端拒绝',async()=>{
    ok(await call('POST','/admin/work-access/grants',grant,admin))
    assert.equal(ok(await call('GET','/c/work-contexts',null,user)).subjects.length,1)
    const d=ok(await call('GET','/c/work-contexts/'+subjects[0],null,user));assert.equal(d.resources[0].kind,'merchant');assert.ok(!JSON.stringify(d).includes('bank'))
    assert.equal((await call('GET','/c/work-contexts/'+subjects[1],null,user)).code,1003)
    assert.equal((await call('GET','/c/work-contexts/'+subjects[0],null,other)).code,1003)
    assert.equal((await call('GET','/c/work-contexts',null,jwtSign({uid:ids[0],end:'m',merchantId:1,role:3}))).code,1003)
  })
  await check('撤权、到期及冻结即时拦截旧会话',async()=>{
    ok(await call('POST','/admin/work-access/grants',{...grant,status:0},admin));assert.equal((await call('GET','/c/work-contexts/'+subjects[0],null,user)).code,1003)
    ok(await call('POST','/admin/work-access/grants',{...grant,validTo:'2026-01-02T00:00'},admin));assert.equal(ok(await call('GET','/c/work-contexts',null,user)).subjects.length,0)
    ok(await call('POST','/admin/work-access/grants',grant,admin));await q('UPDATE user_account SET status=0 WHERE id=?',[ids[0]])
    assert.equal((await call('GET','/c/work-contexts',null,user)).code,1003);await q('UPDATE user_account SET status=1 WHERE id=?',[ids[0]])
  })
  await check('门店切换重新查岗位，非授权店拒绝，改岗位后旧令牌失效',async()=>{
    ok(await call('POST','/admin/work-access/staff',{merchantId:1,userId:ids[0],role:1,status:1,reason:'经核对授权门店核销'},admin))
    ok(await call('POST','/admin/work-access/staff',{merchantId:2,userId:ids[0],role:2,status:1,reason:'经核对授权门店店长'},admin))
    assert.equal((await call('POST','/admin/work-access/staff',{merchantId:2,userId:ids[1],role:3,status:1,reason:'禁止只读角色提权'},ro)).code,1003)
    const mt=jwtSign({uid:ids[0],end:'m',merchantId:1,role:1})
    assert.equal(ok(await call('GET','/m/auth/stores',null,mt)).length,2)
    const switched=ok(await call('POST','/m/auth/switch',{merchantId:2},mt));assert.equal(switched.role,2)
    assert.equal((await call('POST','/m/auth/switch',{merchantId:3},mt)).code,1003)
    await q('UPDATE merchant_staff SET role=1 WHERE merchant_id=2 AND user_id=?',[ids[0]])
    assert.equal((await call('GET','/m/settlements',null,switched.token)).code,1002)
    await q('UPDATE merchant_staff SET status=0 WHERE merchant_id=2 AND user_id=?',[ids[0]])
    assert.equal((await call('POST','/m/auth/switch',{merchantId:2},mt)).code,1003)
  })
  await check('官方核实unionid可连接A/B；不同微信不串用户',async()=>{
    const a=ok(await call('POST','/c/auth/login',{code:'mock-phase1-'+stamp},''));ids.push(a.user.id)
    const b=ok(await call('POST','/m/auth/login',{code:'mock-phase1-'+stamp},''))
    const payload=JSON.parse(Buffer.from(b.token.split('.')[1],'base64url').toString());assert.equal(Number(payload.uid),Number(a.user.id))
    const conflict='mock-phase1-conflict-'+stamp
    await q('UPDATE user_account SET mini_b_openid=? WHERE id=?',['mock-openid-'+conflict,ids[0]])
    await q('UPDATE user_account SET unionid=? WHERE id=?',['mock-union-'+conflict,ids[1]])
    assert.equal((await call('POST','/m/auth/login',{code:conflict},'')).code,1003,'历史冲突不能任取一个账号合并')
  })
  const session=await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status,profile) VALUES(1,?,20,1,19900,1,?)',[bizDay(2),JSON.stringify({sign_deadline:bizDay(1)+'T23:59'})]);sid=session.insertId
  await check('截止前能建单；截止后列表及直接建单拒绝，名额不变',async()=>{
    const o=await place({userId:ids[0],sessionId:sid,qty:1,wantedBeans:0});oid=(await one('SELECT id FROM orders WHERE order_no=?',[o.orderNo])).id
    await q('UPDATE tour_session SET profile=? WHERE id=?',[JSON.stringify({sign_deadline:bizDay(-1)+'T23:59'}),sid])
    await assert.rejects(()=>place({userId:ids[0],sessionId:sid,qty:1,wantedBeans:0}),/截止/)
    assert.equal(Number((await one('SELECT booked FROM tour_session WHERE id=?',[sid])).booked),1)
    const tour=ok(await call('GET','/c/tours/1',null,user));assert.ok(!tour.sessions.some(s=>Number(s.id)===sid))
    assert.equal(Number((await one('SELECT status FROM orders WHERE id=?',[oid])).status),10)
  })
  await check('经营总览汇总现有配置并屏蔽整行内部字段',async()=>{
    const d=ok(await call('GET','/admin/products/1/overview',null,admin));assert.ok(d.operating.quality);assert.ok(d.operating.available);assert.ok(!('profile' in d.product));assert.ok(!('phrase_merchant' in d.product))
  })
  await check('推广规则返回服务端参数，资格与历史查询分开',async()=>{
    await q('INSERT INTO promoter(user_id,tier,rate_bp,status) VALUES(?,1,500,1)',[ids[0]])
    const d=ok(await call('GET','/c/promote/overview',null,user));assert.ok(d.withdrawMin>0);assert.ok(Number.isFinite(d.settleDelayDays));assert.equal(d.active,true)
    await q('UPDATE promoter SET status=0 WHERE user_id=?',[ids[0]])
    assert.equal(ok(await call('GET','/c/promote/overview',null,user)).active,false)
    assert.equal((await call('POST','/c/promote/withdraw',{},user)).code,6001)
  })
  console.log(`阶段一专项 ${passed}/${passed} 通过`)
} finally {
  if(oid){await q('DELETE FROM order_event WHERE order_id=?',[oid]);await q('DELETE FROM orders WHERE id=?',[oid])}
  if(sid)await q('DELETE FROM tour_session WHERE id=?',[sid])
  if(subjects.length){await q('DELETE FROM subject_grant WHERE subject_id IN (?)',[subjects]);await q('DELETE FROM subject_resource WHERE subject_id IN (?)',[subjects]);await q('DELETE FROM business_subject WHERE id IN (?)',[subjects])}
  if(resourceMerchant)await q('DELETE FROM merchant WHERE id=?',[resourceMerchant])
  if(ids.length){await q('DELETE FROM merchant_staff WHERE user_id IN (?)',[ids]);await q('DELETE FROM promoter WHERE user_id IN (?)',[ids]);await q('DELETE FROM bean_account WHERE user_id IN (?)',[ids]);await q('DELETE FROM user_account WHERE id IN (?)',[ids])}
  await closeDb()
}
