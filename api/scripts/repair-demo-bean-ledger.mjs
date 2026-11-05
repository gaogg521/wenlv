// 演示历史账本修复。默认只生成计划；不调用链网关，不改余额/已封存根。
import {q,one,tx,closeDb}from'../src/db.mjs'
import {attest}from'../src/domain/attest.mjs'
import {trialBalance}from'../src/domain/bean.mjs'
import {pathToFileURL}from'node:url'
const REF='demo-bean-repair-v1'
export async function repairDemoLedger({apply=false,allowDemo=false}={}){
 const db=process.env.DB_NAME||''
 if(!db.startsWith('wanderlust_qa_')&&!(db==='wanderlust'&&allowDemo))throw Error('仅允许显式隔离库，演示库需--allow-demo')
 return tx(async c=>{
  const prior=await c.one("SELECT id FROM audit_log WHERE module='bean' AND action='legacy-repair' AND biz_ref=?",[REF])
  if(prior)return{alreadyApplied:true,auditId:prior.id}
  const ledger=await c.q('SELECT l.*,a.user_id FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id ORDER BY l.id FOR UPDATE')
  const accounts=await c.q('SELECT a.* FROM bean_account a JOIN user_account u ON u.id=a.user_id ORDER BY a.id FOR UPDATE')
  const roots=await c.q('SELECT biz_date FROM bean_day_root FOR UPDATE'),sealed=new Set(roots.map(r=>String(r.biz_date).slice(0,10)))
  const groups=new Map();for(const l of ledger){const rows=groups.get(l.tx_no)||[];rows.push(l);groups.set(l.tx_no,rows)}
  const dates=[],missing=[],opening=[]
  for(const [txNo,rows]of groups){
   if(rows.length!==2||rows.filter(r=>Number(r.direction)===1).length!==1||rows.reduce((s,r)=>s+(Number(r.direction)===1?1:-1)*Number(r.amount),0)!==0)throw Error('非标准双分录，拒绝自动修复：'+txNo)
   const credit=rows.find(r=>Number(r.direction)===1),debit=rows.find(r=>Number(r.direction)===2)
   const split=String(credit.created_at)!==String(debit.created_at)
   if(split){
    if(!txNo.startsWith('DEMO-BT-')||!String(credit.biz_ref).startsWith('DEMO-GRANT-'))throw Error('非演示事务时间差，拒绝修改：'+txNo)
    if(rows.some(r=>sealed.has(String(r.created_at).slice(0,10))))throw Error('涉及已封存日期，拒绝修改：'+txNo)
    dates.push({id:debit.id,before:debit.created_at,after:credit.created_at,txNo})
   }
   const event=await c.one("SELECT id FROM attest_event WHERE biz_ref=? AND biz_type IN('bean_grant','bean_deduct')",['bt-'+txNo])
   if(!event){if(!txNo.startsWith('DEMO-BT-'))throw Error('非演示流水缺存证，需独立调查：'+txNo);missing.push(rows.find(r=>Number(r.user_id)<999999000000))}
  }
  for(const a of accounts){
   const derived=ledger.filter(l=>Number(l.account_id)===Number(a.id)).reduce((s,l)=>s+(Number(l.direction)===1?1:-1)*Number(l.amount),0)
   const delta=Number(a.balance)-derived
   if(delta<0)throw Error('负期初差异，拒绝自动修复：account '+a.id)
   if(delta>0)opening.push({accountId:a.id,userId:a.user_id,amount:delta,balance:a.balance,lifetime:a.lifetime})
  }
  const cap=await c.one('SELECT * FROM bean_global_cap WHERE id=1 FOR UPDATE')
  const budgets=await c.one('SELECT COALESCE(SUM(granted),0) n FROM bean_budget')
  const issuedAfter=Math.max(Number(cap.issued_sum),Number(budgets.n))
  if(issuedAfter>Number(cap.cap_total))throw Error('存量发放计数超总量，需要人工核实')
  const plan={dates,missing:missing.map(r=>({txNo:r.tx_no,accountId:r.account_id,amount:r.amount})),opening,issuedBefore:Number(cap.issued_sum),issuedAfter}
  if(!apply)return{dryRun:true,...plan}
  const concurrent=await c.one("SELECT id FROM audit_log WHERE module='bean' AND action='legacy-repair' AND biz_ref=? FOR UPDATE",[REF])
  if(concurrent)return{alreadyApplied:true,auditId:concurrent.id}
  // 已有余额的期初导入只补迁移分录，不重新发豆、不改可用余额和lifetime；来源明确为切换快照。
  let sentinel=await c.one('SELECT id FROM bean_account WHERE user_id=999999000009')
  if(!sentinel){const id=await c.ins('INSERT INTO bean_account(user_id)VALUES(999999000009)');sentinel={id}}
  for(const d of dates)await c.q('UPDATE bean_ledger SET created_at=? WHERE id=? AND created_at=?',[d.after,d.id,d.before])
  for(const a of opening){
   const txNo='LEGACY-OPEN-'+a.accountId
   await c.q("INSERT INTO bean_ledger(tx_no,account_id,direction,amount,after_bal,biz_type,biz_ref,memo)VALUES(?,?,1,?,?,8,?,'期初余额导入：仅补迁移分录，不重新发豆'),(?,?,2,?,0,8,?,'期初余额导入对手分录')",[txNo,a.accountId,a.amount,a.balance,REF,txNo,sentinel.id,a.amount,REF])
   await attest('bean_grant','bt-'+txNo,{txNo,accountId:Number(a.accountId),userId:Number(a.userId),amount:a.amount,bizType:8,bizRef:REF,afterBal:Number(a.balance),legacyOpening:true,source:'observed opening balance snapshot; not a new reward'},c)
  }
  for(const r of missing)await attest('bean_grant','bt-'+r.tx_no,{txNo:r.tx_no,accountId:Number(r.account_id),userId:Number(r.user_id),amount:Number(r.amount),bizType:Number(r.biz_type),bizRef:r.biz_ref,budgetId:Number(r.budget_id),afterBal:Number(r.after_bal),legacyBackfill:true,sourceCreatedAt:r.created_at},c)
  await c.q('UPDATE bean_global_cap SET issued_sum=? WHERE id=1',[issuedAfter])
  const auditId=await c.ins("INSERT INTO audit_log(actor,module,action,biz_ref,before_val,after_val)VALUES('operator:demo-ledger-repair','bean','legacy-repair',?,?,?)",[REF,JSON.stringify({ledger,accounts,cap}),JSON.stringify(plan)])
  return{applied:true,auditId,...plan}
 })
}
export async function resolveRepairedLedgerAlerts({allowDemo=false}={}){
 const db=process.env.DB_NAME||''
 if(!db.startsWith('wanderlust_qa_')&&!(db==='wanderlust'&&allowDemo))throw Error('仅允许显式隔离库，演示库需--allow-demo')
 const balance=await trialBalance()
 const missing=await one("SELECT COUNT(*) n FROM(SELECT DISTINCT tx_no FROM bean_ledger)l WHERE NOT EXISTS(SELECT 1 FROM attest_event e WHERE e.biz_type IN('bean_grant','bean_deduct') AND e.biz_ref=CONCAT('bt-',l.tx_no) AND JSON_UNQUOTE(JSON_EXTRACT(e.canonical,'$.txNo'))=l.tx_no)")
 const days=await one('SELECT COUNT(*) n FROM(SELECT DATE(created_at)d FROM bean_ledger GROUP BY DATE(created_at) HAVING SUM(IF(direction=1,amount,-amount))<>0)t')
 if(!balance.perOk||!balance.globalOk||Number(missing.n)||Number(days.n))throw Error('账本或存证仍异常，拒绝关闭历史告警')
 return tx(async c=>{
  const repair=await c.one("SELECT id FROM audit_log WHERE module='bean' AND action='legacy-repair' AND biz_ref=?",[REF]);if(!repair)throw Error('缺少修复审计')
  const alerts=await c.q("SELECT id,detail FROM risk_event WHERE kind='attest_reconcile_failed' AND handled=0 FOR UPDATE"),resolved=[]
  for(const a of alerts){const detail=typeof a.detail==='string'?JSON.parse(a.detail):a.detail;if(!Array.isArray(detail)||!detail.length||detail.some(x=>x.id!=='I6'))continue
   await c.q('UPDATE risk_event SET handled=1 WHERE id=? AND handled=0',[a.id]);await c.q("INSERT INTO audit_log(actor,module,action,biz_ref,before_val,after_val)VALUES('operator:demo-ledger-repair','risk','handle',?,?,?)",['risk-event-'+a.id,JSON.stringify({handled:0}),JSON.stringify({handled:1,reason:'历史旅豆账本已修复；逐笔覆盖100%，每日借贷及余额试算通过',repairAuditId:repair.id})]);resolved.push(a.id)
  }
  return{resolved}
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await repairDemoLedger({apply:process.argv.includes('--apply'),allowDemo:process.argv.includes('--allow-demo')}),null,2));if(process.argv.includes('--resolve-alerts'))console.log(JSON.stringify(await resolveRepairedLedgerAlerts({allowDemo:process.argv.includes('--allow-demo')})))}finally{await closeDb()}
}
