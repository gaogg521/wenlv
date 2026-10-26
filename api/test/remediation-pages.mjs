import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
if (!/^wanderlust_qa_/.test(process.env.DB_NAME || '')) throw new Error('仅允许隔离验收库')
const kind=process.argv[2] || 'a', port=kind==='a'?9421:9422
const { q,one }=await import('../src/db.mjs')
const { jwtSign }=await import('../src/auth.mjs')
const { acceptPayment,place }=await import('../src/domain/order.mjs')
const dir='test/evidence-20261026'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(f,label){for(let i=0;i<60;i++){const x=await f();if(x)return x;await wait(250)}throw new Error('未就绪 '+label)}
let m
for(let i=0;i<40&&!m;i++){try{m=await automator.connect({wsEndpoint:'ws://127.0.0.1:'+port})}catch{await wait(1000)}}
if(!m)throw new Error('无法连接自动化通道')
const errors=[];m.on('exception',e=>errors.push(String(e.message || e)))
await until(async()=>(await m.currentPage())?.path,'首屏')
const user=await one('SELECT id FROM user_account WHERE mini_a_openid=?',['mock-openid-mock-remediation-ui-tourist'])
const merchant=await one('SELECT id FROM merchant WHERE status=1 ORDER BY id LIMIT 1')
const session=await one('SELECT s.id FROM tour_session s JOIN tour_product p ON p.id=s.product_id WHERE p.merchant_id=? AND p.status=1 AND s.status=1 AND s.quota>s.booked LIMIT 1',[merchant.id])
const sample=await place({userId:user.id,sessionId:session.id,qty:1,wantedBeans:0})
await acceptPayment(sample.orderNo,'QA-PAGE-'+Date.now(),true)
const order=await one('SELECT * FROM orders WHERE order_no=?',[sample.orderNo])
const ticket=await one('SELECT id FROM travel_pass WHERE order_id=?',[order.id])
const note=(await q('INSERT INTO content_note(user_id,title,body,status,published_at) VALUES(?,?,?,2,NOW())',[user.id,'水乡里的一天',JSON.stringify({text:'在桥边听故事，在巷口记录旅行。'})])).insertId
const identity=kind==='a'?{uid:user.id,end:'c'}:{uid:(await one('SELECT id FROM user_account WHERE mini_b_openid=?',['mock-openid-mock-remediation-ui-owner'])).id,end:'m',merchantId:merchant.id,role:3}
const token=jwtSign(identity,7200)
await m.evaluate((token,merchant,kind)=>{
  const g=getApp().globalData;g.apiBase='http://127.0.0.1:8081';g.token=token
  if(kind==='b'){g.merchant=merchant;g.role=3;wx.setStorageSync('mtoken',token);wx.setStorageSync('merchant',merchant);wx.setStorageSync('mrole',3)}
  else wx.setStorageSync('token',token)
},token,await one('SELECT id,name,merchant_no FROM merchant WHERE id=?',[merchant.id]),kind)
const root=kind==='a'?'../../mini-a':'../../mini-b'
const config=JSON.parse(fs.readFileSync(new URL(root+'/app.json',import.meta.url),'utf8'))
const tabs=config.tabBar.list.map(x=>x.pagePath), pages=[...config.pages,...(config.subPackages||[]).flatMap(p=>p.pages.map(x=>p.root+'/'+x))]
const results=[]
try{
for(const pg of pages){
 let query=''
 if(pg.includes('/detail/')||pg.includes('/booking/'))query='?id='+order.product_id
 if(pg.includes('/pay-result/'))query='?orderNo='+order.order_no
 if(pg.includes('/order-detail/'))query='?no='+order.order_no
 if(pg.includes('/pass-code/'))query='?id='+ticket.id+'&orderNo='+order.order_no
 if(pg.includes('/note/'))query='?id='+note
 const p=tabs.includes(pg)?await m.switchTab('/'+pg):await m.navigateTo('/'+pg+query)
 await until(async()=> (await m.currentPage()).path===pg,'路由 '+pg)
 await wait(550)
 const data=await p.data()
 if(data.error)throw new Error(pg+': '+data.error)
 if('p' in data && (pg.includes('/detail/')||pg.includes('/booking/')))assert(data.p,pg+' 应加载商品')
 if(pg.includes('/pass-code/'))assert(data.code && !data.fail,'凭证应加载')
 if(pg.includes('/order-detail/'))assert(data.o||data.order,'订单应加载')
 await m.screenshot({path:path.join(dir,'page-'+kind+'-'+pg.replaceAll('/','_')+'.png')})
 results.push(pg);console.log('PAGE PASS',kind,pg)
 if(!tabs.includes(pg))await m.navigateBack()
}
assert.deepEqual(errors,[],'页面不应发生运行时异常')
fs.writeFileSync(path.join(dir,'pages-'+kind+'.json'),JSON.stringify({pages:results,exceptions:errors,at:new Date().toISOString()},null,2))
console.log('ALL PAGES PASS',kind,results.length)
}finally{await m.disconnect()}
process.exit(0)
