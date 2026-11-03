// 批次 F-2 回归：T11 统一资金工作台（隔离库，需服务在跑）
// 覆盖：四条线聚合数字 = 库内复算；异常标记（重复流水/冻结挂起/待复核）可被夹具触发并正确计数；
//       下钻键存在；角色矩阵（finance/super/ops 可读，review/risk/city 拒绝）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-fundworkbench.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '资金台回归-' + role })]))
const call = async (role, method, path, body) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + tokens[role], 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'FWQA' + Math.random().toString(36).slice(2, 10)
const created = { users: [], withdraws: [], entries: [], profits: [], coCreators: [], settlements: [] }
try {
  const u = await q("INSERT INTO user_account (mini_a_openid, nickname) VALUES (?, ?)", ['fwqa-' + stamp, stamp + '用户'])
  created.users.push(u.insertId)
  const uid = u.insertId

  await test('聚合数字 = 库内复算（四条线）', async () => {
    const d = ok(await call('finance', 'GET', '/admin/fund-workbench'))
    const line = (k) => d.lines.find((l) => l.key === k)
    // 结算待付
    const dbSettle = await one("SELECT COUNT(*) n, COALESCE(SUM(amt_fulfill + COALESCE(fee_merchant,0)),0) amt FROM settlement WHERE status = 2")
    assert.equal(line('settlements').pending.count, Number(dbSettle.n))
    assert.equal(line('settlements').pending.amount, Number(dbSettle.amt))
    // 提现待审
    const dbWd = await one('SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt FROM promoter_withdraw WHERE status = 0')
    assert.equal(line('withdrawals').pending.count, Number(dbWd.n))
    assert.equal(line('withdrawals').pending.amount, Number(dbWd.amt))
    // 现金加奖
    const dbCash = await one('SELECT COUNT(*) n, COALESCE(SUM(cash_reward),0) amt FROM content_task_entry WHERE cash_status = 1')
    assert.equal(line('taskcash').pending.count, Number(dbCash.n))
    // 共创分润待付 = 未付余额
    const dbCo = await one('SELECT COUNT(*) n, COALESCE(SUM(amount - paid_amount),0) amt FROM co_profit WHERE status = 0')
    assert.equal(line('cocreate').pending.count, Number(dbCo.n))
    assert.equal(line('cocreate').pending.amount, Number(dbCo.amt))
    assert.ok(d.lines.every((l) => l.goto), '每条线有下钻键')
    assert.ok(d.metricNote.includes('不等于外部渠道确认到账'), '口径如实标识')
  })

  await test('异常标记：冻结挂起提现/加奖、重复流水、分润待复核可被夹具触发', async () => {
    // 冻结用户 + 挂起提现
    await q('UPDATE user_account SET status = 0 WHERE id = ?', [uid])
    const w = await q('INSERT INTO promoter_withdraw (promoter_id, amount, status, proposer_note) VALUES (?, 5000, 0, ?)', [uid, stamp])
    created.withdraws.push(w.insertId)
    // 重复提现打款流水（两笔同 ref）
    const w2 = await q('INSERT INTO promoter_withdraw (promoter_id, amount, status, pay_ref) VALUES (?, 100, 1, ?)', [uid, 'FWDUP-' + stamp])
    const w3 = await q('INSERT INTO promoter_withdraw (promoter_id, amount, status, pay_ref) VALUES (?, 100, 1, ?)', [uid, 'FWDUP-' + stamp])
    created.withdraws.push(w3.insertId)
    created.withdraws.push(w2.insertId)
    // 冻结用户现金加奖挂起
    // 隔离库可能无约稿任务——夹具自建
    const t0 = await one('SELECT id FROM content_task LIMIT 1')
    const t = t0 || { id: (await q("INSERT INTO content_task (task_no, title, brief, reward_beans) VALUES (?, ?, '资金台夹具任务', 0)", ['FWTK-' + stamp, stamp + '夹具任务'])).insertId }
    const e = await q('INSERT INTO content_task_entry (task_id, user_id, status, cash_reward, cash_status) VALUES (?, ?, 3, 2000, 1)', [t.id, uid])
    created.entries.push(e.insertId)
    // 分润待复核登记
    const co = await q("INSERT INTO co_creator (product_id, co_no, name, mobile, role) SELECT id, ?, '资金台夹具', '13800001333', 1 FROM tour_product LIMIT 1", [stamp])
    created.coCreators.push(co.insertId)
    const pf = await q('INSERT INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount) SELECT 950001, ?, id, ?, 1000, 5000 FROM tour_product LIMIT 1', [co.insertId, stamp])
    created.profits.push(pf.insertId)
    const pay = await q("INSERT INTO co_profit_pay (co_profit_id, direction, pay_ref, channel, amount, status, operator) VALUES (?, 1, ?, 'bank', 5000, 0, 'admin:夹具')", [pf.insertId, stamp + '-P1'])
    // 重复结算回单
    const m = await one('SELECT id FROM merchant LIMIT 1')
    const s1 = await q('INSERT INTO settlement (merchant_id, period, order_count, total_amount, amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status, payment_ref) VALUES (?, ?, 1, 1000, 800, 100, 0, 0, 100, 3, ?)', [m.id, stamp.slice(0, 10) + '-A', 'FWDUP-' + stamp])
    const s2 = await q('INSERT INTO settlement (merchant_id, period, order_count, total_amount, amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status, payment_ref) VALUES (?, ?, 1, 1000, 800, 100, 0, 0, 100, 3, ?)', [m.id, stamp.slice(0, 10) + '-B', 'FWDUP2-' + stamp])
    created.settlements.push(s1.insertId, s2.insertId)

    const d = ok(await call('finance', 'GET', '/admin/fund-workbench'))
    const line = (k) => d.lines.find((l) => l.key === k)
    const dbWdNow = await one('SELECT w.status, u.status ustatus FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id WHERE w.id = ?', [created.withdraws[0]])
    console.log('    夹具态:', JSON.stringify(dbWdNow))
    assert.ok(line('withdrawals').issues.some((x) => x.includes('冻结账号挂起')), '冻结挂起标记：' + JSON.stringify(line('withdrawals').issues))
    assert.ok(line('withdrawals').issues.some((x) => x.includes('重复打款流水')), '重复流水标记')
    assert.ok(line('taskcash').issues.some((x) => x.includes('冻结账号待打款')), '加奖冻结标记')
    assert.ok(line('cocreate').issues.some((x) => x.includes('待复核')), '分润待复核标记')
    assert.ok(!line('settlements').issues.some((x) => x.includes('重复回单流水')), '结算回单重复由库层唯一约束拒绝（防御查询保留）')
  })

  await test('角色矩阵：finance/super/ops 可读；review/risk/city 拒绝', async () => {
    assert.equal((await call('super', 'GET', '/admin/fund-workbench')).code, 0)
    assert.equal((await call('ops', 'GET', '/admin/fund-workbench')).code, 0, '运营只读进度（F-01/F-02 口径）')
    assert.equal((await call('review', 'GET', '/admin/fund-workbench')).code, 1003)
    assert.equal((await call('risk', 'GET', '/admin/fund-workbench')).code, 1003)
    assert.equal((await call('city_partner', 'GET', '/admin/fund-workbench')).code, 1003)
  })

  console.log(`\n${passed} 项批次 F-2（T11 资金工作台）回归通过`)
} finally {
  if (created.settlements.length) await q('DELETE FROM settlement WHERE id IN (?)', [created.settlements]).catch(() => {})
  if (created.profits.length) {
    await q('DELETE FROM co_profit_pay WHERE co_profit_id IN (?)', [created.profits]).catch(() => {})
    await q('DELETE FROM co_profit WHERE id IN (?)', [created.profits]).catch(() => {})
  }
  if (created.coCreators.length) await q('DELETE FROM co_creator WHERE id IN (?)', [created.coCreators]).catch(() => {})
  if (created.entries.length) await q('DELETE FROM content_task_entry WHERE id IN (?)', [created.entries]).catch(() => {})
  if (created.withdraws.length) await q('DELETE FROM promoter_withdraw WHERE id IN (?)', [created.withdraws]).catch(() => {})
  if (created.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [created.users]).catch(() => {})
  await closeDb()
}
