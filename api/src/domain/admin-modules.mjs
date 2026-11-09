// C-05：账号级模块授权——有效集合与缓存。
// 有效集合 = super ? 全部 : (角色默认 ∪ allow) − deny（V55 admin_user_module）。
// 城市合伙人叠加 CITY_DENY_MODULES（requireModule 侧强制，授权接口同样拒绝写入）。
// 细粒度约束（ADMIN_ACTIONS 资金动作、双人复核、城市行级隔离）继续生效，模块授权不能绕过（D-05）。
import { q, one } from '../db.mjs'
import { MODULE_KEYS, effectiveModules, CITY_DENY_MODULES } from './modules.mjs'

const CACHE_TTL = 30_000
const cache = new Map() // key -> { set, at }

/** 角色默认：优先 V54 矩阵表（超管可改）。QA-04：admin_role_config 存在该角色的配置标记
 *  时以矩阵表为准（可为空集合——全部撤空必须保持空）；无标记才回退静态基线快照（从未配置）。 */
async function roleDefaultsFromDb(role) {
  const marked = await one('SELECT role FROM admin_role_config WHERE role = ?', [role])
  const rows = await q('SELECT module_key FROM admin_role_module WHERE role = ?', [role])
  if (rows.length || marked) return rows.map((r) => r.module_key)
  return effectiveModules(role)
}

/** 账号有效模块集合（Set）。无 uid 的测试夹具令牌按角色默认处理；角色默认可在矩阵页调整。 */
export async function accountModules(uid, role) {
  if (role === 'super') return new Set(MODULE_KEYS)
  const key = uid == null ? `role:${role}` : `uid:${uid}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.set
  const set = new Set(await roleDefaultsFromDb(role))
  if (uid != null) {
    const rows = await q('SELECT module_key, effect FROM admin_user_module WHERE user_id = ?', [uid])
    for (const r of rows) {
      if (r.effect === 'allow') set.add(r.module_key)
      else set.delete(r.module_key)
    }
  }
  cache.set(key, { set, at: Date.now() })
  return set
}

export function invalidateModuleCache(uid) {
  if (uid == null) cache.clear()
  else { cache.delete('uid:' + uid); cache.delete('role:*') }
}

/** 授权接口侧的城市不可授予名单校验（requireModule 侧二次强制） */
export const cityDenyHit = (moduleKey) => CITY_DENY_MODULES.includes(moduleKey) ? CITY_DENY_MODULES : null

/**
 * D-06：method+path → module 显式映射（数组顺序即优先级，较具体路由在前）。
 * :xxx 为路径参数占位。第一期：映射命中的路由在 index.mjs 统一跑 requireModule，
 * 与路由内既有角色校验取交集（不放松）；逐批迁移完毕后再移除对应 requireAdmin 角色硬编码。
 * GET 不等于无敏感副作用，POST 不等于一律办理——按业务语义逐条登记，不按动词粗分。
 */
export const ROUTE_MODULES = [
  // 风控事件：查看 / 处置
  ['GET', '/admin/risk', 'risk', 'view'],
  ['POST', '/admin/risk/:id/handle', 'risk', 'manage'],
  // 风控案件：查看 / 建案 / 时间线 / 状态流转
  ['GET', '/admin/risk-cases', 'cases', 'view'],
  ['GET', '/admin/risk-cases/:id', 'cases', 'view'],
  ['POST', '/admin/risk-cases', 'cases', 'manage'],
  ['POST', '/admin/risk-cases/:id/note', 'cases', 'manage'],
  ['POST', '/admin/risk-cases/:id/:action', 'cases', 'manage'],
  // 审计日志（finance/risk 默认可见；模块授权可扩展/收回）
  ['GET', '/admin/audit-logs', 'audit', 'view'],
  // 提现审批（资金敏感：查看与裁决同一模块，动作另有 ADMIN_ACTIONS 细粒度）
  ['GET', '/admin/withdrawals', 'withdrawals', 'view'],
  ['POST', '/admin/withdrawals/:id/verdict', 'withdrawals', 'manage'],
  // 系统治理 / 超管模块（D-06 批次 2：仅映射"只被本模块页面调用"的接口；
  // 供应商列表、逐品佣金、核销暗号、参数提案/审批等被其他模块页面引用的接口暂不映射，
  // 记录于进度台账决策 9——避免跨模块下拉/引用被静默掐断）
  ['GET', '/admin/security/accounts', 'security', 'view'],
  ['POST', '/admin/security/mfa/setup', 'security', 'manage'],
  ['POST', '/admin/security/bind-contact', 'security', 'manage'],
  ['POST', '/admin/security/mfa/disable', 'security', 'manage'],
  ['POST', '/admin/security/mfa-mode', 'security', 'manage'],
  ['GET', '/admin/security/channels', 'security', 'view'],
  ['GET', '/admin/security/recent-codes', 'security', 'view'],
  ['GET', '/admin/accounts', 'accounts', 'view'],
  ['POST', '/admin/accounts', 'accounts', 'manage'],
  ['GET', '/admin/accounts/:id/modules', 'accounts', 'view'],
  ['POST', '/admin/accounts/:id/modules', 'accounts', 'manage'],
  ['GET', '/admin/role-modules', 'accounts', 'view'],
  ['POST', '/admin/role-modules', 'accounts', 'manage'],
  ['GET', '/admin/config', 'config', 'view'],
  ['GET', '/admin/config/history', 'config', 'view'],
  ['GET', '/admin/features', 'features', 'view'],
  ['POST', '/admin/features/:key/toggle', 'features', 'manage'],
  ['GET', '/admin/integrations', 'integrations', 'view'],
  ['POST', '/admin/integrations/:key', 'integrations', 'manage'],
  ['DELETE', '/admin/integrations/:key', 'integrations', 'manage'],
  ['GET', '/admin/system/overview', 'system', 'view'],
  ['GET', '/admin/system/logs', 'system', 'view'],
  ['POST', '/admin/system/jobs/:name/run', 'system', 'manage'],
  ['GET', '/admin/web3/point-assets', 'pointassets', 'view'],
  ['GET', '/admin/web3/badges', 'badges', 'view'],
  ['GET', '/admin/web3/wallets', 'wallets', 'view'],
  ['GET', '/admin/web3/wallets/:userId', 'wallets', 'view'],
  ['GET', '/admin/web3/chain', ['web3dash', 'chainassets'], 'view'],
  ['GET', '/admin/web3/assets', 'chainassets', 'view'],
  ['GET', '/admin/web3/vc', 'vc', 'view'],
  ['GET', '/admin/web3/identities', 'vc', 'view'],
  ['GET', '/admin/web3/identity/:userId', 'vc', 'view'],
  ['GET', '/admin/chain/hub', 'chainhub', 'view'],
  ['GET', '/admin/attest/center', 'attest', 'view'],
  ['GET', '/admin/attest/batch/:id', 'attest', 'view'],
  ['GET', '/admin/attest/bean-day/:date', 'attest', 'view'],
  ['GET', '/admin/attest/search', 'attest', 'view'],
  ['GET', '/admin/attest/flow/:orderNo', 'attest', 'view'],
  ['GET', '/admin/creators', 'creators', 'view'],
  // D-06 批次 3：核心业务路由收敛（消费面已核对——orders 系列因首页/画像跨模块下钻暂缓，
  // 见进度台账决策 13）。与路由内既有角色校验取交集，不放松。
  ['GET', '/admin/content', 'content', 'view'],
  ['POST', '/admin/content/:id/verdict', 'content', 'manage'],
  ['POST', '/admin/content/:id/takedown', 'content', 'manage'],
  ['GET', '/admin/content-tasks', 'tasks', 'view'],
  ['GET', '/admin/content-tasks/:id', 'tasks', 'view'],
  ['GET', '/admin/content-tasks/:id/entries', 'tasks', 'view'],
  ['POST', '/admin/task-entries/:id/verdict', 'tasks', 'manage'],
  ['GET', '/admin/users', 'users', 'view'],
  ['GET', '/admin/users/stats', 'users', 'view'],
  ['GET', '/admin/users/:id', 'users', 'view'],
  ['GET', '/admin/users/:id/ops', 'users', 'view'],
  ['POST', '/admin/users/:id/tags', 'users', 'manage'],
  ['DELETE', '/admin/users/:id/tags/:tagId', 'users', 'manage'],
  ['POST', '/admin/users/:id/ops-notes', 'users', 'manage'],
  ['POST', '/admin/users/:id/status', 'users', 'manage'],
  ['POST', '/admin/users/:id/risk', 'users', 'manage'],
  ['POST', '/admin/users/bulk-tags', 'users', 'manage'],
  ['GET', '/admin/user-picker', 'users', 'view'],
  ['GET', '/admin/fund-workbench', 'fund', 'view'],
  ['GET', '/admin/settlements', 'settlements', 'view'],
  ['POST', '/admin/settlements/generate', 'settlements', 'manage'],
  ['POST', '/admin/settlements/:id/dispute', 'settlements', 'manage'],
  ['POST', '/admin/settlements/:id/confirm', 'settlements', 'manage'],
  ['POST', '/admin/settlements/:id/payment', 'settlements', 'manage'],
  ['GET', '/admin/entitlements', 'entitlements', 'view'],
  ['POST', '/admin/entitlements', 'entitlements', 'manage'],
  ['POST', '/admin/entitlements/:id/withdraw', 'entitlements', 'manage'],
  ['POST', '/admin/entitlements/:id/approve', 'entitlements', 'manage'],
  ['GET', '/admin/kyc', 'kyc', 'view'],
  ['GET', '/admin/agreements', 'agreements', 'view'],
  ['POST', '/admin/agreements/:id/verdict', 'agreements', 'manage'],
  ['GET', '/admin/budgets', 'budgets', 'view'],
  ['GET', '/admin/promoters', 'promoters', 'view'],
  ['POST', '/admin/promoters/register', 'promoters', 'manage'],
  ['POST', '/admin/promoters/:id/status', 'promoters', 'manage'],
  ['POST', '/admin/promoters/:id/tier', 'promoters', 'manage'],
  ['GET', '/admin/banners', 'banners', 'view'],
  ['GET', '/admin/faqs', 'faqs', 'view'],
  ['GET', '/admin/conflicts', 'conflicts', 'view'],
  ['GET', '/admin/task-cash', 'taskcash', 'view'],
  ['POST', '/admin/task-entries/:id/cash-paid', 'taskcash', 'manage'],
  ['GET', '/admin/content-cases', 'contentcases', 'view'],
  ['GET', '/admin/content-cases/:kind/:id', 'contentcases', 'view'],
  ['POST', '/admin/content-cases/reports/:id/verdict', 'contentcases', 'manage'],
  ['POST', '/admin/content-cases/appeals/:id/verdict', 'contentcases', 'manage'],
  ['GET', '/admin/partners', 'partners', 'view'],
  // ===== D-06 批次 4（QA-03）：全量映射——撤权后的读写直调一律 1003。
  // 订单（orders 模块）：查看/检索/详情/办理/改期；改期列表与动作同属 orders
  ['GET', '/admin/orders', 'orders', 'view'],
  ['GET', '/admin/orders/search', 'orders', 'view'],
  ['GET', '/admin/orders/:no', 'orders', 'view'],
  ['POST', '/admin/orders/:no/contact', 'orders', 'manage'],
  ['POST', '/admin/orders/:no/service-notes', 'orders', 'manage'],
  ['POST', '/admin/orders/:no/refund', 'orders', 'manage'],
  ['POST', '/admin/orders/:no/cancel-unpaid', 'orders', 'manage'],
  ['POST', '/admin/orders/:id/reschedule', 'orders', 'manage'],
  ['GET', '/admin/reschedules', 'orders', 'view'],
  ['POST', '/admin/reschedules/:id/verdict', 'orders', 'manage'],
  ['POST', '/admin/reschedules/:id/execute', 'orders', 'manage'],
  ['POST', '/admin/reschedules/:id/cancel', 'orders', 'manage'],
  ['GET', '/admin/export/orders', 'orders', 'export'],
  // 商品与资源（products/merchants/scenics/suppliers 模块）
  ['GET', '/admin/products', 'products', 'view'],
  ['GET', '/admin/products/:id/sessions', 'products', 'view'],
  ['GET', '/admin/products/:id/overview', 'products', 'view'],
  ['POST', '/admin/products', 'products', 'manage'],
  ['PUT', '/admin/products/:id', 'products', 'manage'],
  ['POST', '/admin/products/:id/status', 'products', 'manage'],
  ['POST', '/admin/products/:id/images', 'products', 'manage'],
  ['DELETE', '/admin/products/:id/images', 'products', 'manage'],
  ['POST', '/admin/products/:id/uploads', 'products', 'manage'],
  ['POST', '/admin/uploads', 'products', 'manage'],
  // 历史快照供商品/商户维护与资金核对共用；恢复写入仍只归商品办理。
  ['GET', '/admin/master-versions', ['products', 'merchants', 'fund'], 'view'],
  ['POST', '/admin/master-versions/restore', 'products', 'manage'],
  ['GET', '/admin/sessions', 'products', 'view'],
  ['POST', '/admin/sessions', 'products', 'manage'],
  ['GET', '/admin/merchants', 'merchants', 'view'],
  ['GET', '/admin/merchants/:id/overview', 'merchants', 'view'],
  ['POST', '/admin/merchants', 'merchants', 'manage'],
  ['POST', '/admin/merchants/:id/approve', 'merchants', 'manage'],
  ['PUT', '/admin/merchants/:id', 'merchants', 'manage'],
  ['GET', '/admin/scenics', 'scenics', 'view'],
  ['GET', '/admin/scenics/:id/overview', 'scenics', 'view'],
  ['POST', '/admin/scenics', 'scenics', 'manage'],
  ['PUT', '/admin/scenics/:id', 'scenics', 'manage'],
  ['GET', '/admin/suppliers', 'suppliers', 'view'],
  ['POST', '/admin/suppliers', 'suppliers', 'manage'],
  ['PUT', '/admin/suppliers/:id', 'suppliers', 'manage'],
  // 内容（content/tasks/creators/reviews）
  ['GET', '/admin/content/:id', 'content', 'view'],
  ['GET', '/admin/reviews', 'content', 'view'],
  ['POST', '/admin/reviews/:id/hide', 'content', 'manage'],
  ['POST', '/admin/content-tasks', 'tasks', 'manage'],
  ['PUT', '/admin/content-tasks/:id', 'tasks', 'manage'],
  ['POST', '/admin/content-tasks/:id/status', 'tasks', 'manage'],
  ['POST', '/admin/content-tasks/:id/delete', 'tasks', 'manage'],
  ['GET', '/admin/task-entries/:id/review', 'tasks', 'view'],
  ['GET', '/admin/creators', 'creators', 'view'],
  ['PUT', '/admin/creators/:id/tag', 'creators', 'manage'],
  // 核销冲突（conflicts 模块）
  ['GET', '/admin/verify/conflicts', 'conflicts', 'view'],
  ['POST', '/admin/verify/conflicts/:id/resolve', 'conflicts', 'manage'],
  // 合伙人（partners/partnerperf）
  ['GET', '/admin/partners/:kind/:id', 'partners', 'view'],
  ['GET', '/admin/partner-performance', 'partnerperf', 'view'],
  ['GET', '/admin/partner-reconciliation/:kind/:id', 'partnerperf', 'view'],
  // 看板（dash 模块）
  ['GET', '/admin/dash/kpi', 'dash', 'view'],
  ['GET', '/admin/dash/insights', 'dash', 'view'],
  ['GET', '/admin/content-dashboard', 'contentdash', 'view'],
  ['GET', '/admin/wxdata/visit-trend', 'dash', 'view'],
  // P-07：会员等级是共享字典（用户画像/徽章页显示等级名），跟随 users 查看权——
  // 不再挂在 dash 经营首页模块下（风控有 users 无 dash，此前字典被 1003，画像等级名降级）。
  // 撤销 users 后字典与画像一并受控；不为它开放经营汇总或订单数据。
  ['GET', '/admin/member/levels', 'users', 'view'],
  ['GET', '/admin/merchant/levels', 'merchants', 'view'],
  // 逐品佣金（rateov）
  ['GET', '/admin/rate-overrides', 'rateov', 'view'],
  ['POST', '/admin/rate-overrides/:pid', 'rateov', 'manage'],
  // 共创分润（cocreate）
  ['GET', '/admin/co-creators', 'cocreate', 'view'],
  ['POST', '/admin/co-creators', 'cocreate', 'manage'],
  ['POST', '/admin/co-creators/:id/status', 'cocreate', 'manage'],
  ['GET', '/admin/co-profits', 'cocreate', 'view'],
  ['GET', '/admin/co-profits/:id/pays', 'cocreate', 'view'],
  ['POST', '/admin/co-profits/receipt-upload', 'cocreate', 'manage'],
  ['POST', '/admin/co-profits/:id/pay', 'cocreate', 'manage'],
  ['POST', '/admin/co-profits/pays/:payId/approve', 'cocreate', 'manage'],
  ['POST', '/admin/co-profits/pays/:payId/withdraw', 'cocreate', 'manage'],
  ['POST', '/admin/co-profits/pays/:payId/reverse', 'cocreate', 'manage'],
  ['POST', '/admin/co-profits/:id/void', 'cocreate', 'manage'],
  ['GET', '/admin/co-profits/pays/:payId/receipt', 'cocreate', 'view'],
  // 后台账号（accounts 模块）
  ['PUT', '/admin/accounts/:id', 'accounts', 'manage'],
  ['POST', '/admin/accounts/:id/role', 'accounts', 'manage'],
  ['POST', '/admin/accounts/:id/status', 'accounts', 'manage'],
  ['POST', '/admin/accounts/:id/password-reset', 'accounts', 'manage'],
  ['POST', '/admin/accounts/:id/mfa-flags', 'accounts', 'manage'],
  ['POST', '/admin/accounts/:id/mfa-reset', 'accounts', 'manage'],
  // 参数中心（config 模块）
  ['POST', '/admin/config/proposal', 'config', 'manage'],
  ['POST', '/admin/config/approve', 'config', 'manage'],
  ['POST', '/admin/config/rollback', 'config', 'manage'],
  // 旅豆预算（budgets）
  ['POST', '/admin/budgets', 'budgets', 'manage'],
  ['POST', '/admin/budgets/:id/status', 'budgets', 'manage'],
  // 实名（kyc）
  ['POST', '/admin/kyc/:id/resolve', 'kyc', 'manage'],
  // 存证（attest）
  ['GET', '/admin/attestations', 'attest', 'view'],
  ['GET', '/admin/attest/verify', 'attest', 'view'],
  ['GET', '/admin/web3/overview', 'web3dash', 'view'],
  // 核销暗号（phrases）
  ['GET', '/admin/phrases', 'phrases', 'view'],
  ['POST', '/admin/phrases/:pid', 'phrases', 'manage'],
  // 渠道装修（miniapp/banners/faqs）
  ['GET', '/admin/entities/site/:id', 'miniapp', 'view'],
  ['PUT', '/admin/entities/site/:id', 'miniapp', 'manage'],
  ['GET', '/admin/lexicon', 'terms', 'view'],
  ['POST', '/admin/faqs/:id/update', 'faqs', 'manage'],
  ['POST', '/admin/faqs/:id/delete', 'faqs', 'manage'],
  ['POST', '/admin/banners', 'banners', 'manage'],
  ['POST', '/admin/banners/:id/update', 'banners', 'manage'],
  ['POST', '/admin/banners/:id/delete', 'banners', 'manage'],
  // 徽章（badges）
  ['POST', '/admin/web3/badges', 'badges', 'manage'],
  ['POST', '/admin/web3/badges/:id/backfill', 'badges', 'manage'],
  ['POST', '/admin/web3/badges/:id/grant', 'badges', 'manage'],
  // 数字身份 / 链资产（vc/chainassets/chainhub）
  ['POST', '/admin/web3/vc/issue', 'vc', 'manage'],
  ['GET', '/admin/web3/vc/batch', 'vc', 'view'],
  ['POST', '/admin/web3/vc/batch', 'vc', 'manage'],
  ['POST', '/admin/web3/vc/:id/revoke', 'vc', 'manage'],
  ['GET', '/admin/web3/contract-account', 'chainassets', 'view'],
  ['POST', '/admin/web3/assets/issue', 'chainassets', 'manage'],
  ['POST', '/admin/web3/assets/:id/retry', 'chainassets', 'manage'],
  ['POST', '/admin/chain/creds/:provider', 'chainhub', 'manage'],
  ['POST', '/admin/chain/preset/:provider', 'chainhub', 'manage'],
  ['POST', '/admin/chain/selftest/:provider', 'chainhub', 'manage'],
  ['POST', '/admin/chain/probe/:provider', 'chainhub', 'manage'],
  ['POST', '/admin/chain/activate', 'chainhub', 'manage'],
  // 实体通用（按 kind 段映射到对应模块；site 已在上方更具体路由优先）
  ['GET', '/admin/entity-schemas/:kind', 'ENTITY_DYNAMIC', 'view'],
  ['GET', '/admin/entities/:kind', 'ENTITY_DYNAMIC', 'view'],
  ['GET', '/admin/entities/:kind/:id', 'ENTITY_DYNAMIC', 'view'],
  ['POST', '/admin/entities/:kind', 'ENTITY_DYNAMIC', 'manage'],
  ['PUT', '/admin/entities/:kind/:id', 'ENTITY_DYNAMIC', 'manage'],
  // 审核队列（reviewqueue）
  ['GET', '/admin/review-queue', 'reviewqueue', 'view'],
  ['POST', '/admin/review-queue/:kind/:itemId/claim', { city_partner: 'contentcases', default: 'reviewqueue' }, 'manage'],
  ['POST', '/admin/review-queue/:kind/:itemId/release', { city_partner: 'contentcases', default: 'reviewqueue' }, 'manage'],
  ['POST', '/admin/review-queue/batch-verdict', 'reviewqueue', 'manage'],
  // 售后工单（tickets）
  ['GET', '/admin/tickets', 'tickets', 'view'],
  // 财务等待协作仅能从资金模块读取详情；不获得工单队列或办理权。
  ['GET', '/admin/tickets/:id', { finance: 'fund', default: 'tickets' }, 'view'],
  ['POST', '/admin/tickets', 'tickets', 'manage'],
  ['POST', '/admin/tickets/:id/note', 'tickets', 'manage'],
  ['POST', '/admin/tickets/:id/:action', 'tickets', 'manage'],
  // 导出（export.* 能力另叠加）
  ['GET', '/admin/export/:what', 'EXPORT_DYNAMIC', 'export'],
  // 残余收口（QA-03）：不能有绕过模块校验的 admin 接口
  ['POST', '/admin/faqs', 'faqs', 'manage'],
  ['POST', '/admin/merchants/:id', 'merchants', 'manage'],
  ['GET', '/admin/user-ops/tag-words', 'users', 'view'],
  // dev 联调端点（仅 MOCK 支付通道可用，生产禁用）——归 system 模块
  ['POST', '/admin/dev/mock-pay', 'system', 'manage'],
  ['POST', '/admin/dev/group-cancel', 'system', 'manage'],
  ['POST', '/admin/dev/complete', 'system', 'manage'],
]

// 实体 kind → 模块映射（QA-03：entities/:kind 不能一刀切归 products）
const ENTITY_KIND_MODULE = {
  product: 'products', merchant: 'merchants', scenic: 'scenics', supplier: 'suppliers',
  budget: 'budgets', faq: 'faqs', banner: 'banners', task: 'tasks', promoter: 'promoters',
  creator: 'creators', site: 'miniapp', phrase: 'phrases', rateov: 'rateov', cocreate: 'cocreate', cocreator: 'cocreate',
  agreement: 'agreements', kyc: 'kyc', badge: 'badges', session: 'products',
}

/** 匹配路由映射：精确段优先，:xxx 捕获任意段；返回 { module, action } 或 null */
export function matchRouteModule(method, pathname) {
  const segs = String(pathname || '').split('/').filter(Boolean)
  for (const [m, p, module, action] of ROUTE_MODULES) {
    if (m !== method) continue
    const ps = p.split('/').filter(Boolean)
    if (ps.length !== segs.length) continue
    let ok = true
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(':')) continue
      if (ps[i] !== segs[i]) { ok = false; break }
    }
    if (ok) {
      if (module === 'EXPORT_DYNAMIC') {
        return { module: { orders: 'orders', products: 'products', settlements: 'settlements', merchants: 'merchants', scenics: 'scenics', suppliers: 'suppliers', creators: 'creators' }[segs[2]] || 'orders', action }
      }
      if (module === 'ENTITY_DYNAMIC') {
        // :kind 占位在第 3 段（/admin/entities/:kind...）；site 特殊（/admin/entities/site/:id 的第 3 段是 'site'）
        const kind = segs[2] === 'site' ? 'site' : (segs[2] || 'product')
        const resolved = ENTITY_KIND_MODULE[kind] || ENTITY_KIND_MODULE[segs[3]] || 'products'
        return { module: resolved, action }
      }
      return { module, action }
    }
  }
  return null
}
