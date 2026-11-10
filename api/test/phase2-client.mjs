import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
function page(file,api,wx={}){
 let p;vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/'+file,import.meta.url),'utf8'),{require:k=>k.endsWith('receipt')?()=>{}:api,Page:x=>p=x,wx})
 p.data=structuredClone(p.data);p.setData=(d,cb)=>{for(const[k,v]of Object.entries(d)){if(k.includes('.')){const [a,b]=k.split('.');p.data[a][b]=v}else p.data[k]=v}cb?.()};return p
}
const tick=()=>new Promise(r=>setImmediate(r))
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('✓ '+name)}
await check('新页面数据与事件方法无同名冲突（实际Page注册约束）',async()=>{
 for(const name of ['products','records','freedom','work']){const p=page('package-promo/pages/'+name+'/index.js',{});for(const [k,v]of Object.entries(p))if(typeof v==='function')assert.ok(!(k in p.data),name+' method/data collision: '+k)}
})
await check('产品素材待配置不伪造真码；分享定位具体产品',async()=>{
 const p=page('package-promo/pages/products/index.js',{request:async()=>({title:'线路',text:'线路·199起',path:'/package-tour/pages/detail/index?id=1&scene=p123',mock:true,image:null})},{showToast(){}})
 await p.makeMaterial({currentTarget:{dataset:{id:1}}});assert.equal(p.data.qrcode,'');assert.ok(p.onShareAppMessage().path.includes('id=1'));assert.equal(p.data.material.mock,true)
})
await check('补贴选择与旅豆互斥、数量变化重新服务端试算、失败禁止提交',async()=>{
 let fail=false,calls=0
 const r={id:1,name:'官方补贴',threshold:10000,discount:5000,eligible:true}
 const api={ensureLogin:async()=>{},request:async(path,m,b)=>{assert.equal(path,'/c/freedom/quote');if(fail)throw {msg:'权益已被占用'};return {rows:[r],goods:19900*b.qty,insurance:0,discount:b.rightId?5000:0,cashPay:19900*b.qty-(b.rightId?5000:0)}},createOrder:async()=>{calls++}}
 const p=page('package-tour/pages/booking/index.js',api,{showToast(){}})
 Object.assign(p.data,{p:{insurance_fee:0,bookingRules:{beanDeductMaxPct:0.1}},sessions:[{id:1,price_adult:19900,left_seats:5}],beanBal:100,agree:true,contactName:'测试',contactPhone:'13800000000'})
 p.updatePrice();await tick();p.chooseFreedom({detail:{value:1}});await tick();assert.equal(p.data.useBean,true,'D01：选券不再清空旅豆开关，同单可用');assert.equal(p.data.freedomRightId,1);assert.equal(p.data.priceSummary.pay,'149.00')
 p.addQty();await tick();assert.equal(p.data.priceSummary.pay,'348.00')
 fail=true;p.updatePrice();await tick();await p.submit();assert.equal(calls,0);assert.equal(p.data.freedomError,'权益已被占用')
 p.toggleBean({detail:{value:false}});assert.equal(p.data.freedomRightId,1,'D01：切换旅豆不再清空已选补贴')
})
await check('快速切换试算，旧响应不覆盖当前价格',async()=>{
 const pending=[]
 const p=page('package-tour/pages/booking/index.js',{ensureLogin:async()=>{},request:()=>new Promise(r=>pending.push(r))})
 Object.assign(p.data,{p:{insurance_fee:0},sessions:[{id:1,price_adult:19900}],freedomRightId:1,useBean:false})
 p.updatePrice();await tick();p.data.qty=2;p.updatePrice();await tick();pending[1]({rows:[],discount:5000,goods:39800,insurance:0,cashPay:34800});await tick();pending[0]({rows:[],discount:5000,goods:19900,insurance:0,cashPay:14900});await tick();assert.equal(p.data.priceSummary.pay,'348.00')
})
await check('佣金/提现分页错误清数据，待付款不显示已付款',async()=>{
 const p=page('package-promo/pages/records/index.js',{ensureLogin:async()=>{},request:async()=>({rows:[{id:1,status:3,amount:10000}],page:1,pageSize:20,total:1})})
 p.data.kind='withdrawals';await p.load(1);assert.ok(p.data.rows[0].state.includes('等待付款'));assert.ok(!p.data.rows[0].state.includes('已登记'))
})
await check('冷启动产品码先解析再记来源，畸形编码拒绝',async()=>{
 let fn,stored,calls=[]
 const api={ensureLogin:async()=>{},request:async(p)=>{calls.push(p);return {productId:42}}}
 vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/utils/promo-source.js',import.meta.url),'utf8'),{require:()=>api,module:{set exports(x){fn=x}},wx:{setStorageSync:(k,v)=>{if(k==='promoScene')stored=v}}})
 const r=await fn({scene:'pabc123'});assert.equal(r.id,42);assert.equal(stored,'pabc123');assert.ok(calls[0].startsWith('/c/promote/landing'));assert.equal(calls[1],'/c/promote/visit');await assert.rejects(()=>fn({scene:'%zz'}))
})
await check('产品专属来源不污染其他产品购买，原目标购买保留来源',async()=>{
 let submitted
 const p=page('package-tour/pages/booking/index.js',{ensureLogin:async()=>{},request:async()=>({}),createOrder:async b=>{submitted=b;throw {msg:'test stop before payment'}}},{showToast(){},getStorageSync:k=>k==='promoProductId'?1:'p123'})
 Object.assign(p.data,{p:{},sessions:[{id:1,price_adult:19900,left_seats:5}],agree:true,useBean:false,contactName:'测试',contactPhone:'13800000000'})
 p.pid=2;await p.submit();assert.equal(submitted.promoScene,undefined)
 p.pid=1;await p.submit();assert.equal(submitted.promoScene,'p123')
})
console.log('第二批客户端 '+passed+'/'+passed+' 通过')
