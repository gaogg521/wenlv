import { one, BizError } from '../db.mjs'
import { bookingOpen } from './booking-window.mjs'

export async function purchaseInventory({ productId, sessionId }) {
  if (Boolean(productId) === Boolean(sessionId)) throw new BizError(1001, '请选择商品或预约时段')
  const stock = Boolean(productId)
  const row = await one(`SELECT s.*, p.cat, p.city_code, p.channel, p.profile product_profile,
    p.merchant_id, p.insurance_fee, p.price_from stock_price, p.status product_status, m.status merchant_status
    FROM tour_session s JOIN tour_product p ON p.id = s.product_id JOIN merchant m ON m.id = p.merchant_id
    WHERE ${stock ? "s.stock_product_id = ? AND p.cat = 'shop'" : `s.id = ? AND s.depart_date >= CURDATE()
      AND NOT EXISTS (SELECT 1 FROM tour_session i WHERE i.stock_product_id = p.id)`}`,
  [stock ? productId : sessionId])
  if (!row || Number(row.status) !== 1 || Number(row.product_status) !== 1 || Number(row.merchant_status) !== 1 ||
      (!stock && !bookingOpen(row.profile))) throw new BizError(2001, stock ? '商品不可购买' : '团期或预约时段不可售')
  if (stock) row.price_adult = row.stock_price
  return row
}
