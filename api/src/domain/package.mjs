// 套餐域（B02/B03/B04/B17）：项模板校验、下单快照与三路分摊、逐项履约（按人凭证/服务项）、部分退款。
// B04 资金契约 v1 见 V77 迁移头注：唯一主单、三路同口径占比分摊（尾差归最后正额项）、成本不占比、
// 部分退款只退未核销项现金分摊−政策手续费、旅豆/券仅全退冲回、部分完成不提前发奖励。
import { q, one, tx, BizError } from '../db.mjs'
import { id, json } from './sales.mjs'
import { cfg } from '../config.mjs'
import * as policy from './refund-policy.mjs'
import { bookingNow } from './booking-window.mjs'

const KIND_CN = { 1: '按人凭证', 2: '服务项' }
export const kindCn = k => KIND_CN[k] || k

export function templateInput(b) {
  const name = String(b.name || '').trim()
  if (!name || name.length > 80) throw new BizError(1001, '套餐项名称无效')
  const kind = Number(b.kind)
  if (![1, 2].includes(kind)) throw new BizError(1001, '套餐项类型无效（1按人凭证 2服务项）')
  const merchantId = id(b.merchantId)
  const unitPrice = Number(b.unitPriceFen)
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 10000000000) throw new BizError(1001, '项单价应为非负整数分')
  const qtyPerUnit = Number(b.qtyPerUnit)
  if (!Number.isSafeInteger(qtyPerUnit) || qtyPerUnit < 1 || qtyPerUnit > 99) throw new BizError(1001, '每份数量应为1–99')
  const supplyItemId = b.supplyItemId != null && b.supplyItemId !== '' ? id(b.supplyItemId) : null
  const benefitDesc = String(b.benefitDesc || '').trim()
  if (benefitDesc.length > 500) throw new BizError(1001, '权益说明过长（≤500字）')
  const benefitRules = String(b.benefitRules || '').trim()
  if (benefitRules.length > 300) throw new BizError(1001, '使用规则过长（≤300字）')
  return { name, kind, merchant_id: merchantId, supply_item_id: supplyItemId, unit_price_fen: unitPrice, qty_per_unit: qtyPerUnit, benefit_desc: benefitDesc || null, benefit_rules: benefitRules || null }
}

export async function templatesFor(productId, c = { q }) {
  return c.q('SELECT * FROM package_item WHERE product_id = ? AND status = 1 ORDER BY sort, id', [productId])
}

/** 三路分摊：shares[i] = floor(total × w[i] / Σw)，尾差归最后一个正权重项；Σ shares = total 恒等 */
export function distributeFen(totalFen, weightFens) {
  const w = weightFens.map(Number)
  const sum = w.reduce((a, b) => a + b, 0)
  if (sum <= 0) return w.map(() => 0)
  let acc = 0
  const shares = w.map(x => Math.floor(totalFen * x / sum))
  acc = shares.reduce((a, b) => a + b, 0)
  const lastPos = (() => { for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i; return -1 })()
  if (lastPos >= 0) shares[lastPos] += totalFen - acc
  return shares
}

/** 下单事务内：建订单项快照 + 三路分摊 + 项成本。goodsFen=订单商品额 G；freedomFen=券面额；beanFen=旅豆抵扣分。 */
export async function buildOrderItemsInTx(c, { orderNo, productId, qty, goodsFen, freedomFen, beanFen }) {
  const tpls = await templatesFor(productId, c)
  if (!tpls.length) return []
  const orderId = Number((await c.one('SELECT id FROM orders WHERE order_no = ?', [orderNo])).id)
  const templateSum = tpls.reduce((a, t) => a + Number(t.unit_price_fen) * Number(t.qty_per_unit), 0)
  const scale = goodsFen / (templateSum * qty) // 早鸟/折扣作用于整体后按比例缩到项（保持 Σ=goodsFen）
  const rows = tpls.map(t => {
    const itemQty = Number(t.qty_per_unit) * qty
    const rawGoods = Math.round(Number(t.unit_price_fen) * itemQty * scale)
    return { t, itemQty, goods: rawGoods }
  })
  // 修正舍入：把 goods 之和精确对齐到 goodsFen（尾差归最后一个正额项）
  const diff = goodsFen - rows.reduce((a, r) => a + r.goods, 0)
  const lastPos = (() => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].goods > 0) return i; return -1 })()
  if (lastPos >= 0) rows[lastPos].goods += diff
  const cashShares = distributeFen(goodsFen - freedomFen - beanFen, rows.map(r => r.goods))
  const subsidyShares = distributeFen(freedomFen, rows.map(r => r.goods))
  const beanShares = distributeFen(beanFen, rows.map(r => r.goods))
  const items = []
  for (let i = 0; i < rows.length; i++) {
    const { t, itemQty, goods } = rows[i]
    let costFen = null
    if (t.supply_item_id) {
      const si = await c.one('SELECT unit_cost_fen, version FROM supply_item WHERE id = ?', [t.supply_item_id])
      if (si) costFen = Number(si.unit_cost_fen) * Number(t.qty_per_unit) * qty
    }
    const passTotal = Number(t.kind) === 1 ? Number(t.pass_qty || t.qty_per_unit) * qty : 0
    const itemId = await c.ins(`INSERT INTO order_item(order_id, template_id, product_id, merchant_id, name, kind, unit_price_fen, qty, goods_fen,
      cash_fen, subsidy_fen, bean_fen, cost_fen, supply_item_id, supply_version, status, pass_total, benefit_desc, benefit_rules)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      [orderId, t.id, productId, t.merchant_id, t.name, t.kind, t.unit_price_fen, itemQty, goods,
       cashShares[i], subsidyShares[i], beanShares[i], costFen, t.supply_item_id, costFen != null ? 1 : null, passTotal, t.benefit_desc, t.benefit_rules])
    items.push({ id: Number(itemId), name: t.name, kind: Number(t.kind), merchantId: Number(t.merchant_id), qty: itemQty, goodsFen: goods, cashFen: cashShares[i], subsidyFen: subsidyShares[i], beanFen: beanShares[i], costFen, passTotal })
  }
  return items
}

/** 服务项履约（B03）：幂等键防重放；跨店隔离校验项归属店；完成后项状态置1 */
export async function redeemServiceItem({ itemId, merchantId, staffId, idemKey, note }) {
  if (!/^[\w-]{6,64}$/.test(String(idemKey || ''))) throw new BizError(1001, '幂等键无效（6–64位字母数字-）')
  return tx(async c => {
    const it = await c.one('SELECT * FROM order_item WHERE id = ? FOR UPDATE', [id(itemId)])
    if (!it) throw new BizError(2003, '订单项不存在')
    if (Number(it.kind) !== 2) throw new BizError(1001, '仅服务项可走履约核销')
    if (Number(it.merchant_id) !== Number(merchantId)) throw new BizError(1003, '非本店订单项')
    if (Number(it.status) === 1) {
      const done = await c.one('SELECT id FROM order_item_redeem WHERE item_id = ? ORDER BY id LIMIT 1', [it.id])
      return { redeemed: true, repeated: true, redeemId: done ? Number(done.id) : null }
    }
    if (Number(it.status) !== 0) throw new BizError(2002, '订单项当前不可履约（已退或赠送态异常）')
    const o = await c.one('SELECT status FROM orders WHERE id = ?', [it.order_id])
    if (!o || !['20', '30'].includes(String(Number(o.status)))) throw new BizError(2002, '订单当前不可履约')
    const dup = await c.one('SELECT id FROM order_item_redeem WHERE item_id = ? AND idem_key = ?', [it.id, idemKey])
    if (dup) return { redeemed: true, repeated: true, redeemId: Number(dup.id) }
    const rid = await c.ins('INSERT INTO order_item_redeem(item_id, idem_key, operator, note) VALUES(?,?,?,?)',
      [it.id, idemKey, 'merchant:' + merchantId + ':' + staffId, note ? String(note).slice(0, 200) : null])
    await c.q('UPDATE order_item SET status = 1, service_done = 1 WHERE id = ?', [it.id])
    // B03：全部项完成且凭证全部核销 → 推进订单核销完成（与扫码路径同一状态机守卫）
    const pend = await c.one('SELECT COUNT(*) n FROM order_item WHERE order_id = ? AND status = 0', [it.order_id])
    const remainPass = await c.one('SELECT COUNT(*) n FROM travel_pass WHERE order_id = ? AND status = 1', [it.order_id])
    if (Number(pend.n) === 0 && Number(remainPass.n) === 0) {
      const oNo = await c.one('SELECT order_no FROM orders WHERE id = ?', [it.order_id])
      await (await import('./order.mjs')).fire(oNo.order_no, 'VERIFY_ALL', 'merchant:' + merchantId, async () => '套餐全部项履约完成')
    }
    return { redeemed: true, repeated: false, redeemId: Number(rid) }
  })
}

/** 商户端待履约清单：本店未完成项（含按人凭证余量），跨店隔离只看本店 */
export async function pendingItemsForStore(merchantId, pg = {}) {
  const limit = Math.min(Math.max(Number(pg.pageSize) || 20, 1), 100)
  const offset = (Math.max(Number(pg.page) || 1, 1) - 1) * limit
  const rows = await q(`SELECT oi.id, oi.name, oi.kind, oi.qty, oi.pass_total, oi.pass_done, oi.status, oi.service_done, oi.benefit_desc, oi.benefit_rules,
      o.order_no, o.contact_name, o.status order_status, s.depart_date, p.title product_title
    FROM order_item oi JOIN orders o ON o.id = oi.order_id JOIN tour_product p ON p.id = o.product_id
    LEFT JOIN tour_session s ON s.id = o.session_id
    WHERE oi.merchant_id = ? AND oi.status = 0 AND o.status IN (20, 30)
    ORDER BY s.depart_date, oi.id LIMIT ? OFFSET ?`, [merchantId, limit, offset])
  const total = Number((await one('SELECT COUNT(*) n FROM order_item oi JOIN orders o ON o.id = oi.order_id WHERE oi.merchant_id = ? AND oi.status = 0 AND o.status IN (20, 30)', [merchantId])).n)
  return { rows, total }
}

/** 订单项可退金额（现金分摊），供部分退款试算 */
export async function refundableItems(orderId) {
  const items = await q('SELECT id, name, kind, qty, cash_fen, status, pass_total, pass_done FROM order_item WHERE order_id = ? ORDER BY id', [orderId])
  return items.map(i => ({ ...i, refundable: Number(i.status) === 0 && Number(i.pass_done) === 0 && Number(i.cash_fen) > 0 }))
}

/**
 * B04 部分退款：仅未核销项；实退 = Σ现金分摊 − 政策手续费；旅豆/券不冲回（全退才走既有冲回）。
 * 退款写入 refunds（复用现有展示/聚合）+ partial_refund（项级明细）；MOCK 通道即时置已退款。
 */
export async function partialRefund({ orderNo, itemIds, reason, operator = 'user', applyPolicy = false }) {
  if (!Array.isArray(itemIds) || !itemIds.length) throw new BizError(1001, '请选择要退的订单项')
  const o = await one('SELECT * FROM orders WHERE order_no = ?', [orderNo])
  if (!o) throw new BizError(2003, '订单不存在')
  if (!['20', '30'].includes(String(Number(o.status)))) throw new BizError(2002, '仅已支付/已确认订单可按项部分退款')
  const policyCfg = await cfg('order.refund_policy')
  return tx(async c => {
    const locked = await c.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [o.id])
    if (!['20', '30'].includes(String(Number(locked.status)))) throw new BizError(2002, '订单状态已变化，请刷新重试')
    const dup = await c.one('SELECT refund_no FROM refunds WHERE order_id = ? AND status IN (0, 2) AND refund_no LIKE ? LIMIT 1', [locked.id, 'PR%'])
    if (dup) throw new BizError(2002, '已有部分退款在处理中（' + dup.refund_no + '），请勿重复提交')
    const items = await c.q(`SELECT * FROM order_item WHERE order_id = ? AND id IN (?) FOR UPDATE`, [locked.id, itemIds.map(Number)])
    if (items.length !== new Set(itemIds.map(Number)).size) throw new BizError(1001, '所选订单项不存在或不属于本单')
    let cashFen = 0
    for (const it of items) {
      if (Number(it.status) !== 0) throw new BizError(1001, '仅待履约项可退：' + it.name)
      if (Number(it.pass_done) > 0) throw new BizError(1001, '项已开始核销，不可退：' + it.name)
      if (Number(it.cash_fen) <= 0) throw new BizError(1001, '该项无现金分摊可退：' + it.name)
      cashFen += Number(it.cash_fen)
    }
    let feeFen = 0, feeRate = null
    if (applyPolicy) {
      const s = await c.one('SELECT depart_date FROM tour_session WHERE id = ?', [locked.session_id])
      const quote = policy.quote({ policy: policyCfg, amountPayFen: cashFen, departDate: s ? s.depart_date : null })
      policy.assertAllowed(quote)
      feeFen = quote.feeFen; feeRate = quote.rate
    }
    const payFen = cashFen - feeFen
    if (payFen <= 0) throw new BizError(1001, '手续费后无可退金额')
    const refundNo = 'PR' + Date.now()
    await c.q(`INSERT INTO refunds (order_id, refund_no, amount, fee_amount, fee_rate, reason, status, operator, close_reason)
      VALUES (?,?,?,?,?,?,?,?,?)`, [locked.id, refundNo, payFen, feeFen, feeRate, '部分退款·' + reason, 0, operator, null])
    await c.q(`INSERT INTO partial_refund (order_id, refund_no, item_ids, cash_fen, fee_fen, fee_rate, reason, operator, status)
      VALUES (?,?,?,?,?,?,?,?,0)`,
      [locked.id, refundNo, JSON.stringify(itemIds.map(Number)), payFen, feeFen, feeRate, reason, operator])
    await c.q('UPDATE order_item SET status = 2 WHERE id IN (?) AND status = 0', [itemIds.map(Number)])
    // 被退项的按人凭证同步冲正（未核销前提已校验）；核销记录保留审计
    await c.q('UPDATE travel_pass SET status = 4 WHERE order_item_id IN (?) AND status = 1', [itemIds.map(Number)])
    return { refundNo, cashFen: payFen, feeFen, feeRate }
  }).then(async r => {
    // 事务外走微信退款（MOCK 直接成功），成功后回写状态；失败留 0 由人工处理（与全退一致）
    const wxpay = await import('./wxpay.mjs')
    const wxr = r.cashFen > 0 && wxpay.isLive()
      ? await wxpay.refund({ orderNo, refundNo: r.refundNo, amountFen: r.cashFen, totalFen: Number(o.amount_pay), reason: '部分退款' }).catch(e => ({ status: 'ERROR', message: e.message }))
      : { status: 'SUCCESS' }
    if (wxr.status === 'SUCCESS') {
      await q('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [r.refundNo])
      await q('UPDATE partial_refund SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [r.refundNo])
    }
    return { ...r, refunded: wxr.status === 'SUCCESS', wxRefund: wxr.status }
  })
}

/** 已结算部分退款合计（订单级资金对账与全退金额扣减用） */
export async function settledPartialFen(orderId, c = { q }) {
  const r = await c.one("SELECT COALESCE(SUM(cash_fen),0) s FROM partial_refund WHERE order_id = ? AND status = 2", [orderId])
  return Number(r.s)
}
