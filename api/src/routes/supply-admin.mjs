// B01/B12 供给项台账与经营口径：PC 后台路由。
// 成本与利润只对平台经营/财务身份开放（super/finance/ops 维护与查看）；
// 城市合伙人、推广服务商、游客一律不可见；游客接口不回传任何成本字段。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { id, paging } from '../domain/sales.mjs'
import * as supply from '../domain/supply.mjs'
import { bizDay } from '../infra/bizdate.mjs'

const reason = b => { const s = String(b.reason || '').trim(); if (s.length < 4 || s.length > 300) throw new BizError(1001, '请填写4–300字操作依据'); return s }
const actor = a => 'admin:' + a.name

export const supplyAdminRoutes = {
  'GET /admin/supply-items': async req => {
    await requireAdmin(req, ['super', 'finance', 'ops'])
    const { page, pageSize, offset } = paging(req.query)
    const kw = String(req.query.kw || '').trim()
    const cond = kw ? ' WHERE name LIKE ?' : '', args = kw ? ['%' + kw + '%'] : []
    const rows = await q(`SELECT * FROM supply_item${cond} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset])
    return { rows, total: Number((await one('SELECT COUNT(*) n FROM supply_item' + cond, args)).n), page, pageSize, unitCn: { per_person: '每人', per_order: '每单', room_night: '房晚' } }
  },

  'POST /admin/supply-items': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), why = reason(req.body)
    const item = supply.itemInput(req.body)
    return tx(async c => {
      if (item.provider_type === 'scenic' && item.provider_id && !await c.one('SELECT id FROM scenic_spot WHERE id=?', [item.provider_id])) throw new BizError(1001, '提供方景区不存在')
      if (item.provider_type === 'supplier' && item.provider_id && !await c.one('SELECT id FROM supplier WHERE id=?', [item.provider_id])) throw new BizError(1001, '提供方供应商不存在')
      if (item.provider_type === 'merchant' && item.provider_id && !await c.one('SELECT id FROM merchant WHERE id=?', [item.provider_id])) throw new BizError(1001, '提供方商户不存在')
      let itemId
      if (req.body.id) {
        itemId = id(req.body.id)
        const old = await c.one('SELECT * FROM supply_item WHERE id=? FOR UPDATE', [itemId])
        if (!old) throw new BizError(1004, '供给项不存在')
        await c.q('UPDATE supply_item SET name=?,kind=?,unit=?,unit_cost_fen=?,ref_retail_fen=?,provider_type=?,provider_id=?,valid_from=?,valid_to=?,agreement=?,note=?,version=version+1,operator=? WHERE id=?',
          [item.name, item.kind, item.unit, item.unit_cost_fen, item.ref_retail_fen, item.provider_type, item.provider_id, item.valid_from, item.valid_to, item.agreement, item.note, actor(a), itemId])
      } else {
        itemId = await c.ins('INSERT INTO supply_item(name,kind,unit,unit_cost_fen,ref_retail_fen,provider_type,provider_id,valid_from,valid_to,agreement,note,operator) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          [item.name, item.kind, item.unit, item.unit_cost_fen, item.ref_retail_fen, item.provider_type, item.provider_id, item.valid_from, item.valid_to, item.agreement, item.note, actor(a)])
      }
      await audit(c, actor(a), 'supply', req.body.id ? 'item-update' : 'item-create', 'si-' + itemId, null, { item, reason: why })
      return { id: Number(itemId) }
    })
  },

  'POST /admin/supply-items/status': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), n = id(req.body.id), why = reason(req.body)
    const status = Number(req.body.status)
    if (![0, 1].includes(status)) throw new BizError(1001, '状态无效')
    return tx(async c => {
      const r = await c.one('SELECT * FROM supply_item WHERE id=? FOR UPDATE', [n])
      if (!r) throw new BizError(1004, '供给项不存在')
      await c.q('UPDATE supply_item SET status=?,operator=? WHERE id=?', [status, actor(a), n])
      await audit(c, actor(a), 'supply', status === 1 ? 'item-enable' : 'item-stop', 'si-' + n, null, { reason: why })
      return { status }
    })
  },

  // 产品成本构成挂载：整表替换（数量以本次提交为准），审计留前后
  'POST /admin/products/:id/supply': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), pid = id(req.params.id), why = reason(req.body)
    const items = Array.isArray(req.body.items) ? req.body.items : []
    if (items.length > 100) throw new BizError(1001, '供给项挂载过多（≤100）')
    return tx(async c => {
      if (!await c.one('SELECT id FROM tour_product WHERE id=?', [pid])) throw new BizError(1004, '产品不存在')
      const norm = []
      for (const it of items) {
        const itemId = id(it.itemId), qty = Number(it.qty)
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) throw new BizError(1001, '供给项数量应为1–9999')
        if (!await c.one('SELECT id,status FROM supply_item WHERE id=?', [itemId])) throw new BizError(1001, '供给项不存在：' + itemId)
        norm.push({ itemId, qty })
      }
      const old = await c.q('SELECT item_id,qty FROM product_supply WHERE product_id=?', [pid])
      await c.q('DELETE FROM product_supply WHERE product_id=?', [pid])
      for (const [i, n] of norm.entries()) await c.q('INSERT INTO product_supply(product_id,item_id,qty,sort) VALUES(?,?,?,?)', [pid, n.itemId, n.qty, i])
      const preview = await supply.productCostBreakdown(pid, bizDay(), c)
      await audit(c, actor(a), 'supply', 'product-supply', 'p-' + pid, old, { items: norm, expectedUnitCost: preview ? preview.perUnitFen + preview.fixedFen : null, reason: why })
      return { saved: norm.length, expectedUnitCostFen: preview ? preview.fixedFen + preview.perUnitFen : null }
    })
  },

  // 产品成本/售价/预计毛利预览（编辑价格/成本时能看到变化，不需要手算表格）
  'GET /admin/products/:id/cost-preview': async req => {
    await requireAdmin(req, ['super', 'finance', 'ops'])
    const pid = id(req.params.id)
    const p = await one('SELECT id,title,price_from,status FROM tour_product WHERE id=?', [pid])
    if (!p) throw new BizError(1004, '产品不存在')
    const sessions = await q(`SELECT id,depart_date,price_adult,early_price,early_days FROM tour_session WHERE product_id=? AND status=1 AND depart_date>=CURDATE() ORDER BY depart_date LIMIT 30`, [pid])
    const { priceForSession } = await import('../domain/order.mjs')
    const breakdown = await supply.productCostBreakdown(pid, bizDay())
    const rows = sessions.map(s => {
      const unit = priceForSession(s).price
      const cost = breakdown ? breakdown.fixedFen + breakdown.perUnitFen : null
      return { sessionId: s.id, departDate: String(s.depart_date).slice(0, 10), unitFen: unit, costFen: cost,
        profitFen: cost == null ? null : unit - cost, marginPct: cost == null || unit <= 0 ? null : Math.round((unit - cost) / unit * 10000) / 100 }
    })
    return { product: p, breakdown, rows, caliber: supply.orderEconomics({ amount_pay: 0, insurance_fee: 0, status: 20, cost_total_fen: null }).caliber,
      note: '预计口径：当前生效供给项×团期实时价；参考零售价之和不能冒充实际售价；改价/改成本不影响已售订单快照' }
  },

  // 订单经营明细（仅平台经营/财务）：成本、毛利、毛利率、口径版本，可展开快照来源
  'GET /admin/orders/:no/economics': async req => {
    await requireAdmin(req, ['super', 'finance'])
    const o = await one('SELECT o.*, p.title FROM orders o JOIN tour_product p ON p.id=o.product_id WHERE o.order_no=?', [req.params.no])
    if (!o) throw new BizError(2003, '订单不存在')
    const partial = await one('SELECT COALESCE(SUM(cash_fen),0) s FROM partial_refund WHERE order_id = ? AND status = 2', [o.id])
    const ric = await one('SELECT COALESCE(SUM(cost_fen),0) s FROM order_item WHERE order_id = ? AND status = 2 AND cost_fen IS NOT NULL', [o.id])
    const e = supply.orderEconomics(o, { partialRefundFen: Number(partial.s), refundedItemCostFen: Number(ric.s) })
    const cost = o.cost_snapshot ? (typeof o.cost_snapshot === 'string' ? JSON.parse(o.cost_snapshot) : o.cost_snapshot) : null
    const price = o.price_snapshot ? (typeof o.price_snapshot === 'string' ? JSON.parse(o.price_snapshot) : o.price_snapshot) : null
    const commission = await q('SELECT promoter_id, base_amount, rate_bp, amount, status FROM commission WHERE order_id=?', [o.id])
    const refunds = await q('SELECT refund_no, amount, fee_amount, status, reason FROM refunds WHERE order_id=?', [o.id])
    return { orderNo: o.order_no, productTitle: o.title, status: Number(o.status), economics: e, costSnapshot: cost, priceSnapshot: price, commissions: commission, refunds,
      note: '毛利/毛利率为实际成交口径（快照复算）；确认成本未接入（B04）；不冒充最终净利润' }
  },

  // 经营看板（B12）：按期间/产品/城市——销量、净销售额、直接成本、毛利、毛利率、已知费用后收益；预计/已确认分栏
  'GET /admin/economics/dashboard': async req => {
    await requireAdmin(req, ['super', 'finance', 'ops'])
    const from = String(req.query.from || '').slice(0, 10), to = String(req.query.to || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new BizError(1001, '统计期间无效（YYYY-MM-DD 起-止）')
    const productId = req.query.productId ? id(req.query.productId) : null
    const city = String(req.query.city || '').trim()
    const cond = ['o.paid_at >= ? AND o.paid_at < ? + INTERVAL 1 DAY', 'o.status IN (20,30,40,50,70)']
    const args = [from, to]
    if (productId) { cond.push('o.product_id = ?'); args.push(productId) }
    if (city) { cond.push('o.city_code = ?'); args.push(city) }
    // 实际成交口径含全额退款单（净销售额冲减为0，退款单另列）与部分退款冲减；60 退款中暂计入"处理中"不进汇总
    const rows = await q(`SELECT o.id, o.product_id, o.city_code, o.qty, o.status, o.amount_pay, o.insurance_fee, o.amount_bean_ded, o.cost_total_fen, o.cost_snapshot, o.price_snapshot, o.paid_at,
        COALESCE(pr.pf, 0) AS partialRefundFen, COALESCE(ric.rc, 0) AS refundedItemCostFen
      FROM orders o
      LEFT JOIN (SELECT order_id, SUM(cash_fen) pf FROM partial_refund WHERE status = 2 GROUP BY order_id) pr ON pr.order_id = o.id
      LEFT JOIN (SELECT order_id, SUM(cost_fen) rc FROM order_item WHERE status = 2 AND cost_fen IS NOT NULL GROUP BY order_id) ric ON ric.order_id = o.id
      WHERE ${cond.join(' AND ')}`, args)
    const ids = rows.map(r => Number(r.id))
    const commissions = new Map(ids.length ? (await q(`SELECT order_id, SUM(amount) amt FROM commission WHERE order_id IN (?) AND status IN (0,2) GROUP BY order_id`, [ids])).map(r => [Number(r.order_id), Number(r.amt)]) : [])
    const summary = supply.summarizeEconomics(rows, commissions)
    const prods = await q('SELECT id,title FROM tour_product WHERE id IN (?)', [summary.byProduct.map(x => x.key).length ? summary.byProduct.map(x => x.key) : [0]])
    for (const r of summary.byProduct) r.title = (prods.find(p => Number(p.id) === Number(r.key)) || {}).title || ('产品#' + r.key)
    // 待支付/退款中单（未进实际口径）：单独提示，避免"看起来少了"
    const pending = Number((await one(`SELECT COUNT(*) n FROM orders o WHERE ${cond[0]} AND o.status IN (10,60) ${productId ? 'AND o.product_id=?' : ''} ${city ? 'AND o.city_code=?' : ''}`,
      [from, to, ...(productId ? [productId] : []), ...(city ? [city] : [])])).n)
    return { ...summary, period: { from, to, by: '支付时间' }, pendingOrders: pending,
      incomeNote: '"已知费用后收益"只扣减已接入的推广佣金，未含税费、工资、房租及全部期间费用，不冒充公司最终净利润；留存金额/GMV均不等于平台净利润' }
  },

  // B04 平台资金桥表：收入→成本→毛利→已知费用→经营收益，逐项有口径、同一项不重复扣减。
  // 期间按支付时间；含全退冲减与部分退款冲减；确认成本取已结算订单回填值（未结算完成单用下单快照并标注）。
  'GET /admin/economics/bridge': async req => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const from = String(req.query.from || '').slice(0, 10), to = String(req.query.to || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new BizError(1001, '统计期间无效（YYYY-MM-DD 起-止）')
    // 行1：商品现金收入（总实收−保费−全退冲减−部分退款冲减）
    const inc = await one(`SELECT COALESCE(SUM(o.amount_pay - o.insurance_fee),0) gross,
        COALESCE(SUM(CASE WHEN o.status = 70 THEN o.amount_pay - o.insurance_fee ELSE 0 END),0) fullRefunded,
        COALESCE(SUM(CASE WHEN o.status <> 70 THEN COALESCE(pr.pf,0) ELSE 0 END),0) partialRefunded,
        SUM(o.insurance_fee) insurance
      FROM orders o LEFT JOIN (SELECT order_id, SUM(cash_fen) pf FROM partial_refund WHERE status = 2 GROUP BY order_id) pr ON pr.order_id = o.id
      WHERE o.paid_at >= ? AND o.paid_at < ? + INTERVAL 1 DAY AND o.status IN (20,30,40,50,70)`, [from, to])
    const incomeFen = Number(inc.gross) - Number(inc.fullRefunded) - Number(inc.partialRefunded)
    // 行2：直接成本（完成且已结算=确认值；未结算完成单用下单快照并标注"预计"）
    const cost = await one(`SELECT COALESCE(SUM(CASE WHEN o.settlement_id IS NOT NULL THEN o.cost_confirmed_fen ELSE o.cost_total_fen END),0) c,
        SUM(CASE WHEN o.settlement_id IS NULL AND o.cost_total_fen IS NOT NULL THEN 1 ELSE 0 END) expectedN,
        SUM(CASE WHEN o.cost_total_fen IS NULL THEN 1 ELSE 0 END) missingN
      FROM orders o WHERE o.paid_at >= ? AND o.paid_at < ? + INTERVAL 1 DAY AND o.status IN (20,30,40,50)`, [from, to])
    const costFen = Number(cost.missingN) > 0 ? null : Number(cost.c)
    // 行3：已知费用——推广佣金（计入完成订单）；支付手续费未接入标0；平台承担补贴另列
    const commission = await one(`SELECT COALESCE(SUM(c.amount),0) s FROM commission c JOIN orders o ON o.id = c.order_id
      WHERE o.paid_at >= ? AND o.paid_at < ? + INTERVAL 1 DAY AND o.status IN (20,30,40,50,70) AND c.status IN (0,2)`, [from, to])
    const commissionFen = Number(commission.s)
    const subsidy = await one(`SELECT COALESCE(SUM(used),0) s FROM freedom_budget`) // 平台补贴责任累计（另列不进减项）
    const subsidyFen = Number(subsidy.s)
    const operatingFen = costFen == null ? null : incomeFen - costFen - commissionFen
    const rows = [
      { label: '商品现金收入（总实收）', fen: Number(inc.gross), caliber: 'Σ(实付−保费)，按支付时间', note: '含全额/部分退款单原实付' },
      { label: '− 全额退款冲减', fen: -Number(inc.fullRefunded), caliber: '已退款订单的商品现金', note: '实退以退款单为准' },
      { label: '− 部分退款冲减', fen: -Number(inc.partialRefunded), caliber: '已结算部分退款合计', note: '按项退款 PR 单' },
      { label: '＝ 商品净销售额', fen: incomeFen, caliber: '实际成交/退款冲减口径', note: '毛利率分母' },
      { label: '− 直接成本', fen: costFen == null ? null : -costFen, caliber: cost.expectedN > 0 ? '确认成本+预计成本（' + cost.expectedN + '单未结算）' : '确认成本（已结算回填）', note: Number(cost.missingN) > 0 ? '⚠ ' + cost.missingN + ' 单成本未维护，不可计算' : 'B01 供给项快照' },
      { label: '＝ 商品经营毛利', fen: costFen == null ? null : incomeFen - costFen, caliber: '净销售额−直接成本', note: '毛利率=' + (incomeFen > 0 && costFen != null ? (Math.round((incomeFen - costFen) / incomeFen * 10000) / 100) + '%' : '—') },
      { label: '− 推广佣金', fen: -commissionFen, caliber: '已计提佣金（status 0/2）', note: '与五口径 amt_promoter 同源不重复扣' },
      { label: '＝ 已知费用后经营收益', fen: operatingFen, caliber: '毛利−已接入佣金', note: '未含税费/工资/房租及全部期间费用，不冒充最终净利润' },
      { label: '（另列）平台承担补贴责任累计', fen: subsidyFen, caliber: 'freedom_budget.used', note: '已由券在实付中抵减，不再从收入重复扣减' },
      { label: '（另列）保费/代收款', fen: Number(inc.insurance), caliber: '直付保险方', note: '不算销售收入、不进成本与佣金基数' },
    ]
    const balanceOk = costFen == null ? true : (rows[3].fen === incomeFen && (rows[5].fen === incomeFen - costFen) && (rows[7].fen === incomeFen - costFen - commissionFen)) ? 1 : 0
    await q(`INSERT INTO econ_bridge (period_from, period_to, rows_snapshot, income_fen, cost_fen, commission_fen, operating_fen, balance_ok, operator)
      VALUES (?,?,?,?,?,?,?,?,?)`, [from, to, JSON.stringify(rows), incomeFen, costFen, commissionFen, operatingFen, balanceOk, 'admin:' + a.name])
    return { period: { from, to, by: '支付时间' }, rows, balanceOk,
      note: '桥表每次查询落一份快照（只增不改）；同一项不重复扣减：佣金与五口径 amt_promoter 同源，补贴已在实付中抵减故仅另列。' }
  },
}
