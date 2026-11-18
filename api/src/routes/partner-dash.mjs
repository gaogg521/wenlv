// 主体方经营看板（V82）：商户/景区主体方登录 PC 的默认首页——只聚合本主体授权范围，口径与各源账一致。
// R-01：超管可带 viewAsType/viewAsId 以某主体视角只读查看同一份数据（与主体账号登录看到的完全一致）；
// 进入/退出代看各写一条审计（POST /admin/partner-dash/view-as）；带 viewAs 参数的写操作在网关层（index.mjs）一律拒绝。
import { one, tx, BizError } from '../db.mjs'
import { requireAdmin, subjectScope, audit } from './_shared.mjs'
import { scenicSettlementRows } from '../domain/promo.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const num = v => Number(v || 0)

/** 商户主体看板聚合（本店近 30 天订单/退款/结算 + 待履约/在库商品） */
async function merchantDashData(mid) {
  const from = bizDay(-29)
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

/** 景区主体看板聚合（本景区商品订单/退款/结算投影 + 关联商户/复盘） */
async function scenicDashData(sid) {
  const from = bizDay(-29)
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

export const partnerDash = {
  'GET /admin/partner-dash': async (req) => {
    const a = await requireAdmin(req)
    // R-01：超管只读代看——数据口径与主体账号登录完全一致（同一聚合函数）
    const viewAsType = String(req.query.viewAsType || '').trim()
    if (viewAsType) {
      await requireAdmin(req, 'partner.viewAs')
      const viewAsId = Number(req.query.viewAsId || 0)
      if (!['merchant', 'scenic'].includes(viewAsType) || !viewAsId) throw new BizError(1001, '代看主体参数无效')
      const exists = await one(`SELECT id FROM ${viewAsType === 'merchant' ? 'merchant' : 'scenic_spot'} WHERE id = ?`, [viewAsId])
      if (!exists) throw new BizError(1004, '主体不存在')
      const d = viewAsType === 'merchant' ? await merchantDashData(viewAsId) : await scenicDashData(viewAsId)
      return { ...d, viewAs: true }
    }
    const sub = subjectScope(a)
    if (a.role === 'merchant_partner') {
      if (!sub.merchantId) throw new BizError(1003, '商户主体方未绑定主体')
      return await merchantDashData(sub.merchantId)
    }
    if (a.role === 'scenic_partner') {
      if (!sub.scenicId) throw new BizError(1003, '景区主体方未绑定主体')
      return await scenicDashData(sub.scenicId)
    }
    // C-04：超管等非主体角色不再只收到“不可用”——给明确只读预览（结构同上，主体为空=全零展示，不落任何主体数据）。
    // R-01：超管在此页可选择主体进入只读代看（见 previewOnly 分支的前端入口与 partner.viewAs 能力点）。
    if (a.role === 'super') {
      return { kind: 'preview', previewOnly: true, subject: null, windowDays: 30,
        recent: { orders: 0, gmvFen: 0 }, refunds: { count: 0, amountFen: 0 },
        settlement: { count: 0, payableFen: 0, paidFen: 0 }, pendingItems: 0, products: 0,
        previewNote: '只读预览：主体方经营看板的数据按主体授权范围聚合，超级管理员账号未绑定商户/景区主体，此处为结构预览（全零）。可在下方选择一个主体进入只读代看，或用商户/景区主体方账号登录查看。' }
    }
    throw new BizError(1003, '主体方经营看板仅对商户/景区主体方开放')
  },

  // R-01：进入/退出代看各写一条审计（进入=选择主体；退出=subjectId 置空）
  'POST /admin/partner-dash/view-as': async (req) => {
    const a = await requireAdmin(req, 'partner.viewAs')
    const { subjectType, subjectId } = req.body || {}
    if (subjectId == null || subjectId === '') {
      await tx(async (c) => audit(c, 'admin:' + a.name, 'partner', 'view-as-exit', 'partnerdash', null, null))
      return { active: false }
    }
    const vt = String(subjectType || '')
    if (!['merchant', 'scenic'].includes(vt)) throw new BizError(1001, '主体类型无效')
    const row = await one(`SELECT id, name FROM ${vt === 'merchant' ? 'merchant' : 'scenic_spot'} WHERE id = ?`, [Number(subjectId)])
    if (!row) throw new BizError(1004, '主体不存在')
    await tx(async (c) => audit(c, 'admin:' + a.name, 'partner', 'view-as-enter', vt + '-' + row.id, null, { name: row.name }))
    return { active: true, subjectType: vt, subjectId: Number(row.id), name: row.name }
  },
}
