// 旅豆域：双分录 + 预算池/全局总量双闸 + 试算对账（哨兵虚拟科目，与 Java 版同规则）
import { q, one, tx, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { attest as attestCore } from './attest.mjs'
import { isUserFrozen } from './promo.mjs'
import { settledPartialFen } from './package.mjs'
import * as member from './member.mjs'

export const BIZ = { REBATE: 1, TASK: 2, CONTENT: 3, DEDUCT: 4, REFUND_REVERSE: 5, EXPIRE: 6, RISK: 7, LEGACY_OPENING: 8 }
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

/** D01 旅豆实付锚定上限（豆数）：抵扣 B（分）须满足 B ≤ r×X，X＝G−C−B → B ≤ r(G−C)/(1+r)。
 *  以整数 bp 求解避免浮点误差：beans ≤ floor(rBp×net / (10×(10000+rBp)))，每豆抵 10 分。
 *  禁止直接用 G×r（旧商品额口径会超锚）；net≤0 或 r≤0 时上限为 0。 */
export function anchorCapBeans(goodsFen, freedomDiscountFen, r) {
  const net = Number(goodsFen) - Number(freedomDiscountFen || 0)
  const rBp = Math.round(Number(r) * 10000)
  if (net <= 0 || rBp <= 0) return 0
  return Math.floor((rBp * net) / (10 * (10000 + rBp)))
}

/** 发放（1/2/3）：双闸校验 + 双分录，同事务 */
export async function grant(userId, amount, bizType, bizRef, budgetId, connection) {
  // 7=RISK：人工权益调整（T06）补发；与 1/2/3 同走预算批次与全局哨兵双闸
  if (![1, 2, 3, 7].includes(bizType)) throw new BizError(5001, '非法发放类型（无购买通道）')
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
/** B14 产品专属完成奖励：产品 profile.reward_extra_beans>0 时在订单完成后额外发放。
 *  沿用既有规则：旅豆预算双闸（grant）+ 账本 biz_ref 幂等（PXTRA-单号 只发一次）；冻结账号随 rebate 一起记待补发。
 *  发放依据：按"发放动作执行时点"的产品当前 profile 读取（冻结解冻补发与正常发放同口径；
 *  活动配置变动只影响尚未发放的订单，已发放账本幂等不重发）。
 *  conn 传事务连接时读账也在同一事务（解冻补发复用）；返回发放数量（0=无配置/已发/冻结/无预算）。 */
export async function productExtraReward(o, conn = null) {
  const rd = conn || { one: (s, p) => one(s, p), q: (s, p) => q(s, p) }
  const prod = await rd.one('SELECT profile FROM tour_product WHERE id = ?', [o.product_id])
  const pf = prod ? ((typeof prod.profile === 'string' ? JSON.parse(prod.profile || '{}') : prod.profile) || {}) : {}
  const extra = Math.floor(Number(pf.reward_extra_beans) || 0)
  if (!(extra > 0)) return 0
  const bizRef = 'PXTRA-' + o.order_no
  const done = await rd.one(`SELECT 1 FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
    WHERE a.user_id = ? AND l.biz_type = ? AND l.biz_ref = ? LIMIT 1`, [o.user_id, BIZ.TASK, bizRef])
  if (done) return 0
  if (await isUserFrozen(o.user_id)) {
    await q('UPDATE orders SET bean_rebate_deferred = 1 WHERE order_no = ?', [o.order_no])
    return 0
  }
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (!budget) return 0
  await grant(Number(o.user_id), extra, BIZ.TASK, bizRef, budget.id, conn)
  return extra
}

/** 修复3（Codex退回#3）：适用商品现金基数＝总实付 − 保费 − 已结算按项退款。
 *  返豆（rebateOrder）、冻结补发（releaseDeferredRebates）、成长值（jobs/admin 完成路径）、
 *  佣金基数（promo.createCommission）共用本函数，部分退款后按剩余商品实收发放，不再读退款前实付。
 *  o 需含 id/amount_pay/insurance_fee；c 可传事务连接（补发路径与订单行同事务）。 */
export async function goodsCashBase(o, c = { one: (sql, p) => one(sql, p) }) {
  const base = Number(o.amount_pay) - Number(o.insurance_fee || 0) - await settledPartialFen(o.id, c)
  return Math.max(0, base)
}

export async function rebateOrder(o) {
  // D01：返豆按最终实际支付的"适用商品金额"计算（总实付 − 保费/代收款 − 已结算按项退款），不用原价或券前金额；
  // 保费直付保险方，与佣金基数（promo.createCommission）同一口径。
  const goodsCash = await goodsCashBase(o)
  if (!(goodsCash > 0)) return 0
  if (await isUserFrozen(o.user_id)) {
    await q('UPDATE orders SET bean_rebate_deferred = 1 WHERE order_no = ?', [o.order_no])
    return 0
  }
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (!budget) return 0
  const rebate = await rebateOf(goodsCash, await member.rebateBonusBp(o.user_id))
  if (rebate > 0) await grant(Number(o.user_id), rebate, BIZ.REBATE, o.order_no, budget.id)
  return rebate
}

/**
 * 解冻后补发冻结期间的订单返豆 + 产品专属完成奖励（修复5，Codex退回#5）。
 * 此前两者共用 bean_rebate_deferred 标记，但解冻流程只补普通返豆就清标记——产品专属奖励被永久丢弃；
 * 现两者都在补发范围内，各自按账本 biz_ref 幂等（REBATE-单号 / PXTRA-单号），有无普通返豆都正确补专属奖励。
 * 金额口径：与 rebateOrder 同一基数（总实付 − 保费 − 已结算按项退款，修复3），按补发时点比例计算。
 * 专属奖励发放依据：补发时点产品当前 profile（与正常发放路径"执行时点读取"一致）。
 * 幂等：逐单加锁，账本已有的部分只清标记；已不是完成态（如退款）的单只清标记、不发。
 * 无预算/触顶时事务回滚保留标记，下次解冻或人工处理。返回补发的订单数。
 */
export async function releaseDeferredRebates(userId) {
  if (await isUserFrozen(userId)) return 0
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (!budget) return 0
  let n = 0
  for (const { order_no: orderNo } of await q('SELECT order_no FROM orders WHERE user_id = ? AND bean_rebate_deferred = 1 ORDER BY id', [userId])) {
    await tx(async (c) => {
      const o = await c.one('SELECT id, order_no, user_id, product_id, status, amount_pay, insurance_fee, bean_rebate_deferred FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
      if (!o || !Number(o.bean_rebate_deferred)) return
      // 补发期间再冻结：整单跳过，标记保留待下一轮（不清标记、不半补）
      if (await isUserFrozen(userId)) return
      const done = await c.one(`SELECT 1 FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
        WHERE a.user_id = ? AND l.biz_type = ? AND l.direction = 1 AND l.biz_ref = ? LIMIT 1`, [userId, BIZ.REBATE, orderNo])
      // 与 rebateOrder 同口径：按适用商品金额（总实付 − 保费 − 已结算按项退款）补发
      const rebate = await rebateOf(await goodsCashBase(o, c), await member.rebateBonusBp(userId))
      let granted = false
      // 非完成态（如已退款 70）：只清标记、不发（与普通返豆同一口径）
      if (Number(o.status) === 50) {
        if (!done && rebate > 0) { await grant(Number(userId), rebate, BIZ.REBATE, orderNo, budget.id, c); granted = true }
        // 修复5：产品专属完成奖励随解冻一并补发（有无普通返豆两种情况都要补到）
        const extra = await productExtraReward({ ...o, order_no: orderNo }, c)
        if (extra > 0) granted = true
      }
      if (granted) n++
      await c.upd('UPDATE orders SET bean_rebate_deferred = 0 WHERE order_no = ?', [orderNo])
    })
  }
  return n
}

/**
 * 过期应扣量（A-02，FIFO 口径）：发放按批次（账本入账行）记账，消费从最早批次扣起；
 * 过期 = 各过期批次（发放时间早于 NOW()-expire_months）中"尚未被消费"的剩余量之和。
 * 关键不变式：各批次剩余量之和恒等于账户余额，因此"应扣 ≤ 余额"天然成立；
 * 过期扣减本身也是一笔消费（biz=6），会扣掉对应批次 → 天然幂等，连跑多轮只扣一次。
 * 批次口径：贷方（direction=1）为发放 1/2/3 与退款退回 5、存量导入 8；借方（direction=2）为 4/6/7 消费。
 * 仅 1/2/3（营销发放）参与过期；5/8 不参与（存量导入与退款退回没有约定有效期）。
 */
export async function expiredDue(userId, months, connection) {
  const run = (c) => c.q(`SELECT l.id, l.direction, l.amount, l.biz_type, (SELECT NOW() - INTERVAL ? MONTH) AS cutoff, l.created_at
    FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
    WHERE a.user_id = ? AND a.user_id < 999999000000 ORDER BY l.id`, [months, userId])
  const rows = connection ? await run(connection) : await q(`SELECT l.id, l.direction, l.amount, l.biz_type, (SELECT NOW() - INTERVAL ? MONTH) AS cutoff, l.created_at
    FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
    WHERE a.user_id = ? AND a.user_id < 999999000000 ORDER BY l.id`, [months, userId])
  const batches = []
  for (const r of rows) {
    const type = Number(r.biz_type), amt = Number(r.amount)
    if (Number(r.direction) === 1) {
      if ([1, 2, 3, 5, 8].includes(type)) batches.push({ remaining: amt, expirable: [1, 2, 3].includes(type), created: r.created_at })
    } else if ([4, 6, 7].includes(type)) {
      let need = amt
      for (const b of batches) { if (need <= 0) break; const take = Math.min(b.remaining, need); b.remaining -= take; need -= take }
    }
  }
  const cutoff = rows.length ? rows[0].cutoff : null
  if (!cutoff) return 0
  let due = 0
  for (const b of batches) {
    if (b.expirable && b.remaining > 0 && new Date(b.created) < new Date(cutoff)) due += b.remaining
  }
  return due
}

/**
 * 旅豆发放 / 净消耗（按"数量"，不是账本行数）。
 * 发放 = 用户户收到的 1/2/3 类入账；消耗 = 用户户被扣的 4/6/7 类出账 − 退款冲正退回的 5 类入账。
 * 注意不能数 direction=2 的全部行：每笔发放在预算哨兵户上还有一条借方，数进去会让"使用率"虚高、甚至超过 100%。
 */
export async function flow() {
  // 口径按真实用户户（user_id < 哨兵段）：发放=1/2/3/7 入账；消耗=4/6/7 出账 − 5 退回。
  // 7=RISK 人工调整（T06）双向都记账：补发入用户户+预算哨兵出账；扣回出用户户+平台哨兵入账——
  // 哨兵对手方不参与统计，否则扣回的对手方会被误计为"发放"。
  const r = await one(`SELECT
    (SELECT COALESCE(SUM(l.amount),0) FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE l.direction = 1 AND l.biz_type IN (1,2,3,7,8) AND a.user_id < 999999000000) granted,
    (SELECT COALESCE(SUM(l.amount),0) FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE l.direction = 1 AND l.biz_type = 8 AND a.user_id < 999999000000) opening_imported,
    (SELECT COALESCE(SUM(l.amount),0) FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE l.direction = 2 AND l.biz_type IN (4,6,7) AND a.user_id < 999999000000) debited,
    (SELECT COALESCE(SUM(l.amount),0) FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE l.direction = 1 AND l.biz_type = 5 AND a.user_id < 999999000000) reversed`)
  return { granted: Number(r.granted), openingImported: Number(r.opening_imported), consumed: Number(r.debited) - Number(r.reversed) }
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
