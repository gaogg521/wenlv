# -*- coding: utf-8 -*-
# 低垂果实后端：FAQ/轮播 CRUD + CSV 导出（orders/products/settlements/merchants）+ 看板 insights（待办聚合/热门排行/转化漏斗）
import io
p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()

# ---- 1) admin FAQ/轮播 CRUD（插到 WEB3 工作区后面）----
anchor = "  // 合约调用账户（链数根适配器接入位）：凭据经集成中心配置，此处只读展示"
assert anchor in s
add = '''  // ---- 常见问题 / 轮播管理（小程序内容运营位，V13）----
  'GET /admin/faqs': async (req) => {
    await requireAdmin(req)
    return await q('SELECT * FROM faq ORDER BY sort, id')
  },
  'POST /admin/faqs': async (req) => {
    await requireAdmin(req)
    const { question, answer, sort } = req.body
    if (!question || !answer) throw new BizError(1001, '问题与答案必填')
    const id = await tx(async (c) => c.ins('INSERT INTO faq (question, answer, sort) VALUES (?,?,?)',
      [question, answer, Number(sort) || 0]))
    return { id }
  },
  'POST /admin/faqs/:id/update': async (req) => {
    await requireAdmin(req)
    const { question, answer, sort, status } = req.body
    await q('UPDATE faq SET question = COALESCE(?, question), answer = COALESCE(?, answer), sort = COALESCE(?, sort), status = COALESCE(?, status) WHERE id = ?',
      [question || null, answer || null, sort != null ? Number(sort) : null, status != null ? Number(status) : null, req.params.id])
    return { updated: true }
  },
  'POST /admin/faqs/:id/delete': async (req) => {
    await requireAdmin(req)
    await q('DELETE FROM faq WHERE id = ?', [req.params.id])
    return { deleted: true }
  },
  'GET /admin/banners': async (req) => {
    await requireAdmin(req)
    return await q('SELECT * FROM banner ORDER BY sort, id')
  },
  'POST /admin/banners': async (req) => {
    await requireAdmin(req)
    const { title, image, link, sort } = req.body
    if (!title || !image) throw new BizError(1001, '标题与图片必填')
    const id = await tx(async (c) => c.ins('INSERT INTO banner (title, image, link, sort) VALUES (?,?,?,?)',
      [title, image, link || null, Number(sort) || 0]))
    return { id }
  },
  'POST /admin/banners/:id/update': async (req) => {
    await requireAdmin(req)
    const { title, image, link, sort, status } = req.body
    await q('UPDATE banner SET title = COALESCE(?, title), image = COALESCE(?, image), link = COALESCE(?, link), sort = COALESCE(?, sort), status = COALESCE(?, status) WHERE id = ?',
      [title || null, image || null, link !== undefined ? link : null, sort != null ? Number(sort) : null, status != null ? Number(status) : null, req.params.id])
    return { updated: true }
  },
  'POST /admin/banners/:id/delete': async (req) => {
    await requireAdmin(req)
    await q('DELETE FROM banner WHERE id = ?', [req.params.id])
    return { deleted: true }
  },

''' + anchor
s = s.replace(anchor, add, 1)

# ---- 2) CSV 导出 ----
anchor2 = "  // 约稿任务管理（P2 四态机：创建/审核）"
assert anchor2 in s
add2 = '''  // CSV 报表导出（低垂果实 #4）：orders/products/settlements/merchants
  'GET /admin/export/:what': async (req) => {
    await requireAdmin(req)
    const what = req.params.what
    let rows = [], name = what
    if (what === 'orders') {
      rows = await q(`SELECT o.order_no, o.status, o.qty, o.amount_goods, o.amount_bean_ded, o.insurance_fee, o.amount_pay,
        o.city_code, o.promo_scene, o.created_at, p.title FROM orders o JOIN tour_product p ON p.id = o.product_id ORDER BY o.id DESC LIMIT 5000`)
    } else if (what === 'products') {
      rows = await q(`SELECT p.id, p.title, p.channel, p.city_code, p.cat, p.price_from, p.bean_gift, p.status, m.name merchant_name
        FROM tour_product p JOIN merchant m ON m.id = p.merchant_id ORDER BY p.id`)
    } else if (what === 'settlements') {
      rows = await q(`SELECT s.id, m.name merchant_name, s.period, s.total, s.fulfill, s.service, s.bean_budget, s.promo, s.retained, s.status
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id ORDER BY s.id DESC LIMIT 2000`)
    } else if (what === 'merchants') {
      rows = await q(`SELECT id, name, merchant_no, city_code, status, score, apply_contact, apply_mobile, approved_at, created_at FROM merchant ORDER BY id`)
    } else throw new BizError(1004, '未知报表类型')
    const csv = toCsv(rows)
    return { name, filename: name + '-' + new Date().toISOString().slice(0, 10) + '.csv', csv }
  },

''' + anchor2
s = s.replace(anchor2, add2, 1)

# toCsv 助手（放 fen2yuan 旁）
anchor_h = "const fen2yuan = (f) => (Number(f) / 100).toFixed(2)"
assert anchor_h in s
s = s.replace(anchor_h, anchor_h + '''
// CSV 序列化：RFC4180 转义 + UTF-8 BOM（Excel 直开不乱码）
function toCsv(rows) {
  if (!rows.length) return '\\uFEFF(空)\\n'
  const esc = (v) => { const str = v == null ? '' : String(v); return /[",\\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str }
  const head = Object.keys(rows[0]).join(',')
  const body = rows.map((r) => Object.values(r).map(esc).join(',')).join('\\n')
  return '\\uFEFF' + head + '\\n' + body + '\\n'
}''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part1 ok')
