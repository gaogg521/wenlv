// 会员等级体系：等级名 / 成长值门槛 / 返豆加成 / 权益说明 全部来自参数中心 member.levels，
// 小程序、后台、返豆计算、成长值任务都从这里取，不再各自写死一份。
// 成长值 = 累计完成订单实付（分）；门槛单位同为分。返豆加成单位 bp（万分比），叠加在基础返豆率之上。
import { q, one } from '../db.mjs'
import { cfg } from '../config.mjs'
import { findBanned } from './wording.mjs'

export const DEFAULT_LEVELS = [
  { lv: 1, name: '探索者', min: 0, rebateBonusBp: 0, perks: ['注册即享旅豆返豆', '参与剧本闯关与约稿任务'] },
  { lv: 2, name: '旅行家', min: 200000, rebateBonusBp: 30, perks: ['消费返豆额外加成', '解锁「旅行家」专属勋章'] },
  { lv: 3, name: '城市探索官', min: 1000000, rebateBonusBp: 60, perks: ['消费返豆更高加成', '优先参与新线路体验'] },
  { lv: 4, name: '环球探索家', min: 3000000, rebateBonusBp: 100, perks: ['消费返豆最高加成', '年度专属礼遇与新品首发'] },
]

/** 校验并规范化等级配置；不合法时抛 Error（message 直接给后台看） */
export function parseLevels(raw) {
  let arr
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw new Error('等级配置不是合法的 JSON') }
  if (!Array.isArray(arr) || arr.length < 2 || arr.length > 8) throw new Error('等级数量需在 2~8 之间')
  const out = arr.map((l, i) => {
    const lv = Number(l.lv), min = Number(l.min), bp = Number(l.rebateBonusBp ?? 0)
    if (lv !== i + 1) throw new Error(`第 ${i + 1} 项的 lv 必须是 ${i + 1}（从 1 开始连续编号）`)
    const name = String(l.name || '').trim()
    if (!name || name.length > 8) throw new Error(`Lv${lv} 等级名需 1~8 个字`)
    if (!Number.isSafeInteger(min) || min < 0) throw new Error(`Lv${lv} 成长值门槛需为非负整数（单位：分）`)
    if (!Number.isInteger(bp) || bp < 0 || bp > 300) throw new Error(`Lv${lv} 返豆加成需为 0~300 的整数（单位：bp，100bp = 1 个百分点）`)
    const perks = Array.isArray(l.perks) ? l.perks.map((p) => String(p).trim()).filter(Boolean) : []
    if (perks.length > 5 || perks.some((p) => p.length > 24)) throw new Error(`Lv${lv} 权益说明最多 5 条、每条不超过 24 字`)
    const bad = findBanned([name, ...perks])
    if (bad) throw new Error(`Lv${lv} 文案含小程序审核禁用词「${bad}」，请换成合规用语`)
    return { lv, name, min, rebateBonusBp: bp, perks }
  })
  if (out[0].min !== 0) throw new Error('Lv1 的成长值门槛必须是 0（注册即享）')
  for (let i = 1; i < out.length; i++) if (out[i].min <= out[i - 1].min) throw new Error(`Lv${out[i].lv} 的门槛必须高于 Lv${out[i - 1].lv}`)
  return out
}

export async function levels() {
  try { return parseLevels(await cfg('member.levels')) } catch { return DEFAULT_LEVELS } // 配置被改坏时兜底，不能让下单 / 完成订单跟着失败
}

export const levelFor = (lvs, growth) => lvs.filter((l) => Number(growth) >= l.min).length || 1

/** 返回给小程序的等级描述：不含内部字段，加成换成百分点文案 */
const pub = (l) => ({
  lv: l.lv, name: l.name, min: l.min, points: Math.floor(l.min / 100), bonusPct: l.rebateBonusBp / 100,
  perks: [...(l.rebateBonusBp > 0 ? [`消费返豆 +${l.rebateBonusBp / 100} 个百分点`] : []), ...l.perks],
})

/** 该用户当前等级带来的返豆加成（bp） */
export async function rebateBonusBp(userId) {
  const u = await one('SELECT member_level FROM user_account WHERE id = ?', [userId])
  if (!u) return 0
  const cur = (await levels()).find((l) => l.lv === Number(u.member_level))
  return cur ? cur.rebateBonusBp : 0
}

/** 当前等级 + 距下一级的进度 + 全部等级（小程序「我的 / 旅豆 / 数字身份」共用） */
export async function progress(userId) {
  const lvs = await levels()
  const u = await one('SELECT member_level, growth_value FROM user_account WHERE id = ?', [userId])
  const growth = Number(u?.growth_value || 0)
  const cur = lvs.find((l) => l.lv === Number(u?.member_level)) || lvs[0]
  const next = lvs.find((l) => l.lv === cur.lv + 1) || null
  const pct = next ? Math.max(0, Math.min(100, Math.floor((growth - cur.min) / (next.min - cur.min) * 100))) : 100
  return {
    ...pub(cur), growth, points: Math.floor(growth / 100), pct,
    next: next ? { lv: next.lv, name: next.name, min: next.min, gap: Math.max(0, next.min - growth), gapPoints: Math.ceil(Math.max(0, next.min - growth) / 100) } : null,
    levels: lvs.map(pub),
  }
}

/** 订单完成等成长事件：加成长值、重算等级、写成长日志。返回 {from,to,up,growth} */
export async function addGrowth(userId, delta, bizRef, bizType = 1) {
  const lvs = await levels()
  await q('UPDATE user_account SET growth_value = growth_value + ? WHERE id = ?', [delta, userId])
  const u = await one('SELECT member_level, growth_value FROM user_account WHERE id = ?', [userId])
  const from = Number(u.member_level), growth = Number(u.growth_value), to = levelFor(lvs, growth)
  if (to !== from) await q('UPDATE user_account SET member_level = ? WHERE id = ?', [to, userId])
  await q('INSERT INTO user_growth_log (user_id, delta, biz_type, biz_ref, after_val) VALUES (?,?,?,?,?)', [userId, delta, bizType, bizRef, growth])
  return { from, to, up: to > from, growth }
}

/** 等级配置改动生效后，按新门槛重算所有用户等级（只改 member_level，不动成长值） */
export async function resyncAll() {
  const lvs = await levels()
  let n = 0
  for (const u of await q('SELECT id, member_level, growth_value FROM user_account')) {
    const to = levelFor(lvs, Number(u.growth_value))
    if (to !== Number(u.member_level)) { await q('UPDATE user_account SET member_level = ? WHERE id = ?', [to, u.id]); n++ }
  }
  return n
}
