// 退款域：全量退款 + 全量冲正（路由 /c/orders/:no/refund 与拼团未成团自动取消共用同一套）
import { q, one, tx, BizError } from '../db.mjs'
import * as order from './order.mjs'
import * as bean from './bean.mjs'
import * as pass from './pass.mjs'
import * as promo from './promo.mjs'
import * as wxpay from './wxpay.mjs'

/** 全额原路退款：refunds 落单 → 状态机 60 → wxpay(MOCK 自动成功) → 70 + 豆/凭证/佣金全量冲正 */
export async function fullRefund({ orderNo, reason, operator = 'user' }) {
  const o = await order.byNo(orderNo)
  if (!o) throw new BizError(2003, '订单不存在')
  if (![20, 30, 40].includes(Number(o.status))) throw new BizError(2002, '当前状态不可退款')
  const refundNo = 'RF' + Date.now()
  await q(`INSERT INTO refunds (order_id, refund_no, amount, reason, status, operator) VALUES (?,?,?,?,0,?)`,
    [o.id, refundNo, o.amount_pay, reason, operator])
  await order.fire(orderNo, 'REFUND_APPLY', operator)
  const wxr = await wxpay.refund({ orderNo, refundNo, amountFen: Number(o.amount_pay), totalFen: Number(o.amount_pay), reason })
  if (wxr.status !== 'SUCCESS') return { refunded: false, processing: true, wxRefund: wxr.status, refundNo }
  return complete(o, refundNo, reason, wxr.status)
}

async function complete(o, refundNo, reason, status) {
  const orderNo = o.order_no
  const previous = Number(o.status) === 60 ? await one('SELECT from_st FROM order_event WHERE order_id=? AND to_st=60 ORDER BY id DESC LIMIT 1',[o.id]) : {from_st:o.status}
  await order.fire(orderNo, 'REFUND_SUCCESS', 'system', async (cc) => {
    if (Number(o.bean_deducted) > 0) await bean.reverse(Number(o.user_id), Number(o.bean_deducted), orderNo, cc)
    await cc.upd('UPDATE travel_pass SET status=4 WHERE order_id=?', [o.id])
    await cc.upd('UPDATE commission SET status=CASE WHEN status=2 THEN 3 ELSE 4 END WHERE order_id=?', [o.id])
    if ([20,30].includes(Number(previous?.from_st))) await cc.upd('UPDATE tour_session SET booked=GREATEST(0,booked-?) WHERE id=?', [o.qty,o.session_id])
    await cc.upd('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
    await cc.upd('UPDATE payment SET status = 4 WHERE order_id = ?', [o.id])
    return reason + '·全量冲正'
  })
  return { refunded: true, wxRefund: status }
}

export async function refresh(orderNo) {
  const o = await order.byNo(orderNo)
  if (!o || Number(o.status) !== 60) return
  const rf = await one('SELECT * FROM refunds WHERE order_id = ? AND status = 0 ORDER BY id DESC LIMIT 1', [o.id])
  if (!rf) return
  const result = await wxpay.queryRefund(rf.refund_no)
  if (result.status === 'SUCCESS' && result.out_trade_no === orderNo && Number(result.amount?.refund) === Number(rf.amount)) await complete(o, rf.refund_no, rf.reason || '退款确认', result.status)
}
