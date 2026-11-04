// 批次 F-1 回归：T12 风险案件闭环（隔离库，需服务在跑）
// 覆盖：建案（事件升级/城市协查/人工）、角色矩阵（risk/super 办理，ops 只读，城市本城）、
//       全状态机（研判→处理→待补材料/待协查→恢复→复核→结案→重开）、复核人≠责任人、
//       结论必填、时间线完整、冻结/解冻引用案件且解冻≠结案、并发结案只一人成功、
//       旧"标记已处理"必须带结论。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-riskcases.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '案件回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'RCQA' + Math.random().toString(36).slice(2, 10)
const created = { cases: [], users: [], events: [] }
try {
  const row = await one('SELECT user_id, city_code FROM orders WHERE status IN (40,50) ORDER BY id DESC LIMIT 1')
  assert(row, '隔离库需要场景订单')
  const cityA = row.city_code
  const uid = row.user_id
  const ev = await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?, 'refund_abuse', 2, ?)", [uid, JSON.stringify({ reason: stamp + ' 退款滥用嫌疑' })])
  created.events.push(ev.insertId)

  await test('建案：事件升级/人工/城市协查；角色与城市边界', async () => {
    assert.equal((await call('ops', 'POST', '/admin/risk-cases', { sourceType: 'manual', title: '运营越权建案', note: '运营越权建案测试说明' })).code, 1003)
    assert.equal((await call('finance', 'POST', '/admin/risk-cases', { sourceType: 'manual', title: '财务越权建案', note: '财务越权建案测试说明' })).code, 1003)
    assert.equal((await call('risk', 'POST', '/admin/risk-cases', { sourceType: 'manual', title: '', note: '标题缺失测试说明' })).code, 1001)
    // 事件升级
    const r1 = ok(await call('risk', 'POST', '/admin/risk-cases', { sourceType: 'risk_event', sourceId: ev.insertId, objectType: 'user', userId: uid, severity: 1, title: stamp + ' 退款滥用处置', note: stamp + ' 多笔退款行为异常，立案核查' }))
    created.cases.push(r1.id)
    const evAfter = await one('SELECT handled FROM risk_event WHERE id = ?', [ev.insertId])
    assert.equal(Number(evAfter.handled), 1, '来源事件标记已处理')
    // 城市协查（本城用户）
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '案件回归-城市A', scopeCity: String(cityA) })
    const r2 = ok(await call(null, 'POST', '/admin/risk-cases', { sourceType: 'city', objectType: 'user', userId: uid, severity: 2, title: stamp + ' 城市协查请求', note: stamp + ' 本城商户反馈该用户核销异常，请协查' }, cityTok))
    created.cases.push(r2.id)
    assert.equal((await call(null, 'POST', '/admin/risk-cases', { sourceType: 'manual', title: '无城建案', note: '无城账号建案测试说明' }, jwtSign({ end: 'admin', role: 'city_partner', name: '无城' }))).code, 1003)
  })

  await test('全状态机：研判→待补材料→恢复→待协查→恢复→复核→结案→重开；复核人≠责任人', async () => {
    const id = created.cases[0]
    const tk = (role, action, body) => call(role, 'POST', `/admin/risk-cases/${id}/${action}`, body)
    assert.equal((await tk('ops', 'judge', { note: '越权研判测试' })).code, 1003, 'ops 无办理权')
    assert.equal((await tk('risk', 'close', { note: '越序结案测试说明' })).code, 2002, '待研判不能直接结案')
    ok(await tk('risk', 'judge', { note: stamp + ' 行为模式核查立案' }))
    ok(await tk('risk', 'need_info', { note: '需商户提供核销底单' }))
    // 城市账号对本城自建案件补充材料（risk 建案的城市取用户最近订单城市，可能非本城）
    ok(await call(null, 'POST', `/admin/risk-cases/${created.cases[1]}/note`, { note: stamp + ' 城市反馈：底单已补交' }, jwtSign({ end: 'admin', role: 'city_partner', name: '案件回归-城市A', scopeCity: String(cityA) })))
    ok(await tk('risk', 'resume', { note: '材料齐全继续处理' }))
    ok(await tk('risk', 'coordinate', { note: '跨城行为需协查' }))
    ok(await tk('risk', 'resume', { note: '协查回函已收到' }))
    // 提交复核的人 = 责任人（risk 自己），结案必须由另一人（super）
    ok(await tk('risk', 'review', { note: stamp + ' 处置完毕提交复核' }))
    assert.equal((await tk('risk', 'close', { note: '自审自结测试说明' })).code, 1003, '复核人不能与责任人相同')
    assert.equal((await tk('super', 'close', { note: '' })).code, 1001, '结案结论必填')
    ok(await tk('super', 'close', { note: stamp + ' 复核通过：证据链完整，同意关单' }))
    const d = ok(await call('risk', 'GET', `/admin/risk-cases/${id}`))
    assert.equal(Number(d.case.status), 5); assert.equal(d.case.reviewer, 'admin:案件回归-super'); assert.equal(d.case.handler, 'admin:案件回归-risk')
    const actions = d.records.map((r) => r.action)
    assert.deepEqual(actions, ['create', 'judge', 'need_info', 'resume', 'coordinate', 'resume', 'review', 'close'], '时间线完整：' + actions.join(','))
    // 重开：回到处理中，结案字段清空
    ok(await tk('super', 'reopen', { note: stamp + ' 新证据出现，重开核查' }))
    const d2 = ok(await call('risk', 'GET', `/admin/risk-cases/${id}`))
    assert.equal(Number(d2.case.status), 1); assert.equal(d2.case.conclusion, null)
  })

  await test('冻结/解冻引用案件写入时间线；解冻≠结案', async () => {
    const id = created.cases[0]
    ok(await call('super', 'POST', `/admin/users/${uid}/status`, { status: 0, reason: stamp + ' 案件处置：暂停资金动作', caseId: id }))
    ok(await call('super', 'POST', `/admin/users/${uid}/status`, { status: 1, reason: '核查完毕恢复', caseId: id }))
    const d = ok(await call('risk', 'GET', `/admin/risk-cases/${id}`))
    const fr = d.records.filter((r) => r.action === 'freeze' || r.action === 'unfreeze')
    assert.equal(fr.length, 2, '冻结+解冻都写入案件时间线')
    assert.ok(fr[0].note.includes('#' + uid), '时间线记录真实处置对象用户ID（V-08）：' + fr[0].note)
    assert.equal(Number(d.case.status), 1, '解冻后案件仍处理中（解冻≠结案）')
    assert.equal(Number((await one('SELECT status FROM user_account WHERE id = ?', [uid])).status), 1, '账号已恢复')
  })

  await test('V-01：责任人按不可变 UID 判定——同 UID 改显示名不能自结案；不同 UID 同名不误拒', async () => {
    const ev = await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?, 'refund_abuse', 2, ?)", [uid, JSON.stringify({ reason: stamp + ' V01' })])
    created.events.push(ev.insertId)
    const c = ok(await call('risk', 'POST', '/admin/risk-cases', { sourceType: 'risk_event', sourceId: ev.insertId, objectType: 'user', userId: uid, title: stamp + ' V01 双人复核', note: stamp + ' 立案研判说明' }))
    created.cases.push(c.id)
    const handlerTok = jwtSign({ end: 'admin', role: 'risk', uid: 90001, name: stamp + 'V01责任人' })
    ok(await call(null, 'POST', `/admin/risk-cases/${c.id}/judge`, { note: stamp + ' 研判受理' }, handlerTok))
    ok(await call(null, 'POST', `/admin/risk-cases/${c.id}/review`, { note: stamp + ' 提交复核' }, handlerTok))
    // 同一 UID（90001）改显示名后重新登录（令牌里 name 变了）→ 仍必须拒绝
    const renamed = await call(null, 'POST', `/admin/risk-cases/${c.id}/close`, { note: stamp + ' 改名后自结案尝试' }, jwtSign({ end: 'admin', role: 'super', uid: 90001, name: stamp + 'V01责任人改名后' }))
    assert.equal(renamed.code, 1003, '同 UID 改显示名仍拒绝：' + renamed.msg)
    // 不同 UID 但与责任人同名 → 不误拒，正常双人复核通过
    const other = ok(await call(null, 'POST', `/admin/risk-cases/${c.id}/close`, { note: stamp + ' 复核通过：证据链完整' }, jwtSign({ end: 'admin', role: 'super', uid: 90002, name: stamp + 'V01责任人' })))
    assert.equal(other.status, 5, '不同 UID 同名复核通过')
    const d = ok(await call('risk', 'GET', `/admin/risk-cases/${c.id}`))
    assert.equal(Number(d.case.reviewer_uid), 90002, '复核人 UID 落库')
    // V-08 负向：未关联用户 / 已关闭案件都不能引用
    const ghost = await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['rcqa-ghost-' + stamp, stamp + '无关用户'])
    created.users.push(ghost.insertId)
    const r1 = await call('super', 'POST', `/admin/users/${ghost.insertId}/status`, { status: 0, reason: stamp + ' 冻结无关用户尝试', caseId: created.cases[1] })
    assert.equal(r1.code, 1003, '未关联当前处置用户拒绝（案件仍开放）：' + r1.msg)
    const r2 = await call('super', 'POST', `/admin/users/${ghost.insertId}/status`, { status: 0, reason: stamp + ' 引用已关闭案件尝试', caseId: c.id })
    assert.equal(r2.code, 2002, '已关闭案件拒绝引用：' + r2.msg)
    await q('DELETE FROM user_account WHERE id = ?', [ghost.insertId])
    created.users.pop()
  })

  await test('V-02/V-03：城市建案统一解析对象——缺字段/冲突字段/objectType 变化均校验真实对象城市；不得借建案处置平台事件', async () => {
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '案件回归-城市A', scopeCity: String(cityA) })
    const cityPost = (body) => call(null, 'POST', '/admin/risk-cases', body, cityTok)
    const title = stamp + ' 城市边界测试'
    const note = stamp + ' 协查说明内容'
    const ghost = await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['rcqa-ghost2-' + stamp, stamp + '无单用户B'])
    created.users.push(ghost.insertId)
    // 缺 objectId、只给 userId 的旧绕过路径：无本城订单用户必须拒绝
    const r1 = await cityPost({ sourceType: 'city', objectType: 'user', userId: ghost.insertId, title, note })
    assert.equal(r1.code, 1003, '无本城订单用户拒绝：' + r1.msg)
    // 冲突字段：objectId=本城用户 + userId=无单用户 → 拒绝
    const r2 = await cityPost({ sourceType: 'city', objectType: 'user', objectId: uid, userId: ghost.insertId, title, note })
    assert.equal(r2.code, 1001, '冲突字段拒绝：' + r2.msg)
    // objectType 变化：userId 给了但对象类型是 other → 拒绝
    const r3 = await cityPost({ sourceType: 'city', objectType: 'other', userId: ghost.insertId, title, note })
    assert.equal(r3.code, 1001, 'objectType 变化拒绝：' + r3.msg)
    // V-03：城市账号借 risk_event 来源建案 → 拒绝且事件 handled 不变
    const ev = await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?, 'verify_replay', 2, ?)", [ghost.insertId, JSON.stringify({ reason: stamp + 'V03T' })])
    created.events.push(ev.insertId)
    const r4 = await cityPost({ sourceType: 'risk_event', sourceId: ev.insertId, objectType: 'other', title, note })
    assert.equal(r4.code, 1001, '城市账号不得用平台来源建案：' + r4.msg)
    assert.equal(Number((await one('SELECT handled FROM risk_event WHERE id = ?', [ev.insertId])).handled), 0, '事件 handled 保持 0')
    // 合法路径：仅给 objectId（本城用户）/ userId 与 objectId 一致 → 建案成功
    const r5 = ok(await cityPost({ sourceType: 'city', objectType: 'user', objectId: uid, title, note }))
    created.cases.push(r5.id)
    const r6 = ok(await cityPost({ sourceType: 'city', objectType: 'user', userId: uid, objectId: uid, title, note }))
    created.cases.push(r6.id)
    // 详情不泄露：构造存量案件（city=本城，user 指向无本城订单账号）→ 城市视角 objectInfo 为空，平台视角可见
    const legacy = await q(`INSERT INTO risk_case (case_no, source_type, object_type, user_id, city_code, severity, title, handler, created_by)
      VALUES (?,?,?,?,?,2,?,?,?)`, ['RCQA' + stamp + 'L', 'city', 'user', ghost.insertId, cityA, stamp + ' 存量越界案件', 'admin:legacy', 'admin:legacy'])
    created.cases.push(legacy.insertId)
    const cityDetail = ok(await call(null, 'GET', `/admin/risk-cases/${legacy.insertId}`, null, cityTok))
    assert.equal(cityDetail.objectInfo, null, '城市视角不泄露无关联账号风险状态')
    const superDetail = ok(await call('super', 'GET', `/admin/risk-cases/${legacy.insertId}`))
    assert.ok(superDetail.objectInfo, '平台视角可见对象信息')
    await q('DELETE FROM user_account WHERE id = ?', [ghost.insertId])
    created.users.pop()
  })

  await test('队列契约与越权；并发结案只一人成功；旧 handle 必须带结论', async () => {
    const list = ok(await call('risk', 'GET', '/admin/risk-cases?status=1'))
    assert.ok(list.rows.every((k) => Number(k.status) === 1) && typeof list.total === 'number')
    assert.equal(list.countsScope, 'city-scope-only')
    assert.equal((await call('review', 'GET', '/admin/risk-cases')).code, 1003, '审核无队列')
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '案件回归-城市A', scopeCity: String(cityA) })
    const cityList = ok(await call(null, 'GET', '/admin/risk-cases', null, cityTok))
    assert.ok(cityList.rows.every((k) => String(k.city_code) === String(cityA)), '城市只看本城案件')
    // 并发结案：复核人（super）与责任人（risk）同时点结案 → 一成功一冲突/拒绝
    const cid = created.cases[1]
    await ok(await call('risk', 'POST', `/admin/risk-cases/${cid}/judge`, { note: stamp + ' 并发结案夹具研判' }))
    ok(await call('risk', 'POST', `/admin/risk-cases/${cid}/review`, { note: stamp + ' 提交复核' }))
    const [a, b] = await Promise.all([
      call('super', 'POST', `/admin/risk-cases/${cid}/close`, { note: stamp + ' 复核结案A' }),
      call('super', 'POST', `/admin/risk-cases/${cid}/close`, { note: stamp + ' 复核结案B' }),
    ])
    const codes = [a.code, b.code].sort()
    assert.deepEqual(codes, [0, 2002], '一结案一冲突：' + JSON.stringify([a.msg, b.msg]))
    // 旧 handle：结论必填 + 越权拒绝
    const ev2 = await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?, 'verify_replay', 3, ?)", [uid, JSON.stringify({ x: stamp })])
    created.events.push(ev2.insertId)
    assert.equal((await call('ops', 'POST', `/admin/risk/${ev2.insertId}/handle`, { reason: 'ops 越权处理测试结论' })).code, 1003, 'ops 无事件处理权（回归批次 A 收紧）')
    assert.equal((await call('risk', 'POST', `/admin/risk/${ev2.insertId}/handle`, { reason: '' })).code, 1001, '结论必填')
    ok(await call('risk', 'POST', `/admin/risk/${ev2.insertId}/handle`, { reason: stamp + ' 复核为误报，标记处理' }))
  })

  console.log(`\n${passed} 项批次 F-1（T12 风险案件闭环）回归通过`)
} finally {
  if (created.cases.length) {
    await q('DELETE FROM risk_case_record WHERE case_id IN (?)', [created.cases])
    await q('DELETE FROM risk_case WHERE id IN (?)', [created.cases])
    await q("DELETE FROM audit_log WHERE module = 'risk-case' AND biz_ref IN (?)", [created.cases.map((x) => 'case-' + x)]).catch(() => {})
  }
  if (created.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [created.users]).catch(() => {})
  if (created.events.length) await q('DELETE FROM risk_event WHERE id IN (?)', [created.events])
  await q("DELETE FROM audit_log WHERE module = 'risk' AND biz_ref LIKE 'risk-event-%'").catch(() => {})
  await closeDb()
}
