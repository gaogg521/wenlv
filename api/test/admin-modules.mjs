// 批次 C 回归：C-04 模块单一数据源与角色默认基线（隔离库，需服务在跑）
// §5.1 基线对账（三向 + 快照）：
//   1) capabilities.modules(接口) == src/domain/modules.mjs ROLE_DEFAULT_MODULES（单一数据源一致性）
//   2) admin_role_module（V54 种子落库）== ROLE_DEFAULT_MODULES（迁移固化一致性）
//   3) ROLE_DEFAULT_MODULES == 本文件的基线快照（防止 modules.mjs 被无意改动漂移）
// 另覆盖：super=50 全集、readonly/sre/dev 不再全菜单（D-01）、未知角色默认拒绝。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-modules.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { MODULES, MODULE_KEYS, ROLE_DEFAULT_MODULES, effectiveModules } from '../src/domain/modules.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (tok, method, path, body) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const tok = (role) => jwtSign({ end: 'admin', role, name: '模块基线-' + role })
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

// §5.1 基线快照：2026-11-05 开工（SHA 700f727）时 core.js access 表的实际计算结果；
// readonly/sre/dev 为 D-01 显式默认（原缺省放行全菜单属缺陷，不作为基线）。
const BASELINE = {
  ops: ['users', 'dash', 'orders', 'tickets', 'entitlements', 'fund', 'reviewqueue', 'products', 'merchants', 'content', 'tasks', 'faqs', 'banners', 'promoters', 'agreements', 'kyc', 'cocreate', 'partners', 'partnerperf', 'scenics', 'contentdash', 'contentcases', 'taskcash'],
  finance: ['dash', 'orders', 'fund', 'settlements', 'withdrawals', 'agreements', 'budgets', 'audit', 'cocreate', 'entitlements', 'partners', 'partnerperf', 'scenics', 'taskcash', 'config'],
  review: ['content', 'tasks', 'reviewqueue', 'contentdash', 'contentcases'],
  risk: ['risk', 'users', 'conflicts', 'audit', 'entitlements', 'cases'],
  city_partner: ['dash', 'orders', 'tickets', 'products', 'merchants', 'settlements', 'cases', 'partners', 'partnerperf', 'scenics', 'contentdash', 'contentcases'],
  readonly: ['dash', 'orders', 'products', 'merchants', 'scenics', 'settlements', 'contentdash', 'partners', 'partnerperf'],
  sre: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest'],
  dev: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest', 'features', 'terms'],
}
const setEq = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
const superTok = tok('super')
const stamp = 'MODQA' + Math.random().toString(36).slice(2, 8)
const made = { admins: [] }
const mkAccount = async (role) => {
  const name = 'modqa-' + stamp + '-' + Math.random().toString(36).slice(2, 6)
  const r = ok(await call(superTok, 'POST', '/admin/accounts', { username: name, displayName: name + '显示名', role, password: 'Modqa!' + stamp + 'A1', scopeCity: role === 'city_partner' ? '310118' : undefined }))
  return r.id
}
void stamp

try {
  await test('模块清单：50 个模块、分组与图标齐全、key 无重复', async () => {
    assert.equal(MODULES.length, 50, '模块总数 50（与历史 NAV 一致）')
    assert.equal(new Set(MODULE_KEYS).size, 50, 'key 无重复')
    for (const m of MODULES) { assert.ok(m.key && m.name && m.group && m.icon, '模块字段齐全：' + m.key) }
  })

  await test('§5.1 基线：各角色 capabilities.modules 与快照零差异（含 readonly/sre/dev 显式默认）', async () => {
    for (const role of Object.keys(BASELINE)) {
      const d = ok(await call(tok(role), 'GET', '/admin/capabilities'))
      assert.ok(setEq(d.modules, BASELINE[role]), role + ' 集合与基线不一致：' + JSON.stringify({ api: d.modules.sort(), baseline: [...BASELINE[role]].sort() }))
      assert.ok(setEq(d.modules, ROLE_DEFAULT_MODULES[role]), role + ' 与 modules.mjs 不一致')
      if (['readonly', 'sre', 'dev'].includes(role)) assert.ok(d.modules.length < 50, role + ' 不再全菜单（D-01）')
    }
  })

  await test('V54 种子：admin_role_module 落库集合与单一数据源一致', async () => {
    const rows = await q('SELECT role, module_key FROM admin_role_module')
    const byRole = {}
    for (const r of rows) (byRole[r.role] = byRole[r.role] || []).push(r.module_key)
    for (const role of Object.keys(BASELINE)) {
      assert.ok(setEq(byRole[role] || [], ROLE_DEFAULT_MODULES[role]), role + ' 种子与 modules.mjs 不一致')
    }
    assert.ok(!rows.some((r) => r.role === 'super'), 'super 不入表（代码恒为全部）')
  })

  await test('super 全集；未知角色默认拒绝（空集合）', async () => {
    const d = ok(await call(tok('super'), 'GET', '/admin/capabilities'))
    assert.ok(setEq(d.modules, MODULE_KEYS), 'super 恒为全部 50')
    assert.equal(d.allModules.length, 50, 'allModules 唯一清单随接口下发')
    const ghost = ok(await call(tok('mystery_role'), 'GET', '/admin/capabilities'))
    assert.deepEqual(ghost.modules, [], '未知角色默认拒绝')
    assert.equal(effectiveModules(undefined).length, 0, '代码侧未知角色同样为空')
  })

  await test('allModules 与前端旧 NAV 结构等价（分组顺序与中文名一致）', async () => {
    const d = ok(await call(tok('super'), 'GET', '/admin/capabilities'))
    const groups = [...new Set(d.allModules.map((m) => m.group))]
    assert.deepEqual(groups, ['经营总览', '商品与资源', '订单履约', '用户与权益', '内容运营', '合伙人与推广', '资金结算', '渠道装修', '可信存证', '系统治理'], '分组与顺序一致')
    assert.equal(d.allModules.find((m) => m.key === 'cases').name, '风控案件', 'V-09 模块中文名')
    assert.equal(d.allModules.find((m) => m.key === 'reviewqueue').name, '审核队列', '中文名与旧 NAV 一致')
  })

  await test('C-05 账号三态：读回/保存校验（原因必填、模块无效、super 拒改）', async () => {
    const uid = await mkAccount('finance')
    made.admins.push(uid)
    assert.equal((await call(superTok, 'GET', `/admin/accounts/${uid}/modules`)).code, 0)
    assert.equal((await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'risk', effect: 'allow' }], reason: '短' })).code, 1001, '原因太短')
    assert.equal((await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'bogus', effect: 'allow' }], reason: '原因测试四字' })).code, 1001, '模块无效')
    assert.equal((await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [] , reason: '原因测试四字' })).code, 1001, '空调整拒绝')
    const superId = Number((await one("SELECT id FROM admin_user WHERE username='admin'")).id)
    assert.equal((await call(superTok, 'POST', `/admin/accounts/${superId}/modules`, { grants: [{ moduleKey: 'risk', effect: 'deny' }], reason: '原因测试四字' })).code, 1001, 'super 恒全部不可改')

  })

  await test('C-05/D-04 正例：财务额外授「风控事件」→ GET /admin/risk 200；收回 → 1003；旧会话失效', async () => {
    const uid = await mkAccount('finance')
    made.admins.push(uid)
    // 用真实登录拿带 uid/ver 的令牌（授权针对 uid）
    const u = await one('SELECT username FROM admin_user WHERE id = ?', [uid])
    const loginTok = async () => {
      const l = await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.username, password: 'Modqa!' + stamp + 'A1' }) })).json()
      return l
    }
    const l1 = await loginTok()
    assert.equal(l1.code, 0)
    // 财务默认无 risk 模块 → GET /admin/risk 1003（映射强制）
    const before = await call(l1.data.token, 'GET', '/admin/risk')
    assert.equal(before.code, 1003, '财务默认不能读风控事件：' + before.msg)
    // 额外授予 risk → 旧会话失效 → 重新登录 → 200
    ok(await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'risk', effect: 'allow' }], reason: stamp + ' 临时协助风控核查' }))
    const kicked = await call(l1.data.token, 'GET', '/admin/risk')
    assert.equal(kicked.code, 1002, '授权变更后旧会话失效')
    const l2 = await loginTok()
    const granted = await call(l2.data.token, 'GET', '/admin/risk')
    assert.equal(granted.code, 0, '授予后财务可读风控事件（D-04 正例）：' + granted.msg)
    // 授予 risk 查看不顺带获得处置（POST handle 仍受内部角色限制）与案件模块
    const caseDenied = await call(l2.data.token, 'GET', '/admin/risk-cases')
    assert.equal(caseDenied.code, 1003, '授 risk 不等于授 cases')
    // 收回 → 重新登录 → 1003；能力弹窗数据 effective 不含 risk
    ok(await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'risk', effect: null }], reason: stamp + ' 协查结束收回' }))
    const l3 = await loginTok()
    const after = await call(l3.data.token, 'GET', '/admin/risk')
    assert.equal(after.code, 1003, '收回后 1003')
    const detail = ok(await call(superTok, 'GET', `/admin/accounts/${uid}/modules`))
    assert.ok(!detail.effective.includes('risk'), '有效集合不含 risk')
    assert.ok(!detail.grants.some((g) => g.module_key === 'risk'), '三态已清除（回到继承）')
  })

  await test('C-05 城市边界：城市账号不可被授予 CITY_DENY 模块；角色矩阵改默认踢全角色会话', async () => {
    const uid = await mkAccount('city_partner')
    made.admins.push(uid)
    const r = await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'config', effect: 'allow' }], reason: stamp + ' 尝试授予参数中心' })
    assert.equal(r.code, 1003, '城市账号不可被授予超管模块：' + r.msg)
    // 允许授予的城市模块（如 products 已默认）→ deny 后生效
    ok(await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'merchants', effect: 'deny' }], reason: stamp + ' 试点期间收回商户模块' }))
    const d = ok(await call(superTok, 'GET', `/admin/accounts/${uid}/modules`))
    assert.ok(!d.effective.includes('merchants'), '城市账号 deny 生效')
    ok(await call(superTok, 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'merchants', effect: null }], reason: stamp + ' 恢复商户模块' }))
    // 角色矩阵：收回 readonly 的 dash → readonly 登录 capabilities 无 dash；恢复后回来
    ok(await call(superTok, 'POST', '/admin/role-modules', { role: 'readonly', moduleKey: 'dash', on: false, reason: stamp + ' 矩阵回归测试收回' }))
    const ro = ok(await call(tok('readonly'), 'GET', '/admin/capabilities'))
    assert.ok(!ro.modules.includes('dash'), '角色默认变更影响该角色')
    ok(await call(superTok, 'POST', '/admin/role-modules', { role: 'readonly', moduleKey: 'dash', on: true, reason: stamp + ' 矩阵回归测试恢复' }))
    const ro2 = ok(await call(tok('readonly'), 'GET', '/admin/capabilities'))
    assert.ok(ro2.modules.includes('dash'), '恢复后回来')
    // 城市角色不可授予名单：矩阵同样拒绝
    const rm = await call(superTok, 'POST', '/admin/role-modules', { role: 'city_partner', moduleKey: 'accounts', on: true, reason: stamp + ' 尝试矩阵授予' })
    assert.equal(rm.code, 1003, '矩阵侧城市不可授予：' + rm.msg)
  })

  await test('C-05 越权：非超管不能读写模块授权与角色矩阵', async () => {
    const uid = await mkAccount('ops')
    made.admins.push(uid)
    assert.equal((await call(tok('ops'), 'GET', `/admin/accounts/${uid}/modules`)).code, 1003)
    assert.equal((await call(tok('ops'), 'POST', `/admin/accounts/${uid}/modules`, { grants: [{ moduleKey: 'risk', effect: 'allow' }], reason: '越权原因测试四字' })).code, 1003)
    assert.equal((await call(tok('ops'), 'GET', '/admin/role-modules')).code, 1003)
    assert.equal((await call(tok('ops'), 'POST', '/admin/role-modules', { role: 'ops', moduleKey: 'audit', on: true, reason: '越权原因测试四字' })).code, 1003)
  })

  await test('C-05 直调抽测：前端隐藏的模块接口非授权角色一律 1003（20 个超管模块代表路由）', async () => {
    const hidden = [
      ['GET', '/admin/security/accounts'], ['GET', '/admin/security/channels'], ['GET', '/admin/security/recent-codes'],
      ['GET', '/admin/accounts'], ['GET', '/admin/role-modules'],
      ['GET', '/admin/config'], ['GET', '/admin/config/history'], ['GET', '/admin/features'],
      ['GET', '/admin/integrations'], ['GET', '/admin/system/overview'], ['GET', '/admin/system/logs'],
      ['GET', '/admin/web3/point-assets'], ['GET', '/admin/web3/badges'], ['GET', '/admin/web3/wallets'],
      ['GET', '/admin/web3/chain'], ['GET', '/admin/web3/assets'], ['GET', '/admin/web3/vc'],
      ['GET', '/admin/chain/hub'], ['GET', '/admin/attest/center'], ['GET', '/admin/creators'],
    ]
    // 每条代表路由：四个业务角色 + 无绑城市账号都要 1003；super 要 0
    for (const [method, path] of hidden) {
      for (const role of ['ops', 'finance', 'review', 'risk']) {
        const r = await call(tok(role), method, path)
        assert.equal(r.code, 1003, `${role} 直调 ${path} 应 1003，实际 ${r.code} ${r.msg || ''}`)
      }
      const cityR = await call(jwtSign({ end: 'admin', role: 'city_partner', name: '直调-无城' }), method, path)
      assert.equal(cityR.code, 1003, `无城城市账号直调 ${path} 应 1003`)
      const s = await call(superTok, method, path)
      assert.equal(s.code, 0, `super 直调 ${path} 应可用：${s.msg || ''}`)
    }
  })

  console.log(`\n${passed} 项批次 C/D（C-04 基线 + C-05 可配置授权）回归通过`)
} finally {
  for (const id of made.admins) {
    await q('DELETE FROM admin_user WHERE id = ?', [id]).catch(() => {})
    await q('DELETE FROM admin_user_module WHERE user_id = ?', [id]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='account' AND biz_ref = ?", ['admin-' + id]).catch(() => {})
  }
  await q("DELETE FROM audit_log WHERE module='account' AND action='role-module'").catch(() => {})
  // 角色矩阵用例会临时收回 readonly/dash：结束后恢复种子行（V54 基线快照）
  await q("INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES ('readonly','dash','manage')").catch(() => {})
  await closeDb()
}
