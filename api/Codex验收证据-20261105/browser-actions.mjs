import {chromium}from'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import{q,one,closeDb}from'../src/db.mjs'
import fs from'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),ctx=await browser.newContext(),p=await ctx.newPage(),results=[]
const dir=new URL('.',import.meta.url)
try{
 await p.goto('http://127.0.0.1:18105/admin-ui');await p.locator('#luser').fill('admin');await p.locator('#lpass').fill('admin123');await p.locator('#loginSubmit').click();await p.locator('#frame').waitFor({state:'visible'});await p.waitForTimeout(500)
 await p.evaluate(()=>go('users'));await p.waitForTimeout(500)
 const cb=p.locator('#app input[type=checkbox]').nth(1),uid=await cb.getAttribute('onchange')
 await cb.check();await p.getByRole('button',{name:'批量打标',exact:true}).click();await p.locator('#bulkTagSel').waitFor()
 await p.locator('#bulkTagNote').fill('Codex独立浏览器验收');await p.getByRole('button',{name:/确认打标/}).click();await p.getByText('逐笔结果',{exact:true}).waitFor()
 results.push({check:'V10 browser select preview submit',uid,text:await p.locator('body').innerText().then(x=>x.slice(-1000))})
 await p.screenshot({path:decodeURI(new URL('bulk-tags-action.png',dir).pathname).replace(/^\/([A-Z]:)/,'$1')})
 await p.evaluate(()=>closeModal());await p.evaluate(()=>go('accounts'));await p.waitForTimeout(500);await p.getByRole('button',{name:'验证方式',exact:true}).first().click();await p.waitForTimeout(300)
 results.push({check:'MFA dialog real click',text:(await p.locator('body').innerText()).slice(-1500)})
 await p.evaluate(()=>closeModal());await ctx.setOffline(true);await p.evaluate(()=>go('orders'));await p.waitForTimeout(400)
 results.push({check:'offline page failure',text:await p.locator('#app').innerText()})
 await ctx.setOffline(false);await p.locator('#refreshPage').click();await p.waitForTimeout(600)
 results.push({check:'online refresh recovers',text:(await p.locator('#app').innerText()).slice(0,350)})
 console.log(JSON.stringify(results,null,2))
}finally{await fs.writeFile(new URL('browser-actions.json',dir),JSON.stringify(results,null,2));await browser.close();await closeDb()}
