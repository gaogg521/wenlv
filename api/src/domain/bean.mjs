// 旅豆域：双分录 + 预算池/全局总量双闸 + 试算对账（哨兵虚拟科目，与 Java 版同规则）
import { q, one, tx, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'

export const BIZ = { REBATE: 1, TASK: 2, CONTENT: 3, DEDUCT: 4, REFUND_REVERSE: 5, EXPIRE: 6, RISK: 7 }
export const SENTINEL_PLATFORM = 999999000001n
export const SENTINEL_BUDGET = 999999000009n

async function acctId(c, userId) {
  let m = await c.one('SELECT id FROM bean_account WHERE user_id = ?', [userId])
  if (!m) { await c.ins('INSERT INTO bean_account (user_id) VALUES (?)', [userId]); m = await c.one('SELECT id FROM bean_account WHERE user_id = ?', [userId]) }
  return Number(m.id)
}
async function virtualId(c, sentinel) {
  let m = await c.one('SELECT id FROM bean_account WHERE user_id = ?', [sentinel])
  if (!m) { await c.ins('INSERT INTO bean_account (user_id) VALUES (?)', [sentinel]); m = await c.one('SELECT id FROM bean_account WHERE user_id = ?', [sentinel]) }
  return Number(m.id)
}

export async function balance(userId) {
  const m = await one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])
  return m ? Number(m.balance) : 0
}

export const rebateOf = async (payFen) => Math.round(payFen / 10 * (await cfgNum('bean.order_rate')))
export const clampDeduct = async (wanted, orderFen) =>
  Math.max(0, Math.min(wanted, Math.floor((orderFen * (await cfgNum('bean.deduct_max_pct'))) / 10)))

/** 发放（1/2/3）：双闸校验 + 双分录，同事务 */
export async function grant(userId, amount, bizType, bizRef, budgetId, connection) {
  if (![1, 2, 3].includes(bizType)) throw new BizError(5001, '非法发放类型（无购买通道）')
  const run = async (c) => {
    const aid = await acctId(c, userId)
    const acc = await c.one('SELECT balance FROM bean_account WHERE id = ? FOR UPDATE', [aid])
    const b = await c.one('SELECT total, granted, returned FROM bean_budget WHERE id = ? FOR UPDATE', [budgetId])
    if (!b) throw new BizError(5002, '预算批次不存在')
    if (Number(b.granted) + amount > Number(b.total) + Number(b.returned))
      throw new BizError(5002, '批次预算超限（严禁超发）')
    const cap = await c.one('SELECT cap_total, issued_sum FROM bean_global_cap WHERE id = 1 FOR UPDATE')
    if (Number(cap.issued_sum) + amount > Number(cap.cap_total))
      throw new BizError(5003, '全局发行总量触顶（严禁超发红线）')
    const bid = await virtualId(c, SENTINEL_BUDGET)
    const txNo = 'BT' + Date.now() + Math.floor(Math.random() * 1000)
    await c.q(`INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref, budget_id) VALUES
      (?,?,1,?,?,?,?,?),(?,?,2,?,?,?,?,?)`,
      [txNo, aid, amount, Number(acc.balance) + amount, bizType, bizRef, budgetId,
       txNo, bid, amount, Number(b.granted) + amount, bizType, bizRef, budgetId])
    await c.upd('UPDATE bean_account SET balance = balance + ?, lifetime = lifetime + ?, version = version + 1 WHERE id = ?', [amount, amount, aid])
    await c.upd('UPDATE bean_budget SET granted = granted + ? WHERE id = ?', [amount, budgetId])
    await c.upd('UPDATE bean_global_cap SET issued_sum = issued_sum + ? WHERE id = 1', [amount])
    return Number(acc.balance) + amount
  }
  return connection ? run(connection) : tx(run)
}

/** 抵扣/回收（4/6/7）：借用户 */
export async function deduct(userId, amount, bizType, bizRef, connection) {
  if (![4, 6, 7].includes(bizType)) throw new BizError(5001, '非法扣减类型')
  const run = async (c) => {
    const aid = await acctId(c, userId)
    const acc = await c.one('SELECT balance FROM bean_account WHERE id = ? FOR UPDATE', [aid])
    if (Number(acc.balance) < amount) throw new BizError(5001, '旅豆余额不足')
    const pid = await virtualId(c, SENTINEL_PLATFORM)
    const txNo = 'BT' + Date.now() + Math.floor(Math.random() * 1000)
    await c.q(`INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) VALUES
      (?,?,2,?,?,?,?),(?,?,1,?,?,?,?)`,
      [txNo, aid, amount, Number(acc.balance) - amount, bizType, bizRef,
       txNo, pid, amount, amount, bizType, bizRef])
    await c.upd('UPDATE bean_account SET balance = balance - ?, version = version + 1 WHERE id = ?', [amount, aid])
    return Number(acc.balance) - amount
  }
  return connection ? run(connection) : tx(run)
}

/** 退款冲正退回（5）：不占预算与总量 */
export async function reverse(userId, amount, bizRef, connection) {
  const run = async (c) => {
    const aid = await acctId(c, userId)
    const acc = await c.one('SELECT balance FROM bean_account WHERE id = ? FOR UPDATE', [aid])
    const pid = await virtualId(c, SENTINEL_PLATFORM)
    const txNo = 'BT' + Date.now() + Math.floor(Math.random() * 1000)
    await c.q(`INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) VALUES
      (?,?,1,?,?,5,?),(?,?,2,?,?,5,?)`,
      [txNo, aid, amount, Number(acc.balance) + amount, bizRef,
       txNo, pid, amount, 0, bizRef])
    await c.upd('UPDATE bean_account SET balance = balance + ?, version = version + 1 WHERE id = ?', [amount, aid])
    return Number(acc.balance) + amount
  }
  return connection ? run(connection) : tx(run)
}

/** 日终试算：真实用户户 balance==Σcredit-Σdebit；全账本 Σ贷==Σ借 */
export async function trialBalance() {
  const perAcct = await q(`SELECT a.id, a.balance,
    COALESCE(SUM(CASE WHEN l.direction=1 THEN l.amount ELSE -l.amount END),0) AS derived
    FROM bean_account a JOIN user_account u ON u.id = a.user_id
    LEFT JOIN bean_ledger l ON l.account_id = a.id GROUP BY a.id, a.balance`)
  const perOk = perAcct.every(r => Number(r.balance) === Number(r.derived))
  const t = await one('SELECT SUM(CASE WHEN direction=1 THEN amount ELSE 0 END) cr, SUM(CASE WHEN direction=2 THEN amount ELSE 0 END) dr FROM bean_ledger')
  return { perOk, globalOk: Number(t.cr || 0) === Number(t.dr || 0), credit: Number(t.cr || 0), debit: Number(t.dr || 0) }
}
