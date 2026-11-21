// 主体资源权限解析(PC 平台后台是授权管理入口,服务端保存的最新已发布权限是统一判定依据)。
// 最终权限 = 平台授权(基线+grant 收紧/排除) ∩ 主体范围(服务端绑定) ∩ 岗位(merchant_staff) ∩ 渠道。
// 服务端在每次敏感读取和写入时重新解析——旧会话/旧缓存无法继续操作已撤销权限;
// 版本号只用于各端快照同步提示,不可扩大授权(渠道或本地缓存不可扩大授权)。
import { one, q, tx, BizError } from '../db.mjs'
import { allowedFields, FIELD_GROUP_OF } from './subject-fields.mjs'

// 基线:未配置任何 grant 时主体默认可提交范围(方案§2 管辖表)。
// scenic 自营商品首版不开放(V95 selfrun_merchant_id 已预埋,放开时在此接入)。
const BASELINE = {
  merchant: { product: { create: 1, update: 1 }, session: { update: 1 }, stock: { update: 1 }, merchant: { update: 1 } },
  scenic: { scenic: { update: 1 } },
}

// mini 商户端供给类动作沿用现有岗位门槛:店长及以上(M-01 口径,核销员只读)
const MINI_MIN_ROLE = { session: 2, stock: 2, product: 2 }

export function baselinePerms(subjectType) {
  return BASELINE[subjectType] || {}
}

// kind → { field → group }(常量表,无循环依赖)
const groupCache = new Map()
function fieldGroup(kind, key) {
  if (!groupCache.has(kind)) {
    const m = new Map()
    for (const [g, ks] of Object.entries(FIELD_GROUP_OF)) for (const k of ks) m.set(k, g)
    groupCache.set(kind, m)
  }
  return groupCache.get(kind).get(key) || 'base'
}

/** 解析有效权限:返回 { version, perms: { resKind: { action: { allowed, fields:Set } } } } */
export async function resolveSubjectPerms({ subjectType, subjectId, channel = 'all', staffRole = null, accountId = null }) {
  const version = await permVersion()
  const perms = {}
  for (const [kind, actions] of Object.entries(baselinePerms(subjectType))) {
    perms[kind] = {}
    for (const action of Object.keys(actions)) {
      perms[kind][action] = { allowed: true, fields: allowedFields(kind, action) }
    }
  }
  // mini 岗位门槛(店长及以上;核销员只读)
  if (channel === 'mini') {
    for (const [kind, min] of Object.entries(MINI_MIN_ROLE)) {
      if (perms[kind] && (staffRole == null || Number(staffRole) < min)) {
        for (const a of Object.keys(perms[kind])) perms[kind][a].allowed = false
      }
    }
  }
  const rows = await q(`SELECT * FROM subject_perm_grant
    WHERE subject_type = ? AND (subject_id IS NULL OR subject_id = ?)
      AND (staff_role IS NULL OR staff_role = ?)
      AND (account_uid IS NULL OR account_uid = ?)
      AND channel IN (?, 'all') ORDER BY id DESC`,
    [subjectType, subjectId ?? null, staffRole == null ? -1 : Number(staffRole), accountId ?? null, channel])
  for (const g of rows) {
    const kind = g.res_kind
    if (!perms[kind]) continue // grant 不能凭空扩权:该主体基线本无此资源
    for (const action of Object.keys(perms[kind])) {
      if (g.action !== '*' && g.action !== action) continue
      const p = perms[kind][action]
      if (Number(g.effect) === 0) {
        if (g.field_group) {
          // 字段组排除:从可提交字段中移除该组
          p.fields = new Set([...p.fields].filter((k) => fieldGroup(kind, k) !== g.field_group))
        } else {
          p.allowed = false
        }
      } else if (g.field_group) {
        // 允许行带字段组 = 收紧到所授字段组的并集
        const narrowed = p._narrow || (p._narrow = new Set())
        for (const k of p.fields) if (fieldGroup(kind, k) === g.field_group) narrowed.add(k)
        p.fields = narrowed
      }
    }
  }
  return { version, perms }
}

/** 校验 payload 键是否全部在授权字段内;禁止字段在请求中出现即报错(逐键返回 fieldErrors) */
export function assertPayloadAllowed(perms, kind, action, payload) {
  const p = perms?.[kind]?.[action]
  if (!p || !p.allowed) throw new BizError(1003, `当前权限不允许${action === 'create' ? '新增' : '修改'}该类资源,请联系平台在「主体资源权限」确认授权`)
  const forbidden = Object.keys(payload || {}).filter((k) => !p.fields.has(k))
  if (forbidden.length) {
    const e = new BizError(1003, '存在未授权字段(' + forbidden.join(', ') + '),请调整后重试或联系平台调整授权')
    e.data = { fieldErrors: Object.fromEntries(forbidden.map((k) => [k, '当前授权不包含该字段'])) }
    throw e
  }
}

/** 主体权限下发版本(各端快照同步依据;仅更高版本可覆盖本地) */
export async function permVersion() {
  const r = await one('SELECT version FROM subject_perm_version WHERE id = 1')
  return Number(r?.version || 1)
}

/** 下发给各端的序列化口径(fields Set → 数组) */
export function serializePerms(perms) {
  const out = {}
  for (const [kind, actions] of Object.entries(perms || {})) {
    out[kind] = {}
    for (const [action, p] of Object.entries(actions)) out[kind][action] = { allowed: !!p.allowed, fields: [...(p.fields || [])] }
  }
  return out
}

/**
 * 商户端提交权限版本闸:携带的快照版本落后于最新发布版本时拒绝(2101),端侧刷新快照后重试。
 * 只作端侧同步提示——服务端权限解析始终读库,旧会话被撤权即被拒,不依赖此闸。
 */
export async function assertPermFresh(headerPv) {
  if (headerPv == null) return
  const cur = await permVersion()
  if (Number(headerPv) !== cur) {
    const e = new BizError(2101, '权限已更新,请刷新权限后重试')
    e.data = { permVersion: cur }
    throw e
  }
}

/** 授权变更后递增下发版本;targetUid 非空时联动该 PC 账号 token_epoch(旧会话立即失效) */
export async function bumpPermVersion(c, by, targetUid = null) {
  await c.q('UPDATE subject_perm_version SET version = version + 1, published_by = ?, published_at = NOW(3) WHERE id = 1', [by || 'system'])
  if (targetUid) await c.q('UPDATE admin_user SET token_epoch = token_epoch + 1 WHERE id = ?', [targetUid])
}

/** 路由层直接调用(自管事务)的版本递增 */
export async function bumpPermVersionTx(by, targetUid = null) {
  return tx((c) => bumpPermVersion(c, by, targetUid))
}
