// 一次性补丁：R2b 导出主体化（products/settlements 按主体过滤行）
const fs = require('fs')
const f = 'src/routes/admin.mjs'
let s = fs.readFileSync(f, 'utf8')
const eol = s.includes('\r\n') ? '\r\n' : '\n'
let n = 0
function rep(oldStr, newStr, label) {
  if (!s.includes(oldStr)) { console.error('MISS ' + label); process.exit(1) }
  s = s.replace(oldStr, newStr); n++
}

rep(`    } else if (what === 'products') {
      rows = await q(\`SELECT p.id, p.title, p.channel, p.city_code, p.cat, p.price_from, p.bean_gift, p.status, m.name merchant_name
        FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE 1=1 \${sc.sql.replace(/city_code/g, 'p.city_code')} ORDER BY p.id\`, sc.params)`,
`    } else if (what === 'products') {
      // V82 主体方：只导出授权行（商户=本店；景区=本景区商品），字段不含内部成本
      const subPX = subjectScope(a)
      let pxSql = '', pxParams = []
      if (a.role === 'merchant_partner') { if (!subPX.merchantId) return { name, filename: name + '-empty.csv', csv: '' }; pxSql = ' AND p.merchant_id = ?'; pxParams = [subPX.merchantId] }
      else if (a.role === 'scenic_partner') { if (!subPX.scenicId) return { name, filename: name + '-empty.csv', csv: '' }; pxSql = ' AND p.scenic_id = ?'; pxParams = [subPX.scenicId] }
      rows = await q(\`SELECT p.id, p.title, p.channel, p.city_code, p.cat, p.price_from, p.bean_gift, p.status, m.name merchant_name
        FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE 1=1 \${sc.sql.replace(/city_code/g, 'p.city_code')}\${pxSql} ORDER BY p.id\`, [...sc.params, ...pxParams])`,
  'products export')

rep(`    } else if (what === 'settlements') {
      rows = await q(\`SELECT s.id, m.name merchant_name, s.period, s.order_count, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained,
          s.fee_count, s.fee_total, s.fee_merchant, s.fee_platform, s.amt_fulfill + s.fee_merchant AS payable_to_merchant, s.status
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 \${sc.sql.replace(/city_code/g, 'm.city_code')} ORDER BY s.id DESC LIMIT 2000\`, sc.params)`,
`    } else if (what === 'settlements') {
      const subSX = subjectScope(a)
      if (a.role === 'scenic_partner') {
        // V82 主体方（景区）：与结算页同口径的投影行（本景区净额），无整单五口径与成本
        if (!subSX.scenicId) return { name, filename: name + '-empty.csv', csv: '' }
        rows = await q(\`SELECT s.id, m.name merchant_name, s.period, s.status,
          (SELECT COUNT(DISTINCT sl.order_id) FROM settlement_line sl JOIN orders o ON o.id = sl.order_id WHERE sl.settlement_id = s.id AND o.product_id IN (SELECT id FROM tour_product WHERE scenic_id = ?)) AS scenic_orders,
          (SELECT COALESCE(SUM(sl.net_fen),0) FROM settlement_line sl JOIN orders o ON o.id = sl.order_id WHERE sl.settlement_id = s.id AND o.product_id IN (SELECT id FROM tour_product WHERE scenic_id = ?)) AS scenic_net_fen
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id
        WHERE EXISTS (SELECT 1 FROM settlement_line sl2 JOIN orders o3 ON o3.id = sl2.order_id JOIN tour_product p3 ON p3.id = o3.product_id WHERE sl2.settlement_id = s.id AND p3.scenic_id = ?)
        ORDER BY s.id DESC LIMIT 2000\`, [subSX.scenicId, subSX.scenicId, subSX.scenicId])
      } else {
        let sxSql = '', sxParams = []
        if (a.role === 'merchant_partner') { if (!subSX.merchantId) return { name, filename: name + '-empty.csv', csv: '' }; sxSql = ' AND s.merchant_id = ?'; sxParams = [subSX.merchantId] }
        rows = await q(\`SELECT s.id, m.name merchant_name, s.period, s.order_count, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained,
          s.fee_count, s.fee_total, s.fee_merchant, s.fee_platform, s.amt_fulfill + s.fee_merchant AS payable_to_merchant, s.status
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 \${sc.sql.replace(/city_code/g, 'm.city_code')}\${sxSql} ORDER BY s.id DESC LIMIT 2000\`, [...sc.params, ...sxParams])
      }`,
  'settlements export')

fs.writeFileSync(f, s)
console.log('patched', n)
