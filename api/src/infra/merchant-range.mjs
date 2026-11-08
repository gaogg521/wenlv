import { BizError } from '../db.mjs'
import { bizDay } from './bizdate.mjs'
export function merchantRange(query = {}, defaultDays = 0, maxDays = 3660) {
  const from = query.from || (defaultDays ? bizDay(1 - defaultDays) : ''), to = query.to || (defaultDays ? bizDay() : '')
  if (!from && !to) return null
  const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0,10) === d
  if (!valid(from) || !valid(to) || from > to) throw new BizError(1001, '请选择有效的起止日期')
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
  if (days > maxDays) throw new BizError(1001, '查询日期范围过长，请缩小范围')
  return { from, to, days }
}
export function merchantPaging(query = {}, defaultSize = 50) {
  const page = Number(query.page || 1), size = Number(query.pageSize || defaultSize)
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(size) || size < 1 || size > 100) throw new BizError(1001, '分页参数无效')
  return { size, offset: (page - 1) * size }
}
