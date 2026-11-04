// 演示库历史数据加厚（投资人演示用）：按月增长曲线补历史订单，含季节波动与爬坡。
// 守卫：仅演示库 + 显式放行；只 INSERT，不动既有行；目标 = 既有月度 GMV + 补足额。
import mysql from 'mysql2/promise'

if (process.env.ALLOW_DEMO_SEED !== '1' || process.env.DB_NAME !== 'wanderlust') {
  console.error('拒绝运行：需要 ALLOW_DEMO_SEED=1 且 DB_NAME=wanderlust')
  process.exit(1)
}
const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root', database: 'wanderlust' })
const q = async (sql, a = []) => (await c.query(sql, a))[0]
const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const pick = (arr, i = 0) => arr[(i || 0) % arr.length]

// 月度目标 GMV（元）：增长曲线 + 季节性（2月春节低谷、7-8月暑期、10月黄金周）
const TARGET = {
  12: 45000, 11: 68000, 10: 52000, 9: 38000, 8: 75000, 7: 88000,
  6: 105000, 5: 112000, 4: 148000, 3: 165000, 2: 138000, 1: 210000, 0: 48000, // 0=本月(至今)
}

const users = (await q('SELECT id FROM user_account WHERE status = 1')).map((r) => r.id)
// 再补 12 个演示用户，摊薄单人订单密度
for (let i = 0; i < 12; i++) {
  const [r] = await c.query('INSERT IGNORE INTO user_account (mini_a_openid, nickname, created_at) VALUES (?,?,NOW(3) - INTERVAL ? DAY)',
    ['demo-rich-' + Date.now().toString(36) + '-' + i, pick(['山野拾荒者', '古镇夜猫子', '茶室常客', '亲子营地家', 'CityWalker小鹿', '桨板少年', '背包客阿澄', '禅修旅行者', '美食漫游记', '铁腿背包客', '星空露营派', '汉服掌柜'], i) + (i + 1), ri(10, 300)])
  if (r.insertId) users.push(r.insertId)
}
const sessions = (await q(`SELECT s.id, s.price_adult, s.quota, s.booked, p.city_code, p.merchant_id, p.id pid
  FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.status = 1 AND p.channel = 'main'`))
const budgets = (await q('SELECT id FROM bean_budget WHERE status = 1'))[0]?.id || null

let seq = (await q("SELECT COUNT(*) n FROM orders WHERE order_no LIKE 'WLRICH%'"))[0].n
const totalTargets = []
let grandTotal = 0

async function addOrder(when, statusOverride) {
  const s = pick(sessions, ri(0, sessions.length - 1))
  const qty = ri(1, 3)
  const amount = s.price_adult * qty
  const st = statusOverride ?? pick([50, 50, 50, 40, 40, 30, 30, 20, 70], ri(0, 8))
  const paidAt = when
  const seqStr = String(++seq).padStart(5, '0')
  const no = 'WLRICH' + paidAt.slice(0, 10).replace(/-/g, '') + seqStr
  await c.query(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name, created_at, paid_at, completed_at, insurance_fee)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no, pick(users), s.pid, s.id, s.city_code, s.merchant_id, qty, amount, amount, st,
      pick(['王晓桐', '刘思远', '陈嘉禾', '杨慕青', '黄一鸣', '何雨桐', '赵星辰', '孙悦然', '吴悠', '林知夏'], seq),
      paidAt, paidAt, st === 50 ? paidAt : null, 200 * qty])
  if ([20, 30, 40, 50].includes(st)) await c.query('UPDATE tour_session SET booked = LEAST(quota, booked + ?) WHERE id = ?', [qty, s.id])
  // 出票：已核销/已完成给已核销票，已确认给待核销票（维持核销率 ~78%）
  if ([30, 40, 50].includes(st)) {
    for (let k = 0; k < qty; k++) {
      await c.query('INSERT INTO travel_pass (user_id, order_id, kind, name, product_id, status, created_at) VALUES (?,?,1,?,?,?,?)',
        [pick(users), 0, '主题游通行凭证·' + no.slice(0, 18), s.pid, st === 30 ? 1 : 2, paidAt])
    }
  }
  return amount
}

// ---------- 按月补足到目标 ----------
for (const [monthsAgo, targetYuan] of Object.entries(TARGET)) {
  const ma = Number(monthsAgo)
  const cur = (await q(`SELECT COALESCE(SUM(amount_pay),0) s, COUNT(*) n FROM orders
    WHERE status IN (20,30,40,50) AND paid_at IS NOT NULL
    AND YEAR(paid_at) = YEAR(NOW() - INTERVAL ? MONTH) AND MONTH(paid_at) = MONTH(NOW() - INTERVAL ? MONTH)`, [ma, ma]))[0]
  const curYuan = Number(cur.s) / 100
  let need = targetYuan - curYuan
  totalTargets.push({ month: ma, 目标: targetYuan, 既有: Math.round(curYuan), 新增订单: 0, 新增GMV: 0 })
  if (need <= 0) continue
  // 本月只补到"现在"之前的小时
  let added = 0, addedGmv = 0
  let guard = 0
  while (need > 0 && guard++ < 500) {
    const day = ma === 0 ? ri(0, 0) : ri(1, 27)
    const hour = ri(9, 21)
    const d = new Date()
    if (ma > 0) { d.setMonth(d.getMonth() - ma); d.setDate(Math.min(day, 27)) }
    d.setHours(hour, ri(0, 59), ri(0, 59), 0)
    if (d > new Date()) continue
    const paidAt = d.toISOString().slice(0, 19).replace('T', ' ')
    const amt = await addOrder(paidAt)
    added++; addedGmv += amt / 100; need -= amt / 100
  }
  totalTargets[totalTargets.length - 1]['新增订单'] = added
  totalTargets[totalTargets.length - 1]['新增GMV'] = Math.round(addedGmv)
  grandTotal += added
}

// ---------- 今日加密集单（8:00-现在，让"今日"卡有生气）----------
const todayCount = Number((await q("SELECT COUNT(*) n FROM orders WHERE status IN (20,30,40,50) AND DATE(paid_at) = CURDATE()"))[0].n)
let todayAdded = 0
for (let i = todayCount; i < 16; i++) {
  const d = new Date()
  d.setHours(ri(8, Math.max(9, new Date().getHours() - 1)), ri(0, 59), 0, 0)
  if (d > new Date()) d.setHours(9, ri(0, 59), 0, 0)
  await addOrder(d.toISOString().slice(0, 19).replace('T', ' '))
  todayAdded++
}

// ---------- 近 7 天逐日补量（爬坡：越近越多）----------
const weekFill = []
for (let i = 7; i >= 1; i--) {
  const dayTarget = 6 + (7 - i) * 2 // 8→20 单/天
  const day = new Date(Date.now() - i * 86400000)
  const ds = day.toISOString().slice(0, 10)
  const have = Number((await q('SELECT COUNT(*) n FROM orders WHERE status IN (20,30,40,50) AND DATE(paid_at) = ?', [ds]))[0].n)
  let add = 0
  for (let k = have; k < dayTarget; k++) {
    const d = new Date(ds + 'T00:00:00')
    d.setHours(ri(9, 21), ri(0, 59), 0, 0)
    await addOrder(d.toISOString().slice(0, 19).replace('T', ' '))
    add++
  }
  weekFill.push({ 日期: ds, 补单: add })
}

const monthTable = await q(`SELECT DATE_FORMAT(paid_at, '%Y-%m') m, COUNT(*) orders, ROUND(SUM(amount_pay)/100) yuan
  FROM orders WHERE status IN (20,30,40,50) AND paid_at IS NOT NULL GROUP BY m ORDER BY m`)
console.log('历史数据加厚完成：新增', grandTotal + todayAdded, '笔')
console.table(monthTable)
console.log('近7天补单:', JSON.stringify(weekFill))
await c.end()
