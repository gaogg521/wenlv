// 勋章图形：由数据生成 SVG 勋章（不依赖美工出图，也不引入图片库）。
//   外形 = 勋章类别（探索 六边形 / 旅程 盾牌 / 创作 圆章 / 成长 星芒 / 特别 花边章）
//   配色 = 稀有度（普通 铜 / 稀有 银蓝 / 史诗 紫金 / 传说 金，传说另带光点与飘带）
//   图标 = icon_key（内置 17 个线性图标，未知键回退为星形）
//   系列勋章 = 底部用小圆点标出当前阶数；未获得 = 灰阶 + 低饱和
// 后台上传了「勋章图」（icon_img）时仍以上传图为准；这里是没有美工图时的默认形象，也是后台编辑器的实时预览。
import { q, one } from '../db.mjs'

export const CATEGORIES = {
  explore: { label: '探索', shape: 'hexagon' },
  journey: { label: '旅程', shape: 'shield' },
  creator: { label: '创作', shape: 'circle' },
  growth: { label: '成长', shape: 'burst' },
  special: { label: '特别', shape: 'seal' },
}
export const RARITIES = { common: '普通', rare: '稀有', epic: '史诗', legend: '传说' }

const PALETTE = {
  common: { rim: ['#f3d4ad', '#a8703f'], face: ['#fff3df', '#e8c294'], ink: '#7a461d', accent: '#c98445' },
  rare: { rim: ['#eaf2fb', '#7f98b8'], face: ['#f7fbff', '#c9dcf0'], ink: '#2c4a73', accent: '#5b8ac4' },
  epic: { rim: ['#f0e2ff', '#8b5fd0'], face: ['#faf4ff', '#dcc4f7'], ink: '#4a2a8a', accent: '#9a6ae0' },
  legend: { rim: ['#fff2b8', '#c8921a'], face: ['#fffbe6', '#f6dc7c'], ink: '#7a4b00', accent: '#e0a800' },
  off: { rim: ['#efefef', '#c2c2c2'], face: ['#f7f7f7', '#e0e0e0'], ink: '#b3b3b3', accent: '#cdcdcd' },
}

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
  heart: '<path d="M24 40 C8 28 6 16 14 12 C19 9.500 23 13 24 16 C25 13 29 9.500 34 12 C42 16 40 28 24 40 Z"/>',
  pin: '<path d="M24 42 C14 30 12 24 12 19 a12 12 0 0 1 24 0 C36 24 34 30 24 42 Z"/><circle cx="24" cy="19" r="4.500"/>',
  crown: '<path d="M8 34 L10 14 L19 24 L24 11 L29 24 L38 14 L40 34 Z"/><path d="M8 39 H40"/>',
  footprint: '<ellipse cx="17" cy="30" rx="6" ry="10"/><ellipse cx="31" cy="19" rx="6" ry="10"/>',
  lantern: '<path d="M18 8 H30"/><ellipse cx="24" cy="24" rx="10" ry="13"/><path d="M24 11 V37"/><path d="M20 38 H28"/><path d="M24 38 V45"/>',
  globe: '<circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="7" ry="16"/><path d="M8 24 H40"/>',
  book: '<path d="M7 12 H22 a2 2 0 0 1 2 2 V38 a2 2 0 0 0 -2 -2 H7 Z"/><path d="M41 12 H26 a2 2 0 0 0 -2 2 V38 a2 2 0 0 1 2 -2 H41 Z"/>',
  bridge: '<path d="M5 35 H43"/><path d="M9 35 C9 21 39 21 39 35"/><path d="M16 27 V35 M24 25 V35 M32 27 V35"/>',
}
export const ICON_KEYS = Object.keys(ICONS)

const f = (n) => Math.round(n * 100) / 100
const polar = (r, deg) => [f(128 + r * Math.sin(deg * Math.PI / 180)), f(128 - r * Math.cos(deg * Math.PI / 180))]
const poly = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L') + ' Z'

/** 外轮廓路径（中心 128,128，最大半径约 118） */
function outline(shape) {
  if (shape === 'hexagon') return poly([0, 60, 120, 180, 240, 300].map((a) => polar(116, a)))
  if (shape === 'shield') return 'M128 12 L226 44 V120 C226 176 184 218 128 244 C72 218 30 176 30 120 V44 Z'
  if (shape === 'circle') return 'M128 12 a116 116 0 1 0 0.01 0 Z'
  if (shape === 'burst') return poly(Array.from({ length: 32 }, (_, i) => polar(i % 2 ? 100 : 120, i * 11.25)))
  return poly(Array.from({ length: 48 }, (_, i) => polar(i % 2 ? 107 : 117, i * 7.5))) // seal：花边章
}

const hex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '')
function shade(c, k) { // k<0 变暗，k>0 变亮
  const n = parseInt(c.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))))
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}
const sparkle = (x, y, s, fill) => `<path d="M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28} Z" fill="${fill}"/>`

/**
 * 生成勋章 SVG
 * @param {{icon_key?:string, rarity?:string, category?:string, tier?:number, series?:string, color?:string}} o
 * @param {boolean} owned 已获得 true；未获得 false（灰阶）
 */
export function renderBadgeSvg(o = {}, owned = true) {
  const cat = CATEGORIES[o.category] ? o.category : 'special'
  const rarity = RARITIES[o.rarity] ? o.rarity : 'common'
  let p = PALETTE[owned ? rarity : 'off']
  if (owned && hex(o.color)) p = { ...p, accent: o.color, ink: shade(o.color, -0.55) } // 后台指定主题色：改图标与点缀色
  const shape = CATEGORIES[cat].shape
  const d = outline(shape)
  const icon = ICONS[o.icon_key] || ICONS.star
  const tier = Math.max(0, Math.min(5, Number(o.tier) || 0))
  const showTier = tier > 0 && !!o.series
  const fancy = owned && (rarity === 'epic' || rarity === 'legend')
  const out = []
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">')
  out.push(`<defs><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.rim[0]}"/><stop offset="1" stop-color="${p.rim[1]}"/></linearGradient>`
    + `<radialGradient id="face" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${p.face[0]}"/><stop offset="1" stop-color="${p.face[1]}"/></radialGradient>`
    + `<clipPath id="cl"><path d="${d}" transform="translate(128 128) scale(0.84) translate(-128 -128)"/></clipPath></defs>`)
  // 飘带（史诗 / 传说；盾牌外形自带下尖，不加）
  if (fancy && shape !== 'shield') {
    out.push(`<path d="M92 190 L72 252 L98 240 L112 254 L122 196 Z" fill="${p.accent}"/><path d="M164 190 L184 252 L158 240 L144 254 L134 196 Z" fill="${shade(p.accent, -0.2)}"/>`)
  }
  out.push(`<path d="${d}" fill="url(#rim)"/>`)
  out.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="${owned ? 0.55 : 0.4}" stroke-width="2.500" transform="translate(128 128) scale(0.97) translate(-128 -128)"/>`)
  out.push(`<path d="${d}" fill="url(#face)" transform="translate(128 128) scale(0.84) translate(-128 -128)"/>`)
  out.push(`<path d="${d}" fill="none" stroke="${p.rim[1]}" stroke-opacity="0.55" stroke-width="2" transform="translate(128 128) scale(0.84) translate(-128 -128)"/>`)
  // 高光
  out.push(`<g clip-path="url(#cl)"><ellipse cx="96" cy="62" rx="74" ry="28" fill="#ffffff" opacity="${owned ? 0.32 : 0.2}" transform="rotate(-24 96 62)"/></g>`)
  // 图标：外围一圈细环 + 线性图标
  out.push(`<circle cx="128" cy="126" r="58" fill="none" stroke="${p.accent}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="${rarity === 'common' || !owned ? '0' : '3 5'}"/>`)
  out.push(`<g transform="translate(128 126) scale(1.7) translate(-24 -24)" fill="none" stroke="${p.ink}" stroke-width="3.200" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`)
  // 系列阶数
  if (showTier) {
    const gap = 17, x0 = 128 - (tier - 1) * gap / 2
    for (let i = 0; i < tier; i++) out.push(`<circle cx="${f(x0 + i * gap)}" cy="${shape === 'shield' ? 204 : 210}" r="5.500" fill="${p.accent}" stroke="${p.ink}" stroke-opacity="0.5" stroke-width="1.200"/>`)
  }
  if (owned && rarity === 'legend') out.push(sparkle(40, 52, 13, p.accent) + sparkle(218, 70, 10, p.accent) + sparkle(206, 196, 8, p.accent))
  if (owned && rarity === 'epic') out.push(sparkle(46, 56, 9, p.accent) + sparkle(212, 66, 7, p.accent))
  out.push('</svg>')
  return out.join('')
}

const prof = (b) => ((typeof b.profile === 'string' ? JSON.parse(b.profile || '{}') : b.profile) || {})

/** 数据行 → 绘制参数 */
export function artOptions(b) {
  const pf = prof(b)
  return { icon_key: b.icon_key, rarity: pf.rarity, category: pf.category, tier: pf.tier, series: pf.series, color: pf.color }
}

/**
 * HTTP 入口：/badge-art/<id>.svg?state=off  或  /badge-art/preview.svg?icon_key=&rarity=&category=&tier=&series=&color=&state=
 * 返回 SVG 字符串；路径不匹配返回 null；找不到勋章返回 ''（调用方回 404）。
 */
export async function serveBadgeArt(pathname, query) {
  const m = /^\/badge-art\/(\d+|preview)\.svg$/.exec(pathname)
  if (!m) return null
  const owned = query.get('state') !== 'off'
  if (m[1] === 'preview') {
    return renderBadgeSvg({ icon_key: query.get('icon_key'), rarity: query.get('rarity'), category: query.get('category'), tier: query.get('tier'), series: query.get('series') || (Number(query.get('tier')) ? 'x' : ''), color: query.get('color') }, owned)
  }
  const b = await one('SELECT * FROM badge WHERE id = ?', [Number(m[1])])
  return b ? renderBadgeSvg(artOptions(b), owned) : ''
}
