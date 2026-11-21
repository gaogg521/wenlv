// 三端打磨专项（2026-11-16）：A 线路聚合 feed ?product= / 详情 product_status / 正文摘录
// B 商户今日待办 /m/workbench.todos、/m/orders depart 筛选、C-02 /m/supply 分页+批量、
// B3 498,564 小时异常（submitted_at NULL → waitingHours null）、TOP5 品类、C-03 成本覆盖率
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/polish-3end.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const stamp = 'PL' + Date.now().toString(36)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const cLogin = async (tag) => {
  const code = 'mock-' + stamp + '-' + tag
  const r = ok(await call('POST', '/c/auth/login', { code }))
  return { token: r.token, id: Number(r.user.id), code }
}
const C = await cLogin('author')
const R = await cLogin('reader')

// 锚点：景区 / 商品（线路） / 商户
const scenicId = (await q(`INSERT INTO scenic_spot (city_code, name, status) VALUES ('SH','打磨测试景区',1)`)).insertId
const merchantId = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118','打磨测试商户','PL-${stamp}',1)`)).insertId
const pid = (await q(`INSERT INTO tour_product (title, status, cat, merchant_id, scenic_id, price_from, channel, city_code)
  VALUES ('打磨测试线路',1,'script',?,?,'29800','main','310118')`, [merchantId, scenicId])).insertId
const offPid = (await q(`INSERT INTO tour_product (title, status, cat, merchant_id, price_from, channel, city_code)
  VALUES ('打磨下架线路',0,'family',?,'19800','main','310118')`, [merchantId])).insertId
// 店长令牌（merchant_staff 绑定 + /m/auth/login mock code）
const M = await cLogin('boss')
await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,2,1)', [merchantId, M.id])
const mTok = ok(await call('POST', '/m/auth/login', { code: M.code, merchantId: merchantId })).token

async function uploadImage(token) {
  const up = ok(await call('POST', '/c/upload/note-image', { data: PNG, ext: 'png' }, token))
  assert.ok(up.url && up.access, '上传返回 url+access')
  return up
}

await t('A2 线路聚合：feed?product= 只出已发布公开稿，excerpt 下发', async () => {
  const up = await uploadImage(C.token)
  const n = ok(await call('POST', '/c/notes', { title: '打磨线路关联笔记标题', blocks: [{ type: 'text', html: '<p>清晨的朱家角石板路上只有早起的人。</p>' }],
    images: [up.url], topics: ['打磨话题'], visibility: 'public', scenicId, relatedProductId: pid, coverIndex: 0 }, C.token))
  assert.ok(n.id, '笔记创建')
  const sUp = await uploadImage(C.token)
  const sn = ok(await call('POST', '/c/notes', { title: '打磨同景区无线路笔记', blocks: [{ type: 'text', html: '<p>同景区另一篇笔记的正文内容。</p>' }],
    images: [sUp.url], topics: ['打磨话题'], visibility: 'public', scenicId, coverIndex: 0 }, C.token))
  global.__lineNote = n.id
  global.__scenicNote = sn.id
  const feed = ok(await call('GET', '/c/notes/feed?product=' + pid + '&pageSize=10', null, R.token))
  assert.ok(feed.items.some(x => Number(x.id) === Number(n.id)), '线路关联笔记在 feed?product= 中')
  assert.ok(!feed.items.some(x => Number(x.id) === Number(sn.id)), '无线路关联笔记不进线路聚合')
  const hit = feed.items.find(x => Number(x.id) === Number(n.id))
  assert.equal(hit.productTitle, '打磨测试线路')
  assert.ok(hit.excerpt && hit.excerpt.includes('石板路'), '正文摘录下发（文字卡兜底）')
})

await t('A2 门禁回归：私密稿不进 product/scenic 聚合（含历史私密数据）', async () => {
  const up = await uploadImage(C.token)
  const pn = ok(await call('POST', '/c/notes', { title: '打磨私密稿', blocks: [{ type: 'text', html: '<p>私密正文。</p>' }],
    images: [up.url], visibility: 'private', scenicId, relatedProductId: pid, coverIndex: 0 }, C.token))
  for (const qs of ['product=' + pid, 'scenic=' + scenicId]) {
    const feed = ok(await call('GET', '/c/notes/feed?' + qs + '&pageSize=50', null, R.token))
    assert.ok(!feed.items.some(x => Number(x.id) === Number(pn.id)), '私密稿不得进 ' + qs + ' 聚合')
  }
  const others = ok(await call('GET', '/c/notes/feed?product=' + offPid + '&pageSize=10', null, R.token))
  assert.ok(!others.items.some(x => Number(x.id) === Number(global.__lineNote)), '其他线路聚合不含本线路笔记')
})

await t('A2 笔记详情：product_status 随详情下发；下架线路 status=0（前端防死链契约）', async () => {
  const d = ok(await call('GET', '/c/notes/' + global.__lineNote, null, R.token))
  assert.equal(d.product_status, 1, '在架线路 status=1')
  assert.equal(Number(d.scenic_id), Number(scenicId))
  const up = await uploadImage(C.token)
  const off = ok(await call('POST', '/c/notes', { title: '打磨下架线路关联笔记', blocks: [{ type: 'text', html: '<p>下架线路笔记正文。</p>' }],
    images: [up.url], visibility: 'public', relatedProductId: offPid, coverIndex: 0 }, C.token))
  const d2 = ok(await call('GET', '/c/notes/' + off.id, null, R.token))
  assert.equal(d2.product_status, 0, '下架线路 status=0')
})

await t('B2 工作台今日待办：todos 四项数值 + orders depart 筛选与非法值拒绝', async () => {
  const wb = ok(await call('GET', '/m/workbench?from=2026-11-01&to=2026-11-16', null, mTok))
  assert.ok(wb.todos, 'todos 结构下发')
  for (const k of ['arrivals', 'verify', 'closing', 'abnormal']) assert.ok(Number.isFinite(Number(wb.todos[k])), 'todos.' + k + ' 数值')
  const list = ok(await call('GET', '/m/orders?state=waiting&depart=2026-11-16&page=1&pageSize=10', null, mTok))
  assert.ok(Array.isArray(list))
  const bad = await call('GET', '/m/orders?depart=bad-date', null, mTok)
  assert.equal(bad.code, 1001, '非法 depart 日期 1001')
})

await t('C-02 库存服务端分页：paged=1 分页对象；from/status 过滤；旧形态数组保持；批量生效数', async () => {
  const mk = (date, quota, booked, price) => q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, price_adult, status) VALUES (?,?,?,?,?,1)`, [pid, date, quota, booked, price])
  const s1 = (await mk('2026-12-01', 10, 8, '29800')).insertId   // 余量 2 = 紧张
  const s2 = (await mk('2027-01-15', 20, 2, '39800')).insertId
  await q('UPDATE tour_session SET early_price = 39800, early_days = 7 WHERE id = ?', [s2])
  const s3 = (await mk('2025-01-01', 10, 1, '19800')).insertId   // 历史
  const paged = ok(await call('GET', '/m/supply?paged=1&page=1&pageSize=60&from=2026-11-01&kw=打磨', null, mTok))
  assert.ok(paged.items && typeof paged.total === 'number', '分页对象结构')
  assert.ok(paged.items.every(x => String(x.depart_date).slice(0, 10) >= '2026-11-01'), '日期窗过滤生效')
  const tight = ok(await call('GET', '/m/supply?paged=1&from=2026-11-01&status=tight', null, mTok))
  assert.ok(tight.items.some(x => Number(x.id) === Number(s1)), '余量紧张团期在 tight 过滤中')
  assert.ok(!tight.items.some(x => Number(x.id) === Number(s2)), '余量充足团期不在 tight 过滤中')
  const legacy = ok(await call('GET', '/m/supply?history=1', null, mTok))
  assert.ok(Array.isArray(legacy), '不带 paged 保持数组形态（旧调用兼容）')
  // V94 批量改价改申请制：s1 无早鸟正常受理；s2 早鸟 39800 > 新价 28800（早鸟必须低于原价）正确跳过
  const batch = ok(await call('POST', '/m/supply/batch', { ids: [s1, s2], action: 'price', value: '28800' }, mTok))
  assert.equal(batch.created, 1, '批量改价：合规条目创建申请')
  assert.equal(batch.skipped, 1, '批量改价：与早鸟冲突条目跳过')
  const before = await one('SELECT price_adult FROM tour_session WHERE id=?', [s1])
  assert.equal(Number(before.price_adult), 29800, '审批前保持原价')
  const tok = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const reqs = ok(await call('GET', '/admin/subject-requests?view=approval&status=1&kind=session', null, tok))
  const req = reqs.items.find(x => Number(x.resource_id) === Number(s1))
  assert.ok(req, 's1 的改价申请在待审列表')
  ok(await call('POST', '/admin/subject-requests/' + req.id + '/approve', { confirm: { price: true }, note: 'C-02 回归批准' }, tok))
  const after = await one('SELECT price_adult FROM tour_session WHERE id=?', [s1])
  assert.equal(Number(after.price_adult), 28800)
  const s2Row = await one('SELECT price_adult FROM tour_session WHERE id=?', [s2])
  assert.equal(Number(s2Row.price_adult), 39800, '早鸟冲突条目未被受理')
  const below = ok(await call('POST', '/m/supply/batch', { ids: [s2], action: 'price', value: '100' }, mTok))
  assert.equal(below.created, 0, '低于早鸟价的改价不受理（跳过不报错）')
  // V94:批量停售改申请制——创建申请 → 批准 → 生效
  const stop = ok(await call('POST', '/m/supply/batch', { ids: [s2], action: 'stop_sell' }, mTok))
  assert.equal(stop.created, 1, '批量停售创建申请')
  const stReq = ok(await call('GET', '/admin/subject-requests?view=approval&status=1&kind=session', null, tok))
  const stopReq = stReq.items.find(x => Number(x.resource_id) === Number(s2))
  assert.ok(stopReq, '停售申请在待审列表')
  ok(await call('POST', '/admin/subject-requests/' + stopReq.id + '/approve', { confirm: { status: true }, note: 'C-02 停售批准' }, tok))
  const st2 = await one('SELECT status FROM tour_session WHERE id=?', [s2])
  assert.equal(Number(st2.status), 3)
  await q('DELETE FROM tour_session WHERE id IN (?,?,?)', [s1, s2, s3])
})

await t('B3 498,564 小时异常：submitted_at NULL → waitingHours=null 不再按 epoch 0 计算', async () => {
  const tok = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  // 复现根因：status=2 的投稿但 submitted_at 为 NULL（驳回回退历史形态，admin.mjs 驳回分支）
  const task = (await q(`INSERT INTO content_task (task_no, title, brief, status, reward_beans) VALUES ('PL-T-${stamp}','打磨超时复现任务','复现 498,564 小时异常的夹具任务',1,50)`)).insertId
  const eNull = (await q(`INSERT INTO content_task_entry (task_id, user_id, status) VALUES (?,?,2)`, [task, C.id])).insertId
  const d = ok(await call('GET', '/admin/review-queue', null, tok))
  const q2 = d.queues.find(x => x.kind === 'task_entry')
  const hit = q2.items.find(x => Number(x.item_id) === Number(eNull))
  assert.ok(hit, 'NULL submitted_at 投稿在队列中')
  assert.equal(hit.waitingHours, null, 'waitingHours=null（此前 ≈498,564）')
  assert.equal(hit.overdue, false, '不参与超时标红')
  const last = q2.items[q2.items.length - 1]
  assert.equal(Number(last.item_id), Number(eNull), '空值排在 SLA 队尾')
  // 正常时间仍正常计算（另一个真实用户，避开 uk_task_user 冲突）
  const eOk = (await q(`INSERT INTO content_task_entry (task_id, user_id, status, submitted_at) VALUES (?,?,2,NOW(3))`, [task, R.id])).insertId
  const d2 = ok(await call('GET', '/admin/review-queue', null, tok))
  const hit2 = d2.queues.find(x => x.kind === 'task_entry').items.find(x => Number(x.item_id) === Number(eOk))
  assert.ok(hit2.waitingHours != null && hit2.waitingHours < 48, '正常投稿 waitingHours 正常')
  await q('DELETE FROM content_task_entry WHERE id IN (?,?)', [eNull, eOk])
  await q('DELETE FROM content_task WHERE id=?', [task])
})

await t('B3 看板：topTours 带 cat 品类字段；/admin/orders?sort=recent 可用', async () => {
  const tok = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const ins = ok(await call('GET', '/admin/dash/insights?from=2026-11-01&to=2026-11-16', null, tok))
  assert.ok(Array.isArray(ins.topTours), 'topTours 下发')
  for (const r of ins.topTours) assert.ok('cat' in r, '每行带 cat 字段')
  const ord = ok(await call('GET', '/admin/orders?sort=recent', null, tok))
  assert.ok(Array.isArray(ord), 'sort=recent 正常返回')
})

await t('C-03 成本覆盖率：coverage 与 missingProducts 结构；缺成本毛利仍为空值', async () => {
  const tok = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const d = ok(await call('GET', '/admin/economics/dashboard?from=2026-11-01&to=2026-11-16', null, tok))
  assert.ok(d.coverage, 'coverage 结构下发')
  assert.ok('coveredPct' in d.coverage && 'missing' in d.coverage)
  assert.ok(Array.isArray(d.missingProducts), 'missingProducts 下发')
  for (const m of d.missingProducts) assert.ok('title' in m && 'missing' in m, '受影响商品带标题与缺失数')
})

// 清理夹具（隔离库内自清，避免影响后续套件）
await q('DELETE FROM content_note WHERE user_id=? AND title LIKE "打磨%"', [C.id]).catch(() => {})
await q('DELETE FROM tour_product WHERE id IN (?,?)', [pid, offPid]).catch(() => {})
await q('DELETE FROM merchant_staff WHERE merchant_id=?', [merchantId]).catch(() => {})
await q('DELETE FROM merchant WHERE id=?', [merchantId]).catch(() => {})
await q('DELETE FROM scenic_spot WHERE id=?', [scenicId]).catch(() => {})

console.log(`\n三端打磨专项：${pass} 项通过`)
await closeDb()
process.exit(process.exitCode || 0)
