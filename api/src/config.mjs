// 参数中心：rule_config 表加载 + 内存缓存（改参接口触发刷新）；缺省值兜底 = V2 种子
import { q } from './db.mjs'

export const DEFAULTS = {
  'bean.order_rate': '0.10', 'bean.deduct_max_pct': '0.10', 'bean.expire_months': '12',
  'bean.value_anchor': '{"beans":100,"yuan":10}', 'bean.task_reward': '200',
  'bean.note_reward': '50', 'bean.note_weekly_cap': '500', 'bean.script_rewards': '[80,50,20]',
  'bean.budget_profit_pct': '0.05', 'bean.global_cap_yuan': '600000',
  'member.level.thresholds': '[0,2000,10000,50000]', 'member.cs_multiplier': '10', 'member.annual_reset': 'true',
  'promoter.tier2_gmv': '1000000', 'promoter.tier3_gmv': '5000000', 'promoter.rate_bp': '[500,800,1200]',
  'promoter.tier3_score_min': '4.5', 'promoter.window_days': '90',
  'promoter.withdraw_min': '10000', 'promoter.withdraw_daily_max': '500000',
  'contribution.weights': '{"q":0.5,"s":0.3,"r":0.2}',
  'order.pay_timeout': '15', 'order.observe_days': '7',
  'order.refund_policy': '{"d7":0.0,"d3":0.10,"d1":0.30}', 'order.group_cancel_hours': '48',
  'pass.code_window': '60', 'commission.settle_delay_days': '7', 'settlement.weekday': '1',
  'budget.approval.l1': '300000', 'budget.approval.l2': '800000', 'budget.fuse_pct': '0.25',
  'budget.forecast.warn': '[0.25,0.50]',
  'city.initial': '["310118","320508"]', 'channel.initial': '["main"]',
}

let cache = null
let loadedAt = 0

export async function loadConfig(force = false) {
  if (!force && cache && Date.now() - loadedAt < 30_000) return cache
  try {
    const rows = await q('SELECT k, v FROM rule_config')
    cache = {}
    for (const r of rows) cache[r.k] = typeof r.v === 'string' ? r.v : JSON.stringify(r.v)
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in cache)) cache[k] = v
  } catch {
    cache = { ...DEFAULTS } // 库不可用时兜底（只读接口可用）
  }
  loadedAt = Date.now()
  return cache
}

export async function cfg(key) {
  const c = await loadConfig()
  if (!(key in c)) throw new Error('unknown config key: ' + key)
  return c[key]
}
export async function cfgNum(key) { return Number(await cfg(key)) }
export async function cfgArr(key) { return JSON.parse(await cfg(key)) }
export async function cfgAll() { return loadConfig(true) }
