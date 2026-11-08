// 30日商户演示流水：正常业务API生成；只回填本批新样例的展示业务日期。
// 不回填账本/日根/存证时间、不更改既有订单、不伪造真实支付或链交易号。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import mysql from 'mysql2/promise'
import {q,one,tx,closeDb} from '../src/db.mjs'
import {getSecrets} from '../src/infra/secrets.mjs'
import {bizDay} from '../src/infra/bizdate.mjs'
import {cfgNum} from '../src/config.mjs'
const base=process.env.API_BASE || 'http://127.0.0.1:8080',batch='MM20261108'
const days=Number(process.env.DEMO_MONTH_DAYS || 30)
assert.ok(Number.isInteger(days) && days>0 && days<=30)
const dateAdd=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
const plan=[]
for(let age=days-1;age>=0;age--)for(let slot=0;slot<4;slot++){
  const date=bizDay(-age),kind=slot===3?'refund':age===0&&slot===1?'waiting':age<=2&&slot===2?'verified':'complete'
  plan.push({date,age,slot,qty:1+(age+slot)%3,kind,label:'演示样例·月1108-'+date.slice(5).replace('-','')+'-'+slot})
}
let lock,results=[]
try{
  if(!process.argv.includes('--apply'))console.log(JSON.stringify({apply:false,batch,from:plan[0].date,to:bizDay(),orders:plan.length,states:plan.reduce((r,p)=>(r[p.kind]=(r[p.kind]||0)+1,r),{})},null,2))
  else{
    assert.equal(process.env.ALLOW_DEMO_MONTH,'1','必须明确放行演示月度样例')
    assert.notEqual(process.env.NODE_ENV,'production');assert.ok(process.env.ADMIN_PASSWORD)
    const db=process.env.DB_NAME || ''
    assert.ok(db==='wanderlust' || db.startsWith('wanderlust_qa_'),'仅演示或隔离验证库')
    const url=new URL(base);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:')
    assert.equal(db==='wanderlust',url.port==='8080','演示库/隔离库端口不匹配')
    const keys=['WX_MCHID','WX_SERIAL','WX_PRIVATE_KEY','WX_API_V3_KEY'],secrets=await getSecrets(keys)
    assert.ok(keys.every(k=>!secrets[k]&&!process.env[k])&&!process.env.WX_PRIVATE_KEY_PATH,'支付凭据存在，禁止模拟流水')
    lock=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASS||'root',database:db})
    const [locked]=await lock.query('SELECT GET_LOCK(?,0) ok',['demo-month:'+batch]);assert.equal(Number(locked[0].ok),1,'同批生成器已在运行')
    const call=async(method,path,body,token)=>{
      const r=await(await fetch(base+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})).json()
      if(r.code!==0)throw new Error(path+': '+JSON.stringify(r.data||r.msg));return r.data
    }
    const admin=await call('POST','/admin/login',{username:process.env.ADMIN_USER||'admin',password:process.env.ADMIN_PASSWORD})
    const buyer=await call('POST','/c/auth/login',{code:'mock-merchant-month-'+batch})
    const consent=await call('GET','/c/consent',null,buyer.token)
    for(const scene of ['privacy','terms'])if(!consent.items.some(x=>x.scene===scene&&x.granted))await call('POST','/c/consent',{scene,granted:true,version:consent.versions[scene]},buyer.token)
    const merchant=await call('POST','/m/auth/login',{code:'mock-chenjie',merchantId:1});assert.equal(Number(merchant.merchant.id),1)
    const originals=(await call('GET','/admin/products',null,admin.token)).filter(p=>Number(p.merchant_id)===1&&Number(p.status)===1&&!p.title.includes('月度演示')).slice(0,4)
    assert.ok(originals.length)
    const catalog=[]
    for(let slot=0;slot<4;slot++){
      const source=await one('SELECT * FROM tour_product WHERE id=?',[originals[slot%originals.length].id])
      const title=source.title.slice(0,38)+' · 月度演示'+(slot+1)
      let product=await one('SELECT * FROM tour_product WHERE merchant_id=1 AND title=?',[title])
      if(!product){
        const rich=typeof source.rich_desc==='string'?JSON.parse(source.rich_desc||'{}'):source.rich_desc||{}
        const images=typeof source.images==='string'?JSON.parse(source.images||'[]'):source.images||[]
        const made=await call('POST','/admin/entities/product',{values:{title,cat:source.cat,city_code:source.city_code,price_from:Number(source.price_from)/100,merchant_id:1,images,intro:rich.intro||'月度演示接待线路，仅供功能演示。',meeting_point:source.meeting_point||'演示集合点',safety_note:source.safety_note||'演示样例，请勿据此实际出行。',subtitle:'月度演示样例 · 无真实资金交易',days_desc:source.days_desc||'1天',bean_gift:Number(source.bean_gift||0)}},admin.token)
        product=await one('SELECT * FROM tour_product WHERE id=?',[made.id])
      }
      catalog.push(product)
    }
    const observe=await cfgNum('order.observe_days')
    for(let i=0;i<plan.length;i++){
      const p=plan[i],product=catalog[p.slot]
      let o=await one('SELECT * FROM orders WHERE user_id=? AND contact_name=?',[buyer.user.id,p.label])
      if(o && await one("SELECT id FROM order_event WHERE order_id=? AND actor=?",[o.id,'demo:'+batch])){results.push({orderNo:o.order_no,date:p.date,status:Number(o.status),created:false});continue}
      const note=batch+'|'+p.date+'|'+p.slot,actualDate=p.kind==='refund'?dateAdd(bizDay(),365+p.age):bizDay()
      let session=await one("SELECT id FROM tour_session WHERE product_id=? AND JSON_UNQUOTE(JSON_EXTRACT(profile,'$.note'))=?",[product.id,note])
      if(!session)session=await call('POST','/admin/entities/session',{parentId:product.id,values:{depart_date:actualDate,quota:99,min_go:1,price_adult:Number(product.price_from)/100,status:'1',note}},admin.token)
      if(Number(product.status)!==1){await call('POST','/admin/products/'+product.id+'/status',{status:1},admin.token);product.status=1}
      if(!o){const created=await call('POST','/c/orders',{sessionId:session.id,qty:p.qty,contactName:p.label,contactPhone:'13800001234'},buyer.token);o=await one('SELECT * FROM orders WHERE order_no=?',[created.orderNo])}
      assert.equal(Number(o.session_id),Number(session.id));assert.equal(Number(o.merchant_id),1)
      if(Number(o.status)===10)await call('POST','/admin/dev/mock-pay',{orderNo:o.order_no},admin.token)
      let detail=await call('GET','/c/orders/'+o.order_no,null,buyer.token)
      if(p.kind==='refund'){
        if([20,30].includes(Number(detail.status)))await call('POST','/admin/orders/'+o.order_no+'/refund',{mode:'full',reason:'演示样例·'+batch+' 模拟全额退款（无真实资金）'},admin.token)
        detail=await call('GET','/c/orders/'+o.order_no,null,buyer.token);assert.equal(Number(detail.status),70,'模拟退款未完成，停止而非伪造状态')
      }else if(p.kind!=='waiting'){
        for(const pass of detail.passes.filter(x=>Number(x.status)===1)){
          const code=await call('GET','/c/pass/'+pass.id+'/code',null,buyer.token)
          const v=await call('POST','/m/verify/scan',{payload:code.qr},merchant.token);assert.ok(v.ok,v.reason)
        }
        detail=await call('GET','/c/orders/'+o.order_no,null,buyer.token)
        if(p.kind==='complete'&&Number(detail.status)===40)await call('POST','/admin/dev/complete',{orderNo:o.order_no},admin.token)
      }
      const wanted={waiting:30,verified:40,complete:50,refund:70}[p.kind]
      const paid=p.date+' '+String(9+p.slot).padStart(2,'0')+':15:00',verified=p.date+' 15:00:00',completed=p.date+' 17:00:00'
      await tx(async c=>{
        const row=await c.one('SELECT * FROM orders WHERE id=? AND user_id=? AND contact_name=? FOR UPDATE',[o.id,buyer.user.id,p.label])
        assert.ok(row);assert.equal(Number(row.status),wanted)
        const payment=await c.one('SELECT * FROM payment WHERE order_id=?',[row.id]);assert.ok(payment && String(payment.wx_trans_no).startsWith('MOCK'))
        const notify=typeof payment.raw_notify==='string'?JSON.parse(payment.raw_notify):payment.raw_notify;assert.equal(notify.mock,true)
        const ownedSession=await c.one("SELECT id FROM tour_session WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(profile,'$.note'))=?",[session.id,note]);assert.ok(ownedSession)
        // 仅本批新样例的业务展示时钟；不改金额、状态、账本、日根或存证。
        await c.upd('UPDATE orders SET created_at=?,paid_at=?,completed_at=?,refund_deadline=DATE_ADD(?,INTERVAL ? DAY) WHERE id=?',[p.date+' 08:45:00',paid,wanted===50?completed:null,paid,observe,row.id])
        await c.upd('UPDATE payment SET callback_at=? WHERE order_id=?',[paid,row.id])
        const depart=p.kind==='refund'?dateAdd(p.date,10):p.date
        await c.upd('UPDATE tour_session SET depart_date=?,status=3 WHERE id=?',[depart,session.id])
        await c.upd('UPDATE travel_pass SET created_at=?,valid_from=?,valid_to=DATE_ADD(?,INTERVAL 2 DAY) WHERE order_id=?',[paid,depart,depart,row.id])
        await c.upd('UPDATE verification_log SET created_at=? WHERE pass_id IN (SELECT id FROM travel_pass WHERE order_id=?)',[verified,row.id])
        await c.upd('UPDATE refunds SET settled_at=? WHERE order_id=? AND status=2',[p.date+' 14:30:00',row.id])
        await c.q('INSERT INTO order_event(order_id,from_st,to_st,actor,detail) VALUES (?,?,?,?,?)',[row.id,wanted,wanted,'demo:'+batch,JSON.stringify({simulation:true,batch,businessDate:p.date,importedAt:new Date().toISOString(),ledgerClock:'actual import time; historical roots unchanged'})])
        await c.q('INSERT INTO audit_log(actor,module,action,biz_ref,before_val,after_val) VALUES (?,?,?,?,?,?)',['demo:'+batch,'demo_history','import-new-sample',row.order_no,JSON.stringify({paid_at:row.paid_at,created_at:row.created_at}),JSON.stringify({businessDate:p.date,simulation:true,originalRecordsUntouched:true})])
      })
      results.push({orderNo:o.order_no,date:p.date,status:wanted,qty:p.qty,created:true})
      console.log('SAMPLE',i+1+'/'+plan.length,p.date,p.kind)
    }
    // 历史演示档案不挤入游客在售目录，也不贡献虚假的可售余量。
    for(const product of catalog){
      const open=await q("SELECT id FROM tour_session WHERE product_id=? AND status=1 AND JSON_UNQUOTE(JSON_EXTRACT(profile,'$.note')) LIKE ?",[product.id,batch+'|%'])
      for(const s of open)await call('POST','/m/supply/'+s.id,{action:'stop_sell'},merchant.token)
      await call('POST','/admin/products/'+product.id+'/status',{status:0},admin.token)
    }
    const report={batch,from:plan[0].date,to:bizDay(),orders:results.length,created:results.filter(r=>r.created).length,rows:results,realMoneyTransferred:false,historicalLedgerOrSealTimesChanged:false,archiveProductsNotListedForSale:true}
    if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify(report,null,2))
    console.log(JSON.stringify({batch,orders:report.orders,created:report.created},null,2))
  }
}catch(e){if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify({batch,partial:true,rows:results,error:e.message},null,2));throw e}
finally{if(lock){await lock.query('SELECT RELEASE_LOCK(?)',['demo-month:'+batch]);await lock.end()}await closeDb()}
