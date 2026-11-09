import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const source=fs.readFileSync(new URL('../../mini-b/utils/api.js',import.meta.url),'utf8')
function setup(env='develop',base='http://127.0.0.1:8080') {
 const store=new Map(),app={globalData:{apiBase:base}},calls=[];let normal=0,handler=o=>o.success({data:{code:0,data:{token:'demo-token',merchant:{id:1,name:'演示门店'},role:2}}})
 const wx={getAccountInfoSync:()=>({miniProgram:{envVersion:env}}),getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),request:o=>{calls.push(o);handler(o)},login:o=>{normal++;o.success({code:'real-wx-code'})}}
 const module={exports:{}};vm.runInNewContext(source,{module,wx,getApp:()=>app,getCurrentPages:()=>[]});return {api:module.exports,store,app,calls,wx,setHandler:h=>handler=h,normal:()=>normal}
}
for(const env of ['trial','release']) {const s=setup(env);assert.equal(s.api.canDemoLogin(),false);await assert.rejects(s.api.demoLogin());assert.equal(s.calls.length,0)}
for(const base of ['https://api.wenlv.example','http://evil.example','http://127.0.0.1.evil.example','http://localhost@evil.example']) {const s=setup('develop',base);assert.equal(s.api.canDemoLogin(),false)}
for(const base of ['http://127.0.0.1:8080','http://192.168.1.8:8080','http://172.29.128.120:8080']) assert.equal(setup('develop',base).api.canDemoLogin(),true)
const s=setup();await s.api.demoLogin();assert.equal(s.normal(),0);assert.equal(s.calls[0].data.code,'mock-chenjie');assert.equal(s.app.globalData.role,2);assert.equal(s.store.get('mloginMode'),'demo');assert.equal(s.store.get('merchant').id,1)
let step=0;s.setHandler(o=>{step++;if(step===1)o.success({data:{code:1002}});else if(o.url.endsWith('/auth/login'))o.success({data:{code:0,data:{token:'renewed',merchant:{id:1},role:2}}});else o.success({data:{code:0,data:{ok:true}}})});assert.equal((await s.api.request('/m/workbench')).ok,true);assert.equal(s.normal(),0);assert.equal(s.app.globalData.token,'renewed');assert.equal(step,3)
s.setHandler(o=>o.success({data:{code:0,data:{token:'wechat',unbound:true}}}));await s.api.login();assert.equal(s.normal(),1);assert.equal(s.store.has('mloginMode'),false);assert.equal(s.app.globalData.role,0)
const bad=setup();bad.setHandler(o=>o.success({data:{code:0,data:{token:'wrong',merchant:{id:2},role:3}}}));await assert.rejects(bad.api.demoLogin());assert.equal(bad.store.has('mtoken'),false)
const busy=setup();let finish;busy.setHandler(o=>{finish=o.success});const p=busy.api.demoLogin(),p2=busy.api.demoLogin();assert.equal(p,p2);assert.equal(busy.calls.length,1);finish({data:{code:0,data:{token:'one',merchant:{id:1},role:2}}});await p
const fail=setup();fail.setHandler(o=>o.fail({errMsg:'offline'}));await assert.rejects(fail.api.demoLogin());assert.equal(fail.store.has('mtoken'),false)
let page;const pageset=setup();const toast=[],nav=[];pageset.wx.showToast=o=>toast.push(o);pageset.wx.switchTab=o=>nav.push(o.url)
vm.runInNewContext(fs.readFileSync(new URL('../../mini-b/pages/me/index.js',import.meta.url),'utf8'),{require:()=>pageset.api,getApp:()=>pageset.app,wx:pageset.wx,Page:p=>page=p});page.setData=o=>Object.assign(page.data,o)
await page.enterDemo();assert.equal(nav[0],'/pages/index/index');assert.equal(page.data.demoBusy,false);assert.equal(page.data.role,2);page.logout();assert.equal(pageset.store.has('mloginMode'),false);assert.equal(pageset.app.globalData.token,'')
console.log('商户演示登录：开发环境限制、固定店长、持久会话、过期重登、正常微信登录、失败/重复点击与退出清理通过')
