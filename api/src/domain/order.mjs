// 订单域（与 Java 版同一守卫表）：状态机 + 下单 + 支付编排
import { q, one, tx, count, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import { bookingOpen, bookingNow, bookingOpenSql } from './booking-window.mjs'
import * as bean from './bean.mjs'
import { attest } from './attest.mjs'
import { earlyInfo, priceSession, channelAllowed } from './discount.mjs'
import { json } from './sales.mjs'

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

/** 早鸟价判定（A-34 业务时区切日；A-07 取较低兜底）：委托 discount.earlyInfo，与折扣叠加试算同源。 */
export function priceForSession(s) {
  const e = earlyInfo(s)
  return { price: e.earlyUnitFen ?? e.originalFen, isEarly: e.eligible && e.earlyUnitFen !== e.originalFen, daysToDepart: e.days }
}

/** 下单：条件 UPDATE 锁名额 → 建单(10)。beanHooks 由路由层注入旅豆域。
 *  D01：有效商品价格＝早鸟/商品折扣统一试算（默认不叠加取低，开启先早鸟再折扣）；
 *  自由豆与旅豆同单可用、账本独立；自由豆门槛按有效商品金额判断；
 *  旅豆抵扣上限锚定最终实付（B ≤ r×X），余额不足按实际少抵；
 *  保费不打折、不凑门槛、不参与优惠。 */
export async function place({ userId, sessionId, qty, wantedBeans, promoScene, withInsurance, freedomRightId, beanHook, expectedGoodsFen }) {
  if (withInsurance && process.env.NODE_ENV === 'production') throw new BizError(1001, '保险承保服务尚未接通，暂不可购买保险')
  if (!Number.isInteger(qty) || qty < 1 || qty > 9) throw new BizError(1001, '出行人数应为 1–9 人')
  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sessionId])
  if (!s || s.status !== 1) throw new BizError(2001, '团期不可报名')
  if (!bookingOpen(s.profile)) throw new BizError(2001, '该团期报名已截止')
  // 出行保险（P2）：产品级保费 × 人数，并入实付（保费不入商户结算与佣金基数）
  const prod = await one('SELECT p.insurance_fee, p.insurance_note, p.status, p.merchant_id,p.city_code,p.channel,p.profile, m.status merchant_status FROM tour_product p JOIN merchant m ON m.id=p.merchant_id WHERE p.id = ?', [s.product_id])
  if (!prod || prod.status !== 1 || prod.merchant_status !== 1) throw new BizError(2001, '商品或商户已暂停营业')
  // B11 修复6：建单复用与列表/详情/试算同一渠道口径（此前建单未校验 visible_channels，可绕过列表直链下单）
  if (!channelAllowed(prod.profile, 'main')) throw new BizError(1004, '商品不存在或已下架')
  const insFee = withInsurance && prod && Number(prod.insurance_fee) > 0 ? Number(prod.insurance_fee) * qty : 0
  // 单号 = WL + 业务日期 + 毫秒时间戳后8位 + 2位随机（快速下单不碰撞；生产可换发号器）
  // A-34：日期段用业务时区（此前 toISOString 取 UTC 日期，凌晨下单的订单号日期错一天）
  const suffix = String(Date.now() % 100000000).padStart(8, '0') + String(Math.floor(Math.random() * 90) + 10)
  const orderNo = 'WL' + bizDay().replaceAll('-', '') + suffix
  const ctx = { product_id: s.product_id, city_code: prod.city_code, channel: prod.channel, depart_date: s.depart_date }

  return await tx(async (c) => {
    // 授权、首触、价格与优惠均在建单事务内确定；后续改规则/费率不改已售快照。
    const { orderSnapshot } = await import('./sales.mjs')
    const snapshot = await orderSnapshot(c, userId, s.product_id, promoScene)
    // 有效商品单价（早鸟/折扣统一试算，同事务内取生效规则，防止直链接口绕过）
    const pricing = await priceSession(s, ctx, bookingNow(), c)
    const goods = pricing.unitFen * qty
    if (!(goods > 0)) throw new BizError(1001, '商品价格异常，暂不可下单') // A-07 兜底：负价/零价团期落库后不得出负金额订单
    // 试算与建单之间价格上调必须显式刷新确认，不能悄悄提高应付（降价不拦，服务端价格始终为准）
    if (expectedGoodsFen != null && Number(expectedGoodsFen) < goods) throw new BizError(1001, '价格已更新，请刷新页面后重新提交')
    // 自由豆：先读券面额（同事务锁定），门槛由 reserve 按有效商品金额校验
    let freedomFace = 0
    if (freedomRightId) {
      const rightRow = await c.one('SELECT id, rule_json FROM freedom_right WHERE id=? AND user_id=? FOR UPDATE', [Number(freedomRightId), userId])
      if (rightRow) freedomFace = Number(json(rightRow.rule_json).discount) || 0
    }
    // 旅豆：同单可用；上限锚定最终实付 B ≤ r×X（X＝G−C−B）整数解；余额不足按实际少抵
    const maxPct = await cfgNum('bean.deduct_max_pct')
    const capBeans = bean.anchorCapBeans(goods, freedomFace, maxPct)
    let beans = Math.max(0, Math.min(Math.floor(Number(wantedBeans) || 0), capBeans))
    if (beans > 0) {
      const acc = await c.one('SELECT balance FROM bean_account WHERE user_id = ?', [userId])
      beans = Math.min(beans, acc ? Number(acc.balance) : 0)
    }
    const beanDedFen = beans * 10
    const freedom = await import('./freedom.mjs')
    const discount = await freedom.reserve(c, userId, freedomRightId, { ...prod, product_id: s.product_id, depart_date: s.depart_date, goods }, orderNo, insFee, beanDedFen)
    if (discount) freedomFace = discount.discount
    const pay = goods - freedomFace - beanDedFen + insFee
    if (!(pay > 0)) throw new BizError(1001, '订单金额异常，暂不可下单') // A-07 兜底
    const n = await c.upd(`UPDATE tour_session s SET booked = booked + ? WHERE id = ? AND status=1 AND depart_date>=CURDATE() AND booked + ? <= quota AND ${bookingOpenSql('s')}`, [qty, sessionId, qty, bookingNow()])
    if (n !== 1) throw new BizError(2001, '名额不足')
    await c.ins(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty,
        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene, insurance_fee, contribution_scenic_id)
        SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,?,?,COALESCE(p.scenic_id,0) FROM tour_product p WHERE p.id = ?`,
      [orderNo, userId, s.product_id, sessionId, qty, goods, beanDedFen, beans, pay, promoScene || null, insFee, s.product_id])
    await c.q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES ((SELECT id FROM orders WHERE order_no = ?),0,10,?,?)',
      [orderNo, 'user:' + userId, JSON.stringify('下单占位')])
    if (beans > 0) await bean.deduct(userId, beans, bean.BIZ.DEDUCT, orderNo, c)
    if (snapshot) await c.q('UPDATE orders SET promo_snapshot=? WHERE order_no=?', [JSON.stringify(snapshot), orderNo])
    // D01 价格快照：原价/早鸟/折扣规则版本与折数/自由豆/旅豆/保费/现金应付一次留痕，历史不随新配置改写
    const priceSnapshot = {
      version: 1, at: bookingNow(), qty,
      originalUnitFen: pricing.originalFen, originalGoodsFen: pricing.originalFen * qty,
      early: { eligible: pricing.earlyEligible, unitFen: pricing.earlyUnitFen, daysToDepart: pricing.daysToDepart },
      discount: pricing.rule ? {
        ruleId: pricing.rule.id, ruleVersion: pricing.rule.version, name: pricing.rule.name,
        discountBp: pricing.rule.discountBp, zhe: pricing.rule.zhe, stack: pricing.stack,
        type: pricing.type, unitFen: pricing.unitFen,
      } : null,
      priceType: pricing.type, effectiveUnitFen: pricing.unitFen, effectiveGoodsFen: goods,
      freedom: freedomFace > 0 ? { rightId: freedomRightId ? Number(freedomRightId) : null, discountFen: freedomFace } : null,
      beans: { count: beans, deductFen: beanDedFen, capBeans, anchorPctBp: Math.round(maxPct * 10000) },
      insuranceFen: insFee, cashPayFen: pay,
    }
    await c.q('UPDATE orders SET price_snapshot=? WHERE order_no=?', [JSON.stringify(priceSnapshot), orderNo])
    // B01 成本快照：按下单时点生效的供给项配置留痕；商品未维护成本保持 NULL（不可计算，绝不默认 0）
    const { orderCostSnapshot } = await import('./supply.mjs')
    const cost = await orderCostSnapshot(s.product_id, qty, bizDay(), c)
    await c.q('UPDATE orders SET cost_snapshot=?, cost_total_fen=? WHERE order_no=?',
      [cost ? JSON.stringify(cost) : null, cost ? cost.totalFen : null, orderNo])
    // B02/B04/B17：套餐产品生成订单项快照（三路占比分摊、尾差归最后正额项、项成本独立快照）
    const pkg = await import('./package.mjs')
    const orderItems = await pkg.buildOrderItemsInTx(c, { orderNo, productId: s.product_id, qty, goodsFen: goods, freedomFen: freedomFace, beanFen: beanDedFen })
    return { orderNo, amountPay: pay, freedomDiscount: freedomFace, beanDeducted: beans, insuranceFee: insFee,
      insuranceNote: insFee > 0 ? prod.insurance_note : null,
      pricing: { priceType: pricing.type, effectiveUnitFen: pricing.unitFen, goodsFen: goods, originalGoodsFen: pricing.originalFen * qty },
      orderItems }
  })
}

export async function byNo(orderNo) { return await one('SELECT * FROM orders WHERE order_no = ?', [orderNo]) }

/** 事务内出票（acceptPayment 与免费改签共用）：凭证数校验 → 逐张建凭证 + 签发存证，全部在同一事务。
 *  B02/B03：套餐订单按订单项出票（按人凭证项 pass_total 张、凭证挂项），无项产品保持原整单出票。 */
export async function issuePassesInTx(c, o, orderNo) {
  const items = await c.q('SELECT * FROM order_item WHERE order_id = ? AND kind = 1 ORDER BY id', [o.id])
  if (items.length) {
    const total = items.reduce((a, i) => a + Number(i.pass_total), 0)
    const issued = await c.one('SELECT COUNT(*) c FROM travel_pass WHERE order_id=?', [o.id])
    if (Number(issued.c) > total) throw new BizError(2002, '订单凭证数量异常')
    let issuedAll = Number(issued.c)
    for (const it of items) {
      const mine = await c.one('SELECT COUNT(*) c FROM travel_pass WHERE order_item_id=?', [it.id])
      for (let k = Number(mine.c); k < Number(it.pass_total); k++) {
        const passId = await c.ins('INSERT INTO travel_pass(user_id,order_id,kind,name,product_id,status,order_item_id) VALUES(?,?,1,?,?,1,?)',
          [o.user_id, o.id, escItemName(it.name) + '·凭证' + (k + 1) + '·' + orderNo, o.product_id, it.id])
        await attest('pass_issue', 'pass-' + passId, {
          passId: Number(passId), orderNo, kind: 1, qty: total, orderItemId: Number(it.id), itemMerchantId: Number(it.merchant_id),
          productId: Number(o.product_id), merchantId: Number(o.merchant_id), cityCode: o.city_code,
        }, c, 1)
        issuedAll++
      }
    }
    if (issuedAll !== total) throw new BizError(2002, '套餐凭证数量不平（' + issuedAll + '/' + total + '）')
    return
  }
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
const escItemName = n => String(n || '套餐项').replace(/[\r\n<>&"']/g, '').slice(0, 60)

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
      await (await import('./freedom.mjs')).paid(c,o)
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
  await (await import('./freedom.mjs')).release(c,o)
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
