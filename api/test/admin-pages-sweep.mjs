// R-04 普查矩阵回归（QA-07 整改版）：七身份 × 有效模块 × 模块主接口全 200（菜单可见=接口可达）。
// Codex 复验整改：套件自建七角色夹具账号（含 sweep-* 与 city 演示账号的兜底创建），不依赖旧库遗留；
// finally 精确清理本次创建的账号；全新隔离库从迁移、seed 到本套件开箱即跑。
// 普查曾发现 3 个"菜单可见接口拒"缺陷（risk+entitlements、readonly+partners/partnerperf）并已修复。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-pages-sweep.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 18095)
const call = async (m, p, t) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t } })).json()
const PRIMARY = {
  dash: '/admin/dash/kpi', products: '/admin/products', merchants: '/admin/merchants', scenics: '/admin/scenics',
  suppliers: '/admin/suppliers', orders: '/admin/orders/search?pageSize=5', tickets: '/admin/tickets?page=1',
  phrases: '/admin/phrases?pageSize=5', conflicts: '/admin/verify/conflicts', users: '/admin/users/stats',
  kyc: '/admin/kyc', wallets: '/admin/web3/wallets', badges: '/admin/web3/badges', entitlements: '/admin/entitlements?page=1',
  contentdash: '/admin/content-dashboard', reviewqueue: '/admin/review-queue', content: '/admin/content?page=1',
  contentcases: '/admin/content-cases?kind=reports&page=1', tasks: '/admin/content-tasks?page=1', creators: '/admin/creators?pageSize=5',
  partners: '/admin/partners?page=1', partnerperf: '/admin/partner-performance?kind=city', promoters: '/admin/promoters',
  fund: '/admin/fund-workbench', settlements: '/admin/settlements', withdrawals: '/admin/withdrawals',
  taskcash: '/admin/task-cash', agreements: '/admin/agreements', budgets: '/admin/budgets', rateov: '/admin/rate-overrides?pageSize=5',
  cocreate: '/admin/co-creators', miniapp: '/admin/entities/site/1', banners: '/admin/banners', faqs: '/admin/faqs',
  web3dash: '/admin/web3/chain', attest: '/admin/attest/center', vc: '/admin/web3/vc', pointassets: '/admin/web3/point-assets',
  chainassets: '/admin/web3/assets', chainhub: '/admin/chain/hub', terms: '/admin/lexicon',
  risk: '/admin/risk?page=1', audit: '/admin/audit-logs?pageSize=5', security: '/admin/security/accounts',
  accounts: '/admin/accounts', cases: '/admin/risk-cases?page=1', config: '/admin/config',
  features: '/admin/features', integrations: '/admin/integrations', system: '/admin/system/overview',
}
const stamp = 'SWP' + Math.random().toString(36).slice(2, 8)
// 七身份：super/admin 恒在；其余本套件自建（含城市账号，绑 310118 与种子演示口径一致）
const ROLES = [
  ['super', 'admin', 'admin123', null, false],
  ['ops', 'ops', 'admin123', null, false],
  ['finance', 'finance', 'admin123', null, false],
  ['review', 'review', 'admin123', null, false],
  ['risk', 'sweep-risk-' + stamp, 'Sweep!' + stamp + 'A1', null, true],
  ['readonly', 'sweep-readonly-' + stamp, 'Sweep!' + stamp + 'A1', null, true],
  ['city_partner', 'sweep-city-' + stamp, 'Sweep!' + stamp + 'A1', '310118', true],
  // P-12：sre/dev 此前不在矩阵里（整页失败缺陷 P-03 的盲区），纳入九身份
  ['sre', 'sweep-sre-' + stamp, 'Sweep!' + stamp + 'A1', null, true],
  ['dev', 'sweep-dev-' + stamp, 'Sweep!' + stamp + 'A1', null, true],
]
const made = []
const results = []
let pass = 0, fail = 0
try {
  for (const [role, username, password, scopeCity, mine] of ROLES) {
    if (mine) {
      const exists = await one('SELECT id FROM admin_user WHERE username = ?', [username])
      if (!exists) {
        await q('INSERT INTO admin_user (username, display_name, password_hash, role, scope_city, status, token_epoch) VALUES (?,?,?,?,?,1,1)',
          [username, username + '显示名', hashPassword(password), role, scopeCity])
      }
      made.push(username)
    }
  }
  // 也要确保 admin/ops/finance/review 在全新库存在（seed:scenario 首启种子创建；若缺失则补）
  for (const [role, username, password] of ROLES.slice(0, 4)) {
    const u = await one('SELECT id, password_hash FROM admin_user WHERE username = ?', [username])
    if (!u) { await q('INSERT INTO admin_user (username, display_name, password_hash, role, status, token_epoch) VALUES (?,?,?,?,1,1)', [username, username, hashPassword(password), role]); made.push(username) }
  }
  for (const [role, username, password] of ROLES) {
    const l = await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()
    if (l.code !== 0) { results.push({ role, fatal: '登录失败: ' + l.msg }); fail++; continue }
    const T = l.data.token
    const cap = await call('GET', '/admin/capabilities', T)
    for (const mod of cap.data.modules) {
      const api = PRIMARY[mod]
      if (!api) { results.push({ role, mod, note: 'no-primary' }); continue }
      const r = await call('GET', api, T)
      const okr = r.code === 0
      if (okr) pass++; else fail++
      results.push({ role, mod, api, code: r.code, ok: okr, msg: okr ? undefined : r.msg })
    }
  }
  // P-12：页面子请求也要成对受控——共享字典/资金接口按模块授权同向：
  //   有 users 模块的角色 member/levels 必须 200；没有的必须 1003（不得静默降级为空）
  //   有 taskcash 模块的角色 task-cash 必须 200；没有的必须 1003
  const SUBS = [
    ['users', '/admin/member/levels'],
    ['taskcash', '/admin/task-cash'],
    ['audit', '/admin/audit-logs?page=1&pageSize=5'],
    ['chainhub', '/admin/chain/hub'],
    ['integrations', '/admin/integrations'],
  ]
  let subPass = 0, subFail = 0
  for (const [role, username, password, , mine] of ROLES) {
    const l = await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()
    if (l.code !== 0) continue
    const T = l.data.token
    const cap = (await call('GET', '/admin/capabilities', T)).data
    const has = (m) => cap.modules.includes(m)
    for (const [mod, api] of SUBS) {
      if (mod === 'chainhub' || mod === 'integrations') {
        // P-03：这两个视图 super/sre/dev 可读（运维只读视图），其他按模块
        const should = has(mod) || ['sre', 'dev'].includes(role)
        const r = await call('GET', api, T)
        const okr = should ? r.code === 0 : r.code === 1003
        if (okr) subPass++; else { subFail++; results.push({ role, mod: 'sub:' + mod, api, code: r.code, ok: false, msg: r.msg }) }
        continue
      }
      const should = has(mod)
      const r = await call('GET', api, T)
      const okr = should ? r.code === 0 : r.code === 1003
      if (okr) subPass++; else { subFail++; results.push({ role, mod: 'sub:' + mod, api, code: r.code, ok: false, msg: r.msg }) }
    }
  }
  console.log(`R-04 矩阵普查（QA-07 自建夹具，P-12 九身份）：${pass} 主接口通过 / ${fail} 失败；${subPass} 子请求受控通过 / ${subFail} 失败`)
  for (const r of results) if (r.ok === false) console.log('  FAIL', r.role, r.mod, r.api, '->', r.code, r.msg)
  if (fail || subFail) process.exitCode = 1
} finally {
  // 精确清理：只删本套件创建的账号与其审计（admin/ops 等公共账号不动）
  for (const username of made) {
    await q('DELETE FROM admin_user WHERE username = ?', [username]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='account' AND biz_ref = ?", ['admin-' + username]).catch(() => {})
  }
  await closeDb().catch(() => {})
  process.exitCode = process.exitCode || (fail ? 1 : 0)
}
