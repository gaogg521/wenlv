# -*- coding: utf-8 -*-
# P2 保险挂载：下单含保费 + 佣金/结算基数扣保费 + 注册 mApply 路由表
import io

# ---- routes.mjs：注册 mApply ----
p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()
old = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...callback }"
assert old in s
s = s.replace(old, "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...mApply, ...callback }")

# POST /c/orders：接收 insurance 勾选传给 place
old2 = "    const r = await order.place({\n      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene,\n      beanHook: { deduct: (uid, beans, orderNo) => bean.deduct(uid, beans, bean.BIZ.DEDUCT, orderNo) },\n    })"
assert old2 in s
s = s.replace(old2, "    const r = await order.place({\n      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene, withInsurance: !!req.body.insurance,\n      beanHook: { deduct: (uid, beans, orderNo) => bean.deduct(uid, beans, bean.BIZ.DEDUCT, orderNo) },\n    })")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---- order.mjs：place 保费 ----
p = 'src/domain/order.mjs'
s = io.open(p, encoding='utf-8').read()
old = "export async function place({ userId, sessionId, qty, wantedBeans, promoScene, beanHook }) {\n  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sessionId])\n  if (!s || s.status !== 1) throw new BizError(2001, '团期不可报名')\n  const goods = priceForSession(s).price * qty"
assert old in s
s = s.replace(old, """export async function place({ userId, sessionId, qty, wantedBeans, promoScene, withInsurance, beanHook }) {
  const s = await one('SELECT * FROM tour_session WHERE id = ?', [sessionId])
  if (!s || s.status !== 1) throw new BizError(2001, '团期不可报名')
  const goods = priceForSession(s).price * qty
  // 出行保险（P2）：产品级保费 × 人数，并入实付（保费不入商户结算与佣金基数）
  const prod = await one('SELECT insurance_fee, insurance_note FROM tour_product WHERE id = ?', [s.product_id])
  const insFee = withInsurance && prod && Number(prod.insurance_fee) > 0 ? Number(prod.insurance_fee) * qty : 0""")
old2 = "  const pay = goods - dedFen"
assert old2 in s
s = s.replace(old2, "  const pay = goods - dedFen + insFee")
old3 = "        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene)\n        SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,? FROM tour_product p WHERE p.id = ?`,\n      [orderNo, userId, s.product_id, sessionId, qty, goods, dedFen, beans, pay, promoScene || null, s.product_id])"
assert old3 in s
s = s.replace(old3, "        amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene, insurance_fee)\n        SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,?,? FROM tour_product p WHERE p.id = ?`,\n      [orderNo, userId, s.product_id, sessionId, qty, goods, dedFen, beans, pay, promoScene || null, insFee, s.product_id])")
old4 = "  return { orderNo, amountPay: pay, beanDeducted: beans }"
assert old4 in s
s = s.replace(old4, "  return { orderNo, amountPay: pay, beanDeducted: beans, insuranceFee: insFee,\n    insuranceNote: insFee > 0 ? prod.insurance_note : null }")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---- promo.mjs：佣金/结算基数扣保费 ----
p = 'src/domain/promo.mjs'
s = io.open(p, encoding='utf-8').read()
old = "  const o = await one('SELECT id, promo_scene, amount_pay, bean_deducted FROM orders WHERE order_no = ?', [orderNo])"
assert old in s
s = s.replace(old, "  const o = await one('SELECT id, promo_scene, amount_pay, bean_deducted, insurance_fee FROM orders WHERE order_no = ?', [orderNo])")
old = "  const base = Number(o.amount_pay) - Number(o.bean_deducted) * 10"
assert old in s
s = s.replace(old, "  const base = Number(o.amount_pay) - Number(o.bean_deducted) * 10 - Number(o.insurance_fee || 0) // 保费直付保险方，不计佣")
old = "  const orders = await q(`SELECT o.id, o.amount_pay, COALESCE(SUM(c.amount),0) AS promo_amt\n    FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2)\n    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id IS NULL GROUP BY o.id, o.amount_pay`, [merchantId])"
assert old in s
s = s.replace(old, "  const orders = await q(`SELECT o.id, o.amount_pay - o.insurance_fee AS amount_pay, COALESCE(SUM(c.amount),0) AS promo_amt\n    FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2)\n    WHERE o.merchant_id = ? AND o.status = 50 AND o.settlement_id IS NULL GROUP BY o.id`, [merchantId])")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('insurance patched OK')
