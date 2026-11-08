// 会员等级 + 勋章图形：离线校验（不碰数据库）
//   一、等级配置：合法配置通过、各类错误配置被拒；代码默认值 = 参数中心默认值 = V40 迁移里的种子（三处同源）
//   二、勋章图形：5 类别 × 4 稀有度 × 已获得 / 未获得 都能生成合法 SVG；17 个图标都有；未获得与已获得不同；
//       系列阶数小圆点、主题色覆盖、未知图标回退都生效；输出里不含 NaN / undefined
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseLevels, levelFor, DEFAULT_LEVELS } from '../src/domain/member.mjs'
import { renderBadgeSvg, renderBeanSvg, serveBadgeArt, artOptions, CATEGORIES, CATEGORY_ORDER, RARITIES, ICON_KEYS } from '../src/domain/badge-art.mjs'
import { DEFAULTS } from '../src/config.mjs'
import * as ml from '../src/domain/merchant-level.mjs'
import { findBanned } from '../src/domain/wording.mjs'

let pass = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', String(e.message).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1 } }
const lv = (over = {}) => DEFAULT_LEVELS.map((l, i) => (i === 1 ? { ...l, ...over } : l))

console.log('== 会员等级配置 ==')
t('默认配置合法，按成长值定位等级', () => {
  const l = parseLevels(DEFAULT_LEVELS)
  assert.equal(l.length, 4)
  assert.deepEqual([0, 199999, 200000, 999999, 1000000, 3000000, 9e9].map((g) => levelFor(l, g)), [1, 1, 2, 2, 3, 4, 4])
})
t('代码默认值、参数中心默认值、V40 种子三处一致', () => {
  assert.deepEqual(parseLevels(DEFAULTS['member.levels']), parseLevels(DEFAULT_LEVELS))
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migration/V40__member_levels_badge_set.sql'), 'utf8')
  const m = /'(\[\{"lv":1[\s\S]*?\}\])'/.exec(sql)
  assert.ok(m, 'V40 里应有 member.levels 种子')
  assert.deepEqual(parseLevels(m[1]), parseLevels(DEFAULT_LEVELS))
})
t('错误配置被拒：数量 / 编号 / 门槛 / 加成 / 文案', () => {
  const bad = [
    [[DEFAULT_LEVELS[0]], '等级数量'],
    [DEFAULT_LEVELS.map((l, i) => (i === 2 ? { ...l, lv: 9 } : l)), '连续编号'],
    [lv({ min: 0 }), '必须高于'],
    [DEFAULT_LEVELS.map((l, i) => (i === 0 ? { ...l, min: 100 } : l)), 'Lv1 的成长值门槛必须是 0'],
    [lv({ rebateBonusBp: 999 }), '返豆加成'],
    [lv({ rebateBonusBp: 1.5 }), '返豆加成'],
    [lv({ name: '' }), '等级名'],
    [lv({ name: '这个名字实在是太长了吧' }), '等级名'],
    [lv({ perks: ['链上权益'] }), '禁用词'],
    [lv({ perks: ['a', 'b', 'c', 'd', 'e', 'f'] }), '最多 5 条'],
  ]
  for (const [cfg, key] of bad) assert.throws(() => parseLevels(cfg), (e) => e.message.includes(key), '应拒绝：' + key)
  assert.throws(() => parseLevels('{不是json'), /JSON/)
})

console.log('\n== 勋章图形 ==')
t('9 类别 × 4 稀有度 × 获得/未获得 全部生成合法 SVG', () => {
  for (const cat of Object.keys(CATEGORIES)) for (const rarity of Object.keys(RARITIES)) for (const owned of [true, false]) {
    const svg = renderBadgeSvg({ icon_key: 'compass', rarity, category: cat, tier: 2, series: 's' }, owned)
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${cat}/${rarity}`)
    assert.ok(!/NaN|undefined|null/.test(svg.replace(/href="data:image\/png;base64,[^"]*"/g,'')), `${cat}/${rarity} 不应出现 NaN/undefined`)
    assert.equal((svg.match(/<(?!\/|\?)[a-zA-Z]/g) || []).length, (svg.match(/<\/[a-zA-Z]+>|\/>/g) || []).length, `${cat}/${rarity} 标签应成对`)
  }
})
t('全部图标都能画，彼此不同；未知键回退为星形', () => {
  assert.equal(ICON_KEYS.length, 30)
  const set = new Set(ICON_KEYS.map((k) => renderBadgeSvg({ icon_key: k, rarity: 'rare', category: 'explore' })))
  assert.equal(set.size, 30)
  assert.equal(renderBadgeSvg({ icon_key: 'no-such', rarity: 'rare', category: 'explore' }), renderBadgeSvg({ icon_key: 'star', rarity: 'rare', category: 'explore' }))
})
t('未获得 ≠ 已获得；稀有度换配色；外形随类别变化', () => {
  const o = { icon_key: 'star', rarity: 'epic', category: 'journey' }
  assert.notEqual(renderBadgeSvg(o, true), renderBadgeSvg(o, false))
  assert.ok(!renderBadgeSvg(o, false).includes('#8f5bd6'), '未获得不应带稀有度色')
  assert.notEqual(renderBadgeSvg({ ...o, rarity: 'common' }), renderBadgeSvg(o))
  assert.equal(new Set(Object.keys(CATEGORIES).map((c) => renderBadgeSvg({ ...o, category: c }))).size, Object.keys(CATEGORIES).length, '每个类别有自己的造型')
})
t('系列阶数画小圆点（有系列才画）；主题色覆盖点缀色；传说有光点', () => {
  const base = { icon_key: 'pin', rarity: 'rare', category: 'explore' }
  const dots = (svg) => (svg.match(/r="5.5"/g) || []).length // 含稀有宝石 1 颗，所以比较差值
  assert.equal(dots(renderBadgeSvg({ ...base, series: '城市足迹', tier: 3 })) - dots(renderBadgeSvg(base)), 3)
  assert.equal(dots(renderBadgeSvg({ ...base, tier: 3 })), dots(renderBadgeSvg(base)), '没有系列名不画阶数')
  assert.ok(renderBadgeSvg({ ...base, color: '#ff00aa' }).includes('#ff00aa'))
  assert.ok(!renderBadgeSvg({ ...base, color: 'red' }).includes('red'), '非法颜色忽略')
  assert.ok((renderBadgeSvg({ ...base, rarity: 'legend' }).match(/<path d="M\d+ \d+ L/g) || []).length > (renderBadgeSvg(base).match(/<path d="M\d+ \d+ L/g) || []).length, '传说多出光点')
})

console.log('\n== PNG 输出 ==')
await (async () => {
  const png = await serveBadgeArt('/badge-art/preview.png', new URLSearchParams('category=city&icon_key=bridge&rarity=rare'))
  const big = await serveBadgeArt('/badge-art/level/3.png', new URLSearchParams('size=512'))
  const off = await serveBadgeArt('/badge-art/bean.png', new URLSearchParams())
  const isPng = (b) => Buffer.isBuffer(b) && b.subarray(1, 4).toString() === 'PNG'
  const medalPng=[]
  for(let tier=1;tier<=5;tier++)for(const state of ['on','off'])medalPng.push(await serveBadgeArt('/badge-art/mlevel/'+tier+'.png',new URLSearchParams({state,size:'64'})))
  t('五款同系列图形均可生成64px已获得与未获得PNG',()=>{for(const b of medalPng)if(Buffer.isBuffer(b)){assert.ok(isPng(b));assert.equal(b.readUInt32BE(16),64)}else assert.ok(b.startsWith('<svg'))})
  if(Buffer.isBuffer(png)){
    const {Resvg}=await import('@resvg/resvg-js'),pairs=[]
    for(const category of ['mlevel','mhonor','trusted','country']){
      const query=new URLSearchParams({category,tier:'2',icon_key:'shieldcheck',country_code:'CN',audience:'merchant'})
      const svg=await serveBadgeArt('/badge-art/preview.svg',query)
      pairs.push([await serveBadgeArt('/badge-art/preview.png',query),new Resvg(svg,{fitTo:{mode:'width',value:256}}).render().asPng()])
    }
    t('PNG关闭系统字体扫描后，认证/荣誉/可信/国家字形与原渲染逐字节相同',()=>{for(const [actual,reference] of pairs)assert.deepEqual(actual,reference)})
  }
  t('同一路径把 .svg 换成 .png 得到 PNG（没装 resvg 时回退为 SVG 字符串）；size 生效；不存在的返回空', () => {
    if (typeof png === 'string') { assert.ok(png.startsWith('<svg') && big.startsWith('<svg') && off.startsWith('<svg'), '回退为 SVG'); return }
    assert.ok(isPng(png) && isPng(big) && isPng(off))
    assert.equal(big.readUInt32BE(16), 512, '宽度 512'); assert.equal(png.readUInt32BE(16), 256, '默认宽度 256')
  })
})()
console.log('\n== 商户等级与商户徽章 ==')
t('商户等级默认配置合法；代码默认 = 参数中心默认 = V42 种子', () => {
  const d = ml.parseLevels(ml.DEFAULT_LEVELS)
  assert.deepEqual(ml.parseLevels(DEFAULTS['merchant.levels']), d)
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migration/V42__merchant_levels_badges.sql'), 'utf8')
  const m = /'(\[\{"lv":1[\s\S]*?\}\])'/.exec(sql); assert.ok(m, 'V42 应有 merchant.levels 种子'); assert.deepEqual(ml.parseLevels(m[1]), d)
})
t('商户等级评定：四项全部达标才升级；评分要有足够评价数；退款率超限不升级；表现下滑会降级', () => {
  const L = ml.parseLevels(ml.DEFAULT_LEVELS), base = { orders: 60, reviews: 20, rating10: 48, refundPct: 3 }
  assert.equal(ml.levelFor(L, base), 3, '60 单 / 20 评 / 4.8 / 3% → Lv3')
  assert.equal(ml.levelFor(L, { ...base, reviews: 14 }), 2, '评价数不够 Lv3 的 15 条')
  assert.equal(ml.levelFor(L, { ...base, refundPct: 8 }), 2, '退款率 8% 超过 Lv3 的 6%')
  assert.equal(ml.levelFor(L, { ...base, rating10: 44 }), 1, '评分 4.4 低于 Lv2 的 4.5')
  assert.equal(ml.levelFor(L, { ...base, orders: 9 }), 1, '订单不足 10')
  assert.equal(ml.levelFor(L, { orders: 300, reviews: 80, rating10: 49, refundPct: 1 }), 4)
  assert.equal(ml.levelFor(L, { orders: 0, reviews: 0, rating10: 0, refundPct: 0 }), 1)
})
t('商户等级配置错误被拒：数量 / 编号 / 评分无评价数 / 门槛倒挂 / 无区分 / 文案禁用词', () => {
  const D = ml.DEFAULT_LEVELS, mk = (i, o) => D.map((l, k) => (k === i ? { ...l, ...o } : l))
  const bad = [[[D[0]], '等级数量'], [mk(1, { lv: 7 }), '连续编号'], [mk(1, { minRating: 45, minReviews: 0 }), '评价数门槛'], [mk(2, { minOrders: 1 }), '不能比'], [mk(1, { name: '' }), '等级名'],
    [mk(1, { minOrders: 0, minReviews: 0, minRating: 0, maxRefundPct: 100 }), '没有区分度'], [mk(1, { perks: ['链上权益'] }), '禁用词'], [mk(0, { minOrders: 5 }), 'Lv1 不设门槛'], [mk(1, { minRating: 51 }), '评分门槛'], [mk(1, { maxRefundPct: 120 }), '退款率']]
  for (const [cfg, key] of bad) assert.throws(() => ml.parseLevels(cfg), (e) => e.message.includes(key), '应拒绝：' + key)
})
t('商户认证图形按等级变化、经营荣誉随稀有度换色、未获得灰阶；与游客徽章造型不同', () => {
  const lv = [1, 2, 3, 4].map((n) => renderBadgeSvg({ category: 'mlevel', tier: n })); assert.equal(new Set(lv).size, 4)
  const h = ['common', 'rare', 'epic', 'legend'].map((r) => renderBadgeSvg({ category: 'mhonor', icon_key: 'trend', rarity: r })); assert.equal(new Set(h).size, 4)
  assert.notEqual(renderBadgeSvg({ category: 'mlevel', tier: 2 }), renderBadgeSvg({ category: 'mlevel', tier: 2 }, false))
  assert.notEqual(renderBadgeSvg({ category: 'mlevel', tier: 2 }), renderBadgeSvg({ category: 'level', tier: 2 }))
  assert.notEqual(renderBadgeSvg({ category: 'mhonor', icon_key: 'star', rarity: 'rare' }), renderBadgeSvg({ category: 'creator', icon_key: 'star', rarity: 'rare' }))
  assert.equal(renderBadgeSvg({ category: 'mlevel', tier: 1 }), renderBadgeSvg({ category: 'mlevel', tier: 1, icon_key: 'nope' }), '认证奖牌不回退为店铺')
})
t('五款同系列图形配色可预览；现有四档无写实图或房屋主图',()=>{
  const materials=['bronze','silver','gold','diamond','blackgold']
  for(const [i,metal] of materials.entries()){
    const svg=renderBadgeSvg({category:'mlevel',tier:i+1})
    assert.ok(svg.includes('data-merchant-emblem="certification"'))
    assert.ok(!svg.includes('<image'))
    assert.ok(!renderBadgeSvg({category:'mlevel',tier:1,metal}).includes('<image'))
  }
  assert.equal(ml.DEFAULT_LEVELS.length,4,'设计图稿不应虚增经营等级')
})

console.log('\n== 分种类设计 ==')
t('商户可信图按规则受众选择；游客可信图保留原形象；灰阶不带自定义主题色', () => {
  const merchant=artOptions({id:80,icon_key:'seal',rule_type:'m_sealed',profile:{category:'trusted',tier:1}})
  const tourist=artOptions({id:46,icon_key:'seal',rule_type:'sealed_count',profile:{category:'trusted',tier:1}})
  assert.equal(merchant.audience,'merchant');assert.equal(tourist.audience,'tourist')
  assert.ok(renderBadgeSvg(merchant).includes('data-merchant-emblem="trust"'))
  assert.ok(!renderBadgeSvg(tourist).includes('data-merchant-emblem'))
  assert.ok(!renderBadgeSvg({...merchant,color:'#fe12ab'},false).includes('#fe12ab'))
  for(const tier of [-1,NaN,1.5,99])assert.ok(!/undefined|NaN/.test(renderBadgeSvg({...merchant,tier})))
})
t('分类与顺序：9 类，勋章墙顺序固定，小程序用语里没有链相关词，后台叫「链上勋章」', () => {
  assert.equal(CATEGORY_ORDER.length, 9); assert.deepEqual([...CATEGORY_ORDER, 'mlevel', 'mhonor'].sort(), Object.keys(CATEGORIES).sort(), '游客 9 类 + 商户 2 类')
  assert.equal(CATEGORIES.trusted.label, '可信勋章'); assert.equal(CATEGORIES.trusted.adminLabel, '链上勋章')
  for (const c of Object.values(CATEGORIES)) assert.equal(findBanned(c.label), null, c.label + ' 含禁用词')
})
t('会员等级：1~4 级材质不同、指定图标优先、未指定时按等级取默认图标、旧「成长」类等同会员等级', () => {
  const lv = [1, 2, 3, 4].map((n) => renderBadgeSvg({ category: 'level', tier: n }))
  assert.equal(new Set(lv).size, 4)
  assert.notEqual(renderBadgeSvg({ category: 'level', tier: 1 }), renderBadgeSvg({ category: 'level', tier: 1, icon_key: 'crown' }), '指定图标优先')
  assert.equal(renderBadgeSvg({ category: 'growth', tier: 2 }), renderBadgeSvg({ category: 'level', tier: 2 }))
})
t('国家印章的国家代码用矢量字形画（不依赖字体）：不同代码不同图，大小写等价，非法代码显示 XX；城市是朱红印章，未获得灰阶', () => {
  const c = (code) => renderBadgeSvg({ category: 'country', country_code: code, icon_key: 'plane' })
  assert.ok(!c('JP').includes('<text'), '不用 SVG 文字')
  assert.notEqual(c('JP'), c('TH')); assert.equal(c('jp'), c('JP')); assert.equal(c('日本'), c('XX')); assert.equal(c('x'), c('XX'))
  assert.ok(renderBadgeSvg({ category: 'city', icon_key: 'bridge', rarity: 'rare' }).includes('#b42a19'), '朱红')
  assert.ok(!renderBadgeSvg({ category: 'city', icon_key: 'bridge' }, false).includes('#b42a19'))
})
t('链上勋章：每枚的指纹条不同；已获得带封存印记，未获得不带', () => {
  const o = { category: 'trusted', icon_key: 'seal', rarity: 'rare' }
  const a = renderBadgeSvg({ ...o, seed: 'b1' }), b = renderBadgeSvg({ ...o, seed: 'b2' })
  assert.notEqual(a, b, '指纹条由勋章标识派生')
  assert.ok(renderBadgeSvg({ ...o, seed: 'b1' }, false).split('<circle').length < a.split('<circle').length, '未获得少一个封存印记')
})
t('旅豆币图合法；V41 城市国家种子 = 参数默认', () => {
  const svg = renderBeanSvg(); assert.ok(svg.startsWith('<svg') && !/NaN|undefined/.test(svg))
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migration/V41__badge_kinds_city_country_trusted.sql'), 'utf8')
  const m = /\('city\.country', '(\{[^']+\})'/.exec(sql); assert.ok(m, 'V41 应有 city.country 种子')
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(DEFAULTS['city.country']))
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
