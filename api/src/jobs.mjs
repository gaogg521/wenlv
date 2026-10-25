// 定时任务进程（生产与 node src/index.mjs 并行跑：node src/jobs.mjs / PM2 apps 里加一项）
// 周期（总方案 §7.5）：关单每分钟 · 完成订单每小时 · 佣金到期每日 02:00 · 周结算每周一 01:00
import { q, one } from './db.mjs'
import * as order from './domain/order.mjs'
import * as bean from './domain/bean.mjs'
import * as pass from './domain/pass.mjs'
import * as promo from './domain/promo.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 订单 40 → 50：返豆（双闸）+ 成长值/等级 + 佣金 + 存证（逻辑与 routes 的 dev/complete 同源） */
export async function completeOrder(orderNo) {
  const o = await order.byNo(orderNo)
  if (!o || o.status !== 40) return false
  await order.fire(orderNo, 'OBSERVE_END', 'system', async (c) => {
    await c.upd('UPDATE orders SET completed_at = NOW(3) WHERE order_no = ?', [orderNo])
    return '观察期结束·返豆+计佣'
  })
  const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
  if (budget) {
    const rebate = await bean.rebateOf(Number(o.amount_pay))
    if (rebate > 0) await bean.grant(Number(o.user_id), rebate, bean.BIZ.REBATE, orderNo, budget.id)
  }
  const amt = Number(o.amount_pay)
  await q('UPDATE user_account SET growth_value = growth_value + ? WHERE id = ?', [amt, o.user_id])
  const th = [0, 2000, 10000, 50000]
  const ua = await one('SELECT growth_value FROM user_account WHERE id = ?', [o.user_id])
  await q('UPDATE user_account SET member_level = ? WHERE id = ?', [th.filter((t) => Number(ua.growth_value) >= t).length, o.user_id])
  await q('INSERT INTO user_growth_log (user_id, delta, biz_type, biz_ref, after_val) VALUES (?,?,1,?,?)',
    [o.user_id, amt, orderNo, Number(ua.growth_value)])
  await promo.createCommission(orderNo)
  await pass.attest('order', orderNo, JSON.stringify({ amount: amt, status: 50 }))
  return true
}

async function tickClose() {
  const n = await order.closeTimeout()
  if (n) console.log('[job:close]', n, 'closed')
}

async function tickComplete() {
  const rows = await q("SELECT order_no FROM orders WHERE status = 40 AND refund_deadline IS NOT NULL AND refund_deadline <= NOW(3) LIMIT 100")
  for (const r of rows) {
    try { if (await completeOrder(r.order_no)) console.log('[job:complete]', r.order_no) }
    catch (e) { console.error('[job:complete:err]', r.order_no, e.message) }
  }
}

async function tickCommission() {
  const n = await promo.settleDue()
  console.log('[job:commission]', n, 'due→payable')
}

async function tickSettlement() {
  if (new Date().getDay() !== 1) return // 周一
  const period = new Date().toISOString().slice(0, 7) + '-W' + Math.ceil(new Date().getDate() / 7)
  const merchants = await q('SELECT DISTINCT merchant_id mid FROM orders WHERE status = 50')
  for (const m of merchants) await promo.generateSettlement(Number(m.mid), period)
  console.log('[job:settlement]', merchants.length, 'merchants', period)
}

/** 豆过期（滚动 12 个月 FIFO）：回收超期豆（负向分录 biz=6） */
export async function tickExpire() {
  const months = 12
  const rows = await q(`SELECT l.account_id, a.user_id, SUM(l.amount) amt FROM bean_ledger l
    JOIN bean_account a ON a.id = l.account_id
    WHERE l.direction = 1 AND l.biz_type IN (1,2,3) AND l.created_at < NOW() - INTERVAL ? MONTH
      AND NOT EXISTS (SELECT 1 FROM bean_ledger x WHERE x.tx_no = l.tx_no AND x.biz_type = 6)
    GROUP BY l.account_id, a.user_id HAVING amt > 0`, [months])
  const { deduct, BIZ } = await import('./domain/bean.mjs')
  for (const r of rows) {
    try { await deduct(Number(r.user_id), Number(r.amt), BIZ.EXPIRE, 'EXPIRE-' + r.account_id); console.log('[job:expire]', r.user_id, r.amt) }
    catch (e) { console.error('[job:expire:err]', e.message) }
  }
}

/** 存证打包（小时级）：Merkle 根批次（Noop 链记录；P1 anchorToChain 换真实链） */
export async function tickAttest() {
  const { packBatch } = await import('./domain/attest.mjs')
  const r = await packBatch()
  if (r.leaves > 0) console.log('[job:attest] batch #' + r.batchId, 'leaves', r.leaves, 'root', String(r.root).slice(0, 12))
}

async function main() {
  console.log('[jobs] started：close 60s / complete 3600s / commission 02:00 / settlement 周一 01:00')
  let lastCommission = '', lastSettlement = ''
  for (;;) {
    const now = new Date()
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    try {
      await tickClose()
      await tickComplete()
      await tickExpire()
      await tickAttest()
      // 心跳：运维控制台据此判断任务进程存活
      await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES ('main-loop', NOW(3), 'ok', 1)
               ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok', run_count = run_count + 1`, [])
      if (hhmm >= '02:00' && lastCommission !== now.toDateString()) { lastCommission = now.toDateString(); await tickCommission() }
      if (hhmm >= '01:00' && now.getDay() === 1 && lastSettlement !== now.toDateString()) { lastSettlement = now.toDateString(); await tickSettlement() }
    } catch (e) { console.error('[jobs:err]', e.message) }
    await sleep(60_000)
  }
}
const isDirect = process.argv[1] && process.argv[1].split('/').pop().split(String.fromCharCode(92)).pop() === 'jobs.mjs'
if (isDirect) main()
