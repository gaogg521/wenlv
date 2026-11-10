// 商品促销折扣域（D01）：规则校验 + 作用域判定 + 单价计算（早鸟/折扣叠加开关）。
// 折扣是商品促销降价（按真实原价×付款比例），自由豆是官方补贴券，两者分开配置与记录。
// 金额一律整数分；折数界面按"折"填写（1–10，最多两位小数），内部存付款比例 bp（8折=8000bp）。
import { q, one, BizError } from '../db.mjs'
import { bookingNow, validDeadline } from './booking-window.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import { findBanned } from './wording.mjs'

/** 早鸟单价（纯函数）：出发前 early_days 天（含）之前报名享 early_price。
 *  A-07 取较低兜底（早鸟价被改高于现价时游客不多付）；A-34 按业务时区切日。
 *  order.priceForSession 委托至此，保证折扣叠加与展示同源。 */
export function earlyInfo(s, today = bizDay()) {
  const days = Math.floor((new Date(String(s.depart_date).slice(0, 10) + 'T00:00:00') - new Date(String(today) + 'T00:00:00')) / 86400000)
  const original = Number(s.price_adult)
  const eligible = s.early_price != null && s.early_days != null && days >= Number(s.early_days)
  const earlyUnit = eligible ? Math.min(Number(s.early_price), original) : null
  return { days, originalFen: original, eligible, earlyUnitFen: earlyUnit }
}

/** 作用域判定（纯函数）：products/cities/channels/dates 空数组=全部适用；
 *  rule 为 promo_discount 行（JSON 列 mysql2 已解析为数组）。 */
export function scopeMatch(rule, ctx) {
  const list = k => ((Array.isArray(rule[k]) ? rule[k] : JSON.parse(rule[k] || '[]') || []).map(v => String(v)))
  const p = list('products'), c = list('cities'), ch = list('channels'), d = list('dates')
  if (p.length && !p.map(Number).includes(Number(ctx.product_id))) return false
  if (c.length && !c.includes(String(ctx.city_code))) return false
  if (ch.length && !ch.includes(String(ctx.channel))) return false
  if (d.length && !d.includes(String(ctx.depart_date).slice(0, 10))) return false
  return true
}

/** 单价计算（纯函数，D01 契约 §首版计算与叠加契约）：
 *  - 折扣候选价 = 真实团期原价 × 付款比例，单位价四舍五入到分再乘数量（place 里乘 qty）。
 *  - 默认不叠加：取有效早鸟价与原价折扣价中较低者；价格相同优先早鸟。
 *  - 开启叠加：先取生效早鸟单价再乘折扣，未命中早鸟则以真实原价计算。
 *  同一主商品最多一条折扣规则（pickRule 择优），不做多条折扣相乘。 */
export function unitPrice(s, rule, today = bizDay()) {
  const e = earlyInfo(s, today)
  const original = e.originalFen
  const base = { originalFen: original, earlyEligible: e.eligible, earlyUnitFen: e.earlyUnitFen, daysToDepart: e.days, stack: false }
  if (!rule) {
    const unit = e.earlyUnitFen ?? original
    return { ...base, type: e.eligible ? 'early' : 'original', unitFen: unit, rule: null }
  }
  const bp = Number(rule.discount_bp)
  const ruleInfo = { id: Number(rule.id), version: Number(rule.version), name: rule.name, discountBp: bp, stack: Number(rule.stack_early) === 1, zhe: bp / 1000 }
  if (!ruleInfo.stack) {
    const discountUnit = Math.round(original * bp / 10000)
    if (e.eligible && e.earlyUnitFen <= discountUnit) {
      return { ...base, type: 'early', unitFen: e.earlyUnitFen, rule: ruleInfo } // 价格相同优先保留既有早鸟规则
    }
    return { ...base, type: 'discount', unitFen: discountUnit, rule: ruleInfo }
  }
  const src = e.eligible ? e.earlyUnitFen : original
  const unit = Math.round(src * bp / 10000)
  return { ...base, stack: true, type: e.eligible ? 'early_discount' : 'discount', unitFen: unit, rule: ruleInfo }
}

/** 生效中规则（status=1 且时间窗内；时间比较用业务时区 now） */
export async function activeRules(now = bookingNow(), c = { q }) {
  const rows = await c.q('SELECT * FROM promo_discount WHERE status = 1 AND from_time <= ? AND to_time > ? ORDER BY id DESC', [now, now])
  return rows
}

/** 内部：在给定规则集中择优（对游客最低单价，不做折扣相乘；并列取最新规则） */
function matchBest(s, ctx, rules, today) {
  let best = null
  for (const r of rules) {
    if (!scopeMatch(r, ctx)) continue
    const p = unitPrice(s, r, today)
    if (!best || p.unitFen < best.price.unitFen || (p.unitFen === best.price.unitFen && Number(r.id) > Number(best.rule.id))) best = { rule: r, price: p }
  }
  return best
}

/** 择优：多条命中取对游客最低单价（不做折扣相乘），并列取最新规则；无命中返回 null */
export async function pickRule(ctx, now = bookingNow(), c = { q }) {
  return matchBest(ctx.session, ctx, await activeRules(now, c), String(now).slice(0, 10))
}

/** 完整试算入口：团期 + 产品上下文 → 有效单价（早鸟/折扣/叠加）。place 与 quote 共用，杜绝直链接口绕过规则。 */
export async function priceSession(s, ctx, now = bookingNow(), c = { q }) {
  const hit = await pickRule({ ...ctx, session: s }, now, c)
  return unitPrice(s, hit?.rule || null, String(now).slice(0, 10))
}

/** 批量注价：一次取生效规则，为每个团期算有效单价（游客详情/列表/推广工作台共用，避免逐单查询）。
 *  返回与 sessions 等长的数组：{ price, rule }（rule 为命中的 promo_discount 行或 null）。 */
export async function annotateSessions(sessions, ctxBase, now = bookingNow(), c = { q }) {
  const rules = await activeRules(now, c)
  const today = String(now).slice(0, 10)
  return sessions.map(s => matchBest(s, { ...ctxBase, depart_date: s.depart_date }, rules, today) || { rule: null, price: null })
}

/** 后台规则录入校验：折数按"折"填写（>0 且 <=10，最多两位小数）→ 存付款比例 bp */
export function ruleInput(b) {
  const name = String(b.name || '').trim()
  if (!name || name.length > 80) throw new BizError(1001, '活动名称无效')
  if (findBanned(name)) throw new BizError(1001, '活动名称含不适合小程序展示的用语，请调整')
  const zhe = Number(b.zhe)
  if (!Number.isFinite(zhe) || zhe <= 0 || zhe > 10) throw new BizError(1001, '折数必须大于0且不超过10，如填8表示按原价80%付款')
  const bp = Math.round(zhe * 1000)
  if (bp % 10 !== 0) throw new BizError(1001, '折数最多两位小数（如 8.5 折）')
  const from = String(b.from || '').replace('T', ' '), to = String(b.to || '').replace('T', ' ')
  if (!from || !to || !validDeadline(from) || !validDeadline(to) || to <= from) throw new BizError(1001, '生效/失效时间无效')
  const list = (v, max, test, msg) => {
    const a = (Array.isArray(v) ? v : String(v || '').split(/[,，\s]+/)).filter(x => x !== '').map(x => String(x).trim()).filter(Boolean)
    if (a.length > max || a.some(x => !test(x))) throw new BizError(1001, msg)
    return [...new Set(a)]
  }
  const products = list(b.products, 200, x => /^\d{1,12}$/.test(x), '适用产品ID无效')
  const cities = list(b.cities, 100, x => /^\d{6}$/.test(x), '城市代码无效')
  const channels = list(b.channels, 30, x => /^\w{1,24}$/.test(x), '渠道无效')
  const dates = list(b.dates, 365, x => validDeadline(x + ' 00:00:00'), '团期日期无效')
  const stackEarly = b.stackEarly === true || b.stackEarly === 1 || b.stackEarly === '1' ? 1 : 0
  return { name, discount_bp: bp, zhe, stack_early: stackEarly, from_time: from, to_time: to, products, cities, channels, dates }
}
