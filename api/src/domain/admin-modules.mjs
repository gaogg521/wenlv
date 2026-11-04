// C-05：账号级模块授权——有效集合与缓存。
// 有效集合 = super ? 全部 : (角色默认 ∪ allow) − deny（V55 admin_user_module）。
// 城市合伙人叠加 CITY_DENY_MODULES（requireModule 侧强制，授权接口同样拒绝写入）。
// 细粒度约束（ADMIN_ACTIONS 资金动作、双人复核、城市行级隔离）继续生效，模块授权不能绕过（D-05）。
import { q } from '../db.mjs'
import { MODULE_KEYS, effectiveModules, CITY_DENY_MODULES } from './modules.mjs'

const CACHE_TTL = 30_000
const cache = new Map() // key -> { set, at }

/** 角色默认：优先 V54 矩阵表（超管可改），该角色完全无行时回退静态基线快照 */
async function roleDefaultsFromDb(role) {
  const rows = await q('SELECT module_key FROM admin_role_module WHERE role = ?', [role])
  if (rows.length) return rows.map((r) => r.module_key)
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
  ['GET', '/admin/web3/chain', 'chainassets', 'view'],
  ['GET', '/admin/web3/assets', 'chainassets', 'view'],
  ['GET', '/admin/web3/vc', 'vc', 'view'],
  ['GET', '/admin/chain/hub', 'chainhub', 'view'],
  ['GET', '/admin/attest/center', 'attest', 'view'],
  ['GET', '/admin/attest/batch/:id', 'attest', 'view'],
  ['GET', '/admin/attest/search', 'attest', 'view'],
  ['GET', '/admin/attest/flow/:orderNo', 'attest', 'view'],
  ['GET', '/admin/creators', 'creators', 'view'],
]

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
    if (ok) return { module, action }
  }
  return null
}
