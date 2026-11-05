import { chromium } from 'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import fs from 'node:fs/promises'
const dir=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const results=[],errors=[]
try {
 for(const [port,user,password] of [[18105,'admin','admin123'],[18105,'city310118','city123'],[8080,'admin','admin123']]){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage()
  p.on('pageerror',e=>errors.push({port,user,error:e.message}))
  await p.goto(`http://127.0.0.1:${port}/admin-ui`)
  await p.locator('#luser').fill(user);await p.locator('#lpass').fill(password);await p.locator('#loginSubmit').click()
  await p.locator('#frame').waitFor({state:'visible'})
  await p.locator('#nav [data-p]').first().waitFor()
  const keys=await p.locator('#nav [data-p]').evaluateAll(es=>es.map(e=>e.dataset.p))
  for(const key of (user==='admin'?['accounts','users','reviewqueue','orders','cases','fund','partners','partnerperf']:['cases','orders','contentcases'])){
   if(!keys.includes(key)){results.push({port,user,key,missing:true});continue}
   await p.evaluate(k=>go(k),key);await p.waitForTimeout(650)
   const body=await p.locator('#app').innerText()
   results.push({port,user,key,text:body.slice(0,350),buttons:await p.locator('#app button').allTextContents(),checkboxes:await p.locator('#app input[type=checkbox]').count()})
   await p.screenshot({path:decodeURI(dir)+`${port}-${user}-${key}.png`})
  }
  if(port===18105&&user==='admin'){
   for(const key of ['accounts','users','reviewqueue','orders','cases','fund','partners','partnerperf']){
    await p.setViewportSize({width:390,height:844});await p.evaluate(k=>go(k),key);await p.waitForTimeout(400)
    results.push({port,user,key,narrow:true,width:await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}))})
   }
  }
  await ctx.close()
 }
}finally{await fs.writeFile(new URL('browser-results.json',import.meta.url),JSON.stringify({results,errors},null,2));await browser.close()}
