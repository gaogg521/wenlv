import { q, one, tx, BizError } from '../db.mjs'
import { requireUser } from '../auth.mjs'
import { requireAdmin, audit, apiImg } from './_shared.mjs'
import { bookingNow, validDeadline, bookingOpenSql } from '../domain/booking-window.mjs'
import * as sales from '../domain/sales.mjs'
import { cfgNum, cfgAll } from '../config.mjs'
import { priceForSession } from '../domain/order.mjs'
import { annotateSessions } from '../domain/discount.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import { attest } from '../domain/attest.mjs'
import { subjectContexts } from './work-access.mjs'
import { uploadReceipt,readReceipt,validReceipt } from '../domain/private-receipt.mjs'
const {id,paging}=sales
const note=b=>{const s=String(b.note||b.reason||'').trim();if(s.length<4||s.length>300)throw new BizError(1001,'请填写4–300字办理原因');return s}
const wdPublic=w=>({id:w.id,amount:w.amount,status:w.status,createdAt:w.created_at,reviewedAt:w.reviewed_at,paidAt:w.paid_at,paidBy:w.paid_by,reason:w.review_note||'',hasReceipt:!!w.receipt_url,payRef:w.pay_ref||null,note:w.proposer_note,payoutTail:w.payout_tail?'***'+w.payout_tail:null,payoutMethod:w.payout_method||null})
function timeFilters(query,col,conds,args){
 for(const[key,op]of [['from','>='],['to','<=']])if(query[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(query[key])||!validDeadline(query[key]+' 00:00:00'))throw new BizError(1001,'日期无效');conds.push(`DATE(${col})${op}?`);args.push(query[key])}
}
export async function withdrawalBalance(c,uid,lock=false) {
 if(lock)await c.q('SELECT id FROM commission WHERE promoter_id=? ORDER BY id FOR UPDATE',[uid])
 const agg=await c.one('SELECT COALESCE(SUM(CASE WHEN status IN (1,2) THEN amount ELSE 0 END),0) earned,COALESCE(SUM(CASE WHEN status=0 THEN amount ELSE 0 END),0) observing FROM commission WHERE promoter_id=?',[uid])
 const w=await c.one('SELECT COALESCE(SUM(CASE WHEN status=1 THEN amount ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN status IN (0,3) THEN amount ELSE 0 END),0) occupied,SUM(status IN (0,3)) pending FROM promoter_withdraw WHERE promoter_id=?',[uid])
 return {earned:Number(agg.earned),observing:Number(agg.observing),withdrawn:Number(w.paid),occupied:Number(w.occupied),pendingRequests:Number(w.pending||0),withdrawable:Math.max(0,Number(agg.earned)-Number(w.paid)-Number(w.occupied)),debt:Math.max(0,Number(w.paid)-Number(agg.earned))}
}
async function subject(req) {
 const u=requireUser(req),sid=id(req.params.sid),s=(await subjectContexts(u.uid)).find(x=>Number(x.id)===sid)
 if(!s)throw new BizError(1003,'合作主体未授权或已失效')
 return {uid:u.uid,sid,subject:s}
}
async function profitFor(sid,pid) {
 const p=await one(`SELECT cp.id FROM co_profit cp JOIN subject_resource r ON r.kind='cocreator' AND r.resource_id=cp.co_creator_id WHERE r.subject_id=? AND cp.id=?`,[sid,pid]);if(!p)throw new BizError(1003,'分润单不属于该主体');return p
}
async function wdAction(req,action) {
 const a=await requireAdmin(req,['super','finance']),wid=id(req.params.id),why=note(req.body)
 const ref=await one('SELECT promoter_id FROM promoter_withdraw WHERE id=?',[wid]);if(!ref)throw new BizError(1004,'申请不存在')
 return tx(async c=>{
   // 所有申请/审批/支付按推广员→提现单同一锁顺序。
   await c.one('SELECT user_id FROM promoter WHERE user_id=? FOR UPDATE',[ref.promoter_id])
   const w=await c.one('SELECT * FROM promoter_withdraw WHERE id=? FOR UPDATE',[wid])
   if(action==='reject'){
     if(![0,3].includes(Number(w.status)))throw new BizError(1001,'申请已处理')
     await c.q('UPDATE promoter_withdraw SET status=2,review_note=?,reviewed_at=NOW(3),reviewed_by=? WHERE id=?',[why,'admin:'+a.name,wid])
   }else{
     await sales.promoter(w.promoter_id,c)
     const balance=await withdrawalBalance(c,w.promoter_id,true)
     if(balance.earned-balance.withdrawn<balance.occupied)throw new BizError(6001,'退款冲正后余额不足，暂停付款，请核对并驳回后重新申请')
     if(action==='approve'){
       if(Number(w.status)!==0)throw new BizError(1001,'申请已处理')
       await c.q('UPDATE promoter_withdraw SET status=3,review_note=?,reviewed_at=NOW(3),reviewed_by=? WHERE id=?',[why,'admin:'+a.name,wid])
     }else{
       const legacy=action==='legacy-pay'
       if(Number(w.status)!==(legacy?0:3))throw new BizError(1001,'请先完成审批，再登记实际付款')
       const payRef=String(req.body.payRef||'').trim(),receipt=req.body.receiptUrl||null
       if(!/^[\w-]{6,64}$/.test(payRef))throw new BizError(1001,'请填写真实打款流水号')
       if(!legacy&&!validReceipt(receipt))throw new BizError(1001,'上传真实回单后登记付款')
       if(receipt)readReceipt(receipt)
       if(await c.one('SELECT pay_ref FROM promoter_pay_ref WHERE pay_ref=?',[payRef]))throw new BizError(1001,'打款流水已登记')
       await c.q('INSERT INTO promoter_pay_ref(pay_ref,withdraw_id) VALUES(?,?)',[payRef,wid])
       await c.q('UPDATE promoter_withdraw SET status=1,pay_ref=?,paid_at=NOW(3),paid_by=?,receipt_url=?,review_note=? WHERE id=?',[payRef,'admin:'+a.name,receipt,why,wid])
     }
   }
   const status=action==='reject'?2:action==='approve'?3:1
   await audit(c,'admin:'+a.name,'withdraw',action==='legacy-pay'?'pay':action,'wd-'+wid,{status:w.status},{status,reason:why,amount:w.amount})
   await attest('withdraw','wd-'+wid,{promoterUserId:Number(w.promoter_id),amountFen:Number(w.amount),result:status===3?'approved_pending_payment':status===2?'rejected':'paid'},c,status===3?3:status===2?2:4)
   return {status}
 })
}
export const salesRoutes={
 'GET /admin/sales/grants':async req=>{await requireAdmin(req,['super','ops','finance']);const {page,pageSize,offset}=paging(req.query);return {rows:await q('SELECT g.*,p.title,u.nickname FROM promoter_product g JOIN tour_product p ON p.id=g.product_id JOIN user_account u ON u.id=g.promoter_id ORDER BY g.id DESC LIMIT ? OFFSET ?',[pageSize,offset]),total:Number((await one('SELECT COUNT(*) n FROM promoter_product')).n),page,pageSize}},
 'POST /admin/sales/grants':async req=>{
   const a=await requireAdmin(req,['super','ops']),uid=id(req.body.promoterId),pid=id(req.body.productId),status=Number(req.body.status),rate=req.body.rateBp==null||req.body.rateBp===''?null:Number(req.body.rateBp),from=String(req.body.validFrom||'').replace('T',' '),to=String(req.body.validTo||'').replace('T',' '),agreement=String(req.body.agreement||'').trim(),why=note(req.body)
   if(![0,1].includes(status)||(rate!=null&&(!Number.isInteger(rate)||rate<0||rate>1200))||!from||!to||!validDeadline(from)||!validDeadline(to)||to<=from||!agreement||agreement.length>120)throw new BizError(1001,'授权状态、有效期、费率（0–1200bp）或协议号无效')
   return tx(async c=>{await sales.promoter(uid,c);if(!await c.one('SELECT id FROM tour_product WHERE id=?',[pid]))throw new BizError(1004,'产品不存在');const old=await c.one('SELECT * FROM promoter_product WHERE promoter_id=? AND product_id=? FOR UPDATE',[uid,pid]);await c.q(`INSERT INTO promoter_product(promoter_id,product_id,status,rate_bp,valid_from,valid_to,agreement,reason) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),rate_bp=VALUES(rate_bp),valid_from=VALUES(valid_from),valid_to=VALUES(valid_to),agreement=VALUES(agreement),reason=VALUES(reason)`,[uid,pid,status,rate,from,to,agreement,why]);await audit(c,'admin:'+a.name,'sales','grant',uid+'-'+pid,old,{status,rate,from,to,agreement,reason:why});return {saved:true}})
 },
 'GET /c/promote/products':async req=>{
   const u=requireUser(req);await sales.promoter(u.uid);const {page,pageSize,offset}=paging(req.query),now=bookingNow()
   const cond='g.promoter_id=? AND g.status=1 AND g.valid_from<=? AND g.valid_to>? AND p.status=1 AND m.status=1',args=[u.uid,now,now]
   const rows=await q(`SELECT p.id,p.title,p.images,p.days_desc,p.city_code,p.channel,g.valid_from,g.valid_to FROM promoter_product g JOIN tour_product p ON p.id=g.product_id JOIN merchant m ON m.id=p.merchant_id WHERE ${cond} ORDER BY g.id DESC LIMIT ? OFFSET ?`,[...args,pageSize,offset])
   for(const p of rows){p.cover=apiImg(sales.json(p.images)?.[0]||'',req);delete p.images;p.rate=await sales.effectiveRate(u.uid,p.id)
     const sess=await q(`SELECT s.id,s.depart_date,s.price_adult,s.early_days,s.early_price,s.quota-s.booked left_seats FROM tour_session s WHERE s.product_id=? AND s.status=1 AND s.depart_date>=CURDATE() AND ${bookingOpenSql('s')} ORDER BY depart_date LIMIT 30`,[p.id,now])
     // D01：推广素材与工作台价格同源（早鸟/折扣统一试算），命中折扣附 promo 摘要
     const hits=await annotateSessions(sess,{product_id:p.id,city_code:p.city_code,channel:p.channel},now)
     p.sessions=sess.map((s,i)=>({...s,priceNow:hits[i]?.price?hits[i].price.unitFen:priceForSession(s).price,
       promo:hits[i]?.rule?{name:hits[i].rule.name,zhe:Number(hits[i].rule.discount_bp)/1000,type:hits[i].price.type}:null}))
     p.note='授权仅决定推广资格，产品公开售价及首触归因保持原规则'}
   return {rows,total:Number((await one(`SELECT COUNT(*) n FROM promoter_product g JOIN tour_product p ON p.id=g.product_id JOIN merchant m ON m.id=p.merchant_id WHERE ${cond}`,args)).n),page,pageSize}
 },
 'POST /c/promote/products/:id/material':async req=>{
   const u=requireUser(req),pid=id(req.params.id),g=await sales.authorizedProduct(u.uid,pid),scene=await sales.productScene(u.uid,pid,req.body.channel||'mini'),path='/package-tour/pages/detail/index?id='+pid+'&scene='+scene
   const p=await one('SELECT title,images,city_code,channel FROM tour_product WHERE id=?',[pid]),available=await q(`SELECT s.price_adult,s.early_days,s.early_price,s.depart_date FROM tour_session s WHERE s.product_id=? AND s.status=1 AND s.depart_date>=CURDATE() AND s.quota>s.booked AND ${bookingOpenSql('s')}`,[pid,bookingNow()])
   // D01：分享文案价格与建单试算同源（早鸟/折扣取最低有效单价）
   const hits=available.length?await annotateSessions(available,{product_id:pid,city_code:p.city_code,channel:p.channel}):[]
   const prices=hits.map(h=>h?.price?h.price.unitFen:null).filter(v=>v!=null),s={price:prices.length?Math.min(...prices):null}
   const {buffer,mock}=await wxapi.getUnlimitedQRCode(scene,'package-tour/pages/detail/index')
   return {productId:pid,title:p.title,scene,path,cover:apiImg(sales.json(p.images)?.[0]||'',req),price:s?.price||null,image:buffer?.toString('base64')||null,mock,validTo:g.valid_to,
     text:p.title+(s?.price?' · ¥'+(Number(s.price)/100).toFixed(2)+'起（以实时团期价格为准）':''),note:mock?'微信小程序码待配置，分享卡片可使用；没有生成模拟码':'小程序码已生成；价格以实时订单为准，停售或授权到期后来源失效。'}
 },
 'GET /c/promote/landing':async req=>{
   const scene=String(req.query.scene||''),a=await one('SELECT product_id FROM attribution WHERE scene=?',[scene]);if(!a?.product_id)throw new BizError(1001,'产品推广码无效')
   await sales.source(scene,a.product_id);return {productId:a.product_id,scene}
 },
 'POST /c/promote/visit':async req=>{
   const u=requireUser(req),pid=id(req.body.productId),scene=String(req.body.scene||''),src=await sales.source(scene,pid)
   if(!src||src.merchantId)return {recorded:false}
   return tx(async c=>{await c.one('SELECT id FROM user_account WHERE id=? FOR UPDATE',[u.uid]);await c.q('INSERT IGNORE INTO attribution_hit(scene,user_id) VALUES(?,?)',[scene,u.uid]);return {recorded:true,productId:src.product_id||null,note:'推广来源不等于最终计佣归属，仍按首触唯一计算'}})
 },
 'GET /c/promote/commissions':async req=>{
   const u=requireUser(req),{page,pageSize,offset}=paging(req.query),conds=['c.promoter_id=?'],args=[u.uid]
   if(req.query.status!==undefined&&req.query.status!==''){const st=Number(req.query.status);if(![0,1,2,3,4].includes(st))throw new BizError(1001,'状态无效');conds.push('c.status=?');args.push(st)}
   if(req.query.productId){conds.push('o.product_id=?');args.push(id(req.query.productId))}
   for(const [key,op]of [['from','>='],['to','<=']])if(req.query[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(req.query[key])||!validDeadline(req.query[key]+' 00:00:00'))throw new BizError(1001,'日期无效');conds.push('DATE(o.paid_at)'+op+'?');args.push(req.query[key])}
   const from='FROM commission c JOIN orders o ON o.id=c.order_id JOIN tour_product p ON p.id=o.product_id WHERE '+conds.join(' AND ')
   const summary=await one(`SELECT COALESCE(SUM(IF(c.status IN (0,1,2),c.base_amount,0)),0) gmv,SUM(c.status IN (0,1,2)) validOrders,COALESCE(SUM(IF(c.status=0,c.amount,0)),0) observing,COALESCE(SUM(IF(c.status IN (1,2),c.amount,0)),0) released,COALESCE(SUM(IF(c.status IN (3,4),c.amount,0)),0) reversed ${from}`,args)
   return {rows:await q(`SELECT c.id,c.base_amount,c.rate_bp,c.amount,c.status,c.payable_at,o.order_no,p.title,o.paid_at ${from} ORDER BY c.id DESC LIMIT ? OFFSET ?`,[...args,pageSize,offset]),total:Number((await one('SELECT COUNT(*) n '+from,args)).n),page,pageSize,summary}
 },
 'GET /c/promote/withdrawals':async req=>{const uid=requireUser(req).uid,{page,pageSize,offset}=paging(req.query),conds=['promoter_id=?'],args=[uid];timeFilters(req.query,'created_at',conds,args);if(req.query.status!==undefined&&req.query.status!==''){const st=Number(req.query.status);if(![0,1,2,3].includes(st))throw new BizError(1001,'状态无效');conds.push('status=?');args.push(st)}const where=' WHERE '+conds.join(' AND ');return {rows:(await q('SELECT * FROM promoter_withdraw'+where+' ORDER BY id DESC LIMIT ? OFFSET ?',[...args,pageSize,offset])).map(wdPublic),total:Number((await one('SELECT COUNT(*) n FROM promoter_withdraw'+where,args)).n),page,pageSize}},
 'GET /c/promote/withdrawals/:id':async req=>{const w=await one('SELECT * FROM promoter_withdraw WHERE id=? AND promoter_id=?',[id(req.params.id),requireUser(req).uid]);if(!w)throw new BizError(1004,'申请不存在');return wdPublic(w)},
 'GET /c/promote/withdrawals/:id/receipt':async req=>{const w=await one('SELECT receipt_url FROM promoter_withdraw WHERE id=? AND promoter_id=?',[id(req.params.id),requireUser(req).uid]);return readReceipt(w?.receipt_url)},
 'POST /c/promote/withdrawals/:id/cancel':async req=>{
   const uid=requireUser(req).uid,wid=id(req.params.id)
   return tx(async c=>{await c.one('SELECT user_id FROM promoter WHERE user_id=? FOR UPDATE',[uid]);const w=await c.one('SELECT id,status FROM promoter_withdraw WHERE id=? AND promoter_id=? FOR UPDATE',[wid,uid]);if(!w)throw new BizError(1004,'申请不存在');if(Number(w.status)!==0)throw new BizError(1001,'仅待审申请可由本人撤销，请联系财务处理其他状态');await c.q("UPDATE promoter_withdraw SET status=2,review_note='申请人主动撤销',reviewed_by=?,reviewed_at=NOW(3) WHERE id=?",['user:'+uid,wid]);await audit(c,'user:'+uid,'withdraw','cancel','wd-'+wid,{status:0},{status:2});return {cancelled:true}})
 },
 'POST /c/promote/withdraw':async req=>{
   const uid=requireUser(req).uid;const conf=await cfgAll();if(String(conf['feature.withdraw']).includes('off'))throw new BizError(1003,'提现入口维护中')
   return tx(async c=>{
     await c.one('SELECT user_id FROM promoter WHERE user_id=? FOR UPDATE',[uid]);await sales.promoter(uid,c)
     const b=await withdrawalBalance(c,uid,true),min=await cfgNum('promoter.withdraw_min');if(b.pendingRequests)throw new BizError(6001,'已有待审或待付款申请，请勿重复提交')
     if(b.withdrawable<min||b.withdrawable<=0)throw new BizError(6001,'可提现余额不足最低门槛')
     const cap=await cfgNum('promoter.withdraw_daily_max'),today=await c.one('SELECT COALESCE(SUM(amount),0) n FROM promoter_withdraw WHERE promoter_id=? AND status IN (0,1,3) AND created_at>=CURDATE()',[uid]);if(cap>0&&Number(today.n)+b.withdrawable>cap)throw new BizError(6001,'超出单日提现限额')
     const pf=sales.json((await c.one('SELECT profile FROM promoter WHERE user_id=?',[uid])).profile),wid=await c.ins('INSERT INTO promoter_withdraw(promoter_id,amount,proposer_note,payout_tail,payout_method) VALUES(?,?,?,?,?)',[uid,b.withdrawable,String(req.body.note||'').slice(0,128),pf.payout_account?String(pf.payout_account).slice(-4):null,pf.payout_method||null]);return {id:wid,amount:b.withdrawable}
   })
 },
 'POST /admin/withdrawals/:id/review':req=>wdAction(req,req.body.pass===true?'approve':'reject'),
 'POST /admin/withdrawals/:id/pay':req=>wdAction(req,'pay'),
 // 旧系统实际打款登记兼容；新页面统一先审后付，不将无流水的审批标为已付款。
 'POST /admin/withdrawals/:id/verdict':req=>wdAction({...req,body:{...req.body,note:req.body.note||'原入口实际付款/驳回登记'}},req.body.pass===true?(req.body.payRef?'legacy-pay':'approve'):'reject'),
 'POST /admin/withdrawals/receipt-upload':async req=>{await requireAdmin(req,['super','finance']);return uploadReceipt(req.body)},
 'GET /admin/withdrawals/:id/receipt':async req=>{await requireAdmin(req,['super','finance']);return readReceipt((await one('SELECT receipt_url FROM promoter_withdraw WHERE id=?',[id(req.params.id)]))?.receipt_url)},
 'GET /c/cooperation/:sid/projects':async req=>{
   const s=await subject(req),{page,pageSize,offset}=paging(req.query),cond=`EXISTS(SELECT 1 FROM subject_resource r WHERE r.subject_id=? AND ((r.kind='merchant' AND r.resource_id=p.merchant_id) OR (r.kind='supplier' AND r.resource_id=p.supplier_id) OR (r.kind='cocreator' AND EXISTS(SELECT 1 FROM co_creator cc WHERE cc.id=r.resource_id AND cc.product_id=p.id))))`
   const rows=await q(`SELECT p.id,p.title,p.status,p.days_desc FROM tour_product p WHERE ${cond} ORDER BY p.id DESC LIMIT ? OFFSET ?`,[s.sid,pageSize,offset])
   for(const p of rows){p.contracts=(await q(`SELECT cc.id,cc.role,cc.status,cc.invest_amount,cc.share_pct,cc.profile FROM co_creator cc JOIN subject_resource r ON r.kind='cocreator' AND r.resource_id=cc.id WHERE r.subject_id=? AND cc.product_id=?`,[s.sid,p.id])).map(cc=>{const pf=sales.json(cc.profile);return {id:cc.id,role:cc.role,status:cc.status,investAmount:cc.invest_amount,shareBp:cc.share_pct,contractNo:pf.contract_no||null,from:pf.contract_start||null,to:pf.contract_end||null,payoutTail:pf.account_no?'***'+String(pf.account_no).slice(-4):null,note:'当前合同配置；历史分润以每期基数/金额及已有规则快照为准。收款资料变更请联系平台核实维护。'}})}
   return {rows,total:Number((await one(`SELECT COUNT(*) n FROM tour_product p WHERE ${cond}`,[s.sid])).n),page,pageSize}
 },
 'GET /c/cooperation/:sid/profits':async req=>{
   const s=await subject(req),{page,pageSize,offset}=paging(req.query),conds=['r.subject_id=?'],args=[s.sid];if(req.query.productId){conds.push('cp.product_id=?');args.push(id(req.query.productId))}timeFilters(req.query,'cp.created_at',conds,args)
   const from="FROM co_profit cp JOIN subject_resource r ON r.resource_id=cp.co_creator_id AND r.kind='cocreator' JOIN tour_product p ON p.id=cp.product_id WHERE "+conds.join(' AND ')
   return {rows:await q(`SELECT cp.id,cp.product_id,cp.period,cp.settlement_id,cp.base_amount,cp.amount,cp.paid_amount,cp.status,cp.share_bp,cp.rule_snapshot,p.title,(SELECT COALESCE(SUM(amount),0) FROM co_profit_pay y WHERE y.co_profit_id=cp.id AND y.direction=2 AND y.status=1) adjustments ${from} ORDER BY cp.id DESC LIMIT ? OFFSET ?`,[...args,pageSize,offset]),total:Number((await one('SELECT COUNT(*) n '+from,args)).n),page,pageSize,note:'分润基数为结算期留存金额按本产品成交占比分配；历史无独立费率快照时不反推或伪造。登记已付不代表银行到账，投入不表示应返本金。'}
 },
 'GET /c/cooperation/:sid/profits/:id/payments':async req=>{const s=await subject(req);await profitFor(s.sid,id(req.params.id));return {rows:await q('SELECT id,direction,amount,status,pay_date,pay_ref,receipt_url IS NOT NULL hasReceipt,note FROM co_profit_pay WHERE co_profit_id=? ORDER BY id DESC LIMIT 200',[req.params.id])}},
 'GET /c/cooperation/:sid/payments/:id/receipt':async req=>{const s=await subject(req),p=await one('SELECT co_profit_id,receipt_url FROM co_profit_pay WHERE id=?',[id(req.params.id)]);if(!p)throw new BizError(1004,'付款记录不存在');await profitFor(s.sid,p.co_profit_id);return readReceipt(p.receipt_url)},
 'POST /c/cooperation/:sid/feedback':async req=>{const s=await subject(req),pid=id(req.body.profitId),detail=String(req.body.detail||'').trim();if(detail.length<4||detail.length>500)throw new BizError(1001,'反馈需4–500字');await profitFor(s.sid,pid);const n=await q('INSERT INTO cooperation_feedback(subject_id,user_id,co_profit_id,detail) VALUES(?,?,?,?)',[s.sid,s.uid,pid,detail]);return {id:n.insertId}},
 'GET /c/cooperation/:sid/feedback':async req=>{const s=await subject(req);return {rows:await q('SELECT id,co_profit_id,detail,status,reply,created_at FROM cooperation_feedback WHERE subject_id=? ORDER BY id DESC LIMIT 100',[s.sid])}},
 'GET /admin/sales/feedback':async req=>{await requireAdmin(req,['super','ops','finance']);return {rows:await q('SELECT f.*,s.name subject_name FROM cooperation_feedback f JOIN business_subject s ON s.id=f.subject_id ORDER BY f.id DESC LIMIT 200')}},
 'POST /admin/sales/feedback/:id':async req=>{const a=await requireAdmin(req,['super','ops','finance']),reply=String(req.body.reply||'').trim();if(reply.length<4||reply.length>500)throw new BizError(1001,'回复需4–500字');return tx(async c=>{await c.q('UPDATE cooperation_feedback SET reply=?,status=1 WHERE id=?',[reply,id(req.params.id)]);await audit(c,'admin:'+a.name,'cooperation','feedback','cf-'+req.params.id,null,{reply});return {replied:true}})},
}
