import{assertIsolatedDb}from'./_guard.mjs'
assertIsolatedDb('role-action-probes')
import{q,closeDb}from'../src/db.mjs'
import{hashPassword}from'../src/auth.mjs'
import{chromium}from'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import fs from'node:fs/promises'
const base='http://127.0.0.1:'+process.env.PORT,stamp='ACTION'+Date.now(),ids=[],out=[]
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 for(const role of ['readonly','risk']){
  const username=stamp+role,id=(await q('INSERT INTO admin_user(username,password_hash,display_name,role)VALUES(?,?,?,?)',[username,hashPassword('Probe!2026'),role,role])).insertId;ids.push(id)
  const ctx=await b.newContext(),p=await ctx.newPage();p.on('dialog',d=>d.accept());await p.goto(base+'/admin-ui');await p.locator('#luser').fill(username);await p.locator('#lpass').fill('Probe!2026');await p.locator('#loginSubmit').click();await p.locator('#nav [data-p]').first().waitFor()
  if(role==='readonly'){
   await p.evaluate(()=>go('settlements'));await p.getByRole('button',{name:'生成本周结算单',exact:true}).waitFor();const response=p.waitForResponse(r=>r.url().includes('/admin/settlements/generate'));await p.getByRole('button',{name:'生成本周结算单',exact:true}).click();const r=await(await response).json();out.push({role,check:'visible settlement write button',result:r})
   await p.evaluate(()=>go('orders'));await p.waitForTimeout(300);const complete=p.getByRole('button',{name:'完成',exact:true});if(await complete.count()){const response=p.waitForResponse(r=>r.url().includes('/admin/dev/complete'));await complete.first().click();out.push({role,check:'visible order complete button',result:await(await response).json()})}
  }else{
   out.push({role,check:'risk keyword search',result:await p.evaluate(()=>api('GET','/admin/risk?kw=attest').then(x=>({ok:true,total:x.total})).catch(e=>({ok:false,message:e.message})))})
  }
  await ctx.close()
 }
 console.log(JSON.stringify(out,null,2))
}finally{await fs.writeFile('test/evidence-ledger-role/action-probes.json',JSON.stringify(out,null,2));await b.close();for(const id of ids)await q('DELETE FROM admin_user WHERE id=?',[id]);await closeDb()}
