// P-02/03/04/06/07/08 回归矩阵（隔离库，需服务在跑）：
//   P-02 财务共创页不再依赖 products 完整接口；无 products 模块仍拒绝完整商品管理接口
//   P-03 sre/dev 三个整页的只读视图可用（audit/chain-hub/integrations），写与切换仍限权；开发不能跑手动任务
//   P-04 只读角色：联调完成、结算生成、回单登记后端一律 1003；能力表如实反映
//   P-06 审核员无 taskcash 模块（前端不调用资金接口的依据）；后端仍拒绝
//   P-07 会员等级字典跟随 users 模块：风控 200、无 users 角色 1003
//   P-08 风控关键词搜索修复：kind 列 + 复合筛选 + 注入式字符串当普通关键词 + 不回显内部错误
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-pmatrix.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (tok, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
const tok = (role) => jwtSign({ end: 'admin', role, name: 'P矩阵-' + role })
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const denied = (r, why) => assert.equal(r.code, 1003, why + ' 应 1003，实际 ' + r.code + ' ' + r.msg)
let passed = 0
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1 } }

console.log('== P 系列回归矩阵（P-02/03/04/06/07/08）==')

await test('P-02：财务可用共创主数据接口；无 products 模块仍不能读完整商品管理接口', async () => {
  ok(await call(tok('finance'), 'GET', '/admin/co-creators'))
  ok(await call(tok('finance'), 'GET', '/admin/co-profits'))
  denied(await call(tok('finance'), 'GET', '/admin/products'), '财务读商品完整管理接口')
  denied(await call(tok('review'), 'GET', '/admin/products'), '审核读商品完整管理接口')
  ok(await call(tok('super'), 'GET', '/admin/products'))
})

await test('P-03：sre/dev 审计只读视图 200；city 仍拒绝', async () => {
  for (const role of ['sre', 'dev']) ok(await call(tok(role), 'GET', '/admin/audit-logs?page=1&pageSize=5'))
  denied(await call(tok('city_partner'), 'GET', '/admin/audit-logs'), '城市读审计')
  denied(await call(tok('ops'), 'GET', '/admin/audit-logs'), '运营读审计（默认无 audit 模块）')
})

await test('P-03：sre/dev 链接入与集成中心只读视图 200，响应不含凭据值；写路径仍仅超管', async () => {
  for (const role of ['sre', 'dev']) {
    const hub = ok(await call(tok(role), 'GET', '/admin/chain/hub'))
    assert.ok(Array.isArray(hub.providers) && hub.providers.length, 'providers 视图')
    const raw = JSON.stringify(hub)
    assert.ok(!/-----BEGIN|PRIVATE KEY/.test(raw), '视图不得含私钥材料')
    ok(await call(tok(role), 'GET', '/admin/integrations'))
    // 诊断动作（无副作用）：离线自检对 noop/selftest 类可用；无自检的链返回 1004 而非 1003
    const st = await call(tok(role), 'POST', '/admin/chain/selftest/noop')
    assert.ok([0, 1004].includes(st.code), 'selftest 应成功或明确无自检，不应 1003：' + JSON.stringify(st))
  }
  denied(await call(tok('readonly'), 'GET', '/admin/chain/hub'), '只读读链接入')
  denied(await call(tok('sre'), 'POST', '/admin/chain/activate', { provider: 'noop', confirm: 'noop' }), '运维切换链')
  denied(await call(tok('dev'), 'POST', '/admin/chain/activate', { provider: 'noop', confirm: 'noop' }), '开发切换链')
  denied(await call(tok('sre'), 'POST', '/admin/integrations/SMTP_HOST', { value: 'smtp.example.com' }), '运维写凭据')
})

await test('P-03/P-04：手动任务干预 super/sre 可用、dev 1003；联调完成 readonly 1003', async () => {
  const sre = ok(await call(tok('sre'), 'POST', '/admin/system/jobs/attest-reconcile/run', {}))
  assert.ok('affected' in sre, '对账任务返回影响数')
  denied(await call(tok('dev'), 'POST', '/admin/system/jobs/attest-reconcile/run', {}), '开发跑任务')
  denied(await call(tok('readonly'), 'POST', '/admin/system/jobs/attest-reconcile/run', {}), '只读跑任务')
  denied(await call(tok('readonly'), 'POST', '/admin/dev/complete', { orderNo: 'WL-NO-SUCH' }), '只读联调完成订单')
  const cap = ok(await call(tok('readonly'), 'GET', '/admin/capabilities'))
  assert.equal(cap.actions['order.complete'].allowed, false, 'readonly 能力表：order.complete 不可用')
  assert.equal(cap.actions['settle.pay'].allowed, false, 'readonly 能力表：settle.pay 不可用')
  const capOps = ok(await call(tok('ops'), 'GET', '/admin/capabilities'))
  assert.equal(capOps.actions['order.complete'].allowed, true, 'ops 联调完成可用（按钮显示依据）')
  denied(await call(tok('readonly'), 'POST', '/admin/settlements/generate', {}), '只读生成结算单')
  denied(await call(tok('readonly'), 'POST', '/admin/settlements/1/payment', { paymentRef: 'UIQA-P4-000001', note: '测试说明' }), '只读登记回单')
})

await test('P-06：审核员无 taskcash 模块；task-cash 接口对 review/readonly 拒绝', async () => {
  const cap = ok(await call(tok('review'), 'GET', '/admin/capabilities'))
  assert.ok(!cap.modules.includes('taskcash'), 'review 默认不含 taskcash（前端门控依据）')
  denied(await call(tok('review'), 'GET', '/admin/task-cash'), '审核读现金打款全表')
  denied(await call(tok('readonly'), 'GET', '/admin/task-cash'), '只读读现金打款全表')
  ok(await call(tok('finance'), 'GET', '/admin/task-cash'))
})

await test('P-07：会员等级字典跟随 users 模块——risk 200，无 users 的角色拒绝', async () => {
  ok(await call(tok('risk'), 'GET', '/admin/member/levels'))
  denied(await call(tok('city_partner'), 'GET', '/admin/member/levels'), '城市无 users 模块')
  denied(await call(tok('readonly'), 'GET', '/admin/member/levels'), '只读无 users 模块')
  denied(await call(tok('review'), 'GET', '/admin/member/levels'), '审核无 users 模块')
})

await test('P-08：风控关键词搜索（kind 列）+ 复合筛选 + 分页 + 注入式字符串按普通关键词', async () => {
  const stamp = 'PMX' + Math.random().toString(36).slice(2, 8)
  await q(`INSERT INTO risk_event (kind, detail, handled, severity) VALUES
    ('attest_fail', JSON_OBJECT('kw', ?, 'note', '关键词命中说明'), 0, 2),
    ('refund_abuse', JSON_OBJECT('kw', ?, 'note', '已处理'), 1, 1)`, [stamp, stamp])
  const hit = ok(await call(tok('risk'), 'GET', '/admin/risk?kw=' + encodeURIComponent(stamp)))
  assert.equal(hit.total, 2, '关键词命中两类事件')
  const handled0 = ok(await call(tok('risk'), 'GET', '/admin/risk?kw=' + encodeURIComponent(stamp) + '&handled=0&page=1&pageSize=1'))
  assert.equal(handled0.total, 1, '关键词+处理状态复合筛选')
  assert.equal(handled0.rows.length, 1, '分页生效')
  const inj = ok(await call(tok('risk'), 'GET', '/admin/risk?kw=' + encodeURIComponent("%' OR 1=1--")))
  assert.ok(Number.isInteger(inj.total), '注入式字符串按普通关键词处理，total 仍为数字')
  assert.ok(inj.total <= 1, '注入不扩大结果集')
  const empty = ok(await call(tok('risk'), 'GET', '/admin/risk?kw=' + encodeURIComponent('肯定不存在的词' + stamp)))
  assert.equal(empty.total, 0, '无结果返回 0 而不是报错')
  const both = ok(await call(tok('risk'), 'GET', '/admin/risk?kw=attest'))
  assert.ok(Number.isInteger(both.total), '原始复现词 attest 正常返回')
  await q(`DELETE FROM risk_event WHERE detail LIKE ?`, [stamp + '%'])
})

await test('P-08：越界分页被收敛；非业务异常不回显内部细节（带追踪号）', async () => {
  const big = ok(await call(tok('risk'), 'GET', '/admin/risk?pageSize=99999'))
  assert.ok(big.pageSize <= 100, 'pageSize 越界被收敛到上限内')
  // 触发真正的非业务异常（SQL 绑定参数非法）：响应必须是 9000 + 中文信息 + 追踪号，不出现 SQL 细节
  const bad = await call(tok('super'), 'GET', '/admin/attest/batch/notanumber')
  assert.equal(bad.code, 9000, '非业务异常应走 9000 系统错误路径：' + JSON.stringify(bad).slice(0, 200))
  const msg = (bad.data && bad.data.message) || bad.msg || ''
  assert.ok(!/SQL|Unknown column|SELECT|FROM/i.test(msg), '系统错误不得回显 SQL 细节：' + msg)
  assert.ok(/追踪号 t/.test(msg), '系统错误带追踪号：' + msg)
})

console.log(`\n${passed} 组通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
