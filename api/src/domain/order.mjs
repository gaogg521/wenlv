// 订单域（与 Java 版同一守卫表）：状态机 + 下单 + 支付编排
import { q, one, tx, count, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'

export const ST = { WAIT_PAY: 10, PAID: 20, CONFIRMED: 30, VERIFIED: 40, COMPLETED: 50, REFUNDING: 60, REFUNDED: 70, CLOSED: 90 }

const GUARDS = {
  [ST.WAIT_PAY]: { PAY_SUCCESS: ST.PAID, CLOSE_TIMEOUT: ST.CLOSED },
  [ST.PAID]: { CONFIRM: ST.CONFIRMED, REFUND_APPLY: ST.REFUNDING },
  [ST.CONFIRMED]: { VERIFY_ALL: ST.VERIFIED, REFUND_APPLY: ST.REFUNDING },
  [ST.VERIFIED]: { OBSERVE_END: ST.COMPLETED, REFUND_APPLY: ST.REFUNDING },
  [ST.REFUNDING]: { REFUND_SUCCESS: ST.REFUNDED },
  [ST.COMPLETED]: {}, [ST.REFUNDED]: {}, [ST.CLOSED]: {},
}

export function canFire(from, ev) { return !!(GUARDS[from] && GUARDS[from][ev]) }

/** 状态机唯一写入口：乐观锁 + order_event 审计 */
export async function fire(orderNo, ev, actor, listener) {
  return await tx(async (c) => {
    const o = await c.one('SELECT * FROM orders WHERE order_no = ?', [orderNo])
    if (!o) throw new BizError(2003, '订单不存在')
    const to = GUARDS[o.status]?.[ev]
    if (!to) throw new BizError(2002, `非法流转: ${o.status} + ${ev}`)
    let detail = ev
    if (listener) detail = (await listener(c, o, to)) || ev
    const n = await c.upd('UPDATE orders SET status = ?, version = version + 1 WHERE id = ? AND version = ?', [to, o.id, o.version])
    if (n !== 1) throw new BizError(2002, '并发冲突（乐观锁）')
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)',
      [o.id, o.status, to, actor, JSON.stringify(detail)])
    return { ...o, status: to }
  })
}

/** 早鸟价判定：出发前 early_days 天（含）之前报名享 early_price；未开启返回原价（总方案 §4） */
export function priceForSession(s) {
  const days = Math.floor((new Date(s.depart_date + 'T00:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / 86400000)
  const early = s.early_price && s.early_days != null && days >= Number(s.early_days) ? Number(s.early_price) : Number(s.price_adult)
  return { price: early, isEarly: early !== Number(s.price_adult), daysToDepart: days }
}

/** 下单：条件 UPDATE 锁名额 → 豆抵扣即扣 → 建单(10)。beanHooks 由路由层注入旅豆域。 */
export async function place({ userId, sessionId, qty, wantedBeans, promoScene, withInsurance, beanHook }) {
  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sessionId])
  if (!s || s.status !== 1) throw new BizError(2001, '团期不可报名')
  const goods = priceForSession(s).price * qty
  // 出行保险（P2）：产品级保费 × 人数，并入实付（保费不入商户结算与佣金基数）
  const prod = await one('SELECT insurance_fee, insurance_note FROM tour_product WHERE id = ?', [s.product_id])
  const insFee = withInsurance && prod && Number(prod.insurance_fee) > 0 ? Number(prod.insurance_fee) * qty : 0
  const clampCap = Math.floor((goods * (await cfgNum('bean.deduct_max_pct'))) / 10) // 豆数上限（10 豆=1 元）
  const beans = Math.max(0, Math.min(wantedBeans || 0, clampCap))
  const dedFen = beans * 10
  const pay = goods - dedFen + insFee
  // 单号 = WL + 日期 + 毫秒时间戳后8位 + 2位随机（快速下单不碰撞；生产可换发号器）
  const suffix = String(Date.now() % 100000000).padStart(8, '0') + String(Math.floor(Math.random() * 90) + 10)
  const orderNo = 'WL' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + suffix

  await tx(async (c) => {
    const n = await c.upd('UPDATE tour_session SET booked = booked + ? WHERE id = ? AND booked + ? <= quota', [qty, sessionId, qty])
    if (n !== 1) throw new BizError(2001, '名额不足')
    await c.ins(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty,
        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene, insurance_fee)
        SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,?,? FROM tour_product p WHERE p.id = ?`,
      [orderNo, userId, s.product_id, sessionId, qty, goods, dedFen, beans, pay, promoScene || null, insFee, s.product_id])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES ((SELECT id FROM orders WHERE order_no = ?),0,10,?,?)',
      [orderNo, 'user:' + userId, JSON.stringify('下单占位')])
  })
  if (beans > 0 && beanHook) await beanHook.deduct(userId, beans, orderNo)
  return { orderNo, amountPay: pay, beanDeducted: beans, insuranceFee: insFee,
    insuranceNote: insFee > 0 ? prod.insurance_note : null }
}

export async function byNo(orderNo) { return await one('SELECT * FROM orders WHERE order_no = ?', [orderNo]) }

/** 超时关单（分钟级定时任务） */
export async function closeTimeout() {
  const mins = await cfgNum('order.pay_timeout')
  const stale = await q('SELECT id, order_no, session_id, qty FROM orders WHERE status = 10 AND created_at < NOW() - INTERVAL ? MINUTE', [mins])
  for (const o of stale) {
    await tx(async (c) => {
      const n = await c.upd('UPDATE orders SET status = 90, version = version + 1 WHERE id = ? AND status = 10', [o.id])
      if (n === 1) {
        await c.upd('UPDATE tour_session SET booked = booked - ? WHERE id = ?', [o.qty, o.session_id])
        await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,10,90,?,?)', [o.id, 'system', JSON.stringify('超时关单·名额释放')])
      }
    })
  }
  return stale.length
}
