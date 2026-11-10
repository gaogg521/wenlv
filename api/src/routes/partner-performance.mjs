// 合伙人经营排行与只读账本核对；不改变既有结算/打款流程。
import { q, one, BizError } from '../db.mjs'
import { requireAdmin } from './_shared.mjs'
const num = v => Number(v || 0)
const PAID = '(20,30,40,50)'
async function access(req, kind) {
  const a = await requireAdmin(req, ['super','ops','finance','city_partner','readonly'])
  if (!['city','promoter','cocreator'].includes(kind)) throw new BizError(1001,'合伙人类型无效')
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003,'城市账号未绑定城市')
  if (a.scopeCity && kind !== 'city') throw new BizError(1003,'城市范围账号不能查看全局推广与共创资金账本')
  return a
}
function paging(req) {
  const page = Number(req.query.page || 1), size = 20
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new BizError(1001,'页码无效')
  return { page, size, offset: (page-1)*size }
}
const RANKS = {
  city: `SELECT c.city_code id,c.city_code name,c.city_code,
    (SELECT COALESCE(SUM(o.amount_pay),0) FROM orders o WHERE o.city_code=c.city_code AND o.status IN ${PAID}) gmv,
    (SELECT COUNT(*) FROM orders o WHERE o.city_code=c.city_code AND o.status IN ${PAID}) orders,
    (SELECT COUNT(*) FROM merchant m WHERE m.city_code=c.city_code) merchants
    FROM (SELECT DISTINCT scope_city city_code FROM admin_user WHERE role='city_partner' AND scope_city IS NOT NULL AND scope_city<>'') c`,
  promoter: `SELECT p.user_id id,u.nickname name,NULL city_code,
    (SELECT COALESCE(SUM(o.amount_pay),0) FROM commission c JOIN orders o ON o.id=c.order_id WHERE c.promoter_id=p.user_id AND c.status IN (0,1,2) AND o.status IN ${PAID}) gmv,
    (SELECT COALESCE(SUM(c.amount),0) FROM commission c WHERE c.promoter_id=p.user_id AND c.status IN (1,2)) earned,
    (SELECT COALESCE(SUM(w.amount),0) FROM promoter_withdraw w WHERE w.promoter_id=p.user_id AND w.status=1) paid
    FROM promoter p JOIN user_account u ON u.id=p.user_id`,
  cocreator: `SELECT c.id,c.name,p.city_code,c.co_no,c.invest_amount,
    (SELECT COALESCE(SUM(cp.amount),0) FROM co_profit cp WHERE cp.co_creator_id=c.id AND cp.status<>2) profit,
    (SELECT COALESCE(SUM(cp.paid_amount),0) FROM co_profit cp WHERE cp.co_creator_id=c.id AND cp.status<>2) paid,
    (SELECT COALESCE(SUM(cp.paid_amount),0) FROM co_profit cp WHERE cp.co_creator_id=c.id AND cp.status<>2)/NULLIF(c.invest_amount,0) return_rate
    FROM co_creator c JOIN tour_product p ON p.id=c.product_id`,
}

export const partnerPerformance = {
  'GET /admin/partner-performance': async req => {
    const kind = String(req.query.kind || 'city'), a = await access(req,kind), pg = paging(req)
    const sorts = {city:['gmv','orders','merchants'],promoter:['gmv','earned','paid'],cocreator:['profit','paid','return_rate']}[kind]
    const sort = req.query.sort || sorts[0]
    if (!sorts.includes(sort)) throw new BizError(1001,'排序指标无效')
    const where = a.scopeCity ? 'WHERE x.city_code=?' : '', args = a.scopeCity ? [a.scopeCity] : []
    const total = num((await one(`SELECT COUNT(*) n FROM (${RANKS[kind]}) x ${where}`,args)).n)
    const rows = await q(`SELECT x.* FROM (${RANKS[kind]}) x ${where} ORDER BY ${sort} DESC,id ASC LIMIT ? OFFSET ?`,[...args,pg.size,pg.offset])
    return {kind,sort,total,page:pg.page,size:pg.size,rows:rows.map((r,i)=>({...r,rank:pg.offset+i+1})),scopeCity:a.scopeCity || null}
  },
  'GET /admin/partner-reconciliation/:kind/:id': async req => {
    const {kind,id}=req.params, a=await access(req,kind), pg=paging(req)
    if (kind === 'city') return cityLedger(id,a,pg)
    if (kind === 'promoter') return promoterLedger(id,req.query.tab || 'commission',pg)
    return coLedger(id,pg)
  },
}

async function cityLedger(city,a,pg) {
  if (a.scopeCity && city !== a.scopeCity) throw new BizError(1003,'仅可查看本城')
  if (!await one("SELECT id FROM admin_user WHERE role='city_partner' AND scope_city=? LIMIT 1",[city])) throw new BizError(1004,'城市合伙人不存在')
  // 混入外城订单/退改费的结算单整体排除，不能把整单资金暴露给城市账号。
  const from = `FROM settlement s JOIN merchant m ON m.id=s.merchant_id WHERE m.city_code=?
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.settlement_id=s.id AND o.city_code<>?)
    AND NOT EXISTS (SELECT 1 FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.settlement_id=s.id AND o.city_code<>?)`
  const args=[city,city,city]
  const summary=await one(`SELECT COUNT(*) total,COALESCE(SUM(s.amt_fulfill+s.fee_merchant),0) payable,
    COALESCE(SUM(IF(s.status=3,s.amt_fulfill+s.fee_merchant,0)),0) paid ${from}`,args)
  const rows=await q(`SELECT s.id,s.period,s.status,m.name merchant_name,s.order_count,s.total_amount,s.amt_fulfill+s.fee_merchant payable,s.payment_ref,
    (SELECT COUNT(*) FROM orders o WHERE o.settlement_id=s.id) source_orders,
    (SELECT COALESCE(SUM(o.amount_pay-o.insurance_fee),0) FROM orders o WHERE o.settlement_id=s.id) source_total,
    s.amt_fulfill+s.amt_service+s.amt_promoter+s.amt_beanbudget+s.amt_retained split_total,
    s.fee_total,s.fee_merchant+s.fee_platform fee_split,
    (SELECT COALESCE(SUM(r.fee_amount),0) FROM refunds r WHERE r.settlement_id=s.id) source_fees ${from}
    ORDER BY s.id DESC LIMIT ? OFFSET ?`,[...args,pg.size,pg.offset])
  return {kind:'city',name:city,total:num(summary.total),summary,page:pg.page,size:pg.size,rows:rows.map(r=>({...r,
    issues:[num(r.source_orders)!==num(r.order_count)?'订单数不一致':'',num(r.source_total)!==num(r.total_amount)?'订单金额不一致':'',num(r.split_total)!==num(r.total_amount)?'五口径不平':'',num(r.source_fees)!==num(r.fee_total)||num(r.fee_split)!==num(r.fee_total)?'退改费不平':'',num(r.status)===3&&!r.payment_ref?'已打款缺回单号':''].filter(Boolean)}))}
}

async function promoterLedger(id,tab,pg) {
  if (!['commission','withdrawal'].includes(tab)) throw new BizError(1001,'明细类型无效')
  const partner=await one('SELECT u.nickname name,u.status user_status FROM promoter p JOIN user_account u ON u.id=p.user_id WHERE p.user_id=?',[id])
  if (!partner) throw new BizError(1004,'推广服务商不存在')
  const c=await one(`SELECT COALESCE(SUM(IF(status=0,amount,0)),0) observing,COALESCE(SUM(IF(status IN (1,2),amount,0)),0) earned,
    COALESCE(SUM(IF(status IN (3,4),amount,0)),0) reversed FROM commission WHERE promoter_id=?`,[id])
  const w=await one('SELECT COALESCE(SUM(IF(status=1,amount,0)),0) paid,COALESCE(SUM(IF(status IN (0,3),amount,0)),0) pending FROM promoter_withdraw WHERE promoter_id=?',[id])
  const summary={...c,...w,balance:num(c.earned)-num(w.paid),after_pending:num(c.earned)-num(w.paid)-num(w.pending)}
  const table=tab==='commission'?'commission':'promoter_withdraw'
  const total=num((await one(`SELECT COUNT(*) n FROM ${table} WHERE promoter_id=?`,[id])).n)
  let rows
  if (tab==='commission') {
    rows=await q(`SELECT c.id,c.status,c.base_amount,c.rate_bp,c.amount,c.payable_at,o.order_no,o.status order_status,o.settlement_id source_settlement_id,s.id settlement_id,s.period,
      ROUND(c.base_amount*c.rate_bp/10000) expected FROM commission c LEFT JOIN orders o ON o.id=c.order_id LEFT JOIN settlement s ON s.id=o.settlement_id
      WHERE c.promoter_id=? ORDER BY c.id DESC LIMIT ? OFFSET ?`,[id,pg.size,pg.offset])
    rows=rows.map(r=>({...r,issues:[!r.order_no?'来源订单缺失':'',num(r.expected)!==num(r.amount)?'计佣快照金额不符':'',r.source_settlement_id&&!r.settlement_id?'来源结算单缺失':''].filter(Boolean)}))
  } else {
    rows=await q(`SELECT w.id,w.status,w.amount,w.created_at,w.reviewed_at,w.pay_ref,
      (SELECT COUNT(*) FROM promoter_withdraw x WHERE x.status=1 AND x.pay_ref=w.pay_ref AND x.id<>w.id) duplicate_ref
      FROM promoter_withdraw w WHERE w.promoter_id=? ORDER BY w.id DESC LIMIT ? OFFSET ?`,[id,pg.size,pg.offset])
    rows=rows.map(r=>({...r,issues:[num(r.status)===1&&!r.pay_ref?'已打款缺回单号':'',num(r.status)===1&&num(r.duplicate_ref)>0?'打款流水重复':''].filter(Boolean)}))
  }
  return {kind:'promoter',tab,...partner,total,summary,page:pg.page,size:pg.size,rows}
}

async function coLedger(id,pg) {
  const partner=await one('SELECT c.name,c.invest_amount,c.share_pct,p.title FROM co_creator c JOIN tour_product p ON p.id=c.product_id WHERE c.id=?',[id])
  if (!partner) throw new BizError(1004,'共创人不存在')
  // T01：应付不含已作废单；已付 = 有效打款流水累计（paid_amount，支持部分打款），待付 = 应付 − 已付
  const summary=await one('SELECT COALESCE(SUM(IF(status<>2,amount,0)),0) profit,COALESCE(SUM(IF(status<>2,paid_amount,0)),0) paid,COALESCE(SUM(IF(status=0,amount-paid_amount,0)),0) pending,COUNT(*) total FROM co_profit WHERE co_creator_id=?',[id])
  const rows=await q(`SELECT cp.id,cp.period,cp.status,cp.base_amount,cp.amount,cp.paid_amount,cp.pay_ref,cp.paid_at,cp.settlement_id,s.id source_id,s.period source_period,p.title,
    ROUND(s.amt_retained*(SELECT COALESCE(SUM(o.amount_pay-o.insurance_fee),0) FROM orders o WHERE o.settlement_id=s.id AND o.product_id=cp.product_id)/NULLIF(s.total_amount,0)) expected_base
    FROM co_profit cp LEFT JOIN settlement s ON s.id=cp.settlement_id LEFT JOIN tour_product p ON p.id=cp.product_id
    WHERE cp.co_creator_id=? ORDER BY cp.id DESC LIMIT ? OFFSET ?`,[id,pg.size,pg.offset])
  return {kind:'cocreator',...partner,total:num(summary.total),summary,page:pg.page,size:pg.size,rows:rows.map(r=>({...r,
    issues:[!r.source_id?'来源结算单缺失':'',r.source_id&&r.period!==r.source_period?'结算周期不符':'',r.expected_base==null?'分润基数无法复算':num(r.expected_base)!==num(r.base_amount)?'分润基数不符':''].filter(Boolean)}))}
}
