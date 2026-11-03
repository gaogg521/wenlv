// 勋章图形：由数据生成 SVG（不依赖美工出图，也不引入图片库）。每个类别有自己的造型与材质，而不只是换色：
//   level   会员等级  带翼金属奖章：铜 / 银 / 金 / 钻石 逐级升格，奖章上方按等级点亮星数
//   member  会员荣誉  月桂花环 + 缎带，奖章金属随稀有度变化
//   city    城市印记  朱红篆刻印章（圆角缺角方章，白文地标图案，带磨损质感）
//   country 国家印章  护照出入境章：双圈 + 齿孔边 + 国家代码，微倾斜、带盖章磨损
//   trusted 可信勋章  深色玻璃八边形 + 虹彩边框 + 节点网络 + 每枚唯一的「指纹条」，右下角封存印记
//   journey 旅程 盾牌 / explore 足迹 六边形 / creator 创作 花边圆章 / special 特别 花边章：金属质感徽章
// 配色 = 稀有度（普通铜 / 稀有银 / 史诗紫晶 / 传说金）；系列勋章用小圆点标阶数；未获得 = 灰阶。
// 后台上传了「勋章图」（icon_img）时仍以上传图为准；这里是默认形象，也是后台编辑器的实时预览。
import { q, one } from '../db.mjs'

export const CATEGORIES = {
  level: { label: '会员等级', adminLabel: '会员等级' },
  member: { label: '会员荣誉', adminLabel: '会员荣誉' },
  city: { label: '城市印记', adminLabel: '城市徽章' },
  country: { label: '国家印章', adminLabel: '国家徽章' },
  trusted: { label: '可信勋章', adminLabel: '链上勋章' }, // 小程序端不出现链相关词汇；后台可用
  journey: { label: '旅程', adminLabel: '旅程' },
  explore: { label: '足迹', adminLabel: '足迹' },
  creator: { label: '创作', adminLabel: '创作' },
  special: { label: '特别', adminLabel: '特别' },
  mlevel: { label: '商户等级', adminLabel: '商户等级' }, // 商户端：门楼招牌
  mhonor: { label: '经营荣誉', adminLabel: '经营荣誉' }, // 商户端：花结奖章
}
export const CATEGORY_ORDER = ['level', 'member', 'city', 'country', 'trusted', 'journey', 'explore', 'creator', 'special'] // 游客端勋章墙
export const MERCHANT_CATEGORY_ORDER = ['mlevel', 'mhonor', 'trusted'] // 商户端勋章墙
export const RARITIES = { common: '普通', rare: '稀有', epic: '史诗', legend: '传说' }

const METAL = {
  bronze: { s: ['#fbe3c4', '#e0a769', '#a8683a', '#5f3416'], ink: '#6b3a17', glow: '#f0b36b' },
  silver: { s: ['#ffffff', '#dfe6ef', '#9aa7bb', '#4f5b70'], ink: '#33435e', glow: '#cfe0f5' },
  gold: { s: ['#fff7cf', '#f6d35a', '#c19013', '#6e4a00'], ink: '#6b4600', glow: '#ffe58a' },
  violet: { s: ['#f6ecff', '#cfaef7', '#8f5bd6', '#3f2080'], ink: '#3b1f78', glow: '#d9b8ff' },
  diamond: { s: ['#f7fdff', '#bfe6ff', '#6fb0e8', '#1d3b73'], ink: '#16335f', glow: '#a8dcff' },
  jade: { s: ['#eafff1', '#9fe3b6', '#3fae6b', '#14532d'], ink: '#14532d', glow: '#b8f0cc' },
  off: { s: ['#f6f6f6', '#dedede', '#bfbfbf', '#8f8f8f'], ink: '#a6a6a6', glow: '#e8e8e8' },
}
const RARITY_METAL = { common: 'bronze', rare: 'silver', epic: 'violet', legend: 'gold' }
const LEVEL_METAL = ['bronze', 'silver', 'gold', 'diamond']

// 48×48 画布上的线性图标（描边绘制）
const ICONS = {
  compass: '<circle cx="24" cy="24" r="16"/><path d="M31 17 L27 27 L17 31 L21 21 Z"/>',
  mountain: '<path d="M6 37 L19 15 L26 27 L31 20 L42 37 Z"/><circle cx="35" cy="11" r="3"/>',
  water: '<path d="M6 19 q6 -6 12 0 t12 0 t12 0"/><path d="M6 28 q6 -6 12 0 t12 0 t12 0"/><path d="M6 37 q6 -6 12 0 t12 0 t12 0"/>',
  boat: '<path d="M7 30 H41 L36 39 H12 Z"/><path d="M24 8 V30"/><path d="M24 11 L36 27 H24 Z"/>',
  ticket: '<path d="M7 15 H41 V21 a3 3 0 0 0 0 6 V33 H7 V27 a3 3 0 0 0 0 -6 Z"/><path d="M30 16 V32" stroke-dasharray="3 3"/>',
  pen: '<path d="M10 39 L12 30 L33 9 L39 15 L18 36 Z"/><path d="M28 14 L34 20"/>',
  camera: '<path d="M7 16 H15 L18 11 H30 L33 16 H41 V36 H7 Z"/><circle cx="24" cy="26" r="7"/>',
  star: '<path d="M24 7 L29.5 18.5 L42 20.3 L33 29 L35.2 41.5 L24 35.6 L12.8 41.5 L15 29 L6 20.3 L18.5 18.5 Z"/>',
  flag: '<path d="M12 41 V7"/><path d="M12 9 H37 L32 17.5 L37 26 H12"/>',
  heart: '<path d="M24 40 C8 28 6 16 14 12 C19 9.5 23 13 24 16 C25 13 29 9.5 34 12 C42 16 40 28 24 40 Z"/>',
  pin: '<path d="M24 42 C14 30 12 24 12 19 a12 12 0 0 1 24 0 C36 24 34 30 24 42 Z"/><circle cx="24" cy="19" r="4.5"/>',
  crown: '<path d="M8 34 L10 14 L19 24 L24 11 L29 24 L38 14 L40 34 Z"/><path d="M8 39 H40"/>',
  footprint: '<ellipse cx="17" cy="30" rx="6" ry="10"/><ellipse cx="31" cy="19" rx="6" ry="10"/>',
  lantern: '<path d="M18 8 H30"/><ellipse cx="24" cy="24" rx="10" ry="13"/><path d="M24 11 V37"/><path d="M20 38 H28"/><path d="M24 38 V45"/>',
  globe: '<circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="7" ry="16"/><path d="M8 24 H40"/>',
  book: '<path d="M7 12 H22 a2 2 0 0 1 2 2 V38 a2 2 0 0 0 -2 -2 H7 Z"/><path d="M41 12 H26 a2 2 0 0 0 -2 2 V38 a2 2 0 0 1 2 -2 H41 Z"/>',
  bridge: '<path d="M5 35 H43"/><path d="M9 35 C9 21 39 21 39 35"/><path d="M16 27 V35 M24 25 V35 M32 27 V35"/>',
  moongate: '<path d="M3 16 C13 15 19 11 24 6 C29 11 35 15 45 16"/><path d="M8 17 V41 M40 17 V41 M3 41 H45"/><circle cx="24" cy="30" r="9.5"/>',
  bamboo: '<path d="M14 44 V12 M24 44 V5 M34 44 V16"/><path d="M11 22 H17 M11 34 H17 M21 16 H27 M21 30 H27 M31 26 H37 M31 38 H37"/><ellipse cx="19" cy="9" rx="5.5" ry="2.2" transform="rotate(-35 19 9)"/><ellipse cx="30" cy="9" rx="5.5" ry="2.2" transform="rotate(35 30 9)"/><ellipse cx="40" cy="20" rx="5" ry="2" transform="rotate(30 40 20)"/>',
  pagoda: '<path d="M24 4 V10 M16 10 H32 L30 18 H18 Z M13 18 H35 L33 27 H15 Z M11 27 H37 L35 36 H13 Z M9 36 H39 V42 H9 Z"/>',
  skyline: '<path d="M6 41 V25 H14 V14 H22 V41 M22 41 V20 H30 V7 H36 V41 M36 41 V27 H42 V41 M4 41 H44"/>',
  plane: '<path d="M5 26 L43 8 L35 41 L24 31 L18 39 L18 29 Z"/>',
  seal: '<circle cx="24" cy="24" r="15"/><path d="M16 24 L22 30 L33 18"/>',
  node: '<circle cx="24" cy="12" r="4"/><circle cx="12" cy="34" r="4"/><circle cx="36" cy="34" r="4"/><path d="M22 15 L14 31 M26 15 L34 31 M16 34 H32"/>',
  store: '<path d="M6 18 L10 8 H38 L42 18 Z"/><path d="M8 18 V40 H40 V18"/><path d="M6 18 q4 6 9 0 q4 6 9 0 q4 6 9 0 q4 6 9 0"/><path d="M20 40 V28 H28 V40"/>',
  trend: '<path d="M6 38 L18 24 L26 31 L42 10"/><path d="M32 10 H42 V20"/>',
  thumb: '<path d="M10 22 H18 V40 H10 Z"/><path d="M18 24 L25 9 C30 9 30 15 28 20 H40 C42 20 43 22 42 25 L39 37 C38.5 39 37 40 35 40 H18"/>',
  calendar: '<rect x="7" y="11" width="34" height="30" rx="3"/><path d="M7 20 H41 M16 6 V15 M32 6 V15"/><path d="M15 28 H21 M27 28 H33 M15 35 H21"/>',
  scan: '<path d="M8 16 V8 H16 M32 8 H40 V16 M40 32 V40 H32 M16 40 H8 V32"/><path d="M12 24 H36"/>',
  shieldcheck: '<path d="M24 6 L39 11 V23 C39 33 32 39 24 43 C16 39 9 33 9 23 V11 Z"/><path d="M17 24 L22 29 L31 18"/>',
}
export const ICON_KEYS = Object.keys(ICONS)

const f = (n) => Math.round(n * 100) / 100
// 26 个大写字母的描边字形（10×14 网格）：国家代码用它画，避免 SVG 文字对字体的依赖
const GLYPH = {
  A: 'M0 14 L5 0 L10 14 M2 9 H8', B: 'M0 0 V14 M0 0 H6 C10 0 10 7 6 7 H0 M6 7 C11 7 11 14 6 14 H0', C: 'M10 2 C6 -1 0 0 0 7 C0 14 6 15 10 12',
  D: 'M0 0 V14 H4 C11 14 11 0 4 0 Z', E: 'M10 0 H0 V14 H10 M0 7 H7', F: 'M10 0 H0 V14 M0 7 H7', G: 'M10 2 C6 -1 0 0 0 7 C0 14 7 15 10 11 V8 H6',
  H: 'M0 0 V14 M10 0 V14 M0 7 H10', I: 'M2 0 H8 M5 0 V14 M2 14 H8', J: 'M10 0 V9 C10 15 2 15 0 10', K: 'M0 0 V14 M10 0 L0 8 M3 6 L10 14',
  L: 'M0 0 V14 H10', M: 'M0 14 V0 L5 8 L10 0 V14', N: 'M0 14 V0 L10 14 V0', O: 'M5 0 C-3 0 -3 14 5 14 C13 14 13 0 5 0 Z',
  P: 'M0 14 V0 H6 C11 0 11 8 6 8 H0', Q: 'M5 0 C-3 0 -3 14 5 14 C13 14 13 0 5 0 Z M6 10 L11 15', R: 'M0 14 V0 H6 C11 0 11 8 6 8 H0 M5 8 L10 14',
  S: 'M10 2 C6 -1 0 1 0 4 C0 8 10 6 10 10 C10 14 3 15 0 12', T: 'M0 0 H10 M5 0 V14', U: 'M0 0 V9 C0 16 10 16 10 9 V0', V: 'M0 0 L5 14 L10 0',
  W: 'M0 0 L2.5 14 L5 5 L7.5 14 L10 0', X: 'M0 0 L10 14 M10 0 L0 14', Y: 'M0 0 L5 7 L10 0 M5 7 V14', Z: 'M0 0 H10 L0 14 H10',
}
const glyphs = (text, cx, cy, ink, k = 3.1) => {
  const gap = 5, w = 10 * k, total = text.length * w + (text.length - 1) * gap * k / 2
  return '<g fill="none" stroke="' + ink + '" stroke-width="' + f(3.4 / k) + '" stroke-linecap="round" stroke-linejoin="round">' + [...text].map((ch, i) =>
    '<path d="' + (GLYPH[ch] || GLYPH.X) + '" transform="translate(' + f(cx - total / 2 + i * (w + gap * k / 2)) + ' ' + f(cy - 7 * k) + ') scale(' + k + ')"/>').join('') + '</g>'
}
const polar = (r, deg, cx = 128, cy = 128) => [f(cx + r * Math.sin(deg * Math.PI / 180)), f(cy - r * Math.cos(deg * Math.PI / 180))]
const poly = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L') + ' Z'
const hex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '')
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function mix(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16)
  const ch = [16, 8, 0].map((sh) => Math.round(((A >> sh) & 255) * (1 - t) + ((B >> sh) & 255) * t))
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}
const shade = (c, k) => (k < 0 ? mix(c, '#000000', -k) : mix(c, '#ffffff', k))
const sc = (k, cx = 128, cy = 128) => `transform="translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})"`
const star = (x, y, s, fill, extra = '') => `<path d="M${x} ${y - s} L${f(x + s * 0.3)} ${f(y - s * 0.3)} L${x + s} ${y} L${f(x + s * 0.3)} ${f(y + s * 0.3)} L${x} ${y + s} L${f(x - s * 0.3)} ${f(y + s * 0.3)} L${x - s} ${y} L${f(x - s * 0.3)} ${f(y - s * 0.3)} Z" fill="${fill}" ${extra}/>`
const lin = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`
const rad = (id, stops, cx = 0.35, cy = 0.3, r = 0.85) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`
const metalStops = (m) => [[0, m.s[0]], [0.35, m.s[1]], [0.7, m.s[2]], [1, m.s[3]]]
const gem = (x, y, r, m, u) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${u}gm)" stroke="${m.s[3]}" stroke-opacity="0.6" stroke-width="1"/><circle cx="${f(x - r * 0.3)}" cy="${f(y - r * 0.35)}" r="${f(r * 0.28)}" fill="#fff" opacity="0.85"/>`
const iconG = (key, scale, cx, cy, stroke, w, extra = '') => `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-24 -24)" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[key] || ICONS.star}</g>`
// 浮雕图标：先画一层偏移的高光，再画本体
const engraved = (key, scale, cx, cy, ink, hi = '#ffffff', w = 3.2) => iconG(key, scale, cx + 1.4, cy + 1.8, hi, w, 'opacity="0.75"') + iconG(key, scale, cx, cy, ink, w)
const pips = (n, cx, y, fill, stroke, gap = 17, r = 5.5) => Array.from({ length: n }, (_, i) => `<circle cx="${f(cx - (n - 1) * gap / 2 + i * gap)}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-opacity="0.55" stroke-width="1.2"/>`).join('')

function outline(shape) {
  if (shape === 'hexagon') return poly([0, 60, 120, 180, 240, 300].map((a) => polar(116, a)))
  if (shape === 'shield') return 'M128 12 L226 44 V120 C226 176 184 218 128 244 C72 218 30 176 30 120 V44 Z'
  if (shape === 'circle') return poly(Array.from({ length: 36 }, (_, i) => polar(i % 2 ? 108 : 117, i * 10)))
  if (shape === 'burst') return poly(Array.from({ length: 32 }, (_, i) => polar(i % 2 ? 100 : 120, i * 11.25)))
  return poly(Array.from({ length: 48 }, (_, i) => polar(i % 2 ? 107 : 117, i * 7.5))) // seal：花边章
}
const SHAPE_OF = { journey: 'shield', explore: 'hexagon', creator: 'circle', special: 'seal' }

/** 通用金属徽章：旅程 / 足迹 / 创作 / 特别 */
function metalBadge(o, m, owned, rarity, u) {
  const shape = SHAPE_OF[o.category] || 'seal'
  const d = outline(shape)
  const fancy = owned && (rarity === 'epic' || rarity === 'legend')
  const accent = owned && hex(o.color) ? o.color : m.s[2]
  const ink = owned && hex(o.color) ? shade(o.color, -0.55) : m.ink
  const defs = lin(u + 'r', metalStops(m)) + lin(u + 'rr', metalStops(m), 1, 1, 0, 0) + rad(u + 'f', [[0, mix(m.s[0], '#ffffff', 0.5)], [1, mix(m.s[1], '#ffffff', 0.25)]])
    + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.55 : 0.3], [1, '#fff', 0]]) + rad(u + 'gm', [[0, '#ffffff'], [0.45, owned ? accent : m.s[1]], [1, m.s[3]]], 0.35, 0.3, 0.8)
    + `<clipPath id="${u}c"><path d="${d}"/></clipPath><clipPath id="${u}cf"><path d="${d}" ${sc(0.84)}/></clipPath>`
  const out = []
  if (fancy && shape !== 'shield') out.push(`<path d="M92 190 L72 252 L98 240 L112 254 L122 196 Z" fill="${accent}"/><path d="M164 190 L184 252 L158 240 L144 254 L134 196 Z" fill="${shade(accent, -0.25)}"/>`)
  out.push(`<ellipse cx="128" cy="246" rx="66" ry="7" fill="#000" opacity="0.10"/>`)
  out.push(`<path d="${d}" fill="url(#${u}r)"/>`)
  out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2.4" ${sc(0.985)}/>`)
  out.push(`<path d="${d}" fill="none" stroke="${m.s[3]}" stroke-opacity="0.35" stroke-width="1.6" transform="translate(1.6 2) ${sc(0.97).replace('transform="', '').replace('"', '')}"/>`)
  out.push(`<path d="${d}" fill="url(#${u}rr)" opacity="0.9" ${sc(0.875)}/>`)
  out.push(`<path d="${d}" fill="url(#${u}f)" ${sc(0.84)}/>`)
  if (fancy) { // 星芒：史诗 / 传说
    const rays = Array.from({ length: 24 }, (_, i) => { const a = polar(150, i * 15), b = polar(150, i * 15 + 7.5); return `<path d="M128 128 L${a.join(' ')} L${b.join(' ')} Z" fill="#fff" opacity="${i % 2 ? 0.06 : 0.16}"/>` }).join('')
    out.push(`<g clip-path="url(#${u}cf)">${rays}</g>`)
  }
  out.push(`<circle cx="128" cy="126" r="60" fill="none" stroke="${m.s[3]}" stroke-opacity="0.35" stroke-width="1.4"/>`)
  out.push(`<circle cx="128" cy="126" r="56" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="${owned ? '1.5 5' : '0'}" stroke-linecap="round"/>`)
  out.push(engraved(o.icon_key, 1.75, 128, 126, ink))
  out.push(`<g clip-path="url(#${u}c)"><path d="M-30 60 L110 -30 L170 -30 L30 120 Z" fill="url(#${u}sh)"/></g>`)
  out.push(`<g clip-path="url(#${u}cf)"><ellipse cx="94" cy="64" rx="70" ry="26" fill="#fff" opacity="${owned ? 0.3 : 0.18}" transform="rotate(-24 94 64)"/></g>`)
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  if (tier > 0 && o.series) out.push(pips(tier, 128, shape === 'shield' ? 206 : 210, owned ? accent : m.s[1], ink))
  if (owned && rarity !== 'common') {
    const g = rarity === 'rare' ? [[0, 12]] : rarity === 'epic' ? [[0, 12], [-62, 36], [62, 36]] : [[0, 12], [-62, 36], [62, 36], [-110, 90], [110, 90]]
    for (const [dx, y] of g) out.push(gem(f(128 + dx), shape === 'shield' && dx ? y + 12 : y, rarity === 'legend' && !dx ? 7 : 5.5, m, u))
  }
  if (owned && rarity === 'legend') out.push(star(40, 54, 13, accent) + star(218, 72, 10, accent) + star(206, 198, 8, accent))
  if (owned && rarity === 'epic') out.push(star(46, 58, 9, accent) + star(212, 68, 7, accent))
  return { defs, body: out.join('') }
}

/** 会员等级：带翼金属奖章，等级越高金属越贵、星越多 */
function levelBadge(o, owned, u) {
  const lv = Math.max(1, Math.min(8, Number(o.tier) || 1))
  const m = METAL[owned ? (o.metal && METAL[o.metal] ? o.metal : LEVEL_METAL[(lv - 1) % LEVEL_METAL.length]) : 'off']
  const icon = ICONS[o.icon_key] ? o.icon_key : ['compass', 'boat', 'crown', 'globe'][(lv - 1) % 4]
  const cx = 128, cy = 138
  const defs = lin(u + 'r', metalStops(m)) + lin(u + 'rr', metalStops(m), 1, 1, 0, 0) + rad(u + 'f', [[0, mix(m.s[0], '#ffffff', 0.55)], [1, mix(m.s[1], '#ffffff', 0.2)]])
    + lin(u + 'w', [[0, m.s[0]], [0.5, m.s[1]], [1, m.s[2]]], 0, 0, 1, 0) + rad(u + 'gl', [[0, m.glow, owned ? 0.55 : 0.2], [1, m.glow, 0]], 0.5, 0.5, 0.5)
    + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.6 : 0.3], [1, '#fff', 0]]) + `<clipPath id="${u}c"><circle cx="${cx}" cy="${cy}" r="64"/></clipPath>`
  const out = []
  if (owned && lv >= 3) out.push(`<circle cx="${cx}" cy="${cy - 4}" r="124" fill="url(#${u}gl)"/>`)
  for (const side of [1, -1]) {
    [[-42, 0.92, 0], [-22, 0.9, 0], [-2, 0.8, 0], [18, 0.66, 0]].forEach(([a, k]) => {
      out.push(`<path d="M0 0 C 14 -16, 50 -22, 86 -4 C 52 16, 18 17, 0 0 Z" transform="translate(${cx} ${cy - 4}) scale(${side} 1) rotate(${a}) translate(52 0) scale(${k})" fill="url(#${u}w)" stroke="${m.s[3]}" stroke-opacity="0.5" stroke-width="1.4"/>`)
      out.push(`<path d="M6 0 L${f(80 * k)} -1" transform="translate(${cx} ${cy - 4}) scale(${side} 1) rotate(${a}) translate(52 0)" stroke="#fff" stroke-opacity="0.55" stroke-width="1.2" fill="none"/>`)
    })
  }
  out.push(`<ellipse cx="${cx}" cy="248" rx="60" ry="6" fill="#000" opacity="0.10"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="66" fill="url(#${u}r)"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2.2"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="58" fill="url(#${u}rr)"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="54" fill="url(#${u}f)"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="48" fill="none" stroke="${m.s[2]}" stroke-opacity="0.6" stroke-width="1.6" stroke-dasharray="${owned ? '1.5 4.5' : '0'}" stroke-linecap="round"/>`)
  out.push(engraved(icon, 1.5, cx, cy, m.ink))
  out.push(`<g clip-path="url(#${u}c)"><path d="M40 60 L150 40 L190 40 L70 130 Z" fill="url(#${u}sh)"/><ellipse cx="108" cy="102" rx="52" ry="18" fill="#fff" opacity="${owned ? 0.28 : 0.16}" transform="rotate(-22 108 102)"/></g>`)
  const n = Math.min(lv, 5)
  for (let i = 0; i < n; i++) { const a = n === 1 ? 0 : -((n - 1) * 15) + i * 30; const [sx, sy] = polar(88, a, cx, cy - 4); out.push(star(sx, sy, 8.5, owned ? m.s[1] : '#cfcfcf', `stroke="${m.s[3]}" stroke-opacity="0.6" stroke-width="1"`)) }
  if (owned && lv >= 4) out.push(star(34, 62, 11, '#ffffff') + star(224, 84, 8, '#ffffff') + star(214, 214, 9, m.s[1]))
  return { defs, body: out.join('') }
}

/** 商户等级：门楼招牌——屋檐 + 两根吊绳 + 金属匾额；铜 / 银 / 金 / 钻随等级，匾额下沿点亮等级星 */
function merchantLevelBadge(o, owned, u) {
  const lv = Math.max(1, Math.min(8, Number(o.tier) || 1))
  const m = METAL[owned ? LEVEL_METAL[(lv - 1) % LEVEL_METAL.length] : 'off']
  const icon = ICONS[o.icon_key] ? o.icon_key : 'store'
  const body = 'M40 74 H216 a10 10 0 0 1 10 10 V196 a10 10 0 0 1 -10 10 H40 a10 10 0 0 1 -10 -10 V84 a10 10 0 0 1 10 -10 Z'
  const defs = lin(u + 'r', metalStops(m)) + lin(u + 'rr', metalStops(m), 1, 1, 0, 0) + rad(u + 'f', [[0, mix(m.s[0], '#ffffff', 0.55)], [1, mix(m.s[1], '#ffffff', 0.2)]], 0.35, 0.25, 0.95)
    + lin(u + 'rf', owned ? [[0, '#6b3a17'], [1, '#2e1707']] : [[0, '#b8b8b8'], [1, '#8f8f8f']], 0, 0, 0, 1) + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.55 : 0.3], [1, '#fff', 0]])
    + rad(u + 'gl', [[0, m.glow, owned ? 0.5 : 0.15], [1, m.glow, 0]], 0.5, 0.5, 0.5) + '<clipPath id="' + u + 'c"><path d="' + body + '"/></clipPath>'
  const out = []
  if (owned && lv >= 3) out.push('<ellipse cx="128" cy="140" rx="126" ry="100" fill="url(#' + u + 'gl)"/>')
  out.push('<ellipse cx="128" cy="248" rx="80" ry="6" fill="#000" opacity="0.10"/>')
  // 吊绳
  out.push('<path d="M74 52 V76 M182 52 V76" stroke="' + m.s[3] + '" stroke-width="4" stroke-linecap="round"/><circle cx="74" cy="76" r="5" fill="' + m.s[1] + '" stroke="' + m.s[3] + '" stroke-width="1.5"/><circle cx="182" cy="76" r="5" fill="' + m.s[1] + '" stroke="' + m.s[3] + '" stroke-width="1.5"/>')
  // 屋檐
  out.push('<path d="M18 52 Q128 -4 238 52 Z" fill="url(#' + u + 'rf)"/><path d="M18 52 Q128 -4 238 52" fill="none" stroke="' + m.s[1] + '" stroke-width="3.5"/><path d="M12 54 H244" stroke="' + m.s[2] + '" stroke-width="6" stroke-linecap="round"/>')
  out.push('<path d="M52 44 Q128 10 204 44" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="3"/>')
  // 匾额
  out.push('<path d="' + body + '" fill="url(#' + u + 'r)"/><path d="' + body + '" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2.4" ' + sc(0.985, 128, 140) + '/>')
  out.push('<path d="' + body + '" fill="url(#' + u + 'rr)" opacity="0.9" ' + sc(0.9, 128, 140) + '/><path d="' + body + '" fill="url(#' + u + 'f)" ' + sc(0.86, 128, 140) + '/>')
  for (const [x, y] of [[48, 92], [208, 92], [48, 188], [208, 188]]) out.push('<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="' + m.s[2] + '" stroke="' + m.s[3] + '" stroke-opacity="0.6"/>')
  out.push('<circle cx="128" cy="134" r="46" fill="none" stroke="' + m.s[2] + '" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="' + (owned ? '1.5 4.5' : '0') + '" stroke-linecap="round"/>')
  out.push(engraved(icon, 1.7, 128, 134, m.ink))
  const n = Math.min(lv, 5)
  for (let i = 0; i < n; i++) out.push(star(f(128 - (n - 1) * 15 + i * 30), 190, 8, owned ? m.s[1] : '#cfcfcf', 'stroke="' + m.s[3] + '" stroke-opacity="0.6" stroke-width="1"'))
  out.push('<g clip-path="url(#' + u + 'c)"><path d="M10 120 L100 60 L150 60 L40 170 Z" fill="url(#' + u + 'sh)"/><ellipse cx="96" cy="100" rx="70" ry="18" fill="#fff" opacity="' + (owned ? 0.25 : 0.14) + '" transform="rotate(-12 96 100)"/></g>')
  if (owned && lv >= 4) out.push(star(24, 30, 10, '#ffffff') + star(236, 40, 8, '#ffffff'))
  return { defs, body: out.join('') }
}

/** 经营荣誉：花结奖章——波纹圆章 + 两条垂带；金属随稀有度，系列阶数画在垂带上 */
function merchantHonorBadge(o, owned, rarity, u) {
  const m = METAL[owned ? RARITY_METAL[rarity] : 'off']
  const accent = owned && hex(o.color) ? o.color : m.s[2]
  const ink = owned && hex(o.color) ? shade(o.color, -0.55) : m.ink
  const ribbon = owned ? [shade(accent, 0.05), shade(accent, -0.35)] : ['#d0d0d0', '#a8a8a8']
  const defs = lin(u + 'r', metalStops(m)) + lin(u + 'rr', metalStops(m), 1, 1, 0, 0) + rad(u + 'f', [[0, mix(m.s[0], '#ffffff', 0.55)], [1, mix(m.s[1], '#ffffff', 0.2)]])
    + lin(u + 'rb', [[0, ribbon[0]], [1, ribbon[1]]], 0, 0, 0, 1) + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.6 : 0.3], [1, '#fff', 0]]) + '<clipPath id="' + u + 'c"><circle cx="128" cy="112" r="68"/></clipPath>'
  const out = ['<ellipse cx="128" cy="250" rx="52" ry="5" fill="#000" opacity="0.10"/>']
  out.push('<path d="M82 160 L58 246 L92 230 L104 250 L124 168 Z" fill="url(#' + u + 'rb)" stroke="' + ribbon[1] + '" stroke-opacity="0.6" stroke-width="1.5"/><path d="M174 160 L198 246 L164 230 L152 250 L132 168 Z" fill="url(#' + u + 'rb)" stroke="' + ribbon[1] + '" stroke-opacity="0.6" stroke-width="1.5"/>')
  out.push('<path d="M98 200 L88 232 M158 200 L168 232" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>')
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  if (tier > 0 && o.series) out.push(pips(tier, 128, 232, owned ? '#fff3d6' : '#f0f0f0', ribbon[1], 13, 4))
  const ruffle = poly(Array.from({ length: 40 }, (_, i) => polar(i % 2 ? 76 : 88, i * 9, 128, 112)))
  out.push('<path d="' + ruffle + '" fill="url(#' + u + 'r)"/><circle cx="128" cy="112" r="72" fill="none" stroke="#fff" stroke-opacity="0.65" stroke-width="2.2"/>')
  out.push('<circle cx="128" cy="112" r="66" fill="url(#' + u + 'rr)"/><circle cx="128" cy="112" r="60" fill="url(#' + u + 'f)"/><circle cx="128" cy="112" r="50" fill="none" stroke="' + accent + '" stroke-opacity="0.55" stroke-width="1.8" stroke-dasharray="' + (owned ? '1.5 4.5' : '0') + '" stroke-linecap="round"/>')
  out.push(engraved(o.icon_key, 1.6, 128, 112, ink))
  out.push('<g clip-path="url(#' + u + 'c)"><path d="M50 60 L150 40 L190 40 L80 130 Z" fill="url(#' + u + 'sh)"/><ellipse cx="102" cy="76" rx="48" ry="16" fill="#fff" opacity="' + (owned ? 0.28 : 0.15) + '" transform="rotate(-24 102 76)"/></g>')
  if (owned && rarity === 'legend') out.push(star(34, 40, 12, accent) + star(222, 54, 9, accent) + star(212, 176, 7, accent))
  if (owned && rarity === 'epic') out.push(star(40, 46, 9, accent) + star(216, 58, 7, accent))
  return { defs, body: out.join('') }
}

/** 会员荣誉：月桂花环 + 缎带 */
function memberBadge(o, owned, rarity, u) {
  const m = METAL[owned ? RARITY_METAL[rarity] : 'off'], j = METAL[owned ? 'jade' : 'off']
  const cx = 128, cy = 122
  const defs = lin(u + 'r', metalStops(m)) + rad(u + 'f', [[0, mix(m.s[0], '#ffffff', 0.5)], [1, mix(m.s[1], '#ffffff', 0.2)]])
    + lin(u + 'lf', metalStops(j)) + lin(u + 'rb', owned ? [[0, '#e5533f'], [1, '#9f1d12']] : [[0, '#e0e0e0'], [1, '#b0b0b0']], 0, 0, 0, 1)
    + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.55 : 0.3], [1, '#fff', 0]]) + `<clipPath id="${u}c"><circle cx="${cx}" cy="${cy}" r="62"/></clipPath>`
  const out = [`<ellipse cx="128" cy="248" rx="64" ry="6" fill="#000" opacity="0.10"/>`]
  for (const side of [1, -1]) for (let i = 0; i < 9; i++) {
    const ang = side === 1 ? 200 + i * 16 : 160 - i * 16 // 左支从下往上、右支镜像
    const [x, y] = polar(86, ang, cx, cy)
    out.push(`<ellipse cx="${x}" cy="${y}" rx="15" ry="6.5" transform="rotate(${ang + (side === 1 ? -22 : 22)} ${x} ${y})" fill="url(#${u}lf)" stroke="${j.s[3]}" stroke-opacity="0.45" stroke-width="1"/>`)
  }
  out.push(`<circle cx="${cx}" cy="${cy}" r="66" fill="url(#${u}r)"/><circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2"/>`)
  out.push(`<circle cx="${cx}" cy="${cy}" r="56" fill="url(#${u}f)"/><circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="${m.s[2]}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="${owned ? '1.5 4.5' : '0'}" stroke-linecap="round"/>`)
  out.push(engraved(o.icon_key, 1.55, cx, cy, m.ink))
  out.push(`<g clip-path="url(#${u}c)"><ellipse cx="108" cy="92" rx="50" ry="17" fill="#fff" opacity="${owned ? 0.3 : 0.16}" transform="rotate(-22 108 92)"/></g>`)
  // 缎带
  out.push(`<path d="M44 196 L24 214 L48 214 Z" fill="${owned ? '#8f1a10' : '#a8a8a8'}"/><path d="M212 196 L232 214 L208 214 Z" fill="${owned ? '#8f1a10' : '#a8a8a8'}"/>`)
  out.push(`<path d="M40 190 Q128 222 216 190 L216 220 Q128 252 40 220 Z" fill="url(#${u}rb)" stroke="${owned ? '#f6d35a' : '#c8c8c8'}" stroke-width="2.2"/>`)
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  out.push(star(128, 36, 11, owned ? m.s[1] : '#cfcfcf', `stroke="${m.s[3]}" stroke-opacity="0.55" stroke-width="1"`))
  if (tier > 0) out.push(pips(tier, 128, 226, '#fff3d6', '#7a1c12', 15, 4.5))
  if (owned && rarity === 'legend') out.push(star(40, 54, 11, '#f6d35a') + star(216, 60, 9, '#f6d35a'))
  return { defs, body: out.join('') }
}

/** 城市印记：朱红篆刻印章 */
function cityBadge(o, owned, rarity, u) {
  const red = owned ? [hex(o.color) ? shade(o.color, 0.1) : '#e8553f', hex(o.color) ? o.color : '#b42a19', hex(o.color) ? shade(o.color, -0.45) : '#74160b'] : ['#d6d6d6', '#bdbdbd', '#9d9d9d']
  const cream = owned ? '#fff1dc' : '#f2f2f2'
  const gold = rarity === 'legend' ? '#f6d35a' : rarity === 'epic' ? '#e8c36a' : null
  const body = 'M40 26 H216 a14 14 0 0 1 14 14 V216 a14 14 0 0 1 -14 14 H40 a14 14 0 0 1 -14 -14 V40 a14 14 0 0 1 14 -14 Z'
  const defs = rad(u + 'f', [[0, red[0]], [0.6, red[1]], [1, red[2]]], 0.3, 0.25, 1) + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.32 : 0.2], [1, '#fff', 0]]) + `<clipPath id="${u}c"><path d="${body}"/></clipPath>`
  const out = [`<path d="${body}" transform="translate(5 8)" fill="#000" opacity="0.14"/>`]
  out.push(`<g transform="rotate(-3 128 128)">`)
  out.push(`<path d="${body}" fill="url(#${u}f)"/>`)
  if (gold && owned) out.push(`<path d="${body}" fill="none" stroke="${gold}" stroke-width="5"/>`)
  out.push(`<rect x="40" y="40" width="176" height="176" rx="8" fill="none" stroke="${cream}" stroke-width="3.5"/><rect x="50" y="50" width="156" height="156" rx="5" fill="none" stroke="${cream}" stroke-opacity="0.45" stroke-width="1.2"/>`)
  for (const [x, y] of [[40, 40], [216, 40], [40, 216], [216, 216]]) out.push(`<circle cx="${x}" cy="${y}" r="5" fill="${gold && owned ? gold : cream}"/>`)
  out.push(engraved(o.icon_key, 2.35, 128, 118, cream, red[2], 3.4))
  // 磨损质感：确定性的细点与划痕
  const h = hash((o.seed || '') + o.icon_key)
  let dots = ''
  for (let i = 0; i < 16; i++) { const a = (h >> (i % 24)) + i * 2654435761, x = 52 + (Math.abs(a) % 150), y = 52 + (Math.abs(a >> 7) % 150); dots += `<circle cx="${x}" cy="${y}" r="${1 + (i % 3) * 0.45}" fill="${cream}" opacity="0.5"/>` }
  out.push(dots)
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  if (tier > 0 && o.series) out.push(pips(tier, 128, 198, cream, red[2], 15, 4.5))
  out.push(`<g clip-path="url(#${u}c)"><path d="M-20 70 L120 -20 L180 -20 L40 120 Z" fill="url(#${u}sh)"/></g>`)
  if (owned && rarity === 'legend') out.push(star(34, 40, 11, '#f6d35a') + star(222, 220, 9, '#f6d35a'))
  out.push('</g>')
  return { defs, body: out.join('') }
}

/** 国家印章：护照出入境章 */
function countryBadge(o, owned, rarity, u) {
  const ink = owned ? { common: '#27479a', rare: '#0e7466', epic: '#962253', legend: '#b3761a' }[rarity] || '#27479a' : '#b4b4b4'
  const code = /^[A-Za-z]{2}$/.test(o.country_code || '') ? o.country_code.toUpperCase() : 'XX'
  const defs = ''
  const out = [`<g transform="rotate(-9 128 128)">`]
  out.push(`<circle cx="128" cy="128" r="119" fill="none" stroke="${ink}" stroke-width="5" stroke-dasharray="1 7" stroke-linecap="round" opacity="0.9"/>`)
  out.push(`<circle cx="128" cy="128" r="110" fill="none" stroke="${ink}" stroke-width="5"/><circle cx="128" cy="128" r="99" fill="none" stroke="${ink}" stroke-width="1.8"/>`)
  out.push(`<circle cx="128" cy="128" r="85" fill="none" stroke="${ink}" stroke-width="1.5" stroke-dasharray="5 3.5" opacity="0.85"/>`)
  out.push(`<rect x="38" y="100" width="180" height="56" fill="${ink}" opacity="0.10"/><path d="M38 100 H218 M38 156 H218" stroke="${ink}" stroke-width="3"/>`)
  out.push(glyphs(code, 128, 128, ink))
  out.push(iconG(o.icon_key, 1.05, 128, 62, ink, 3.2))
  const tier = Math.max(1, Math.min(5, Number(o.tier) || 3))
  for (let i = 0; i < 5; i++) out.push(star(f(128 - 40 + i * 20), 184, 5.2, i < tier || !o.series ? ink : 'none', `stroke="${ink}" stroke-width="1"`))
  for (let i = 0; i < 36; i++) { const [x1, y1] = polar(99, i * 10, 128, 128), [x2, y2] = polar(93, i * 10, 128, 128); out.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${ink}" stroke-width="1.4" opacity="0.7"/>`) }
  // 盖章磨损：几处墨色缺口
  out.push(`<circle cx="128" cy="128" r="110" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="8" stroke-dasharray="7 52 3 71 5 120"/>`)
  out.push(`<circle cx="128" cy="128" r="99" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="5" stroke-dasharray="4 90 6 140"/>`)
  out.push('</g>')
  return { defs, body: out.join('') }
}

/** 可信勋章：深色玻璃八边形 + 虹彩边 + 节点网络 + 唯一指纹条 + 封存印记 */
function trustedBadge(o, owned, rarity, u) {
  const acc = owned ? { common: '#5ef0ff', rare: '#5ef0ff', epic: '#b58cff', legend: '#ffd36b' }[rarity] : '#9aa0aa'
  const body = owned ? ['#10183f', '#1d2a6e', '#080c24'] : ['#4a505c', '#5a606c', '#3a3f4a']
  const oct = poly([22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a) => polar(118, a)))
  const defs = rad(u + 'b', [[0, body[1]], [0.7, body[0]], [1, body[2]]], 0.4, 0.3, 0.9)
    + lin(u + 'i', owned ? [[0, '#5ef0ff'], [0.35, '#8a6bff'], [0.7, '#ff6bd6'], [1, '#ffd36b']] : [[0, '#c0c4cc'], [1, '#8c919c']])
    + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', owned ? 0.22 : 0.12], [1, '#fff', 0]]) + rad(u + 'gl', [[0, acc, owned ? 0.5 : 0.1], [1, acc, 0]], 0.5, 0.45, 0.5)
    + `<clipPath id="${u}c"><path d="${oct}" ${sc(0.9)}/></clipPath>`
  const out = [`<ellipse cx="128" cy="248" rx="62" ry="6" fill="#000" opacity="0.12"/>`]
  out.push(`<path d="${oct}" fill="url(#${u}i)"/>`)
  out.push(`<path d="${oct}" fill="url(#${u}b)" ${sc(0.92)}/>`)
  out.push(`<path d="${oct}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.5" ${sc(0.92)}/>`)
  const lat = []
  for (const [cx, cy] of [[128, 128], [128, 62], [128, 194], [71, 95], [185, 95], [71, 161], [185, 161]]) lat.push(`<path d="${poly(Array.from({ length: 6 }, (_, i) => polar(33, i * 60 + 30, cx, cy)))}" fill="none" stroke="${acc}" stroke-opacity="${owned ? 0.2 : 0.14}" stroke-width="1"/>`)
  out.push(`<g clip-path="url(#${u}c)">${lat.join('')}<circle cx="128" cy="124" r="92" fill="url(#${u}gl)"/></g>`)
  // 节点网络
  const nodes = [0, 72, 144, 216, 288].map((a) => polar(80, a + 18, 128, 124))
  out.push(nodes.map(([x, y]) => `<path d="M${x} ${y} L128 124" stroke="${acc}" stroke-opacity="0.5" stroke-width="1.4"/>`).join('') + nodes.map(([x, y], i) => `<path d="M${x} ${y} L${nodes[(i + 1) % 5].join(' ')}" stroke="${acc}" stroke-opacity="0.28" stroke-width="1"/>`).join(''))
  out.push(nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.6" fill="${acc}"/><circle cx="${x}" cy="${y}" r="8" fill="none" stroke="${acc}" stroke-opacity="0.4" stroke-width="1"/>`).join(''))
  out.push(`<circle cx="128" cy="124" r="40" fill="${body[2]}" opacity="0.55" stroke="${acc}" stroke-opacity="0.7" stroke-width="2"/>`)
  out.push(iconG(o.icon_key, 1.35, 128, 124, acc, 5.5, 'opacity="0.35"') + iconG(o.icon_key, 1.35, 128, 124, '#ffffff', 3))
  // 指纹条：由勋章标识派生，每枚不同
  const h = hash((o.seed || '') + '|' + o.icon_key)
  let fp = ''
  for (let i = 0; i < 16; i++) { const bit = (h >> (i % 30)) & 1; const hgt = 6 + (((h >>> (i % 24)) ^ (i * 40503)) % 5) * 2.2; fp += `<rect x="${f(76 + i * 6.9)}" y="${f(190 - hgt)}" width="4" height="${f(hgt)}" rx="1" fill="${acc}" opacity="${bit ? 0.95 : 0.4}"/>` }
  out.push(fp)
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  if (tier > 0 && o.series) out.push(pips(tier, 128, 206, acc, '#ffffff', 15, 4))
  out.push(`<g clip-path="url(#${u}c)"><path d="M-20 70 L110 -20 L170 -20 L40 120 Z" fill="url(#${u}sh)"/></g>`)
  // 封存印记
  if (owned) out.push(`<circle cx="198" cy="206" r="19" fill="${owned ? '#0b1230' : '#555b66'}" stroke="url(#${u}i)" stroke-width="3.4"/><path d="M189 206 L196 213 L208 199" fill="none" stroke="${owned ? acc : '#d0d0d0'}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`)
  if (owned && rarity !== 'common') out.push(star(40, 56, rarity === 'legend' ? 12 : 9, acc) + star(218, 66, 8, '#ffffff'))
  return { defs, body: out.join('') }
}

/**
 * 生成勋章 SVG
 * @param {{icon_key?, rarity?, category?, tier?, series?, color?, country_code?, seed?, metal?}} o
 * @param {boolean} owned 已获得 true；未获得 false（灰阶）
 */
export function renderBadgeSvg(o = {}, owned = true) {
  const cat0 = o.category === 'growth' ? 'level' : o.category
  const category = CATEGORIES[cat0] ? cat0 : 'special'
  const rarity = RARITIES[o.rarity] ? o.rarity : 'common'
  const icon_key = ICONS[o.icon_key] ? o.icon_key : (category === 'level' || category === 'mlevel' ? '' : 'star')
  const oo = { ...o, category, icon_key }
  const u = 'b' + hash(JSON.stringify([category, rarity, icon_key, o.tier, o.series, o.color, o.country_code, o.seed, o.metal, owned])).toString(36) + '_'
  let parts
  if (category === 'level') parts = levelBadge(oo, owned, u)
  else if (category === 'member') parts = memberBadge(oo, owned, rarity, u)
  else if (category === 'mlevel') parts = merchantLevelBadge(oo, owned, u)
  else if (category === 'mhonor') parts = merchantHonorBadge(oo, owned, rarity, u)
  else if (category === 'city') parts = cityBadge(oo, owned, rarity, u)
  else if (category === 'country') parts = countryBadge(oo, owned, rarity, u)
  else if (category === 'trusted') parts = trustedBadge(oo, owned, rarity, u)
  else parts = metalBadge(oo, METAL[owned ? RARITY_METAL[rarity] : 'off'], owned, rarity, u)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${parts.defs}</defs>${parts.body}</svg>`
}

/** 旅豆币：金币 + 豆形浮雕 + 滚边（旅豆页 / 订单抵扣处使用） */
export function renderBeanSvg() {
  const m = METAL.gold, u = 'bean_'
  const defs = lin(u + 'r', metalStops(m)) + lin(u + 'rr', metalStops(m), 1, 1, 0, 0) + rad(u + 'f', [[0, '#fff3b8'], [0.6, '#f3c93f'], [1, '#d9a21b']], 0.35, 0.3, 0.9)
    + lin(u + 'bn', [[0, '#a8680c'], [1, '#6e4300']], 0, 0, 1, 1) + lin(u + 'sh', [[0, '#fff', 0], [0.5, '#fff', 0.6], [1, '#fff', 0]])
    + rad(u + 'gl', [[0, '#ffe58a', 0.55], [1, '#ffe58a', 0]], 0.5, 0.5, 0.5) + `<clipPath id="${u}c"><circle cx="128" cy="128" r="104"/></clipPath>`
  const rim = Array.from({ length: 48 }, (_, i) => { const [x1, y1] = polar(116, i * 7.5), [x2, y2] = polar(121, i * 7.5); return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${m.s[3]}" stroke-opacity="0.55" stroke-width="2.4"/>` }).join('')
  const body = `<circle cx="128" cy="128" r="124" fill="url(#${u}gl)"/><ellipse cx="128" cy="248" rx="70" ry="6" fill="#000" opacity="0.10"/>`
    + `<circle cx="128" cy="128" r="118" fill="url(#${u}r)"/>${rim}<circle cx="128" cy="128" r="112" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2.4"/>`
    + `<circle cx="128" cy="128" r="104" fill="url(#${u}rr)"/><circle cx="128" cy="128" r="98" fill="url(#${u}f)"/><circle cx="128" cy="128" r="88" fill="none" stroke="${m.s[3]}" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="1.5 5" stroke-linecap="round"/>`
    // 豆：两瓣弯形 + 中缝
    + `<g transform="rotate(-28 128 128)"><path d="M128 56 C 176 56 196 96 190 134 C 184 176 150 202 120 198 C 82 192 62 156 68 118 C 74 78 98 56 128 56 Z" fill="url(#${u}bn)" opacity="0.28" transform="translate(4 6)"/>`
    + `<path d="M128 56 C 176 56 196 96 190 134 C 184 176 150 202 120 198 C 82 192 62 156 68 118 C 74 78 98 56 128 56 Z" fill="${m.s[0]}" stroke="${m.s[3]}" stroke-width="2.6" stroke-opacity="0.7"/>`
    + `<path d="M128 62 C 112 92 146 108 128 136 C 112 160 142 178 126 196" fill="none" stroke="${m.s[3]}" stroke-width="5" stroke-linecap="round" opacity="0.65"/>`
    + `<ellipse cx="102" cy="96" rx="20" ry="9" fill="#fff" opacity="0.7" transform="rotate(-35 102 96)"/></g>`
    + `<g clip-path="url(#${u}c)"><path d="M-10 70 L120 -20 L180 -20 L40 130 Z" fill="url(#${u}sh)"/></g>` + star(214, 52, 12, '#fff8d6') + star(44, 204, 8, '#fff8d6')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${defs}</defs>${body}</svg>`
}

// SVG → PNG：@resvg/resvg-js 是动态引入的；没安装时返回 null，调用方回退发 SVG
let resvgMod
async function toPng(svg, size) {
  if (resvgMod === undefined) { try { resvgMod = (await import('@resvg/resvg-js')).Resvg } catch { resvgMod = null } }
  if (!resvgMod) return null
  return new resvgMod(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}
const cache = new Map() // 路径 + 查询 → PNG；上限 400 张

const prof = (b) => ((typeof b.profile === 'string' ? JSON.parse(b.profile || '{}') : b.profile) || {})

/** 数据行 → 绘制参数 */
export function artOptions(b) {
  const pf = prof(b)
  return { icon_key: b.icon_key, rarity: pf.rarity, category: pf.category, tier: pf.tier, series: pf.series, color: pf.color, country_code: pf.country_code, seed: 'b' + b.id }
}

/**
 * HTTP 入口：
 *   /badge-art/<id>.svg?state=off
 *   /badge-art/preview.svg?icon_key=&rarity=&category=&tier=&series=&color=&country_code=&state=
 *   /badge-art/level/<n>.svg?state=off        会员等级徽章（n = 等级）
 *   /badge-art/mlevel/<n>.svg?state=off       商户等级徽章（n = 商户等级）
 *   /badge-art/bean.svg                        旅豆币
 * 以上路径把 .svg 换成 .png 即得 PNG（Buffer）。返回：SVG 字符串 / PNG Buffer；路径不匹配 null；找不到勋章 ''（调用方回 404）。
 */
export async function serveBadgeArt(pathname, query) {
  // .png：同一张图转成 PNG（?size=64~512，默认 256）；服务端没有转换能力时回退为 SVG 字符串
  if (pathname.startsWith('/badge-art/') && pathname.endsWith('.png')) {
    const svg = await serveBadgeArt(pathname.slice(0, -4) + '.svg', query)
    if (!svg) return svg
    const size = Math.max(64, Math.min(512, Number(query.get('size')) || 256))
    const key = pathname + '?' + query.toString()
    if (cache.has(key)) return cache.get(key)
    const png = await toPng(svg, size)
    if (png) { cache.set(key, png); if (cache.size > 400) cache.delete(cache.keys().next().value) }
    return png || svg
  }
  const owned = query.get('state') !== 'off'
  if (pathname === '/badge-art/bean.svg') return renderBeanSvg()
  const mm = /^\/badge-art\/mlevel\/(\d{1,2})\.svg$/.exec(pathname)
  if (mm) return renderBadgeSvg({ category: 'mlevel', tier: Number(mm[1]), seed: 'ml' + mm[1] }, owned)
  const lm = /^\/badge-art\/level\/(\d{1,2})\.svg$/.exec(pathname)
  if (lm) return renderBadgeSvg({ category: 'level', tier: Number(lm[1]), seed: 'lv' + lm[1] }, owned)
  const m = /^\/badge-art\/(\d+|preview)\.svg$/.exec(pathname)
  if (!m) return null
  if (m[1] === 'preview') {
    return renderBadgeSvg({ icon_key: query.get('icon_key'), rarity: query.get('rarity'), category: query.get('category'), tier: query.get('tier'), country_code: query.get('country_code'), color: query.get('color'),
      series: query.get('series') || (Number(query.get('tier')) ? 'x' : ''), seed: query.get('seed') || 'preview' }, owned)
  }
  const b = await one('SELECT * FROM badge WHERE id = ?', [Number(m[1])])
  return b ? renderBadgeSvg(artOptions(b), owned) : ''
}
