import{assertIsolatedDb}from'./_guard.mjs'
assertIsolatedDb('role-product-audit')
import{q,closeDb}from'../src/db.mjs'
import{hashPassword}from'../src/auth.mjs'
import{chromium}from'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import fs from'node:fs/promises'
const base='http://127.0.0.1:'+process.env.PORT,stamp='RA'+Date.now(),pw='RoleAudit!2026',ids=[],out={baseline:'b6db68e',roles:[],pageErrors:[],denials:[],hiddenLinks:[],uiFailures:[]}
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 for(const role of ['super','ops','finance','review','risk','readonly','sre','dev','city_partner']){
  const username=stamp+'-'+role,id=(await q('INSERT INTO admin_user(username,password_hash,display_name,role,scope_city)VALUES(?,?,?,?,?)',[username,hashPassword(pw),role,role,role==='city_partner'?'310118':null])).insertId;ids.push(id)
  const ctx=await b.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage();let current='login'
  p.on('pageerror',e=>out.pageErrors.push({role,key:current,message:e.message}))
  p.on('response',async r=>{if(r.url().includes('/admin/'))try{const j=await r.json();if(j.code===1003)out.denials.push({role,key:current,path:new URL(r.url()).pathname,msg:j.msg})}catch{}})
  await p.goto(base+'/admin-ui');await p.locator('#luser').fill(username);await p.locator('#lpass').fill(pw);await p.locator('#loginSubmit').click();await p.locator('#nav [data-p]').first().waitFor()
  const keys=await p.locator('#nav [data-p]').evaluateAll(es=>es.map(e=>e.dataset.p)),record={role,modules:keys,pages:[]};out.roles.push(record)
  for(const key of keys){current=key;await p.evaluate(k=>go(k),key);await p.waitForTimeout(300)
   const text=await p.locator('#app').innerText();record.pages.push({key,text:text.slice(0,300),buttons:await p.locator('#app button:not([disabled])').allTextContents()})
   if(/暂时无法加载|操作权限加载失败/.test(text)){out.uiFailures.push({role,key,text:text.slice(0,500)});await p.screenshot({path:`test/evidence-ledger-role/failure-${role}-${key}.png`})}
   const links=await p.locator('#app [onclick]:visible').evaluateAll(es=>es.map(e=>({text:e.textContent.trim().slice(0,50),handler:e.getAttribute('onclick')})))
   for(const l of links){const m=l.handler.match(/\bgo\('([^']+)'/);if(m&&!keys.includes(m[1]))out.hiddenLinks.push({role,key,target:m[1],text:l.text})}
  }
  // 用户给出的复现：搜索无结果后，检查常驻首页与品牌入口。
  current=keys.includes('audit')?'audit':keys.at(-1);await p.evaluate(k=>go(k),current);await p.locator('#navSearch').fill('admin');await p.waitForTimeout(150)
  record.navigation={afterSearch:await p.locator('#nav .nav-item:visible').count(),brandLinks:await p.locator('#workspaceSide a[href],#workspaceSide button[aria-label*=首页]').count(),crumb:await p.locator('#crumb').innerText()}
  await p.screenshot({path:`test/evidence-ledger-role/role-${role}-navigation.png`})
  await p.locator('.side-logo').click();await p.waitForTimeout(350);record.navigation.afterBrandClick={title:await p.locator('#pageTitle').innerText(),hash:await p.evaluate(()=>location.hash),visibleMenus:await p.locator('#nav .nav-item:visible').count(),search:await p.locator('#navSearch').inputValue()}
  console.log(role+': '+keys.length+' pages');await ctx.close()
 }
}finally{
 await fs.writeFile('test/evidence-ledger-role/role-audit.json',JSON.stringify(out,null,2));await b.close();for(const id of ids)await q('DELETE FROM admin_user WHERE id=?',[id]);await closeDb()
}
