import {assertIsolatedDb}from'./_guard.mjs'
assertIsolatedDb('qa-bootstrap-preserve')
import{q,one,closeDb}from'../src/db.mjs'
import{hashPassword}from'../src/auth.mjs'
import{spawn}from'node:child_process'
import{once}from'node:events'
import assert from'node:assert/strict'
const port=18109,base='http://127.0.0.1:'+port,pw='CustomCity!12345'
const original=await one("SELECT password_hash,last_login_at FROM admin_user WHERE username='city310118'")
assert(original)
let child
const stop=async()=>{if(child&&child.exitCode==null){const done=once(child,'exit');child.kill();await done}child=null}
try{
 const hash=hashPassword(pw);await q("UPDATE admin_user SET password_hash=? WHERE username='city310118'",[hash])
 for(let run=0;run<2;run++){
  child=spawn(process.execPath,['src/index.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),CITY_PARTNER_PASSWORD:'OtherSeed!12345'},windowsHide:true,stdio:'ignore'})
  let ready=false
  for(let attempt=0;attempt<100;attempt++){try{const r=await fetch(base+'/c/health',{signal:AbortSignal.timeout(250)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
  assert(ready,'服务启动成功')
  assert.equal((await one("SELECT password_hash FROM admin_user WHERE username='city310118'")).password_hash,hash,'重启不得重写已有密码哈希')
  const l=await(await fetch(base+'/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'city310118',password:pw})})).json();assert.equal(l.code,0,'原自定义密码仍可登录')
  await stop()
 }
 console.log('PASS two actual service starts preserve custom city password hash; custom password login succeeds')
}finally{
 await stop();await q("UPDATE admin_user SET password_hash=?,last_login_at=? WHERE username='city310118'",[original.password_hash,original.last_login_at]);await closeDb()
}
