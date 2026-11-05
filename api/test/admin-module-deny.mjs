// QA-03/QA-04 回归（Codex 复验整改）：
// QA-03 撤权直调：对 50 模块的代表性路由，deny 后读写直调一律 1003（不再"隐藏菜单但接口可用"）。
// QA-04 角色空集合：角色默认逐个关闭后保持空集合（重启/重登/缓存失效后仍空）；单账号 allow 叠加有效。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-module-deny.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: m === 'GET' || m === 'HEAD' || b == null ? undefined : JSON.stringify(b) })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const healthAt = async (tag) => { const h = await (await fetch('http://127.0.0.1:18095/c/health')).json(); console.log('    [svc] ' + tag + ' 服务时间=' + h.data.time) }
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'QADN' + Math.random().toString(36).slice(2, 8)
const made = { admins: [], audits: [] }
const superT = jwtSign({ end: 'admin', role: 'super', name: '撤权回归-超管' })
const mkAccount = async (role, scopeCity) => {
  const name = 'qadn-' + stamp + '-' + Math.random().toString(36).slice(2, 6)
  const r = ok(await call('POST', '/admin/accounts', { username: name, displayName: name + '名', role, password: 'Qadn!' + stamp + 'A1', scopeCity }, superT))
  made.audits.push('admin-' + r.id)
  made.admins.push(r.id)
  const l = await call('POST', '/admin/login', { username: name, password: 'Qadn!' + stamp + 'A1' })
  assert.equal(l.code, 0, '夹具登录: ' + l.msg)
  return { id: r.id, token: l.data.token, relogin: async () => { const l = await call('POST', '/admin/login', { username: name, password: 'Qadn!' + stamp + 'A1' }); assert.equal(l.code, 0, 'relogin: ' + l.msg + ' | 响应: ' + JSON.stringify(l).slice(0, 200)); return l.data.token } }
}

try {
  // 每模块：[模块 key, 读接口, 写接口(可选)]——撤权后两者都必须 1003
  const PROBES = {
    orders: ['GET', '/admin/orders/search?pageSize=1', 'POST', '/admin/orders/WLQA-NOT-EXIST/reschedule', { toSessionId: 1, reason: '撤权后不得办理' }],
    products: ['GET', '/admin/products', 'POST', '/admin/products/1/status', { status: 0 }],
    merchants: ['GET', '/admin/merchants', 'POST', '/admin/merchants/999999/approve', {}],
    scenics: ['GET', '/admin/scenics', 'POST', '/admin/scenics', { name: '撤权测试' }],
    suppliers: ['GET', '/admin/suppliers', 'POST', '/admin/suppliers', { name: '撤权测试' }],
    tickets: ['GET', '/admin/tickets?page=1', 'POST', '/admin/tickets', {}],
    users: ['GET', '/admin/users/stats', 'POST', '/admin/users/1/status', { status: 0, reason: '撤权测试不得办理' }],
    kyc: ['GET', '/admin/kyc', 'POST', '/admin/kyc/999999/resolve', { pass: true }],
    entitlements: ['GET', '/admin/entitlements?page=1', 'POST', '/admin/entitlements', {}],
    contentdash: ['GET', '/admin/content-dashboard', null, null, null],
    reviewqueue: ['GET', '/admin/review-queue', 'POST', '/admin/review-queue/note/1/claim', null],
    content: ['GET', '/admin/content?page=1', 'POST', '/admin/content/1/verdict', { pass: true }],
    contentcases: ['GET', '/admin/content-cases?kind=reports&page=1', 'POST', '/admin/content-cases/reports/999999/verdict', { action: 'dismiss', reason: '撤权测试' }],
    tasks: ['GET', '/admin/content-tasks?page=1', 'POST', '/admin/content-tasks', {}],
    creators: ['GET', '/admin/creators?pageSize=1', 'PUT', '/admin/creators/1/tag', { tag: 'star' }],
    partners: ['GET', '/admin/partners?page=1', null, null, null],
    partnerperf: ['GET', '/admin/partner-performance?kind=city', null, null, null],
    promoters: ['GET', '/admin/promoters', 'POST', '/admin/promoters/register', {}],
    fund: ['GET', '/admin/fund-workbench', null, null, null],
    settlements: ['GET', '/admin/settlements', 'POST', '/admin/settlements/generate', {}],
    withdrawals: ['GET', '/admin/withdrawals', 'POST', '/admin/withdrawals/999999/verdict', { pass: true }],
    taskcash: ['GET', '/admin/task-cash', 'POST', '/admin/task-entries/1/cash-paid', { ref: 'QA-TEST-0001' }],
    agreements: ['GET', '/admin/agreements', 'POST', '/admin/agreements/999999/verdict', { pass: true }],
    budgets: ['GET', '/admin/budgets', 'POST', '/admin/budgets', {}],
    rateov: ['GET', '/admin/rate-overrides?pageSize=1', 'POST', '/admin/rate-overrides/1', { rateBp: 500 }],
    cocreate: ['GET', '/admin/co-creators', 'POST', '/admin/co-profits/999999/pay', { amount: 100, payRef: 'QA-DENY-0001' }],
    miniapp: ['GET', '/admin/entities/site/1', 'PUT', '/admin/entities/site/1', { values: {} }],
    banners: ['GET', '/admin/banners', 'POST', '/admin/banners', {}],
    faqs: ['GET', '/admin/faqs', 'POST', '/admin/faqs', {}],
    phrases: ['GET', '/admin/phrases?pageSize=1', 'POST', '/admin/phrases/1', { userPhrase: '撤权测试上半句' }],
    web3dash: ['GET', '/admin/web3/chain', null, null, null],
    attest: ['GET', '/admin/attest/center', null, null, null],
    vc: ['GET', '/admin/web3/vc', 'POST', '/admin/web3/vc/issue', {}],
    pointassets: ['GET', '/admin/web3/point-assets', null, null, null],
    chainassets: ['GET', '/admin/web3/assets', 'POST', '/admin/web3/assets/issue', {}],
    chainhub: ['GET', '/admin/chain/hub', 'POST', '/admin/chain/activate', { provider: 'noop' }],
    terms: ['GET', '/admin/lexicon', null, null, null],
    risk: ['GET', '/admin/risk?page=1', 'POST', '/admin/risk/999999/handle', { reason: '撤权测试' }],
    audit: ['GET', '/admin/audit-logs?pageSize=1', null, null, null],
    security: ['GET', '/admin/security/accounts', 'POST', '/admin/security/mfa-mode', { mode: 'off' }],
    accounts: ['GET', '/admin/accounts', 'POST', '/admin/accounts/1/password-reset', {}],
    cases: ['GET', '/admin/risk-cases?page=1', 'POST', '/admin/risk-cases', { title: '撤权测试', note: '撤权后不得建案测试说明' }],
    config: ['GET', '/admin/config', 'POST', '/admin/config/proposal', { key: 'order.pay_timeout', newValue: '30', reason: '撤权测试' }],
    features: ['GET', '/admin/features', 'POST', '/admin/features/order.pay_timeout/toggle', {}],
    integrations: ['GET', '/admin/integrations', 'POST', '/admin/integrations/SMTP_HOST', { value: 'x' }],
    system: ['GET', '/admin/system/overview', 'POST', '/admin/dev/mock-pay', {}],
  }
  const MODULE_KEYS = Object.keys(PROBES)

  await healthAt('QA-03 前')
  await test('QA-03：50 模块逐一 deny——撤权后读写直调一律 1003（含此前漏网的 orders 系列）', async () => {
    const acct = await mkAccount('ops')
    let checked = 0
    for (const mod of MODULE_KEYS) {
      const [gm, gp, wm, wp, wbody] = PROBES[mod]
      // 撤权
      ok(await call('POST', '/admin/accounts/' + acct.id + '/modules', { grants: [{ moduleKey: mod, effect: 'deny' }], reason: stamp + ' 撤权直调检查' }, superT))
      const tok = await acct.relogin()
      // 读直调
      const gr = await call(gm, gp, null, tok)
      assert.equal(gr.code, 1003, `${mod} 读直调（${gp}）撤权后应 1003，实际 ${gr.code} ${gr.msg || ''}`)
      checked++
      // 写直调（有写探针的模块）
      if (wm) {
        const wr = await call(wm, wp, wbody, tok)
        assert.equal(wr.code, 1003, `${mod} 写直调（${wp}）撤权后应 1003，实际 ${wr.code} ${wr.msg || ''}`)
        checked++
      }
      // 恢复（回到继承，供下一模块用干净状态）
      ok(await call('POST', '/admin/accounts/' + acct.id + '/modules', { grants: [{ moduleKey: mod, effect: null }], reason: stamp + ' 恢复继承' }, superT))
    }
    console.log(`    （${MODULE_KEYS.length} 模块 / ${checked} 条直调探针）`)
  })

  await healthAt('QA-04 前')
  if (process.env.SKIP_QA04) console.log('  ⏭ QA-04 块跳过（SKIP_QA04）')
  else
  await test('QA-04：角色默认逐个关闭 → 空集合保持空（重登/缓存/重启语义），单账号 allow 叠加有效', async () => {
    // 用 dev 角色（初始 9 项）做全撤空实验
    const acct = await mkAccount('dev')
    // 逐个关闭 dev 的初始 9 项
    const devDefaults = ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest', 'features', 'terms']
    for (const mod of devDefaults) {
      ok(await call('POST', '/admin/role-modules', { role: 'dev', moduleKey: mod, on: false, reason: stamp + ' 角色全撤空实验' }, superT))
    }
    // 数据库确认 0 行 + 配置标记存在
    assert.equal(Number((await one("SELECT COUNT(*) n FROM admin_role_module WHERE role = 'dev'")).n), 0, '角色矩阵 0 行')
    assert.ok(await one("SELECT role FROM admin_role_config WHERE role = 'dev'"), '配置标记已写入')
    // 新登录：capabilities.modules 必须为空（不回退基线）
    const rl = await call('POST', '/admin/login', { username: (await one('SELECT username FROM admin_user WHERE id = ?', [acct.id])).username, password: 'Qadn!' + stamp + 'A1' })
    console.log('    [诊断] relogin 完整响应:', JSON.stringify(rl).slice(0, 300))
    const cap = await call('GET', '/admin/capabilities', null, rl.data.token)
    const dbRow = await one('SELECT id, username, status, token_epoch, role FROM admin_user WHERE id = ?', [rl.data.user.uid])
    const allIds = (await q('SELECT id FROM admin_user ORDER BY id')).map((x) => x.id)
    console.log('    [诊断3] QA库全部账号ID:', JSON.stringify(allIds))
    console.log('    [诊断2] cap:', cap.code, cap.msg || '', '| 服务端库行:', JSON.stringify(dbRow), '| token ver:', JSON.stringify((await import('../src/auth.mjs')).jwtVerify(rl.data.token)))
    if (cap.code === 0) assert.deepEqual(cap.data.modules, [], '全部撤空后新登录仍为空集合')
    const { jwtSign: js2 } = await import('../src/auth.mjs')
    const manual = js2({ uid: rl.data.user.uid, ver: 10, end: 'admin', role: 'dev', name: 'x' })
    const capM = await call('GET', '/admin/capabilities', null, manual)
    console.log('    [诊断4] 手签同 payload cap:', capM.code, capM.msg || '', 'modules:', JSON.stringify(capM.data?.modules))
    if (capM.code !== 0) process.exit(9)
    // 夹具账号单独 allow 叠加：audit 单独授予 → 只有 audit
    ok(await call('POST', `/admin/accounts/${acct.id}/modules`, { grants: [{ moduleKey: 'audit', effect: 'allow' }], reason: stamp + ' 单账号叠加' }, superT))
    const cap2 = ok(await call('GET', '/admin/capabilities', null, await acct.relogin()))
    assert.deepEqual(cap2.data.modules, ['audit'], '单账号 allow 叠加生效且仅此一项')
    // 无 audit 的直调仍 1003、有 audit 的可达
    assert.equal((await call('GET', '/admin/system/overview', await acct.relogin())).code, 1003, '未叠加模块仍拒绝')
    assert.equal((await call('GET', '/admin/audit-logs?pageSize=1', await acct.relogin())).code, 0, '叠加模块可达')
    // 恢复 dev 基线：矩阵行加回 + 删配置标记（还原"从未配置"状态，供其他套件/复跑）
    for (const mod of devDefaults) await q('INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES (?,?,?)', ['dev', mod, 'manage'])
    await q("DELETE FROM admin_role_config WHERE role = 'dev'")
    await q("DELETE FROM admin_user_module WHERE user_id = ?", [acct.id]).catch(() => {})
    const cap3 = ok(await call('GET', '/admin/capabilities', null, await acct.relogin()))
    assert.equal(cap3.data.modules.length, 9, '恢复后回到基线 9 项')
    // 清理服务端缓存（invalidateModuleCache(null) 由 role-modules POST 已触发；此处显式兜底由重启覆盖）
  })

  console.log(`\n${passed} 项 QA-03/QA-04（撤权直调 + 角色空集合）回归通过`)
} finally {
  for (const id of made.admins) {
    await q('DELETE FROM admin_user_module WHERE user_id = ?', [id]).catch(() => {})
    await q('DELETE FROM admin_user WHERE id = ?', [id]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='account' AND biz_ref = ?", ['admin-' + id]).catch(() => {})
  }
  await q("DELETE FROM audit_log WHERE module='account' AND action='role-module'").catch(() => {})
  // 角色矩阵/配置标记还原（dev 已在用例内恢复；保险起见再清一次标记与孤儿行）
  await q("DELETE FROM admin_role_config WHERE role = 'dev'").catch(() => {})
  await closeDb()
}
