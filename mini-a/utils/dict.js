// X-01/X-02：三端统一字典（游客端缓存层）。
// 唯一事实源在服务端（api/src/domain/dict.mjs，经 /c/dicts 下发，app 启动时 warmup 缓存）；
// FALLBACK 仅用于后端未连接的演示/离线兜底。各页面不再自建状态文案表或城市表（X-01 验收：无分散状态表）。
const api = require('./api')

let CACHE = null
const FALLBACK = {
  orderStatusTourist: { 10: '待支付', 20: '已支付 · 出票中', 30: '待出行 · 待核销', 40: '已核销', 50: '已完成', 60: '退款处理中', 70: '已退款', 90: '已关闭' },
  orderStatusScene: { 10: '订单待支付', 20: '支付成功 · 出票中', 30: '报名成功 · 已出票', 40: '已核销', 50: '行程已完成', 60: '退款处理中', 70: '已退款', 90: '订单已关闭' },
  cities: { 310118: '上海 · 青浦', 310000: '上海', 320508: '苏州 · 姑苏', 330500: '湖州', 330523: '湖州 · 安吉' },
  productCats: { script: '剧本闯关', yoga: '瑜伽之旅', sister: '姐姐系列', single: '单身社交', sport: '体育竞技', family: '亲子主题', red: '红色文旅', shop: '商城好物' },
}

function d() { return CACHE || FALLBACK }
async function warmup() {
  if (CACHE) return CACHE
  try { CACHE = Object.assign({}, FALLBACK, await api.request('/c/dicts')) } catch (e) { /* 演示模式/离线：用内置兜底 */ }
  return CACHE
}
module.exports = {
  warmup,
  statusText: (s) => d().orderStatusTourist[Number(s)] || '处理中',
  sceneText: (s) => d().orderStatusScene[Number(s)] || '正在查询订单',
  cityText: (code) => d().cities[code] || d().cities[String(code)] || '',
  catText: (k) => d().productCats[k] || k,
  statusMap: () => ({ ...d().orderStatusTourist }),
  cityMap: () => ({ ...d().cities }),
  catList: () => Object.entries(d().productCats).map(([k, n]) => ({ k, n })),
}
