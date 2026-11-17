// 隔离库夹具归一（从演示库 dump 重建隔离库后、跑 test:db 之前执行一次）：
//   1) 链历史【完整保留】——A3 离线重算 / A7 订单复核 / A15 校验码都依赖批次与事件挂链；
//      dump 带入的 status=2 批次在"NOOP 断言"里的误报由运行环境变量 CHAIN_ENDPOINT=1 解决
//      （web3-integrity 的 A9 以该变量判定 real/noop；真实锚定历史配 real 口径是如实的）。
//   2) 当日旅豆流水：账本日终封存 / 账本 PDF 用例需要"今天"有流水（dump 停在演示最后活动日）→ 造一对借贷平衡分录。
// 守卫：只能对隔离库运行（wanderlust_qa_*）。
import { assertIsolatedDb } from '../test/_guard.mjs'
assertIsolatedDb('scripts/isolated-db-fixture.mjs')
import { q, one, closeDb } from '../src/db.mjs'
console.log('fixture: 链历史完整保留（' + (await one('SELECT COUNT(*) c FROM attest_batch')).c + ' 批）——A9 以 CHAIN_ENDPOINT=real 口径运行')

// status=5（已提交待确认）批次归位到重试池：confirmPending 类用例的护栏要求库内无在途待确认（红线 7）；
// status=2 受触发器保护不可动，归 CHAIN_ENDPOINT=real 口径处理
const n5 = await one('SELECT COUNT(*) c FROM attest_batch WHERE status = 5')
if (Number(n5.c)) {
  await q('UPDATE attest_batch SET status = 3, attempt = 0, last_err = NULL WHERE status = 5')
  console.log('fixture: 归位 status=5 批次 ' + n5.c + ' 个到重试池')
}

// 脏 sign_deadline 规范化（真实演示数据 bug：JS Date.toString 串，validDeadline 拒绝 → 团期永远不可报名）
const dirty = await q(`SELECT id FROM tour_session WHERE profile IS NOT NULL AND JSON_VALID(profile)
  AND JSON_EXTRACT(profile, '$.sign_deadline') IS NOT NULL
  AND NOT REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(profile, '$.sign_deadline')), '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(:[0-9]{2})?$')`)
if (dirty.length) {
  for (const s of dirty) await q(`UPDATE tour_session SET profile = JSON_SET(profile, '$.sign_deadline', NULL) WHERE id = ?`, [s.id])
  console.log('fixture: 规范化脏 sign_deadline 团期 ' + dirty.length + ' 条（置空 = 不限报名截止）')
}

// 订 bookings 类用例（refund-e2e 等）依赖最低 id 团期可报名 + 商品 1 的"今天"团期让位（uk_prod_date）
const s1 = await one('SELECT s.id, s.product_id pid FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.status = 1 AND p.status = 1 ORDER BY s.id LIMIT 1')
if (s1) {
  await q(`UPDATE tour_session SET depart_date = DATE_ADD(CURDATE(), INTERVAL 10 DAY), status = 1, quota = GREATEST(quota, booked + 3),
    profile = JSON_SET(COALESCE(profile, '{}'), '$.sign_deadline', NULL) WHERE id = ?`, [s1.id])
  await q('DELETE FROM tour_session WHERE product_id = ? AND depart_date = CURDATE() AND id <> ?', [s1.pid, s1.id])
  console.log('fixture: 团期 #' + s1.id + ' 置为 10 天后可报名；商品 ' + s1.pid + ' 的今日团期已让位')
}

const today = await one('SELECT COUNT(*) c FROM bean_ledger WHERE DATE(created_at) = CURDATE()')
if (!Number(today.c)) {
  const acct = await one('SELECT id, balance FROM bean_account ORDER BY id LIMIT 1')
  if (!acct) throw new Error('隔离库无 bean_account，请先起一次服务完成种子')
  const bal = Number(acct.balance) || 0
  await q(`INSERT INTO bean_ledger (account_id, tx_no, direction, amount, after_bal, biz_type, biz_ref, created_at)
    VALUES (?, CONCAT('DPFIX-G-', UNIX_TIMESTAMP()), 1, 100, ?, 1, 'DPQA-day-fixture', NOW(3))`, [acct.id, bal + 100])
  await q(`INSERT INTO bean_ledger (account_id, tx_no, direction, amount, after_bal, biz_type, biz_ref, created_at)
    VALUES (?, CONCAT('DPFIX-C-', UNIX_TIMESTAMP()), 2, 100, ?, 2, 'DPQA-day-fixture', NOW(3))`, [acct.id, bal])
  console.log('fixture: 造当日借贷平衡流水一对（账户 ' + acct.id + '，余额净额不变）')
} else console.log('fixture: 当日已有流水，跳过')

console.log('fixture done')
await closeDb()
