import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
import { q, one, tx, closeDb } from '../src/db.mjs'
import { cfgAll } from '../src/config.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'
import { enqueueContribution, processContribution, recheckOrderContribution, recheckNoteContribution, validateContributionConfig } from '../src/domain/contribution-growth.mjs'
import { jwtSign } from '../src/auth.mjs'

assertIsolatedDb('test/contribution-growth.mjs')
assert.ok(process.env.PORT && process.env.PORT !== '8080')
const prefix = 'CSQA' + Date.now().toString(36)
const origin = 'http://127.0.0.1:' + process.env.PORT
const orderRow = (id, kind) => one('SELECT * FROM contribution_record WHERE source_id=? AND kind=?', [id, kind])
const run = (source, id) => processContribution(source, id)
const growth = async uid => Number((await one('SELECT growth_value FROM user_account WHERE id=?', [uid])).growth_value)
const trigger = (source, id) => tx(c => enqueueContribution(c, source, id))
let prior
try {
  assert.throws(() => validateContributionConfig('contribution.weights', { q: .5, s: .3, r: .3 }))
  assert.throws(() => validateContributionConfig('contribution.effective_at', '2026-02-30 00:00:00'))
  assert.throws(() => validateContributionConfig('member.cs_multiplier', '1.5'))
  prior = await one("SELECT v FROM rule_config WHERE k='contribution.effective_at'")
  const fixture = await one('SELECT s.id sid,p.id pid,p.merchant_id,p.city_code FROM tour_session s JOIN tour_product p ON p.id=s.product_id LIMIT 1')
  const { insertId: scenic } = await q('INSERT INTO scenic_spot(city_code,name) VALUES(?,?)', [fixture.city_code, prefix])
  const { insertId: other } = await q('INSERT INTO scenic_spot(city_code,name) VALUES(?,?)', [fixture.city_code, prefix + '-other'])
  const { insertId: uid } = await q('INSERT INTO user_account(nickname,mini_a_openid) VALUES(?,?)', [prefix, prefix])
  const { insertId: author } = await q('INSERT INTO user_account(nickname,mini_a_openid) VALUES(?,?)', [prefix+'-a', prefix+'-a'])
  const { insertId: capUser } = await q('INSERT INTO user_account(nickname,mini_a_openid) VALUES(?,?)', [prefix+'-cap', prefix+'-cap'])
  let serial = 0
  async function completed(user, day, place, amount = 19900, promo = true, hour = '08:00:00') {
    const ref = prefix + '-' + ++serial
    const res = await q(`INSERT INTO orders(order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status,
      paid_at,completed_at,promo_scene,promo_snapshot,contribution_scenic_id)
      VALUES (?,?,?,?,?,?,1,?,?,50,?,TIMESTAMPADD(HOUR,1,?),?,?,?)`, [
      ref,user,fixture.pid,fixture.sid,fixture.city_code,fixture.merchant_id,amount,amount,bizDay(day)+' '+hour,bizDay(day)+' '+hour,
      promo ? 'cs-qa' : null,promo ? '{"eligible":true}' : null,place,
    ])
    await trigger('order', res.insertId)
    await Promise.all([run('order', res.insertId),run('order', res.insertId)])
    return res.insertId
  }
  await q("UPDATE rule_config SET v=JSON_QUOTE('') WHERE k='contribution.effective_at'")
  await cfgAll()
  const legacy = await completed(uid, -100, scenic)
  assert.equal(await orderRow(legacy,1),null)
  await q("UPDATE rule_config SET v=JSON_QUOTE(?) WHERE k='contribution.effective_at'", [bizDay(-1)+' 00:00:00'])
  await cfgAll()

  const first = await completed(uid, -8, scenic)
  assert.equal(Number((await orderRow(first,1)).growth_active),995)
  assert.equal(await orderRow(first,3),null)
  const early = await completed(uid,-8,scenic,10000,false,'19:00:00')
  assert.equal(await orderRow(early,3),null)
  const repeat = await completed(uid,-7,scenic,19900,false)
  const sameDay = await completed(uid,-7,scenic,19900,false,'12:00:00')
  const repeat2 = await completed(uid,-6,scenic,19900,false)
  const repeat3 = await completed(uid,-5,scenic,19900,false)
  const repeat4 = await completed(uid,-4,scenic,19900,false)
  const outside = await completed(uid,-3,other,19900,false)
  const absent = await completed(uid,-3,0,19900,false)
  assert.deepEqual(await Promise.all([repeat,repeat2,repeat3].map(async id=>Number((await orderRow(id,3)).growth_active))),[6,6,6])
  for(const id of [sameDay,repeat4,outside,absent]) assert.equal(await orderRow(id,3),null)
  assert.equal(await growth(uid),1013)
  await q('INSERT INTO partial_refund(order_id,refund_no,item_ids,cash_fen,fee_fen,reason,operator,status) VALUES(?,?,JSON_ARRAY(),12000,0,?,?,2)',
    [first,prefix+'-pr','隔离退款','test'])
  await tx(c=>recheckOrderContribution(c,first))
  await run('order',first)
  assert.equal(Number((await orderRow(first,1)).growth_active),395)
  assert.equal(await growth(uid),413)
  await q('UPDATE orders SET status=70 WHERE id=?',[first])
  await tx(c=>recheckOrderContribution(c,first))
  for(const id of [first,repeat,repeat2,repeat3]) await run('order',id)
  assert.equal(await growth(uid),0)
  assert.equal((await orderRow(repeat,3)).growth_state,'revoked')
  const original = (await orderRow(first,1)).rule_snapshot
  assert.equal((typeof original === 'string' ? JSON.parse(original) : original).originalScoreCent,19900)
  const { insertId: rolling } = await q('INSERT INTO scenic_spot(city_code,name) VALUES(?,?)', [fixture.city_code, prefix + '-roll'])
  const oldWindow = await completed(uid,-100,rolling,19900,false)
  const newWindow = await completed(uid,-2,rolling,19900,false)
  assert.equal(await orderRow(oldWindow,3),null)
  assert.equal(await orderRow(newWindow,3),null)
  const newRepeat = await completed(uid,-1,rolling,19900,false)
  assert.equal(Number((await orderRow(newRepeat,3)).anchor_id),Number(newWindow))
  console.log('Q 995→395→0；R 同景区 24h、同日、3单封顶、首单失效联动通过')

  const cap = await completed(capUser,-2,0,199800)
  const clipped = await completed(capUser,-1,0)
  assert.equal(Number((await orderRow(cap,1)).growth_active),9990)
  assert.equal(Number((await orderRow(clipped,1)).growth_active),10)
  await q('UPDATE orders SET status=70 WHERE id=?',[clipped])
  await tx(c=>recheckOrderContribution(c,clipped))
  await run('order',clipped)
  assert.equal(await growth(capUser),9990)
  console.log('每月 10,000 库内单位封顶及只冲实际发放量通过')

  async function entry(i) {
    const t = (await q('INSERT INTO content_task(task_no,title,brief,reward_beans) VALUES(?,?,?,0)', [prefix+'T'+i,'验收约稿','公开内容测试'])).insertId
    const n = (await q('INSERT INTO content_note(user_id,title,body,status) VALUES(?,?,?,2)', [author,'验收投稿',JSON.stringify({text:'隔离内容'})])).insertId
    const e = (await q('INSERT INTO content_task_entry(task_id,user_id,note_id,status,submitted_at) VALUES(?,?,?,2,NOW(3))',[t,author,n])).insertId
    return {e,n}
  }
  const firstEntry = await entry(1)
  const auth = await fetch(origin+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_INIT_PASSWORD||'admin123'})}).then(r=>r.json())
  assert.equal(auth.code,0)
  const approved = await fetch(origin+'/admin/task-entries/'+firstEntry.e+'/verdict',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.data.token},body:JSON.stringify({pass:true,rules:Array(30).fill(true)})}).then(r=>r.json())
  assert.equal(approved.code,0,JSON.stringify(approved))
  await run('entry',firstEntry.e)
  assert.equal(await growth(author),15)
  const frozen = await entry(2)
  await q('UPDATE content_task_entry SET status=3 WHERE id=?',[frozen.e])
  await q('UPDATE user_account SET status=0 WHERE id=?',[author])
  await trigger('entry',frozen.e)
  await run('entry',frozen.e)
  assert.equal((await orderRow(frozen.e,2)).growth_state,'pending')
  assert.equal(await growth(author),15)
  await q('UPDATE user_account SET status=1 WHERE id=?',[author])
  await q("UPDATE contribution_job SET run_after=NOW(3) WHERE source='entry' AND source_id=?",[frozen.e])
  await Promise.all([run('entry',frozen.e),run('entry',frozen.e)])
  assert.equal(await growth(author),30)
  for(let i=3;i<=11;i++){
    const {e}=await entry(i)
    await q('UPDATE content_task_entry SET status=3 WHERE id=?',[e])
    await trigger('entry',e)
    await run('entry',e)
    if(i===11) assert.equal(await orderRow(e,2),null)
  }
  assert.equal(await growth(author),150)
  await q('UPDATE content_note SET status=4 WHERE id=?',[firstEntry.n])
  await tx(c=>recheckNoteContribution(c,firstEntry.n))
  await run('entry',firstEntry.e)
  assert.equal(await growth(author),135)
  const token = jwtSign({ uid: author, end:'c' })
  const mine = await fetch(origin+'/c/member/contribution',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json())
  assert.equal(mine.code,0)
  assert.equal(mine.data.total,10)
  assert.ok(mine.data.rows.some(r=>r.growth_state==='revoked'))
  const fraud = await orderRow(frozen.e,2)
  const revoked = await fetch(origin+'/admin/users/'+author+'/contribution/'+fraud.id+'/revoke',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.data.token},body:JSON.stringify({reason:'隔离风控核验确认无效'})}).then(r=>r.json())
  assert.equal(revoked.code,0,JSON.stringify(revoked))
  await run('entry',frozen.e)
  assert.equal(await growth(author),120)
  console.log('S 实际审核入队、10条月限额、并发补发、撤销冲正及本人记录通过')
} finally {
  if (prior) await q("UPDATE rule_config SET v=? WHERE k='contribution.effective_at'",[JSON.stringify(prior.v)])
  await closeDb()
}
