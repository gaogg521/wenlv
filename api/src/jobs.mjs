// 定时任务进程（生产与 node src/index.mjs 并行跑：node src/jobs.mjs / PM2 apps 里加一项）
// 周期（总方案 §7.5）：关单每分钟 · 完成订单每小时 · 佣金到期每日 02:00 · 周结算每周一 01:00
import { q, one } from './db.mjs'
import * as order from './domain/order.mjs'
import * as bean from './domain/bean.mjs'
import * as member from './domain/member.mjs'
import * as pass from './domain/pass.mjs'
import * as promo from './domain/promo.mjs'
import * as group from './domain/group.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 订单 40 → 50：返豆（双闸）+ 成长值/等级 + 佣金 + 存证（逻辑与 routes 的 dev/complete 同源） */
export async function completeOrder(orderNo) {
  const o = await order.byNo(orderNo)
  if (!o || o.status !== 40) return false
  await order.fire(orderNo, 'OBSERVE_END', 'system', async (c) => {
    await c.upd('UPDATE orders SET completed_at = NOW(3) WHERE order_no = ?', [orderNo])
    return '观察期结束·返豆+计佣'
  })
  // 返豆：账号冻结时不发，记为待补发，解冻后补发
  await bean.rebateOrder({ ...o, order_no: orderNo })
  const amt = Number(o.amount_pay)
  await member.addGrowth(o.user_id, amt, orderNo)
  await promo.createCommission(orderNo)
  // 订单完成锚定：version=50（主状态），canonical 白名单字段，不含联系人/手机号
  await pass.attest('order', orderNo, {
    orderNo, amountPay: amt, status: 50, merchantId: Number(o.merchant_id),
    qty: Number(o.qty), cityCode: o.city_code,
  }, null, 50)
  // 勋章自动规则（完成订单数 / 打卡城市数）：附加奖励，失败不影响订单完成
  const { evaluateSafe } = await import('./domain/badge.mjs')
  await evaluateSafe(Number(o.user_id))
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
  const { settlementPeriod } = await import('./infra/bizdate.mjs')
  const period = settlementPeriod() // ISO 周，如 2026-W45（周一出账即上一周）
  const merchants = await q(`SELECT DISTINCT merchant_id mid FROM orders WHERE status = 50 AND settlement_id IS NULL
      UNION SELECT DISTINCT o.merchant_id FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL`) // 只有退改手续费、没有完成订单的商户也要出账
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

/** 存证打包（小时级）：本地 Merkle 根 + inclusion proof；随后尝试锚定（NOOP 下停留在"已打包"） */
export async function tickAttest() {
  const { packBatch, reanchorPending, confirmPending } = await import('./domain/attest.mjs')
  const confirmed = await confirmPending(50)
  if (confirmed.length) console.log('[job:attest-confirm]', confirmed.filter((x) => x.anchored).length, '/', confirmed.length, 'confirmed')
  const r = await packBatch()
  if (r.leaves > 0) console.log('[job:attest] batch #' + r.batchId, 'seq', r.seq, 'leaves', r.leaves, 'root', String(r.root).slice(0, 12))
  const anchored = await reanchorPending(20)
  const okN = anchored.filter((x) => x.anchored).length
  if (okN) console.log('[job:attest:anchor]', okN, 'anchored')
  return { ...r, anchored: okN }
}

/** 旅豆账本日终根（每日 03:10）：封存昨日账本 → 借贷恒等才打包 → 根上链 */
export async function tickBeanDayClose() {
  const { closeBeanDay } = await import('./domain/attest.mjs')
  const r = await closeBeanDay()
  console.log('[job:bean-day]', r.bizDate, r.skipped ? '已封存' : (r.ok ? 'root ' + String(r.root).slice(0, 12) + ' leaves ' + r.leaves : '拒绝封存：' + r.reason))
  return r
}

/** 存证不变式对账（每日 04:00）：只读 + 报警，绝不改业务数据 */
export async function tickAttestReconcile() {
  const { reconcile } = await import('./domain/attest.mjs')
  const r = await reconcile()
  console.log('[job:attest-reconcile]', r.ok ? 'ALL PASS' : 'FAILED: ' + r.checks.filter((x) => !x.ok).map((x) => x.id).join(','))
  return r
}

/** 拼团未成团自动取消（分钟级）：§4 depart_date 前 group_cancel_hours 小时未达 min_go → 取消+全额退款+通知 */
export async function tickGroupCancel() {
  const done = await group.cancelDueSessions()
  if (done.length) console.log('[job:group-cancel]', done.join(','))
}

/** 严重风控告警外推（每轮）：risk_event severity>=2 未处理未通知 → webhook；未配置通道时静默 */
async function tickRiskNotify() {
  const { tickRiskNotify } = await import('./infra/notify.mjs')
  return tickRiskNotify()
}

async function main() {
  await (await import('./infra/secrets.mjs')).warmSecrets().catch(() => {})
  console.log('[jobs] started：close 60s / complete 3600s / commission 02:00 / bean-day 03:10 / reconcile 04:00 / settlement 周一 01:00')
  let lastCommission = '', lastSettlement = '', lastBeanDay = '', lastReconcile = ''
  for (;;) {
    const now = new Date()
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    try {
      await tickClose()
      await tickComplete()
      await tickGroupCancel()
      await tickExpire()
      await tickAttest()
      await tickRiskNotify()
      // 心跳：运维控制台据此判断任务进程存活
      await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES ('main-loop', NOW(3), 'ok', 1)
               ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok', run_count = run_count + 1`, [])
      if (hhmm >= '02:00' && lastCommission !== now.toDateString()) { lastCommission = now.toDateString(); await tickCommission() }
      if (hhmm >= '03:10' && lastBeanDay !== now.toDateString()) { lastBeanDay = now.toDateString(); await tickBeanDayClose() }
      if (hhmm >= '04:00' && lastReconcile !== now.toDateString()) { lastReconcile = now.toDateString(); await tickAttestReconcile() }
      if (hhmm >= '01:00' && now.getDay() === 1 && lastSettlement !== now.toDateString()) { lastSettlement = now.toDateString(); await tickSettlement() }
    } catch (e) { console.error('[jobs:err]', e.message) }
    await sleep(60_000)
  }
}
const isDirect = process.argv[1] && process.argv[1].split('/').pop().split(String.fromCharCode(92)).pop() === 'jobs.mjs'
if (isDirect) main()
