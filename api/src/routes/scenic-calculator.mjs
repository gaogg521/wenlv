import { createHash } from 'node:crypto'
import { one, q, tx, BizError } from '../db.mjs'
import { requireAdmin, requireModule, scopeFilter } from './_shared.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import { calculate, example } from '../domain/scenic-calculator.mjs'

const base = '/admin/scenics/:id/calculator'
const roles = ['super', 'ops', 'finance', 'city_partner']
const validId = value => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new BizError(1001, '编号无效')
  return id
}

async function calculatorActor(req) {
  const actor = await requireAdmin(req, roles)
  if (actor.role === 'city_partner' && !actor.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  return actor
}

async function merchantScope(req, actor) {
  if (req.query.merchantId == null) return null
  await requireModule(req, 'merchants')
  const scope = scopeFilter(actor)
  const merchant = await one('SELECT id,name,city_code FROM merchant WHERE id=?' + scope.sql, [validId(req.query.merchantId), ...scope.params])
  if (!merchant) throw new BizError(1004, '商户不存在或不在授权范围')
  return merchant
}

async function access(req) {
  const actor = await calculatorActor(req)
  const merchant = await merchantScope(req, actor)
  const scope = scopeFilter(actor)
  const scenic = await one('SELECT id,name,city_code FROM scenic_spot WHERE id=?' + scope.sql, [validId(req.params.id), ...scope.params])
  if (!scenic) throw new BizError(1004, '景区不存在或不在授权范围')
  if (merchant && (merchant.city_code !== scenic.city_code || !await one('SELECT id FROM tour_product WHERE scenic_id=? AND merchant_id=? LIMIT 1', [scenic.id, merchant.id]))) {
    throw new BizError(1004, '该商户未关联此景区')
  }
  return { actor, scenic, merchant }
}

function period(body) {
  const dates = [body.from, body.to]
  const times = dates.map(date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN)
  if (times.some((time, i) => !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== dates[i]) ||
      times[1] < times[0] || times[1] - times[0] >= 366 * 86400000) throw new BizError(1001, '请选择不超过366天的有效统计期间')
  return { from: dates[0], to: dates[1] }
}

async function compute(c, ctx, body) {
  const { from, to } = period(body)
  const scenario = calculate(body.inputs)
  const { scenic, actor, merchant } = ctx
  const internal = actor.role !== 'city_partner'
  const orders = await c.q(`
    SELECT o.id,o.order_no,o.status,o.paid_at,o.insurance_fee,p.title,pay.id paymentId,pay.amount paymentFen,
      o.promo_scene,o.settlement_id,s.period settlementPeriod,s.status settlementStatus,
      o.cost_confirmed_fen,o.amount_bean_ded,fo.discount freedomFen,fo.status freedomStatus,
      (SELECT SUM(cm.amount) FROM commission cm WHERE cm.order_id=o.id AND cm.status IN (0,1,2)) commissionFen,
      (SELECT COUNT(*) FROM travel_pass t WHERE t.order_id=o.id AND t.status=2) verifiedPasses,
      (SELECT old.order_no FROM orders old JOIN tour_product op ON op.id=old.product_id
        WHERE old.user_id=o.user_id AND op.scenic_id=p.scenic_id AND old.city_code=o.city_code
        ${merchant ? 'AND old.merchant_id=o.merchant_id' : ''}
        AND old.status IN (20,30,40,50) AND (old.paid_at<o.paid_at OR (old.paid_at=o.paid_at AND old.id<o.id)) ORDER BY old.paid_at,old.id LIMIT 1) firstOrderNo
    FROM orders o JOIN tour_product p ON p.id=o.product_id JOIN payment pay ON pay.order_id=o.id AND pay.status IN (1,3,4)
    LEFT JOIN settlement s ON s.id=o.settlement_id
    LEFT JOIN freedom_order fo ON fo.order_no=o.order_no
    WHERE p.scenic_id=? AND o.city_code=? AND o.paid_at>=? AND o.paid_at<DATE_ADD(?,INTERVAL 1 DAY)
      ${merchant ? 'AND o.merchant_id=?' : ''}
    ORDER BY o.paid_at DESC,o.id DESC LIMIT 1001`, [scenic.id, scenic.city_code, from, to, ...(merchant ? [merchant.id] : [])])
  if (orders.length > 1000) throw new BizError(1001, '当前期间超过1000笔订单，请缩短统计期间')
  const ids = orders.map(o => o.id)
  const refunds = ids.length ? await c.q('SELECT order_id,refund_no,amount,fee_amount,settled_at FROM refunds WHERE status=2 AND order_id IN (?) ORDER BY id', [ids]) : []
  const refundByOrder = Map.groupBy(refunds, row => row.order_id)
  const sources = orders.map(o => {
    const rows = refundByOrder.get(o.id) || []
    const insuranceFen = Number(o.insurance_fee)
    const goodsFen = Number(o.paymentFen) - insuranceFen
    // 项级退款只退商品。旧整单退款含代收时无分项拆分，保留来源并标明未知。
    const hasUnallocated = insuranceFen > 0 && rows.some(r => !r.refund_no.startsWith('PR'))
    const refundFen = hasUnallocated ? null : rows.reduce((sum, r) => sum + Number(r.amount), 0)
    return {
      orderNo: o.order_no, title: o.title, status: Number(o.status), paidAt: o.paid_at,
      paymentId: Number(o.paymentId), paymentFen: Number(o.paymentFen), insuranceFen, goodsFen, refundFen,
      netFen: refundFen == null ? null : goodsFen - refundFen,
      refunds: rows.map(r => ({ no: r.refund_no, amountFen: Number(r.amount), feeFen: Number(r.fee_amount), settledAt: r.settled_at })),
      confirmedCostFen: internal && o.cost_confirmed_fen != null ? Number(o.cost_confirmed_fen) : null,
      promoScene: o.promo_scene, verifiedPasses: Number(o.verifiedPasses), repeatOrder: Boolean(o.firstOrderNo), firstOrderNo: o.firstOrderNo,
      beanDeductFen: Number(o.amount_bean_ded), freedomFen: Number(o.freedomFen || 0), freedomStatus: o.freedomStatus,
      commissionFen: internal && o.commissionFen != null ? Number(o.commissionFen) : null,
      settlement: o.settlement_id ? { id: Number(o.settlement_id), period: o.settlementPeriod, status: Number(o.settlementStatus) } : null,
    }
  })
  const total = key => sources.reduce((sum, row) => sum + row[key], 0)
  const netFen = sources.some(row => row.netFen == null) ? null : total('netFen')
  const snapshot = {
    scenic, ...(merchant ? { merchant } : {}), from, to, scenario, sources,
    actual: {
      ...(merchant ? { scope: 'merchant' } : {}),
      orders: sources.length, repeatOrders: sources.filter(row => row.repeatOrder).length,
      goodsFen: total('goodsFen'), refundFen: netFen == null ? null : total('refundFen'), netFen,
      avgGoodsFen: sources.length ? Math.round(total('goodsFen') / sources.length) : null,
      costsVisible: internal,
      confirmedCostFen: internal && sources.length && sources.every(row => row.confirmedCostFen != null) ? total('confirmedCostFen') : null,
    },
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return { ...snapshot, fingerprint, at: new Date().toISOString() }
}

// 旧快照没有 merchant 字段，按景区全量复盘保留。
const reviewScope = " AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.merchant.id')), '0') = ?"

export const scenicCalculatorRoutes = {
  'GET /admin/scenic-calculator/options': async req => {
    const actor = await calculatorActor(req)
    const merchant = await merchantScope(req, actor)
    const city = merchant?.city_code || String(req.query.city || '')
    if (!/^\d{6}$/.test(city)) throw new BizError(1001, '请选择有效城市')
    if (actor.scopeCity && actor.scopeCity !== city) throw new BizError(1003, '只能查看本城景区')
    return q(`SELECT s.id,s.name FROM scenic_spot s WHERE s.city_code=?
      ${merchant ? 'AND EXISTS (SELECT 1 FROM tour_product p WHERE p.scenic_id=s.id AND p.merchant_id=?)' : ''}
      ORDER BY s.name,s.id`, [city, ...(merchant ? [merchant.id] : [])])
  },
  ['GET ' + base]: async req => {
    const { scenic, actor, merchant } = await access(req)
    const reviews = await q('SELECT id,created_at FROM scenic_review WHERE scenic_id=? AND admin_id=? AND admin_role=?' + reviewScope + ' ORDER BY id DESC LIMIT 50', [scenic.id, actor.uid || 0, actor.role, String(merchant?.id || 0)])
    return { scenic, merchant, reviews, example, today: bizDay() }
  },
  ['POST ' + base]: async req => {
    const ctx = await access(req)
    return tx(c => compute(c, ctx, req.body))
  },
  ['POST ' + base + '/reviews']: async req => {
    const ctx = await access(req)
    if (!ctx.actor.uid) throw new BizError(1003, '需要具名后台账号')
    return tx(async c => {
      const snapshot = await compute(c, ctx, req.body)
      if (req.body.fingerprint !== snapshot.fingerprint) throw new BizError(1001, '假设或业务数据已变化，请先重算并确认结果')
      const reviewId = await c.ins('INSERT INTO scenic_review(scenic_id,admin_id,admin_role,snapshot) VALUES(?,?,?,?)', [
        ctx.scenic.id, ctx.actor.uid, ctx.actor.role, JSON.stringify(snapshot),
      ])
      return { ...snapshot, reviewId: Number(reviewId) }
    })
  },
  ['GET ' + base + '/reviews/:reviewId']: async req => {
    const { scenic, actor, merchant } = await access(req)
    const saved = await one('SELECT id,snapshot FROM scenic_review WHERE id=? AND scenic_id=? AND admin_id=? AND admin_role=?' + reviewScope, [
      validId(req.params.reviewId), scenic.id, actor.uid || 0, actor.role, String(merchant?.id || 0),
    ])
    if (!saved) throw new BizError(1004, '复盘记录不存在或不在授权范围')
    return { ...(typeof saved.snapshot === 'string' ? JSON.parse(saved.snapshot) : saved.snapshot), reviewId: Number(saved.id) }
  },
}
