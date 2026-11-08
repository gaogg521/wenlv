// 商户专属珐琅徽记：清楚的轮廓、大图形、暖纸面，64px 下仍能辨认。
// 这里只画外观，不读取或推断经营等级、发放资格、可信记录确认状态。
const PALETTES = [
  { rim:'#c5a17a', face:'#f3e7d6', ink:'#8c6543', light:'#fff8eb' },
  { rim:'#a3af82', face:'#e7eddc', ink:'#5b744c', light:'#fafcef' },
  { rim:'#c3a260', face:'#f4e7c3', ink:'#937136', light:'#fff9e5' },
  { rim:'#c5aa70', face:'#355442', ink:'#efdeb3', light:'#54715a' },
]
const OFF = {rim:'#cbc9bc',face:'#eae8df',ink:'#a6a496',light:'#f5f3ec'}
const rank = n => Math.max(1,Math.min(4,Math.trunc(Number(n)||1)))
const rgba = c => /^#[0-9a-fA-F]{6}$/.test(c||'')
const SYMBOLS = {
  store:'<path d="M24 5L30 17L43 19L33 29L35 42L24 36L13 42L15 29L5 19L18 17Z"/>',
  ticket:'<path d="M7 11H41V19C34 19 34 29 41 29V37H7V29C14 29 14 19 7 19ZM28 13V16M28 23V26M28 33V35M15 14H21M15 34H21"/>',
  trend:'<path d="M7 38V27H15V38M21 38V20H29V38M35 38V11H43V38M7 18L19 11L29 15L41 5M34 5H41V12"/>',
  crown:'<path d="M7 12L16 21L24 7L32 21L41 12L37 34H11ZM12 41H36"/>',
  thumb:'<path d="M8 23H16V40H8ZM16 25L24 16V7C31 7 31 14 28 21H38C41 21 42 23 41 27L38 37C37 40 35 40 32 40H16"/>',
  scan:'<path d="M7 17V7H17M31 7H41V17M41 31V41H31M17 41H7V31M17 17H22V22H17ZM28 17H33V22H28ZM17 28H22V33H17ZM28 28H33V33H28Z"/>',
  calendar:'<rect x="7" y="10" width="34" height="31" rx="5"/><path d="M15 6V15M33 6V15M7 21H41M17 31L22 36L32 26"/>',
  lantern:'<path d="M18 6H30M24 6V11M14 12H34C43 18 43 31 34 37H14C5 31 5 18 14 12ZM14 12C22 19 22 30 14 37M34 12C26 19 26 30 34 37M18 41H30M24 41V46"/>',
  seal:'<rect x="10" y="6" width="28" height="34" rx="4"/><path d="M17 15H31M17 22H28M17 29H23M30 32L34 36L42 26"/>',
  shieldcheck:'<path d="M24 5L40 11V24C40 33 33 40 24 44C15 40 8 33 8 24V11ZM16 24L22 30L33 18"/>',
  node:'<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="29" y="5" width="14" height="14" rx="3"/><rect x="17" y="29" width="14" height="14" rx="3"/><path d="M12 19V24H36V19M24 24V29"/>',
  star:'<path d="M24 5L30 17L43 19L33 29L35 42L24 36L13 42L15 29L5 19L18 17Z"/>',
}
const dots = (tier,p) => Array.from({length:4},(_,i)=>`<circle cx="${104+i*16}" cy="192" r="4" fill="${i<tier?p.ink:'none'}" stroke="${p.ink}" stroke-width="1.5" opacity="${i<tier?1:0.3}"/>`).join('')
const leaf = p => `<g fill="none" stroke="${p.rim}" stroke-width="2.8" stroke-linecap="round"><path d="M61 157Q67 183 92 198M195 157Q189 183 164 198"/><path d="M65 170Q47 165 51 153Q66 155 65 170M74 185Q55 183 58 171Q73 171 74 185M191 170Q209 165 205 153Q190 155 191 170M182 185Q201 183 198 171Q183 171 182 185"/></g>`

export function merchantEmblem(o={},owned=true,fallbackSymbol='') {
  const tier=rank(o.tier),kind=o.category==='mlevel'?'certification':o.category==='trusted'?'trust':'honor'
  const rarity={common:1,rare:2,epic:3,legend:4}[o.rarity]||1
  const p={...(owned?PALETTES[kind==='honor'?rarity-1:kind==='trust'?3:tier-1]:OFF)}
  if(owned&&rgba(o.color))p.rim=o.color
  const prefix='me'+kind+tier+rarity+(owned?'on':'off')
  const defs=`<linearGradient id="${prefix}rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.light}"/><stop offset=".35" stop-color="${p.rim}"/><stop offset="1" stop-color="${p.ink}"/></linearGradient><linearGradient id="${prefix}face" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="${p.light}"/><stop offset=".45" stop-color="${p.face}"/><stop offset="1" stop-color="${p.face}"/></linearGradient>`
  let key=SYMBOLS[o.icon_key]?o.icon_key:kind==='certification'?'store':kind==='trust'?'shieldcheck':'star'
  // 相同的旧 trend 键用于订单和流水时，仍应有可辨认的业务图形。
  if(o.rule_type==='m_orders'&&key!=='crown')key='ticket'
  if(o.rule_type==='m_months'&&tier>=3)key='lantern'
  const markup=SYMBOLS[o.icon_key]?SYMBOLS[key]:(fallbackSymbol||SYMBOLS[key])
  const symbol=`<g transform="translate(78 61) scale(2.08)" fill="none" stroke="${p.ink}" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`
  let body=`<g data-merchant-emblem="${kind}" data-owned="${owned?'yes':'no'}">`
  if(kind==='certification') {
    // 圆拱认证牌；一至四级由材质与四点刻度共同区分，不依赖颜色。
    const shape='M128 22C152 22 170 35 181 47H199Q222 47 222 70V191Q222 210 203 210H53Q34 210 34 191V70Q34 47 57 47H75C86 35 104 22 128 22Z'
    body+=`<path d="${shape}" transform="translate(0 5)" fill="#665637" opacity=".09"/><path d="${shape}" fill="url(#${prefix}rim)"/><path d="${shape}" transform="translate(128 119) scale(.94) translate(-128 -119)" fill="url(#${prefix}face)"/><path d="M61 78V184H195V78" fill="none" stroke="${p.rim}" stroke-width="1.6" opacity=".55"/><path d="M96 48Q128 24 160 48" fill="none" stroke="${p.rim}" stroke-width="2"/>${symbol}${dots(tier,p)}<path d="M85 219L94 234H162L171 219" fill="${p.face}" stroke="${p.rim}" stroke-width="2"/>`
  } else if(kind==='honor') {
    body+=`<circle cx="128" cy="123" r="101" fill="#665637" opacity=".07"/><circle cx="128" cy="119" r="101" fill="url(#${prefix}rim)"/><circle cx="128" cy="119" r="96" fill="url(#${prefix}face)"/><circle cx="128" cy="119" r="86" fill="none" stroke="${p.rim}" stroke-width="1.5" opacity=".7"/>${leaf(p)}${symbol}${dots(tier,p)}<path d="M91 217L99 237L128 226L157 237L165 217" fill="${p.face}" stroke="${p.rim}" stroke-width="2.3"/>`
  } else {
    const shape='M128 22L219 55V119C219 173 179 212 128 237C77 212 37 173 37 119V55Z'
    body+=`<path d="${shape}" transform="translate(0 4)" fill="#344737" opacity=".1"/><path d="${shape}" fill="url(#${prefix}rim)"/><path d="${shape}" transform="translate(128 128) scale(.94) translate(-128 -128)" fill="${p.face}"/><path d="${shape}" transform="translate(128 128) scale(.84) translate(-128 -128)" fill="none" stroke="${p.rim}" stroke-width="1.5" opacity=".65"/>${symbol}<path d="M98 168H158" stroke="${p.rim}" stroke-width="1.5"/>${dots(tier,p)}`
  }
  return {defs,body:body+'</g>'}
}
