// 主体资源审批 · Codex 退回项 2/3/4 回归(隔离库+服务在跑,与 subject-approval.mjs 同夹具风格)
// 退回项2:三组运营账号按业务范围分别授权/办理/隔离,交叉越权被拒(资源/内容/售后)。
// 退回项3:批准时提交人权限复验——停用账号/字段撤权/归属变更/重点说明缺失,均不得生效。
// 退回项4:小程序商品新增与档案修改走审批流(m/upload/image + /m/subject-requests),审批前游客端不可见。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/subject-approval-rework.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (method, path, body, tok, extraHeaders = {}) => (await fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...extraHeaders },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, '期望成功: ' + (r.msg || JSON.stringify(r).slice(0, 250))); return r.data }
const fail = async (r, code, msgPart) => { assert.equal(r.code, code, '期望失败码 ' + code + ' 实际 ' + r.code + ':' + r.msg); if (msgPart) assert.ok(String(r.msg).includes(msgPart), '文案应含「' + msgPart + '」: ' + r.msg); return r }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
const login = async (username, password) => (await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).json())
const stamp = 'RWK' + Math.random().toString(36).slice(2, 8)

try {
  /* ==================== 夹具 ==================== */
  const supLg = await login('admin', process.env.ADMIN_INIT_PASSWORD || 'admin123')
  assert.equal(supLg.code, 0, '超管登录失败: ' + supLg.msg)
  const supTok = supLg.data.token, supUid = supLg.data.user.uid
  const merchantId = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118', ?, ?, 1)`, [stamp + '商户A', 'RA' + stamp])).insertId
  const merchantB = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118', ?, ?, 1)`, [stamp + '商户B', 'RB' + stamp])).insertId
  const prodA = (await q(`INSERT INTO tour_product (city_code, cat, title, price_from, merchant_id, status) VALUES ('310118','experience',?, 10000, ?, 1)`, [stamp + 'A线路', merchantId])).insertId
  const prodB = (await q(`INSERT INTO tour_product (city_code, cat, title, price_from, merchant_id, status) VALUES ('310118','experience',?, 20000, ?, 1)`, [stamp + 'B线路', merchantB])).insertId
  const depart = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
  let _seq = 0
  const mkSession = async (prod, price = 10000) => { _seq += 1; return (await q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status, version) VALUES (?, DATE_ADD(CURDATE(), INTERVAL 40 + _seq DAY), 10, 0, 1, ?, 1, 1)`.replace('_seq', String(_seq * 3 + Math.floor(Math.random() * 3))), [prod, price])).insertId }
  // 主体方夹具令牌(带 subjectType/subjectId)
  const merTok = jwtSign({ end: 'admin', role: 'merchant_partner', name: '商户A·' + stamp, subjectType: 'merchant', subjectId: merchantId })
  const merBTok = jwtSign({ end: 'admin', role: 'merchant_partner', name: '商户B·' + stamp, subjectType: 'merchant', subjectId: merchantB })
  // 三组真实运营账号(资源/内容/售后)——真实登录(带 uid+ver),退回项2/AC10 口径
  const mkOps = async (tag, displayName) => {
    const cr = ok(await call('POST', '/admin/accounts', { username: stamp + tag, displayName, role: 'ops', password: 'TempPass2026' }, supTok))
    const lg = await login(stamp + tag, 'TempPass2026')
    assert.equal(lg.code, 0, '运营登录失败: ' + lg.msg)
    return { uid: cr.id, tok: lg.data.token, name: displayName, username: stamp + tag }
  }
  const opsRes = await mkOps('res', '资源运营')
  const opsContent = await mkOps('cnt', '内容运营')
  const opsTicket = await mkOps('tkt', '售后运营')
  // 真实商户主体账号(提交人复验用;夹具令牌无 uid 不做提交人复验)
  const mpCr = ok(await call('POST', '/admin/accounts', { username: stamp + 'mpreal', displayName: '商户主体·真实', role: 'merchant_partner', subjectId: String(merchantId), password: 'TempPass2026' }, supTok))
  const mpLg = await login(stamp + 'mpreal', 'TempPass2026')
  assert.equal(mpLg.code, 0)
  const mpReal = mpLg.data.token

  // 授权:动作(subject.approve/note.review)+ 业务范围(scope 行)
  const grantAction = async (uid, action, reason) => ok(await call('POST', '/admin/accounts/' + uid + '/actions', { action, effect: 1, reason }, supTok))
  const grantScope = async (uid, body) => ok(await call('POST', '/admin/accounts/' + uid + '/approver-scope', body, supTok))

  /* ==================== 退回项2:三组职责分别授权+交叉越权 ==================== */
  await test('退回项2 资源运营:scope 内可预审/批准;scope 外列表为空、详情/批准/退回 1003', async () => {
    await grantAction(opsRes.uid, 'subject.approve', '资源职责:审批商户A')
    await grantScope(opsRes.uid, { subjectType: 'merchant', subjectId: String(merchantId), reason: '资源职责范围:商户A' })
    // 重登录(授权变更联动 epoch)
    const relg = await login(opsRes.username, 'TempPass2026')
    assert.equal(relg.code, 0); opsRes.tok = relg.data.token
    // 商户A 提交改价
    const sidA = await mkSession(prodA)
    const rA = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sidA,
      payload: { price_adult: 120 }, impactNote: 'A 调价', expectedVersion: 1, submit: true }, merTok))
    // 商户B 提交改价(苏州,scope 外)
    const sidB = await mkSession(prodB)
    const rB = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sidB,
      payload: { price_adult: 220 }, impactNote: 'B 调价', expectedVersion: 1, submit: true }, merBTok))
    // 范围内:列表可见 A、不可见 B;详情可看
    const list = ok(await call('GET', '/admin/subject-requests?view=approval&status=1', null, opsRes.tok))
    assert.ok(list.items.some((x) => x.req_no === rA.reqNo), '范围内申请应在列表')
    assert.ok(!list.items.some((x) => x.req_no === rB.reqNo), '范围外申请不得出现在列表')
    ok(await call('GET', '/admin/subject-requests/' + rA.id, null, opsRes.tok))
    await fail(await call('GET', '/admin/subject-requests/' + rB.id, null, opsRes.tok), 1003, '范围')
    // 预审:范围内通过、范围外拒绝
    ok(await call('POST', '/admin/subject-requests/' + rA.id + '/preaudit', { note: '资源职责预审' }, opsRes.tok))
    await fail(await call('POST', '/admin/subject-requests/' + rB.id + '/preaudit', { note: '越权预审' }, opsRes.tok), 1003, '范围')
    // 批准:范围内生效;范围外拒绝
    ok(await call('POST', '/admin/subject-requests/' + rA.id + '/approve', { confirm: { price: true }, note: '资源职责批准' }, opsRes.tok))
    await fail(await call('POST', '/admin/subject-requests/' + rB.id + '/approve', { confirm: { price: true } }, opsRes.tok), 1003, '范围')
    const priceA = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sidA])
    assert.equal(Number(priceA.price_adult), 12000, '范围内批准直接生效')
    // 退回:范围外拒绝(再造一个 B 申请)
    const sidB2 = await mkSession(prodB)
    const rB2 = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sidB2,
      payload: { price_adult: 230 }, impactNote: 'B 调价2', expectedVersion: 1, submit: true }, merBTok))
    await fail(await call('POST', '/admin/subject-requests/' + rB2.id + '/reject', { reason: '越权退回' }, opsRes.tok), 1003, '范围')
    // 待审数按范围计
    const sum = ok(await call('GET', '/admin/inbox/summary', null, opsRes.tok))
    assert.equal(sum.pendingApprovals, 0, 'A 的申请已处理完,范围内待审应为 0(B 的不算)')
    await q('DELETE FROM subject_resource_request WHERE id IN (?, ?)', [rB.id, rB2.id])
  })

  await test('退回项2 通知按范围:范围内运营收一 次;范围外运营不收;超管恒收', async () => {
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 130 }, impactNote: '通知范围测试', expectedVersion: 1, submit: true }, merTok))
    const ibRes0 = await call('GET', '/admin/inbox', null, opsRes.tok)
    const ibRes = ibRes0.code === 0 ? ibRes0.data : { items: [] }
    assert.equal(ibRes.items.filter((x) => x.biz_ref === r.reqNo).length, 1, '范围内运营应收一次')
    const ibCnt0 = await call('GET', '/admin/inbox', null, opsContent.tok)
    const ibCnt = ibCnt0.code === 0 ? ibCnt0.data : { items: [] }
    assert.ok(!ibCnt.items.some((x) => x.biz_ref === r.reqNo), '内容运营(无 approve/无范围)不应收到')
    // 范围外运营(售后)也不收:opsTicket 无 approve 动作
    const ibTkt = ok(await call('GET', '/admin/inbox', null, opsTicket.tok))
    assert.ok(!ibTkt.items.some((x) => x.biz_ref === r.reqNo), '售后运营(无 approve)不应收到')
    // 超管恒收
    const ibSup = ok(await call('GET', '/admin/inbox', null, supTok))
    assert.equal(ibSup.items.filter((x) => x.biz_ref === r.reqNo).length, 1, '超管恒收且去重')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/withdraw', {}, merTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  await test('退回项2 内容职责:授予 note.review 后真实办结笔记审核;无 subject.approve 时审批 1003', async () => {
    await grantAction(opsContent.uid, 'note.review', '内容职责:笔记人工审核')
    const relg = await login(opsContent.username, 'TempPass2026')
    assert.equal(relg.code, 0); opsContent.tok = relg.data.token
    // 种一篇文章工待审(人工审核态)
    const uid = (await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['mock-openid-rwk-' + stamp, stamp + '作者'])).insertId
    const noteId = (await q(`INSERT INTO content_note (user_id, related_product_id, title, body, status, visibility, created_at) VALUES (?, ?, ?, ?, 1, 'public', NOW(3))`,
      [uid, prodA, stamp + '笔记', JSON.stringify({ text: '正文', cover: null })])).insertId
    ok(await call('POST', '/admin/content/' + noteId + '/verdict', { pass: true }, opsContent.tok))
    const note = await one('SELECT status FROM content_note WHERE id = ?', [noteId])
    assert.equal(Number(note.status), 2, '内容职责:人工审核通过并发布')
    // 无 subject.approve:审批接口拒绝
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 145 }, impactNote: '内容职责交叉测试', expectedVersion: 1, submit: true }, merTok))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '越权' }, opsContent.tok), 1003)
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/withdraw', {}, merTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  await test('退回项2 售后职责:认领并办结工单;无范围不越审批', async () => {
    // 售后运营已有 ticket.manage(ops 基线);真实完成一次工单闭环
    const uid = (await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['mock-openid-rwkt-' + stamp, stamp + '客'])).insertId
    const tid = (await q(`INSERT INTO aftersales_ticket (ticket_no, order_no, category, source, status, created_by, created_at) VALUES (?, ?, 'complaint', 'admin', 0, 'qa', NOW(3))`,
      ['AS' + stamp, 'RWKORDER' + stamp])).insertId
    ok(await call('POST', '/admin/tickets/' + tid + '/claim', {}, opsTicket.tok))
    ok(await call('POST', '/admin/tickets/' + tid + '/resolve', { note: '售后职责办结:已联系游客并完成退款核对' }, opsTicket.tok))
    const t = await one('SELECT status FROM aftersales_ticket WHERE id = ?', [tid])
    assert.equal(Number(t.status), 3, '售后职责:工单已办结(已解决)')
    // 售后运营无 subject.approve:审批 1003
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 155 }, impactNote: '售后职责交叉测试', expectedVersion: 1, submit: true }, merTok))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '越权' }, opsTicket.tok), 1003)
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/withdraw', {}, merTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
    await q('DELETE FROM aftersales_ticket WHERE id = ?', [tid])
  })

  /* ==================== 退回项3:批准时提交人权限复验 ==================== */
  await test('退回项3 提交人账号停用:PC 主体方停用后申请不能生效', async () => {
    const cr = ok(await call('POST', '/admin/accounts', { username: stamp + 'mpx', displayName: '复验主体方', role: 'merchant_partner', subjectId: String(merchantId), password: 'TempPass2026' }, supTok))
    const lg = await login(stamp + 'mpx', 'TempPass2026')
    assert.equal(lg.code, 0)
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 300 }, impactNote: '停用复验', expectedVersion: 1, submit: true }, lg.data.token))
    // 停用提交人账号
    ok(await call('POST', '/admin/accounts/' + cr.id + '/status', { status: 0, reason: '退回项3:提交人停用复验' }, supTok))
    const f = await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '尝试批准' }, supTok), 1003, '提交人账号已停用')
    const price = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sid])
    assert.equal(Number(price.price_adult), 10000, '不得生效')
    ok(await call('POST', '/admin/accounts/' + cr.id + '/status', { status: 1, reason: '复验完成恢复' }, supTok))
    // 恢复后可正常批准
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '恢复后批准' }, supTok))
    await q('DELETE FROM admin_user WHERE id = ?', [cr.id])
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  await test('退回项3 mini 员工岗位降权:店长提交后降为核销员,批准被拒', async () => {
    const uid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-rwkq-' + stamp, stamp + '店长'])).insertId
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,2,1)', [merchantId, uid])
    const lg = ok(await call('POST', '/m/auth/login', { code: 'rwkq-' + stamp, merchantId }))
    const sid = await mkSession(prodA)
    const sub = ok(await call('POST', '/m/supply/' + sid, { action: 'price', value: 20000, reason: '降权复验' }, lg.token))
    // 降为核销员
    await q('UPDATE merchant_staff SET role = 1 WHERE user_id = ?', [uid])
    const approve = await call('POST', '/admin/subject-requests/' + sub.requestId + '/approve', { confirm: { price: true }, note: '尝试批准' }, supTok)
    assert.equal(approve.code, 1003, '降权后批准应被拒: ' + approve.msg)
    assert.ok(/核销员|岗位/.test(approve.msg), '文案应说明岗位原因: ' + approve.msg)
    const price = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sid])
    assert.equal(Number(price.price_adult), 10000, '不得生效')
    // 恢复店长后可批准
    await q('UPDATE merchant_staff SET role = 2 WHERE user_id = ?', [uid])
    ok(await call('POST', '/admin/subject-requests/' + sub.requestId + '/approve', { confirm: { price: true }, note: '恢复后批准' }, supTok))
    await q('DELETE FROM user_account WHERE id = ?', [uid])
    await q('DELETE FROM subject_resource_request WHERE id = ?', [sub.requestId])
  })

  await test('退回项3 字段授权撤回:提交后收紧 price 字段,批准被拒', async () => {
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 188 }, impactNote: '字段撤权复验', expectedVersion: 1, submit: true }, mpReal))
    // 撤回 trade 字段组(含 price_adult)
    const grant = ok(await call('POST', '/admin/subject-perms', { subjectType: 'merchant', subjectId: String(merchantId),
      channel: 'all', resKind: 'session', action: 'update', fieldGroup: 'trade', effect: 0, reason: '退回项3:撤回价格字段' }, supTok))
    const f = await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '尝试批准' }, supTok), 1003, '未授权')
    const price = await one('SELECT price_adult FROM tour_session WHERE id = ?', [sid])
    assert.equal(Number(price.price_adult), 10000, '不得生效')
    ok(await call('DELETE', '/admin/subject-perms/' + grant.id, null, supTok))
    // 撤权解除后可批准
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '解除后批准' }, supTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  await test('退回项3 资源归属变更:商品换绑其他商户后,原申请批准被拒', async () => {
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 166 }, impactNote: '归属变更复验', expectedVersion: 1, submit: true }, mpReal))
    // 平台把商品换绑到商户B(超管直写)
    ok(await call('PUT', '/admin/entities/product/' + prodA, { values: { merchant_id: merchantB }, expectedVersion: 0 }, supTok))
    const f = await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '尝试批准' }, supTok), 1003, '换绑')
    // 换回后可批准
    ok(await call('PUT', '/admin/entities/product/' + prodA, { values: { merchant_id: merchantId }, expectedVersion: 1 }, supTok))
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '换回后批准' }, supTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  await test('退回项3 重点影响缺审批说明:批准 1001,填写说明后通过', async () => {
    const sid = await mkSession(prodA)
    const r = ok(await call('POST', '/admin/subject-requests', { kind: 'session', action: 'update', resourceId: sid,
      payload: { price_adult: 199 }, impactNote: '说明必填复验', expectedVersion: 1, submit: true }, mpReal))
    await fail(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '' }, supTok), 1001, '审批说明')
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true }, note: '已核对价格依据' }, supTok))
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
  })

  /* ==================== 退回项4:小程序商品新增与档案修改 ==================== */
  await test('退回项4 mini 新增商品:上传图集+草稿+提交,批准前游客端不可见,批准后按值出现', async () => {
    const uid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-rwkp-' + stamp, stamp + '老板'])).insertId
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,3,1)', [merchantId, uid])
    const lg = ok(await call('POST', '/m/auth/login', { code: 'rwkp-' + stamp, merchantId }))
    const tok = lg.token
    // 图片上传
    const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const up = ok(await call('POST', '/m/upload/image', { data: tiny.toString('base64'), ext: 'png' }, tok))
    assert.ok(up.url.startsWith('/uploads/'), '应返回 /uploads/ 地址')
    // 新增商品申请(草稿+提交)
    const r = ok(await call('POST', '/m/subject-requests', { kind: 'product', action: 'create',
      payload: { title: stamp + '小程序新品', cat: 'shop', price_from: 99, intro: '<p>小程序新增介绍</p>', images: [up.url], status: 1, firstStock: 30 },
      note: '小程序端新增', impactNote: '新增商品,无存量订单影响', submit: true }, tok))
    assert.ok(r.reqNo, '应返回申请号')
    // 游客端不可见
    const guest = await (await fetch(base + '/c/tours?cat=shop')).json()
    assert.ok(!JSON.stringify(guest).includes(stamp + '小程序新品'), '批准前游客端不可见')
    // 超管批准(新增无重点影响,说明可选)
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { confirm: { price: true, status: true }, note: '小程序新品批准' }, supTok))
    const prod = await one('SELECT id, status FROM tour_product WHERE title = ?', [stamp + '小程序新品'])
    assert.ok(prod, '批准后商品写入正式表')
    const guest2 = ok(await (await fetch(base + '/c/tours?cat=shop')).json())
    assert.ok(JSON.stringify(guest2).includes(stamp + '小程序新品'), '批准后游客端可见')
    // 核销员提交被拒(店长及以上门槛)
    const vUid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-rwkv-' + stamp, stamp + '核销员'])).insertId
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,1,1)', [merchantId, vUid])
    const vLg = ok(await call('POST', '/m/auth/login', { code: 'rwkv-' + stamp, merchantId }))
    await fail(await call('POST', '/m/subject-requests', { kind: 'product', action: 'create', payload: { title: 'x' }, submit: true }, vLg.token), 1003, '店长及以上')
    // 清理
    await q('DELETE FROM tour_session WHERE product_id = ?', [prod.id])
    await q('DELETE FROM tour_product WHERE id = ?', [prod.id])
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
    await q('DELETE FROM merchant_staff WHERE user_id IN (?, ?)', [uid, vUid])
    await q('DELETE FROM user_account WHERE id IN (?, ?)', [uid, vUid])
  })

  await test('退回项4 mini 档案修改:乐观锁冲突 2002;批准前游客端原文案;批准后新文案', async () => {
    const uid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)', ['mock-openid-rwkm-' + stamp, stamp + '店长2'])).insertId
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,2,1)', [merchantId, uid])
    const lg = ok(await call('POST', '/m/auth/login', { code: 'rwkm-' + stamp, merchantId }))
    const tok = lg.token
    // 读当前档案(白名单口径)
    const cur = ok(await call('GET', '/m/products/' + prodA, null, tok))
    assert.ok(cur.values.title, '应返回白名单字段')
    assert.ok(!('merchant_id' in cur.values) && !('bean_gift' in cur.values), '平台专管字段不下发')
    // 乐观锁:stale expectedVersion → 2002
    await fail(await call('POST', '/m/subject-requests', { kind: 'product', action: 'update', resourceId: prodA,
      payload: { subtitle: '过期提交' }, expectedVersion: Number(cur.version) + 9, submit: true }, tok), 2002)
    const input = { kind: 'product', action: 'update', resourceId: prodA,
      payload: { subtitle: '小程序草稿卖点' }, expectedVersion: Number(cur.version), impactNote: '档案修改,已下单不受影响' }
    const draft = ok(await call('POST', '/m/subject-requests', input, tok))
    const resumed = ok(await call('GET', '/m/subject-requests/' + draft.id, null, tok))
    assert.equal(resumed.payload.subtitle, '小程序草稿卖点')
    const r = ok(await call('PUT', '/m/subject-requests/' + draft.id,
      { ...input, payload: { subtitle: '小程序新卖点' }, submit: true }, tok))
    assert.equal(r.id, draft.id)
    assert.equal(r.status, 1)
    // 审批前游客端保持原文案
    const guest = await (await fetch(base + '/c/tours?kw=' + encodeURIComponent(stamp + 'A线路'))).json()
    assert.ok(!JSON.stringify(guest).includes('小程序新卖点'), '审批前游客端保持原版')
    // 超管批准(subtitle 属 base 组,非重点 → 无需勾选/说明)
    ok(await call('POST', '/admin/subject-requests/' + r.id + '/approve', { note: '档案修改批准' }, supTok))
    const after = ok(await call('GET', '/m/products/' + prodA, null, tok))
    assert.equal(after.values.subtitle, '小程序新卖点', '批准后档案生效')
    await q('DELETE FROM subject_resource_request WHERE id = ?', [r.id])
    await q('DELETE FROM user_account WHERE id = ?', [uid])
  })

  console.log('\n退回项 2/3/4 回归:共 ' + passed + ' 组断言全部通过 ✓')
} finally {
  try { await q('DELETE FROM subject_resource_request WHERE subject_id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q("DELETE FROM platform_inbox WHERE biz_ref LIKE 'SR%'") } catch { /* 忽略 */ }
  try { await q('DELETE FROM subject_approver_scope WHERE uid IN (SELECT id FROM admin_user WHERE username LIKE ?)', [stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM admin_user_action WHERE uid IN (SELECT id FROM admin_user WHERE username LIKE ?)', [stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM admin_user WHERE username LIKE ?', [stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM content_note WHERE user_id IN (SELECT id FROM user_account WHERE mini_a_openid LIKE ?)', ['mock-openid-rwk-' + stamp + '%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM user_account WHERE mini_b_openid LIKE ? OR mini_a_openid LIKE ?', ['mock-openid-rwk%', 'mock-openid-rwk%']) } catch { /* 忽略 */ }
  try { await q('DELETE FROM tour_session WHERE product_id IN (SELECT id FROM tour_product WHERE merchant_id IN (?, ?))', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM tour_product WHERE merchant_id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM merchant WHERE id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  try { await q('DELETE FROM subject_perm_grant WHERE subject_id IN (?, ?)', [merchantId, merchantB]) } catch { /* 忽略 */ }
  await closeDb()
}
