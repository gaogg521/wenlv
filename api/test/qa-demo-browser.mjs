// 演示环境只读页面检查：不提交业务表单；登录会更新最近登录时间。
import{chromium}from'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import fs from'node:fs/promises'
import assert from'node:assert/strict'
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),out={pages:[],errors:[],denials:[]}
const base=process.env.API_BASE || 'http://127.0.0.1:8080'
try{
 for(const [user,pw,keys]of [['admin','admin123',['accounts','users','orders','cases','reviewqueue','fund','partners','config','security']],['finance','admin123',['fund','config','orders','settlements','taskcash','entitlements','partners','partnerperf']],['ops','admin123',['users','orders','reviewqueue','content','tasks','cocreate']],['city310118','city123',['orders','cases','contentcases','products','merchants','partners','partnerperf']]]){
  const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();let current='login'
  p.on('pageerror',e=>out.errors.push({user,page:current,msg:e.message}))
  p.on('response',async r=>{if(r.url().includes('/admin/')){try{const j=await r.json();if(j.code===1003)out.denials.push({user,page:current,path:new URL(r.url()).pathname,msg:j.msg})}catch{}}})
  await p.goto(base+'/admin-ui');await p.locator('#luser').fill(user);await p.locator('#lpass').fill(pw);await p.locator('#loginSubmit').click();await p.locator('#nav [data-p]').first().waitFor()
  for(const key of keys){current=key;assert.equal(await p.locator(`#nav [data-p="${key}"]`).count(),1,'预期菜单可见：'+user+'/'+key);await p.evaluate(k=>go(k),key);await p.waitForTimeout(400);const text=await p.locator('#app').innerText();out.pages.push({user,key,text:text.slice(0,220)});assert(!/^暂时无法加载/.test(text),user+'/'+key+'加载失败');if(key===keys[0])await p.screenshot({path:`test/evidence-qa-final/demo-${user}.png`})}
  await c.close()
 }
 assert.deepEqual(out.errors,[],'页面无运行时异常');assert.deepEqual(out.denials,[],'不向无权限的辅助接口发请求');console.log(`PASS demo real logins and ${out.pages.length} page operations; denials=${out.denials.length}`)
}finally{await fs.writeFile('test/evidence-qa-final/demo-browser.json',JSON.stringify(out,null,2));await b.close()}
