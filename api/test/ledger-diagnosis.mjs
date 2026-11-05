// 只读诊断，不改业务数据、不读取凭据原文。
import {q,closeDb}from'../src/db.mjs'
import fs from'node:fs/promises'
try{
 const r={}
 r.days=await q('SELECT DATE(created_at) day,COUNT(*) rows_n,COUNT(DISTINCT tx_no) txs,SUM(IF(direction=1,amount,0)) cr,SUM(IF(direction=2,amount,0)) dr FROM bean_ledger GROUP BY DATE(created_at)')
 r.badTx=await q('SELECT tx_no,COUNT(*) n,SUM(IF(direction=1,amount,-amount)) delta,MIN(created_at) first_at,MAX(created_at) last_at FROM bean_ledger GROUP BY tx_no HAVING delta<>0 OR n<>2')
 r.events=await q('SELECT biz_type,COUNT(*) n FROM attest_event GROUP BY biz_type')
 r.roots=await q('SELECT biz_date,leaf_count,debit_sum,credit_sum,batch_id FROM bean_day_root')
 r.accounts=await q('SELECT a.id,a.user_id,a.balance,COALESCE(SUM(IF(l.direction=1,l.amount,-l.amount)),0) derived FROM bean_account a LEFT JOIN bean_ledger l ON l.account_id=a.id GROUP BY a.id HAVING a.balance<>derived')
 r.missing=await q("SELECT l.tx_no,COUNT(*) n,MIN(l.biz_type) biz_type,MIN(l.biz_ref) biz_ref,MIN(l.created_at) created_at FROM bean_ledger l LEFT JOIN attest_event e ON e.biz_ref=CONCAT('bt-',l.tx_no) AND e.biz_type IN ('bean_grant','bean_deduct') WHERE e.id IS NULL GROUP BY l.tx_no")
 await fs.writeFile('test/evidence-ledger-role/diagnosis-before.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2))
}finally{await closeDb()}
