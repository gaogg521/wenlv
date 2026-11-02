import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/content-governance.mjs')
import assert from 'node:assert/strict'
import {q,one,closeDb} from '../src/db.mjs'
import {jwtSign} from '../src/auth.mjs'
const base='http://127.0.0.1:'+(process.env.PORT||8080),stamp='CG'+Date.now(),city='991301'
const call=async(m,p,b,t)=>(await fetch(base+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined})).json()
const ok=r=>{assert.equal(r.code,0,r.msg);return r.data}
const admin=ok(await call('POST','/admin/login',{username:'admin',password:'admin123'})).token
const scoped=(c=city)=>jwtSign({end:'admin',role:'city_partner',scopeCity:c,name:'隔离审核',uid:1})
const users=[],notes=[],products=[]
let passed=0
const test=async(n,f)=>{await f();passed++;console.log('  ✓ '+n)}
try {
  const login=async suffix=>{const r=ok(await call('POST','/c/auth/login',{code:'mock-'+stamp+suffix}));users.push(Number(r.user.id));return r.token}
  const author=await login('author'),reader=await login('reader'),second=await login('second')
  const p=await q("INSERT INTO tour_product(city_code,cat,title,price_from,merchant_id,status) VALUES (?,'script',?,10000,1,1)",[city,stamp]);products.push(p.insertId)
  const create=async()=>{const r=ok(await call('POST','/c/notes',{title:stamp,body:'<p>旅行事实与体验正文</p><script>bad()</script>',relatedProductId:p.insertId},author));notes.push(r.id);return r.id}
  const n1=await create(),n2=await create()
  const report=async(id,t=reader)=>ok(await call('POST',`/c/notes/${id}/report`,{reason:'涉嫌虚假宣传，请核实事实'},t))
  const decide=(id,action,t=admin)=>call('POST',`/admin/content-cases/reports/${id}/verdict`,{action,reason:'已核实相关内容事实并完成处理'},t)
  const appeal=id=>call('POST',`/c/notes/${id}/appeal`,{reason:'内容为本人真实体验，请重新核实'},author)
  const review=(id,action,t=admin)=>call('POST',`/admin/content-cases/appeals/${id}/verdict`,{action,reason:'已复核作品事实及相关依据'},t)
  let r1
  await test('举报重复并发幂等、输入限制及自己作品保护',async()=>{
    const rr=await Promise.all([report(n1),report(n1)]);assert.equal(rr[0].id,rr[1].id);r1=rr[0]
    assert.equal((await call('POST',`/c/notes/${n1}/report`,{reason:'短'},second)).code,1001)
    assert.equal((await call('POST',`/c/notes/${n1}/report`,{reason:'请检查这个内容是否违规'},author)).code,1001)
    assert.equal((await call('POST',`/c/notes/${n1}/report`,{reason:'内容包含区块链信息'},second)).code,1001)
  })
  await test('城市队列、详情与处理禁止跨城，无绑定及非审核角色拒绝',async()=>{
    const list=ok(await call('GET','/admin/content-cases',null,scoped()));assert.ok(list.rows.some(r=>r.id===r1.id))
    assert.equal(ok(await call('GET','/admin/content-cases',null,scoped('000000'))).total,0)
    assert.equal((await call('GET',`/admin/content-cases/reports/${r1.id}`,null,scoped('000000'))).code,1003)
    assert.equal((await decide(r1.id,'dismiss',scoped('000000'))).code,1003)
    for(const role of ['finance','risk','readonly'])assert.equal((await call('GET','/admin/content-cases',null,jwtSign({end:'admin',role}))).code,1003)
    assert.equal((await call('GET','/admin/content-cases',null,jwtSign({end:'admin',role:'city_partner'}))).code,1003)
  })
  await test('举报不成立反馈只向举报者展示，重复处理拒绝',async()=>{
    ok(await decide(r1.id,'dismiss',scoped()))
    assert.equal((await decide(r1.id,'takedown')).code,2002)
    const mine=ok(await call('GET','/c/content-reports',null,reader));assert.equal(mine[0].status,1);assert.ok(mine[0].resolution)
    assert.ok(!('user_id' in mine[0]));assert.equal(ok(await call('GET','/c/content-reports',null,second)).length,0)
  })
  await test('下架后公开详情不可读，作者可见原因；申诉所有权及维持下架',async()=>{
    const r=await report(n1,second);ok(await decide(r.id,'takedown',scoped()))
    assert.equal((await call('GET',`/c/notes/${n1}`,null,reader)).code,1004)
    let mine=ok(await call('GET','/c/notes',null,author)).find(n=>n.id===n1);assert.equal(mine.status,4);assert.ok(mine.offline_reason);assert.equal(Number(mine.can_appeal),1)
    assert.equal((await call('POST',`/c/notes/${n1}/appeal`,{reason:'这是我的作品要求复核'},reader)).code,1004)
    const pair=await Promise.all([appeal(n1),appeal(n1)]),a=ok(pair[0]);assert.equal(a.id,ok(pair[1]).id)
    const detail=ok(await call('GET',`/admin/content-cases/appeals/${a.id}`,null,scoped()));assert.ok(detail.snapshot);assert.ok(!detail.note.html.includes('<script'))
    ok(await review(a.id,'uphold',scoped()))
    mine=ok(await call('GET','/c/notes',null,author)).find(n=>n.id===n1);assert.equal(mine.appeal_status,2);assert.ok(mine.appeal_resolution);assert.equal(Number(mine.can_appeal),0)
    assert.equal(ok(await appeal(n1)).duplicate,true)
  })
  await test('申诉恢复、再次下架与旧申诉不可重放，操作全留痕',async()=>{
    const r=await report(n2);ok(await decide(r.id,'takedown'));const a=ok(await appeal(n2));ok(await review(a.id,'restore'))
    ok(await call('GET',`/c/notes/${n2}`,null,reader));assert.equal((await one('SELECT moderation_id FROM content_note WHERE id=?',[n2])).moderation_id,null)
    assert.equal(ok(await call('GET','/c/content-reports',null,reader)).find(r=>r.title===stamp&&r.status===2).note_status,2)
    ok(await call('POST',`/admin/content/${n2}/takedown`,{reason:'发现新的内容问题，需要再次复核'},admin))
    assert.equal((await review(a.id,'restore')).code,2002)
    assert.equal((await call('GET',`/c/notes/${n2}`,null,reader)).code,1004)
    const actions=(await q('SELECT action FROM audit_log WHERE biz_ref=?',['note-'+n2])).map(r=>r.action)
    assert.ok(actions.includes('takedown')&&actions.includes('appeal-restore'))
  })
  await test('队列分页、无效动作、跨端token及正文保留',async()=>{
    const n=await create(),before=ok(await call('GET','/admin/content-cases',null,scoped())).total
    for(let i=0;i<21;i++)await q('INSERT INTO content_report(note_id,user_id,city_code,reason) VALUES (?,?,?,?)',[n,900000000+i,city,'隔离分页举报原因'])
    const first=ok(await call('GET','/admin/content-cases',null,scoped())),secondPage=ok(await call('GET','/admin/content-cases?page=2',null,scoped()))
    assert.equal(first.total,before+21);assert.equal(new Set([...first.rows,...secondPage.rows].map(r=>r.id)).size,first.total)
    assert.equal((await call('POST',`/c/notes/${n}/report`,{reason:'检查这一篇笔记内容'},admin)).code,1003)
    assert.equal((await call('POST',`/admin/content/${n}/takedown`,{reason:'短'},admin)).code,1001)
    assert.equal((await call('GET','/admin/content-cases?page=NaN',null,admin)).code,1001)
    assert.ok((await one('SELECT body FROM content_note WHERE id=?',[n1])).body)
  })
} finally {
  if(notes.length){const cases=await q('SELECT id FROM content_moderation WHERE note_id IN (?)',[notes]);if(cases.length)await q('DELETE FROM content_appeal WHERE moderation_id IN (?)',[cases.map(x=>x.id)]);await q('DELETE FROM content_report WHERE note_id IN (?)',[notes]);await q('DELETE FROM content_moderation WHERE note_id IN (?)',[notes]);await q('DELETE FROM content_note WHERE id IN (?)',[notes])}
  if(products.length)await q('DELETE FROM tour_product WHERE id IN (?)',[products])
  // 用户登录可能生成关联账户，保留在隔离库；不清理其他测试数据。
  await closeDb()
}
console.log(`${passed} 组举报与申诉验证通过`)
