// 小程序装修数据：后台「小程序装修」维护，进程内缓存 5 分钟；接口失败时用默认值，页面不白屏
const api = require('./api')
const DEFAULT = {
  brand_name: '向往的自由', hero_eyebrow: 'WANDERLUST · 向往的自由', hero_title: '世界就是', hero_title_em: '我的游乐场',
  hero_caption: '去水乡入戏，去山野放空。下一段故事，由你出发。', search_ph: '搜索目的地、线路与新体验', destination_line: '朱家角 · 苏州 · 安吉',
  themes: [{ cat: 'script', name: '剧本探秘', sub: '走进故事现场', icon: '⌕' }, { cat: 'yoga', name: '山野疗愈', sub: '把时间还给自己', icon: '◌' },
    { cat: 'family', name: '亲子时光', sub: '一起发现世界', icon: '☼' }, { cat: 'sister', name: '好友出游', sub: '约一场好风景', icon: '✧' }],
  section_title: '值得出发', footer_line: '把一次出行，变成值得分享的故事。', footer_sub: '主题体验 · 在地好物 · 旅行记录',
  dest_caption: '一城一故事 · 在架主题游按城市聚合', list_footer: '下单即锁定名额 · 支持按梯度退改',
  shop_title: '旅行商城', shop_caption: '在地好物 · 到店体验与领取', shop_note: '当前好物支持到店预约领取，领取地点与时间请查看商品详情。',
  beanRules: { orderRatePct: 10, deductMaxPct: 10, expireMonths: 12, beanPerYuan: 10 },
}
let cache = null, at = 0
function get(force) {
  if (!force && cache && Date.now() - at < 300000) return Promise.resolve(cache)
  return api.request('/c/site').then((s) => {
    cache = Object.assign({}, DEFAULT, s, { themes: (s.themes && s.themes.length) ? s.themes : DEFAULT.themes })
    at = Date.now()
    return cache
  }).catch(() => cache || DEFAULT)
}
module.exports = { get, DEFAULT }
