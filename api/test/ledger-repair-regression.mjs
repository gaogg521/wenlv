import{assertIsolatedDb}from'./_guard.mjs'
assertIsolatedDb('ledger-repair-regression')
import{q,one,closeDb}from'../src/db.mjs'
import{trialBalance,flow}from'../src/domain/bean.mjs'
import{reconcile,attest}from'../src/domain/attest.mjs'
import{repairDemoLedger}from'../scripts/repair-demo-bean-ledger.mjs'
import assert from'node:assert/strict'
const removed=[],stamp='COVERAGE-CONTROL-'+Date.now()
try{
 const tb=await trialBalance();assert(tb.perOk&&tb.globalOk,'用户余额与双分录一致')
 const total=await one('SELECT SUM(balance) n FROM bean_account WHERE user_id<999999000000'),f=await flow();assert.equal(f.granted-f.consumed,Number(total.n),'累计导入及发放减净消耗与当前余额一致')
 const bad=await one('SELECT COUNT(*) n FROM (SELECT DATE(created_at) d FROM bean_ledger GROUP BY DATE(created_at) HAVING SUM(IF(direction=1,amount,-amount))<>0) t');assert.equal(Number(bad.n),0,'所有业务日借贷平衡')
 assert((await repairDemoLedger({apply:true})).alreadyApplied,'重跑修复严格幂等')
 const before=(await reconcile()).checks.find(x=>x.id==='I6');assert.equal(before.detail.missing,0,'存量事务逐笔全部有存证')
 // 用无关事件填充数量也不能掩盖真正缺失的两笔事务。
 removed.push(...await q("SELECT * FROM attest_event WHERE JSON_EXTRACT(canonical,'$.legacyBackfill')=true AND batch_id IS NULL LIMIT 2"));assert.equal(removed.length,2)
 for(const r of removed)await q('DELETE FROM attest_event WHERE id=?',[r.id])
 for(let i=0;i<3;i++)await attest('bean_grant','bt-'+stamp+i,{txNo:stamp+i,amount:1})
 const badCoverage=(await reconcile()).checks.find(x=>x.id==='I6');assert.equal(badCoverage.detail.missing,2);assert.equal(badCoverage.ok,false,'孤立或多余存证不能冒充覆盖率')
 console.log('PASS balance, all daily totals, idempotent repair, exact transaction coverage, orphan-event negative control')
}finally{
 await q('DELETE FROM attest_event WHERE biz_ref LIKE ?',['bt-'+stamp+'%']);for(const r of removed)await q('INSERT INTO attest_event SET ?',[{...r,canonical:JSON.stringify(r.canonical),leaf_path:r.leaf_path==null?null:JSON.stringify(r.leaf_path)}]);await closeDb()
}
