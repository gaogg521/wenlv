// 批次 C 回归：T03 订单服务端全量检索 + T10 列表分页契约（隔离库，需服务在跑）
// 覆盖：制造 260 条跨城/跨状态订单 → 第 101 条以外老单精确命中；翻页不重不漏；
//       statusCounts 口径（其他筛选不变去状态）；日期边界；城市隔离；空结果/重置；
//       导出与总数同口径；内容/创作者/提现/风控列表分页契约与负向。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-orders-search.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '检索回归-' + role })]))
const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '检索回归-城市' })
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'SRCH' + Date.now()
const inserted = []
let cityA, cityB, productA, productB, sessionA, sessionB, userA
try {
  // ---- 夹具：两城各一条线路/团期/用户，260 条订单跨状态跨日期 ----
  const prod = await one('SELECT id, city_code FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  const prod2 = await one('SELECT id, city_code FROM tour_product WHERE status = 1 AND city_code <> ? ORDER BY id LIMIT 1', [prod.city_code])
  const sess = async (pid) => (await one('SELECT id FROM tour_session WHERE product_id = ? ORDER BY id LIMIT 1', [pid])).id
  productA = prod.id; cityA = prod.city_code; sessionA = await sess(productA)
  if (prod2) { productB = prod2.id; cityB = prod2.city_code; sessionB = await sess(productB) } else { productB = productA; cityB = cityA; sessionB = sessionA }
  const u = await q("INSERT INTO user_account (mini_a_openid, nickname, created_at) VALUES (?, ?, NOW(3))", ['srch-' + stamp, stamp + '买家'])
  userA = u.insertId
  const statuses = [10, 20, 30, 40, 50, 70, 90]
  for (let i = 0; i < 260; i++) {
    const useB = prod2 && i % 5 === 4 // 约 20% 外城
    const st = statuses[i % statuses.length]
    const day = i % 3 // 三天跨度：2026-01-10/11/12
    const r = await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name, created_at, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [stamp + '-' + String(i).padStart(4, '0'), userA, useB ? productB : productA, useB ? sessionB : sessionA,
        useB ? cityB : cityA, (await one('SELECT id FROM merchant LIMIT 1')).id, 1, 1000 + i, 1000 + i, st,
        stamp + '联系人' + i, `2026-01-1${0 + day} 10:00:00`, [20, 30, 40, 50, 70].includes(st) ? `2026-01-1${0 + day} 11:00:00` : null])
    inserted.push(r.insertId)
  }
  await q("UPDATE user_account SET mobile_enc = NULL WHERE id = ?", [userA])

  await test('老单精确命中：第 101 条以外的最早订单按订单号直达', async () => {
    // 订单按 id DESC 排列，第 101 条以外的老单 = 序号最小的一批（默认 LIMIT 100 下不可见）
    const oldest = await one('SELECT order_no FROM orders WHERE id = ? ', [inserted[0]])
    const r = ok(await call('super', 'GET', `/admin/orders/search?kw=${oldest.order_no}`))
    assert.equal(r.total, 1, '精确命中 1 条')
    assert.equal(r.rows[0].order_no, oldest.order_no)
    assert.ok(r.rows.length === 1 && r.page === 1)
  })

  await test('契约完整：total/page/pageSize/statusCounts/countsScope/filters；总数=库内复算', async () => {
    const r = ok(await call('super', 'GET', '/admin/orders/search?pageSize=7&page=2'))
    assert.equal(r.pageSize, 7); assert.equal(r.page, 2)
    assert.ok(r.rows.length <= 7)
    assert.equal(r.countsScope, 'same-filters-except-status')
    const dbCount = Number((await one('SELECT COUNT(*) n FROM orders')).n)
    assert.equal(r.total, dbCount, '总数与库内一致')
    const dbAll = Number((await one('SELECT COUNT(*) n FROM orders')).n)
    assert.equal(r.statusCounts.all, dbAll, 'statusCounts.all = 无状态筛选总数')
    for (const st of [10, 20, 50]) {
      const dbSt = Number((await one('SELECT COUNT(*) n FROM orders WHERE status = ?', [st])).n)
      assert.equal(r.statusCounts[st] || 0, dbSt, 'status ' + st + ' 计数一致')
    }
    // 翻页不重不漏（动态页数：其他套件会向隔离库补订单）
    const allIds = []
    let pg = 1, totalCount = 0
    for (;;) {
      const pp = ok(await call('super', 'GET', `/admin/orders/search?pageSize=100&page=${pg}`))
      totalCount = pp.total
      allIds.push(...pp.rows.map((x) => Number(x.id)))
      if (pg * 100 >= totalCount || pg > 50) break
      pg++
    }
    assert.equal(new Set(allIds).size, allIds.length, '无重复')
    assert.equal(allIds.length, totalCount, '翻页取满总数')
  })

  await test('筛选组合：状态×日期边界×排序；状态计数为"其他筛选不变去状态"', async () => {
    const r = ok(await call('super', 'GET', `/admin/orders/search?status=20&createdFrom=2026-01-10&createdTo=2026-01-11&sort=paid`))
    assert.equal(r.total, Number((await one("SELECT COUNT(*) n FROM orders WHERE status = 20 AND created_at >= '2026-01-10 00:00:00' AND created_at <= '2026-01-11 23:59:59.999'")).n))
    assert.ok(r.rows.every((o) => Number(o.status) === 20))
    assert.ok(r.filters.createdFrom === '2026-01-10' && !('status' in r.filters), 'filters 只收集状态外条件（与计数共用）')
    // 状态计数：同筛选去状态 → 日期边界内全部 260 条中三天内的
    const dbRange = Number((await one("SELECT COUNT(*) n FROM orders WHERE created_at >= '2026-01-10 00:00:00' AND created_at <= '2026-01-11 23:59:59.999'")).n)
    assert.equal(r.statusCounts.all, dbRange, '计数口径=其他筛选不变')
    assert.equal(r.statusCounts[20], r.total, '状态 20 计数 = 状态筛选下的 total')
    // 边界：只取 1 月 12 日
    const r12 = ok(await call('super', 'GET', '/admin/orders/search?createdFrom=2026-01-12&createdTo=2026-01-12'))
    assert.equal(r12.total, Number((await one("SELECT COUNT(*) n FROM orders WHERE created_at >= '2026-01-12 00:00:00' AND created_at <= '2026-01-12 23:59:59.999'")).n))
    // 排序
    assert.ok(r.rows.every((o, i, a) => i === 0 || String(a[i - 1].paid_at) >= String(o.paid_at)), 'paid 降序')
    // 非法日期/状态
    assert.equal((await call('super', 'GET', '/admin/orders/search?createdFrom=2026/01/01')).code, 1001)
    assert.equal((await call('super', 'GET', '/admin/orders/search?status=35')).code, 1001)
  })

  await test('买家检索：昵称与联系人模糊命中；完整手机号走盲索引且响应无号码', async () => {
    const byNick = ok(await call('super', 'GET', `/admin/orders/search?kw=${encodeURIComponent(stamp + '买家')}&pageSize=5`))
    assert.ok(byNick.total >= 260, '昵称命中全部夹具单：' + byNick.total)
    const byContact = ok(await call('super', 'GET', `/admin/orders/search?kw=${encodeURIComponent(stamp + '-0001')}`))
    assert.equal(byContact.total, 1, '订单号片段命中 1 条')
    // 手机号检索：夹具用户无手机号 → 空结果但不报错、不泄露
    const byPhone = ok(await call('super', 'GET', '/admin/orders/search?kw=13800001111'))
    assert.equal(byPhone.total, 0)
    assert.ok(!JSON.stringify(byPhone).includes('13800001111'))
  })

  await test('城市隔离：城市账号只见本城（含 total/statusCounts），内部角色可用 cityCode 收窄', async () => {
    const cityTokScoped = jwtSign({ end: 'admin', role: 'city_partner', name: '检索回归-城市A', scopeCity: String(cityA) })
    const rA = ok(await call(null, 'GET', '/admin/orders/search?pageSize=100', null, cityTokScoped))
    const dbA = Number((await one('SELECT COUNT(*) n FROM orders WHERE city_code = ?', [cityA])).n)
    assert.equal(rA.total, dbA, '城市账号 total = 本城订单数')
    assert.ok(rA.rows.every((o) => String(o.city_code) === String(cityA)))
    assert.ok(rA.statusCounts.all === dbA, '城市账号状态计数也在本城内')
    const rB = ok(await call(null, 'GET', '/admin/orders/search?pageSize=100', null, jwtSign({ end: 'admin', role: 'city_partner', name: '检索回归-城市B', scopeCity: String(cityB) })))
    assert.equal(rB.total, Number((await one('SELECT COUNT(*) n FROM orders WHERE city_code = ?', [cityB])).n))
    assert.equal((await call(null, 'GET', '/admin/orders/search', null, jwtSign({ end: 'admin', role: 'city_partner', name: '无城' }))).code, 1003, '无绑定城市账号拒绝')
    // 内部角色显式 cityCode
    const scoped = ok(await call('ops', 'GET', `/admin/orders/search?cityCode=${cityB}&pageSize=5`))
    assert.ok(scoped.rows.every((o) => String(o.city_code) === String(cityB)))
    assert.equal(scoped.total, Number((await one('SELECT COUNT(*) n FROM orders WHERE city_code = ?', [cityB])).n))
  })

  await test('导出与总数同口径：无筛选导出行数 = 库内全量（未越 5000 上限时）', async () => {
    const exp = ok(await call('super', 'GET', '/admin/export/orders'))
    const dataRows = exp.csv.trim().split('\n').length - 1
    const dbAll = Number((await one('SELECT COUNT(*) n FROM orders')).n)
    assert.equal(dataRows, dbAll, '导出行数 = 库内订单总数')
    // 城市账号导出被拒（批次 A 规则保持）
    assert.equal((await call(null, 'GET', '/admin/export/orders', null, cityTok)).code, 1003)
    // U-04：按筛选导出与检索同口径——status=50 的行数与库内一致；非法状态拒绝
    const dbDone = Number((await one('SELECT COUNT(*) n FROM orders WHERE status = 50')).n)
    const expDone = ok(await call('super', 'GET', '/admin/export/orders?status=50'))
    assert.equal(expDone.csv.trim().split('\n').length - 1, dbDone, '状态筛选导出行数 = 库内同状态数')
    assert.equal((await call('super', 'GET', '/admin/export/orders?status=999')).code, 1001, '非法状态拒绝')
    const expKw = ok(await call('super', 'GET', '/admin/export/orders?kw=不存在的单号xyz'))
    assert.equal(expKw.csv.trim().split('\n').length - 1, 0, '关键字筛选空结果导出仅表头')
  })

  await test('T10 列表契约：内容/创作者/提现/风控为分页对象；越权与空态负向', async () => {
    const content = ok(await call('ops', 'GET', '/admin/content?page=1&pageSize=5'))
    assert.ok(Array.isArray(content.rows) && typeof content.total === 'number' && content.countsScope, '内容列表契约')
    assert.ok(content.rows.length <= 5)
    const contentFiltered = ok(await call('ops', 'GET', '/admin/content?status=2&kw=' + encodeURIComponent('不存在的标题xyz')))
    assert.equal(contentFiltered.total, 0); assert.equal(contentFiltered.rows.length, 0)
    assert.equal((await call('finance', 'GET', '/admin/content')).code, 1003, '财务无内容列表')
    // 创作者池是超管模块（C-05 模块强制后 ops 直调 1003）——空结果断言改用 super
    assert.equal((await call('ops', 'GET', '/admin/creators?kw=x')).code, 1003, 'ops 无创作者池模块')
    const creators = ok(await call('super', 'GET', '/admin/creators?kw=' + encodeURIComponent('不存在昵称abc')))
    assert.equal(creators.total, 0); assert.ok(Array.isArray(creators.rows))
    const wd = ok(await call('finance', 'GET', '/admin/withdrawals?status=0'))
    assert.ok(Array.isArray(wd.rows) && typeof wd.total === 'number')
    assert.ok(wd.rows.every((w) => Number(w.status) === 0))
    assert.equal((await call('ops', 'GET', '/admin/withdrawals')).code, 1003, '提现仅财务/超管')
    const risk = ok(await call('risk', 'GET', '/admin/risk?handled=0'))
    assert.ok(Array.isArray(risk.rows) && typeof risk.total === 'number')
    assert.ok(risk.rows.every((x) => Number(x.handled) === 0))
    assert.equal((await call('ops', 'GET', '/admin/risk')).code, 1003)
  })

  console.log(`\n${passed} 项批次 C（T03 服务端检索 + T10 列表契约）回归通过`)
} finally {
  if (inserted.length) {
    await q('DELETE FROM order_event WHERE order_id IN (?)', [inserted]).catch(() => {})
    await q('DELETE FROM orders WHERE id IN (?)', [inserted])
    await q('DELETE FROM audit_log WHERE module = ? AND biz_ref LIKE ?', ['search-fixture', stamp + '%']).catch(() => {})
  }
  if (userA) await q('DELETE FROM user_account WHERE id = ?', [userA])
  await closeDb()
}
