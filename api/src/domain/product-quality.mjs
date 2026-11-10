// Operational warnings, never invented data or indiscriminate publishing blockers.
export function productQuality(p) {
  const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v || {} } catch { return {} } }
  const rich = parse(p.rich_desc), pf = parse(p.profile), issues = []
  if (!parse(p.images).length) issues.push('补充真实或明确标注来源的商品封面')
  if (!rich.intro) issues.push('补充商品介绍')
  if (p.cat !== 'shop') {
    if (!pf.itinerary?.length) issues.push('补充线路行程节点')
    if (!rich.includes?.length) issues.push('补充费用包含，避免套餐内容只写在标题')
    const duration = s => /(?:2|两|二)\s*天/.test(s) ? 2 : /(?:1|一)\s*(?:天|日)/.test(s) ? 1 : null
    if (duration(p.title) && duration(p.days_desc) && duration(p.title) !== duration(p.days_desc)) issues.push('标题与行程天数不一致，请人工核对')
    if (!p.supplier_id && !p.scenic_id) issues.push('核对履约资源：尚未关联供应商或景区')
  } else if (/天|夜|小时/.test(p.days_desc || '')) issues.push('核对商城购买单位：实物、到店体验与线路时长不要混写')
  return { category: p.cat === 'shop' ? '商城商品/到店体验' : '线路', issues }
}
