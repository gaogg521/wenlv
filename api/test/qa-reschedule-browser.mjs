import {assertIsolatedDb}from'./_guard.mjs'
assertIsolatedDb('qa-reschedule-browser')
import{q,one,closeDb}from'../src/db.mjs'
import{hashPassword}from'../src/auth.mjs'
import assert from'node:assert/strict'
import fs from'node:fs/promises'
import{chromium}from'file:///C:/Users/allenzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
const base='http://127.0.0.1:'+process.env.PORT,stamp='UIRS'+Date.now(),pw='Browser!12345',admins=[],sessions=[],results=[]
let oid,uid,b
try{
 for(let i=0;i<2;i++){const id=(await q('INSERT INTO admin_user(username,password_hash,display_name,role)VALUES(?,?,?,?)',[stamp+i,hashPassword(pw),stamp+'同名','super'])).insertId;admins.push(id)}
 const prod=await one('SELECT id,city_code FROM tour_product WHERE status=1 LIMIT 1'),merchant=await one('SELECT id FROM merchant LIMIT 1')
 uid=(await q('INSERT INTO user_account(mini_a_openid,nickname)VALUES(?,?)',[stamp,stamp])).insertId
 for(let i=0;i<2;i++)sessions.push((await q('INSERT INTO tour_session(product_id,depart_date,quota,booked,min_go,price_adult,status)VALUES(?,DATE_ADD(CURDATE(),INTERVAL ? DAY),20,?,1,10000,1)',[prod.id,500+i,i?0:2])).insertId)
 oid=(await q('INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status)VALUES(?,?,?,?,?,?,2,20000,20000,20)',[stamp,uid,prod.id,sessions[0],prod.city_code,merchant.id])).insertId
 b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const login=async(i)=>{const ctx=await b.newContext(),p=await ctx.newPage();p.on('dialog',d=>d.accept());await p.goto(base+'/admin-ui');await p.locator('#luser').fill(stamp+i);await p.locator('#lpass').fill(pw);await p.locator('#loginSubmit').click();await p.locator('#nav [data-p]').first().waitFor();return p}
 const a=await login(0);await a.evaluate(no=>orderDrawer(no),stamp);await a.getByRole('button',{name:'改期 / 换团',exact:true}).click();await a.locator('#rsTo').selectOption(String(sessions[1]));await a.locator('#rsReason').fill('Codex浏览器实际改期验收');await a.getByRole('button',{name:'提交申请',exact:true}).click();await a.getByRole('button',{name:'改期记录',exact:true}).waitFor();await a.getByRole('button',{name:'改期记录',exact:true}).click();await a.getByText('待审批',{exact:true}).waitFor();assert.equal(await a.getByRole('button',{name:'通过',exact:true}).count(),0)
 await a.screenshot({path:'test/evidence-qa-final/reschedule-own-hidden.png'})
 const c=await login(1);await c.evaluate(no=>rescheduleDrawer(no),stamp);await c.getByRole('button',{name:'通过',exact:true}).click();await c.locator('#rsVerdictNote').fill('不同UID同名可正常复核');await c.getByRole('button',{name:'确认通过',exact:true}).click();await c.getByRole('button',{name:'执行换团',exact:true}).waitFor();await c.getByRole('button',{name:'执行换团',exact:true}).click();await c.getByText('已执行',{exact:true}).waitFor();await c.screenshot({path:'test/evidence-qa-final/reschedule-executed.png'})
 const o=await one('SELECT session_id,version FROM orders WHERE id=?',[oid]);assert.equal(Number(o.session_id),sessions[1]);assert.equal(Number(o.version),1)
 const inventory=await q('SELECT id,booked FROM tour_session WHERE id IN (?,?) ORDER BY id',sessions);assert.deepEqual(inventory.map(x=>Number(x.booked)),[0,2]);results.push({check:'browser apply → own approve hidden → distinct UID same name approves → execute → inventory readback',pass:true,order:o,inventory});console.log(JSON.stringify(results))
}finally{
 if(b)await b.close();if(oid){const rs=await q('SELECT id FROM order_reschedule WHERE order_id=?',[oid]);for(const r of rs)await q("DELETE FROM audit_log WHERE biz_ref=? AND module='order'",['reschedule-'+r.id]);await q('DELETE FROM order_reschedule WHERE order_id=?',[oid]);await q('DELETE FROM order_event WHERE order_id=?',[oid]);await q('DELETE FROM orders WHERE id=?',[oid])}for(const id of sessions)await q('DELETE FROM tour_session WHERE id=?',[id]);if(uid)await q('DELETE FROM user_account WHERE id=?',[uid]);for(const id of admins)await q('DELETE FROM admin_user WHERE id=?',[id]);await fs.writeFile('test/evidence-qa-final/reschedule-browser.json',JSON.stringify(results,null,2));await closeDb()
}
