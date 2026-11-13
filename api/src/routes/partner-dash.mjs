// 主体方经营看板（V82）：商户/景区主体方登录 PC 的默认首页——只聚合本主体授权范围，口径与各源账一致。
import { one, BizError } from '../db.mjs'
import { requireAdmin, subjectScope } from './_shared.mjs'
import { scenicSettlementRows } from '../domain/promo.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const num = v => Number(v || 0)

export const partnerDash = {
  'GET /admin/partner-dash': async (req) => {
    const a = await requireAdmin(req)
    const sub = subjectScope(a)
    const from = bizDay(-29)
    if (a.role === 'merchant_partner') {
      if (!sub.merchantId) throw new BizError(1003, '商户主体方未绑定主体')
      const mid = sub.merchantId
      const m = await one('SELECT id, name, city_code FROM merchant WHERE id = ?', [mid])
      if (!m) throw new BizError(1004, '绑定的商户不存在')
      const recent = await one(`SELECT COUNT(*) orders, COALESCE(SUM(amount_pay),0) gmv FROM orders
        WHERE merchant_id = ? AND status IN (20,30,40,50) AND paid_at >= ?`, [mid, from])
      const refund = await one(`SELECT COUNT(*) n, COALESCE(SUM(r.amount),0) amt FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.merchant_id = ? AND r.status = 2 AND r.settled_at >= ?`, [mid, from])
      const settle = await one(`SELECT COUNT(*) n,
          COALESCE(SUM(amt_fulfill + COALESCE(fee_merchant,0) + (SELECT COALESCE(SUM(x.amount_fen),0) FROM settlement_adjustment x WHERE x.settlement_id = s.id AND x.type = 1 AND x.applied_settlement_id IS NULL)),0) payable,
          COALESCE(SUM(IF(status = 3, amt_fulfill + COALESCE(fee_merchant,0),0)),0) paid
        FROM settlement s WHERE s.merchant_id = ?`, [mid])
      const pendingItems = num((await one(`SELECT COUNT(*) n FROM order_item oi WHERE oi.merchant_id = ? AND oi.status = 0
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = oi.order_id AND o.status IN (20,30))`, [mid])).n)
      const products = num((await one('SELECT COUNT(*) n FROM tour_product WHERE merchant_id = ?', [mid])).n)
      return { kind: 'merchant', subject: { id: Number(m.id), name: m.name, cityCode: m.city_code }, windowDays: 30,
        recent: { orders: num(recent.orders), gmvFen: num(recent.gmv) },
        refunds: { count: num(refund.n), amountFen: num(refund.amt) },
        settlement: { count: num(settle.n), payableFen: num(settle.payable), paidFen: num(settle.paid) },
        pendingItems, products }
    }
    if (a.role === 'scenic_partner') {
      if (!sub.scenicId) throw new BizError(1003, '景区主体方未绑定主体')
      const sid = sub.scenicId
      const sc = await one('SELECT id, name, city_code FROM scenic_spot WHERE id = ?', [sid])
      if (!sc) throw new BizError(1004, '绑定的景区不存在')
      const recent = await one(`SELECT COUNT(*) orders, COALESCE(SUM(o.amount_pay),0) gmv FROM orders o JOIN tour_product p ON p.id = o.product_id
        WHERE p.scenic_id = ? AND o.status IN (20,30,40,50) AND o.paid_at >= ?`, [sid, from])
      const refund = await one(`SELECT COUNT(*) n, COALESCE(SUM(r.amount),0) amt FROM refunds r JOIN orders o ON o.id = r.order_id JOIN tour_product p ON p.id = o.product_id
        WHERE p.scenic_id = ? AND r.status = 2 AND r.settled_at >= ?`, [sid, from])
      const settlements = await scenicSettlementRows(sid)
      const settlement = {
        count: settlements.length,
        payableFen: settlements.reduce((sum, row) => sum + row.scenic_payable_fen + num(row.adjust_pending), 0),
        paidFen: settlements.reduce((sum, row) => sum + (Number(row.status) === 3 ? row.scenic_payable_fen : 0), 0),
      }
      const merchants = num((await one(`SELECT COUNT(DISTINCT merchant_id) n FROM tour_product WHERE scenic_id = ?`, [sid])).n)
      const reviews = num((await one(`SELECT COUNT(*) n FROM scenic_review WHERE scenic_id = ?`, [sid])).n)
      return { kind: 'scenic', subject: { id: Number(sc.id), name: sc.name, cityCode: sc.city_code }, windowDays: 30,
        recent: { orders: num(recent.orders), gmvFen: num(recent.gmv) },
        refunds: { count: num(refund.n), amountFen: num(refund.amt) },
        settlement,
        boundMerchants: merchants, reviews }
    }
    throw new BizError(1003, '主体方经营看板仅对商户/景区主体方开放')
  },
}
