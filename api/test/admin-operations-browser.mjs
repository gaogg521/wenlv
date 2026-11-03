import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { assertIsolatedDb } from './_guard.mjs'
import { q, one, closeDb } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'
assertIsolatedDb('test/admin-operations-browser.mjs')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.API_BASE || 'http://127.0.0.1:' + (process.env.PORT || 8080)
const stamp = Date.now().toString(36), password = 'QA-ops-' + stamp, prefix = 'ops-ui-' + stamp
const roles = ['super','ops','finance','review','risk','city_partner'], adminIds = [], results = [], inventory = [], errors = []
const dir = 'test/evidence-admin-operations-20261103'
await fs.mkdir(dir,{recursive:true})
const call = async (method,path,body,token) => {
  const j = await (await fetch(base+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined})).json()
  assert.equal(j.code,0,j.msg); return j.data
}
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
let uid, taskId, noteId, orderNo = 'UIOP' + Date.now()
const ready = page => page.waitForFunction(()=>document.querySelector('#nav [aria-current="page"]')&&document.querySelector('#app').getAttribute('aria-busy')==='false')
const nav = async (page,key) => { await page.evaluate(k=>go(k),key); await ready(page); assert.equal(await page.locator('#app .error-state').count(),0,key+' loads'); assert.equal(await page.locator('#pageOperations').isVisible(),true) }
const ok = message => { results.push(message); console.log('PASS',message) }
try {
  const sample = await one('SELECT * FROM orders ORDER BY id LIMIT 1'); assert(sample)
  const code = 'mock-' + prefix
  await call('POST','/c/auth/login',{code})
  uid = Number((await one('SELECT id FROM user_account WHERE mini_a_openid LIKE ?',['%'+code])).id)
  await q('INSERT INTO promoter (user_id,tier,rate_bp,status,profile) VALUES (?,1,500,1,?)',[uid,JSON.stringify({real_name:prefix,mobile:'13800008888'})])
  for (const role of roles) {
    const r=await q('INSERT INTO admin_user (username,password_hash,role,display_name,scope_city) VALUES (?,?,?,?,?)',[prefix+'-'+role,hashPassword(password),role,'验收-'+role,role==='city_partner'?sample.city_code:null]);adminIds.push(r.insertId)
  }
  const auth=await call('POST','/admin/login',{username:prefix+'-super',password})
  taskId=(await call('POST','/admin/entities/task',{values:{title:prefix+'奖励任务',category:'note',brief:'浏览器操作验收任务',reward_beans:0,cash_reward:1,max_participants:1}},auth.token)).id
  noteId=(await q('INSERT INTO content_note (user_id,title,body,related_product_id,status) VALUES (?,?,?,?,1)',[uid,prefix+'待审笔记',JSON.stringify({text:'清晨来到水乡，和领队一起在集合点出发，完成旅程后分享体验。',images:[]}),sample.product_id])).insertId
  const entry=(await q('INSERT INTO content_task_entry (task_id,user_id,status,note_id,cash_reward,cash_status,finished_at) VALUES (?,?,3,?,100,1,NOW(3))',[taskId,uid,noteId])).insertId
  await q('INSERT INTO orders (order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status,contact_name) VALUES (?,?,?,?,?,?,1,10000,10000,20,?)',[orderNo,uid,sample.product_id,sample.session_id,sample.city_code,sample.merchant_id,'原联系人'])
  for (const role of roles) {
    const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage()
    page.on('pageerror',e=>errors.push(role+': '+e.message))
    await page.goto(base+'/admin-ui');await page.locator('#luser').fill(prefix+'-'+role);await page.locator('#lpass').fill(password);await page.locator('#lpass').press('Enter');await ready(page)
    const keys=await page.locator('#nav [data-p]').evaluateAll(es=>es.map(e=>e.dataset.p))
    for(const key of keys){await nav(page,key);inventory.push({role,key,title:await page.locator('#pageTitle').innerText(),purpose:await page.locator('#pageOperations').innerText(),buttons:await page.locator('#app button').evaluateAll(es=>es.map(e=>({label:e.textContent.trim(),disabled:e.disabled,title:e.title})))})}
    ok(role+' actual login and '+keys.length+' pages with operation guidance')
    if(role==='super'){
      await nav(page,'orders');await page.locator('#orderKeyword').fill(orderNo);await page.locator('#orderKeyword').press('Enter');await page.getByRole('button',{name:'查看与处理',exact:true}).click();await page.getByRole('button',{name:'修正联系人',exact:true}).click()
      await page.locator('#serviceName').fill('浏览器修正联系人');await page.locator('#servicePhone').fill('13900009999');await page.locator('#serviceReason').fill('游客核对后要求修正联系方式');await page.getByRole('button',{name:'保存修正',exact:true}).click();await page.locator('#modalRoot').getByText('139****9999',{exact:true}).first().waitFor()
      await page.getByRole('button',{name:'添加客服备注',exact:true}).click();await page.locator('#serviceNote').fill('已电话核实集合时间，游客确认准时到店');await page.getByRole('button',{name:'保存备注',exact:true}).click();await page.locator('#modalRoot').getByText('已电话核实集合时间，游客确认准时到店',{exact:true}).waitFor();await page.screenshot({path:dir+'/order-service.png'})
      await page.reload();await ready(page);await page.evaluate(no=>orderDrawer(no),orderNo);await page.locator('#modalRoot').getByText('139****9999',{exact:true}).first().waitFor();await page.locator('#modalRoot').getByText('已电话核实集合时间，游客确认准时到店',{exact:true}).waitFor();await page.keyboard.press('Escape');ok('order contact and note saved via browser, masked and retained after refresh')
      await nav(page,'partners');await page.getByRole('textbox',{name:'搜索合伙人'}).fill(prefix);await page.getByRole('button',{name:'查询',exact:true}).click();const row=page.locator('#app tr').filter({hasText:prefix});await row.getByRole('button',{name:'编辑合作资料',exact:true}).click();await page.locator('#ee_real_name').fill(prefix+'已维护');await page.locator('#eeSave').click();await page.locator('#eeRoot').waitFor({state:'detached'});await page.locator('#app tr').filter({hasText:prefix+'已维护'}).waitFor();await page.reload();await ready(page);await page.locator('#app tr').filter({hasText:prefix+'已维护'}).waitFor();await page.screenshot({path:dir+'/partner-edit.png'});ok('partner direct edit saved and refreshed with registered cooperation name')
      await nav(page,'users');await page.locator('input[name=kw]').fill(String(uid));await page.getByRole('button',{name:'查询',exact:true}).click();await page.getByRole('button',{name:'查看与管理',exact:true}).click();page.once('dialog',d=>d.accept('浏览器验证账号冻结流程'));await page.getByRole('button',{name:'冻结账号',exact:true}).click();await page.getByRole('button',{name:'解除冻结',exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'解除冻结',exact:true}).click();await page.getByRole('button',{name:'冻结账号',exact:true}).waitFor();await page.keyboard.press('Escape');ok('user management entry and freeze/unfreeze persisted')
      await page.setViewportSize({width:390,height:850});await nav(page,'orders');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:dir+'/mobile-operations.png'});ok('390px operation guidance fits viewport')
    }
    if(role==='ops'){
      await nav(page,'content');await page.evaluate(id=>reviewNote(id),noteId);assert.equal(await page.getByRole('button',{name:'通过并发布',exact:true}).count(),0);assert(await page.getByText('当前账号仅可查看审核材料；请由审核员或超级管理员完成通过或驳回。').isVisible());await page.keyboard.press('Escape');await nav(page,'taskcash');assert.equal(await page.getByRole('button',{name:'登记打款',exact:true}).count(),0);ok('ops sees actionable responsibility rather than rejected review/payment buttons')
    }
    if(role==='finance'){
      assert(keys.includes('taskcash'));assert(!keys.includes('tasks'));await nav(page,'taskcash');const row=page.locator('#app tr').filter({hasText:prefix+'奖励任务'});page.once('dialog',d=>d.accept('QA-OPS-'+stamp));await row.getByRole('button',{name:'登记打款',exact:true}).click();await row.getByText('已打款',{exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'#taskcash');await page.reload();await ready(page);await page.locator('#app td').filter({hasText:'QA-OPS-'+stamp}).waitFor();await page.screenshot({path:dir+'/finance-cash-paid.png'});assert.equal(Number((await one('SELECT cash_status FROM content_task_entry WHERE id=?',[entry])).cash_status),2);ok('finance independent payment entry, real registration and refresh readback')
    }
    if(role==='review'){
      await nav(page,'content');await page.evaluate(id=>reviewNote(id),noteId);await page.getByRole('button',{name:'通过并发布',exact:true}).click();await page.locator('#modalRoot [role=dialog]').waitFor({state:'detached'});assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?',[noteId])).status),2);await nav(page,'tasks');assert.equal(await page.getByRole('button',{name:'下线',exact:true}).count(),0);ok('reviewer actually publishes note and has no unauthorised task status buttons')
    }
    if(role==='city_partner'){
      await nav(page,'orders');assert.equal(await page.locator('[data-refund-no]').count(),0);await nav(page,'products');assert.equal(await page.getByRole('button',{name:'新增线路',exact:false}).count(),0);assert.equal(await page.getByRole('button',{name:'编辑资料',exact:true}).count(),0);ok('city role sees local operational data without platform edit/refund buttons')
    }
    await context.close()
  }
  assert.deepEqual(errors,[])
  await fs.writeFile(dir+'/result.json',JSON.stringify({at:new Date().toISOString(),database:process.env.DB_NAME,base,results,inventory,errors,limitations:['local isolated database','WeChat and payment MOCK','cash entry fixture represents previously approved reward; no external bank transfer','production not deployed']},null,2))
} finally {
  await browser.close()
  if(taskId){await q('DELETE FROM content_task_entry WHERE task_id=?',[taskId]);await q('DELETE FROM content_task WHERE id=?',[taskId])}
  if(noteId)await q('DELETE FROM content_note WHERE id=?',[noteId])
  await q('DELETE FROM orders WHERE order_no=?',[orderNo])
  if(uid){await q('DELETE FROM promoter WHERE user_id=?',[uid]);await q('UPDATE user_account SET status=1 WHERE id=?',[uid])}
  for(const id of adminIds)await q('DELETE FROM admin_user WHERE id=?',[id])
  await closeDb()
}
