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
  finance: ['dash', 'orders', 'fund', 'settlements', 'withdrawals', 'agreements', 'budgets', 'audit', 'cocreate', 'entitlements', 'partners', 'partnerperf', 'scenics', 'taskcash'],
  review: ['content', 'tasks', 'reviewqueue', 'contentdash', 'contentcases'],
  risk: ['risk', 'users', 'conflicts', 'audit', 'entitlements', 'cases'],
  city_partner: ['dash', 'orders', 'tickets', 'products', 'merchants', 'settlements', 'cases', 'partners', 'partnerperf', 'scenics', 'contentdash', 'contentcases'],
  readonly: ['dash', 'orders', 'products', 'merchants', 'scenics', 'settlements', 'contentdash', 'partners', 'partnerperf'],
  sre: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest'],
  dev: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest', 'features', 'terms'],
}
const setEq = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

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

  console.log(`\n${passed} 项批次 C（C-04 模块单一数据源与基线）回归通过`)
} finally {
  await closeDb()
}
