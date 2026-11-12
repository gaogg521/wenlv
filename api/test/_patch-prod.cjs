// 一次性补丁：商户主体方本店商品自维护（V82 配套）——创建强制本店、编辑/上下架/团期校验本店归属
const fs = require('fs')
const f = 'src/routes/admin.mjs'
let s = fs.readFileSync(f, 'utf8')
const eol = s.includes('\r\n') ? '\r\n' : '\n'
let n = 0
function rep(oldStr, newStr, label) {
  if (!s.includes(oldStr)) { console.error('MISS ' + label); process.exit(1) }
  s = s.replace(oldStr, newStr); n++
}

// 1) 创建商品：主体方可用并强制 merchant_id=subject
rep(`  'POST /admin/products': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { title, cat, cityCode, channelId, merchantId, priceFrom, beanGift, daysDesc, subtitle, status,
      intro, includes, highlights, meetingPoint, safetyNote, supplierId, scenicId } = req.body`,
`  'POST /admin/products': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'merchant_partner'])
    const subP = subjectScope(a)
    const { title, cat, cityCode, channelId, merchantId, priceFrom, beanGift, daysDesc, subtitle, status,
      intro, includes, highlights, meetingPoint, safetyNote, supplierId, scenicId } = req.body
    // V82 商户主体方自维护：只能给自己店里建品（merchantId 强制为绑定主体）
    if (a.role === 'merchant_partner') {
      if (!subP.merchantId) throw new BizError(1003, '商户主体方未绑定主体')
      if (merchantId != null && Number(merchantId) !== Number(subP.merchantId)) throw new BizError(1003, '只能为本店创建商品')
    }`, 'create product roles')

// 2) 编辑商品：主体方仅本店
rep(`  'PUT /admin/products/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const p = await one('SELECT rich_desc, price_from, status, title, bean_gift, supplier_id, scenic_id, updated_version FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')`,
`  'PUT /admin/products/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'merchant_partner'])
    const p = await one('SELECT rich_desc, price_from, status, title, bean_gift, supplier_id, scenic_id, updated_version, merchant_id FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    // V82 商户主体方自维护：仅可编辑本店商品
    if (a.role === 'merchant_partner') {
      const subE = subjectScope(a)
      if (!subE.merchantId || Number(subE.merchantId) !== Number(p.merchant_id)) throw new BizError(1003, '仅可编辑本店商品')
    }`, 'edit product')

// 3) 上下架：主体方仅本店
rep(`  'POST /admin/products/:id/status': async (req) => {
    const a = await requireAdmin(req, 'product.status')`,
`  'POST /admin/products/:id/status': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'merchant_partner'])
    if (a.role === 'merchant_partner') {
      const subS = subjectScope(a)
      const own = subS.merchantId && (await one('SELECT id FROM tour_product WHERE id = ? AND merchant_id = ?', [req.params.id, subS.merchantId]))
      if (!own) throw new BizError(1003, '仅可操作本店商品')
    }`, 'product status')

// 4) 团期创建：主体方仅本店商品
rep(`  'POST /admin/sessions': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { productId, departDate, quota, minGo, priceAdult, earlyPrice, earlyDays } = req.body`,
`  'POST /admin/sessions': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'merchant_partner'])
    const { productId, departDate, quota, minGo, priceAdult, earlyPrice, earlyDays } = req.body
    // V82 商户主体方自维护：仅可为本店商品排团期
    if (a.role === 'merchant_partner') {
      const subSes = subjectScope(a)
      const own = subSes.merchantId && (await one('SELECT id FROM tour_product WHERE id = ? AND merchant_id = ?', [productId, subSes.merchantId]))
      if (!own) throw new BizError(1003, '仅可为本店商品排团期')
    }`, 'sessions')

fs.writeFileSync(f, s)
console.log('patched', n)
