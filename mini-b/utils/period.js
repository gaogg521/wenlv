const day = offset => new Date(Date.now()+8*3600000+(offset||0)*86400000).toISOString().slice(0,10)
function periodQuery(index, date, allFirst = false) {
  if (allFirst && Number(index) === 0) return ''
  const i = Number(index) - (allFirst ? 1 : 0), today = day()
  const from = i === 3 ? date || today : day(i === 1 ? -6 : i === 2 ? -29 : 0)
  return 'from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(i === 3 ? date || today : today)
}
module.exports = { day, periodQuery }
