// 拼团域：未成团自动取消（§4：depart_date 前 48h 未达 min_go → 取消+全额退款+订阅通知）+ 免费改签
import { q, one, tx, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import * as order from './order.mjs'
import * as refund from './refund.mjs'
import * as pass from './pass.mjs'
import * as wxapi from './wxapi.mjs'

/** 到期未成团的团期 → 取消团期 + 关闭待支付单 + 全额退款已支付单 + 订阅通知。jobs 与测试共用。 */
export async function cancelDueSessions() {
  const hours = await cfgNum('order.group_cancel_hours')
  const due = await q(`SELECT s.*, p.title FROM tour_session s JOIN tour_product p ON p.id = s.product_id
    WHERE s.status = 1 AND s.depart_date < DATE_ADD(NOW(), INTERVAL ? HOUR) AND s.booked < s.min_go`, [hours])
  const done = []
  for (const s of due) {
    const ok = await tx(async (c) => {
      const n = await c.upd('UPDATE tour_session SET status = 5 WHERE id = ? AND status = 1', [s.id])
      if (n !== 1) return false
      // 待支付单直接关（quota 不回减：团期取消时 booked 清零口径统一在下方）
      const stale = await c.q('SELECT id, qty, order_no FROM orders WHERE session_id = ? AND status = 10', [s.id])
      for (const o of stale) {
        await c.upd('UPDATE orders SET status = 90, close_reason = ?, version = version + 1 WHERE id = ? AND status = 10',
          ['group_cancel', o.id])
        await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,10,90,?,?)',
          [o.id, 'system', JSON.stringify('未成团自动取消·关单')])
      }
      await c.upd('UPDATE tour_session SET booked = 0 WHERE id = ?', [s.id])
      return true
    })
    if (!ok) continue
    // 已支付/已确认单走全量退款（豆退、凭证作废、佣金失效）
    const paid = await q("SELECT order_no FROM orders WHERE session_id = ? AND status IN (20,30)", [s.id])
    for (const o of paid) {
      try {
        await refund.fullRefund({ orderNo: o.order_no, reason: '未成团自动取消·全额退款', operator: 'system' })
        await q("UPDATE orders SET close_reason = 'group_cancel' WHERE order_no = ? AND status = 70", [o.order_no])
        await notifyUser(o.order_no, s.title)
        done.push(o.order_no)
      } catch (e) { console.error('[group:refund:err]', o.order_no, e.message) }
    }
    done.push('session:' + s.id)
  }
  return done
}

/** 订阅通知（模板未配置/无凭据时静默 MOCK，不阻塞取消主链路） */
async function notifyUser(orderNo, productTitle) {
  try {
    const o = await order.byNo(orderNo)
    const u = await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [o.user_id])
    const { getSecret } = await import('../infra/secrets.mjs')
    const tpl = await getSecret('WX_TMPL_GROUP_CANCEL')
    await wxapi.sendSubscribeMessage(u && u.mini_a_openid, tpl, {
      thing1: { value: String(productTitle).slice(0, 20) },
      thing2: { value: '未达成团人数已自动取消，款项原路退回' },
    }, 'package-order/pages/orders/index')
  } catch (e) { console.error('[group:notify]', orderNo, e.message) }
}

/** 免费改签（§4）：未成团退款单 → 同频道同价其他报名中团期，免支付出票 */
export async function rebook({ userId, orderNo, sessionId }) {
  const old = await order.byNo(orderNo)
  if (!old || Number(old.user_id) !== Number(userId)) throw new BizError(2003, '订单不存在')
  if (Number(old.status) !== order.ST.REFUNDED || old.close_reason !== 'group_cancel')
    throw new BizError(2002, '仅未成团取消的订单可免费改签')
  if (await one('SELECT id FROM orders WHERE rebook_of = ?', [orderNo])) throw new BizError(1001, '该订单已改签过')

  const s = await one(`SELECT s.*, p.channel FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ?`, [sessionId])
  const oldS = await one('SELECT channel FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ?', [old.session_id])
  if (!s || Number(s.status) !== 1) throw new BizError(2001, '目标团期不可报名')
  if (oldS && s.channel !== oldS.channel) throw new BizError(1001, '仅可改签同频道团期')
  if (Number(s.price_adult) * Number(old.qty) !== Number(old.amount_goods)) throw new BizError(1001, '仅可免费改签同价团期')

  const suffix = String(Date.now() % 100000000).padStart(8, '0') + String(Math.floor(Math.random() * 90) + 10)
  const newNo = 'WL' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + suffix
  await tx(async (c) => {
    const n = await c.upd('UPDATE tour_session SET booked = booked + ? WHERE id = ? AND booked + ? <= quota', [old.qty, sessionId, old.qty])
    if (n !== 1) throw new BizError(2001, '名额不足')
    await c.ins(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty,
        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, paid_at, rebook_of)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,20,NOW(3),? FROM orders WHERE order_no = ?`,
      [newNo, old.user_id, old.product_id, sessionId, old.city_code, old.merchant_id, old.qty,
        old.amount_goods, 0, 0, old.amount_goods, orderNo, orderNo])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES ((SELECT id FROM orders WHERE order_no = ?),0,20,?,?)',
      [newNo, 'system', JSON.stringify('未成团免费改签·出票（免支付）')])
  })
  await pass.issueForOrder(newNo)
  return { orderNo: newNo }
}
