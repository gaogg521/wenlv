// 新增本地商户端演示接待样例；不回写旧订单、不回填历史日期、不调用真实支付。
// 默认只预览；--apply 需从主演示环境加载.env并提供ADMIN_PASSWORD。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {q,closeDb} from '../src/db.mjs'
import {getSecrets} from '../src/infra/secrets.mjs'
import {bizDay} from '../src/infra/bizdate.mjs'
const base=process.env.API_BASE || 'http://127.0.0.1:8080'
const samples=[{pid:29,label:'演示样例·MB1108-01',state:'waiting'},{pid:30,label:'演示样例·MB1108-02',state:'waiting'},{pid:33,label:'演示样例·MB1108-03',state:'verified'},{pid:39,label:'演示样例·MB1108-04',state:'complete'},{pid:29,label:'演示样例·MB1108-05',state:'complete'},{pid:37,label:'演示样例·MB1108-06',state:'waiting'}]
// 37 属商户3；不伪造该商户的核销权限。其样例只模拟支付。
try{
  if(!process.argv.includes('--apply'))console.log(JSON.stringify({apply:false,samples},null,2))
  else{
    assert.equal(base,'http://127.0.0.1:8080');assert.equal(process.env.DB_NAME,'wanderlust');assert.notEqual(process.env.NODE_ENV,'production');assert.ok(process.env.ADMIN_PASSWORD)
    const payKeys=['WX_MCHID','WX_SERIAL','WX_PRIVATE_KEY','WX_API_V3_KEY'], secrets=await getSecrets(payKeys)
    assert.ok(payKeys.every(k=>!secrets[k] && !process.env[k]) && !process.env.WX_PRIVATE_KEY_PATH,'已配置支付凭据，拒绝执行模拟样例')
    const call=async(method,url,body,token)=>{let r=await(await fetch(base+url,{method,headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})).json();if(r.code!==0)throw new Error(url+': '+JSON.stringify(r.data||r.msg));return r.data}
    const admin=await call('POST','/admin/login',{username:process.env.ADMIN_USER||'admin',password:process.env.ADMIN_PASSWORD})
    const buyer=await call('POST','/c/auth/login',{code:'mock-merchant-demo-20261108'})
    const consent=await call('GET','/c/consent',null,buyer.token)
    for(const scene of ['privacy','terms'])if(!consent.items.some(x=>x.scene===scene && x.granted))await call('POST','/c/consent',{scene,granted:true,version:consent.versions[scene]},buyer.token)
    const merchant=await call('POST','/m/auth/login',{code:'mock-chenjie',merchantId:1})
    const results=[]
    for(const s of samples){
      const old=await q('SELECT order_no,status FROM orders WHERE user_id=? AND contact_name=?',[buyer.user.id,s.label])
      if(old.length){results.push({label:s.label,orderNo:old[0].order_no,status:old[0].status,created:false});continue}
      const product=await call('GET','/c/tours/'+s.pid)
      // 当日接待样例必须有当日有效、1人成团的演示团期；不绕过未到使用日/未成团校验。
      const existing=await q("SELECT id FROM tour_session WHERE product_id=? AND depart_date=? AND JSON_UNQUOTE(JSON_EXTRACT(profile,'$.note'))=?",[s.pid,bizDay(),'演示样例·MB1108 当日接待'])
      const sid=existing[0]?.id || (await call('POST','/admin/entities/session',{parentId:s.pid,values:{depart_date:bizDay(),quota:12,min_go:1,price_adult:Number(product.price_from)/100,status:'1',note:'演示样例·MB1108 当日接待'}},admin.token)).id
      if(s.state!=='waiting')assert.equal(Number(product.merchant_id),1,'只允许既有本店店长核销本店样例')
      const o=await call('POST','/c/orders',{sessionId:sid,qty:1,contactName:s.label,contactPhone:'13800001234'},buyer.token)
      await call('POST','/admin/dev/mock-pay',{orderNo:o.orderNo},admin.token)
      if(s.state!=='waiting'){
        const detail=await call('GET','/c/orders/'+o.orderNo,null,buyer.token)
        for(const pass of detail.passes){const code=await call('GET','/c/pass/'+pass.id+'/code',null,buyer.token);const v=await call('POST','/m/verify/scan',{payload:code.qr},merchant.token);assert.ok(v.ok,v.reason)}
        if(s.state==='complete')await call('POST','/admin/dev/complete',{orderNo:o.orderNo},admin.token)
      }
      const final=await call('GET','/c/orders/'+o.orderNo,null,buyer.token)
      results.push({label:s.label,orderNo:o.orderNo,state:s.state,status:final.status,created:true})
    }
    const report={samples:results,actualMoneyTransferred:false,historicalDatesChanged:false}
    if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
  }
}finally{await closeDb()}
