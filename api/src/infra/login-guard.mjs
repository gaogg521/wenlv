// 后台登录防爆破（A-21，全量检查 20261106）
// 旧实现：连续 30 次错误密码毫无限制，之后正确密码立即可登录。
// 现在的行为：按「账号」与「来源 IP」双维度计数，窗口内失败达阈值 → 临时锁定；
// 锁定提示不暴露账号是否存在；成功登录清零；超管可主动解锁（POST /admin/login/unlock）。
// 计数在进程内存（单实例部署语义；多实例部署时锁是每实例的，窗口短、风险可接受——文档注明）。
const buckets = new Map() // key -> { count, firstAt, lockedUntil }

const MAX_FAILS_USER = 10
const MAX_FAILS_IP = 30 // IP 维度阈值更高：同一出口 IP 后有多个真实用户，误伤代价大（超管解锁只解账号维度）
const WINDOW_MS = 15 * 60_000
const LOCK_MS = 15 * 60_000

const now = () => Date.now()
const maxFor = (key) => (String(key).startsWith('admin-login:ip:') ? MAX_FAILS_IP : MAX_FAILS_USER)

function bucketFor(key) {
  let b = buckets.get(key)
  if (!b || now() - b.firstAt > WINDOW_MS) {
    b = { count: 0, firstAt: now(), lockedUntil: 0 }
    buckets.set(key, b)
  }
  return b
}

/** 是否处于锁定；返回 { locked, retryAfterSec } */
export function isLocked(key) {
  const b = buckets.get(key)
  if (!b) return { locked: false, retryAfterSec: 0 }
  if (b.lockedUntil && b.lockedUntil > now()) {
    return { locked: true, retryAfterSec: Math.ceil((b.lockedUntil - now()) / 1000) }
  }
  if (b.lockedUntil && b.lockedUntil <= now()) { b.lockedUntil = 0; b.count = 0 } // 锁定期满自动解除
  return { locked: false, retryAfterSec: 0 }
}

/** 记一次失败；达到阈值即锁定 */
export function recordFailure(key) {
  const b = bucketFor(key)
  b.count += 1
  if (b.count >= maxFor(key)) b.lockedUntil = now() + LOCK_MS
  return { locked: isLocked(key).locked, count: b.count }
}

/** 登录成功清零 */
export function clearFailures(key) { buckets.delete(key) }

/** 超管解锁（账号维度） */
export function unlock(key) { return buckets.delete(key) }

export const loginGuardKeys = (username, ip) => ['admin-login:user:' + String(username || '').toLowerCase(), 'admin-login:ip:' + String(ip || 'unknown')]
export const _buckets = buckets // 测试可检视
