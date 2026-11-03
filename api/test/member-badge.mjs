// 会员等级 + 勋章图形：离线校验（不碰数据库）
//   一、等级配置：合法配置通过、各类错误配置被拒；代码默认值 = 参数中心默认值 = V40 迁移里的种子（三处同源）
//   二、勋章图形：5 类别 × 4 稀有度 × 已获得 / 未获得 都能生成合法 SVG；17 个图标都有；未获得与已获得不同；
//       系列阶数小圆点、主题色覆盖、未知图标回退都生效；输出里不含 NaN / undefined
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseLevels, levelFor, DEFAULT_LEVELS } from '../src/domain/member.mjs'
import { renderBadgeSvg, CATEGORIES, RARITIES, ICON_KEYS } from '../src/domain/badge-art.mjs'
import { DEFAULTS } from '../src/config.mjs'

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
t('5 类别 × 4 稀有度 × 获得/未获得 全部生成合法 SVG', () => {
  for (const cat of Object.keys(CATEGORIES)) for (const rarity of Object.keys(RARITIES)) for (const owned of [true, false]) {
    const svg = renderBadgeSvg({ icon_key: 'compass', rarity, category: cat, tier: 2, series: 's' }, owned)
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${cat}/${rarity}`)
    assert.ok(!/NaN|undefined|null/.test(svg), `${cat}/${rarity} 不应出现 NaN/undefined`)
    assert.equal((svg.match(/<(?!\/|\?)[a-zA-Z]/g) || []).length, (svg.match(/<\/[a-zA-Z]+>|\/>/g) || []).length, `${cat}/${rarity} 标签应成对`)
  }
})
t('17 个图标都能画，彼此不同；未知键回退为星形', () => {
  assert.equal(ICON_KEYS.length, 17)
  const set = new Set(ICON_KEYS.map((k) => renderBadgeSvg({ icon_key: k, rarity: 'rare', category: 'explore' })))
  assert.equal(set.size, 17)
  assert.equal(renderBadgeSvg({ icon_key: 'no-such', rarity: 'rare', category: 'explore' }), renderBadgeSvg({ icon_key: 'star', rarity: 'rare', category: 'explore' }))
})
t('未获得 ≠ 已获得；稀有度换配色；外形随类别变化', () => {
  const o = { icon_key: 'star', rarity: 'epic', category: 'journey' }
  assert.notEqual(renderBadgeSvg(o, true), renderBadgeSvg(o, false))
  assert.ok(!renderBadgeSvg(o, false).includes('#8b5fd0'), '未获得不应带稀有度色')
  assert.notEqual(renderBadgeSvg({ ...o, rarity: 'common' }), renderBadgeSvg(o))
  assert.equal(new Set(Object.keys(CATEGORIES).map((c) => renderBadgeSvg({ ...o, category: c }))).size, 5)
})
t('系列阶数画小圆点（有系列才画）；主题色覆盖点缀色；传说有光点', () => {
  const base = { icon_key: 'pin', rarity: 'rare', category: 'explore' }
  const dots = (svg) => (svg.match(/r="5.500"/g) || []).length
  assert.equal(dots(renderBadgeSvg({ ...base, series: '城市足迹', tier: 3 })), 3)
  assert.equal(dots(renderBadgeSvg({ ...base, tier: 3 })), 0, '没有系列名不画阶数')
  assert.ok(renderBadgeSvg({ ...base, color: '#ff00aa' }).includes('#ff00aa'))
  assert.ok(!renderBadgeSvg({ ...base, color: 'red' }).includes('red'), '非法颜色忽略')
  assert.ok((renderBadgeSvg({ ...base, rarity: 'legend' }).match(/<path d="M\d+ \d+ L/g) || []).length > (renderBadgeSvg(base).match(/<path d="M\d+ \d+ L/g) || []).length, '传说多出光点')
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
