// 旅豆域：双分录 + 预算池/全局总量双闸 + 试算对账（哨兵虚拟科目，与 Java 版同规则）
import { q, one, tx, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { attest as attestCore } from './attest.mjs'
import { isUserFrozen } from './promo.mjs'
import * as member from './member.mjs'

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

// bonusBp：会员等级带来的返豆加成（bp，叠加在基础返豆率上），见 member.mjs
export const rebateOf = async (payFen, bonusBp = 0) => Math.round(payFen / 10 * ((await cfgNum('bean.order_rate')) + bonusBp / 10000))
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
    // 发放即锚定（同事务）：biz_ref 取账本流水号，一笔发放一片叶子，绝不用业务单号（会覆盖）
    await attestCore('bean_grant', 'bt-' + txNo, {
      txNo, accountId: Number(aid), userId: Number(userId), amount: Number(amount),
      bizType: Number(bizType), bizRef: bizRef || null, budgetId: Number(budgetId),
      afterBal: Number(acc.balance) + Number(amount),
    }, c, 1)
    return Number(acc.balance) + amount
  }
  return connection ? run(connection) : tx(run)
}

/** 抵扣/回收（4/6/7）：借用户 */
export async function deduct(userId, amount, bizType, bizRef, connection) {
  if (![4, 6, 7].includes(bizType)) throw new BizError(5001, '非法扣减类型')
  // 冻结账号不能用旅豆抵扣（红线 12）；过期与风控回收（6/7）照常，本来就要能对冻结账号执行
  if (bizType === BIZ.DEDUCT && await isUserFrozen(userId)) throw new BizError(6001, '账号已被停用，旅豆暂停使用')
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
    // 抵扣/过期/风控回收同样锚定：旅豆的"减少"也必须可验证，否则"严禁超发"只证明了一半
    await attestCore('bean_deduct', 'bt-' + txNo, {
      txNo, accountId: Number(aid), userId: Number(userId), amount: Number(amount),
      bizType: Number(bizType), bizRef: bizRef || null, afterBal: Number(acc.balance) - Number(amount),
    }, c, 1)
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
    await attestCore('bean_deduct', 'bt-' + txNo, {
      txNo, accountId: Number(aid), userId: Number(userId), amount: Number(amount),
      bizType: 5, bizRef: bizRef || null, afterBal: Number(acc.balance) + Number(amount), reversed: true,
    }, c, 1)
    return Number(acc.balance) + amount
  }
  return connection ? run(connection) : tx(run)
}

/**
 * 订单完成返豆（定时任务与后台联调「完成」共用）。
 * 账号冻结时不发，订单记为"待补发"（V39 bean_rebate_deferred），解冻后由 releaseDeferredRebates 补发：照常累计、不丢失。
 */
export async function rebateOrder(o) {
  if (!(Number(o.amount_pay) > 0)) return 0
  if (await isUserFrozen(o.user_id)) {
    await q('UPDATE orders SET bean_rebate_deferred = 1 WHERE order_no = ?', [o.order_no])
    return 0
  }
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (!budget) return 0
  const rebate = await rebateOf(Number(o.amount_pay), await member.rebateBonusBp(o.user_id))
  if (rebate > 0) await grant(Number(o.user_id), rebate, BIZ.REBATE, o.order_no, budget.id)
  return rebate
}

/**
 * 解冻后补发冻结期间的订单返豆。按补发时的返豆比例计算（冻结时没有快照）。
 * 幂等：逐单加锁，账本里已有该单返豆就只清标记；已不是完成态（如退款）的单只清标记、不发。
 * 没有可用预算或预算/总量触顶时保留标记，下次解冻或人工处理。返回补发的订单数。
 */
export async function releaseDeferredRebates(userId) {
  if (await isUserFrozen(userId)) return 0
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (!budget) return 0
  let n = 0
  for (const { order_no: orderNo } of await q('SELECT order_no FROM orders WHERE user_id = ? AND bean_rebate_deferred = 1 ORDER BY id', [userId])) {
    await tx(async (c) => {
      const o = await c.one('SELECT order_no, status, amount_pay, bean_rebate_deferred FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
      if (!o || !Number(o.bean_rebate_deferred)) return
      const done = await c.one(`SELECT 1 FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
        WHERE a.user_id = ? AND l.biz_type = ? AND l.direction = 1 AND l.biz_ref = ? LIMIT 1`, [userId, BIZ.REBATE, orderNo])
      const rebate = await rebateOf(Number(o.amount_pay), await member.rebateBonusBp(userId))
      if (!done && Number(o.status) === 50 && rebate > 0) { await grant(Number(userId), rebate, BIZ.REBATE, orderNo, budget.id, c); n++ }
      await c.upd('UPDATE orders SET bean_rebate_deferred = 0 WHERE order_no = ?', [orderNo])
    })
  }
  return n
}

/**
 * 旅豆发放 / 净消耗（按"数量"，不是账本行数）。
 * 发放 = 用户户收到的 1/2/3 类入账；消耗 = 用户户被扣的 4/6/7 类出账 − 退款冲正退回的 5 类入账。
 * 注意不能数 direction=2 的全部行：每笔发放在预算哨兵户上还有一条借方，数进去会让"使用率"虚高、甚至超过 100%。
 */
export async function flow() {
  const r = await one(`SELECT
    COALESCE(SUM(CASE WHEN direction = 1 AND biz_type IN (1,2,3) THEN amount END), 0) granted,
    COALESCE(SUM(CASE WHEN direction = 2 AND biz_type IN (4,6,7) THEN amount END), 0) debited,
    COALESCE(SUM(CASE WHEN direction = 1 AND biz_type = 5 THEN amount END), 0) reversed FROM bean_ledger`)
  return { granted: Number(r.granted), consumed: Number(r.debited) - Number(r.reversed) }
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
