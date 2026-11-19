// 订单事件时间线二次修正（验收人，2026-11-19）。纯数据修正，不触发存证（触发器只在 attest_* 表）。
// 背景：GLM 二轮项5 的重排只覆盖 D-05 触动的 9,381 单，且「核销=完成时刻-1小时」没做先后校验，验收发现：
//   · 644 单的核销/补登事件早于下单时间（先核销后下单）；其中 288 单订单本身 completed_at 早于 paid_at（2024 年老数据，完成时刻写成了出行日 21:30）；
//   · 5 条退款完成事件晚于当前时刻（最晚 11-20 13:20）；
//   · 65 单（11-08/09 批）下单与支付事件仍比订单时间晚 40 分钟以上。
// 做法（单事务）：
//   A. 订单 completed_at < paid_at 的，completed_at 改为 paid_at + 2 小时（只动这 288 单，paid_at 在 3 小时前的）；
//   B. 找出「时间线不合理」的订单集合 S（事件早于下单 / 晚于当前 / 下单或支付事件偏差>2分钟 / 核销早于支付 / 完成事件与 completed_at 偏差>2分钟）；
//   C. 对 S 内订单按规则重排事件：下单=created_at；支付=paid_at；出票=paid_at+2s；
//      核销=（完成-支付>=2小时 ? completed_at-1小时 : 支付与完成的中点）；完成=completed_at；补登=completed_at+2s；
//      退款申请/完成=原规则（paid_at+2~12天），但不晚于「当前-3小时 / 当前-2小时」，保证申请早于完成；
//   D. 复核全库：事件早于下单 / 晚于当前 / 下单支付偏差 / 核销早于支付 全部应为 0，不满足则整体回滚。
// 用法（在 api/ 下，环境变量里要有 DB_*）：
//   node scripts/demo-order-event-fix-20261119.mjs --backup <备份json路径>            # 演练：执行并复核，最后回滚
//   node scripts/demo-order-event-fix-20261119.mjs --backup <备份json路径> --commit   # 正式提交
//   node scripts/demo-order-event-fix-20261119.mjs --rollback <备份json路径>          # 按备份逐条恢复旧值
import fs from 'node:fs'
import mysql from 'mysql2/promise'

const argv = process.argv.slice(2)
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const commit = argv.includes('--commit')
const backupPath = arg('--backup'), rollbackPath = arg('--rollback')
if (!backupPath && !rollbackPath) { console.error('需要 --backup <json> 或 --rollback <json>'); process.exit(1) }

const c = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '', database: process.env.DB_NAME,
  dateStrings: true, multipleStatements: false,
})
const one = async (sql, a) => (await c.query(sql, a))[0]

if (rollbackPath) {
  const b = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'))
  await c.query('START TRANSACTION')
  for (const o of b.orders) await c.query('UPDATE orders SET completed_at = ? WHERE id = ?', [o.completed_at, o.id])
  for (const e of b.events) await c.query('UPDATE order_event SET created_at = ? WHERE id = ?', [e.created_at, e.id])
  await c.query('COMMIT')
  console.log(`已回滚：订单 ${b.orders.length} 笔、事件 ${b.events.length} 条恢复为备份旧值`)
  await c.end(); process.exit(0)
}

const VIOL = `(e.created_at < o.created_at - INTERVAL 1 SECOND
  OR e.created_at > NOW()
  OR (e.to_st = 10 AND ABS(TIMESTAMPDIFF(SECOND, e.created_at, o.created_at)) > 120)
  OR (e.to_st = 20 AND o.paid_at IS NOT NULL AND ABS(TIMESTAMPDIFF(SECOND, e.created_at, o.paid_at)) > 120)
  OR (e.from_st = 30 AND e.to_st = 40 AND o.paid_at IS NOT NULL AND e.created_at < o.paid_at)
  OR (e.from_st = 40 AND e.to_st = 50 AND o.completed_at IS NOT NULL AND ABS(TIMESTAMPDIFF(SECOND, e.created_at, o.completed_at)) > 120))`

const counts = async () => (await one(`SELECT
  SUM(e.created_at < o.created_at - INTERVAL 1 SECOND) pre_create,
  SUM(e.created_at > NOW()) future,
  SUM(e.to_st = 10 AND ABS(TIMESTAMPDIFF(SECOND, e.created_at, o.created_at)) > 120) bad10,
  SUM(e.to_st = 20 AND o.paid_at IS NOT NULL AND ABS(TIMESTAMPDIFF(SECOND, e.created_at, o.paid_at)) > 120) bad20,
  SUM(e.from_st = 30 AND e.to_st = 40 AND o.paid_at IS NOT NULL AND e.created_at < o.paid_at) verify_before_paid
  FROM order_event e JOIN orders o ON o.id = e.order_id`))[0]
const ordersBad = async () => (await one(`SELECT COUNT(*) n FROM orders WHERE completed_at IS NOT NULL AND paid_at IS NOT NULL AND completed_at < paid_at`))[0].n

console.log('修正前：', JSON.stringify(await counts()), '订单 completed<paid:', await ordersBad())

await c.query('START TRANSACTION')
try {
  // A. 订单自身矛盾
  const aRows = await one(`SELECT id, completed_at FROM orders WHERE completed_at IS NOT NULL AND paid_at IS NOT NULL
    AND completed_at < paid_at AND paid_at < NOW() - INTERVAL 3 HOUR`)
  await c.query(`UPDATE orders SET completed_at = paid_at + INTERVAL 2 HOUR WHERE completed_at IS NOT NULL AND paid_at IS NOT NULL
    AND completed_at < paid_at AND paid_at < NOW() - INTERVAL 3 HOUR`)
  // B. 受影响集合
  await c.query('CREATE TEMPORARY TABLE tmp_fix_s (id BIGINT PRIMARY KEY) ENGINE=MEMORY')
  await c.query(`INSERT INTO tmp_fix_s SELECT DISTINCT e.order_id FROM order_event e JOIN orders o ON o.id = e.order_id WHERE ${VIOL}`)
  const sIds = (await one('SELECT id FROM tmp_fix_s')).map((r) => r.id)
  const evOld = await one(`SELECT e.id, e.created_at FROM order_event e JOIN tmp_fix_s t ON t.id = e.order_id`)
  // 备份：订单旧值（仅 A 步动过的）+ 事件旧值（S 内全部）
  fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), orders: aRows, events: evOld }))
  console.log(`备份已写入 ${backupPath}：订单 ${aRows.length} 笔、事件 ${evOld.length} 条（受影响订单 ${sIds.length} 单）`)
  // C. 重排
  const J = 'JOIN orders o ON o.id = e.order_id JOIN tmp_fix_s t ON t.id = e.order_id'
  const U = (set, where) => c.query(`UPDATE order_event e ${J} SET e.created_at = ${set} WHERE ${where}`)
  await U('o.created_at', 'e.from_st = 0 AND e.to_st = 10')
  await U('COALESCE(o.paid_at, e.created_at)', 'e.from_st = 10 AND e.to_st = 20')
  await U('COALESCE(o.paid_at, e.created_at) + INTERVAL 2 SECOND', 'e.from_st = 20 AND e.to_st = 30')
  await U(`CASE WHEN o.completed_at IS NULL OR o.paid_at IS NULL THEN e.created_at
      WHEN TIMESTAMPDIFF(SECOND, o.paid_at, o.completed_at) >= 7200 THEN o.completed_at - INTERVAL 1 HOUR
      ELSE o.paid_at + INTERVAL (TIMESTAMPDIFF(SECOND, o.paid_at, o.completed_at) DIV 2) SECOND END`, 'e.from_st = 30 AND e.to_st = 40')
  await U('COALESCE(o.completed_at, e.created_at)', 'e.from_st = 40 AND e.to_st = 50')
  await U('COALESCE(o.completed_at, e.created_at) + INTERVAL 2 SECOND', 'e.from_st = e.to_st AND e.from_st IN (30, 40, 50)')
  await U(`LEAST(COALESCE(o.paid_at, e.created_at) + INTERVAL (2 + MOD(e.order_id, 9)) DAY + INTERVAL MOD(e.order_id, 12) HOUR, NOW() - INTERVAL 3 HOUR)`, 'e.from_st = 30 AND e.to_st = 60')
  await U(`LEAST(COALESCE(o.paid_at, e.created_at) + INTERVAL (3 + MOD(e.order_id, 9)) DAY + INTERVAL (MOD(e.order_id, 12) + 6) HOUR, NOW() - INTERVAL 2 HOUR)`, 'e.from_st IN (60, 70) AND e.to_st = 70')
  await U('o.created_at + INTERVAL 15 MINUTE', 'e.from_st = 10 AND e.to_st = 90')
  // D. 复核
  const after = await counts(), ob = await ordersBad()
  console.log('修正后：', JSON.stringify(after), '订单 completed<paid:', ob)
  const seq = (await one(`SELECT COUNT(*) n FROM order_event a JOIN order_event b ON a.order_id = b.order_id
    AND a.to_st = 20 AND b.from_st = 20 AND b.to_st = 30 AND b.created_at < a.created_at`))[0].n
  const bad = Object.values(after).some((v) => Number(v) > 0) || Number(ob) > 0 || Number(seq) > 0
  if (bad) throw new Error('复核未清零，整体回滚：' + JSON.stringify(after) + ' ob=' + ob + ' seq=' + seq)
  await c.query(`INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val, ip, created_at)
    VALUES ('system:demo-data-20261119', 'demo-data', 'order-event-fix2', 'order-event-fix-20261119', ?, ?, NULL, NOW(3))`,
  [JSON.stringify({ orders_fixed: aRows.length, events_retimed: evOld.length, orders_in_scope: sIds.length }), JSON.stringify({ note: '事件早于下单/晚于当前/核销早于支付 全部清零；订单 completed<paid 清零' })])
  if (commit) { await c.query('COMMIT'); console.log('已提交') } else { await c.query('ROLLBACK'); console.log('演练完成，已回滚（未提交）') }
} catch (e) {
  await c.query('ROLLBACK'); console.error('失败，已回滚：', e.message); process.exitCode = 1
}
await c.end()
