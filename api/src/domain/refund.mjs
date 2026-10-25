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
  await order.fire(orderNo, 'REFUND_SUCCESS', 'system', async (cc) => {
    if (Number(o.bean_deducted) > 0) await bean.reverse(Number(o.user_id), Number(o.bean_deducted), orderNo)
    await pass.revokeForOrder(orderNo)
    await promo.invalidateCommission(orderNo)
    await cc.upd('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
    await cc.upd('UPDATE payment SET status = 4 WHERE order_id = ?', [o.id])
    return reason + '·全量冲正'
  })
  return { refunded: true, wxRefund: wxr.status || 'MOCK' }
}
