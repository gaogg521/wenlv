// 三端统一字典（X-01/X-02）：订单状态文案、城市、品类、商户类目的唯一事实源。
// 后台 /admin/capabilities 与游客端 /c/dicts 从这里下发；新增字典项只改本文件（城市/品类等在 entity-schema.DICT），
// 三端缓存后同步生效。前端不得再自建状态文案表（X-01 验收：grep 无分散状态表）。
import { DICT } from './entity-schema.mjs'

export { DICT }

/**
 * 订单状态 → 三视角文案。
 * c = 游客端；m = 商户端；a = PC 后台（客服对口径用，30 统一叫「待出行」，商户侧带「待核销」副标）；
 * t = 时间线短文案；scene = 游客支付结果页场景文案。
 */
export const ORDER_STATUS = {
  10: { c: '待支付', m: '待支付', a: '待支付', t: '待支付', scene: '订单待支付' },
  20: { c: '已支付 · 出票中', m: '已支付', a: '已支付', t: '已支付', scene: '支付成功 · 出票中' },
  30: { c: '待出行 · 待核销', m: '待出行 · 待核销', a: '待出行', t: '待出行', scene: '报名成功 · 已出票' },
  40: { c: '已核销', m: '已核销', a: '已核销', t: '已核销', scene: '已核销' },
  50: { c: '已完成', m: '已完成', a: '已完成', t: '已完成', scene: '行程已完成' },
  60: { c: '退款处理中', m: '退款中', a: '退款中', t: '退款处理中', scene: '退款处理中' },
  70: { c: '已退款', m: '已退款', a: '已退款', t: '已退款', scene: '已退款' },
  90: { c: '已关闭', m: '已关闭', a: '已关闭', t: '已关闭', scene: '订单已关闭' },
}

export function orderStatusText(status, audience = 'c') {
  const row = ORDER_STATUS[Number(status)]
  return row ? row[audience] : '处理中'
}

export const ORDER_TIMELINE_TEXT = { 0: '下单' }

/** 下发给三端的字典快照（不含内部键名约定，全部是 code → 文案 的扁平映射） */
export function dictsForClient() {
  const toMap = (rows) => Object.fromEntries(rows.map(([k, v]) => [k, v]))
  const pick = (audience) => Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, v[audience]]))
  return {
    cities: toMap(DICT.city),
    productCats: toMap(DICT.productCat),
    merchantKinds: toMap(DICT.merchantKind),
    supplierKinds: toMap(DICT.supplierCat),
    orderStatusTourist: pick('c'),
    orderStatusMerchant: pick('m'),
    orderStatusAdmin: pick('a'),
    orderStatusScene: pick('scene'),
    orderStatusTimeline: { ...ORDER_TIMELINE_TEXT, ...pick('t') },
  }
}
