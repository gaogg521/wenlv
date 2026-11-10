// 订单域（与 Java 版同一守卫表）：状态机 + 下单 + 支付编排
import { q, one, tx, count, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import { bookingOpen, bookingNow, bookingOpenSql } from './booking-window.mjs'
import * as bean from './bean.mjs'
import { attest } from './attest.mjs'

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

/** 早鸟价判定：出发前 early_days 天（含）之前报名享 early_price；未开启返回原价（总方案 §4）。
 *  取较低价兜底：历史上早鸟价可被改到高于现价（A-07），这里保证游客永远不会多付。
 *  A-34：天数按业务时区（bizdate）切日——此前 toISOString 取 UTC 日期，00:00–08:00 少算一天。 */
export function priceForSession(s) {
  const days = Math.floor((new Date(String(s.depart_date).slice(0, 10) + 'T00:00:00') - new Date(bizDay() + 'T00:00:00')) / 86400000)
  const adult = Number(s.price_adult)
  const earlyEligible = s.early_price != null && s.early_days != null && days >= Number(s.early_days)
  const early = earlyEligible ? Math.min(Number(s.early_price), adult) : adult
  return { price: early, isEarly: early !== adult, daysToDepart: days }
}

/** 下单：条件 UPDATE 锁名额 → 豆抵扣即扣 → 建单(10)。beanHooks 由路由层注入旅豆域。 */
export async function place({ userId, sessionId, qty, wantedBeans, promoScene, withInsurance, beanHook }) {
  if (withInsurance && process.env.NODE_ENV === 'production') throw new BizError(1001, '保险承保服务尚未接通，暂不可购买保险')
  if (!Number.isInteger(qty) || qty < 1 || qty > 9) throw new BizError(1001, '出行人数应为 1–9 人')
  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sessionId])
  if (!s || s.status !== 1) throw new BizError(2001, '团期不可报名')
  if (!bookingOpen(s.profile)) throw new BizError(2001, '该团期报名已截止')
  const goods = priceForSession(s).price * qty
  if (!(goods > 0)) throw new BizError(1001, '商品价格异常，暂不可下单') // A-07 兜底：负价/零价团期落库后不得出负金额订单
  // 出行保险（P2）：产品级保费 × 人数，并入实付（保费不入商户结算与佣金基数）
  const prod = await one('SELECT p.insurance_fee, p.insurance_note, p.status, m.status merchant_status FROM tour_product p JOIN merchant m ON m.id=p.merchant_id WHERE p.id = ?', [s.product_id])
  if (!prod || prod.status !== 1 || prod.merchant_status !== 1) throw new BizError(2001, '商品或商户已暂停营业')
  const insFee = withInsurance && prod && Number(prod.insurance_fee) > 0 ? Number(prod.insurance_fee) * qty : 0
  const clampCap = Math.floor((goods * (await cfgNum('bean.deduct_max_pct'))) / 10) // 豆数上限（10 豆=1 元）
  const beans = Math.max(0, Math.min(Math.floor(Number(wantedBeans) || 0), clampCap))
  const dedFen = beans * 10
  const pay = goods - dedFen + insFee
  if (!(pay > 0)) throw new BizError(1001, '订单金额异常，暂不可下单') // A-07 兜底
  // 单号 = WL + 业务日期 + 毫秒时间戳后8位 + 2位随机（快速下单不碰撞；生产可换发号器）
  // A-34：日期段用业务时区（此前 toISOString 取 UTC 日期，凌晨下单的订单号日期错一天）
  const suffix = String(Date.now() % 100000000).padStart(8, '0') + String(Math.floor(Math.random() * 90) + 10)
  const orderNo = 'WL' + bizDay().replaceAll('-', '') + suffix

  await tx(async (c) => {
    const n = await c.upd(`UPDATE tour_session s SET booked = booked + ? WHERE id = ? AND status=1 AND depart_date>=CURDATE() AND booked + ? <= quota AND ${bookingOpenSql('s')}`, [qty, sessionId, qty, bookingNow()])
    if (n !== 1) throw new BizError(2001, '名额不足')
    await c.ins(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty,
        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene, insurance_fee)
        SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,?,? FROM tour_product p WHERE p.id = ?`,
      [orderNo, userId, s.product_id, sessionId, qty, goods, dedFen, beans, pay, promoScene || null, insFee, s.product_id])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES ((SELECT id FROM orders WHERE order_no = ?),0,10,?,?)',
      [orderNo, 'user:' + userId, JSON.stringify('下单占位')])
    if (beans > 0) await bean.deduct(userId, beans, bean.BIZ.DEDUCT, orderNo, c)
  })
  return { orderNo, amountPay: pay, beanDeducted: beans, insuranceFee: insFee,
    insuranceNote: insFee > 0 ? prod.insurance_note : null }
}

export async function byNo(orderNo) { return await one('SELECT * FROM orders WHERE order_no = ?', [orderNo]) }

/** 事务内出票（acceptPayment 与免费改签共用）：凭证数校验 → 逐张建凭证 + 签发存证，全部在同一事务 */
export async function issuePassesInTx(c, o, orderNo) {
  const issued = await c.one('SELECT COUNT(*) c FROM travel_pass WHERE order_id=?', [o.id])
  if (Number(issued.c) > Number(o.qty)) throw new BizError(2002, '订单凭证数量异常')
  for (let i = Number(issued.c); i < Number(o.qty); i++) {
    const passId = await c.ins('INSERT INTO travel_pass(user_id,order_id,kind,name,product_id,status) VALUES(?,?,1,?,?,1)', [o.user_id, o.id, '主题游通行凭证·' + orderNo, o.product_id])
    // 凭证签发即锚定（与出票同事务）：这是主出票路径，pass.issueForOrder 只在拼团重开单时使用
    await attest('pass_issue', 'pass-' + passId, {
      passId: Number(passId), orderNo, kind: 1, qty: Number(o.qty),
      productId: Number(o.product_id), merchantId: Number(o.merchant_id), cityCode: o.city_code,
    }, c, 1)
  }
}

/** 支付入账、状态事件与出票在同一事务中提交；微信重试不会留下“有支付记录但无票”的半状态。 */
export async function acceptPayment(orderNo, transNo, mock = false) {
  if (!transNo) throw new BizError(1001, '缺少支付交易号')
  const days = await cfgNum('order.observe_days')
  return tx(async c => {
    const o = await c.one('SELECT * FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
    if (!o) throw new BizError(2003, '订单不存在')
    const transaction = await c.one('SELECT order_id FROM payment WHERE wx_trans_no = ?', [transNo])
    if (transaction && Number(transaction.order_id) !== Number(o.id)) throw new BizError(1001, '交易号已绑定其他订单')
    const paid = await c.one('SELECT id FROM payment WHERE order_id = ?', [o.id])
    if (paid && ![10,20].includes(Number(o.status))) return { ...o, duplicated: true }
    if (![10,20].includes(Number(o.status))) throw new BizError(2002, '订单已关闭或不在可支付状态，请人工核对支付')
    if (!paid) await c.q('INSERT INTO payment(order_id,wx_trans_no,amount,status,callback_at,raw_notify) VALUES(?,?,?,1,NOW(3),?)', [o.id,transNo,o.amount_pay,JSON.stringify({mock,orderNo,transNo})])
    if (Number(o.status) === 10) {
      await c.upd('UPDATE orders SET status=20,version=version+1,paid_at=NOW(3),refund_deadline=NOW(3)+INTERVAL ? DAY WHERE id=?', [days,o.id])
      await c.q('INSERT INTO order_event(order_id,from_st,to_st,actor,detail) VALUES(?,10,20,?,?)', [o.id,'system',JSON.stringify('支付回调 '+transNo)])
    }
    await issuePassesInTx(c, o, orderNo)
    await c.upd('UPDATE orders SET status=30,version=version+1 WHERE id=?', [o.id])
    await c.q('INSERT INTO order_event(order_id,from_st,to_st,actor,detail) VALUES(?,20,30,?,?)', [o.id,'system',JSON.stringify('确认出票·'+o.qty+'张凭证')])
    // 支付成功即订单存证（同事务，version=30）。此前订单事件只在"完成"时才有（version=50），后台"一单六锚"的"支付成功"一步
    // 在订单完成前是空的；canonical 与完成时同字段、只有 status 不同，白名单，不含个人信息
    await attest('order', orderNo, {
      orderNo, amountPay: Number(o.amount_pay), status: 30, merchantId: Number(o.merchant_id),
      qty: Number(o.qty), cityCode: o.city_code,
    }, c, 30)
    return { ...o, status:30, duplicated:false }
  })
}

/** 事务内关闭未支付单（A-03）：退抵扣旅豆 + 释放名额 + 事件审计。由 closeUnpaid / closeTimeout / 拼团取消共用。 */
export async function closeUnpaidInTx(c, o, closeReason, eventDetail, actor) {
  const n = await c.upd('UPDATE orders SET status = 90, close_reason = ?, version = version + 1 WHERE id = ? AND status = 10', [closeReason, o.id])
  if (n !== 1) return false // 并发下别人已关，幂等返回
  if (Number(o.bean_deducted) > 0) await bean.reverse(o.user_id, Number(o.bean_deducted), o.order_no, c)
  await c.upd('UPDATE tour_session SET booked = GREATEST(booked - ?, 0) WHERE id = ?', [o.qty, o.session_id])
  await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,10,90,?,?)', [o.id, actor, JSON.stringify(eventDetail)])
  // A-13：关单即关掉微信预支付单（防"关单后还能付"）。真实通道才调；失败只留日志，不阻断关单（微信侧过期时间兜底）
  if (Number(o.amount_pay) > 0) {
    const wxpay = await import('./wxpay.mjs')
    if (wxpay.isLive()) wxpay.closeOrder(o.order_no).catch((e) => console.error('[order:closeWx]', o.order_no, e.message))
  }
  return true
}

/** A-13 迟到支付：订单关闭后才到账的支付——入账留痕 + 风险事件 + 自动全额原路退回。
 *  此前回调直接抛"请人工核对支付"并 400：微信持续重试、钱收了没人知道。现在回调拿到成功响应。
 *  真实通道退款失败时 refunds 停在 0、有风险事件，由人工处理（不走 complete()，订单已是终态 90）。 */
export async function handleLatePayment(orderNo, transNo, mock = false) {
  const wxpay = await import('./wxpay.mjs')
  return await tx(async (c) => {
    const o = await c.one('SELECT * FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
    if (!o) throw new BizError(2003, '订单不存在')
    const dup = await c.one('SELECT id FROM payment WHERE wx_trans_no = ?', [transNo])
    if (dup) return { code: 0, duplicated: true }
    await c.q('INSERT INTO payment(order_id,wx_trans_no,amount,status,callback_at,raw_notify) VALUES(?,?,?,1,NOW(3),?)',
      [o.id, transNo, o.amount_pay, JSON.stringify({ late: true, orderNo, transNo })])
    await c.q(`INSERT INTO risk_event (kind, severity, detail) VALUES ('late_payment', 2, ?)`,
      [JSON.stringify(`迟到支付：订单 ${orderNo} 已关闭（status=${o.status}）后收到支付，交易号 ${transNo}，金额 ${o.amount_pay} 分，处理：自动全额原路退回`)])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)',
      [o.id, o.status, o.status, 'system', JSON.stringify('迟到支付·自动全额原路退回 ' + transNo)])
    const refundNo = 'RF' + Date.now()
    await c.q('INSERT INTO refunds (order_id, refund_no, amount, fee_amount, reason, status, operator) VALUES (?,?,?,?,?,0,?)',
      [o.id, refundNo, o.amount_pay, 0, '迟到支付·自动原路退回', 'system'])
    if (mock || !wxpay.isLive()) {
      await c.q('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
      await c.q('UPDATE payment SET status = 4 WHERE order_id = ? AND wx_trans_no = ?', [o.id, transNo])
      return { code: 0, late: true, refundNo, refunded: true }
    }
    // 真实通道：先落 0，事务外调微信，成功回写 2；失败留在 0 由人工处理（有风险事件）
    const wxr = await wxpay.refund({ orderNo, refundNo, amountFen: Number(o.amount_pay), totalFen: Number(o.amount_pay), reason: '迟到支付·自动退回' }).catch((e) => {
      console.error('[order:lateRefund]', orderNo, e.message)
      return { status: 'ERROR' }
    })
    if (wxr.status === 'SUCCESS') {
      await c.q('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
      await c.q('UPDATE payment SET status = 4 WHERE order_id = ? AND wx_trans_no = ?', [o.id, transNo])
      return { code: 0, late: true, refundNo, refunded: true }
    }
    await c.q(`INSERT INTO risk_event (kind, severity, detail) VALUES ('refund_failed', 2, ?)`,
      [JSON.stringify(`迟到支付自动退款失败：订单 ${orderNo}，退款单 ${refundNo}，微信状态 ${wxr.status}，需人工处理`)])
    return { code: 0, late: true, refundNo, refunded: false, wxRefund: wxr.status }
  })
}

/** 关闭单笔未支付订单（A-03）：返回 { closed } 或 { already: true }（幂等，重复调用不重复退豆） */
export async function closeUnpaid(orderNo, closeReason, actor = 'system', eventDetail = '关单·名额释放') {
  return await tx(async (c) => {
    const o = await c.one('SELECT * FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
    if (!o) throw new BizError(2003, '订单不存在')
    if (Number(o.status) !== ST.WAIT_PAY) return { order: o, already: true }
    const closed = await closeUnpaidInTx(c, o, closeReason, eventDetail, actor)
    return { order: { ...o, status: 90 }, closed, already: !closed }
  })
}

/** 超时关单（分钟级定时任务） */
export async function closeTimeout() {
  const mins = await cfgNum('order.pay_timeout')
  const stale = await q('SELECT id, order_no FROM orders WHERE status = 10 AND created_at < NOW() - INTERVAL ? MINUTE', [mins])
  for (const o of stale) {
    await closeUnpaid(o.order_no, 'pay_timeout', 'system', '超时关单·名额释放')
  }
  return stale.length
}

/** 取消免费改签单（A-01）：释放名额、订单关闭，不退款不退豆（改签单本就没收钱没抵豆） */
export async function cancelRebook(orderNo, actor = 'user') {
  return await tx(async (c) => {
    const o = await c.one('SELECT * FROM orders WHERE order_no = ? FOR UPDATE', [orderNo])
    if (!o) throw new BizError(2003, '订单不存在')
    if (!o.rebook_of) throw new BizError(2002, '仅免费改签订单可走此取消')
    if (![ST.PAID, ST.CONFIRMED].includes(Number(o.status))) throw new BizError(2002, '当前状态不可取消')
    const n = await c.upd('UPDATE orders SET status = 90, close_reason = ?, version = version + 1 WHERE id = ? AND status IN (20, 30)', ['rebook_cancel', o.id])
    if (n !== 1) throw new BizError(2002, '并发冲突')
    await c.upd('UPDATE tour_session SET booked = GREATEST(booked - ?, 0) WHERE id = ?', [o.qty, o.session_id])
    await c.upd('UPDATE travel_pass SET status = 4 WHERE order_id = ? AND status = 1', [o.id])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,90,?,?)', [o.id, o.status, actor, JSON.stringify('取消免费改签单·释放名额（不退款）')])
    return { ...o, status: 90 }
  })
}
