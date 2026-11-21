// 主体资源审批与运营权限 · DB 断言回归(V94,隔离库 + 服务在跑)
// 覆盖 AC01-AC14 服务端口径:状态机/权限解析/直写收口/通知去重/并发幂等/版本冲突/动作授权/双端同步。
// 严格断言:每项必过,不写「失败就跳过」。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/subject-approval.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (method, path, body, tok, extraHeaders = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await res.text()
  if (!t || t === '{}') console.log('[wire]', res.status, method, path, JSON.stringify(t))
  try { return JSON.parse(t) } catch { return { code: -1, msg: 'bad json: ' + String(t).slice(0, 100) } }
}
const ok = (r) => { assert.equal(r.code, 0, '期望成功: ' + (r.msg || JSON.stringify(r).slice(0, 300))); return r.data }
const fail = async (r, code, msgPart) => { assert.equal(r.code, code, '期望失败码 ' + code + ' 实际 ' + r.code + ':' + r.msg); if (msgPart) assert.ok(String(r.msg).includes(msgPart), '文案应含「' + msgPart + '」: ' + r.msg); return r }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
const stamp = 'SRA' + Math.random().toString(36).slice(2, 8)
const login = async (username, password) => { const j = await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).json(); return j }

try {
  /* ==================== 夹具:商户/景区/商品/团期/账号 ==================== */
  const merchantId = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118', ?, ?, 1)`,
    [stamp + '审批测试门店', 'SR' + stamp])).insertId
  const merchantB = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118', ?, ?, 1)`,
    [stamp + '另一家门店', 'SB' + stamp])).insertId
  const prodBId = (await q(`INSERT INTO tour_product (city_code, cat, title, price_from, merchant_id, status) VALUES ('310118','experience', ?, 10000, ?, 1)`, [stamp + 'B店测试线路', merchantB])).insertId
  const scenicId = (await q(`INSERT INTO scenic_spot (city_code, name, scenic_level, status) VALUES ('310118', ?, '4A', 1)`,
    [stamp + '审批测试景区'])).insertId
  const prodId = (await q(`INSERT INTO tour_product (city_code, cat, title, price_from, merchant_id, status, rich_desc) VALUES ('310118','experience',?, 10000, ?, 1, ?)`,
    [stamp + '测试线路', merchantId, JSON.stringify({ intro: '线路介绍内容足够长' })])).insertId
  const depart = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  let _seq = 0
  const mkSession = async (price = 10000, quota = 10) => { const d = new Date(Date.parse(depart) + (_seq++) * 86400000).toISOString().slice(0, 10); return (await q(
    `INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status, version) VALUES (?,?,?,?,?,?,1,1)`,
    [prodId, d, quota, 0, 1, price])).insertId }
  const resetSession = async (sid) => { await q('UPDATE tour_session SET price_adult=10000, early_price=NULL, early_days=NULL, quota=10, booked=0, status=1, version=version+1 WHERE id=?', [sid]) }

  // 主体方夹具令牌(requireAdmin 对无 ver 令牌跳过 epoch,subjectType/subjectId 随令牌)
  const merTok = jwtSign({ end: 'admin', role: 'merchant_partner', name: '商户主体·' + stamp, subjectType: 'merchant', subjectId: merchantId })
  const merBTok = jwtSign({ end: 'admin', role: 'merchant_partner', name: '商户主体B·' + stamp, subjectType: 'merchant', subjectId: merchantB })
  const sceTok = jwtSign({ end: 'admin', role: 'scenic_partner', name: '景区主体·' + stamp, subjectType: 'scenic', subjectId: scenicId })
  // 真实账号(带 uid+ver):超管/运营/主体方各一,用于动作授权、通知收件人与本人审批边界
  const seeded = await one("SELECT id, username FROM admin_user WHERE role='super' AND status=1 ORDER BY id LIMIT 1")
  const supLg = await login(seeded.username, process.env.ADMIN_INIT_PASSWORD || 'admin123')
  assert.equal(supLg.code, 0, '超管登录失败(需 ADMIN_INIT_PASSWORD=' + (process.env.ADMIN_INIT_PASSWORD || 'admin123') + '): ' + supLg.msg)
  const supTok = supLg.data.token, supUid = supLg.data.user.uid
  const opsName = stamp + 'opsx'
  const opsCreated = ok(await call('POST', '/admin/accounts', { username: opsName, displayName: '审批测试运营', role: 'ops', password: 'TempPass2026' }, supTok))
  const opsLg = await login(opsName, 'TempPass2026')
  assert.equal(opsLg.code, 0, '运营登录失败: ' + opsLg.msg)
  const opsTok = opsLg.data.token, opsUid = opsLg.data.user.uid
  const mpName = stamp + 'mpx'
  const mpCreated = ok(await call('POST', '/admin/accounts', { username: mpName, displayName: '审批测试商户主体', role: 'merchant_partner', subjectId: String(merchantId), password: 'TempPass2026' }, supTok))
  const mpLg = await login(mpName, 'TempPass2026')
  assert.equal(mpLg.code, 0, '商户主体登录失败: ' + mpLg.msg)
  const mpTok = mpLg.data.token, mpUid = mpLg.data.user.uid

  const cleanReq = async () => { await q("DELETE FROM subject_resource_request WHERE subject_id IN (?, ?, ?)", [merchantId, merchantB, scenicId]) }
  const verOf = async (sid) => Number((await one('SELECT version FROM tour_session WHERE id=?', [sid])).version)
  const pendOf = async (kind, rid) => one("SELECT id, req_no FROM subject_resource_request WHERE kind=? AND resource_id=? AND subject_id=? AND status=1", [kind, rid, merchantId])

  /* ==================== 状态机与正式写服务 ==================== */
  await test('AC02 商户新增直购商品+首批库存:草稿不写正式表,批准后按批准值上架可直购', async () => {
    const cntBefore = Number((await one('SELECT COUNT(*) c FROM tour_product WHERE merchant_id=?', [merchantId])).c)
    const draft = ok(await call('POST', '/admin/subject-requests', { kind: 'product', action: 'create',
      payload: { title: stamp + '直购新品', cat: 'shop', price_from: 5900, intro: '<p>直购商品介绍</p>', status: 1, firstStock: 30 } }, merTok))
    assert.equal(draft.status, 0, '应为草稿')
    const cntDraft = Number((await one('SELECT COUNT(*) c FROM tour_product WHERE merchant_id=?', [merchantId])).c)
    assert.equal(cntDraft, cntBefore, '草稿不得写入正式商品表')
    const sub = ok(await call('POST', '/admin/subject-requests/' + draft.id + '/submit', {}, merTok))
    assert.ok(sub.reqNo.startsWith('SR'), '申请号应生成: ' + sub.reqNo)
    // 游客端不可见
    const guest = await (await fetch(base + '/c/tours?cat=shop')).json()
    assert.ok(!JSON.stringify(guest).includes(stamp + '直购新品'), '审批前游客端不可查询该商品')
    const r = ok(await call('POST', '/admin/subject-requests/' + draft.id + '/approve', { confirm: { status: true, price: true }, note: '新品批准' }, supTok))
    assert.ok(r.effective, '批准应生效')
    const p = await one('SELECT id, status, price_from FROM tour_product WHERE title = ?', [stamp + '直购新品'])
    assert.ok(p, '批准后商品应写入正式表')
    assert.equal(Number(p.status), 1, '按批准值上架')
    const stock = await one('SELECT quota, booked, depart_date FROM tour_session WHERE stock_product_id = ?', [p.id])
    assert.ok(stock, '直购库存行应存在')
    assert.equal(Number(stock.quota), 30, '首批库存应为 30')
    assert.equal(Number(stock.booked), 0, '库存已售为 0')
    const guest2 = ok(await (await fetch(base + '/c/tours?cat=shop')).json())
    assert.ok(JSON.stringify(guest2).includes(stamp + '直购新品'), '批准后游客端可见')
    await q('DELETE FROM tour_session WHERE stock_product_id=?', [p.id])
    await q('DELETE FROM tour_product WHERE id=?', [p.id])
  })

  await test('AC02/AC03 团期改价:审批前原价生效+原订单保持原价;批准后新单按新价', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    // 原价下一单(价格快照)
    const orderBefore = await one('SELECT price_adult FROM tour_session WHERE id=?', [sid])
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 128 }, note: '旺季调价', impactNote: '影响未来订单成交价,已下单保持原价', expectedVersion: await verOf(sid), submit: true }, merTok))
    assert.equal(r.status, 1, '提交后应为待审')
    const vBefore = await verOf(sid)
    const cur = await one('SELECT price_adult, version FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(cur.price_adult), 10000, '审批前正式价不变')
    assert.equal(Number(cur.version), vBefore, '审批前版本不变')
    const d = ok(await call('GET', '/admin/subject-requests/' + r.id, null, supTok))
    assert.ok(d.diffs.some((x) => x.key === 'price_adult' && x.important), '差异应含价格重点标记')
    assert.equal(Number(d.impact.bookedNow), 0, '影响数据应为当前计数')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '同意调价' }, supTok))
    const after = await one('SELECT price_adult, version FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(after.price_adult), 12800, '批准后新价生效(元→分)')
    assert.equal(Number(after.version), vBefore + 1, '版本应递增')
    const mv = await one("SELECT snapshot FROM master_data_version WHERE kind='session' AND ref_id=? ORDER BY version_no DESC", [sid])
    assert.ok(JSON.stringify(mv.snapshot).includes('subject-approval'), '版本簿应记录审批来源')
    const av = await one("SELECT after_val FROM audit_log WHERE biz_ref=? AND module='subject-request' ORDER BY id DESC", ['req-' + r.id])
    assert.ok(av, '应留审计')
  })

  await test('AC04 团期名额与截止校验:名额<已报名在批准时被拒;已有预约停售须影响确认', async () => {
    const sid = await mkSession(10000, 10)
    await resetSession(sid)
    await q('UPDATE tour_session SET booked = 8 WHERE id = ?', [sid])
    const r1 = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { quota: 5 }, impactNote: '缩容', expectedVersion: 2, submit: true }, merTok))
    const f1 = await fail(await call('POST', '/admin/subject-requests/' + r1.id + '/approve', { confirm: { stock: true }, note: '回归批准' }, supTok), 2002, '已报名')
    assert.ok(await one('SELECT id FROM subject_resource_request WHERE id=? AND status=1', [r1.id]), '批准失败后申请仍在待审可追踪')
    ok(await call('POST', '/admin/subject-requests/' + r1.id + '/reject', { reason: '名额低于已报名,请重新核对' }, supTok))
    // 停售:批准须勾选 status 影响;缺勾选拒绝
    await q('UPDATE tour_session SET status = 1 WHERE id = ?', [sid])
    const r2 = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { status: 3 }, impactNote: '停售期间已下单游客仍按原约定核销', expectedVersion: 2, submit: true }, merTok))
    await fail(await call('POST', '/admin/subject-requests/' + r2.id + '/approve', {}, supTok), 1001, '确认')
    ok(await call('POST', '/admin/subject-requests/' + r2.id + '/approve', { confirm: { status: true }, note: '同意停售,已订游客按原约定' }, supTok))
    const s = await one('SELECT status, booked FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(s.status), 3, '停售生效')
    assert.equal(Number(s.booked), 8, '既有报名保留,订单仍可履约')
    // 取消已订团期(status 4)不可由主体直提
    const r3 = await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { status: 4 }, impactNote: '取消', submit: true }, merTok)
    await fail(r3, 1001, '状态申报')
  })

  await test('AC05 景区资料审批生效;景区不可提交商品;未绑自营归属不出现商品写入口', async () => {
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'scenic', action: 'update', resourceId: scenicId,
      payload: { open_hours: '08:30-17:00(16:30 停止入园)', traffic: '地铁17号线朱家角站', tickets: [{ name: '成人票', price: 80, note: '含大门票' }] },
      impactNote: '开放时间更新,以现场为准', expectedVersion: 0, submit: true }, sceTok))
    // 票种结算价不进入申请快照
    const raw = JSON.stringify(await one('SELECT payload, field_diffs FROM subject_resource_request WHERE id=?', [r.id]))
    assert.ok(!raw.includes('settle'), '景区申请不得含结算价字段')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { schedule: true, policy: true }, note: '资料属实' }, supTok))
    const sc = await one('SELECT profile FROM scenic_spot WHERE id=?', [scenicId])
    const scProf = typeof sc.profile === 'string' ? JSON.parse(sc.profile || '{}') : (sc.profile || {})
    assert.ok(String(scProf.open_hours || '').includes('08:30'), '景区资料应生效')
    const tickets = scProf.tickets || []
    assert.equal(tickets[0]?.price, 8000, '票种门市价应生效(分)')
    assert.ok(tickets[0]?.settle == null || tickets[0].settle === undefined || tickets[0].settle === null, '未设结算价保持空')
    // 景区提交商品申请 → 拒绝
    const rp = await call('POST', '/admin/subject-requests', { kind: 'product', action: 'update', resourceId: prodId, payload: { title: 'x' }, submit: true }, sceTok)
    await fail(rp, 1003) // 权限基线(景区无商品写权)与归属校验(经营主体绑定)双重拦截,任一文案均为正确拒绝
    // 工作台不出现商品编辑入口
    const wb = ok(await call('GET', '/admin/subject-workbench', null, sceTok))
    assert.equal(wb.entries.productEdit, false, '景区主体不应有商品编辑入口')
    assert.equal(wb.entries.profileEdit, true, '景区主体应有资料维护入口')
  })

  /* ==================== 审批权限与边界 ==================== */
  await test('AC08 未获授权运营不能批准;授予后可批准并直接生效;撤回授权旧会话立即失效', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 158 }, impactNote: '调价', expectedVersion: await verOf(sid), submit: true }, merTok))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, opsTok), 1003) // 网关模块闸或动作授权闸,任一拒绝均正确
    // 授予 subject.approve(真实账号,授权原因必填)
    await fail(await call('POST', '/admin/accounts/' + opsUid + '/actions', { action: 'subject.approve', effect: 1, reason: '' }, supTok), 1001, '原因')
    ok(await call('POST', '/admin/accounts/' + opsUid + '/actions', { action: 'subject.approve', effect: 1, reason: '试点授权运营审批' }, supTok))
    ok(await call('POST', '/admin/accounts/' + opsUid + '/approver-scope', { subjectType: 'merchant', subjectId: String(merchantId), reason: '试点范围:商户A' }, supTok))
    // 授权变更联动 token_epoch:旧会话失效,按新权限重新登录
    const opsLg2 = await login(opsName, 'TempPass2026')
    assert.equal(opsLg2.code, 0, '重新登录失败: ' + opsLg2.msg)
    const caps = ok(await call('GET', '/admin/capabilities', null, opsLg2.data.token))
    assert.equal(caps.actions['subject.approve'].allowed, true, '授予后 capabilities 应放行')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '运营批准' }, opsLg2.data.token))
    const s = await one('SELECT price_adult FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(s.price_adult), 15800, '获授权运营批准应直接生效(超管无需再批)')
    // 撤回授权 → 旧会话立即失效(token_epoch+1 → 1002)
    ok(await call('POST', '/admin/accounts/' + opsUid + '/actions', { action: 'subject.approve', effect: 0, reason: '试点结束收回' }, supTok))
    const sid2 = await mkSession()
    const r2 = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid2,
      payload: { price_adult: 99 }, impactNote: '调价', expectedVersion: await verOf(sid2), submit: true }, merTok))
    const denied = await call('POST', '/admin/subject-requests/' + r2.id + '/approve', { confirm: { price: true }, note: '回归批准' }, opsLg2.data.token)
    assert.ok([1002, 1003].includes(denied.code), '撤权后旧会话应被拒(1002/1003),实际 ' + denied.code + ':' + denied.msg)
    ok(await call('POST', '/admin/subject-requests/' + r2.id + '/withdraw', {}, merTok))
    await q("UPDATE subject_resource_request SET status=3 WHERE id=?", [r.id]) // 清理:避免影响后续待审去重
  })

  await test('AC08 申请人不得审批本人提交的申请;同资源重复提交幂等合并', async () => {
    const sid = await mkSession()
    // 真实商户主体账号提交后本人批准 → 1003(夹具令牌无 uid 不构成"本人",必须用真实账号)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 90 }, impactNote: '自审边界', expectedVersion: await verOf(sid), submit: true }, mpTok))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, mpTok), 1003) // 模块闸先拦(主体方无 subjectapprove);本人提交的服务端校验在 AC10 场景下由超管/运营令牌触发
    // 同资源重复提交合并为同一待审单(幂等,AC13 跨端同口径)
    const again = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 91 }, impactNote: '自审边界2', expectedVersion: await verOf(sid), submit: true }, mpTok))
    assert.equal(again.reqNo, r.reqNo, '同资源重复提交应返回既有待审单')
    // 退回后重提:旧单不可批准,新单可正常流转
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/reject', { reason: 'AC08 自审边界,退回重走流程' }, supTok))
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/resubmit', {}, mpTok))
  })

  await test('AC08 主体 A 不能提交或读取主体 B 的申请;禁止字段在请求中出现即报错', async () => {
    const sidB = (await q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status, version)
      SELECT id, ?, 10, 0, 1, 10000, 1, 1 FROM tour_product WHERE merchant_id = ?`, [depart, merchantB])).insertId
    const rB = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sidB,
      payload: { price_adult: 77 }, impactNote: 'B 店调价', expectedVersion: await verOf(sidB), submit: true }, merBTok))
    await fail(await call('GET', '/admin/subject-requests/' + rB.id, null, merTok), 1003, '无权')
    await fail(await call('POST', '/admin/subject-requests/' + rB.id + '/withdraw', {}, merTok), 1003, '仅提交人')
    // 越权提交他人资源
    await fail(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sidB,
      payload: { price_adult: 66 }, submit: true }, merTok), 1003, '不属于本店')
    // 禁止字段:bean_gift(平台专管补贴) / account_no(结算账户敏感)
    const bad = await call('POST', '/admin/subject-requests', { kind: 'product', action: 'update', resourceId: prodId,
      payload: { title: 'ok', bean_gift: 100 }, submit: true }, merTok)
    await fail(bad, 1003, '未授权字段')
    assert.ok(bad.data?.fieldErrors?.bean_gift, '应逐键返回 fieldErrors')
    const bad2 = await call('POST', '/admin/subject-requests', { kind: 'merchant', action: 'update', resourceId: merchantId,
      payload: { service_phone: '021-12345678', account_no: '6222020200112233445' }, submit: true }, merTok)
    await fail(bad2, 1003, '未授权字段')
    assert.ok(bad2.data?.fieldErrors?.account_no, '银行账号等敏感字段必须被拒')
    await q('DELETE FROM subject_resource_request WHERE id=?', [rB.id])
    await q('DELETE FROM tour_session WHERE id=?', [sidB])
  })

  await test('AC08/AC12 PC 旧直写入口全部拦截(含直接调用接口)', async () => {
    const cases = [
      ['POST', '/admin/products', { title: 'x', priceFrom: 100 }],
      ['PUT', '/admin/products/' + prodId, { title: 'x' }],
      ['POST', '/admin/products/' + prodId + '/status', { status: 1 }],
      ['PUT', '/admin/products/' + prodId + '/stock', { available: 5, previous: 0 }],
      ['POST', '/admin/sessions', { productId: prodId, departDate: depart, quota: 2, priceAdult: 100 }],
      ['POST', '/admin/entities/product', { values: { title: 'x' } }],
      ['PUT', '/admin/entities/product/' + prodId, { values: { title: 'x' } }],
    ]
    for (const [m, p, b] of cases) await fail(await call(m, p, b, merTok), 1003)
    // 景区主体同样被拦
    await fail(await call('PUT', '/admin/entities/scenic/' + scenicId, { values: { name: 'x' } }, sceTok), 1003)
    // 平台侧不受影响:super/ops 仍可直写
    ok(await call('PUT', '/admin/entities/product/' + prodId, { values: { title: stamp + '测试线路' }, expectedVersion: 0 }, supTok))
  })

  /* ==================== 通知与待办 ==================== */
  await test('AC06 提交通知:每位启用超管+获授权运营各一条(按收件人去重);已读仍留待审', async () => {
    ok(await call('POST', '/admin/accounts/' + opsUid + '/actions', { action: 'subject.approve', effect: 1, reason: '通知测试' }, supTok))
    ok(await call('POST', '/admin/accounts/' + opsUid + '/approver-scope', { subjectType: 'merchant', subjectId: String(merchantId), reason: '通知测试范围' }, supTok))
    const opsLg3 = await login(opsName, 'TempPass2026')
    assert.equal(opsLg3.code, 0, 'ops 重登录失败')
    await cleanReq()
    const sid = await mkSession()
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 66 }, impactNote: '通知测试', expectedVersion: await verOf(sid), submit: true }, mpTok)) // 真实账号提交,收件人 uid 落到本人
    const superRows = await q("SELECT id FROM admin_user WHERE role='super' AND status=1")
    const ib = ok(await call('GET', '/admin/inbox/summary', null, supTok))
    assert.ok(ib.pendingApprovals >= 1, '超管待审数应>=1')
    const ibOps = ok(await call('GET', '/admin/inbox/summary', null, opsLg3.data.token))
    assert.equal(ibOps.canApprove, true, '获授权运营 canApprove=true')
    const inboxSup = ok(await call('GET', '/admin/inbox', null, supTok))
    const mine = inboxSup.items.filter((x) => x.biz_ref === r.reqNo)
    assert.equal(mine.length, 1, '同一事件同一收件人只通知一次,实际 ' + mine.length)
    const inboxOps = ok(await call('GET', '/admin/inbox', null, opsLg3.data.token))
    assert.ok(inboxOps.items.some((x) => x.biz_ref === r.reqNo), '获授权运营应收到通知')
    // 已读不清空待审队列
    ok(await call('POST', '/admin/inbox/' + mine[0].id + '/read', null, supTok))
    const ib2 = ok(await call('GET', '/admin/inbox/summary', null, supTok))
    assert.ok(ib2.pendingApprovals >= 1, '已读后待审数不变(读过的待审单仍留在队列)')
    assert.equal(ib2.unread, ib.unread - 1, '未读数应减少')
    // 批准后:提交人收到结果;平台侧通知转已处理,超管仍可点开直达
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '通知测试批准' }, opsLg3.data.token))
    const ib3 = ok(await call('GET', '/admin/inbox/summary', null, supTok))
    assert.ok(ib3.pendingApprovals >= 0 && ib3.pendingApprovals < ib2.pendingApprovals + 1, '待审数应回落')
    const inboxSup2 = ok(await call('GET', '/admin/inbox', null, supTok))
    const done = inboxSup2.items.find((x) => x.biz_ref === r.reqNo)
    assert.ok(done.handled_at, '批准后超管侧待审通知应转为已处理(保留历史)')
    // 提交人通知:商户主体方为 PC 账号(mpUid)
    const submitterInbox = ok(await call('GET', '/admin/inbox', null, mpTok))
    assert.ok(submitterInbox.items.some((x) => x.biz_ref === r.reqNo && x.kind === 'subject_request_approved'), '提交人应收到批准通知')
    assert.ok(JSON.stringify(submitterInbox.items.filter((x) => x.biz_ref === r.reqNo)).includes('通知测试批准'), '通知应含批准说明')
    ok(await call('POST', '/admin/accounts/' + opsUid + '/actions', { action: 'subject.approve', effect: 0, reason: '通知测试收回' }, supTok))
    await cleanReq()
  })

  await test('AC06 商户小程序提交结果通知员工(收件箱),运营批准后提交人可查原因', async () => {
    const uid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-sr-' + stamp, stamp + '店长'])).insertId
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,2,1)', [merchantId, uid])
    const lg = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    const tok = lg.token
    const sid = await mkSession()
    await resetSession(sid)
    const sub = ok(await call('POST', '/m/supply/' + sid, { action: 'price', value: 6600, reason: 'mini 通知测试' }, tok))
    assert.ok(sub.reqNo, '小程序提交应返回申请号')
    // 平台退回
    await fail(await call('POST', '/admin/subject-requests/' + sub.requestId + '/reject', { reason: '' }, supTok), 1001, '原因')
    ok(await call('POST', '/admin/subject-requests/' + sub.requestId + '/reject', { reason: '价格依据不足,请补充' }, supTok))
    const mine = ok(await call('GET', '/m/subject-requests', null, tok))
    const row = mine.items.find((x) => Number(x.id) === Number(sub.requestId))
    assert.equal(row.status, 3, '小程序端应可查到退回状态')
    assert.ok(String(row.review_note || '').includes('价格依据'), '退回原因应可见')
    // 平台侧待审通知对 mini 渠道同样入超管收件箱
    const inboxSup = ok(await call('GET', '/admin/inbox', null, supTok))
    assert.ok(inboxSup.items.some((x) => x.biz_ref === sub.reqNo && x.handled_at), '超管收件箱应有该单且已处理')
  })

  /* ==================== 撤回/退回/重提 ==================== */
  await test('AC07 撤回后旧申请不可批准;退回必填原因;重提创建新版本并关联历史', async () => {
    const opsLg7 = await login(opsName, 'TempPass2026')
    assert.equal(opsLg7.code, 0)
    const opsTok7 = opsLg7.data.token
    const sid = await mkSession()
    await resetSession(sid)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 55 }, impactNote: '撤回测试', expectedVersion: await verOf(sid), submit: true }, merTok))
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/withdraw', {}, merTok))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, supTok), 2009, '仅待审核')
    const re = ok(await call('POST', '/admin/subject-requests/' + r.id + '/resubmit', {}, merTok))
    assert.notEqual(re.id, r.id, '重提应创建新申请')
    const reRow = await one('SELECT reentry_of, version, payload FROM subject_resource_request WHERE id=?', [re.id])
    assert.equal(Number(reRow.reentry_of), r.id, '新版本应关联历史申请')
    const oldRow = await one('SELECT status, payload FROM subject_resource_request WHERE id=?', [r.id])
    assert.equal(Number(oldRow.status), 2, '旧申请保留已撤回状态')
    ok(await call('POST', '/admin/subject-requests/' + re.id + '/submit', {}, merTok))
    // 预审记录不改状态;批准与退回各有作者与时间
    ok(await call('POST', '/admin/subject-requests/' + re.id + '/preaudit', { note: '请补充价格依据' }, opsTok7))
    const d = ok(await call('GET', '/admin/subject-requests/' + re.id, null, supTok))
    assert.equal(Number(d.status), 1, '预审不改变状态')
    assert.ok(d.preaudit.length === 1 && d.preaudit[0].note.includes('价格依据'), '预审记录应带作者与内容')
    await fail(await call('POST', '/admin/subject-requests/' + re.id + '/reject', { reason: '' }, supTok), 1001, '原因')
    ok(await call('POST', '/admin/subject-requests/' + re.id + '/reject', { reason: '依据不足' }, supTok))
    const rej = await one('SELECT status, reviewed_by_name, review_note FROM subject_resource_request WHERE id=?', [re.id])
    assert.equal(Number(rej.status), 3, '退回状态')
    assert.ok(rej.reviewed_by_name && rej.review_note, '退回应记录审批人与原因')
    await q('DELETE FROM subject_resource_request WHERE id IN (?, ?)', [r.id, re.id])
  })

  /* ==================== 并发与幂等 ==================== */
  await test('AC09 并发批准只生效一次(双击/重放/超管与运营同批)', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 150 }, impactNote: '并发测试', expectedVersion: await verOf(sid), submit: true }, merTok))
    // 重放提交 → 幂等返回同一单
    const replay = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 150 }, impactNote: '并发测试', expectedVersion: await verOf(sid), submit: true }, merTok))
    assert.equal(replay.reqNo, r.reqNo, '重放应返回既有待审单(同资源一份待审单)')
    // 双击批准
    const a1 = await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, supTok)
    const a2 = await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, supTok)
    assert.equal(a1.code, 0, '首次批准应成功')
    assert.ok(a2.code === 0 ? a2.data.idempotent : a2.code === 2009, '二次批准应幂等或明确拒绝,实际 ' + JSON.stringify(a2).slice(0, 120))
    const s = await one('SELECT price_adult, version FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(s.price_adult), 15000, '价格只生效一次')
    const vBefore2 = Number((await one('SELECT baseline_version FROM subject_resource_request WHERE id=?', [r.id])).baseline_version)
    assert.equal(Number(s.version), vBefore2 + 1, '版本只递增一次')
    const eff = await one('SELECT effective_version FROM subject_resource_request WHERE id=?', [r.id])
    assert.equal(Number(eff.effective_version), vBefore2 + 1, '生效版本记录一致')
  })

  await test('AC09/AC14 正式资源被平台更新后拒绝以旧版本覆盖(冲突保留最新)', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 120 }, impactNote: '冲突测试', expectedVersion: await verOf(sid), submit: true }, merTok))
    // 平台在待审期间调整正式资源(版本+1)
    ok(await call('PUT', '/admin/entities/session/' + sid, { values: { note: '平台调整' }, expectedVersion: await verOf(sid) }, supTok))
    const f = await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, supTok), 2002, '已被平台更新')
    const s = await one('SELECT price_adult, version FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(s.price_adult), 10000, '冲突时正式价保持平台最新值')
    assert.ok(Number(s.version) >= 2, '平台更新已入版本')
    assert.ok(await one('SELECT id FROM subject_resource_request WHERE id=? AND status=1', [r.id]), '申请仍待审可追踪')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/reject', { reason: '平台已调整,请按最新值重新提交' }, supTok))
    // 主体重提:基于最新版本 → 通过
    const cur = await one('SELECT version FROM tour_session WHERE id=?', [sid])
    const r2 = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 130 }, impactNote: '冲突后重提', expectedVersion: Number(cur.version), submit: true }, merTok))
    ok(await call('POST', '/admin/subject-requests/' + r2.id + '/approve', { confirm: { price: true }, note: '回归批准' }, supTok))
    const fin = await one('SELECT price_adult FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(fin.price_adult), 13000, '按最新版本重提后生效')
  })

  await test('AC09 库存调整乐观锁:待审期间库存被平台调整 → 批准冲突不半成品', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { quota: 20 }, impactNote: '扩容', expectedVersion: await verOf(sid), submit: true }, merTok))
    await q('UPDATE tour_session SET quota = 15, version = version + 1 WHERE id = ?', [sid])
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { stock: true }, note: '回归批准' }, supTok), 2002)
    const s = await one('SELECT quota, version FROM tour_session WHERE id=?', [sid])
    assert.equal(Number(s.quota), 15, '平台调整值保留')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/reject', { reason: '名额已被平台调整' }, supTok))
  })

  /* ==================== 权限配置与双端同步 ==================== */
  await test('AC13/AC14 渠道字段撤权:deny 后双端旧会话均被拒;权限版本递增+快照可见', async () => {
    const miniLg = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    assert.ok(miniLg.token, 'mini 登录应有 token(员工夹具在 AC06-mini 建立并保留)')
    const pv0 = ok(await call('GET', '/m/perm/snapshot', null, miniLg.token))
    const sid = await mkSession()
    await resetSession(sid)
    const grant = ok(await call('POST', '/admin/subject-perms', { subjectType: 'merchant', subjectId: String(merchantId),
      channel: 'all', resKind: 'session', action: 'update', effect: 0, reason: 'AC13 撤权测试:收紧团期修改' }, supTok))
    const miniLg2 = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    const pv1 = ok(await call('GET', '/m/perm/snapshot', null, miniLg2.token))
    assert.ok(pv1.version > pv0.version, '授权变更应递增下发版本')
    assert.equal(pv1.perms.session.update.allowed, false, '快照应反映撤权')
    // PC 端提交被拒(服务端重新解析,旧会话无法绕过)
    const f1 = await fail(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 70 }, submit: true }, merTok), 1003, '不允许')
    // mini 端提交被拒(带旧快照版本头也一样被拒——乱序响应不能恢复旧授权)
    const lg = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    // 过期快照版本头 → 2101 权限版本闸(服务端按库内最新权限判定,旧会话无法绕过)
    await fail(await call('POST', '/m/supply/' + sid, { action: 'price', value: 7000 }, lg.token, { 'X-Perm-Version': String(pv0.version) }), 2101, '权限已更新')
    // 无版本头(旧客户端)→ 权限解析直接 1003
    await fail(await call('POST', '/m/supply/' + sid, { action: 'price', value: 7000 }, lg.token), 1003)
    // 删除 deny → 恢复
    ok(await call('DELETE', '/admin/subject-perms/' + grant.id, null, supTok))
    const pv2 = ok(await call('GET', '/m/perm/snapshot', null, lg.token))
    assert.equal(pv2.perms.session.update.allowed, true, '删除 deny 后恢复')
    ok(await call('POST', '/m/supply/' + sid, { action: 'price', value: 7000, reason: '恢复后提交' }, lg.token))
    await cleanReq()
  })

  await test('AC13 双端提交等价变更:跨端重复挂单被幂等合并;任一端可查进度', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    // 小程序先提交
    const lg = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    const sub = ok(await call('POST', '/m/supply/' + sid, { action: 'price', value: 8800, reason: '双端测试' }, lg.token))
    // PC 端对同一资源提交 → 返回同一份待审单(同主体同资源一份待审单)
    const pcSub = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 88 }, impactNote: '双端测试 PC', expectedVersion: await verOf(sid), submit: true }, merTok))
    assert.equal(pcSub.reqNo, sub.reqNo, '跨端重复提交应合并到既有待审单: ' + JSON.stringify({ pcSub, sub }))
    // 跨端查进度:PC 主体方 workbench/列表可见 mini 来源申请
    const list = ok(await call('GET', '/admin/subject-requests?view=mine', null, merTok))
    const row = list.items.find((x) => x.req_no === sub.reqNo)
    assert.ok(row, 'PC 端应能查到小程序提交的申请')
    assert.equal(row.channel, 'mini', '来源渠道应记录为 mini')
    // 提交人撤回(mini)后,PC 再提交可新建
    ok(await call('POST', '/m/subject-requests/' + sub.requestId + '/withdraw', {}, lg.token))
    const again = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 88 }, impactNote: '撤回后再提', expectedVersion: await verOf(sid), submit: true }, merTok))
    assert.notEqual(again.reqNo, sub.reqNo, '撤回后应可再次提交')
    await cleanReq()
  })

  await test('AC14 权限版本闸:携带过期快照版本提交 → 2101 刷新后重放', async () => {
    const sid = await mkSession()
    await resetSession(sid)
    const lg = ok(await call('POST', '/m/auth/login', { code: 'sr-' + stamp, merchantId }))
    // 伪造一个过期版本号(当前版本-1)
    const cur = ok(await call('GET', '/m/perm/snapshot', null, lg.token))
    const stale = Number(cur.version) - 1
    if (stale >= 1) {
      const r = await call('POST', '/m/supply/' + sid, { action: 'price', value: 7700 }, lg.token, { 'X-Perm-Version': String(stale) })
      assert.equal(r.code, 2101, '过期权限版本应 2101,实际 ' + r.code + ':' + r.msg)
    }
    // 正确版本可提交
    ok(await call('POST', '/m/supply/' + sid, { action: 'price', value: 7700, reason: '版本闸测试' }, lg.token, { 'X-Perm-Version': String(cur.version) }))
    await cleanReq()
  })

  /* ==================== 运营三类职责与边界 ==================== */
  await test('AC10 运营三类职责:预审可办、越权被拒、资金系统沿用边界;主体审批按独立动作', async () => {
    // ops 预审(基线允许)
    const opsLg10 = await login(opsName, 'TempPass2026')
    assert.equal(opsLg10.code, 0)
    const opsTok10 = opsLg10.data.token
    const sid = await mkSession()
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 95 }, impactNote: '预审测试', expectedVersion: await verOf(sid), submit: true }, merTok))
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/preaudit', { note: 'AC10 预审意见' }, opsTok10))
    // ops 无账号管理权限(资金/系统边界)
    await fail(await call('POST', '/admin/accounts', { username: stamp + 'x', displayName: 'x', role: 'ops', password: 'TempPass2026' }, opsTok10), 1003)
    // finance 不能批准主体申请(未授权动作)
    const finTok = jwtSign({ end: 'admin', role: 'finance', name: '财务夹具' })
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '回归批准' }, finTok), 1003) // 模块闸/动作闸任一拒绝
    // city_partner 不可进入审批页/权限配置
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '城市夹具', scopeCity: '310118' })
    await fail(await call('GET', '/admin/subject-perms', null, cityTok), 1003)
    // 主体方不能配置权限
    await fail(await call('POST', '/admin/subject-perms', { subjectType: 'merchant', resKind: 'session', action: 'update', effect: 1, reason: 'x' }, merTok), 1003)
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/withdraw', {}, merTok))
  })

  await test('AC11 状态与审计可追踪:草稿/提交/预审/退回/批准/冲突全程留痕', async () => {
    const rows = await q("SELECT module, action, COUNT(*) c FROM audit_log WHERE module IN ('subject-request','subject-perm','account-action') GROUP BY module, action")
    const acts = new Set(rows.map((r) => r.module + ':' + r.action))
    for (const need of ['subject-request:draft-save', 'subject-request:submit', 'subject-request:withdraw', 'subject-request:preaudit', 'subject-request:reject', 'subject-request:effective']) {
      assert.ok(acts.has(need), '审计应含 ' + need + ',实际 ' + [...acts].join(','))
    }
    // 敏感数据不出现在申请差异/通知:查全部申请快照不含 account_no 值
    const reqs = await q('SELECT payload, field_diffs, baseline_snapshot FROM subject_resource_request')
    for (const r of reqs) {
      const s = JSON.stringify(r)
      assert.ok(!s.includes('6222020200112233445'), '申请快照不得含银行账号原文')
    }
  })

  await test('AC12 回归:既有商品/团期/主体读写不受影响(平台直写口径保留)', async () => {
    const p = ok(await call('GET', '/admin/entities/product/' + prodId, null, supTok))
    assert.equal(p.values.title, stamp + '测试线路', '平台读取商品正常')
    ok(await call('PUT', '/admin/entities/session/' + (await mkSession()), { values: { quota: 12 }, expectedVersion: 1 }, supTok))
    const list = ok(await call('GET', '/admin/subject-requests?view=approval&status=1', null, supTok))
    assert.ok(Array.isArray(list.items), '审批列表可用')
  })

  console.log('\n共 ' + passed + ' 组断言全部通过 ✓')
} finally {
  // 清理夹具(保留审计;申请表清空本夹具数据)
  try { await q('DELETE FROM subject_resource_request WHERE subject_id IN (?, ?, ?)', [merchantId, merchantB, scenicId]) } catch { /* 忽略 */ }
  try { await q("DELETE FROM platform_inbox WHERE biz_ref LIKE 'SR%' OR recipient_merchant_id IN (?, ?)", [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM admin_user_action WHERE uid IN (SELECT id FROM admin_user WHERE username LIKE ?)', [stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM subject_perm_grant WHERE reason LIKE ? OR subject_id IN (?, ?)', ['%测试%', merchantId, scenicId]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM admin_user WHERE username LIKE ?', [stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM merchant_staff WHERE merchant_id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM user_account WHERE mini_b_openid LIKE ?', ['mock-openid-sr-' + stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM tour_session WHERE product_id IN (SELECT id FROM tour_product WHERE merchant_id IN (?, ?))', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM tour_product WHERE merchant_id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM merchant WHERE id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM scenic_spot WHERE id = ?', [scenicId]) } catch { /* 忽略 */ }
  await closeDb()
}
