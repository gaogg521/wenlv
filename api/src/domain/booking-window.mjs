import { BIZ_TZ } from '../infra/bizdate.mjs'
export function bookingNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}
export function validDeadline(value) {
  if (value == null || value === '') return true
  const s = String(value).replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return false
  const d = new Date(s.replace(' ', 'T') + (s.length === 16 ? ':00' : '') + 'Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 16) === s.replace(' ', 'T').slice(0, 16)
}
export function bookingOpen(profile, now = bookingNow()) {
  let p = profile || {}
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch { return false } }
  const value = p.sign_deadline
  return !value || (validDeadline(value) && String(value).replace('T', ' ') > now)
}
// Business-local strings (datetime-local), checked again in the inventory UPDATE.
export function bookingOpenSql(alias = 's') {
  const v = `JSON_UNQUOTE(JSON_EXTRACT(${alias}.profile, '$.sign_deadline'))`
  return `(${v} IS NULL OR ${v} = '' OR REPLACE(${v}, 'T', ' ') > ?)`
}
