// 三端深度打磨 · DB 断言回归（X-01/02/03/04/05 + R-01/02/03 + P-04/06/07，隔离库 + 服务在跑）
// 权限 / 金额 / 排序 / 可见性相关的每项改动至少一条可复跑断言（交接文档 §7）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/deep-polish-db.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { tickClaimTimeout } from '../src/jobs.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (method, path, body, tok) => (await fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
const stamp = 'DPQA' + Math.random().toString(36).slice(2, 10)
const cleanup = { users: [], orders: [], notes: [], reviews: [], admins: [] }

try {
  /* ---------- 夹具 ---------- */
  const prod = await one('SELECT id, merchant_id, city_code, scenic_id FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要商品')
  const session = await one('SELECT s.id, p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.depart_date IS NOT NULL ORDER BY s.id LIMIT 1')
  const merchantId = Number(prod.merchant_id)
  const scenicOther = await one('SELECT id FROM scenic_spot WHERE city_code <> ? ORDER BY id LIMIT 1', [prod.city_code])

  const tourist = ok(await call('POST', '/c/auth/login', { code: 'mock-dp-' + stamp }))
  cleanup.users.push(tourist.user.id)
  const cTok = tourist.token
  // 商户端夹具：先建店长员工（mock openid = 'mock-openid-' + code），再登录
  const staffUid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-mock-dp-staff-' + stamp, stamp + '店长'])).insertId
  cleanup.users.push(staffUid)
  await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,3,1) ON DUPLICATE KEY UPDATE role = 3, status = 1', [merchantId, staffUid])
  const staff = ok(await call('POST', '/m/auth/login', { code: 'mock-dp-staff-' + stamp, merchantId }))
  const mTok = staff.token
  // 纯 payload 假 token（无 uid/ver，跳过 epoch 复核）用于既有种子角色；自建账号夹具用 aTokUid 走库内复核
  const aTok = (role, name) => jwtSign({ end: 'admin', role, name: name || ('DPQA-' + role) })
  const aTokUid = (role, name, uid) => jwtSign({ end: 'admin', role, name: name || ('DPQA-' + role), uid, ver: 1 })
  const superTok = aTok('super', 'DPQA-super')

  /* ---------- X-01/X-02 统一字典与 statusText ---------- */
  await test('X-02 /c/dicts：订单状态 8 码 + 城市/品类/商户类目齐备', async () => {
    const d = ok(await call('GET', '/c/dicts'))
    assert.equal(Object.keys(d.orderStatusTourist).length, 8)
    assert.equal(d.cities['310118'], '上海·青浦')
    assert.equal(d.productCats.shop, '商城好物')
    assert.ok(d.merchantKinds.other)
  })

  const mkOrder = async (status) => {
    const no = 'DP' + stamp + status + Math.floor(Math.random() * 100000)
    const r = await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, city_code, status, qty, amount_goods, amount_pay, channel)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'main')`,
      [no, tourist.user.id, prod.id, session.id, merchantId, prod.city_code, status, 1, 10000, 10000]).catch(async () => {
        // 兼容列默认差异：减少非必要列重试
        return q('INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, status, qty, amount_pay) VALUES (?,?,?,?,?,?,?,?)',
          [no, tourist.user.id, prod.id, session.id, merchantId, status, 1, 10000])
      })
    cleanup.orders.push(r.insertId)
    return { id: r.insertId, order_no: no }
  }

  const o30 = await mkOrder(30)
  await test('X-01 statusText 三端同源：游客/商户/后台同一状态码文案各归其位', async () => {
    const c = ok(await call('GET', '/c/orders', null, cTok))
    assert.equal(c.find((o) => o.order_no === o30.order_no).statusText, '待出行 · 待核销')
    const m = ok(await call('GET', '/m/orders?page=1&pageSize=20', null, mTok))
    assert.equal(m.find((o) => o.order_no === o30.order_no).statusText, '待出行 · 待核销')
    const a = ok(await call('GET', '/admin/orders/search?pageSize=50', null, aTok('super')))
    const row = a.rows.find((o) => o.order_no === o30.order_no)
    assert.equal(row.statusText, '待出行')
  })

  await test('X-01 订单详情：游客 statusText/statusSceneText 与「客服对口径」字段', async () => {
    const d = ok(await call('GET', '/c/orders/' + o30.order_no, null, cTok))
    assert.equal(d.statusText, '待出行 · 待核销')
    assert.equal(d.statusSceneText, '报名成功 · 已出票')
    const a = ok(await call('GET', '/admin/orders/' + o30.order_no, null, aTok('super')))
    assert.equal(a.statusTextTourist, '待出行 · 待核销')
  })

  /* ---------- R-01 主体只读代看 ---------- */
  await test('R-01 超管代看主体：数据与主体方视角一致；写操作网关拒绝；进/出有审计', async () => {
    const merchant = await one('SELECT id, name FROM merchant WHERE id = ?', [merchantId])
    const va = ok(await call('GET', `/admin/partner-dash?viewAsType=merchant&viewAsId=${merchantId}`, null, superTok))
    assert.equal(va.viewAs, true)
    assert.equal(va.subject.name, merchant.name)
    assert.ok(va.recent !== undefined && va.settlement !== undefined, '聚合结构与主体账号一致')
    // 与主体方账号登录同一聚合：造一个商户主体方账号对照
    const uname = 'dpmer-' + stamp
    const acc = (await q(`INSERT INTO admin_user (username, display_name, password_hash, role, subject_type, subject_id, status, token_epoch) VALUES (?,?,?, 'merchant_partner', 'merchant', ?, 1, 1)`,
      [uname, uname, 'x', merchantId])).insertId
    cleanup.admins.push(acc)
    const mpTok = aTokUid('merchant_partner', uname, acc)
    const own = ok(await call('GET', '/admin/partner-dash', null, mpTok))
    assert.equal(own.recent.orders, va.recent.orders)
    assert.equal(own.settlement.payableFen, va.settlement.payableFen)
    // 非超管拒绝
    const noPerm = await call('GET', `/admin/partner-dash?viewAsType=merchant&viewAsId=${merchantId}`, null, aTok('ops'))
    assert.equal(noPerm.code, 1003, 'ops 无 partner.viewAs 能力')
    // 写操作网关拒绝
    const writeTry = await call('POST', '/admin/dev/mock-pay?viewAsType=merchant&viewAsId=' + merchantId, { orderNo: o30.order_no }, superTok)
    assert.equal(writeTry.code, 1003, '带 viewAs 参数的写操作一律拒绝')
    // 进入/退出审计
    ok(await call('POST', '/admin/partner-dash/view-as', { subjectType: 'merchant', subjectId: merchantId }, superTok))
    ok(await call('POST', '/admin/partner-dash/view-as', { subjectId: null }, superTok))
    const audits = await q(`SELECT action FROM audit_log WHERE module = 'partner' AND action IN ('view-as-enter','view-as-exit') ORDER BY id DESC LIMIT 2`)
    assert.deepEqual(audits.map((a) => a.action).sort(), ['view-as-enter', 'view-as-exit'])
    // 验收补充：下钻接口（订单检索/商品/结算）在代看参数下必须可用，且与主体方账号自己看到的范围一致
    const vq = `viewAsType=merchant&viewAsId=${merchantId}`
    for (const [path, pick] of [['orders/search?pageSize=500', (d) => d.rows], ['products', (d) => d], ['settlements', (d) => d]]) {
      const sep = path.includes('?') ? '&' : '?'
      const asSuper = ok(await call('GET', `/admin/${path}${sep}${vq}`, null, superTok))
      const asOwner = ok(await call('GET', `/admin/${path}`, null, mpTok))
      assert.equal(pick(asSuper).length, pick(asOwner).length, `${path} 代看条数应与主体方账号一致`)
      assert.ok(pick(asSuper).every((r) => r.merchant_id === undefined || r.merchant_id === merchantId), `${path} 代看不得混入其他商户`)
      const denied = await call('GET', `/admin/${path}${sep}${vq}`, null, aTok('ops'))
      assert.equal(denied.code, 1003, `${path} 非超管带代看参数应 1003`)
    }
    assert.equal((await call('GET', `/admin/orders/search?viewAsType=bogus&viewAsId=1`, null, superTok)).code, 1001, '非法主体类型 1001')
  })

  /* ---------- R-03 演示主体账号 ---------- */
  await test('R-03 演示主体账号：mer310118/sce310118 可登录且绑定正确主体', async () => {
    const login = await call('POST', '/admin/login', { username: 'mer310118', password: 'mer123' })
    assert.equal(login.code, 0, 'mer310118 登录（开发环境）')
    const pd = ok(await call('GET', '/admin/partner-dash', null, login.data.token))
    assert.equal(pd.kind, 'merchant')
    const login2 = await call('POST', '/admin/login', { username: 'sce310118', password: 'sce123' })
    assert.equal(login2.code, 0, 'sce310118 登录')
    const pd2 = ok(await call('GET', '/admin/partner-dash', null, login2.data.token))
    assert.equal(pd2.kind, 'scenic')
  })

  /* ---------- R-02 城市合伙人收益 ---------- */
  await test('R-02 城市合伙人 insights.revenue：本城结算口径 + 进件进度', async () => {
    // 纯 payload token：scopeCity 必须在 payload 里（requireAdmin 只对带 uid/ver 的令牌回库取）
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: 'city310118', scopeCity: '310118' })
    const d = ok(await call('GET', '/admin/dash/insights', null, cityTok))
    assert.ok(d.revenue, 'city_partner 返回我的收益块')
    assert.equal(d.revenue.cityCn, '上海·青浦')
    assert.ok(typeof d.revenue.payableFen === 'number' && typeof d.revenue.merchantsPending === 'number')
  })

  /* ---------- P-04 排序与新筛选 ---------- */
  await test('P-04 订单检索：sort=depart/cat=shop/merchantId 筛选生效且回显 filters', async () => {
    const d = ok(await call('GET', '/admin/orders/search?sort=depart&cat=tour&merchantId=' + merchantId + '&pageSize=5', null, superTok))
    assert.equal(d.sort, 'depart')
    assert.equal(d.filters.cat, 'tour')
    assert.equal(String(d.filters.merchantId), String(merchantId))
    assert.ok(Array.isArray(d.rows))
  })

  /* ---------- P-06 商品资料一致性校验 ---------- */
  await test('P-06 城市错配/返豆超限被拦截，跨城勾选放行', async () => {
    if (!scenicOther) { console.log('    （库内无异城景区，跳过）'); return }
    const created = await call('POST', '/admin/entities/product', { values: {
      title: stamp + '一致性校验线路', cat: 'script', city_code: prod.city_code, price_from: 100,
      merchant_id: merchantId, intro: '<p>' + stamp + ' 介绍</p>',
    } }, superTok)
    assert.equal(created.code, 0, '合规商品可保存：' + (created.msg || ''))
    const pid = created.data.id
    // 错配：景区在另一城市
    const bad = await call('PUT', `/admin/entities/product/${pid}`, { values: { scenic_id: scenicOther.id } }, superTok)
    assert.equal(bad.code, 1001, '跨城未勾选被拦截')
    assert.ok(bad.data?.fieldErrors?.city_code || (bad.msg || '').includes('跨城'), '错误定位到城市字段')
    // 勾选跨城后放行
    const good = await call('PUT', `/admin/entities/product/${pid}`, { values: { scenic_id: scenicOther.id, cross_city: '1' } }, superTok)
    assert.equal(good.code, 0, '勾选「跨城线路」后放行')
    // 返豆超上限（默认 5000bp = 50%）：售价 100 元时赠 6000 豆 = 60%
    const beanBad = await call('PUT', `/admin/entities/product/${pid}`, { values: { bean_gift: 6000 } }, superTok)
    assert.equal(beanBad.code, 1001, '返豆比例超上限被拦截（售价 100 元赠 6000 豆 = 60%）')
    await q('DELETE FROM tour_product WHERE id = ?', [pid])
  })

  /* ---------- P-07 认领超时释放 + 组长转派 ---------- */
  await test('P-07 认领超时自动释放（有效期走参数中心）+ 组长转派带审计', async () => {
    const buyer2 = (await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['dpqa2-' + stamp, stamp + '作者2'])).insertId
    cleanup.users.push(buyer2)
    const note = (await q('INSERT INTO content_note (user_id, title, body, status, related_product_id) VALUES (?,?,?,?,?)',
      [buyer2, stamp + ' 待审', JSON.stringify({ text: '<p>x</p>', images: [] }), 1, prod.id])).insertId
    cleanup.notes.push(note)
    ok(await call('POST', `/admin/review-queue/note/${note}/claim`, {}, aTok('review', 'DPQA-reviewA')))
    // 把认领时间回拨到有效期之外（默认 2 小时）
    await q('UPDATE review_claim SET created_at = NOW() - INTERVAL 3 HOUR WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['note', note])
    const n = await tickClaimTimeout()
    assert.ok(n >= 1, '超时认领被释放')
    const row = await one('SELECT released_at FROM review_claim WHERE queue_kind = ? AND item_id = ? ORDER BY id DESC LIMIT 1', ['note', note])
    assert.ok(row.released_at, 'released_at 已置')
    const aud = await one("SELECT id FROM audit_log WHERE module = 'review' AND action = 'claim-timeout-release' AND biz_ref = ?", ['note-' + note])
    assert.ok(aud, '释放写审计')
    // 转派：A 认领 → 转给 B（自建一个真实 review 账号作为被转派人）
    ok(await call('POST', `/admin/review-queue/note/${note}/claim`, {}, aTok('review', 'DPQA-reviewA')))
    const target = (await q(`INSERT INTO admin_user (username, display_name, password_hash, role, status, token_epoch) VALUES (?,?,?, 'review', 1, 1)`,
      ['dprev-' + stamp, 'dprev-' + stamp, 'x'])).insertId
    cleanup.admins.push(target)
    const t2 = await call('POST', `/admin/review-queue/note/${note}/reassign`, { toUid: Number(target) }, aTok('super'))
    // 验收修正：原写法在转派失败（含服务端 9000）时只打印并跳过断言，掩盖了接口查询不存在的 name 列的缺陷
    assert.equal(t2.code, 0, '转派成功：' + t2.code + ' ' + t2.msg)
    const audit2 = await one("SELECT id FROM audit_log WHERE module = 'review' AND action = 'claim-reassign' AND biz_ref = ?", ['note-' + note])
    assert.ok(audit2, '转派写审计')
  })

  /* ---------- X-03 改价留痕与并发 ---------- */
  await test('X-03 团期改价：乐观锁冲突明确拒绝；两端版本簿同一份（merchant/pc）', async () => {
    const sid = session.id
    const cur = await one('SELECT version, price_adult FROM tour_session WHERE id = ?', [sid])
    // 商户端：stale version → 2002 冲突
    const conflict = await call('POST', '/m/supply/' + sid, { action: 'price', value: Number(cur.price_adult) + 100, expectedVersion: Number(cur.version) + 5 }, mTok)
    assert.equal(conflict.code, 2002, '并发冲突明确提示（不静默覆盖）')
    // 正确 version → 成功 + 版本簿 source=merchant
    const fine = await call('POST', '/m/supply/' + sid, { action: 'price', value: Number(cur.price_adult) + 100, expectedVersion: Number(cur.version) }, mTok)
    assert.equal(fine.code, 0, '商户端改价成功')
    const mv = await one(`SELECT snapshot FROM master_data_version WHERE kind = 'session' AND ref_id = ? ORDER BY id DESC LIMIT 1`, [sid])
    assert.equal((typeof mv.snapshot === 'string' ? JSON.parse(mv.snapshot) : mv.snapshot).source, 'merchant')
    // PC 编辑器路径改价 → 版本簿 source=pc（同一份历史）
    const pcv = await call('PUT', `/admin/entities/session/${sid}`, { values: { price_adult: (Number(cur.price_adult) + 200) / 100 } }, superTok)
    assert.equal(pcv.code, 0, 'PC 改价成功')
    const pv = await one(`SELECT snapshot FROM master_data_version WHERE kind = 'session' AND ref_id = ? ORDER BY id DESC LIMIT 1`, [sid])
    assert.equal((typeof pv.snapshot === 'string' ? JSON.parse(pv.snapshot) : pv.snapshot).source, 'pc')
    // 还原价格，避免影响其他用例
    await q('UPDATE tour_session SET price_adult = ? WHERE id = ?', [cur.price_adult, sid])
  })

  await test('X-03 补充：名额与早鸟价同样走乐观锁并写入同一份版本簿；批量调名额递增版本并留痕', async () => {
    const sid = session.id
    const parse = (r) => (typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot)
    const lastSnap = async () => parse(await one(`SELECT snapshot FROM master_data_version WHERE kind = 'session' AND ref_id = ? ORDER BY id DESC LIMIT 1`, [sid]))
    const cur = await one('SELECT version, quota, booked, price_adult, early_price, early_days FROM tour_session WHERE id = ?', [sid])
    try {
      const q1 = Number(cur.quota) + 1
      // 名额：过期版本 → 2002；正确版本 → 成功、版本 +1、版本簿记录 quota 的前后值
      const stale = await call('POST', '/m/supply/' + sid, { action: 'adjust_quota', value: q1, expectedVersion: Number(cur.version) + 5 }, mTok)
      assert.equal(stale.code, 2002, '名额并发冲突明确提示')
      ok(await call('POST', '/m/supply/' + sid, { action: 'adjust_quota', value: q1, expectedVersion: Number(cur.version) }, mTok))
      const afterQ = await one('SELECT version, quota FROM tour_session WHERE id = ?', [sid])
      assert.equal(Number(afterQ.version), Number(cur.version) + 1, '改名额后版本 +1')
      assert.equal(Number(afterQ.quota), q1)
      let snap = await lastSnap()
      assert.deepEqual(snap.changedFields, ['quota']); assert.equal(snap.source, 'merchant'); assert.equal(snap.after.quota, q1)
      // 早鸟价：过期版本 → 2002；正确版本 → 成功、版本 +1、版本簿记录早鸟前后值
      const ep = Math.max(1, Math.floor(Number(cur.price_adult) / 2))
      const staleE = await call('POST', '/m/supply/' + sid, { action: 'early', value: { price: ep, days: 3 }, expectedVersion: Number(afterQ.version) + 5 }, mTok)
      assert.equal(staleE.code, 2002, '早鸟价并发冲突明确提示')
      ok(await call('POST', '/m/supply/' + sid, { action: 'early', value: { price: ep, days: 3 }, expectedVersion: Number(afterQ.version) }, mTok))
      const afterE = await one('SELECT version, early_price FROM tour_session WHERE id = ?', [sid])
      assert.equal(Number(afterE.version), Number(afterQ.version) + 1, '改早鸟价后版本 +1')
      snap = await lastSnap()
      assert.deepEqual(snap.changedFields, ['early_price', 'early_days']); assert.equal(snap.after.early_price, ep)
      // 批量调名额：生效、版本 +1、版本簿 source=merchant
      const q2 = q1 + 1
      const batch = ok(await call('POST', '/m/supply/batch', { ids: [sid], action: 'adjust_quota', value: q2 }, mTok))
      assert.equal(batch.applied, 1); assert.deepEqual(batch.conflicts, [])
      const afterB = await one('SELECT version, quota FROM tour_session WHERE id = ?', [sid])
      assert.equal(Number(afterB.version), Number(afterE.version) + 1, '批量调名额后版本 +1')
      assert.equal(Number(afterB.quota), q2)
      snap = await lastSnap()
      assert.deepEqual(snap.changedFields, ['quota']); assert.equal(snap.source, 'merchant')
    } finally {
      await q('UPDATE tour_session SET quota = ?, early_price = ?, early_days = ?, version = ? WHERE id = ?',
        [cur.quota, cur.early_price, cur.early_days, cur.version, sid])
    }
  })

  /* ---------- X-04 评价闭环 ---------- */
  await test('X-04 评价→商户回复→平台审核→游客可见→下架即消失', async () => {
    const o50 = await mkOrder(50)
    const rv = (await q('INSERT INTO review (order_id, user_id, product_id, rating, content) VALUES (?,?,?,?,?)',
      [o50.id, tourist.user.id, prod.id, 5, stamp + ' 很棒的行程，讲解细致'])).insertId
    cleanup.reviews.push(rv)
    // 商户端列表可见（本店）
    const list = ok(await call('GET', '/m/reviews?page=1&pageSize=20', null, mTok))
    const item = list.items.find((r) => Number(r.id) === rv)
    assert.ok(item, '商户端评价列表含本单')
    // 商户回复 → 待审（游客不可见）
    ok(await call('POST', `/m/reviews/${rv}/reply`, { content: stamp + ' 感谢您的好评，欢迎再来' }, mTok))
    let pub = ok(await call('GET', '/c/tours/' + prod.id + '/reviews'))
    assert.ok(!pub.list.some((r) => r.reply), '待审回复不下发给游客')
    // 平台审核通过 → 游客可见；下架 → 两端消失
    ok(await call('POST', `/admin/reviews/${rv}/reply-verdict`, { show: true }, aTok('review')))
    pub = ok(await call('GET', '/c/tours/' + prod.id + '/reviews'))
    assert.ok(pub.list.some((r) => r.reply && r.reply.includes('感谢')), '审核通过后游客可见')
    const detail = ok(await call('GET', '/c/orders/' + o50.order_no, null, cTok))
    assert.ok(detail.myReview && detail.myReview.reply, '订单详情「我的评价」带商家回复')
    ok(await call('POST', `/admin/reviews/${rv}/reply-verdict`, { show: false }, aTok('review')))
    pub = ok(await call('GET', '/c/tours/' + prod.id + '/reviews'))
    assert.ok(!pub.list.some((r) => r.reply), 'PC 下架后两端同步消失')
    // 商户筛选：pending（待回复/被下架）
    const pend = ok(await call('GET', '/m/reviews?page=1&pageSize=20&replyStatus=pending', null, mTok))
    assert.ok(pend.items.some((r) => Number(r.id) === rv), '被下架后回到「待回复/被下架」筛选')
    // 验收补充：筛选条件必须与「只看本店」同时成立（OR 未加括号会把别家被下架回复的评价串进来）
    const other = await one(`SELECT o.id oid, o.user_id uid, o.product_id pid FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE p.merchant_id <> ? AND NOT EXISTS (SELECT 1 FROM review r WHERE r.order_id = o.id) LIMIT 1`, [merchantId])
    if (other) {
      const orv = (await q('INSERT INTO review (order_id, user_id, product_id, rating, content, reply, reply_status) VALUES (?,?,?,?,?,?,2)',
        [other.oid, other.uid, other.pid, 4, stamp + ' 他店评价', stamp + ' 他店被下架回复'])).insertId
      cleanup.reviews.push(orv)
      for (const rs of ['pending', 'replied', 'all']) {
        const lst = ok(await call('GET', '/m/reviews?page=1&pageSize=100&replyStatus=' + rs, null, mTok))
        assert.ok(!lst.items.some((r) => Number(r.id) === orv), `replyStatus=${rs} 不得出现他店评价`)
      }
    }
  })


  /* ---------- B-05 游客笔记（商户端只读） ---------- */
  await test('B-05 游客笔记：仅本店商品关联的已发布公开稿可见（五种夹具隔绝）', async () => {
    const myProd = await one('SELECT id FROM tour_product WHERE merchant_id = ? LIMIT 1', [merchantId])
    const mkNote = async (title, status, visibility, product) => (await q('INSERT INTO content_note (user_id, title, body, status, visibility, related_product_id, published_at) VALUES (?,?,?,?,?,?,NOW(3))',
      [tourist.user.id, stamp + title, JSON.stringify({ text: '正文', cover: '' }), status, visibility, product])).insertId
    const notesMade = []
    notesMade.push(await mkNote('公开稿', 2, 'public', myProd.id))
    notesMade.push(await mkNote('私密稿', 2, 'private', myProd.id))
    notesMade.push(await mkNote('机审中', 0, 'public', myProd.id))
    notesMade.push(await mkNote('人工审核', 1, 'public', myProd.id))
    notesMade.push(await mkNote('驳回稿', 3, 'public', myProd.id))
    notesMade.push(await mkNote('下架稿', 4, 'public', myProd.id))
    cleanup.notes.push(...notesMade)
    const d = ok(await call('GET', '/m/notes?page=1&pageSize=20', null, mTok))
    const titles = d.items.map((x) => x.title)
    assert.ok(titles.some((t) => t.includes('公开稿')), '本店已发布公开稿可见')
    for (const bad of ['私密稿', '机审中', '人工审核', '驳回稿', '下架稿']) {
      assert.ok(!titles.some((t) => t.includes(bad)), bad + ' 不出现在商户笔记列表')
    }
  })


  /* ---------- X-05 消息触达落记录 ---------- */
  await test('X-05 MOCK 支付/退款逐场景落 notify_log，后台可查', async () => {
    const o10 = await mkOrder(10)
    ok(await call('POST', '/admin/dev/mock-pay', { orderNo: o10.order_no }, superTok))
    // 支付成功 → 退款（客服全额退，触发 refund_apply / refund_done）
    ok(await call('POST', '/admin/orders/' + o10.order_no + '/refund', { reason: stamp + ' X-05 退款验证', applyPolicy: false }, superTok))
    const rows = await q(`SELECT DISTINCT scene FROM notify_log WHERE biz_ref = ?`, [o10.order_no])
    const scenes = rows.map((r) => r.scene)
    for (const s of ['pay_ok', 'new_order', 'refund_apply', 'refund_done']) {
      assert.ok(scenes.includes(s), '场景 ' + s + ' 有下发记录（未配模板记 skipped 也算）')
    }
    const view = ok(await call('GET', '/admin/notify-logs', null, superTok))
    assert.ok(view.rows.length >= 4 && Array.isArray(view.scenes))
  })
} finally {
  for (const id of cleanup.reviews) await q('DELETE FROM review WHERE id = ?', [id]).catch(() => {})
  for (const id of cleanup.notes) { await q("UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'note' AND item_id = ?", [id]).catch(() => {}) ; await q('DELETE FROM content_note WHERE id = ?', [id]).catch(() => {}) }
  for (const id of cleanup.orders) { await q('DELETE FROM order_event WHERE order_id = (SELECT id FROM (SELECT id FROM orders WHERE id = ?) x)', [id]).catch(() => {}); await q('DELETE FROM notify_log WHERE biz_ref IN (SELECT order_no FROM (SELECT order_no FROM orders WHERE id = ?) x)', [id]).catch(() => {}); await q('DELETE FROM orders WHERE id = ?', [id]).catch(() => {}) }
  for (const id of cleanup.users) await q('DELETE FROM user_account WHERE id = ?', [id]).catch(() => {})
  for (const id of cleanup.admins) await q('DELETE FROM admin_user WHERE id = ?', [id]).catch(() => {})
  console.log(`\ndeep-polish-db: ${passed} 项断言组通过`)
  await closeDb()
}
