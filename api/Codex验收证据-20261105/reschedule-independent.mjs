import {q,one,closeDb} from '../src/db.mjs'
import {hashPassword} from '../src/auth.mjs'
import fs from 'node:fs/promises'
if(process.env.DB_NAME!=='wanderlust_qa_codex_20261105')throw Error('isolated only')
const base='http://127.0.0.1:18105',stamp='CXRS'+Date.now(),results=[]
const call=async(t,m,p,b)=>(await fetch(base+p,{method:m,headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:b?JSON.stringify(b):undefined})).json()
const ok=r=>{if(r.code!==0)throw Error(JSON.stringify(r));return r.data}
try{
 const name=stamp+'admin',pw='Acceptance!123'
 const a=(await q('INSERT INTO admin_user(username,password_hash,role,display_name)VALUES(?,?,?,?)',[name,hashPassword(pw),'super',name])).insertId
 let token=ok(await call('','POST','/admin/login',{username:name,password:pw})).token
 const prod=await one('SELECT * FROM tour_product WHERE status=1 LIMIT 1'),u=await one('SELECT id FROM user_account LIMIT 1'),merchant=await one('SELECT id FROM merchant LIMIT 1')
 const sessions=[]
 for(let i=0;i<2;i++)sessions.push((await q('INSERT INTO tour_session(product_id,depart_date,quota,booked,min_go,price_adult,status)VALUES(?,DATE_ADD(CURDATE(),INTERVAL ? DAY),100,?,1,10000,1)',[prod.id,400+i,i?0:10])).insertId)
 const oid=(await q('INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status)VALUES(?,?,?,?,?,?,2,20000,20000,20)',[stamp,u.id,prod.id,sessions[0],prod.city_code,merchant.id])).insertId
 const application=ok(await call(token,'POST',`/admin/orders/${stamp}/reschedule`,{toSessionId:sessions[1],reason:'独立验收改期身份与并发'}))
 const denied=await call(token,'POST',`/admin/reschedules/${application.id}/verdict`,{pass:true,note:'同名自批应拒绝'})
 ok(await call(token,'PUT',`/admin/accounts/${a}`,{displayName:stamp+'改名',note:'验收不可变身份'}))
 token=ok(await call('','POST','/admin/login',{username:name,password:pw})).token
 const renamed=await call(token,'POST',`/admin/reschedules/${application.id}/verdict`,{pass:true,note:'同账号改名后自批应拒绝'})
 results.push({check:'same uid renamed self approval',accountId:a,before:denied,after:renamed,pass:renamed.code===1003})
 if(renamed.code===0){
  const before=await q('SELECT id,booked FROM tour_session WHERE id IN (?,?)',sessions)
  const execution=await Promise.all(Array.from({length:4},()=>call(token,'POST',`/admin/reschedules/${application.id}/execute`,{})))
  const after=await q('SELECT id,booked FROM tour_session WHERE id IN (?,?)',sessions)
  results.push({check:'concurrent execute exactly once',before,execution,after,order:await one('SELECT session_id,version FROM orders WHERE id=?',[oid]),request:await one('SELECT status,exec_note FROM order_reschedule WHERE id=?',[application.id]),pass:after[0].booked===before[0].booked-2&&after[1].booked===before[1].booked+2})
 }
 results.push({check:'N007 kw list',result:await call(token,'GET','/admin/reschedules?kw='+stamp)})
 console.log(JSON.stringify(results,null,2));await fs.writeFile(new URL('reschedule-independent.json',import.meta.url),JSON.stringify(results,null,2))
}finally{await closeDb()}
