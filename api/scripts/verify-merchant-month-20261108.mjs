// 只读：保存导入前摘要，或核对月度样例及原始数据未被回写。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {q,one,closeDb} from '../src/db.mjs'
import {bizDay} from '../src/infra/bizdate.mjs'
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const path=process.env.DEMO_SNAPSHOT
assert.ok(path,'DEMO_SNAPSHOT 必填')
const digest=async(maxOrder,maxLedger)=>({
  orders:hash(await q('SELECT * FROM orders WHERE id<=? ORDER BY id',[maxOrder])),
  oldLedger:hash(await q('SELECT * FROM bean_ledger WHERE id<=? ORDER BY id',[maxLedger])),
  historicalRoots:hash(await q('SELECT * FROM bean_day_root WHERE biz_date<? ORDER BY biz_date',[bizDay()])),
  secrets:hash(await q('SELECT * FROM app_secret ORDER BY k')),
})
try{
  if(process.argv.includes('--snapshot')){
    const maxOrder=Number((await one('SELECT COALESCE(MAX(id),0) n FROM orders')).n),maxLedger=Number((await one('SELECT COALESCE(MAX(id),0) n FROM bean_ledger')).n)
    fs.writeFileSync(path,JSON.stringify({maxOrder,maxLedger,...await digest(maxOrder,maxLedger)},null,2));console.log('Saved read-only baseline')
  }else{
    const before=JSON.parse(fs.readFileSync(path,'utf8'))
    const after=await digest(before.maxOrder,before.maxLedger)
    for(const k of Object.keys(after))assert.equal(after[k],before[k],k+' changed')
    const rows=await q("SELECT o.* FROM orders o JOIN order_event e ON e.order_id=o.id AND e.actor='demo:MM20261108' ORDER BY o.paid_at")
    const days=Number(process.env.DEMO_MONTH_DAYS||30);assert.equal(rows.length,days*4)
    const dates=new Set(),states={},sum={paidFen:0,refundFen:0,netFen:0,passes:0,verifiedPasses:0}
    for(const o of rows){
      assert.equal(Number(o.merchant_id),1);assert.ok(o.contact_name.startsWith('演示样例·月1108-'))
      const date=String(o.paid_at).slice(0,10);dates.add(date);states[o.status]=(states[o.status]||0)+1
      const p=await one('SELECT * FROM payment WHERE order_id=?',[o.id]);assert.equal(Number(p.amount),Number(o.amount_pay));assert.ok(p.wx_trans_no.startsWith('MOCK'))
      const passes=await q('SELECT * FROM travel_pass WHERE order_id=?',[o.id]);assert.equal(passes.length,Number(o.qty))
      for(const pass of passes){assert.equal(Number(pass.user_id),Number(o.user_id));assert.equal(Number(pass.product_id),Number(o.product_id));assert.equal(Number(pass.status),Number(o.status)===70?4:Number(o.status)===30?1:2)}
      const s=await one('SELECT * FROM tour_session WHERE id=?',[o.session_id]);assert.ok(JSON.stringify(s.profile).includes('MM20261108'))
      assert.equal(Number(s.booked),Number(o.status)===70?0:Number(o.qty));assert.ok(Number(s.booked)<=Number(s.quota))
      const logs=await q('SELECT v.* FROM verification_log v JOIN travel_pass p ON p.id=v.pass_id WHERE p.order_id=? AND v.result=1',[o.id])
      assert.equal(logs.length,[40,50].includes(Number(o.status))?Number(o.qty):0)
      for(const v of logs)assert.equal(String(v.created_at).slice(0,10),date)
      const refund=Number((await one('SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE order_id=? AND status=2',[o.id])).n)
      assert.equal(refund,Number(o.status)===70?Number(o.amount_pay):0)
      sum.paidFen+=Number(o.amount_pay);sum.refundFen+=refund;sum.passes+=passes.length;sum.verifiedPasses+=logs.length
    }
    assert.equal(dates.size,days);sum.netFen=sum.paidFen-sum.refundFen
    const unbalanced=await q('SELECT tx_no FROM bean_ledger WHERE id>? GROUP BY tx_no HAVING SUM(IF(direction=1,amount,-amount))<>0',[before.maxLedger]);assert.equal(unbalanced.length,0)
    assert.equal(Number((await one('SELECT COUNT(*) n FROM bean_ledger WHERE id>? AND DATE(created_at)<>?',[before.maxLedger,bizDay()])).n),0)
    const report={batch:'MM20261108',orders:rows.length,days:dates.size,from:[...dates].sort()[0],to:[...dates].sort().at(-1),states,...sum,oldOrdersUnchanged:true,oldLedgerUnchanged:true,historicalRootsUnchanged:true,secretsUnchanged:true,newLedgerBalanced:true,realMoneyTransferred:false}
    if(process.env.DEMO_VERIFY_REPORT)fs.writeFileSync(process.env.DEMO_VERIFY_REPORT,JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
  }
}finally{await closeDb()}
