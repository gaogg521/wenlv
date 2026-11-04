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
