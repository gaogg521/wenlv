// R-04 普查矩阵回归：七身份 × 有效模块 × 模块主接口全 200（菜单可见=接口可达）。
// 普查曾发现 3 个"菜单可见接口拒"缺陷（risk+entitlements、readonly+partners/partnerperf）并已修复。
import { closeDb } from '../src/db.mjs'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-pages-sweep.mjs')
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
const ROLES = [
  ['super', 'admin', 'admin123'], ['ops', 'ops', 'admin123'], ['finance', 'finance', 'admin123'],
  ['review', 'review', 'admin123'], ['risk', 'sweep-risk', 'admin123'], ['readonly', 'sweep-readonly', 'admin123'],
  ['city_partner', 'city310118', 'city123'],
]
const results = []
let pass = 0, fail = 0
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
console.log(`R-04 矩阵普查：${pass} 通过 / ${fail} 失败`)
for (const r of results) if (r.ok === false) console.log('  FAIL', r.role, r.mod, r.api, '->', r.code, r.msg)
await closeDb().catch(() => {})
process.exitCode = fail ? 1 : 0
