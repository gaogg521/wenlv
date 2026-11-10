import {assertIsolatedDb} from './_guard.mjs'
assertIsolatedDb('phase2')
import assert from 'node:assert/strict'
import {q,one,closeDb,tx} from '../src/db.mjs'
import {jwtSign} from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as promo from '../src/domain/promo.mjs'
import * as sales from '../src/domain/sales.mjs'
import * as freedom from '../src/domain/freedom.mjs'
import {fullRefund} from '../src/domain/refund.mjs'
import {bizDay} from '../src/infra/bizdate.mjs'
const base=process.env.API_BASE||'http://127.0.0.1:'+process.env.PORT
const call=async(m,p,b,t)=>(await fetch(base+p,{method:m,headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:b?JSON.stringify(b):undefined})).json()
const ok=r=>{assert.equal(r.code,0,r.msg);return r.data}
const token=uid=>jwtSign({end:'c',uid}),admin=jwtSign({end:'admin',role:'super',name:'phase2-qa'}),ops=jwtSign({end:'admin',role:'ops',name:'phase2-ops'}),ro=jwtSign({end:'admin',role:'readonly',name:'phase2-ro'})
const stamp=Date.now(),uids=[],orders=[],sessions=[],budgets=[],templates=[],subjects=[],coids=[];let passed=0,receiptUrl
async function check(name,fn){await fn();passed++;console.log('✓ '+name)}
const date=offset=>bizDay(offset)
let bid,tid,right,scene,sid,wid,ccid,cpid
const granted=(uid,status=1,rate=800)=>({promoterId:uid,productId:1,status,rateBp:rate,validFrom:date(-1)+'T00:00',validTo:date(30)+'T23:59',agreement:'QA-'+stamp,reason:'隔离库销售授权测试'})
const issue=(ids,key='qa-'+stamp)=>call('POST','/admin/freedom/issue',{templateId:tid,userIds:ids,requestKey:key,reason:'隔离库官方定向补贴测试'},admin)
async function place(uid,extra={}){const r=await order.place({userId:uid,sessionId:sid,qty:1,wantedBeans:0,...extra});orders.push(r.orderNo);return r}
try{
 for(let i=0;i<4;i++){const r=await q('INSERT INTO user_account(nickname) VALUES(?)',['phase2-'+stamp+'-'+i]);uids.push(r.insertId);await q('INSERT INTO bean_account(user_id) VALUES(?)',[r.insertId])}
 for(const uid of uids.slice(0,2))await q('INSERT INTO promoter(user_id,tier,rate_bp,status) VALUES(?,1,500,1)',[uid])
 const s=await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(1,?,100,1,19900,1)',[date(100)]);sid=s.insertId;sessions.push(sid)
 await check('授权仅运营/超管，费率封顶与必填有效期',async()=>{
   assert.equal((await call('POST','/admin/sales/grants',granted(uids[0]),ro)).code,1003)
   assert.equal((await call('POST','/admin/sales/grants',{...granted(uids[0]),rateBp:1201},admin)).code,1001)
   assert.equal((await call('POST','/admin/sales/grants',{...granted(uids[0]),validFrom:''},admin)).code,1001)
   ok(await call('POST','/admin/sales/grants',granted(uids[0]),admin));ok(await call('POST','/admin/sales/grants',granted(uids[1],1,650),admin))
   assert.equal((await sales.effectiveRate(uids[0],1)).rateBp,800);assert.equal((await sales.effectiveRate(uids[1],1)).rateBp,650)
 })
 await check('授权产品白名单、无成本和银行资料，未授权不可取码',async()=>{
   const d=ok(await call('GET','/c/promote/products',null,token(uids[0])));assert.equal(Number(d.rows[0].id),1);assert.ok(!JSON.stringify(d).includes('bank'));assert.ok(!('profile'in d.rows[0]))
   assert.equal((await call('POST','/c/promote/products/2/material',{},token(uids[0]))).code,6001)
   assert.equal((await call('GET','/c/promote/products?pageSize=101',null,token(uids[0]))).code,1001)
 })
 await check('产品码、冷启动定位、来源校验和微信未配状态',async()=>{
   const d=ok(await call('POST','/c/promote/products/1/material',{},token(uids[0])));scene=d.scene;assert.ok(d.path.includes('id=1'));assert.ok(scene.length<=32);if(d.mock)assert.equal(d.image,null)
   assert.equal(Number(ok(await call('GET','/c/promote/landing?scene='+scene,null,token(uids[2]))).productId),1)
   assert.equal((await call('POST','/c/promote/visit',{productId:2,scene},token(uids[2]))).code,1001)
   assert.equal((await call('POST','/c/promote/visit',{productId:1,scene:'pfake'},token(uids[2]))).code,1001)
   assert.equal(Number(ok(await call('POST','/c/promote/visit',{productId:1,scene},token(uids[2]))).productId),1)
 })
 await check('官方预算仅超管批准，满减规则与金额有效',async()=>{
   assert.equal((await call('POST','/admin/freedom/budgets',{name:'qa',total:100000,reason:'隔离测试预算'},ops)).code,1003)
   bid=ok(await call('POST','/admin/freedom/budgets',{name:'phase2-'+stamp,total:100000,reason:'隔离测试预算来源'},admin)).id;budgets.push(bid)
   const rule={name:'自由豆·满100减50',budgetId:bid,threshold:10000,discount:5000,from:date(-1)+'T00:00',to:date(30)+'T23:59',products:[1],perUser:3,daily:2,reason:'隔离库补贴规则测试'}
   assert.equal((await call('POST','/admin/freedom/templates',{...rule,discount:10000},admin)).code,1001)
   assert.equal((await call('POST','/admin/freedom/templates',{...rule,from:''},admin)).code,1001)
   tid=ok(await call('POST','/admin/freedom/templates',rule,admin)).id;templates.push(tid)
 })
 await check('发放幂等、接收人快照、预占最大责任且拒绝预算不足',async()=>{
   const r=ok(await issue([uids[2],uids[3]]));assert.equal(r.count,2);assert.equal(ok(await issue([uids[2],uids[3]])).repeated,true)
   assert.equal(Number((await one('SELECT committed FROM freedom_budget WHERE id=?',[bid])).committed),10000)
   assert.equal((await issue([uids[2]],'qa-'+stamp)).code,1001)
   await q('UPDATE freedom_budget SET total=10000 WHERE id=?',[bid]);assert.equal((await issue([uids[2]],'qa-low-'+stamp)).code,1001);await q('UPDATE freedom_budget SET total=100000 WHERE id=?',[bid])
   right=Number((await one('SELECT id FROM freedom_right WHERE user_id=? AND template_id=?',[uids[2],tid])).id)
 })
 await check('99不可用、100→50、199→149；门槛不含保费',async()=>{
   for(const [price,pay]of [[9900,null],[10000,5000],[19900,14900]]){
    await q('UPDATE tour_session SET price_adult=? WHERE id=?',[price,sid]);const r=await call('POST','/c/freedom/quote',{sessionId:sid,qty:1,rightId:right},token(uids[2]));if(pay==null)assert.equal(r.code,1001);else assert.equal(ok(r).cashPay,pay)
   }
   const obj={status:'available',rule_json:{name:'test',from:date(-1)+' 00:00:00',to:date(2)+' 00:00:00',threshold:10000,discount:5000,products:[],cities:[],channels:[],dates:[]}};assert.ok(freedom.reasonFor(obj,{goods:9900,insurance_fee:1000}).includes('门槛'))
 })
 // D01：自由豆与旅豆同单可用、独立记账；余额不足按实际少抵（0 豆照常）；跨用户盗用仍拒绝且库存不变
 await check('自由豆旅豆同单不再互斥（余额少抵），跨用户盗用拒绝且库存不变',async()=>{
   const before=(await one('SELECT booked FROM tour_session WHERE id=?',[sid])).booked
   const r=await place(uids[2],{wantedBeans:9999,freedomRightId:right});assert.equal(r.beanDeducted,0);assert.equal(r.amountPay,14900)
   await assert.rejects(()=>place(uids[3],{freedomRightId:right}),/不属于本人/)
   assert.equal((await one('SELECT booked FROM tour_session WHERE id=?',[sid])).booked,before+1)
   await order.closeUnpaid(r.orderNo,'test-d01') // 释放权益，供后续并发/取消用例继续使用
 })
 let no
 await check('并发建单同一权益只成功一次，失败无占位和孤儿单',async()=>{
   const before=Number((await one('SELECT booked FROM tour_session WHERE id=?',[sid])).booked)
   const r=await Promise.allSettled([place(uids[2],{freedomRightId:right,promoScene:scene}),place(uids[2],{freedomRightId:right,promoScene:scene})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);no=r.find(x=>x.status==='fulfilled').value.orderNo;assert.equal(Number((await one('SELECT booked FROM tour_session WHERE id=?',[sid])).booked),before+1)
   assert.equal(Number((await one('SELECT committed FROM freedom_budget WHERE id=?',[bid])).committed),10000)
 })
 await check('取消/超时释放原权益且重复关闭幂等',async()=>{
   await order.closeUnpaid(no,'test');await order.closeUnpaid(no,'test');assert.equal((await one('SELECT status FROM freedom_right WHERE id=?',[right])).status,'available');assert.equal(Number((await one("SELECT COUNT(*) n FROM freedom_event WHERE biz_ref=? AND kind='release'",[no])).n),1)
 })
 await check('付款重复回调只用一次；实付149、预算承诺转已用',async()=>{
   const o=await place(uids[2],{freedomRightId:right,promoScene:scene});no=o.orderNo;assert.equal(o.amountPay,14900)
   await order.acceptPayment(no,'P2-'+stamp,true);await order.acceptPayment(no,'P2-'+stamp,true)
   assert.equal((await one('SELECT status FROM freedom_right WHERE id=?',[right])).status,'used');const b=await one('SELECT committed,used FROM freedom_budget WHERE id=?',[bid]);assert.equal(Number(b.committed),5000);assert.equal(Number(b.used),5000)
 })
 await check('授权费率和首触快照，后改费率不改老单；佣金只按现金',async()=>{
   ok(await call('POST','/admin/sales/grants',granted(uids[0],1,1000),admin));await promo.createCommission(no)
   const c=await one('SELECT rate_bp,base_amount,amount FROM commission WHERE order_id=(SELECT id FROM orders WHERE order_no=?)',[no]);assert.equal(c.rate_bp,800);assert.equal(Number(c.base_amount),14900);assert.equal(Number(c.amount),1192)
   await promo.createCommission(no);assert.equal(Number((await one('SELECT COUNT(*) n FROM commission WHERE order_id=(SELECT id FROM orders WHERE order_no=?)',[no])).n),1)
 })
 await check('单商户补贴付款守卫、真实回单和重复流水',async()=>{
   receiptUrl=ok(await call('POST','/admin/freedom/receipt-upload',{ext:'pdf',data:Buffer.from('%PDF-1.4\n% isolated QA fixture').toString('base64')},admin)).url
   const body={orderNo:no,direction:1,amount:5000,payRef:'P2SUB-'+stamp,receiptUrl,reason:'隔离库模拟补贴付款证据'}
   assert.equal((await call('POST','/admin/freedom/pay',body,admin)).code,1001)
   await q('UPDATE orders SET status=50 WHERE order_no=?',[no]);ok(await call('POST','/admin/freedom/pay',body,admin));assert.equal((await call('POST','/admin/freedom/pay',body,admin)).code,1001)
   const d=ok(await call('GET','/admin/freedom/finance',null,admin));assert.ok(d.rows.some(x=>x.order_no===no));await q('UPDATE orders SET status=30 WHERE order_no=?',[no])
 })
 await check('全退只退149，补贴冲正，已付款保留追偿，不混旅豆',async()=>{
   const bean=await one('SELECT balance FROM bean_account WHERE user_id=?',[uids[2]]);await fullRefund({orderNo:no,reason:'隔离库全额退款测试',operator:'phase2-qa'})
   const r=await one('SELECT r.amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE o.order_no=?',[no]);assert.equal(Number(r.amount),14900)
   assert.equal((await one('SELECT status FROM freedom_right WHERE id=?',[right])).status,'available')
   const f=await one('SELECT status,paid_subsidy FROM freedom_order WHERE order_no=?',[no]);assert.equal(f.status,'refunded');assert.equal(Number(f.paid_subsidy),5000);assert.equal((await one('SELECT balance FROM bean_account WHERE user_id=?',[uids[2]])).balance,bean.balance)
   assert.equal(Number((await one('SELECT used FROM freedom_budget WHERE id=?',[bid])).used),0)
   const view=ok(await call('GET','/c/orders/'+no,null,token(uids[2])));assert.equal(Number(view.freedom.discount),5000);assert.equal((await call('GET','/c/orders/'+no,null,token(uids[3]))).code,2003)
 })
 await check('预算及权益暂停、过期退款不延长、撤销重复不扣两次',async()=>{
   const r=await place(uids[2],{freedomRightId:right});await order.acceptPayment(r.orderNo,'P2EXP-'+stamp,true)
   await q("UPDATE freedom_right SET rule_json=JSON_SET(rule_json,'$.to',?) WHERE id=?",[date(-1)+' 00:00:00',right]);await fullRefund({orderNo:r.orderNo,reason:'过期原券退款',operator:'phase2-qa'});assert.equal((await one('SELECT status FROM freedom_right WHERE id=?',[right])).status,'expired')
   const otherRight=Number((await one('SELECT id FROM freedom_right WHERE user_id=? AND template_id=?',[uids[3],tid])).id)
   ok(await call('POST','/admin/freedom/status',{kind:'right',id:otherRight,reason:'隔离库撤销未使用补贴'},admin));ok(await call('POST','/admin/freedom/status',{kind:'right',id:otherRight,reason:'隔离库重复撤销幂等测试'},admin));assert.equal(Number((await one('SELECT committed FROM freedom_budget WHERE id=?',[bid])).committed),0)
 })
 await check('已付后退款继续占用预算，实际追回后释放现金占用',async()=>{
   assert.equal(Number((await one('SELECT recovering FROM freedom_budget WHERE id=?',[bid])).recovering),5000)
   const body={orderNo:no,direction:-1,amount:5000,payRef:'P2REC-'+stamp,receiptUrl,reason:'隔离库实际追回补贴模拟证据'}
   ok(await call('POST','/admin/freedom/pay',body,admin));assert.equal(Number((await one('SELECT recovering FROM freedom_budget WHERE id=?',[bid])).recovering),0)
   assert.equal((await call('POST','/admin/freedom/pay',{...body,payRef:'P2REC2-'+stamp},admin)).code,1001)
 })
 await check('模板版本只影响未来发券、每日使用上限与批次撤销释放',async()=>{
   const t=await one('SELECT rule_json FROM freedom_template WHERE id=?',[tid]),r=sales.json(t.rule_json)
   ok(await call('POST','/admin/freedom/templates',{...r,id:tid,budgetId:bid,discount:4000,daily:1,perUser:4,name:'新版官方补贴',reason:'隔离库未来模板版本变更'},admin))
   assert.equal(sales.json((await one('SELECT rule_json FROM freedom_right WHERE id=?',[right])).rule_json).discount,5000)
   const b1=ok(await issue([uids[3]],'qa-cap-a-'+stamp)),b2=ok(await issue([uids[3]],'qa-cap-b-'+stamp))
   const rr=await q('SELECT id,batch_id,rule_json FROM freedom_right WHERE batch_id IN (?,?) ORDER BY id',[b1.id,b2.id]);assert.equal(sales.json(rr[0].rule_json).discount,4000)
   const o=await place(uids[3],{freedomRightId:rr[0].id});await assert.rejects(()=>place(uids[3],{freedomRightId:rr[1].id}),/每日/)
   ok(await call('POST','/admin/freedom/status',{kind:'batch',id:b1.id,reason:'隔离库撤销整批未用权益'},admin));await order.closeUnpaid(o.orderNo,'batch-revoked')
   assert.equal((await one('SELECT status FROM freedom_right WHERE id=?',[rr[0].id])).status,'revoked')
   await q('UPDATE freedom_budget SET status=0 WHERE id=?',[bid]);await assert.rejects(()=>place(uids[3],{freedomRightId:rr[1].id}),/预算已暂停/);await q('UPDATE freedom_budget SET status=1 WHERE id=?',[bid])
 })
 await check('撤权到期阻止新取码，已有订单快照保留，自购无佣金',async()=>{
   ok(await call('POST','/admin/sales/grants',granted(uids[0],0),admin));assert.equal((await call('POST','/c/promote/products/1/material',{},token(uids[0]))).code,6001);assert.equal((await call('GET','/c/promote/landing?scene='+scene,null,token(uids[3]))).code,6001)
   ok(await call('POST','/admin/sales/grants',granted(uids[0]),admin));const self=await place(uids[0],{promoScene:scene});assert.equal(await promo.createCommission(self.orderNo),false)
   assert.ok((await one('SELECT promo_snapshot FROM orders WHERE order_no=?',[no])).promo_snapshot)
 })
 await check('佣金本人分页与跨端/分页/状态越权拒绝',async()=>{
   const d=ok(await call('GET','/c/promote/commissions?page=1&pageSize=1',null,token(uids[0])));assert.ok(d.total>=1);assert.ok(d.rows.length<=1)
   assert.equal(ok(await call('GET','/c/promote/commissions',null,token(uids[1]))).total,0)
   assert.equal((await call('GET','/c/promote/commissions?status=88',null,token(uids[0]))).code,1001)
   assert.equal((await call('GET','/c/promote/commissions',null,jwtSign({end:'m',uid:uids[0]}))).code,1003)
 })
 await check('并发提现只有一笔，待付款持续占用不重复申请',async()=>{
   const ord=await place(uids[3]);const oid=(await one('SELECT id FROM orders WHERE order_no=?',[ord.orderNo])).id
   await q('INSERT INTO commission(order_id,promoter_id,base_amount,rate_bp,amount,status) VALUES(?,?,200000,1000,20000,1)',[oid,uids[0]])
   const results=await Promise.all([call('POST','/c/promote/withdraw',{},token(uids[0])),call('POST','/c/promote/withdraw',{},token(uids[0]))]);assert.equal(results.filter(x=>x.code===0).length,1);wid=ok(results.find(x=>x.code===0)).id
   ok(await call('POST','/admin/withdrawals/'+wid+'/review',{pass:true,note:'余额及来源核对通过'},admin));const w=ok(await call('GET','/c/promote/withdrawals/'+wid,null,token(uids[0])));assert.equal(w.status,3);assert.equal(w.paidAt,null)
   assert.equal((await call('POST','/c/promote/withdraw',{},token(uids[0]))).code,6001);assert.equal(ok(await call('GET','/c/promote/overview',null,token(uids[0]))).withdrawable,0)
 })
 await check('冻结暂停付款/本人回单，解冻可付款但不宣称到账',async()=>{
   const body={payRef:'P2WD-'+stamp,receiptUrl,note:'隔离库模拟实际付款登记'};await q('UPDATE user_account SET status=0 WHERE id=?',[uids[0]])
   assert.equal((await call('POST','/admin/withdrawals/'+wid+'/pay',body,admin)).code,6001);await q('UPDATE user_account SET status=1 WHERE id=?',[uids[0]])
   ok(await call('POST','/admin/withdrawals/'+wid+'/pay',body,admin));const w=ok(await call('GET','/c/promote/withdrawals/'+wid,null,token(uids[0])));assert.equal(w.status,1);assert.ok(w.paidAt)
   assert.equal((await call('GET','/c/promote/withdrawals/'+wid,null,token(uids[1]))).code,1004);assert.equal((await call('GET','/c/promote/withdrawals/'+wid+'/receipt',null,token(uids[1]))).code,1004);assert.ok(ok(await call('GET','/c/promote/withdrawals/'+wid+'/receipt',null,token(uids[0]))).data)
 })
 await check('待审可本人撤销并重提，跨用户不能撤销，账户尾号不泄露全号',async()=>{
   await q('UPDATE promoter SET profile=? WHERE user_id=?',[JSON.stringify({payout_method:'bank',payout_account:'6222111122223333'}),uids[1]])
   const o=await place(uids[3]),oid=(await one('SELECT id FROM orders WHERE order_no=?',[o.orderNo])).id
   await q('INSERT INTO commission(order_id,promoter_id,base_amount,rate_bp,amount,status) VALUES(?,?,200000,1000,20000,1)',[oid,uids[1]])
   const w=ok(await call('POST','/c/promote/withdraw',{},token(uids[1]))),details=ok(await call('GET','/c/promote/withdrawals/'+w.id,null,token(uids[1])));assert.equal(details.payoutTail,'***3333');assert.ok(!JSON.stringify(details).includes('6222111122223333'))
   assert.equal((await call('POST','/c/promote/withdrawals/'+w.id+'/cancel',{},token(uids[0]))).code,1004)
   ok(await call('POST','/c/promote/withdrawals/'+w.id+'/cancel',{},token(uids[1])));const next=ok(await call('POST','/c/promote/withdraw',{},token(uids[1])));assert.notEqual(next.id,w.id)
 })
 await check('合作项目/分润按主体隔离且撤权立即生效',async()=>{
   const subject=ok(await call('POST','/admin/work-access/subjects',{name:'phase2-'+stamp},admin));subjects.push(subject.id)
   const cc=await q('INSERT INTO co_creator(product_id,co_no,name,mobile,role,invest_amount,share_pct) VALUES(1,?,?,?,1,100000,1000)',['P2'+stamp,'隔离库合作人','13800000000']);ccid=cc.insertId;coids.push(ccid)
   ok(await call('POST','/admin/work-access/resources',{subjectId:subject.id,resourceId:ccid,kind:'cocreator',reason:'隔离库核实合同归属'},admin));ok(await call('POST','/admin/work-access/grants',{subjectId:subject.id,userId:uids[2],validFrom:date(-1)+'T00:00',status:1,reason:'隔离库核实经办权限'},admin))
   const settle=await one('SELECT id FROM settlement LIMIT 1');cpid=(await q('INSERT INTO co_profit(settlement_id,co_creator_id,product_id,period,base_amount,amount) VALUES(?,?,1,?,10000,1000)',[settle.id,ccid,'P2-'+String(stamp).slice(-6)])).insertId
   await q('INSERT INTO co_profit_pay(co_profit_id,pay_ref,amount,receipt_url,operator) VALUES(?,?,1000,?,?)',[cpid,'P2CO-'+stamp,receiptUrl,'phase2-qa'])
   const rows=ok(await call('GET','/c/cooperation/'+subject.id+'/profits',null,token(uids[2]))).rows;assert.equal(Number(rows[0].id),cpid);assert.equal((await call('GET','/c/cooperation/'+subject.id+'/profits',null,token(uids[3]))).code,1003)
   assert.equal(ok(await call('GET','/c/cooperation/'+subject.id+'/projects',null,token(uids[2]))).rows[0].id,1)
   const pays=ok(await call('GET','/c/cooperation/'+subject.id+'/profits/'+cpid+'/payments',null,token(uids[2])));assert.equal(pays.rows.length,1);assert.ok(ok(await call('GET','/c/cooperation/'+subject.id+'/payments/'+pays.rows[0].id+'/receipt',null,token(uids[2]))).data)
   const feedback=ok(await call('POST','/c/cooperation/'+subject.id+'/feedback',{profitId:cpid,detail:'隔离库实际对账反馈测试'},token(uids[2])));ok(await call('POST','/admin/sales/feedback/'+feedback.id,{reply:'隔离库核对已完成，来源一致'},admin));assert.equal(ok(await call('GET','/c/cooperation/'+subject.id+'/feedback',null,token(uids[2]))).rows[0].status,1)
   await q('UPDATE subject_grant SET status=0 WHERE subject_id=?',[subject.id]);assert.equal((await call('GET','/c/cooperation/'+subject.id+'/payments/'+pays.rows[0].id+'/receipt',null,token(uids[2]))).code,1003)
 })
 await check('游客微信历史冲突拒绝自动合并',async()=>{const code='mock-p2-conflict-'+stamp;await q('UPDATE user_account SET mini_a_openid=? WHERE id=?',['mock-openid-'+code,uids[2]]);await q('UPDATE user_account SET unionid=? WHERE id=?',['mock-union-'+code,uids[3]]);assert.equal((await call('POST','/c/auth/login',{code},'')).code,1003)})
 console.log('第二批专项 '+passed+'/'+passed+' 通过')
}finally{
 if(cpid){await q('DELETE FROM cooperation_feedback WHERE co_profit_id=?',[cpid]);await q('DELETE FROM co_profit_pay WHERE co_profit_id=?',[cpid]);await q('DELETE FROM co_profit WHERE id=?',[cpid])}
 if(coids.length)await q('DELETE FROM co_creator WHERE id IN (?)',[coids])
 if(subjects.length){await q('DELETE FROM subject_grant WHERE subject_id IN (?)',[subjects]);await q('DELETE FROM subject_resource WHERE subject_id IN (?)',[subjects]);await q('DELETE FROM business_subject WHERE id IN (?)',[subjects])}
 if(uids.length){
  await q('DELETE p FROM promoter_pay_ref p JOIN promoter_withdraw w ON w.id=p.withdraw_id WHERE w.promoter_id IN (?)',[uids]);await q('DELETE FROM promoter_withdraw WHERE promoter_id IN (?)',[uids]);await q('DELETE FROM promoter_product WHERE promoter_id IN (?)',[uids])
  await q('DELETE FROM freedom_event WHERE budget_id IN (?)',[budgets.length?budgets:[0]]);await q('DELETE FROM freedom_payment WHERE order_no IN (SELECT order_no FROM orders WHERE user_id IN (?))',[uids]);await q('DELETE FROM freedom_order WHERE user_id IN (?)',[uids]);await q('DELETE FROM freedom_right WHERE user_id IN (?)',[uids]);if(templates.length){await q('DELETE FROM freedom_batch WHERE template_id IN (?)',[templates]);await q('DELETE FROM freedom_template WHERE id IN (?)',[templates])}if(budgets.length)await q('DELETE FROM freedom_budget WHERE id IN (?)',[budgets])
  await q('DELETE h FROM attribution_hit h JOIN attribution a ON a.scene=h.scene WHERE a.promoter_id IN (?)',[uids]);await q('DELETE FROM attribution WHERE promoter_id IN (?)',[uids])
  for(const table of ['commission','payment','refunds','travel_pass','order_event'])await q(`DELETE FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))`,[uids])
  await q('DELETE FROM orders WHERE user_id IN (?)',[uids]);await q('DELETE FROM promoter WHERE user_id IN (?)',[uids]);await q('DELETE FROM bean_account WHERE user_id IN (?)',[uids]);await q('DELETE FROM user_account WHERE id IN (?)',[uids])
 }
 if(sessions.length)await q('DELETE FROM tour_session WHERE id IN (?)',[sessions])
 await closeDb()
}
