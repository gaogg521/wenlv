// 退改梯度：纯函数，无 IO。服务端扣费、退款试算接口、小程序预订须知三处同源。
//
// 配置 order.refund_policy（参数中心可调，双人复核）：{"d7":0.0,"d3":0.10,"d1":0.30}
//   dN = 距出发 ≥ N 天时收取的手续费比例（0~1）。按 N 从大到小取第一个满足的档位：
//     距出发 ≥7 天 → 0%；3~6 天 → 10%；1~2 天 → 30%；
//     不足最小档（如出发当天）→ 不支持自助退款，转客服。
//   需要"当天也可退、收 50%"时，配置 "d0":0.5 即可，无需改代码。
//
// 计算口径：
//   - 手续费只从现金实付（amount_pay）中扣，四舍五入到分；旅豆抵扣部分全额返还
//   - 距出发天数按业务时区（BIZ_TZ）的日历日计算，与团期 depart_date 同口径
import { BizError } from '../db.mjs'
import { bizDay } from '../infra/bizdate.mjs'

/** 解析并校验配置；非法档位直接报错，避免"配错了却按 0 手续费放行" */
export function parsePolicy(raw) {
  const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
  const tiers = []
  for (const [k, v] of Object.entries(obj)) {
    const m = /^d(\d{1,3})$/.exec(k)
    const rate = Number(v)
    if (!m || !Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(`退改梯度配置非法：${k}=${v}（键应为 d<天数>，值为 0~1）`)
    tiers.push({ days: Number(m[1]), rate })
  }
  if (!tiers.length) throw new Error('退改梯度配置为空')
  return tiers.sort((a, b) => b.days - a.days)
}

/** 两个 YYYY-MM-DD 之间的日历天数（to - from） */
export function daysBetween(from, to) {
  const d = (s) => Date.UTC(...String(s).slice(0, 10).split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))
  return Math.round((d(to) - d(from)) / 86400_000)
}

/**
 * 退款试算
 * @returns {allowed, daysToDepart, rate, feeFen, refundFen, tier, reason}
 */
export function quote({ policy, amountPayFen, departDate, today = bizDay() }) {
  const tiers = Array.isArray(policy) ? policy : parsePolicy(policy)
  const amt = Math.max(0, Math.round(Number(amountPayFen) || 0))
  const daysToDepart = daysBetween(today, departDate)
  const hit = tiers.find((t) => daysToDepart >= t.days)
  if (!hit) {
    const min = tiers[tiers.length - 1].days
    return { allowed: false, daysToDepart, rate: null, feeFen: null, refundFen: null, tier: null,
      reason: daysToDepart < 0 ? '团期已出发，不支持自助退款，请联系客服' : `距出发不足 ${min} 天，不支持自助退款，请联系客服` }
  }
  const feeFen = Math.round(amt * hit.rate)
  const refundFen = amt - feeFen
  if (refundFen <= 0 && amt > 0) {
    return { allowed: false, daysToDepart, rate: hit.rate, feeFen, refundFen: 0, tier: hit, reason: '当前档位手续费为 100%，不支持自助退款，请联系客服' }
  }
  return { allowed: true, daysToDepart, rate: hit.rate, feeFen, refundFen, tier: hit, reason: null }
}

/** 给游客看的档位说明：["出发前 7 天及以上：免手续费", ...] */
export function describe(policy) {
  const tiers = Array.isArray(policy) ? policy : parsePolicy(policy)
  const out = tiers.map((t, i) => {
    const upper = i > 0 ? tiers[i - 1].days - 1 : null
    const range = t.days === 0 && upper === 0 ? '出发当天'
      : upper == null ? `出发前 ${t.days} 天及以上`
      : upper === t.days ? `出发前 ${t.days} 天`
      : t.days === 0 ? `出发前 ${upper} 天内（含当天）` : `出发前 ${t.days}~${upper} 天`
    const fee = t.rate === 0 ? '免手续费，全额退款' : `收取实付金额 ${Math.round(t.rate * 1000) / 10}% 手续费`
    return `${range}：${fee}`
  })
  const min = tiers[tiers.length - 1].days
  if (min > 0) out.push(`出发前不足 ${min} 天：不支持自助退款，可联系客服`)
  return out
}

export const assertAllowed = (q) => { if (!q.allowed) throw new BizError(2002, q.reason) }
