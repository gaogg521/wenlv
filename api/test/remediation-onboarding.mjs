import automator from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
if(!/^wanderlust_qa_/.test(process.env.DB_NAME||''))throw new Error('QA only')
const file='test/evidence-20261026/onboarding-result.json'
const stage=process.argv[2]||'apply'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const until=async(f,label)=>{for(let i=0;i<80;i++){const x=await f();if(x)return x;await wait(200)}throw new Error('未就绪 '+label)}
const m=await automator.connect({wsEndpoint:'ws://127.0.0.1:9422'})
try{
await until(async()=>(await m.currentPage())?.path,'首屏')
await m.evaluate(()=>{getApp().globalData.apiBase='http://127.0.0.1:8081'})
await m.switchTab('/pages/me/index');let page=await m.currentPage()
const tapText=async(selector,text)=>{const e=await until(async()=>{for(const e of await page.$$(selector))if((await e.text()).includes(text))return e},text);await e.tap()}
const input=async(placeholder,value)=>{for(const e of await page.$$('input'))if((await e.attribute('placeholder'))===placeholder){await e.input(value);return}throw new Error('找不到输入 '+placeholder)}
await m.mockWxMethod('showModal',{confirm:true,cancel:false})
if(stage==='apply'){
 if((await page.data()).merchant)await tapText('.row','退出登录')
 await m.mockWxMethod('login',{code:'mock-onboarding-owner'})
 await tapText('.btn','微信登录已有门店');await until(async()=>(await page.data()).applications!==undefined,'未绑定登录')
 const name='QA 文旅体验店 '+Date.now()
 await input('门店名称',name);await input('联系人','验收店主');await input('联系电话','13800138000')
 await tapText('.btn','提交入驻申请')
 const application=await until(async()=>(await page.data()).applications?.find(x=>x.name===name),'申请进度')
 assert.equal(application.status,0)
 await m.screenshot({path:'test/evidence-20261026/merchant-application-pending.png'})
 fs.writeFileSync(file,JSON.stringify({merchantId:application.id,name,applied:true},null,2));console.log('ONBOARDING UI PASS apply → pending',application.id)
}else{
 const result=JSON.parse(fs.readFileSync(file,'utf8'))
 await m.mockWxMethod('login',{code:'mock-onboarding-owner'})
 await tapText('.btn','微信登录已有门店')
 await until(async()=>(await page.data()).merchant?.id===result.merchantId,'审核后老板登录')
 assert.equal((await page.data()).role,3)
 const invite=await until(async()=>(await page.data()).inviteCode,'门店邀请码')
 await m.screenshot({path:'test/evidence-20261026/merchant-owner-approved.png'})
 await tapText('.row','退出登录');await m.mockWxMethod('login',{code:'mock-onboarding-staff'})
 await tapText('.btn','微信登录已有门店');await wait(300)
 await input('如 INV01234567',invite);await tapText('.btn','加入门店')
 await until(async()=>(await page.data()).merchant?.id===result.merchantId,'邀请码加入门店')
 assert.equal((await page.data()).role,1)
 await m.switchTab('/pages/index/index');page=await m.currentPage();await until(async()=>(await page.data()).wb,'核销员工作台')
 const actions=[];for(const e of await page.$$('.quick'))actions.push(await e.text())
 assert(!actions.some(x=>/结算|库存|订单/.test(x)))
 await m.screenshot({path:'test/evidence-20261026/merchant-staff-role.png'})
 Object.assign(result,{approvedOwnerRole:3,invitedStaffRole:1,staffActions:actions,at:new Date().toISOString()})
 fs.writeFileSync(file,JSON.stringify(result,null,2));console.log('ONBOARDING UI PASS approved → owner → invite → staff role isolation')
}
}finally{await m.disconnect()}
process.exit(0)
