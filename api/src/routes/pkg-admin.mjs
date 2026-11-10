// B02/B03/B04 套餐与订单项：PC 后台配置、订单项查看、部分退款（admin）
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { id } from '../domain/sales.mjs'
import * as pkg from '../domain/package.mjs'

const reason = b => { const s = String(b.reason || '').trim(); if (s.length < 4 || s.length > 300) throw new BizError(1001, '请填写4–300字操作依据'); return s }
const actor = a => 'admin:' + a.name

export const pkgAdminRoutes = {
  'GET /admin/products/:id/package-items': async req => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const pid = id(req.params.id)
    return { rows: await q('SELECT * FROM package_item WHERE product_id = ? ORDER BY sort, id', [pid]), kindCn: pkg.kindCn }
  },

  'POST /admin/products/:id/package-items': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), pid = id(req.params.id), why = reason(req.body)
    const item = pkg.templateInput(req.body)
    return tx(async c => {
      if (!await c.one('SELECT id FROM tour_product WHERE id=?', [pid])) throw new BizError(1004, '产品不存在')
      if (!await c.one('SELECT id FROM merchant WHERE id=? AND status=1', [item.merchant_id])) throw new BizError(1001, '提供方门店不存在或未生效')
      if (item.supply_item_id && !await c.one('SELECT id FROM supply_item WHERE id=?', [item.supply_item_id])) throw new BizError(1001, '成本供给项不存在')
      let itemId
      if (req.body.id) {
        itemId = id(req.body.id)
        const old = await c.one('SELECT * FROM package_item WHERE id=? FOR UPDATE', [itemId])
        if (!old) throw new BizError(1004, '套餐项不存在')
        await c.q('UPDATE package_item SET name=?,kind=?,merchant_id=?,supply_item_id=?,unit_price_fen=?,qty_per_unit=?,benefit_desc=?,benefit_rules=?,version=version+1,operator=? WHERE id=?',
          [item.name, item.kind, item.merchant_id, item.supply_item_id, item.unit_price_fen, item.qty_per_unit, item.benefit_desc, item.benefit_rules, actor(a), itemId])
      } else {
        itemId = await c.ins('INSERT INTO package_item(product_id,name,kind,merchant_id,supply_item_id,unit_price_fen,qty_per_unit,benefit_desc,benefit_rules,sort,operator) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [pid, item.name, item.kind, item.merchant_id, item.supply_item_id, item.unit_price_fen, item.qty_per_unit, item.benefit_desc, item.benefit_rules, Number(req.body.sort) || 0, actor(a)])
      }
      await audit(c, actor(a), 'package', req.body.id ? 'item-update' : 'item-create', 'pi-' + itemId, null, { item, reason: why })
      return { id: Number(itemId) }
    })
  },

  'POST /admin/products/:id/package-items/status': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), pid = id(req.params.id), n = id(req.body.id), why = reason(req.body)
    const status = Number(req.body.status)
    if (![0, 1].includes(status)) throw new BizError(1001, '状态无效')
    return tx(async c => {
      const r = await c.one('SELECT * FROM package_item WHERE id=? AND product_id=? FOR UPDATE', [n, pid])
      if (!r) throw new BizError(1004, '套餐项不存在')
      await c.q('UPDATE package_item SET status=?,operator=? WHERE id=?', [status, actor(a), n])
      await audit(c, actor(a), 'package', status === 1 ? 'item-enable' : 'item-stop', 'pi-' + n, null, { reason: why })
      return { status }
    })
  },

  'GET /admin/orders/:no/items': async req => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    const o = await one('SELECT id FROM orders WHERE order_no = ?', [req.params.no])
    if (!o) throw new BizError(2003, '订单不存在')
    const items = await q(`SELECT oi.*, m.name merchant_name FROM order_item oi JOIN merchant m ON m.id = oi.merchant_id WHERE oi.order_id = ? ORDER BY oi.id`, [o.id])
    const partials = await q('SELECT refund_no, item_ids, cash_fen, fee_fen, status, reason, operator, created_at FROM partial_refund WHERE order_id = ? ORDER BY id DESC', [o.id])
    const showCost = ['super', 'finance'].includes(a.role)
    return { items: items.map(i => ({ ...i, cost_fen: showCost ? i.cost_fen : null })), partials, showCost }
  },

  // 客服/超管按项部分退款（不按政策扣手续费，平台原因全额退项分摊；留审计）
  'POST /admin/orders/:no/partial-refund': async req => {
    const a = await requireAdmin(req, ['super', 'finance']), why = reason(req.body)
    const r = await pkg.partialRefund({ orderNo: req.params.no, itemIds: req.body.itemIds, reason: why, operator: actor(a), applyPolicy: false })
    await q('INSERT INTO audit_log (actor, module, action, biz_ref, after_val) VALUES (?,?,?,?,?)',
      [actor(a), 'refund', 'partial', req.params.no, JSON.stringify({ ...r, items: req.body.itemIds, reason: why })])
    return r
  },
}
