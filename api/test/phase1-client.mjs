import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
function pageAt(file,api,wx={}){let p;vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/'+file,import.meta.url),'utf8'),{require:()=>api,Page:x=>p=x,wx});p.setData=d=>Object.assign(p.data,d);return p}
const replies={
 '/c/promote/overview':{promoter:true,active:true,tier:1,rateBp:725,validGmv:123456,withdrawable:5000,earned:6000,withdrawn:1000,pendingRequests:0,withdrawMin:3000,settleDelayDays:3},
 '/c/promote/scene':{promoter:true,scene:'test'},'/c/promote/customers':[{statusText:'已退款'}],
}
let broken=false
const center=pageAt('package-promo/pages/center/index.js',{ensureLogin:async()=>{},request:async p=>{if(broken)throw {msg:'资格已变更'};return replies[p]}},{showToast(){}})
await center.fetch();assert.equal(center.data.ov.canWithdraw,true);assert.equal(center.data.ov.rateLabel,'7.25%');assert.equal(center.data.ov.validGmvLabel,'¥1234.56');assert.ok(center.data.ov.ruleText.includes('30.00'));assert.ok(center.data.ov.ruleText.includes('3 天'))
replies['/c/promote/overview'].pendingRequests=1;await center.fetch();assert.equal(center.data.ov.canWithdraw,false)
broken=true;await center.fetch();assert.equal(center.data.ov,null);assert.equal(center.data.scene,null);assert.equal(center.data.error,'资格已变更')
let resolveFirst
const work=pageAt('package-promo/pages/work/index.js',{request:p=>p.endsWith('/1')?new Promise(r=>resolveFirst=r):Promise.resolve({subject:{id:2,name:'B'},resources:[],note:'B'})})
const old=work.select(1);await work.select(2);resolveFirst({subject:{id:1,name:'A'},resources:[],note:'A'});await old
assert.equal(work.data.current.id,2,'旧主体慢响应不能覆盖新选择')
console.log('阶段一客户端：参数化费率/门槛/观察期、待审禁重复、错误清缓存、跨主体慢响应隔离通过')
