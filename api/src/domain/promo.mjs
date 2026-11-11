// 推广域（一级 CPS 三档）+ 结算域（五口径恒等）+ 多提供方结算行（修复4）+ 已出账/已付款调整
import crypto from 'node:crypto'
import { q, one, tx, BizError } from '../db.mjs'
import { cfg, cfgArr, cfgNum } from '../config.mjs'
import { attest } from './attest.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import { settledPartialFen } from './package.mjs'

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

/** 订单 50 后计佣（幂等）。
 *  A-15（负责人决策）：① 按首触归因——佣金归该用户第一条归因命中的推广员（界面承诺"首触唯一"）；
 *  ② 推广员本人下单不计佣；③ 基数 = 实付 − 保费，旅豆只减一次（amount_pay 已是抵扣后的实付，此前又减一次豆）。 */
export async function createCommission(orderNo) {
  const o = await one('SELECT id, user_id, product_id, promo_scene, promo_snapshot, amount_pay, insurance_fee, paid_at, rebook_of FROM orders WHERE order_no = ?', [orderNo])
  if (!o || !o.promo_scene) return false
  if (o.rebook_of) return false // A-01：免费改签单实收 ¥0（成本商户承担），不计佣
  const snapshot=o.promo_snapshot ? (typeof o.promo_snapshot==='string'?JSON.parse(o.promo_snapshot):o.promo_snapshot):null
  if(snapshot && !snapshot.eligible)return false
  const a = snapshot ? {promoter_id:snapshot.promoterId} : await one(`SELECT a.promoter_id FROM attribution_hit h JOIN attribution a ON a.scene = h.scene
    WHERE h.user_id = ? ORDER BY h.id ASC LIMIT 1`, [o.user_id]) // 首触唯一
  if (!a) return false
  if (Number(a.promoter_id) === Number(o.user_id)) return false // 自买不计佣
  const p = await one('SELECT rate_bp, status FROM promoter WHERE user_id = ? AND status = 1', [a.promoter_id])
  if (!p) return false
  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶
  const prod = await one('SELECT promo_rate_bp, profile FROM tour_product WHERE id = ?', [o.product_id])
  // 单品覆盖只在后台「逐品佣金」设置的生效期内有效（按订单支付日判断），期外回落到推广服务商档位
  const pf = prod ? ((typeof prod.profile === 'string' ? JSON.parse(prod.profile || '{}') : prod.profile) || {}) : {}
  const payDay = o.paid_at ? String(o.paid_at).slice(0, 10) : bizDay()
  const inWindow = (!pf.rate_start || payDay >= pf.rate_start) && (!pf.rate_end || payDay <= pf.rate_end)
  const rateBp = snapshot ? Number(snapshot.rateBp) : Math.min(prod && prod.promo_rate_bp != null && inWindow ? Number(prod.promo_rate_bp) : Number(p.rate_bp), 1200)
  // 保费直付保险方，不计佣；旅豆已在实付中扣除，只减一次；
  // 修复3（Codex退回#3）：再扣已结算按项退款——部分退款后完成/计佣按剩余商品实收，不读退款前实付
  const base = Number(o.amount_pay) - Number(o.insurance_fee || 0) - await settledPartialFen(o.id)
  const amount = Math.floor(base * rateBp / 10000)
  try {
    await q(`INSERT INTO commission (order_id, promoter_id, base_amount, rate_bp, amount, status, payable_at)
      VALUES (?,?,?,?,?,0, NOW() + INTERVAL ? DAY)`, [o.id, a.promoter_id, base, rateBp, amount, await cfgNum('commission.settle_delay_days')])
    await q('UPDATE promoter SET valid_gmv_90d = valid_gmv_90d + ? WHERE user_id = ?', [base, a.promoter_id])
    // 佣金计提入存证：钱的"怎么算出来的"必须留痕（费率、基数、金额、封顶后的结果）
    await attest('commission', 'comm-' + o.id, {
      orderId: Number(o.id), promoterUserId: Number(a.promoter_id),
      baseAmountFen: Number(base), rateBp: Number(rateBp), amountFen: Number(amount), status: 0,
    }, null, 1)
    return true
  } catch { return false }
}

export async function invalidateCommission(orderNo) {
  const o = await one('SELECT id FROM orders WHERE order_no = ?', [orderNo])
  if (!o) return
  const c = await one('SELECT promoter_id, amount, status FROM commission WHERE order_id = ?', [o.id])
  await q('UPDATE commission SET status = CASE WHEN status = 2 THEN 3 ELSE 4 END WHERE order_id = ?', [o.id])
  // 扣回同样留痕：已经放行的钱被反向处置，是资金审计里最需要解释的一类
  if (c) await attest('commission', 'comm-' + o.id, {
    orderId: Number(o.id), promoterUserId: Number(c.promoter_id), amountFen: Number(c.amount),
    result: Number(c.status) === 2 ? 'reversed_after_paid' : 'voided',
  }, null, Number(c.status) === 2 ? 3 : 4)
}

/** 到期放行：推广员账号被冻结（user_account.status = 0）期间佣金照常累计但不放行，解冻后下一次放行再一并转为可提现 */
export async function settleDue() {
  // 先取出待放行明细再改状态：放行是"钱变成可提现"的那一刻，必须逐笔留痕
  const due = await q(`SELECT c.order_id, c.promoter_id, c.amount FROM commission c JOIN user_account u ON u.id = c.promoter_id
    WHERE c.status = 0 AND c.payable_at <= NOW(3) AND u.status = 1`)
  const r = await q(`UPDATE commission c JOIN user_account u ON u.id = c.promoter_id
    SET c.status = 1 WHERE c.status = 0 AND c.payable_at <= NOW(3) AND u.status = 1`)
  for (const x of due) {
    await attest('commission', 'comm-' + x.order_id, {
      orderId: Number(x.order_id), promoterUserId: Number(x.promoter_id), amountFen: Number(x.amount), result: 'released',
    }, null, 2)
  }
  return r.affectedRows
}

/** 账号是否处于冻结（用户不存在也按冻结处理：资金动作宁可拦下） */
export async function isUserFrozen(userId) {
  const u = await one('SELECT status FROM user_account WHERE id = ?', [userId])
  return !u || Number(u.status) !== 1
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
// 修复4（Codex退回#4）：提供方应付从订单项复算——结算行 settlement_line 记录每单×每提供方的
// 现金/冲减/净额，跨店套餐不再整单计入主单商户；已出账/已付款后的按项退款走 settlement_adjustment，
// 未冲抵调整由补充单并入（applied_settlement_id 标记，同一笔不重复扣减）。

/** JSON 列读取双态兼容：mysql2 对 JSON 列自动解析为数组，历史行是字符串 */
const jsonArr = (v) => Array.isArray(v) ? v : (v != null ? JSON.parse(v || '[]') : [])

/** 提供方在订单上的退款冲减（净额口径）：Σ被退项在 partial_refund.item_nets 中的净额。
 *  item_nets 缺失（V81 前历史行）按项现金占比比例分摊、尾差归最后一项。 */
async function providerRefundFen(c, orderId, myItems) {
  const prs = await c.q('SELECT item_ids, item_nets, cash_fen FROM partial_refund WHERE order_id = ? AND status = 2', [orderId])
  const mine = new Map(myItems.map(it => [Number(it.id), Number(it.cash_fen)]))
  let fen = 0
  for (const pr of prs) {
    const ids = jsonArr(pr.item_ids).map(Number)
    const nets = pr.item_nets != null ? jsonArr(pr.item_nets) : null
    if (nets) {
      ids.forEach((iid, i) => { if (mine.has(iid)) fen += Math.max(0, Number(nets[i]) || 0) })
    } else {
      // 历史行兜底：整单净退款按被退项现金占比分摊，尾差归最后一个本店项
      const refundNet = Math.max(0, Number(pr.cash_fen) || 0)
      const hit = ids.filter(iid => mine.has(iid))
      if (hit.length) {
        const gross = hit.reduce((a, iid) => a + mine.get(iid), 0)
        let left = refundNet
        hit.forEach((iid, idx) => {
          if (idx === hit.length - 1) fen += Math.max(0, left)
          else { const share = gross > 0 ? Math.floor(refundNet * mine.get(iid) / gross) : 0; left -= share; fen += share }
        })
      }
    }
  }
  return fen
}

/** 提供方净额复算（修复4）：有订单项=该店项现金合计−该店冲减；无订单项=订单商品现金−全部冲减（与 V9 口径一致） */
async function providerNet(c, orderId, myItems, amountPayFen, insuranceFen) {
  if (myItems.length) {
    const cash = myItems.reduce((a, it) => a + Number(it.cash_fen), 0)
    const refund = await providerRefundFen(c, orderId, myItems)
    return { cash, refund, net: Math.max(0, cash - refund) }
  }
  const cash = Math.max(0, Number(amountPayFen) - Number(insuranceFen || 0))
  const refund = await providerRefundFen(c, orderId, [])
  return { cash, refund, net: Math.max(0, cash - refund) }
}

export async function generateSettlement(merchantId, period) {
  // 只取从未结算过的订单（settlement_id IS NULL）与他店主单中归属本店、未落结算行的订单项
  // ——同一订单项绝不重复进账（orders.settlement_id / order_item.settle_line_id 双闸）。
  // A-01：免费改签单（rebook_of 非空）实收 ¥0、改签成本由商户承担，不进结算金额与共创分润基数
  return await tx(async (c) => {
  await c.one('SELECT id FROM merchant WHERE id = ? FOR UPDATE', [merchantId])
  const ownOrders = await c.q(`SELECT o.id, o.order_no, o.amount_pay, o.insurance_fee, o.cost_total_fen, COALESCE(SUM(c.amount),0) AS promo_amt
    FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2)
    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id IS NULL AND o.rebook_of IS NULL GROUP BY o.id`, [merchantId])
  const crossOrders = await c.q(`SELECT DISTINCT o.id, o.order_no, o.amount_pay, o.insurance_fee, o.cost_total_fen
    FROM order_item oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.merchant_id = ? AND oi.merchant_id <> o.merchant_id AND o.status = 50 AND o.rebook_of IS NULL AND oi.settle_line_id IS NULL`, [merchantId])
  // 退改手续费：该商户名下已退款成功、扣了手续费、尚未计入任何结算单的退款（每笔只计一次）
  const fees = await c.q(`SELECT r.id, r.fee_amount FROM refunds r JOIN orders o ON o.id = r.order_id
    WHERE o.merchant_id = ? AND r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL FOR UPDATE`, [merchantId])
  // 未冲抵调整（修复4）：已出账/已付款后的按项退款，由补充单并入
  const pendingAdj = await c.q(`SELECT id, amount_fen FROM settlement_adjustment
    WHERE merchant_id = ? AND type = 1 AND amount_fen IS NOT NULL AND applied_settlement_id IS NULL FOR UPDATE`, [merchantId])
  const existing = await c.one('SELECT id FROM settlement WHERE merchant_id = ? AND period = ?', [merchantId, period])
  if (!ownOrders.length && !crossOrders.length && !fees.length && !pendingAdj.length) return existing ? Number(existing.id) : -1 // 没有新增：幂等返回已有单
  // 本周期已出过账、之后又有新完成的订单/手续费/调整：出一张补充单（2026-W45-2、-3…），已出的单据不改动
  if (existing) {
    const used = new Set((await c.q('SELECT period FROM settlement WHERE merchant_id = ? AND period LIKE ?', [merchantId, period + '-%'])).map((r) => r.period))
    let n = 2
    while (used.has(`${period}-${n}`)) n++
    period = `${period}-${n}`
    if (period.length > 12) throw new BizError(1001, `结算周期 ${period} 超长：本周期补充单过多，请联系技术处理`)
  }
  // 逐单生成结算行草稿（订单项加锁防并发分账）
  const lines = [] // {order, myItems, cash, refund, net, cross, costFen}
  for (const o of ownOrders) {
    const items = await c.q('SELECT id, merchant_id, cash_fen, cost_fen FROM order_item WHERE order_id = ? FOR UPDATE', [o.id])
    const my = items.filter(it => Number(it.merchant_id) === Number(merchantId))
    const net = await providerNet(c, o.id, my, o.amount_pay, o.insurance_fee)
    lines.push({ o, my, ...net, cross: 0, costFen: my.length ? my.reduce((a, it) => a + (it.cost_fen != null ? Number(it.cost_fen) : 0), 0) : (o.cost_total_fen != null ? Number(o.cost_total_fen) : 0) })
  }
  for (const o of crossOrders) {
    const my = await c.q('SELECT id, merchant_id, cash_fen, cost_fen FROM order_item WHERE order_id = ? AND merchant_id = ? FOR UPDATE', [o.id, merchantId])
    const net = await providerNet(c, o.id, my, o.amount_pay, o.insurance_fee)
    lines.push({ o, my, ...net, cross: 1, costFen: my.reduce((a, it) => a + (it.cost_fen != null ? Number(it.cost_fen) : 0), 0) })
  }
  let total = 0, promo = 0, costTotal = 0, partialDeduct = 0
  for (const ln of lines) { total += ln.net; costTotal += ln.costFen; partialDeduct += ln.refund; if (!ln.cross) promo += Number(ln.o.promo_amt) }
  // 未冲抵调整并入（amount_fen 为负=应付减少）
  const adjTotal = pendingAdj.reduce((a, x) => a + Number(x.amount_fen), 0)
  total += adjTotal
  // 净额+调整相抵为负：本轮跳过（结算行/调整保持未冲抵状态，下轮再算），绝不把结算单出成负数。
  // total=0 仍出账：保留"只有手续费也能出账"既有行为（手续费不计入 total，走 fee 列与商户分成）。
  if (total < 0) return existing ? Number(existing.id) : -1
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
  const orderCount = lines.length
    const sid = await c.ins(`INSERT INTO settlement (merchant_id, period, order_count, total_amount,
      amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status,
      fee_count, fee_total, fee_merchant, fee_platform, fee_share_bp, split_snapshot, cost_total, partial_deduct)
      VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`, [merchantId, period, orderCount, total, fulfill, service, promo, beanBudget, retained,
      fees.length, feeTotal, feeMerchant, feePlatform, fees.length ? shareBp : null, JSON.stringify(split), costTotal, partialDeduct])
  // 结算行落库 + 订单项防重复分账标记（同事务，uk 双保险）
  for (const ln of lines) {
    const lineId = await c.ins(`INSERT INTO settlement_line (settlement_id, order_id, merchant_id, cross_store, cash_fen, refund_fen, net_fen, rule_version)
      VALUES (?,?,?,?,?,?,?,2)`, [sid, ln.o.id, merchantId, ln.cross, ln.cash, ln.refund, ln.net])
    if (ln.my.length) await c.q(`UPDATE order_item SET settle_line_id = ? WHERE id IN (${ln.my.map(it => Number(it.id)).join(',')}) AND settle_line_id IS NULL`, [lineId])
  }
  // 修复4：本轮并入的调整标记冲抵去向（对账可溯）
  if (pendingAdj.length) await c.q(`UPDATE settlement_adjustment SET applied_settlement_id = ? WHERE id IN (${pendingAdj.map(x => Number(x.id)).join(',')})`, [sid])
  // B04：确认成本回填（订单进入结算=确认时点；未维护成本保持 NULL 不强填）
  const ownIds = ownOrders.map((o) => Number(o.id))
  if (ownIds.length) await c.q(`UPDATE orders SET cost_confirmed_fen = cost_total_fen WHERE id IN (${ownIds.join(',')}) AND cost_confirmed_fen IS NULL`)
    if (ownIds.length) await c.q(`UPDATE orders SET settlement_id = ? WHERE id IN (${ownIds.join(',')})`, [sid])
    if (fees.length) await c.q(`UPDATE refunds SET settlement_id = ? WHERE id IN (${fees.map((f) => f.id).join(',')}) AND settlement_id IS NULL`, [sid])
    // 共创分润（资金商/商品商）：产品净额占比 × 留存毛利 × share_pct，幂等（uk_settle_co）；只有订单收入时才计。
    // 修复4：基数改从结算行取（provider net，净额口径，跨店/部分退款不重复计）——
    // 主单商户结算按本单行内订单复算；纯跨店提供方结算挂主单结算口径（单列边界，不重复计提）。
    if (ownIds.length && total > 0) await c.q(`INSERT IGNORE INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount,share_bp,rule_snapshot)
      SELECT ?, cc.id, cc.product_id, ?, ROUND(? * pg.gmv / ?), ROUND(? * pg.gmv / ? * cc.share_pct / 10000),cc.share_pct,
        JSON_OBJECT('version',2,'basis','retained_product_provider_net_share','shareBp',cc.share_pct,'contractNo',JSON_UNQUOTE(JSON_EXTRACT(cc.profile,'$.contract_no')))
      FROM co_creator cc
      JOIN (SELECT o.product_id, SUM(sl.net_fen) gmv FROM settlement_line sl JOIN orders o ON o.id = sl.order_id WHERE sl.settlement_id = ? GROUP BY o.product_id) pg
        ON pg.product_id = cc.product_id
      WHERE cc.status = 1 AND cc.share_pct > 0`,
      [sid, period, retained, total, retained, total, sid])
    // 共创分润逐笔留痕：资金商/商品商拿到的每一笔，基数与占比都要能复算
    for (const cp of await c.q('SELECT co_creator_id, product_id, base_amount, amount FROM co_profit WHERE settlement_id = ?', [sid])) {
      await attest('co_profit', `cprofit-${sid}-${cp.co_creator_id}`, {
        settlementId: Number(sid), coCreatorId: Number(cp.co_creator_id), productId: Number(cp.product_id),
        baseAmountFen: Number(cp.base_amount), amountFen: Number(cp.amount), period,
      }, c)
    }
    // 生成即锚定（同事务）：五口径恒等与手续费分成的快照一旦封存，事后无法悄悄改数
    await attest('settlement', 'settle-' + sid, {
      settlementId: Number(sid), merchantId: Number(merchantId), period,
      orderCount, totalAmount: total, amtFulfill: fulfill, amtService: service,
      amtPromoter: promo, amtBeanbudget: beanBudget, amtRetained: retained, status: 0,
      feeCount: fees.length, feeTotal, feeMerchant, feePlatform, feeShareBp: fees.length ? shareBp : null,
      pendingAdjustFen: -adjTotal, providerLines: lines.length,
    }, c, 0)
    return sid
  })
}

/** 修复4：按项退款成功后，被退项已进结算（order_item.settle_line_id 非空）→ 按提供方登记结算调整。
 *  商户应付变动 = −Σ(该店被退项净额) × 该结算单 split_snapshot 履约占比；已出账单快照不改写。
 *  未冲抵调整由 generateSettlement 下一张补充单并入（applied_settlement_id），同一笔不重复扣减。
 *  幂等：uk_refund_merchant（refund_no, merchant_id）+ INSERT IGNORE。失败不阻塞退款（调用方 catch 记日志）。 */
export async function recordRefundAdjustment(orderId, refundNo, operator = 'system') {
  const pr = await one('SELECT item_ids, item_nets FROM partial_refund WHERE order_id = ? AND refund_no = ? AND status = 2', [orderId, refundNo])
  if (!pr) return []
  const ids = jsonArr(pr.item_ids).map(Number)
  const nets = pr.item_nets != null ? jsonArr(pr.item_nets) : []
  const items = await q(`SELECT id, merchant_id, settle_line_id FROM order_item WHERE id IN (${ids.map(Number).join(',') || '0'})`, [])
  const lineIds = [...new Set(items.filter(it => it.settle_line_id != null).map(it => Number(it.settle_line_id)))]
  if (!lineIds.length) return []
  const lines = await q(`SELECT sl.id, sl.settlement_id, sl.order_id, sl.merchant_id, s.split_snapshot
    FROM settlement_line sl JOIN settlement s ON s.id = sl.settlement_id WHERE sl.id IN (${lineIds.join(',')})`, [])
  const out = []
  for (const ln of lines) {
    const myNet = items.reduce((a, it, i) => {
      if (Number(it.settle_line_id) !== Number(ln.id)) return a
      const idx = ids.indexOf(Number(it.id))
      return a + Math.max(0, Number(nets[idx]) || 0)
    }, 0)
    if (!(myNet > 0)) continue
    const snap = (typeof ln.split_snapshot === 'string' ? JSON.parse(ln.split_snapshot || '{}') : ln.split_snapshot) || {}
    const fulfillBp = Number(snap.fulfill != null ? snap.fulfill : (await splitBp()).fulfill)
    const amountFen = -Math.round(myNet * fulfillBp / 10000)
    if (amountFen === 0) continue
    await q(`INSERT IGNORE INTO settlement_adjustment (settlement_id, order_id, merchant_id, type, amount_fen, refund_no, reason, operator)
      VALUES (?,?,?,?,?,?,?,?)`,
      [Number(ln.settlement_id), Number(ln.order_id), Number(ln.merchant_id), 1, amountFen, refundNo,
       '按项退款冲减·' + refundNo + '（按结算单快照履约占比复算）', operator])
    out.push({ merchantId: Number(ln.merchant_id), settlementId: Number(ln.settlement_id), amountFen })
  }
  return out
}

/** 修复4：已出账/已付款结算单的确认成本更正（finance 专用）。
 *  只影响利润复算口径（type=2 调整，不改商户应付五口径）；orders.cost_confirmed_fen 同步更正并留审计。 */
export async function adjustConfirmedCost({ orderNo, costConfirmedFen, reason, operator }) {
  const o = await one('SELECT id, order_no, cost_confirmed_fen, settlement_id FROM orders WHERE order_no = ?', [orderNo])
  if (!o) throw new BizError(2003, '订单不存在')
  if (o.cost_confirmed_fen == null) throw new BizError(1001, '该订单确认成本未回填（尚未进入结算），请走供给台账/成本维护入口')
  const next = Math.round(Number(costConfirmedFen))
  if (!Number.isInteger(next) || next < 0) throw new BizError(1001, '确认成本必须为非负整数分')
  const delta = next - Number(o.cost_confirmed_fen)
  if (delta === 0) return { changed: false }
  return await tx(async (c) => {
    await c.q('UPDATE orders SET cost_confirmed_fen = ? WHERE id = ?', [next, o.id])
    await c.q(`INSERT INTO settlement_adjustment (settlement_id, order_id, merchant_id, type, amount_fen, cost_fen, reason, operator)
      VALUES (?,?,?,?,NULL,?,?,?)`,
      [o.settlement_id, o.id, null, 2, delta, '确认成本更正·' + reason, operator])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)',
      [o.id, 0, 0, 'admin:' + operator, JSON.stringify({ ev: 'COST_ADJUST', from: Number(o.cost_confirmed_fen), to: next, reason })])
    return { changed: true, from: Number(o.cost_confirmed_fen), to: next, delta }
  })
}
