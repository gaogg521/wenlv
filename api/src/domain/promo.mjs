// 推广域（一级 CPS 三档）+ 结算域（五口径恒等）
import crypto from 'node:crypto'
import { q, one, tx, BizError } from '../db.mjs'
import { cfgArr, cfgNum } from '../config.mjs'
import { attest } from './attest.mjs'

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
  const o = await one('SELECT id, product_id, promo_scene, amount_pay, bean_deducted, insurance_fee FROM orders WHERE order_no = ?', [orderNo])
  if (!o || !o.promo_scene) return false
  const a = await one('SELECT promoter_id FROM attribution WHERE scene = ?', [o.promo_scene])
  if (!a) return false
  const p = await one('SELECT rate_bp, status FROM promoter WHERE user_id = ? AND status = 1', [a.promoter_id])
  if (!p) return false
  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶
  const prod = await one('SELECT promo_rate_bp FROM tour_product WHERE id = ?', [o.product_id])
  const rateBp = Math.min(prod && prod.promo_rate_bp != null ? Number(prod.promo_rate_bp) : Number(p.rate_bp), 1200)
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

// ===== 结算（五口径：履约58% / 服务12% / 权益5% / 推广=实际佣金 / 留存=差额兜底）=====
export async function generateSettlement(merchantId, period) {
  // 只取从未结算过的订单（settlement_id IS NULL）——同一订单绝不重复进账
  return await tx(async (c) => {
  await c.one('SELECT id FROM merchant WHERE id = ? FOR UPDATE', [merchantId])
  const existing = await c.one('SELECT id FROM settlement WHERE merchant_id = ? AND period = ?', [merchantId, period])
  if (existing) return Number(existing.id)
  const orders = await c.q(`SELECT o.id, o.amount_pay - o.insurance_fee AS amount_pay, COALESCE(SUM(c.amount),0) AS promo_amt
    FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2)
    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id IS NULL GROUP BY o.id`, [merchantId])
  if (!orders.length) return -1
  let total = 0, promo = 0
  for (const o of orders) { total += Number(o.amount_pay); promo += Number(o.promo_amt) }
  const fulfill = Math.round(total * 0.58)
  const service = Math.round(total * 0.12)
  const beanBudget = Math.round(total * 0.05)
  const retained = total - fulfill - service - beanBudget - promo
    const sid = await c.ins(`INSERT INTO settlement (merchant_id, period, order_count, total_amount,
      amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status)
      VALUES (?,?,?,?,?,?,?,?,?,0)`, [merchantId, period, orders.length, total, fulfill, service, promo, beanBudget, retained])
    await c.q(`UPDATE orders SET settlement_id = ? WHERE id IN (${orders.map((o) => o.id).join(',')})`, [sid])
    // 共创分润（资金商/商品商）：产品 GMV 占比 × 留存毛利 × share_pct，幂等（uk_settle_co）
    await c.q(`INSERT IGNORE INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount)
      SELECT ?, cc.id, cc.product_id, ?, ROUND(? * pg.gmv / ?), ROUND(? * pg.gmv / ? * cc.share_pct / 10000)
      FROM co_creator cc
      JOIN (SELECT product_id, SUM(amount_pay - insurance_fee) gmv FROM orders WHERE settlement_id = ? GROUP BY product_id) pg
        ON pg.product_id = cc.product_id
      WHERE cc.status = 1 AND cc.share_pct > 0`,
      [sid, period, retained, total, retained, total, sid])
    // 生成即锚定（同事务）：五口径恒等的快照一旦入链，事后无法悄悄改数
    await attest('settlement', 'settle-' + sid, {
      settlementId: Number(sid), merchantId: Number(merchantId), period,
      orderCount: orders.length, totalAmount: total, amtFulfill: fulfill, amtService: service,
      amtPromoter: promo, amtBeanbudget: beanBudget, amtRetained: retained, status: 0,
    }, c, 0)
    return sid
  })
}
