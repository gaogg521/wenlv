// P-14：公开复核页的四类分录计数（真实用户发放 / 抵扣 / 退款冲正 / 期初导入）。
// 用四组夹具（仅发放 / 仅抵扣 / 退款冲正 / 发放+期初导入同日）验证：
//   1) 分类金额只统计真实用户户的分录，按行计数，与逐条明细一致；
//   2) 对手分录（预算哨兵户的借贷）单列，不计入用户口径；
//   3) 用户口径 + 对手分录 = 当日 Σ贷 / Σ借（reconciled=true）；
//   4) _verifyBeanDay 其余字段（根 / 借贷合计 / 平衡）不因分类统计改变。
// 只能对隔离库运行。夹具直接写 bean_ledger（带日期的行）+ closeBeanDay 封存，不动任何账户余额。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/bean-day-categories.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { closeBeanDay } from '../src/domain/attest.mjs'
import { web3 } from '../src/routes/web3.mjs'

let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
// 夹具日期：远过去（早于种子与其他套件的当日数据），互不相同；每遍先清自己的旧行保证可重复
const DAYS = { grant: '2026-09-10', debit: '2026-09-11', refund: '2026-09-12', opening: '2026-09-13' }
const TX = 'p14cat-'

await q('DELETE FROM bean_ledger WHERE tx_no LIKE ?', [TX + '%'])
for (const day of Object.values(DAYS)) {
  await q('DELETE FROM bean_day_root WHERE biz_date = ?', [day])
  await q(`DELETE FROM attest_batch WHERE biz_date = ? AND merkle_kind = 'bean_day' AND status NOT IN (2, 5)`, [day])
}
const user = await one('SELECT id FROM user_account WHERE id < 999999000000 ORDER BY id LIMIT 1')
assert.ok(user, '隔离库里没有真实用户')
const ensureAcct = async (userId) => {
  let a = await one('SELECT id FROM bean_account WHERE user_id = ?', [userId])
  if (!a) { await q('INSERT INTO bean_account (user_id) VALUES (?)', [userId]); a = await one('SELECT id FROM bean_account WHERE user_id = ?', [userId]) }
  return a.id
}
const userAcct = await ensureAcct(user.id)
const budgetAcct = await ensureAcct(999999000009)   // 预算哨兵户（发放的对手方）
const platformAcct = await ensureAcct(999999000001) // 平台哨兵户（抵扣/冲正的对手方）
const at = (day) => day + ' 12:00:00'
let seqNo = 0
const ins = async (day, txNo, acctId, direction, bizType, amount) => {
  await q(`INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref, created_at)
           VALUES (?,?,?,?,0,?,?,?)`, [txNo, acctId, direction, amount, bizType, 'p14-fixture', at(day)])
}
// 形状与 bean.grant / bean.deduct / bean.reverse 一致：
//   发放=用户贷(dir1)+预算哨兵借(dir2)；抵扣/回收=用户借(dir2)+平台哨兵贷(dir1)；冲正=用户贷(dir1)+平台哨兵借(dir2)
const grantPair = (day, bizType, amount) => { const tx = TX + day.replaceAll('-', '') + '-g' + (++seqNo); return Promise.all([ins(day, tx, userAcct, 1, bizType, amount), ins(day, tx, budgetAcct, 2, bizType, amount)]) }
const deductPair = (day, bizType, amount) => { const tx = TX + day.replaceAll('-', '') + '-d' + (++seqNo); return Promise.all([ins(day, tx, userAcct, 2, bizType, amount), ins(day, tx, platformAcct, 1, bizType, amount)]) }
const reversePair = (day, amount) => { const tx = TX + day.replaceAll('-', '') + '-r' + (++seqNo); return Promise.all([ins(day, tx, userAcct, 1, 5, amount), ins(day, tx, platformAcct, 2, 5, amount)]) }
const seal = async (day) => {
  const r = await closeBeanDay(day)
  assert.ok(r.ok, day + ' 封存失败：' + JSON.stringify(r))
}
const dayOf = async (day) => {
  const r = await web3._verifyBeanDay(day)
  assert.ok(r.found, day + ' 应有封存记录')
  return r
}
// 分类与逐条明细对账：库内该日用户户分录按同一口径分组，必须与接口返回逐项相等
const detailMatches = async (day, r) => {
  const rows = await q(`SELECT l.direction, l.biz_type, l.amount FROM bean_ledger l
    JOIN bean_account a ON a.id = l.account_id WHERE DATE(l.created_at) = ? AND a.user_id < 999999000000`, [day])
  const sum = (f) => rows.filter(f).reduce((s, x) => s + Number(x.amount), 0)
  const cnt = (f) => rows.filter(f).length
  const c = r.categories
  assert.equal(c.userGranted.amount, sum((x) => x.direction === 1 && [1, 2, 3].includes(Number(x.biz_type))))
  assert.equal(c.userGranted.count, cnt((x) => x.direction === 1 && [1, 2, 3].includes(Number(x.biz_type))))
  assert.equal(c.openingImported.amount, sum((x) => x.direction === 1 && Number(x.biz_type) === 8))
  assert.equal(c.refundReversed.amount, sum((x) => x.direction === 1 && Number(x.biz_type) === 5))
  assert.equal(c.userDebited.amount, sum((x) => x.direction === 2 && Number(x.biz_type) === 4))
}

console.log('== 旅豆日终四类分录计数（P-14）==')

await t('夹具一·仅发放：计入用户发放，对手分录单列，不混入用户消耗', async () => {
  await grantPair(DAYS.grant, 1, 100) // 消费返豆：用户贷 100 + 预算哨兵借 100
  await seal(DAYS.grant)
  const r = await dayOf(DAYS.grant)
  assert.equal(r.creditSum, 100); assert.equal(r.debitSum, 100); assert.equal(r.balanced, true)
  assert.equal(r.categories.userGranted.amount, 100)
  assert.equal(r.categories.userGranted.count, 1, '行数只数真实用户户的分录')
  assert.equal(r.categories.counterparty.debit, 100, '对手分录单列')
  assert.equal(r.categories.userDebited.amount, 0, '没有抵扣不能显示成有')
  assert.equal(r.categories.reconciled, true)
  await detailMatches(DAYS.grant, r)
})

await t('夹具二·仅抵扣：计入用户抵扣，发放为零', async () => {
  await deductPair(DAYS.debit, 4, 30) // 抵扣：用户借 30 + 平台哨兵贷 30
  await seal(DAYS.debit)
  const r = await dayOf(DAYS.debit)
  assert.equal(r.categories.userDebited.amount, 30)
  assert.equal(r.categories.userDebited.count, 1)
  assert.equal(r.categories.userGranted.amount, 0)
  assert.equal(r.categories.counterparty.credit, 30)
  assert.equal(r.categories.reconciled, true)
  await detailMatches(DAYS.debit, r)
})

await t('夹具三·退款冲正：冲正退回单列，不算新发放', async () => {
  await reversePair(DAYS.refund, 20) // 退款冲正：用户贷 20 + 平台哨兵借 20
  await seal(DAYS.refund)
  const r = await dayOf(DAYS.refund)
  assert.equal(r.categories.refundReversed.amount, 20)
  assert.equal(r.categories.userGranted.amount, 0, '冲正不是发放')
  assert.equal(r.categories.reconciled, true)
  await detailMatches(DAYS.refund, r)
})

await t('夹具四·同日发放+期初导入：两类分别计数，互不吞并', async () => {
  await grantPair(DAYS.opening, 1, 60)   // 发放
  await grantPair(DAYS.opening, 8, 500)  // 期初导入（同 grant 形状：用户贷+预算哨兵借）
  await seal(DAYS.opening)
  const r = await dayOf(DAYS.opening)
  assert.equal(r.categories.userGranted.amount, 60)
  assert.equal(r.categories.openingImported.amount, 500)
  assert.equal(r.categories.openingImported.count, 1)
  assert.equal(r.creditSum, 560); assert.equal(r.debitSum, 560)
  assert.equal(r.categories.userCreditTotal, 560)
  assert.equal(r.categories.reconciled, true)
  await detailMatches(DAYS.opening, r)
})

await t('过期回收/人工调整（6/7）归"其他调整"，仍参与对账', async () => {
  await deductPair(DAYS.opening, 6, 10) // 过期回收：用户借 10 + 平台哨兵贷 10
  await q('DELETE FROM bean_day_root WHERE biz_date = ?', [DAYS.opening])
  await q(`DELETE FROM attest_batch WHERE biz_date = ? AND merkle_kind = 'bean_day' AND status NOT IN (2, 5)`, [DAYS.opening])
  await seal(DAYS.opening)
  const r = await dayOf(DAYS.opening)
  assert.equal(r.categories.otherAdjust.debit, 10)
  assert.equal(r.categories.userDebitTotal, 10)
  assert.equal(r.categories.reconciled, true)
})

await t('未封存日仍返回 found=false；分类统计不改变根与合计', async () => {
  const nf = await web3._verifyBeanDay('2026-09-14')
  assert.equal(nf.found, false)
  const again = await dayOf(DAYS.grant)
  assert.equal(again.creditSum, 100); assert.equal(again.debitSum, 100)
  assert.ok(again.merkleRoot, '根仍存在')
})

// 收尾：夹具是直接写账本的，不带存证事件；留在库里会让后面的存证完整性对账（test:chain）失败
await q('DELETE FROM bean_ledger WHERE tx_no LIKE ?', [TX + '%'])
for (const day of Object.values(DAYS)) {
  await q('DELETE FROM bean_day_root WHERE biz_date = ?', [day])
  await q(`DELETE FROM attest_batch WHERE biz_date = ? AND merkle_kind = 'bean_day'`, [day])
}
console.log(`${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
