// 推广域（一级 CPS 三档）+ 结算域（五口径恒等）
import crypto from 'node:crypto'
import { q, one, tx, BizError } from '../db.mjs'
import { cfg, cfgArr, cfgNum } from '../config.mjs'
import { attest } from './attest.mjs'
import { bizDay } from '../infra/bizdate.mjs'

/** 结算单锚定：version_no 默认 = 结算主状态（0生成/1商户确认/2分账/3完成/4异议），
 *  异议解除回 0 时用 40，避免与"生成"撞同一版本号被幂等吞掉 */
export async function attestSettlement(settlementId, conn, versionNo) {
  // 必须用同一事务连接读：在 tx() 里刚改的状态还没提交，用全局连接会读到旧状态，
  // 结果是"复核通过(v2)"那条存证里写的却是 status=1 —— 证据与事实不符
  const s = conn ? await conn.one('SELECT * FROM settlement WHERE id = ?', [settlementId])
    : await one('SELECT * FROM settlement WHERE id = ?', [settlementId])
  if (!s) return null
  const v = versionNo != null ? Number(versionNo) : Number(s.status)
  return attest('settlement', 'settle-' + s.id, {
    settlementId: Number(s.id), merchantId: Number(s.merchant_id), period: s.period,
    orderCount: Number(s.order_count), totalAmount: Number(s.total_amount),
    amtFulfill: Number(s.amt_fulfill), amtService: Number(s.amt_service),
    amtPromoter: Number(s.amt_promoter), amtBeanbudget: Number(s.amt_beanbudget),
    amtRetained: Number(s.amt_retained), status: Number(s.status),
    feeCount: Number(s.fee_count || 0), feeTotal: Number(s.fee_total || 0), feeMerchant: Number(s.fee_merchant || 0), feePlatform: Number(s.fee_platform || 0),
    feeShareBp: s.fee_share_bp != null ? Number(s.fee_share_bp) : null,
    // 回单号只存哈希：可证明"登记的是哪张回单"，又不把银行流水号公开到复核页
    paymentRefHash: s.payment_ref ? crypto.createHash('sha256').update(String(s.payment_ref)).digest('hex') : null,
  }, conn, v)
}

export async function register(userId, tier) {
  const rates = await cfgArr('promoter.rate_bp')
  const rate = rates[Math.max(1, Math.min(tier, rates.length)) - 1]
  await q('INSERT INTO promoter (user_id, tier, rate_bp, status) VALUES (?,?,?,1) '
    + 'ON DUPLICATE KEY UPDATE tier = VALUES(tier), rate_bp = VALUES(rate_bp)', [userId, tier, rate])
  return rate
}

export async function createScene(promoterId, channel) {
  const scene = 'p' + promoterId.toString(36) + (channel ? '-' + channel : '')
  await q('INSERT IGNORE INTO attribution (promoter_id, scene, channel) VALUES (?,?,?)', [promoterId, scene, channel || null])
  return scene
}

export async function hit(scene, userId) {
  const a = await one('SELECT promoter_id FROM attribution WHERE scene = ?', [scene])
  if (!a) return false
  try { await q('INSERT INTO attribution_hit (scene, user_id) VALUES (?,?)', [scene, userId]); return true }
  catch { return false }
}

/** 订单 50 后计佣（幂等） */
export async function createCommission(orderNo) {
  const o = await one('SELECT id, product_id, promo_scene, amount_pay, bean_deducted, insurance_fee, paid_at FROM orders WHERE order_no = ?', [orderNo])
  if (!o || !o.promo_scene) return false
  const a = await one('SELECT promoter_id FROM attribution WHERE scene = ?', [o.promo_scene])
  if (!a) return false
  const p = await one('SELECT rate_bp, status FROM promoter WHERE user_id = ? AND status = 1', [a.promoter_id])
  if (!p) return false
  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶
  const prod = await one('SELECT promo_rate_bp, profile FROM tour_product WHERE id = ?', [o.product_id])
  // 单品覆盖只在后台「逐品佣金」设置的生效期内有效（按订单支付日判断），期外回落到推广服务商档位
  const pf = prod ? ((typeof prod.profile === 'string' ? JSON.parse(prod.profile || '{}') : prod.profile) || {}) : {}
  const payDay = o.paid_at ? String(o.paid_at).slice(0, 10) : bizDay()
  const inWindow = (!pf.rate_start || payDay >= pf.rate_start) && (!pf.rate_end || payDay <= pf.rate_end)
  const rateBp = Math.min(prod && prod.promo_rate_bp != null && inWindow ? Number(prod.promo_rate_bp) : Number(p.rate_bp), 1200)
  const base = Number(o.amount_pay) - Number(o.bean_deducted) * 10 - Number(o.insurance_fee || 0) // 保费直付保险方，不计佣
  const amount = Math.floor(base * rateBp / 10000)
  try {
    await q(`INSERT INTO commission (order_id, promoter_id, base_amount, rate_bp, amount, status, payable_at)
      VALUES (?,?,?,?,?,0, NOW() + INTERVAL ? DAY)`, [o.id, a.promoter_id, base, rateBp, amount, await cfgNum('commission.settle_delay_days')])
    await q('UPDATE promoter SET valid_gmv_90d = valid_gmv_90d + ? WHERE user_id = ?', [base, a.promoter_id])
    return true
  } catch { return false }
}

export async function invalidateCommission(orderNo) {
  const o = await one('SELECT id FROM orders WHERE order_no = ?', [orderNo])
  if (o) await q('UPDATE commission SET status = CASE WHEN status = 2 THEN 3 ELSE 4 END WHERE order_id = ?', [o.id])
}

export async function settleDue() {
  const r = await q('UPDATE commission SET status = 1 WHERE status = 0 AND payable_at <= NOW(3)')
  return r.affectedRows
}

/** 结算五口径比例（万分比）：参数中心 settlement.split_fulfill / split_service / split_beanbudget */
export async function splitBp() {
  const g = async (k, d) => Math.round((Number(await cfg(k).catch(() => d)) || 0) * 10000)
  return { fulfill: await g('settlement.split_fulfill', 0.58), service: await g('settlement.split_service', 0.12), beanbudget: await g('settlement.split_beanbudget', 0.05) }
}

/** 退改手续费商户分成（万分比）：商户资料「退改手续费分成」优先，否则参数中心 settlement.refund_fee_merchant_pct */
export async function feeShareBp(c, merchantId) {
  const m = await c.one('SELECT profile FROM merchant WHERE id = ?', [merchantId])
  const pf = m ? ((typeof m.profile === 'string' ? JSON.parse(m.profile || '{}') : m.profile) || {}) : {}
  if (pf.refund_fee_share != null && pf.refund_fee_share !== '') return Math.max(0, Math.min(10000, Math.round(Number(pf.refund_fee_share))))
  const pct = Number(await cfg('settlement.refund_fee_merchant_pct').catch(() => 0)) || 0
  return Math.max(0, Math.min(10000, Math.round(pct * 10000)))
}

// ===== 结算（五口径：履约58% / 服务12% / 权益5% / 推广=实际佣金 / 留存=差额兜底）=====
export async function generateSettlement(merchantId, period) {
  // 只取从未结算过的订单（settlement_id IS NULL）——同一订单绝不重复进账
  return await tx(async (c) => {
  await c.one('SELECT id FROM merchant WHERE id = ? FOR UPDATE', [merchantId])
  const orders = await c.q(`SELECT o.id, o.amount_pay - o.insurance_fee AS amount_pay, COALESCE(SUM(c.amount),0) AS promo_amt
    FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2)
    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id IS NULL GROUP BY o.id`, [merchantId])
  // 退改手续费：该商户名下已退款成功、扣了手续费、尚未计入任何结算单的退款（每笔只计一次）
  const fees = await c.q(`SELECT r.id, r.fee_amount FROM refunds r JOIN orders o ON o.id = r.order_id
    WHERE o.merchant_id = ? AND r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL FOR UPDATE`, [merchantId])
  const existing = await c.one('SELECT id FROM settlement WHERE merchant_id = ? AND period = ?', [merchantId, period])
  if (!orders.length && !fees.length) return existing ? Number(existing.id) : -1 // 没有新增：幂等返回已有单
  // 本周期已出过账、之后又有新完成的订单或手续费：出一张补充单（2026-W45-2、-3…），已出的单据不改动
  if (existing) {
    const used = new Set((await c.q('SELECT period FROM settlement WHERE merchant_id = ? AND period LIKE ?', [merchantId, period + '-%'])).map((r) => r.period))
    let n = 2
    while (used.has(`${period}-${n}`)) n++
    period = `${period}-${n}`
    if (period.length > 12) throw new BizError(1001, `结算周期 ${period} 超长：本周期补充单过多，请联系技术处理`)
  }
  let total = 0, promo = 0
  for (const o of orders) { total += Number(o.amount_pay); promo += Number(o.promo_amt) }
  // 五口径比例来自参数中心（settlement.split_*），生成时快照进 split_snapshot
  const split = await splitBp()
  const fulfill = Math.round(total * split.fulfill / 10000)
  const service = Math.round(total * split.service / 10000)
  const beanBudget = Math.round(total * split.beanbudget / 10000)
  const retained = total - fulfill - service - beanBudget - promo
  // 分成比例：商户资料单独约定优先，否则取参数中心；生成时快照进结算单，事后改参数不影响已出账单
  const shareBp = await feeShareBp(c, merchantId)
  const feeTotal = fees.reduce((a, f) => a + Number(f.fee_amount), 0)
  const feeMerchant = Math.floor(feeTotal * shareBp / 10000)
  const feePlatform = feeTotal - feeMerchant
    const sid = await c.ins(`INSERT INTO settlement (merchant_id, period, order_count, total_amount,
      amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status,
      fee_count, fee_total, fee_merchant, fee_platform, fee_share_bp, split_snapshot)
      VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`, [merchantId, period, orders.length, total, fulfill, service, promo, beanBudget, retained,
      fees.length, feeTotal, feeMerchant, feePlatform, fees.length ? shareBp : null, JSON.stringify(split)])
    if (orders.length) await c.q(`UPDATE orders SET settlement_id = ? WHERE id IN (${orders.map((o) => o.id).join(',')})`, [sid])
    if (fees.length) await c.q(`UPDATE refunds SET settlement_id = ? WHERE id IN (${fees.map((f) => f.id).join(',')}) AND settlement_id IS NULL`, [sid])
    // 共创分润（资金商/商品商）：产品 GMV 占比 × 留存毛利 × share_pct，幂等（uk_settle_co）；只有订单收入时才计
    if (orders.length && total > 0) await c.q(`INSERT IGNORE INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount)
      SELECT ?, cc.id, cc.product_id, ?, ROUND(? * pg.gmv / ?), ROUND(? * pg.gmv / ? * cc.share_pct / 10000)
      FROM co_creator cc
      JOIN (SELECT product_id, SUM(amount_pay - insurance_fee) gmv FROM orders WHERE settlement_id = ? GROUP BY product_id) pg
        ON pg.product_id = cc.product_id
      WHERE cc.status = 1 AND cc.share_pct > 0`,
      [sid, period, retained, total, retained, total, sid])
    // 生成即锚定（同事务）：五口径恒等与手续费分成的快照一旦封存，事后无法悄悄改数
    await attest('settlement', 'settle-' + sid, {
      settlementId: Number(sid), merchantId: Number(merchantId), period,
      orderCount: orders.length, totalAmount: total, amtFulfill: fulfill, amtService: service,
      amtPromoter: promo, amtBeanbudget: beanBudget, amtRetained: retained, status: 0,
      feeCount: fees.length, feeTotal, feeMerchant, feePlatform, feeShareBp: fees.length ? shareBp : null,
    }, c, 0)
    return sid
  })
}
