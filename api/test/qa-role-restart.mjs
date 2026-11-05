// 本机两阶段实际重启验证：prepare → 重启同库服务 → verify → cleanup。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('qa-role-restart')
import { q, one, closeDb } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const file='test/evidence-qa-final/role-restart-fixture.json', phase=process.argv[2]
try {
 if(phase==='prepare'){
  const username='restart-'+Date.now(), rows=await q("SELECT * FROM admin_role_module WHERE role='dev'"), config=await one("SELECT * FROM admin_role_config WHERE role='dev'")
  const id=(await q('INSERT INTO admin_user(username,password_hash,display_name,role) VALUES(?,?,?,?)',[username,hashPassword('Restart!12345'),username,'dev'])).insertId
  await fs.writeFile(file,JSON.stringify({username,id,rows,config}))
  await q("DELETE FROM admin_role_module WHERE role='dev'")
  await q("INSERT INTO admin_role_config(role,updated_by)VALUES('dev','restart-proof') ON DUPLICATE KEY UPDATE updated_by='restart-proof'")
  console.log('Prepared empty dev configuration; restart service before verify')
 }else{
  const f=JSON.parse(await fs.readFile(file,'utf8'))
  if(phase==='cleanup'){
   await q("DELETE FROM admin_role_module WHERE role='dev'");for(const row of f.rows)await q('INSERT INTO admin_role_module SET ?',[row])
   await q("DELETE FROM admin_role_config WHERE role='dev'");if(f.config)await q('INSERT INTO admin_role_config SET ?',[f.config])
   await q('DELETE FROM admin_user WHERE id=?',[f.id]);console.log('Restored original role configuration')
  }else{
   const base='http://127.0.0.1:'+process.env.PORT
   const l=await(await fetch(base+'/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:f.username,password:'Restart!12345'})})).json()
   assert.equal(l.code,0)
   const c=await(await fetch(base+'/admin/capabilities',{headers:{authorization:'Bearer '+l.data.token}})).json();assert.equal(c.code,0);assert.deepEqual(c.data.modules,[])
   const {chromium}=await import('file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs')
   const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
   try{const p=await b.newPage();await p.goto(base+'/admin-ui');await p.locator('#luser').fill(f.username);await p.locator('#lpass').fill('Restart!12345');await p.locator('#loginSubmit').click();await p.getByRole('heading',{name:'当前账号暂无可用栏目'}).waitFor();assert.equal(await p.locator('#nav [data-p]').count(),0);await p.screenshot({path:'test/evidence-qa-final/role-empty-after-restart.png'});console.log('PASS actual service restart: new login modules=[], browser zero menus and explicit empty state')}finally{await b.close()}
  }
 }
}finally{await closeDb()}
