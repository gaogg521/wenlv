// D-05 指标修正 v5（最终版）：MOCK 模式下 POST /c/orders 会自动出票到 30（jsapiOrder 1.2s 自动回调），
// 「下单不支付」无法走接口制造——改 SQL 直落库（demo-seed-20261104 先例）：
//   1) 删除 v4 已被自动出票的 B 组单（status=30，连带 pass/payment/order_event/notify_log），专用团期 booked 清零；
//   2) SQL 直插 status=10 未支付单（created_at=NOW，15 分钟后关单 job fire CLOSE_TIMEOUT 置 90 + 补 order_event + 释放名额）。
//   3) 转化口径（paid/created，created 在统计周期内）随关单落位。
// 守卫：显式 DB_NAME + ALLOW_DESTRUCTIVE；仅对 wanderlust 演示库或 wanderlust_qa_* 隔离库。
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
const db = process.env.DB_NAME
if (!db || !process.env.ALLOW_DESTRUCTIVE || (db !== 'wanderlust' && !db.startsWith('wanderlust_qa_'))) {
  console.error('[拒绝] 需显式 DB_NAME（wanderlust 或 wanderlust_qa_*）+ ALLOW_DESTRUCTIVE=1')
  process.exit(2)
}
const APPLY = process.argv.includes('--apply')
const PREFIX = '演示样例·分布1118-未支付'
const TAG = '分布1118'
const pct = (a, b) => (b ? Math.round(Number(a) / Number(b) * 1000) / 10 + '%' : '—')

const metrics = await one(`SELECT COUNT(*) created, COALESCE(SUM(status BETWEEN 20 AND 70), 0) paid,
  (SELECT COUNT(*) FROM (SELECT user_id FROM orders WHERE status IN (20,30,40,50) GROUP BY user_id HAVING COUNT(*) > 1) t) rebuyers,
  (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status IN (20,30,40,50)) payers,
  (SELECT COALESCE(SUM(status IN (60,70)), 0) FROM orders) refunded,
  (SELECT COUNT(*) FROM orders WHERE contact_name LIKE '${PREFIX}%' AND status = 30) b_ticketed,
  (SELECT COUNT(*) FROM orders WHERE contact_name LIKE '${PREFIX}%' AND status = 10) b_pending FROM orders`)
console.log(`当前：下单 ${metrics.created} · 转化 ${pct(metrics.paid, metrics.created)} · 复购 ${pct(metrics.rebuyers, metrics.payers)} · B 组已出票 ${metrics.b_ticketed} · B 组在途 ${metrics.b_pending}`)
const paid = Number(metrics.paid), created = Number(metrics.created), rebuyers = Number(metrics.rebuyers), payers = Number(metrics.payers)
// 目标：转化 88%（未支付单只进分母）+ 复购 30%（A 组一次性买家已到位）
// B 组目标数 = ceil(paid / 0.88) - created + 现存 B 组单（要删的 30 单也在 created 里）
const needTotal = Math.ceil(paid / 0.88)
const needNew = Math.max(0, needTotal - (created - Number(metrics.b_ticketed)))
console.log(`目标转化 88%：需未支付单 ${needNew} 笔（删 ${metrics.b_ticketed} 出票单后重建）`)

if (!APPLY) { console.log('【预检模式】加 --apply 执行'); await closeDb(); process.exit(0) }

// 1) 删除已出票的 B 组单（连同子表）；专用团期 booked 清零
const ticketed = await q(`SELECT id, order_no FROM orders WHERE contact_name LIKE '${PREFIX}%' AND status = 30`)
if (ticketed.length) {
  const ids = ticketed.map((t) => Number(t.id))
  const inList = ids.join(',')
  // notify_log 是 V91 新表——8080 演示库 schema 未升级时不存在，跳过
  await q(`DELETE FROM notify_log WHERE biz_ref IN (${ticketed.map((t) => '?').join(',')})`, ticketed.map((t) => t.order_no)).catch(() => {})
  await q(`DELETE FROM travel_pass WHERE order_id IN (${inList})`)
  await q(`DELETE FROM payment WHERE order_id IN (${inList})`)
  await q(`DELETE FROM order_event WHERE order_id IN (${inList})`)
  await q(`DELETE FROM orders WHERE id IN (${inList})`)
  await q(`UPDATE tour_session s JOIN tour_product p ON p.id = s.product_id SET s.booked = 0
    WHERE s.depart_date = DATE_ADD(CURDATE(), INTERVAL 300 DAY)
      AND JSON_UNQUOTE(JSON_EXTRACT(s.profile, '$.note')) = '演示样例·分布1118专用'`)
  console.log(`已删除出票的 B 组单 ${ticketed.length} 笔（连带 pass/payment/event/notify），专用团期 booked 清零`)
}

// 2) SQL 直插 status=10 未支付单（每在售商品一批，分摊产品；created_at=NOW → 15 分钟后被关单 job 置 90）
const products = await q(`SELECT p.id, p.merchant_id, p.city_code, p.price_from, p.title,
  (SELECT s.id FROM tour_session s WHERE s.product_id = p.id AND s.depart_date = DATE_ADD(CURDATE(), INTERVAL 300 DAY)
     AND JSON_UNQUOTE(JSON_EXTRACT(s.profile, '$.note')) = '演示样例·分布1118专用' LIMIT 1) session_id,
  (SELECT o.user_id FROM orders o WHERE o.contact_name LIKE '演示样例·分布1118-买家%' LIMIT 1) buyer_id
  FROM tour_product p WHERE p.status = 1`)
assert.ok(products.length && products[0].session_id && products[0].buyer_id, '专用团期或买家缺失（先跑 v4）')
let made = 0
const total = needNew
for (let i = 0; i < total; i++) {
  const p = products[i % products.length]
  const no = 'DPDT' + TAG + String(Date.now()).slice(-8) + String(i).padStart(5, '0')
  await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, channel, city_code, status, qty,
      amount_goods, amount_pay, contact_name, contact_phone_sealed, created_at, version)
    VALUES (?, ?, ?, ?, ?, 'main', ?, 10, 1, ?, ?, ?, 0x00, NOW(3), 0)`,
    [no, p.buyer_id, p.id, p.session_id, p.merchant_id, p.city_code, p.price_from, p.price_from,
      PREFIX + String(i).padStart(4, '0')])
    .catch(async () => {
      // 列差异兜底：去掉 contact_phone_sealed / channel
      return q(`INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, city_code, status, qty,
        amount_goods, amount_pay, contact_name, created_at, version)
      VALUES (?, ?, ?, ?, ?, ?, 10, 1, ?, ?, ?, NOW(3), 0)`,
        [no, p.buyer_id, p.id, p.session_id, p.merchant_id, p.city_code, p.price_from, p.price_from, PREFIX + String(i).padStart(4, '0')])
    })
  const oid = (await one('SELECT id FROM orders WHERE order_no = ?', [no])).id
  await q(`INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?, 0, 10, 'user:demo-tune', '"下单（分布修正）"')`, [oid])
  made++
  if (made % 200 === 0) console.log(`  已插入 ${made}/${total}`)
}
console.log(`已直插未支付单 ${made} 笔（status=10，15 分钟后关单 job 自动置 90）`)

const after = await one(`SELECT COUNT(*) created, COALESCE(SUM(status BETWEEN 20 AND 70), 0) paid,
  (SELECT COUNT(*) FROM (SELECT user_id FROM orders WHERE status IN (20,30,40,50) GROUP BY user_id HAVING COUNT(*) > 1) t) rebuyers,
  (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status IN (20,30,40,50)) payers,
  (SELECT COALESCE(SUM(status IN (60,70)), 0) FROM orders) refunded,
  (SELECT COUNT(*) FROM orders WHERE status = 10) waiting FROM orders`)
console.log(`\n执行后：下单 ${after.created} · 转化 ${pct(after.paid, after.created)} · 复购 ${pct(after.rebuyers, after.payers)} · 退款占 ${pct(after.refunded, after.created)} · 在途 ${after.waiting}`)
console.log('15 分钟后关单 job 自动关闭（转化将落位 ~88%）；随后清理专用团期：')
console.log(`  DELETE FROM tour_session WHERE JSON_UNQUOTE(JSON_EXTRACT(profile, '$.note')) = '演示样例·分布1118专用';`)
await closeDb()
