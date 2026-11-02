# -*- coding: utf-8 -*-
# 低垂果实 part2：看板 insights（待办聚合/热门排行/转化漏斗）+ 结算导出列名修正 + c 端 faqs/banners
import io
p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()

# 修正 settlements 导出列名（实际表结构）
old = "      rows = await q(`SELECT s.id, m.name merchant_name, s.period, s.total, s.fulfill, s.service, s.bean_budget, s.promo, s.retained, s.status\n        FROM settlement s JOIN merchant m ON m.id = s.merchant_id ORDER BY s.id DESC LIMIT 2000`)"
assert old in s
s = s.replace(old, "      rows = await q(`SELECT s.id, m.name merchant_name, s.period, s.order_count, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained, s.status\n        FROM settlement s JOIN merchant m ON m.id = s.merchant_id ORDER BY s.id DESC LIMIT 2000`)")

# ---- 看板 insights（插在 dash/kpi 路由后）----
anchor = "'GET /admin/dash/kpi'"
i = s.find(anchor)
assert i > 0
# 找到该路由对象的结尾——直接在其后插入新键值对：定位 "'/admin/dash/kpi': async (req) => {" 块
start = s.rfind("  '", 0, i)
# 用简单策略：在 anchor 行所在路由结束后插入。找下一个 "\n  '" 出现位置
nxt = s.find("\n  '", i)
assert nxt > 0
insights = '''
  // 看板三件套（低垂果实 #6）：待办聚合 / 热门主题游 TOP5 / 活动转化漏斗
  'GET /admin/dash/insights': async (req) => {
    await requireAdmin(req)
    const pendingWithdrawals = await one("SELECT COUNT(*) c FROM withdraw_request WHERE status = 0")
    const pendingConflicts = await one("SELECT COUNT(*) c FROM verify_offline_conflict WHERE status = 0")
    const pendingNotes = await one("SELECT COUNT(*) c FROM content_note WHERE status = 1")
    const pendingMerchants = await one("SELECT COUNT(*) c FROM merchant WHERE status = 0")
    const pendingTasks = await one("SELECT COUNT(*) c FROM content_task WHERE status = 2")
    const topTours = await q(`SELECT p.id, p.title, COUNT(o.id) orders, COALESCE(SUM(o.amount_pay),0) gmv
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.status >= 20 GROUP BY p.id, p.title ORDER BY orders DESC LIMIT 5`)
    const allOrders = await one('SELECT COUNT(*) c FROM orders')
    const paidOrders = await one('SELECT COUNT(*) c FROM orders WHERE status >= 20 AND status <> 90')
    const uniqUsers = await one('SELECT COUNT(DISTINCT user_id) c FROM orders WHERE status >= 20 AND status <> 90')
    const rebuyUsers = await one(`SELECT SUM(c > 1) c FROM (SELECT COUNT(*) c FROM orders WHERE status >= 20 AND status <> 90 GROUP BY user_id) t`)
    const beanFlow = await one(`SELECT COALESCE(SUM(direction = 1 AND biz_type IN (1,2,3)),0) granted,
      COALESCE(SUM(direction = 2),0) consumed FROM bean_ledger`)
    const total = Number(allOrders.c) || 0
    const paid = Number(paidOrders.c) || 0
    return {
      pending: {
        withdrawals: Number(pendingWithdrawals.c) || 0,
        conflicts: Number(pendingConflicts.c) || 0,
        notes: Number(pendingNotes.c) || 0,
        merchants: Number(pendingMerchants.c) || 0,
        tasks: Number(pendingTasks.c) || 0,
      },
      topTours,
      funnel: {
        payRate: total ? Math.round(paid / total * 100) + '%' : '—',
        verifyRate: (await one(`SELECT COUNT(*) c FROM verification_log WHERE result = 1`)),
        rebuyRate: (Number(uniqUsers.c) && Number(rebuyUsers.c)) ? Math.round(Number(rebuyUsers.c) / Number(uniqUsers.c) * 100) + '%' : '0%',
        beanUseRate: Number(beanFlow.granted) ? Math.round(Number(beanFlow.consumed) / Number(beanFlow.granted) * 100) + '%' : '0%',
      },
    }
  },
'''
s = s[:nxt] + insights + s[nxt:]

# verifyRate funnel 值修整：换算百分比（把上面临时对象换成数字）
old2 = "        verifyRate: (await one(`SELECT COUNT(*) c FROM verification_log WHERE result = 1`)),"
assert old2 in s
s = s.replace(old2, "        verifyRate: '—', // 核销完成率在 dash/kpi 已有，这里保留占位")

# ---- c 端：FAQ 与轮播（游客端展示）----
anchor_c = "  // 目的地城市聚合（P2）"
assert anchor_c in s
add_c = '''  // 常见问题（小程序「我的-常见问题」）
  'GET /c/faqs': async (req) => {
    requireUser(req)
    return await q('SELECT id, question, answer FROM faq WHERE status = 1 ORDER BY sort, id')
  },
  // 首页轮播
  'GET /c/banners': async (req) => {
    requireUser(req)
    const rows = await q('SELECT id, title, image, link FROM banner WHERE status = 1 ORDER BY sort, id LIMIT 6')
    return rows.map((b) => ({ ...b, image: apiImg(b.image) }))
  },
''' + anchor_c
s = s.replace(anchor_c, add_c, 1)

# apiImg 助手（若无则定义在 c 附近；查有没有现成的）
if 'function apiImg' not in s and 'const apiImg' not in s:
    s = s.replace(anchor_h2 := "const fen2yuan = (f) => (Number(f) / 100).toFixed(2)", anchor_h2 + '''
const apiImg = (u) => (u && /^https?:/.test(u)) ? u : (u ? 'http://127.0.0.1:8080' + u : u)''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part2 ok')
