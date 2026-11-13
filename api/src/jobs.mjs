// 定时任务进程（生产与 node src/index.mjs 并行跑：node src/jobs.mjs / PM2 apps 里加一项）
// 周期（总方案 §7.5）：关单每分钟 · 完成订单每小时 · 佣金到期每日 02:00 · 周结算每周一 01:00
import { q, one } from './db.mjs'
import { cfgNum } from './config.mjs'
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
    await (await import('./domain/contribution-growth.mjs')).enqueueContribution(c, 'order', o.id)
    return '观察期结束·返豆+计佣'
  })
  // 返豆：账号冻结时不发，记为待补发，解冻后补发（实收 0 的免费改签单天然不返）
  await bean.rebateOrder({ ...o, order_no: orderNo })
  await bean.productExtraReward({ ...o, order_no: orderNo }) // B14 产品专属完成奖励（幂等）
  const amt = Number(o.amount_pay)
  // D01：成长值按最终实际支付的适用商品金额（总实付 − 保费 − 已结算按项退款）累计，与返豆/佣金同一口径（修复3）
  const goodsCash = await bean.goodsCashBase(o)
  if (goodsCash > 0) await member.addGrowth(o.user_id, goodsCash, orderNo) // A-01：实收 ¥0 的免费改签单不加成长值
  await promo.createCommission(orderNo)
  // 朱家角示范闭环·步骤4 贡献确认：Q 成交维度落库（归因有效单，幂等，不触发资金；S/R 无已确认规则不赋值）
  try { const oNow = await order.byNo(orderNo); await (await import('./domain/contribution.mjs')).recordQ({ ...oNow, order_no: orderNo }) } catch (e) { console.error('[job:contribution]', orderNo, e.message) }
  // 朱家角示范闭环·步骤4 贡献确认：Q 成交维度落库（归因有效单，幂等，不触发资金；S/R 无已确认规则不赋值）
  // 订单完成锚定：version=50（主状态），canonical 白名单字段，不含联系人/手机号
  await pass.attest('order', orderNo, {
    orderNo, amountPay: amt, status: 50, merchantId: Number(o.merchant_id),
    qty: Number(o.qty), cityCode: o.city_code,
  }, null, 50)
  // 勋章自动规则（完成订单数 / 打卡城市数）：附加奖励，失败不影响订单完成
  const { evaluateSafe } = await import('./domain/badge.mjs')
  await evaluateSafe(Number(o.user_id))
  await (await import('./domain/badge.mjs')).evaluateMerchantSafe(Number(o.merchant_id)) // 商户等级与商户徽章
  return true
}

async function tickClose() {
  await (await import('./domain/freedom.mjs')).sweepExpired()
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

/** 每日重评所有商户：退款率、评分会随时间变化，等级与徽章不能只在订单完成时才更新 */
async function tickMerchantLevel() {
  const { evaluateMerchantSafe } = await import('./domain/badge.mjs')
  for (const m of await q('SELECT id FROM merchant WHERE status = 1')) await evaluateMerchantSafe(Number(m.id))
}

async function tickCommission() {
  const n = await promo.settleDue()
  console.log('[job:commission]', n, 'due→payable')
}

async function tickSettlement() {
  if (new Date().getDay() !== 1) return // 周一
  const { settlementPeriod } = await import('./infra/bizdate.mjs')
  const period = settlementPeriod() // ISO 周，如 2026-W45（周一出账即上一周）
  // 修复4：枚举含跨店提供方（订单项归属他店主单）与有未冲抵调整的商户——补充单也要出
  const merchants = await q(`SELECT DISTINCT merchant_id mid FROM orders WHERE status = 50 AND settlement_id IS NULL
      UNION SELECT DISTINCT o.merchant_id FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL
      UNION SELECT DISTINCT oi.merchant_id FROM order_item oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 50 AND o.rebook_of IS NULL AND oi.settle_line_id IS NULL AND oi.merchant_id <> o.merchant_id
      UNION SELECT DISTINCT merchant_id FROM settlement_adjustment
      WHERE type = 1 AND amount_fen IS NOT NULL AND applied_settlement_id IS NULL`) // 只有退改手续费/跨店项/调整、没有完成订单的商户也要出账
  for (const m of merchants) await promo.generateSettlement(Number(m.mid), period)
  console.log('[job:settlement]', merchants.length, 'merchants', period)
}

/** A-14 退款补偿：状态 60 的订单逐单调 refund.refresh（PROCESSING 等待 / SUCCESS 完成 / CLOSED 转人工）。分钟级。 */
export async function tickRefundRefresh() {
  const rows = await q(`SELECT o.order_no FROM orders o JOIN refunds r ON r.order_id = o.id
    WHERE o.status = 60 AND r.status = 0 GROUP BY o.order_no ORDER BY o.id LIMIT 50`)
  const { refresh } = await import('./domain/refund.mjs')
  for (const r of rows) {
    try { await refresh(r.order_no) } catch (e) { console.error('[job:refund]', r.order_no, e.message) }
  }
  return rows.length
}

/** Codex复验修复3：分项退款补偿——处理中（refunds.status=0 且 partial_refund.status=0）的按项退款
 *  逐笔查回执：SUCCESS → confirmPartialRefund（状态+结算调整，幂等可重试）；CLOSED → failPartialRefund
 *  （转人工+恢复订单项/凭证+风险事件）；PROCESSING/查询异常 → 下一轮重试。分项退款不改订单主状态（无 60 可扫）。 */
export async function tickPartialRefundRefresh() {
  const rows = await q(`SELECT pr.order_id, pr.refund_no FROM partial_refund pr JOIN refunds r ON r.refund_no = pr.refund_no
    WHERE pr.status = 0 AND r.status = 0 ORDER BY pr.id LIMIT 50`)
  // Codex复验 R3：第一段为空不得早退——漏单补登（第二段）仍须执行
  const wxpay = await import('./domain/wxpay.mjs')
  const pkg = await import('./domain/package.mjs')
  for (const r of rows) {
    try {
      const result = await wxpay.queryRefund(r.refund_no)
      if (result.status === 'SUCCESS') await pkg.confirmPartialRefund(Number(r.order_id), r.refund_no)
      else if (result.status === 'CLOSED') await pkg.failPartialRefund(r.refund_no, '微信退款回执关闭（CLOSED）')
      // PROCESSING / ABNORMAL：保持处理中，下一轮重试
    } catch (e) { console.error('[job:partial-refund]', r.refund_no, e.message) }
  }
  // 按退款实际选中的项核对每家提供方。已有一家分录不能阻止其他家补登。
  const { fulfill } = await promo.splitBp()
  const missed = await q(`SELECT pr.order_id, pr.refund_no FROM partial_refund pr
    WHERE pr.status = 2 AND EXISTS (
      SELECT 1 FROM JSON_TABLE(pr.item_ids, '$[*]' COLUMNS (pos FOR ORDINALITY, item_id BIGINT PATH '$')) ids
      JOIN JSON_TABLE(pr.item_nets, '$[*]' COLUMNS (pos FOR ORDINALITY, net BIGINT PATH '$')) nets ON nets.pos = ids.pos
      JOIN order_item oi ON oi.id = ids.item_id AND oi.order_id = pr.order_id
      JOIN settlement_line sl ON sl.id = oi.settle_line_id
      JOIN settlement s ON s.id = sl.settlement_id
      WHERE NOT EXISTS (SELECT 1 FROM settlement_adjustment x WHERE x.refund_no = pr.refund_no AND x.type = 1 AND x.merchant_id = sl.merchant_id)
      GROUP BY sl.id, s.split_snapshot
      HAVING ROUND(SUM(GREATEST(COALESCE(nets.net, 0), 0)) * COALESCE(JSON_EXTRACT(s.split_snapshot, '$.fulfill') + 0, ?) / 10000) > 0
    ) ORDER BY pr.id LIMIT 50`, [fulfill])
  for (const m of missed) {
    try { await promo.recordRefundAdjustment(Number(m.order_id), m.refund_no, 'system:missed-adjust') }
    catch (e) { console.error('[job:partial-refund:missed]', m.refund_no, e.message) }
  }
  return rows.length + missed.length
}
/** A-11 过期未核销：核销窗口（出发日 + pass.verify_end_days 天）已过仍未核销的订单 → 全额退款 + 凭证作废 + 通知游客。
 *  此前这类单永久停在 30：游客不能自助退（退改梯度不含已出发）、商户结算不了、提前核销还能进观察期。 */
export async function tickExpireVouchers() {
  const endDays = await cfgNum('pass.verify_end_days')
  const rows = await q(`SELECT o.order_no FROM orders o JOIN tour_session s ON s.id = o.session_id
    WHERE o.status = 30 AND s.depart_date < DATE_SUB(CURDATE(), INTERVAL ? DAY) LIMIT 50`, [endDays])
  const { fullRefund } = await import('./domain/refund.mjs')
  const done = []
  for (const r of rows) {
    try {
      await fullRefund({ orderNo: r.order_no, reason: '核销有效期已过·自动退款', operator: 'system', closeReason: 'verify_expired' })
      // 通知游客（模板未配置静默）
      try {
        const o = await order.byNo(r.order_no)
        const u = await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [o.user_id])
        const p = await one('SELECT title FROM tour_product WHERE id = ?', [o.product_id])
        const { getSecret } = await import('./infra/secrets.mjs')
        const tpl = await getSecret('WX_TMPL_VOUCHER_EXPIRE')
        const wxapi = await import('./domain/wxapi.mjs')
        await wxapi.sendSubscribeMessage(u && u.mini_a_openid, tpl, {
          thing1: { value: String(p && p.title || '您的行程').slice(0, 20) },
          thing4: { value: '核销有效期已过，退款进度见订单' },
        }, 'package-order/pages/orders/index')
      } catch (e) { console.error('[job:expire-voucher:notify]', r.order_no, e.message) }
      done.push(r.order_no)
    } catch (e) { console.error('[job:expire-voucher]', r.order_no, e.message) }
  }
  if (done.length) console.log('[job:expire-voucher]', done.join(','))
  return done.length
}

/** 豆过期（滚动 expire_months 个月 FIFO）：回收超期豆（负向分录 biz=6）。
 *  A-02 修复：旧实现用原发放分录的 tx_no 比对过期分录（tx_no 永远不同 → 每分钟重复扣），
 *  也没有按 FIFO 扣除已消费部分（已花掉的旧豆会被再扣一次）。
 *  新实现：按账户算"过期批次剩余量"（bean.expiredDue），扣一次后该批次剩余归零 → 幂等；
 *  与账户行同事务加锁，避免与消费/发放并发时算错。 */
export async function tickExpire() {
  const months = await cfgNum('bean.expire_months') // 有效期走参数中心（此前写死 12）
  const rows = await q(`SELECT DISTINCT l.account_id, a.user_id FROM bean_ledger l
    JOIN bean_account a ON a.id = l.account_id
    WHERE l.direction = 1 AND l.biz_type IN (1,2,3) AND l.created_at < NOW() - INTERVAL ? MONTH
      AND a.user_id < 999999000000`, [months])
  const { deduct, expiredDue, BIZ } = await import('./domain/bean.mjs')
  const { tx } = await import('./db.mjs')
  for (const r of rows) {
    try {
      const userId = Number(r.user_id)
      // 锁账户行再算应扣量：过期/消费/发放并发时口径一致（deduct 内部同样先锁账户行）
      const due = await tx(async (c) => {
        await c.one('SELECT id FROM bean_account WHERE user_id = ? FOR UPDATE', [userId])
        return expiredDue(userId, months, c)
      })
      if (due > 0) {
        await deduct(userId, due, BIZ.EXPIRE, 'EXPIRE-' + r.account_id)
        console.log('[job:expire]', userId, due)
      }
    } catch (e) { console.error('[job:expire:err]', r.user_id, e.message) }
  }
}

/** 存证打包（小时级）：本地 Merkle 根 + inclusion proof；随后尝试锚定（NOOP 下停留在"已打包"） */
/** 打包节奏控制：本函数注释写"小时级"，但主循环每 60 秒调一次 —— 照这样每分钟一批，
 *  一天 1440 批，燃料与"批次"语义都不对。这里按小时闸门，另留一个积压阈值做兜底：
 *  待打包超过 200 条说明业务量上来了，不等整点。 */
let lastAttestAt = 0
const ATTEST_INTERVAL_MS = 55 * 60_000
const ATTEST_URGENT_PENDING = 200

export async function tickAttest(opts = {}) {
  const { confirmPending: _c } = await import('./domain/attest.mjs')
  const force = !!opts.force
  if (!force && Date.now() - lastAttestAt < ATTEST_INTERVAL_MS) {
    const pend = await one('SELECT COUNT(*) n FROM attest_event WHERE status = 0')
    if (Number(pend.n) < ATTEST_URGENT_PENDING) {
      // 确认环节不受闸门限制：已提交待确认的批次要尽快核验终局
      const done = await _c(50)
      return { batchId: 0, leaves: 0, root: null, seq: 0, prevRoot: null, anchored: 0, skipped: 'hourly-gate', pending: Number(pend.n), confirmed: done.filter((x) => x.anchored).length }
    }
  }
  lastAttestAt = Date.now()
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
      await tickRefundRefresh()
      await tickPartialRefundRefresh()
      await tickExpireVouchers()
      await tickAttest()
      await tickRiskNotify()
      await (await import('./domain/contribution-growth.mjs')).tickContributionGrowth()
      // 心跳：运维控制台据此判断任务进程存活
      await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES ('main-loop', NOW(3), 'ok', 1)
               ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok', run_count = run_count + 1`, [])
      if (hhmm >= '02:00' && lastCommission !== now.toDateString()) { lastCommission = now.toDateString(); await tickCommission(); await tickMerchantLevel() }
      if (hhmm >= '03:10' && lastBeanDay !== now.toDateString()) { lastBeanDay = now.toDateString(); await tickBeanDayClose() }
      if (hhmm >= '04:00' && lastReconcile !== now.toDateString()) { lastReconcile = now.toDateString(); await tickAttestReconcile() }
      if (hhmm >= '01:00' && now.getDay() === 1 && lastSettlement !== now.toDateString()) { lastSettlement = now.toDateString(); await tickSettlement() }
    } catch (e) { console.error('[jobs:err]', e.message) }
    await sleep(60_000)
  }
}
/**
 * 进程内启动（JOBS_IN_API=1 时由 index.mjs 调用）。
 * 为什么允许跑在 API 进程里：这台机器上注册单独的看护任务需要管理员权限（Access denied），
 * 而 API 已经由计划任务看护 —— 借这条命把定时循环带上，才不会"我一退出事件就堆"。
 * 多实例保护：MySQL 咨询锁。抢不到锁的进程静默退出循环，绝不双跑（双跑会重复打包/重复上链）。
 */
export async function startInApi() {
  try {
    const { one } = await import('./db.mjs')
    const r = await one("SELECT GET_LOCK('wanderlust_jobs_loop', 0) AS ok")
    if (Number(r && r.ok) !== 1) {
      console.log('[jobs] 另一个实例已持有调度锁，本进程不跑定时循环')
      return false
    }
    console.log('[jobs] 进程内调度已启动（持有 MySQL 咨询锁）')
    await main()
    return true
  } catch (e) {
    console.error('[jobs] 进程内调度启动失败：', e.message)
    return false
  }
}

const isDirect = process.argv[1] && process.argv[1].split('/').pop().split(String.fromCharCode(92)).pop() === 'jobs.mjs'
if (isDirect) main()
