import crypto from 'node:crypto'
import { q, one, tx, BizError } from '../db.mjs'
import { requireUser } from '../auth.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { id, json, paging } from '../domain/sales.mjs'
import * as f from '../domain/freedom.mjs'
import { priceForSession } from '../domain/order.mjs'
import { bookingOpen, bookingNow } from '../domain/booking-window.mjs'
import { uploadReceipt,readReceipt,validReceipt } from '../domain/private-receipt.mjs'
import { findBanned } from '../domain/wording.mjs'

const reason=b=>{const s=String(b.reason||'').trim();if(s.length<4||s.length>300)throw new BizError(1001,'请填写4–300字操作依据');return s}
const integer=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>10000000000)throw new BizError(1001,'金额应为正整数分');return n}
const actor=a=>'admin:'+a.name
export const freedomRoutes={
 'GET /admin/freedom':async req=>{
   await requireAdmin(req,['super','finance','ops'])
   const {page,pageSize,offset}=paging(req.query)
   const uid=req.query.userId?id(req.query.userId):null,cond=uid?' WHERE r.user_id=?':'',args=uid?[uid]:[]
   return {budgets:await q('SELECT * FROM freedom_budget ORDER BY id DESC LIMIT 300'),templates:await q('SELECT * FROM freedom_template ORDER BY id DESC LIMIT 300'),
     rights:await q(`SELECT r.id,r.user_id,r.batch_id,r.template_id,r.rule_json,r.status,r.order_no,r.created_at FROM freedom_right r ${cond} ORDER BY r.id DESC LIMIT ? OFFSET ?`,[...args,pageSize,offset]),
     total:Number((await one('SELECT COUNT(*) n FROM freedom_right r'+cond,args)).n),page,pageSize,
     batches:await q('SELECT id,request_key,template_id,recipients,operator,created_at FROM freedom_batch ORDER BY id DESC LIMIT 100')}
 },
 'POST /admin/freedom/budgets':async req=>{
   const a=await requireAdmin(req,['super']),name=String(req.body.name||'').trim(),total=integer(req.body.total),why=reason(req.body)
   if(!name||name.length>80)throw new BizError(1001,'预算名称无效')
   return tx(async c=>{const bid=await c.ins('INSERT INTO freedom_budget(name,total) VALUES(?,?)',[name,total]);await audit(c,actor(a),'freedom','budget-approve','fb-'+bid,null,{name,total,reason:why});return {id:bid}})
 },
 'POST /admin/freedom/templates':async req=>{
   const a=await requireAdmin(req,['super','ops']),rule=f.ruleInput(req.body),budgetId=id(req.body.budgetId),why=reason(req.body)
   if(findBanned(rule.name))throw new BizError(1001,'活动名称含不适合小程序展示的用语，请调整')
   return tx(async c=>{
     if(!await c.one('SELECT id FROM freedom_budget WHERE id=? AND status=1',[budgetId]))throw new BizError(1001,'预算不可用')
     for(const pid of rule.products)if(!await c.one('SELECT id FROM tour_product WHERE id=?',[pid]))throw new BizError(1001,'适用产品不存在')
     let tid
     if(req.body.id){tid=id(req.body.id);const old=await c.one('SELECT * FROM freedom_template WHERE id=? FOR UPDATE',[tid]);if(!old)throw new BizError(1004,'模板不存在');await c.q('UPDATE freedom_template SET name=?,budget_id=?,rule_json=?,version=version+1 WHERE id=?',[rule.name,budgetId,JSON.stringify(rule),tid])}
     else tid=await c.ins('INSERT INTO freedom_template(name,budget_id,rule_json) VALUES(?,?,?)',[rule.name,budgetId,JSON.stringify(rule)])
     await audit(c,actor(a),'freedom','template','ft-'+tid,null,{rule,budgetId,reason:why});return {id:tid}
   })
 },
 'POST /admin/freedom/issue':async req=>{
   const a=await requireAdmin(req,['super','ops']),tid=id(req.body.templateId),key=String(req.body.requestKey||''),why=reason(req.body)
   if(!/^[\w-]{8,64}$/.test(key)||!Array.isArray(req.body.userIds)||!req.body.userIds.length||req.body.userIds.length>500)throw new BizError(1001,'批次幂等号或接收人无效（每批最多500人）')
   const users=[...new Set(req.body.userIds.map(id))].sort((a,b)=>a-b),hash=crypto.createHash('sha256').update(JSON.stringify({tid,users})).digest('hex')
   return tx(async c=>{
     const t=await c.one('SELECT * FROM freedom_template WHERE id=? FOR UPDATE',[tid]);if(!t||Number(t.status)!==1)throw new BizError(1001,'模板不存在或已停发')
     const old=await c.one('SELECT * FROM freedom_batch WHERE request_key=?',[key]);if(old){if(old.payload_hash!==hash)throw new BizError(1001,'幂等号已用于其他批次');return {id:old.id,repeated:true}}
     const rule=json(t.rule_json);if(bookingNow()>=rule.to)throw new BizError(1001,'活动已过期')
     const budget=await c.one('SELECT * FROM freedom_budget WHERE id=? AND status=1 FOR UPDATE',[t.budget_id]);if(!budget||Number(budget.committed)+Number(budget.used)+Number(budget.recovering)+rule.discount*users.length>Number(budget.total))throw new BizError(1001,'补贴预算不足或已停用（含待追回占用）')
     for(const uid of users){
       if(!await c.one('SELECT id FROM user_account WHERE id=? AND status=1',[uid]))throw new BizError(1001,'接收人不存在或已停用：'+uid)
       const used=await c.one('SELECT COUNT(*) n FROM freedom_right WHERE user_id=? AND template_id=?',[uid,tid]);if(Number(used.n)>=rule.perUser)throw new BizError(1001,'超过每人发放上限：'+uid)
     }
     const bid=await c.ins('INSERT INTO freedom_batch(request_key,payload_hash,template_id,recipients,operator) VALUES(?,?,?,?,?)',[key,hash,tid,JSON.stringify(users),actor(a)])
     for(const uid of users){const rid=await c.ins('INSERT INTO freedom_right(user_id,batch_id,template_id,budget_id,rule_json) VALUES(?,?,?,?,?)',[uid,bid,tid,t.budget_id,JSON.stringify({...rule,version:t.version})]);await c.q("INSERT INTO freedom_event(budget_id,right_id,kind,amount,biz_ref,detail) VALUES(?,?,'issue',?,?,?)",[t.budget_id,rid,rule.discount,'right-'+rid,why])}
     await c.q('UPDATE freedom_budget SET committed=committed+? WHERE id=?',[rule.discount*users.length,t.budget_id]);await audit(c,actor(a),'freedom','issue','batch-'+bid,null,{users,reason:why});return {id:bid,count:users.length}
   })
 },
 'POST /admin/freedom/status':async req=>{
   const a=await requireAdmin(req,['super','ops']),kind=String(req.body.kind),n=id(req.body.id),why=reason(req.body)
   if(!['template','right','batch','budget'].includes(kind))throw new BizError(1001,'对象无效')
   if(kind==='budget')await requireAdmin(req,['super'])
   if(kind==='template'||kind==='budget')return tx(async c=>{const table=kind==='template'?'freedom_template':'freedom_budget';await c.q(`UPDATE ${table} SET status=0 WHERE id=?`,[n]);await audit(c,actor(a),'freedom','stop',kind+'-'+n,null,{reason:why});return {stopped:true}})
   return tx(async c=>{
     if(kind==='batch'){await c.one('SELECT id FROM freedom_batch WHERE id=? FOR UPDATE',[n]);await c.q('UPDATE freedom_batch SET status=0 WHERE id=?',[n])}
     const rows=await c.q(`SELECT * FROM freedom_right WHERE ${kind==='batch'?'batch_id':'id'}=? ORDER BY id FOR UPDATE`,[n]);let revoked=0
     for(const r of rows){if(r.status!=='available')continue;await c.q("UPDATE freedom_right SET status='revoked' WHERE id=?",[r.id]);await c.q('UPDATE freedom_budget SET committed=committed-? WHERE id=?',[json(r.rule_json).discount,r.budget_id]);await c.q("INSERT INTO freedom_event(budget_id,right_id,kind,amount,biz_ref,detail) VALUES(?,?,'revoke',?,?,?)",[r.budget_id,r.id,json(r.rule_json).discount,'right-'+r.id,why]);revoked++}
     await audit(c,actor(a),'freedom','revoke',kind+'-'+n,null,{revoked,reason:why});return {revoked,note:'锁定/已使用权益保留历史履约'}
   })
 },
 'GET /admin/freedom/finance':async req=>{
   await requireAdmin(req,['super','finance']);const {page,pageSize,offset}=paging(req.query)
   return {rows:await q(`SELECT f.*,o.status order_status,o.title_dummy FROM freedom_order f JOIN (SELECT o.*,p.title title_dummy FROM orders o JOIN tour_product p ON p.id=o.product_id) o ON o.order_no=f.order_no ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,[pageSize,offset]),
     total:Number((await one('SELECT COUNT(*) n FROM freedom_order')).n),page,pageSize,payments:await q('SELECT id,order_no,direction,amount,pay_ref,reason,created_at FROM freedom_payment ORDER BY id DESC LIMIT 100'),events:await q('SELECT * FROM freedom_event ORDER BY id DESC LIMIT 200')}
 },
 'POST /admin/freedom/receipt-upload':async req=>{await requireAdmin(req,['super','finance']);return uploadReceipt(req.body)},
 'POST /admin/freedom/pay':async req=>{
   const a=await requireAdmin(req,['super','finance']),no=String(req.body.orderNo||''),ref=String(req.body.payRef||'').trim(),why=reason(req.body),amt=integer(req.body.amount),direction=Number(req.body.direction)
   if(![1,-1].includes(direction)||!/^[-\w]{6,64}$/.test(ref)||!validReceipt(req.body.receiptUrl))throw new BizError(1001,'填写真实流水、方向和已上传回单')
   readReceipt(req.body.receiptUrl)
   return tx(async c=>{
     const x=await c.one('SELECT * FROM freedom_order WHERE order_no=? FOR UPDATE',[no]);if(!x)throw new BizError(1004,'补贴单不存在')
     const o=await c.one('SELECT status FROM orders WHERE order_no=?',[no]),u=await c.one('SELECT status FROM user_account WHERE id=?',[x.user_id]),m=await c.one('SELECT status FROM merchant WHERE id=?',[x.merchant_id])
     if(direction===1&&(x.status!=='used'||Number(o.status)!==50||Number(u?.status)!==1||Number(m?.status)!==1))throw new BizError(1001,'仅已完成且用户/商户正常的有效补贴单可付款')
     const paid=Number(x.paid_subsidy)+direction*amt;if(paid<0||paid>Number(x.discount))throw new BizError(1001,'付款或冲正超过可用责任余额')
     if(await c.one('SELECT id FROM freedom_payment WHERE pay_ref=?',[ref]))throw new BizError(1001,'流水已登记')
     const payId=await c.ins('INSERT INTO freedom_payment(order_no,direction,amount,pay_ref,receipt_url,reason,operator) VALUES(?,?,?,?,?,?,?)',[no,direction,amt,ref,req.body.receiptUrl,why,actor(a)]);await c.q('UPDATE freedom_order SET paid_subsidy=? WHERE order_no=?',[paid,no]);
     if(direction===-1&&x.status==='refunded'){const r=await c.one('SELECT budget_id FROM freedom_right WHERE id=?',[x.right_id]);if(await c.upd('UPDATE freedom_budget SET recovering=recovering-? WHERE id=? AND recovering>=?',[amt,r.budget_id,amt])!==1)throw new BizError(2002,'待追回预算与流水不一致，请先核对')}
     await audit(c,actor(a),'freedom',direction===1?'pay':'reverse',no,null,{payId,amount:amt,reason:why});return {id:payId,paid}
   })
 },
 'GET /admin/freedom/payments/:id/receipt':async req=>{await requireAdmin(req,['super','finance']);const p=await one('SELECT receipt_url FROM freedom_payment WHERE id=?',[id(req.params.id)]);return readReceipt(p?.receipt_url)},
 'GET /c/freedom':async req=>{
   const uid=requireUser(req).uid,pg=paging(req.query),status=String(req.query.status||'')
   if(status&&!['available','locked','used','expired','revoked'].includes(status))throw new BizError(1001,'权益状态无效')
   const rows=await f.rights(uid,null,{...pg,status}),total=Number((await one('SELECT COUNT(*) n FROM freedom_right WHERE user_id=?'+(status?' AND status=?':''),status?[uid,status]:[uid])).n)
   return {rows,total,page:pg.page,pageSize:pg.pageSize}
 },
 'POST /c/freedom/quote':async req=>{
   const u=requireUser(req),qty=Number(req.body.qty||1),sid=id(req.body.sessionId)
   if(!Number.isInteger(qty)||qty<1||qty>9)throw new BizError(1001,'人数无效')
   const s=await one('SELECT s.*,p.city_code,p.channel,p.merchant_id,p.insurance_fee,p.status product_status FROM tour_session s JOIN tour_product p ON p.id=s.product_id WHERE s.id=?',[sid])
   if(!s||Number(s.status)!==1||Number(s.product_status)!==1||!bookingOpen(s.profile))throw new BizError(1001,'团期不可售')
   const goods=priceForSession(s).price*qty,ins=req.body.insurance&&!(process.env.NODE_ENV==='production')?Number(s.insurance_fee)*qty:0,rows=await f.rights(u.uid,{...s,goods})
   const chosen=req.body.rightId?rows.find(x=>Number(x.id)===Number(req.body.rightId)):null
   if(req.body.rightId&&(!chosen||!chosen.eligible))throw new BizError(1001,chosen?.reason||'所选权益不可用')
   return {rows,goods,discount:chosen?.discount||0,insurance:ins,cashPay:goods-(chosen?.discount||0)+ins,beanDeduct:0,note:'自由豆与旅豆同单互斥，最终价格以建单为准'}
 },
}
