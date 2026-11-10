// D01 商品促销折扣：后台规则维护（商品与团期 → 促销折扣/价格规则）
// 折数界面按"折"填写（1–10，最多两位小数，如填8表示按原价80%付款）；内部存付款比例 bp。
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { id, paging } from '../domain/sales.mjs'
import { ruleInput } from '../domain/discount.mjs'

const reason = b => { const s = String(b.reason || '').trim(); if (s.length < 4 || s.length > 300) throw new BizError(1001, '请填写4–300字操作依据'); return s }
const actor = a => 'admin:' + a.name

export const promoAdminRoutes = {
  'GET /admin/promo-discounts': async req => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const { page, pageSize, offset } = paging(req.query)
    const status = req.query.status != null && req.query.status !== '' ? Number(req.query.status) : null
    if (status != null && ![0, 1].includes(status)) throw new BizError(1001, '状态无效')
    const cond = status != null ? ' WHERE status = ?' : '', args = status != null ? [status] : []
    const rows = await q(`SELECT * FROM promo_discount${cond} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset])
    return { rows, total: Number((await one('SELECT COUNT(*) n FROM promo_discount' + cond, args)).n), page, pageSize }
  },

  'POST /admin/promo-discounts': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), why = reason(req.body)
    const rule = ruleInput(req.body)
    return tx(async c => {
      for (const pid of rule.products) if (!await c.one('SELECT id FROM tour_product WHERE id=?', [Number(pid)])) throw new BizError(1001, '适用产品不存在：' + pid)
      let ruleId
      if (req.body.id) {
        ruleId = id(req.body.id)
        const old = await c.one('SELECT * FROM promo_discount WHERE id=? FOR UPDATE', [ruleId])
        if (!old) throw new BizError(1004, '规则不存在')
        await c.q('UPDATE promo_discount SET name=?,discount_bp=?,stack_early=?,from_time=?,to_time=?,products=?,cities=?,channels=?,dates=?,version=version+1,operator=? WHERE id=?',
          [rule.name, rule.discount_bp, rule.stack_early, rule.from_time, rule.to_time, JSON.stringify(rule.products), JSON.stringify(rule.cities), JSON.stringify(rule.channels), JSON.stringify(rule.dates), actor(a), ruleId])
      } else {
        ruleId = await c.ins('INSERT INTO promo_discount(name,discount_bp,stack_early,from_time,to_time,products,cities,channels,dates,operator) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [rule.name, rule.discount_bp, rule.stack_early, rule.from_time, rule.to_time, JSON.stringify(rule.products), JSON.stringify(rule.cities), JSON.stringify(rule.channels), JSON.stringify(rule.dates), actor(a)])
      }
      await audit(c, actor(a), 'promo', req.body.id ? 'discount-update' : 'discount-create', 'pd-' + ruleId, null, { rule, reason: why })
      return { id: Number(ruleId) }
    })
  },

  'POST /admin/promo-discounts/status': async req => {
    const a = await requireAdmin(req, ['super', 'ops']), n = id(req.body.id), why = reason(req.body)
    const status = Number(req.body.status)
    if (![0, 1].includes(status)) throw new BizError(1001, '状态无效')
    return tx(async c => {
      const r = await c.one('SELECT * FROM promo_discount WHERE id=? FOR UPDATE', [n])
      if (!r) throw new BizError(1004, '规则不存在')
      await c.q('UPDATE promo_discount SET status=?,operator=? WHERE id=?', [status, actor(a), n])
      await audit(c, actor(a), 'promo', status === 1 ? 'discount-enable' : 'discount-stop', 'pd-' + n, null, { reason: why })
      return { status }
    })
  },
}
