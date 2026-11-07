// 退款域：全量退款 + 全量冲正（路由 /c/orders/:no/refund 与拼团未成团自动取消共用同一套）
import { q, one, tx, BizError } from '../db.mjs'
import * as order from './order.mjs'
import * as bean from './bean.mjs'
import * as pass from './pass.mjs'
import * as promo from './promo.mjs'
import * as wxpay from './wxpay.mjs'
import { attest } from './attest.mjs'
import { cfg } from '../config.mjs'
import * as policy from './refund-policy.mjs'

/**
 * 退款试算（游客自助退款前展示，与真正扣费同一函数）
 * 仅"已支付、未核销"可自助退；按 order.refund_policy 梯度计算手续费
 */
export async function quoteFor(o) {
  if (![20, 30].includes(Number(o.status))) {
    return { allowed: false, reason: Number(o.status) === 40 ? '凭证已核销，如需售后请联系客服' : '当前状态不可退款' }
  }
  const s = await one('SELECT depart_date FROM tour_session WHERE id = ?', [o.session_id])
  if (!s) return { allowed: false, reason: '团期不存在，请联系客服' }
  const q = policy.quote({ policy: await cfg('order.refund_policy'), amountPayFen: Number(o.amount_pay), departDate: s.depart_date })
  return { ...q, departDate: String(s.depart_date).slice(0, 10), amountPayFen: Number(o.amount_pay), beanReturn: Number(o.bean_deducted) || 0 }
}

/**
 * 原路退款：refunds 落单 → 状态机 60 → wxpay → 70 + 豆/凭证/佣金全量冲正
 * @param applyPolicy true=游客自助（按梯度扣手续费，不满足档位直接拒绝）；
 *                    false=全额（未成团等平台原因、客服后台处理，均留审计）
 */
export async function refundOrder({ orderNo, reason, operator = 'user', applyPolicy = false, closeReason = null }) {
  const o = await order.byNo(orderNo)
  if (!o) throw new BizError(2003, '订单不存在')
  if (![20, 30, 40].includes(Number(o.status))) throw new BizError(2002, '当前状态不可退款')
  const total = Number(o.amount_pay)
  let refundFen = total, feeFen = 0, feeRate = null, days = null
  if (applyPolicy) {
    const q = await quoteFor(o)
    policy.assertAllowed(q)
    refundFen = q.refundFen; feeFen = q.feeFen; feeRate = q.rate; days = q.daysToDepart
  }
  const refundNo = 'RF' + Date.now()
  // A-14：close_reason 随退款单落库——异步退款（PROCESSING→补偿任务完成）也能把 close_reason 写进订单，
  // 未成团单不再因为"同步路径才写 close_reason"而永久失去改签资格
  await q(`INSERT INTO refunds (order_id, refund_no, amount, fee_amount, fee_rate, days_to_depart, reason, status, operator, close_reason) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [o.id, refundNo, refundFen, feeFen, feeRate, days, reason, 0, operator, closeReason])
  // 退款申请即锚定（version 0）；后续成功(2)/拒绝(3)各锚一次，形成状态演进链
  await attest('refund', refundNo, {
    refundNo, orderNo, amount: refundFen, feeAmount: feeFen, feeRate, daysToDepart: days, status: 0, operator,
  }, null, 0)
  await order.fire(orderNo, 'REFUND_APPLY', operator)
  // 手续费 100% 的档位在试算阶段已拒绝；实付为 0（全旅豆抵扣）时无需调微信
  const wxr = refundFen > 0
    ? await wxpay.refund({ orderNo, refundNo, amountFen: refundFen, totalFen: total, reason })
    : { status: 'SUCCESS' }
  if (wxr.status !== 'SUCCESS') return { refunded: false, processing: true, wxRefund: wxr.status, refundNo, refundFen, feeFen }
  return { ...(await complete(o, refundNo, reason, wxr.status)), refundNo, refundFen, feeFen, feeRate }
}

/** 兼容旧调用：全额退款 */
export const fullRefund = (args) => refundOrder({ ...args, applyPolicy: false })

async function complete(o, refundNo, reason, status) {
  const orderNo = o.order_no
  const rf = await one('SELECT amount, fee_amount, fee_rate, close_reason FROM refunds WHERE refund_no = ?', [refundNo])
  const previous = Number(o.status) === 60 ? await one('SELECT from_st FROM order_event WHERE order_id=? AND to_st=60 ORDER BY id DESC LIMIT 1',[o.id]) : {from_st:o.status}
  await order.fire(orderNo, 'REFUND_SUCCESS', 'system', async (cc) => {
    if (Number(o.bean_deducted) > 0) await bean.reverse(Number(o.user_id), Number(o.bean_deducted), orderNo, cc)
    await cc.upd('UPDATE travel_pass SET status=4 WHERE order_id=?', [o.id])
    await cc.upd('UPDATE commission SET status=CASE WHEN status=2 THEN 3 ELSE 4 END WHERE order_id=?', [o.id])
    if ([20,30].includes(Number(previous?.from_st))) await cc.upd('UPDATE tour_session SET booked=GREATEST(0,booked-?) WHERE id=?', [o.qty,o.session_id])
    await cc.upd('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
    await cc.upd('UPDATE payment SET status = 4 WHERE order_id = ?', [o.id])
    await attest('refund', refundNo, {
      refundNo, orderNo, amount: Number(rf ? rf.amount : o.amount_pay), feeAmount: Number(rf ? rf.fee_amount : 0),
      feeRate: rf && rf.fee_rate != null ? Number(rf.fee_rate) : null, status: 2, reason: reason || null,
    }, cc, 2)
    return reason + (rf && Number(rf.fee_amount) > 0 ? '·扣手续费 ' + (Number(rf.fee_amount) / 100).toFixed(2) + ' 元' : '·全额') + '·冲正'
  })
  // A-14：close_reason 在 fire 之外补写（fire 的监听器里状态还没变 70，条件更新会落空）
  if (rf && rf.close_reason) {
    await q("UPDATE orders SET close_reason = ? WHERE order_no = ? AND status = 70 AND (close_reason IS NULL OR close_reason = '')", [rf.close_reason, orderNo])
  }
  return { refunded: true, wxRefund: status }
}

/** 退款结果刷新（游客打开详情时 + 定时补偿任务 A-14 共用）：
 *  SUCCESS → 完成退款；PROCESSING → 保持 60；CLOSED → 退款单置 3（人工队列）+ 风险事件；
 *  ABNORMAL → 保持 0 可重试 + 风险事件；查询异常 → 只留日志，下一轮重试。 */
export async function refresh(orderNo) {
  const o = await order.byNo(orderNo)
  if (!o || Number(o.status) !== 60) return
  const rf = await one('SELECT * FROM refunds WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1', [o.id])
  if (!rf) return
  let result
  try {
    result = await wxpay.queryRefund(rf.refund_no)
  } catch (e) {
    console.error('[refund:query]', orderNo, rf.refund_no, e.message)
    return
  }
  if (result.status === 'SUCCESS') {
    if (result.out_trade_no === orderNo && Number(result.amount?.refund) === Number(rf.amount)) {
      await complete(o, rf.refund_no, rf.reason || '退款确认', result.status)
    } else {
      console.error('[refund:mismatch]', orderNo, rf.refund_no, JSON.stringify(result).slice(0, 200))
    }
    return
  }
  if (result.status === 'CLOSED') {
    await q('UPDATE refunds SET status = 3 WHERE refund_no = ?', [rf.refund_no])
    await q(`INSERT INTO risk_event (kind, severity, detail) VALUES ('refund_failed', 2, ?)`,
      [JSON.stringify(`退款被微信关闭（CLOSED）：订单 ${orderNo}，退款单 ${rf.refund_no}，需人工处理（重试或线下退款后登记）`)])
    await q('INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)',
      [o.id, o.status, o.status, 'system', JSON.stringify('退款失败（微信 CLOSED）·转人工，退款单 ' + rf.refund_no)])
    return
  }
  if (result.status === 'ABNORMAL') {
    await q(`INSERT INTO risk_event (kind, severity, detail) VALUES ('refund_failed', 2, ?)`,
      [JSON.stringify(`退款异常（ABNORMAL）：订单 ${orderNo}，退款单 ${rf.refund_no}，持续重试查询，超 24h 未恢复需人工介入`)])
    return
  }
  // PROCESSING / 其他：保持 60，等待下一轮
}
