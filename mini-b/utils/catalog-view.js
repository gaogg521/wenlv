const money = n => (Number(n || 0) / 100).toFixed(2)
function businessDay(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10) }
function stockView(list, options = {}, now = Date.now()) {
  const today = businessDay(now), keyword = String(options.kw || '').trim().toLowerCase()
  const end = days => new Date(Date.parse(today + 'T00:00:00+08:00') + days * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
  const range = options.range || 'future', status = options.status || 'all', byProduct = {}
  const rows = list.filter(s => {
    const date = String(s.depart_date).slice(0, 10), active = Number(s.status) === 1 && date >= today
    if (range === 'future' && date < today || range === 'past' && date >= today) return false
    if (range === 'week' && (date < today || date > end(6)) || range === 'month' && (date < today || date > end(29))) return false
    if (status === 'open' && (!active || Number(s.left_seats) <= 0)) return false
    if (status === 'tight' && (!active || Number(s.left_seats) > 2 || Number(s.left_seats) < 1)) return false
    if (status === 'closed' && Number(s.status) < 3) return false
    return !keyword || (s.title + ' ' + date).toLowerCase().includes(keyword)
  }).map(s => {
    const date = String(s.depart_date).slice(0, 10), past = date < today, left = Math.max(0, Number(s.left_seats))
    const statusLabel = past ? '已过期' : ({ 1: left ? '可售' : '已满', 2: '已成团', 3: '已截止', 4: '已取消' }[Number(s.status)] || '不可售')
    return Object.assign({}, s, { date, dateShort: date.slice(5), priceLabel: money(s.price_adult), earlyLabel: money(s.early_price), left, statusLabel, canSell: !past && Number(s.status) === 1, tight: !past && Number(s.status) === 1 && left <= 2,
      priceNote: Number(s.early_price) > 0 ? ('早鸟 ¥' + money(s.early_price) + ' · 提前' + s.early_days + '天') : '常规团期价格' })
  }).sort((a,b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id))
  for (const s of rows) {
    // 商品ID是身份；同名商品不能混到一组。
    const key = String(s.product_id == null ? s.title : s.product_id)
    if (!byProduct[key]) byProduct[key] = { key, title: s.title, sessions: [], seats: 0, minPrice: Number(s.price_adult) }
    const g = byProduct[key]; g.sessions.push(s); if (s.canSell) g.seats += s.left
    g.minPrice = Math.min(g.minPrice, Number(s.price_adult))
  }
  const groups = Object.values(byProduct).map(g => Object.assign(g, { count: g.sessions.length, nextDate: g.sessions[0].date, priceLabel: money(g.minPrice), expanded: g.key === String(options.expandedKey || '') }))
  return { groups, filteredCount: rows.length, productCount: groups.length, availableSeats: groups.reduce((sum,g) => sum + g.seats, 0) }
}
function orderView(list, keyword = '', status = 'all', limit = 12) {
  const kw = String(keyword).trim().toLowerCase()
  const filtered = list.filter(o => (!kw || (o.title + ' ' + o.order_no + ' ' + (o.contact_name || '')).toLowerCase().includes(kw)) &&
    (status === 'all' || status === 'waiting' && [20,30].includes(Number(o.status)) || status === 'done' && [40,50].includes(Number(o.status)) || status === 'refund' && [60,70].includes(Number(o.status))))
  return { visibleOrders: filtered.slice(0, limit), matchedCount: filtered.length, hasMore: filtered.length > limit }
}
module.exports = { stockView, orderView, money, businessDay }
