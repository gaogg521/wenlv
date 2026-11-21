// 主体资源可提交字段白名单、字段组与差异构建(方案§3:按「实体×操作×角色」在服务端定义可提交字段,
// 禁止字段及嵌套字段在请求中出现即报错;首版不为同义字段建第二份数据,键名以实体 schema 为准)。
// 平台专管字段(归属/城市/补贴/结算/合同/票务凭据)一律不进主体白名单,出现在 payload 即报错。
import { get as schemaOf, readValues } from './entity-schema.mjs'

/** 主体可提交字段白名单(键 = 实体 schema 字段键;金额等以展示口径进 payload,金额红线仍在 save 归一化) */
export const SUBJECT_FIELDS = {
  product: ['title', 'subtitle', 'days_desc', 'price_from', 'tags', 'suitable', 'age_range', 'group_size',
    'images', 'video', 'highlights', 'intro', 'itinerary', 'transport', 'meeting_point', 'meeting_geo',
    'includes', 'excludes', 'notice', 'safety_note', 'insurance_note'],
  // 新增(create)额外允许类型与上架申请:cat 仅新增可选(改类目影响库存模型,更新不允许,交验单注明)
  // firstStock:商城直购商品的首批可售库存目标(审批时随商品同事务建库存行,避免孤立商品)
  productCreateExtra: ['cat', 'status', 'firstStock'],
  session: ['depart_date', 'quota', 'min_go', 'sign_deadline', 'price_adult', 'early_price', 'early_days',
    'gather_time', 'end_time', 'leader_name', 'leader_phone', 'vehicle', 'note'],
  stock: [],
  merchant: ['name', 'short_name', 'kind', 'tags', 'logo', 'storefront', 'intro', 'address', 'geo',
    'service_phone', 'business_hours', 'capacity', 'facilities'],
  scenic: ['name', 'alias', 'scenic_level', 'cover', 'gallery', 'intro', 'address', 'geo', 'open_hours',
    'tickets', 'traffic'],
}

/** 字段组(权限配置按组收紧/排除;字段→组一对一主组) */
export const FIELD_GROUPS = ['base', 'media', 'trade', 'schedule', 'policy', 'profile', 'contact', 'address']
export const FIELD_GROUP_OF = {
  base: ['title', 'subtitle', 'cat', 'days_desc', 'tags', 'suitable', 'age_range', 'group_size', 'min_go',
    'name', 'short_name', 'kind', 'alias', 'scenic_level'],
  media: ['images', 'video', 'cover', 'gallery', 'logo', 'storefront'],
  trade: ['price_from', 'price_adult', 'early_price', 'early_days', 'quota', 'capacity'],
  schedule: ['depart_date', 'sign_deadline', 'gather_time', 'end_time', 'open_hours', 'business_hours'],
  policy: ['includes', 'excludes', 'notice', 'safety_note', 'insurance_note', 'tickets'],
  profile: ['intro', 'itinerary', 'transport', 'highlights', 'facilities', 'note', 'vehicle'],
  contact: ['service_phone', 'leader_name', 'leader_phone'],
  address: ['address', 'geo', 'meeting_point', 'meeting_geo'],
}
const GROUP_OF = Object.fromEntries(Object.entries(FIELD_GROUP_OF).flatMap(([g, ks]) => ks.map((k) => [k, g])))

/** 重点差异域(方案§3:价格、库存、时间、状态、退改政策、对外联系方式和地址在差异预览中标为重点) */
export const IMPACT_KEYS = ['price', 'stock', 'schedule', 'status', 'policy', 'contact', 'address']
const IMPACT_OF = {
  price: ['price_from', 'price_adult', 'early_price', 'early_days'],
  stock: ['quota', 'capacity'],
  schedule: ['depart_date', 'sign_deadline', 'gather_time', 'end_time', 'open_hours', 'business_hours'],
  status: ['status'],
  policy: ['includes', 'excludes', 'notice', 'safety_note', 'insurance_note', 'tickets'],
  contact: ['service_phone', 'leader_name', 'leader_phone'],
  address: ['address', 'geo', 'meeting_point', 'meeting_geo'],
}
const IMPACT_SET = Object.fromEntries(IMPACT_KEYS.map((k) => [k, new Set(IMPACT_OF[k])]))

/** 景区票种主体口径:剔除 settle 结算价(方案§3:结算价和票务接口凭据不进入主体表单、申请快照或通知) */
function stripSubjectOnly(kind, key, value) {
  if (kind === 'scenic' && key === 'tickets' && Array.isArray(value)) {
    return value.map((r) => { const { settle, ...rest } = r || {}; return rest })
  }
  return value
}

/** 允许字段集(kind×action):update = 白名单(+status 申报);create = 白名单+cat/status */
export function allowedFields(kind, action) {
  const base = SUBJECT_FIELDS[kind]
  if (!base) return new Set()
  const extra = kind === 'product' && action === 'create' ? SUBJECT_FIELDS.productCreateExtra : ['status']
  return new Set([...base, ...extra])
}

/** 返回 {payload, forbidden} —— 剔除未定义字段与平台专管字段;forbidden 列出禁止键(含嵌套) */
export function sanitizePayload(kind, action, input) {
  const allow = allowedFields(kind, action)
  const out = {}
  const forbidden = []
  for (const [k, v] of Object.entries(input || {})) {
    if (!allow.has(k)) { forbidden.push(k); continue }
    out[k] = stripSubjectOnly(kind, k, v)
  }
  return { payload: out, forbidden }
}

function fieldLabel(kind, key) {
  const sc = schemaOf(kind)
  for (const sec of sc.sections || []) {
    for (const f of sec.fields || []) {
      if (f.k === key) return f.label
      for (const sub of f.of || []) if (sub.k === key) return `${f.label}·${sub.label}`
    }
  }
  return key
}

/** 展示口径的值摘要(差异与通知用;避免长富文本/敏感内容) */
function briefValue(v) {
  if (v == null) return '(空)'
  if (Array.isArray(v)) return v.length ? `[${v.length} 项]` : '(空)'
  if (typeof v === 'object') return Object.keys(v).length ? `{${Object.keys(v).length} 项}` : '(空)'
  const s = String(v)
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

/**
 * 构建差异与影响标记。before 为展示口径基线值(entity readValues);payload 为展示口径拟值。
 * 返回 {diffs, impacts} —— diffs 含 label/group/important;impacts 为 IMPACT_KEYS 布尔表。
 */
export function buildDiff(kind, before, payload) {
  const diffs = []
  const impacts = {}
  for (const key of Object.keys(payload)) {
    if (key === 'firstStock') continue // 首批库存目标不进差异展示(生效时落为库存行)
    const b = key in before ? before[key] : null
    const a = payload[key]
    const changed = JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)
    // status 申报(上下架/停售/恢复)即使与现值相同也保留(申请人明确申报),其余无变化不进差异
    if (!changed && key !== 'status') continue
    diffs.push({ key, label: fieldLabel(kind, key), group: GROUP_OF[key] || 'base',
      before: briefValue(b), after: briefValue(a), important: !!IMPACT_SET.status.has(key) || Object.values(IMPACT_SET).some((s) => s.has(key)) })
    for (const [cat, set] of Object.entries(IMPACT_SET)) if (set.has(key)) impacts[cat] = true
  }
  return { diffs, impacts }
}

/** 读取正式资源当前展示值与版本(乐观锁基线)。stock 的可比值为 {available}(可售 = quota-booked) */
export async function formalSnapshot(kind, resourceId) {
  if (!resourceId) return { version: null, values: {} }
  const { one } = await import('../db.mjs')
  const map = { product: ['tour_product', 'id'], session: ['tour_session', 'id'], merchant: ['merchant', 'id'], scenic: ['scenic_spot', 'id'], stock: ['tour_session', 'id'] }
  const [table, idCol] = map[kind]
  const r = await one(`SELECT * FROM ${table} WHERE ${idCol} = ?`, [resourceId])
  if (!r) return null
  const version = r.updated_version != null ? Number(r.updated_version) : (r.version != null ? Number(r.version) : null)
  const values = kind === 'stock' ? { available: Number(r.quota) - Number(r.booked) } : readValues(kind, r)
  return { version, values }
}
