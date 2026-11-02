// 业务日期：一律按业务时区（默认 Asia/Shanghai）切日，不用 toISOString()（那是 UTC）。
// 例：北京时间 07:30，UTC 日期仍是"昨天"——用 UTC 切日会把旅豆日终根封错一天，
// 把还在增长的"今天"当成可封存的历史日，或者把真正的昨天当成"今天"允许重封。
export const BIZ_TZ = process.env.BIZ_TZ || 'Asia/Shanghai'

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** YYYY-MM-DD（业务时区）；offsetDays=-1 为业务昨天 */
export function bizDay(offsetDays = 0, now = new Date()) {
  return fmt.format(new Date(now.getTime() + offsetDays * 86400_000))
}

/**
 * ISO 8601 周（业务时区）：'2026-W45'。结算周期统一用它命名。
 * 周一凌晨出账时取"昨天"所在周，即刚结束的那一周。
 */
export function isoWeek(dateStr = bizDay()) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day) // 移到本周周四，周四所在年份即 ISO 年
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t - yearStart) / 86400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
/** 结算默认周期：昨天所在 ISO 周（周一出账即上周；周中手动出账即本周） */
export const settlementPeriod = (now = new Date()) => isoWeek(bizDay(-1, now))
