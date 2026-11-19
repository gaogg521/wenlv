// M-01：商户端角色实时校验——role 以 merchant_staff 当前库值为准，不信任 7 天 token 里的旧角色。
// 缓存上限 30 秒；员工管理（改岗/停用）等写路径调用 invalidateStaffRole 立即失效，
// 所以「改角色后同一 token 立即按新角色」，30 秒只是最坏情况兜底。
import { one } from '../db.mjs'

const TTL = 30_000
const cache = new Map() // `${uid}:${merchantId}` -> { role, status, at }

export async function staffRoleOf(uid, merchantId) {
  const key = uid + ':' + merchantId
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit
  const row = await one(`SELECT s.role, s.status FROM merchant_staff s
    JOIN merchant m ON m.id = s.merchant_id AND m.status = 1
    WHERE s.user_id = ? AND s.merchant_id = ? LIMIT 1`, [uid, merchantId])
  const v = row ? { role: Number(row.role), status: Number(row.status), at: Date.now() } : { role: 0, status: 0, at: Date.now() }
  cache.set(key, v)
  return v
}

/** 员工被改岗/停用/启用后调用；merchantId 缺省时清掉该用户所有门店的缓存 */
export function invalidateStaffRole(uid, merchantId) {
  if (merchantId == null) {
    for (const k of cache.keys()) if (k.startsWith(uid + ':')) cache.delete(k)
  } else {
    cache.delete(uid + ':' + merchantId)
  }
}
