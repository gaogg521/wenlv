// 官方满减补贴：独立预算与权益；现金计佣/旅豆规则继续使用实际支付。
import { q, one, tx, BizError } from '../db.mjs'
import { bookingNow, validDeadline } from './booking-window.mjs'
import { json, id } from './sales.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const amount = v => {const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>10000000000)throw new BizError(1001,'金额或次数无效');return n}
export function ruleInput(b) {
  const r={name:String(b.name||'').trim(),threshold:amount(b.threshold),discount:amount(b.discount),from:String(b.from||'').replace('T',' '),to:String(b.to||'').replace('T',' '),
    products:(b.products||[]).map(id),cities:(b.cities||[]).map(String),channels:(b.channels||[]).map(String),dates:(b.dates||[]).map(String),perUser:amount(b.perUser||1),daily:amount(b.daily||1)}
  if(!r.name||r.name.length>80||r.discount>=r.threshold||!r.from||!r.to||!validDeadline(r.from)||!validDeadline(r.to)||r.to<=r.from||r.perUser>100||r.daily>100)throw new BizError(1001,'满减金额、名称、有效期或次数无效')
  if(r.products.length>200||r.cities.length>100||r.channels.length>30||r.dates.length>365||r.cities.some(x=>!/^\d{6}$/.test(x))||r.channels.some(x=>!/^\w{1,24}$/.test(x))||r.dates.some(x=>!validDeadline(x+' 00:00:00')))throw new BizError(1001,'适用范围无效')
  return r
}
export function reasonFor(right,ctx,now=bookingNow()) {
  const r=json(right.rule_json)
  if(right.status!=='available')return {locked:'已被待支付订单占用',used:'已使用',expired:'已过期',revoked:'已撤销'}[right.status]||'不可用'
  if(now<r.from)return '尚未到使用时间'
  if(now>=r.to)return '已过期'
  if(!ctx)return ''
  if(r.products.length&&!r.products.map(Number).includes(Number(ctx.product_id)))return '不适用此产品'
  if(r.cities.length&&!r.cities.includes(ctx.city_code))return '不适用此城市'
  if(r.channels.length&&!r.channels.includes(ctx.channel))return '不适用此频道'
  if(r.dates.length&&!r.dates.includes(String(ctx.depart_date).slice(0,10)))return '不适用此团期'
  if(ctx.goods<r.threshold)return '商品金额未达满减门槛（保费不计入）'
  return ''
}
async function event(c,r,kind,ref,detail){await c.q('INSERT INTO freedom_event(budget_id,right_id,kind,amount,biz_ref,detail) VALUES(?,?,?,?,?,?)',[r.budget_id,r.id,kind,json(r.rule_json).discount,ref,detail])}
export async function expireUser(uid) {
  const rights=await q("SELECT id FROM freedom_right WHERE user_id=? AND status='available' AND JSON_UNQUOTE(JSON_EXTRACT(rule_json,'$.to'))<=?",[uid,bookingNow()])
  for(const x of rights)await tx(async c=>{
    const r=await c.one('SELECT * FROM freedom_right WHERE id=? FOR UPDATE',[x.id]);if(r.status!=='available')return
    await c.q("UPDATE freedom_right SET status='expired' WHERE id=?",[r.id]);await c.q('UPDATE freedom_budget SET committed=committed-? WHERE id=?',[json(r.rule_json).discount,r.budget_id]);await event(c,r,'expire','right-'+r.id,'到期释放未用补贴责任')
  })
}
export async function sweepExpired(){
  const users=await q("SELECT DISTINCT user_id FROM freedom_right WHERE status='available' AND JSON_UNQUOTE(JSON_EXTRACT(rule_json,'$.to'))<=? LIMIT 1000",[bookingNow()])
  for(const u of users)await expireUser(u.user_id)
  return users.length
}
export async function rights(uid,ctx,pg=null) {
  await expireUser(uid)
  const cond=ctx?" AND status='available'":pg?.status?' AND status=?':'',args=[uid,...(!ctx&&pg?.status?[pg.status]:[])],limit=pg?' LIMIT ? OFFSET ?':''
  if(pg)args.push(pg.pageSize,pg.offset)
  const rows=await q('SELECT id,budget_id,batch_id,template_id,rule_json,status,order_no,created_at FROM freedom_right WHERE user_id=?'+cond+' ORDER BY id DESC'+limit,args)
  const budgets=await q('SELECT id,status,total,committed,used,recovering FROM freedom_budget WHERE id IN (SELECT budget_id FROM freedom_right WHERE user_id=?)',[uid])
  const usage=ctx?await q("SELECT r.template_id,COUNT(*) n FROM freedom_order f JOIN freedom_right r ON r.id=f.right_id WHERE f.user_id=? AND f.status IN ('locked','used') AND f.created_at>=? GROUP BY r.template_id",[uid,bizDay()+' 00:00:00']):[]
  return rows.map(r=>{
    const rule=json(r.rule_json),why=reasonFor(r,ctx)
    const budget=budgets.find(b=>Number(b.id)===Number(r.budget_id)),reason=why||(budget&&Number(budget.status)!==1?'该补贴预算已暂停使用':ctx&&Number(budget?.committed)+Number(budget?.used)+Number(budget?.recovering)>Number(budget?.total)?'补贴尚待追回，预算占用超限':ctx&&Number(usage.find(x=>Number(x.template_id)===Number(r.template_id))?.n||0)>=rule.daily?'已达每日使用上限':'')
    return {id:r.id,batchId:r.batch_id,name:rule.name,threshold:rule.threshold,discount:rule.discount,from:rule.from,to:rule.to,products:rule.products,cities:rule.cities,channels:rule.channels,dates:rule.dates,status:r.status,orderNo:r.order_no,reason,eligible:!reason}
  })
}
/** D01：beanDeductFen＝同单旅豆抵扣分。自由豆与旅豆同单可用、账本独立；
 *  cash_pay 记最终现金（含保费、已减旅豆），与 orders.amount_pay 恒等，供补贴对账复算。 */
export async function reserve(c,uid,rightId,ctx,orderNo,insurance,beanDeductFen=0) {
  if(!rightId)return null
  await c.one('SELECT id FROM user_account WHERE id=? AND status=1 FOR UPDATE',[uid])
  const r=await c.one('SELECT * FROM freedom_right WHERE id=? AND user_id=? FOR UPDATE',[id(rightId),uid])
  if(!r)throw new BizError(1003,'自由豆权益不属于本人')
  const why=reasonFor(r,ctx);if(why)throw new BizError(1001,why)
  const rule=json(r.rule_json)
  const daily=await c.one("SELECT COUNT(*) n FROM freedom_order f JOIN freedom_right r ON r.id=f.right_id WHERE f.user_id=? AND r.template_id=? AND f.status IN ('locked','used') AND f.created_at>=?",[uid,r.template_id,bizDay()+' 00:00:00'])
  if(Number(daily.n)>=rule.daily)throw new BizError(1001,'已达该活动每日使用上限')
  const budget=await c.one('SELECT * FROM freedom_budget WHERE id=? FOR UPDATE',[r.budget_id]);if(!budget||Number(budget.status)!==1)throw new BizError(1001,'该补贴预算已暂停使用')
  if(Number(budget.committed)+Number(budget.used)+Number(budget.recovering)>Number(budget.total))throw new BizError(1001,'补贴追回尚未到账，预算占用超限，暂不可使用')
  const beanDed=Math.max(0,Number(beanDeductFen)||0)
  const pay=ctx.goods-rule.discount-beanDed+insurance
  if(pay<1)throw new BizError(1001,'优惠后实付金额不符合支付要求')
  await c.q("UPDATE freedom_right SET status='locked',order_no=? WHERE id=?",[orderNo,r.id])
  await c.q('INSERT INTO freedom_order(order_no,right_id,user_id,merchant_id,goods,discount,cash_pay,rule_json) VALUES(?,?,?,?,?,?,?,?)',[orderNo,r.id,uid,ctx.merchant_id,ctx.goods,rule.discount,pay,JSON.stringify(rule)])
  await event(c,r,'lock',orderNo,'建单锁定，预算只转换状态不重复扣减')
  return {discount:rule.discount,pay}
}
export async function paid(c,o) {
  const f=await c.one('SELECT * FROM freedom_order WHERE order_no=? FOR UPDATE',[o.order_no]);if(!f||f.status!=='locked')return
  const r=await c.one('SELECT * FROM freedom_right WHERE id=? FOR UPDATE',[f.right_id])
  if(r.status!=='locked'||r.order_no!==o.order_no)throw new BizError(2002,'补贴权益状态异常')
  await c.q("UPDATE freedom_order SET status='used' WHERE order_no=?",[o.order_no]);await c.q("UPDATE freedom_right SET status='used' WHERE id=?",[r.id])
  await c.q('UPDATE freedom_budget SET committed=committed-?,used=used+? WHERE id=?',[f.discount,f.discount,r.budget_id]);await event(c,r,'use',o.order_no,'实际现金支付确认，补贴另列应付')
}
export async function release(c,o,refund=false) {
  const f=await c.one('SELECT * FROM freedom_order WHERE order_no=? FOR UPDATE',[o.order_no]);if(!f||f.status!==(refund?'used':'locked'))return
  const r=await c.one('SELECT * FROM freedom_right WHERE id=? FOR UPDATE',[f.right_id]),rule=json(r.rule_json),batch=await c.one('SELECT status FROM freedom_batch WHERE id=?',[r.batch_id]),revoked=Number(batch?.status)===0,valid=bookingNow()<rule.to&&!revoked
  await c.q("UPDATE freedom_order SET status=? WHERE order_no=?",[refund?'refunded':'released',o.order_no])
  await c.q('UPDATE freedom_right SET status=?,order_no=NULL WHERE id=?',[valid?'available':revoked?'revoked':'expired',r.id])
  if(refund)await c.q('UPDATE freedom_budget SET used=used-?,committed=committed+?,recovering=recovering+? WHERE id=?',[f.discount,valid?f.discount:0,f.paid_subsidy,r.budget_id])
  else if(!valid)await c.q('UPDATE freedom_budget SET committed=committed-? WHERE id=?',[f.discount,r.budget_id])
  await event(c,r,refund?'refund':'release',o.order_no,valid?'原权益仅返一次，可在原有效期使用':revoked?'原批次已撤销，释放责任不再恢复可用':'已超过原有效期，释放责任且不延期')
}
export async function orderView(orderNo,uid) {
  const f=await one('SELECT f.*,r.status right_status FROM freedom_order f JOIN freedom_right r ON r.id=f.right_id WHERE f.order_no=? AND f.user_id=?',[orderNo,uid])
  if(!f)return null
  const r=json(f.rule_json)
  return {name:r.name,threshold:r.threshold,discount:f.discount,cashPay:f.cash_pay,status:f.status,rightStatus:f.right_status,validTo:r.to,note:'官方补贴独立于旅豆；退款只退实际现金，权益按原有效期返还。'}
}
