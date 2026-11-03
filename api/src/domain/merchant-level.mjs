// 商户经营等级：新晋商户 → 优选商户 → 金牌商户 → 品质标杆。
// 等级按「经营表现」评定，不是按流水堆：累计完成订单、游客评价数与评分、退款率，四项全部达标才到该等级；
// 表现下滑会降级（徽章一经获得不收回）。等级名、门槛、权益说明都在参数中心 merchant.levels。
// 权益只是运营侧说明（由运营落实），不和结算比例 / 佣金挂钩——涉及资金的事这里不动。
import { q, one } from '../db.mjs'
import { cfg } from '../config.mjs'
import { findBanned } from './wording.mjs'

export const DEFAULT_LEVELS = [
  { lv: 1, name: '新晋商户', minOrders: 0, minReviews: 0, minRating: 0, maxRefundPct: 100, perks: ['接入平台订单与核销', '参与平台常规活动'] },
  { lv: 2, name: '优选商户', minOrders: 10, minReviews: 3, minRating: 45, maxRefundPct: 10, perks: ['平台活动优先报名', '运营定期经营复盘'] },
  { lv: 3, name: '金牌商户', minOrders: 50, minReviews: 15, minRating: 47, maxRefundPct: 6, perks: ['平台推荐位优先考虑', '专属运营对接人'] },
  { lv: 4, name: '品质标杆', minOrders: 200, minReviews: 50, minRating: 48, maxRefundPct: 4, perks: ['年度标杆商户评选资格', '新业务与新线路优先试点'] },
]

/** 校验并规范化等级配置；不合法抛 Error（message 直接给后台看） */
export function parseLevels(raw) {
  let arr
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw new Error('等级配置不是合法的 JSON') }
  if (!Array.isArray(arr) || arr.length < 2 || arr.length > 6) throw new Error('等级数量需在 2~6 之间')
  const out = arr.map((l, i) => {
    const lv = Number(l.lv), no = Number(l.minOrders), nr = Number(l.minReviews), rt = Number(l.minRating), rf = Number(l.maxRefundPct)
    if (lv !== i + 1) throw new Error(`第 ${i + 1} 项的 lv 必须是 ${i + 1}（从 1 开始连续编号）`)
    const name = String(l.name || '').trim()
    if (!name || name.length > 8) throw new Error(`Lv${lv} 等级名需 1~8 个字`)
    if (!Number.isSafeInteger(no) || no < 0) throw new Error(`Lv${lv} 累计完成订单门槛需为非负整数`)
    if (!Number.isSafeInteger(nr) || nr < 0) throw new Error(`Lv${lv} 评价数门槛需为非负整数`)
    if (!Number.isInteger(rt) || rt < 0 || rt > 50) throw new Error(`Lv${lv} 评分门槛需为 0~50 的整数（45 = 4.5 分）`)
    if (!Number.isInteger(rf) || rf < 0 || rf > 100) throw new Error(`Lv${lv} 退款率上限需为 0~100 的整数（百分比）`)
    if (rt > 0 && nr === 0) throw new Error(`Lv${lv} 设了评分门槛就要同时设评价数门槛，否则一条好评就能达标`)
    const perks = Array.isArray(l.perks) ? l.perks.map((p) => String(p).trim()).filter(Boolean) : []
    if (perks.length > 5 || perks.some((p) => p.length > 24)) throw new Error(`Lv${lv} 权益说明最多 5 条、每条不超过 24 字`)
    const bad = findBanned([name, ...perks])
    if (bad) throw new Error(`Lv${lv} 文案含小程序审核禁用词「${bad}」，请换成合规用语`)
    return { lv, name, minOrders: no, minReviews: nr, minRating: rt, maxRefundPct: rf, perks }
  })
  if (out[0].minOrders !== 0 || out[0].minReviews !== 0 || out[0].minRating !== 0) throw new Error('Lv1 不设门槛（订单 / 评价 / 评分都填 0）')
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i]
    if (b.minOrders < a.minOrders || b.minReviews < a.minReviews || b.minRating < a.minRating || b.maxRefundPct > a.maxRefundPct)
      throw new Error(`Lv${b.lv} 的门槛不能比 Lv${a.lv} 更低（订单 / 评价 / 评分只增不减，退款率上限只降不增）`)
    if (b.minOrders === a.minOrders && b.minReviews === a.minReviews && b.minRating === a.minRating && b.maxRefundPct === a.maxRefundPct)
      throw new Error(`Lv${b.lv} 与 Lv${a.lv} 门槛完全相同，没有区分度`)
  }
  return out
}

export async function levels() {
  try { return parseLevels(await cfg('merchant.levels')) } catch { return DEFAULT_LEVELS } // 配置被改坏时兜底，不影响订单与展示
}

const PAID = '(20,30,40,50)', VALID = '(20,30,40,50,70)'

/** 商户经营指标（评分 / 退款率口径与后台「商户全景」一致：评分按本店商品的已发布评价，退款率 = 退款单 ÷ 有效单） */
export async function metrics(mid) {
  const o = await one(`SELECT COALESCE(SUM(status = 50), 0) done, COUNT(*) valid, COALESCE(SUM(status = 70), 0) refunded,
      COALESCE(SUM(CASE WHEN status IN ${PAID} THEN amount_pay END), 0) gmv FROM orders WHERE merchant_id = ? AND status IN ${VALID}`, [mid])
  const r = await one('SELECT COUNT(*) n, AVG(r.rating) avg FROM review r JOIN tour_product p ON p.id = r.product_id WHERE p.merchant_id = ? AND r.status = 1', [mid])
  const v = await one('SELECT COUNT(*) n FROM verification_log WHERE merchant_id = ? AND result = 1', [mid])
  const m = await one('SELECT COALESCE(approved_at, created_at) since FROM merchant WHERE id = ?', [mid])
  const s = await one(`SELECT COUNT(DISTINCT o.id) n FROM orders o JOIN attest_event e ON e.biz_type = 'order' AND e.biz_ref = o.order_no
    WHERE o.merchant_id = ? AND o.status = 50 AND e.status >= 1`, [mid])
  const months = m && m.since ? Math.max(0, Math.floor((Date.now() - new Date(m.since).getTime()) / (30 * 86400000))) : 0
  const valid = Number(o.valid)
  return {
    orders: Number(o.done), gmv: Number(o.gmv), reviews: Number(r.n), rating10: r.avg == null ? 0 : Math.round(Number(r.avg) * 10),
    refundPct: valid ? Math.round(Number(o.refunded) / valid * 1000) / 10 : 0, verifies: Number(v.n), months, sealed: Number(s.n),
  }
}

/** 某等级的各项达标情况 */
export function criteriaOf(l, m) {
  const c = [
    { key: 'orders', label: '累计完成订单', cur: m.orders, need: l.minOrders, ok: m.orders >= l.minOrders, unit: '单' },
    { key: 'reviews', label: '游客评价数', cur: m.reviews, need: l.minReviews, ok: m.reviews >= l.minReviews, unit: '条' },
  ]
  if (l.minRating > 0) c.push({ key: 'rating', label: '游客评分', cur: m.rating10 / 10, need: l.minRating / 10, ok: m.reviews >= l.minReviews && m.rating10 >= l.minRating, unit: '分' })
  if (l.maxRefundPct < 100) c.push({ key: 'refund', label: '退款率（不高于）', cur: m.refundPct, need: l.maxRefundPct, ok: m.refundPct <= l.maxRefundPct, unit: '%', reverse: true })
  return c.filter((x) => x.need > 0 || x.reverse)
}
export const meets = (l, m) => criteriaOf(l, m).every((c) => c.ok)
export const levelFor = (lvs, m) => lvs.reduce((best, l) => (meets(l, m) ? l.lv : best), 1)

const pub = (l) => ({ lv: l.lv, name: l.name, perks: l.perks, need: { orders: l.minOrders, reviews: l.minReviews, rating: l.minRating / 10, refundPct: l.maxRefundPct } })

/** 重新评定并落库；返回 {from,to,m} */
export async function refresh(mid) {
  const lvs = await levels(), m = await metrics(mid)
  const cur = await one('SELECT level FROM merchant WHERE id = ?', [mid])
  if (!cur) return null
  const to = levelFor(lvs, m), from = Number(cur.level || 1)
  if (to !== from) await q('UPDATE merchant SET level = ?, level_at = NOW(3) WHERE id = ?', [to, mid])
  return { from, to, m }
}
export async function refreshSafe(mid) { try { return await refresh(mid) } catch (e) { console.error('[merchant-level]', mid, e.message); return null } }

/** 当前等级 + 距下一级的逐项差距 + 全部等级（B 端「经营等级」页、后台商户全景共用） */
export async function progress(mid) {
  const r = await refresh(mid), lvs = await levels()
  if (!r) return null
  const cur = lvs.find((l) => l.lv === r.to) || lvs[0], next = lvs.find((l) => l.lv === cur.lv + 1) || null
  const crit = next ? criteriaOf(next, r.m) : []
  const done = crit.filter((c) => c.ok).length
  return {
    ...pub(cur), metrics: r.m, upgraded: r.to > r.from,
    next: next ? { lv: next.lv, name: next.name, criteria: crit, pct: crit.length ? Math.floor(done / crit.length * 100) : 100 } : null,
    levels: lvs.map(pub),
  }
}

/** 等级配置生效后重评所有商户 */
export async function resyncAll() {
  let n = 0
  for (const m of await q('SELECT id FROM merchant')) { const r = await refresh(m.id); if (r && r.to !== r.from) n++ }
  return n
}

const RARITY_RANK = { legend: 4, epic: 3, rare: 2, common: 1 }
/**
 * 游客可见的商户荣誉（白名单）：只有等级号 / 等级名 / 最多 3 枚徽章（名称、稀有度）。
 * 不含订单量、流水、评价数、退款率等经营数据，也不含权益说明（那是运营侧的）。徽章按稀有度从高到低挑，等级认证类（mlevel）不重复展示。
 */
export async function publicHonor(mid) {
  const m = await one('SELECT level FROM merchant WHERE id = ?', [mid])
  if (!m) return null
  const lvs = await levels(), cur = lvs.find((l) => l.lv === Number(m.level)) || lvs[0]
  const rows = await q(`SELECT b.id, b.name, b.profile FROM merchant_badge mb JOIN badge b ON b.id = mb.badge_id WHERE mb.merchant_id = ? ORDER BY mb.granted_at DESC`, [mid])
  const badges = rows.map((b) => { const pf = (typeof b.profile === 'string' ? JSON.parse(b.profile || '{}') : b.profile) || {}; return { id: Number(b.id), name: b.name, rarity: pf.rarity || 'common', category: pf.category } })
    .filter((b) => b.category !== 'mlevel').sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0)).slice(0, 3)
  return { lv: cur.lv, name: cur.name, badges: badges.map(({ id, name, rarity }) => ({ id, name, rarity })) }
}
/** 列表页用的小标签：只有 Lv2 及以上才显示「优选商户」等，新晋商户不挂标签（不是负面标签，只是没必要占位） */
export async function listTagFor(level) {
  const lv = Number(level) || 1
  if (lv < 2) return null
  const cur = (await levels()).find((l) => l.lv === lv)
  return cur ? { lv: cur.lv, name: cur.name } : null
}
