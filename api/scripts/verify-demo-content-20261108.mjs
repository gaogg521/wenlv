// 只读验收：商品、团期、图片字节、审计记录与现有商户范围。不下单、不发消息。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { content } from './demo-content-20261108.mjs'
const base=process.env.API_BASE || 'http://127.0.0.1:8080'
assert.equal(base,'http://127.0.0.1:8080');assert.ok(process.env.ADMIN_PASSWORD)
const req=async(url,body,token)=>{
  const r=await(await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})).json()
  assert.equal(r.code,0,url+': '+JSON.stringify(r.data || r.msg));return r.data
}
const a=await req('/admin/login',{username:process.env.ADMIN_USER || 'admin',password:process.env.ADMIN_PASSWORD})
const b=await req('/m/auth/login',{code:'mock-chenjie',merchantId:1});assert.equal(b.merchant.id,1)
const stock=await req('/m/supply',null,b.token),all=await req('/admin/products',null,a.token)
const results=[]
for(const v of content){
  const p=all.find(p=>p.title===v.title);assert.ok(p,'商品缺失：'+v.title)
  const d=await req('/c/tours/'+p.id);assert.equal(d.sessions.length,3);assert.equal(Number(d.price_from),v.price_from*100)
  assert.ok(d.sessions.every(s=>Number(s.price_adult)===v.price_from*100),'团期价须与录入的元正确换算')
  assert.equal(Number(p.merchant_id),v.merchant_id)
  assert.equal(d.images.length,1);assert.ok(d.images[0].includes(v.images[0]))
  const log=await req('/admin/audit-logs?kw=product-'+p.id+'&module=product&pageSize=100',null,a.token)
  assert.ok(log.rows.some(x=>x.action==='create' && x.biz_ref==='product-'+p.id))
  assert.equal(stock.filter(s=>s.title===v.title).length,v.merchant_id===1?3:0)
  results.push({id:p.id,title:v.title,cat:v.cat,merchantId:v.merchant_id,sessions:3,cover:d.images[0]})
}
const active=all.filter(p=>Number(p.status)===1),covers=[],hashes=[]
for(const p of active){
  const d=await req('/c/tours/'+p.id),url=d.images[0];assert.ok(url && !url.endsWith('.svg'))
  const r=await fetch(new URL(url,base));assert.equal(r.status,200);covers.push(url)
  hashes.push(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'))
}
assert.equal(new Set(covers).size,active.length,'全部在架商品封面地址不得重复')
assert.equal(new Set(hashes).size,active.length,'不能用不同文件名伪装同一张照片')
const categoryCounts={}
for(const cat of ['script','yoga','family','sister','shop'])categoryCounts[cat]=(await req('/c/tours?cat='+cat)).length
const report={operation:'read-only-api-verification',results,categoryCounts,allActiveProducts:active.length,uniqueCoverUrls:new Set(covers).size,uniquePhotoBytes:new Set(hashes).size,merchantScopeIsolation:true,paymentsOrMessagesSent:false}
if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
