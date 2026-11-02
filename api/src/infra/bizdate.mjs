// 业务日期：一律按业务时区（默认 Asia/Shanghai）切日，不用 toISOString()（那是 UTC）。
// 例：北京时间 07:30，UTC 日期仍是"昨天"——用 UTC 切日会把旅豆日终根封错一天，
// 把还在增长的"今天"当成可封存的历史日，或者把真正的昨天当成"今天"允许重封。
export const BIZ_TZ = process.env.BIZ_TZ || 'Asia/Shanghai'

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** YYYY-MM-DD（业务时区）；offsetDays=-1 为业务昨天 */
export function bizDay(offsetDays = 0, now = new Date()) {
  return fmt.format(new Date(now.getTime() + offsetDays * 86400_000))
}
