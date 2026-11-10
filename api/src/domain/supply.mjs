// 供给项与经营口径域（B01/B12）：成本台账校验、产品成本构成、订单成本快照、毛利/毛利率/经营收益计算。
// 口径铁律：
//   1) 商品经营毛利 = 同口径商品净销售额 − 对应直接成本；毛利率 = 毛利 ÷ 商品净销售额 × 100%
//   2) 商品净销售额用实际成交/退款冲减口径；保费与代收款不算销售收入、不进成本基数
//   3) 成本缺失＝"未维护/不可计算"，绝不默认 0；净销售额为 0 时毛利率显示 "—"（返回 null）
//   4) 汇总毛利率 = Σ毛利 ÷ Σ同口径净销售额，不平均各单毛利率
//   5) 预计/实际分栏基于订单快照复算；确认成本随 B04 启用（未接入前一律"未确认"）
//   6) "已知费用后收益"只减已接入的已知直接费用（当前：推广佣金），不冒充公司最终净利润
import { q, one, BizError } from '../db.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const UNIT_CN = { per_person: '每人', per_order: '每单', room_night: '房晚' }
export const unitCn = u => UNIT_CN[u] || u
const KIND_CN = { 1: '采购', 2: '履约', 3: '赠送' }
export const kindCn = k => KIND_CN[k] || k

const fenOf = (v, label) => {
  const n = Number(v)
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000000000) throw new BizError(1001, label + '应为非负整数分')
  return n
}

/** 后台供给项录入校验；返回列值对象（不含 id/version） */
export function itemInput(b) {
  const name = String(b.name || '').trim()
  if (!name || name.length > 80) throw new BizError(1001, '供给项名称无效')
  const kind = Number(b.kind)
  if (![1, 2, 3].includes(kind)) throw new BizError(1001, '供给项类型无效')
  const unit = String(b.unit || 'per_person')
  if (!UNIT_CN[unit]) throw new BizError(1001, '计价单位无效（per_person/per_order/room_night）')
  const unitCost = fenOf(b.unitCostFen, '成本单价')
  const note = String(b.note || '').trim()
  if (unitCost === 0 && note.length < 4) throw new BizError(1001, '真实零成本必须填写明确依据（4字以上）')
  if (note.length > 300) throw new BizError(1001, '成本依据过长（≤300字）')
  const refRetail = b.refRetailFen == null || b.refRetailFen === '' ? null : fenOf(b.refRetailFen, '参考零售价')
  const from = b.validFrom ? String(b.validFrom).slice(0, 10) : null
  const to = b.validTo ? String(b.validTo).slice(0, 10) : null
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new BizError(1001, '生效日期无效')
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BizError(1001, '失效日期无效')
  if (from && to && to < from) throw new BizError(1001, '生效期止不能早于起')
  const providerType = b.providerType ? String(b.providerType) : null
  if (providerType && !['scenic', 'supplier', 'merchant', 'platform'].includes(providerType)) throw new BizError(1001, '提供方类型无效')
  let providerId = null
  if (b.providerId != null && b.providerId !== '') {
    providerId = Number(b.providerId)
    if (!Number.isSafeInteger(providerId) || providerId < 1) throw new BizError(1001, '提供方ID无效')
  }
  const agreement = String(b.agreement || '').trim()
  if (agreement.length > 120) throw new BizError(1001, '协议版本过长（≤120字）')
  return { name, kind, unit, unit_cost_fen: unitCost, ref_retail_fen: refRetail, provider_type: providerType, provider_id: providerId, valid_from: from, valid_to: to, agreement, note }
}

/** 产品在时点的成本构成（无任何生效供给项 → null=未维护，不可计算） */
export async function productCostBreakdown(productId, at = bizDay(), c = { q }) {
  const rows = await c.q(`SELECT ps.qty AS map_qty, si.id, si.name, si.kind, si.unit, si.unit_cost_fen, si.version, si.agreement
    FROM product_supply ps JOIN supply_item si ON si.id = ps.item_id
    WHERE ps.product_id = ? AND si.status = 1 AND (si.valid_from IS NULL OR si.valid_from <= ?) AND (si.valid_to IS NULL OR si.valid_to >= ?)
    ORDER BY ps.sort, si.id`, [productId, at, at])
  if (!rows.length) return null
  let fixedFen = 0, perUnitFen = 0
  const items = rows.map(r => {
    const mapQty = Number(r.map_qty) || 1, unitCost = Number(r.unit_cost_fen)
    const lineUnitFen = unitCost * mapQty
    if (r.unit === 'per_order') fixedFen += lineUnitFen
    else perUnitFen += lineUnitFen // per_person / room_night 均随出行份数放大
    return { itemId: Number(r.id), name: r.name, kind: Number(r.kind), unit: r.unit, unitCostFen: unitCost, mapQty, lineUnitFen, itemVersion: Number(r.version), agreement: r.agreement || null }
  })
  return { version: 1, at, items, fixedFen, perUnitFen }
}

/** 订单成本快照（place 事务内调用）：totalFen = fixed + perUnit × qty；未维护返回 null */
export async function orderCostSnapshot(productId, qty, at = bizDay(), c = { q }) {
  const breakdown = await productCostBreakdown(productId, at, c)
  if (!breakdown) return null
  const totalFen = breakdown.fixedFen + breakdown.perUnitFen * qty
  return { ...breakdown, qty, totalFen }
}

/** 单笔订单经营明细（B12 订单口径）。o 需含 amount_pay/insurance_fee/cost_total_fen/price_snapshot 等。
 *  全额退款单：净销售额与成本按退款冲减口径计 0（快照保留供追溯）。 */
export function orderEconomics(o, extras = {}) {
  const goodsCashFen = Number(o.amount_pay) - Number(o.insurance_fee || 0)
  const refunded = Number(o.status) === 70
  // B04：部分退款冲减——净销售额扣实退现金，成本扣已退项成本快照
  const partialFen = Number(extras.partialRefundFen || 0)
  const refundedItemCostFen = Number(extras.refundedItemCostFen || 0)
  const costKnown = o.cost_total_fen != null
  const netSalesFen = refunded ? 0 : goodsCashFen - partialFen
  const costFen = refunded ? 0 : (costKnown ? Math.max(0, Number(o.cost_total_fen) - refundedItemCostFen) : null)
  const profitFen = costFen == null ? null : netSalesFen - costFen
  const marginPct = profitFen == null || netSalesFen <= 0 ? null : Math.round(profitFen / netSalesFen * 10000) / 100
  const snap = o.price_snapshot ? (typeof o.price_snapshot === 'string' ? JSON.parse(o.price_snapshot) : o.price_snapshot) : null
  return {
    originalGoodsFen: snap ? snap.originalGoodsFen : null,
    effectiveGoodsFen: snap ? snap.effectiveGoodsFen : null,
    goodsCashFen, netSalesFen, refunded, partialRefundFen: partialFen,
    freedomDiscountFen: snap?.freedom?.discountFen ?? 0,
    beanDeductFen: Number(o.amount_bean_ded) || 0,
    insuranceFen: Number(o.insurance_fee) || 0,
    costKnown, costFen, costConfirmedFen: o.cost_confirmed_fen != null ? Number(o.cost_confirmed_fen) : null,
    profitFen, marginPct, caliber: 'v1-实际成交/退款冲减-快照复算',
  }
}

/** 汇总（B12 看板）。rows 为订单行（含 amount_pay/insurance_fee/status/cost_total_fen/city_code/product_id/qty 等）。
 *  commissions: Map(order_id → 佣金分)。返回实际成交口径汇总 + 产品/城市下钻 + 已确认（未接入）分栏。
 *  同一订单同时计入总计与产品/城市维度；各维度口径一致，毛利率均为"该范围毛利÷该范围净销售额"。 */
export function summarizeEconomics(rows, commissions = new Map()) {
  const mkAgg = () => ({ orders: 0, qty: 0, netSales: 0, cost: 0, profit: 0, costMissing: 0, negative: 0 })
  const total = mkAgg()
  const byProduct = new Map(), byCity = new Map()
  let refundCash = 0, refunedOrders = 0, commissionTotal = 0, partialCount = 0, partialCash = 0
  for (const o of rows) {
    const e = orderEconomics(o, { partialRefundFen: o.partialRefundFen, refundedItemCostFen: o.refundedItemCostFen })
    const add = t => {
      t.orders++; t.qty += Number(o.qty); t.netSales += e.netSalesFen
      if (e.costFen == null) t.costMissing++
      else { t.cost += e.costFen; t.profit += e.profitFen; if (e.profitFen < 0) t.negative++ }
    }
    add(total)
    if (!byProduct.has(Number(o.product_id))) byProduct.set(Number(o.product_id), mkAgg())
    add(byProduct.get(Number(o.product_id)))
    if (!byCity.has(o.city_code)) byCity.set(o.city_code, mkAgg())
    add(byCity.get(o.city_code))
    if (!e.refunded && e.partialRefundFen > 0) partialCount++
    if (e.refunded) { refunedOrders++; refundCash += Number(o.amount_pay) - Number(o.insurance_fee || 0) }
    if (!e.refunded && e.partialRefundFen > 0) partialCash += e.partialRefundFen
    commissionTotal += Number(commissions.get(Number(o.id)) || 0)
  }
  const pctOf = (p, s) => s <= 0 ? null : Math.round(p / s * 10000) / 100
  const finish = m => [...m.entries()].map(([key, v]) => ({
    key, orders: v.orders, qty: v.qty, netSalesFen: v.netSales,
    costFen: v.costMissing ? null : v.cost, costMissing: v.costMissing,
    profitFen: v.costMissing ? null : v.profit,
    marginPct: v.costMissing || v.netSales <= 0 ? null : pctOf(v.profit, v.netSales),
    negativeProfit: v.negative,
  }))
  const hasMissing = total.costMissing > 0
  return {
    caliber: 'v1-实际成交/退款冲减-快照复算',
    orders: total.orders, qty: total.qty,
    netSalesFen: total.netSales,
    costFen: hasMissing ? null : total.cost, costMissing: total.costMissing,
    profitFen: hasMissing ? null : total.profit,
    marginPct: hasMissing || total.netSales <= 0 ? null : pctOf(total.profit, total.netSales),
    negativeProfit: total.negative, refunedOrders, refundCashFen: refundCash + partialCash, partialRefunds: partialCount,
    commissionFen: commissionTotal,
    operatingIncomeFen: hasMissing ? null : total.profit - commissionTotal,
    confirmed: { status: 'not_available', note: '确认成本/应付/实付随B04结算单元接入，未接入前一律未确认' },
    byProduct: finish(byProduct), byCity: finish(byCity),
  }
}
