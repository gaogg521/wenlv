// 批次 F-3 回归 + 统一台账批次 A 修复回归：T07 审核工作队列（隔离库，需服务在跑）
// 覆盖：四类队列聚合有数据（V-07 独立总量/显示窗口）、认领互斥（一人认领后他人被拒）、本人重复认领幂等、
//       释放后可再认领、判定完成自动释放（task_entry verdict V-06 / note verdict）、
//       V-04 done 兜底已移除、V-05 不存在/已完成/跨城/无判定权拒绝、S-01 下架批量释放、UID 身份（改名后仍可释放）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-reviewqueue.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '队列回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'RQQA' + Math.random().toString(36).slice(2, 10)
const created = { notes: [], users: [], claims: [], tasks: [], entries: [], reports: [] }
try {
  const prod = await one('SELECT id, city_code FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要商品')
  const buyer = await q("INSERT INTO user_account (mini_a_openid, nickname) VALUES (?, ?)", ['rqqa-' + stamp, stamp + '作者'])
  created.users.push(buyer.insertId)
  const mkNote = async (status, title) => (await q('INSERT INTO content_note (user_id, title, body, status, related_product_id) VALUES (?,?,?,?,?)',
    [buyer.insertId, title, JSON.stringify({ text: '<p>' + stamp + ' 正文</p>', images: [] }), status, prod.id])).insertId

  await test('队列聚合：note 队列含夹具待审笔记；finance/risk/city 拒绝', async () => {
    const n = await mkNote(1, stamp + ' 待审笔记')
    created.notes.push(n)
    const d = ok(await call('review', 'GET', '/admin/review-queue'))
    const noteQ = d.queues.find((x) => x.kind === 'note')
    assert.ok(noteQ.items.some((it) => Number(it.item_id) === Number(n)), 'note 队列含夹具')
    assert.equal(noteQ.kindCn, '独立笔记审核')
    assert.ok(noteQ.items.every((it) => typeof it.waitingHours === 'number'), '等待时长计算')
    assert.equal((await call('finance', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call('risk', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call('city_partner', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call(null, 'GET', '/admin/review-queue', null, jwtSign({ end: 'admin', role: 'city_partner', name: '无城' }))).code, 1003)
  })

  await test('V-07：待办总数独立计数，前 20 条是显示窗口', async () => {
    const before = Number((await one("SELECT COUNT(*) n FROM content_note WHERE status IN (0,1)")).n)
    const batch = []
    for (let i = 0; i < 26; i++) batch.push(await mkNote(1, `${stamp} 批量待审-${String(i).padStart(2, '0')}`))
    created.notes.push(...batch)
    const d = ok(await call('review', 'GET', '/admin/review-queue'))
    const noteQ = d.queues.find((x) => x.kind === 'note')
    assert.ok(noteQ.total >= before + 26, 'total 为库内全量计数（' + noteQ.total + '）')
    assert.equal(noteQ.items.length, 20, '返回仍是前 20 条窗口')
    assert.equal(noteQ.truncated, true, '超出窗口明确标记 truncated')
    assert.equal(noteQ.window, 20, '窗口大小字段')
  })

  await test('认领互斥：review 认领后 super 被拒；本人幂等；释放后可再认领；无判定权角色不能认领', async () => {
    const noteId = created.notes[0]
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    const r = await call('super', 'POST', `/admin/review-queue/note/${noteId}/claim`)
    assert.equal(r.code, 2002, '他人认领被拒：' + r.msg)
    assert.ok(r.msg.includes('队列回归-review'), '拒绝消息含认领人')
    const again = ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    assert.equal(again.already, true, '本人重复认领幂等')
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/release`))
    ok(await call('super', 'POST', `/admin/review-queue/note/${noteId}/claim`), '释放后他人可认领')
    ok(await call('super', 'POST', `/admin/review-queue/note/${noteId}/release`))
    // V-05 允许处理范围：无判定权的角色不能认领（note 判定=super/review）
    assert.equal((await call('ops', 'POST', `/admin/review-queue/note/${noteId}/claim`)).code, 1003, 'ops 不能认领笔记审核')
    assert.equal((await call('review', 'POST', '/admin/review-queue/bogus/1/claim')).code, 1001, '无效队列类型')
  })

  await test('V-05：不存在/已不在待审/跨城的待办不能认领', async () => {
    assert.equal((await call('review', 'POST', '/admin/review-queue/note/99999999/claim')).code, 1004, '不存在对象拒绝')
    const done = await mkNote(2, stamp + ' 已发布笔记')
    created.notes.push(done)
    assert.equal((await call('review', 'POST', `/admin/review-queue/note/${done}/claim`)).code, 1004, '已不在待审状态拒绝')
    // 跨城：城市账号（绑定其他城市）不能认领本库（cityA）的举报待办
    const rep = (await q("INSERT INTO content_report (note_id, user_id, city_code, reason) VALUES (?,?,?,'举报理由四个字')", [done, buyer.insertId, prod.city_code])).insertId
    created.reports.push(rep)
    const cityTok = jwtSign({ end: 'admin', role: 'city_partner', name: '队列回归-城市X', scopeCity: '999999' })
    assert.equal((await call(null, 'POST', `/admin/review-queue/report/${rep}/claim`, null, cityTok)).code, 1003, '跨城举报拒绝')
    // 本城城市账号可认领（举报判定含城市合伙人）
    const ownTok = jwtSign({ end: 'admin', role: 'city_partner', name: '队列回归-城市A', scopeCity: String(prod.city_code) })
    const own = ok(await call(null, 'POST', `/admin/review-queue/report/${rep}/claim`, null, ownTok))
    assert.ok(own.claimed, '本城城市账号可认领举报')
    ok(await call(null, 'POST', `/admin/review-queue/report/${rep}/release`, null, ownTok))
  })

  await test('V-04：公开 done 兜底已移除——不能无判定清除他人认领', async () => {
    const noteId = created.notes[0]
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    const r = await call('ops', 'POST', `/admin/review-queue/note/${noteId}/done`)
    assert.equal(r.code, 1004, 'done 接口不存在（404→1004）')
    const claims = await q('SELECT id FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['note', noteId])
    assert.equal(claims.length, 1, '他人待审认领未被清除')
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/release`))
  })

  await test('UID 身份：改名后仍能幂等确认与释放自己的认领；不能以新名字重复占坑', async () => {
    const noteId = created.notes[0]
    const tok1 = jwtSign({ end: 'admin', role: 'review', uid: 80001, name: stamp + '审核改名前' })
    ok(await call(null, 'POST', `/admin/review-queue/note/${noteId}/claim`, null, tok1))
    const again = ok(await call(null, 'POST', `/admin/review-queue/note/${noteId}/claim`, null, jwtSign({ end: 'admin', role: 'review', uid: 80001, name: stamp + '审核改名后' })))
    assert.equal(again.already, true, '同 UID 改名后重复认领幂等')
    const conflict = await call(null, 'POST', `/admin/review-queue/note/${noteId}/claim`, null, tokens.super)
    assert.equal(conflict.code, 2002, '他人仍被拒')
    ok(await call(null, 'POST', `/admin/review-queue/note/${noteId}/release`, null, jwtSign({ end: 'admin', role: 'review', uid: 80001, name: stamp + '审核改名后' })), '同 UID 改名后可释放')
    const active = await q('SELECT id FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['note', noteId])
    assert.equal(active.length, 0, '释放成功')
  })

  await test('判定完成自动释放：note verdict 后认领自动 released', async () => {
    const noteId = created.notes[0]
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    ok(await call('review', 'POST', `/admin/content/${noteId}/verdict`, { pass: true }))
    const claims = await q('SELECT * FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['note', noteId])
    assert.equal(claims.length, 0, '判定完成后认领自动释放')
  })

  await test('V-06：约稿投稿判定（驳回→重投→通过）都在事务内释放认领', async () => {
    const t = (await q("INSERT INTO content_task (task_no,title,brief,product_id,status,reward_beans) VALUES (?,?,?,?,1,100)",
      ['TSK' + stamp, stamp + ' 任务', stamp + ' 任务简介', prod.id])).insertId
    created.tasks.push(t)
    const e = (await q('INSERT INTO content_task_entry (task_id,user_id,status,submitted_at) VALUES (?,?,2,NOW(3))', [t, buyer.insertId])).insertId
    created.entries.push(e)
    // 第一轮：驳回 → 认领释放、投稿回到创作中
    ok(await call('review', 'POST', `/admin/review-queue/task_entry/${e}/claim`))
    ok(await call('review', 'POST', `/admin/task-entries/${e}/verdict`, { pass: false, reason: stamp + ' 驳回原因测试四个字' }))
    assert.equal((await q('SELECT id FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['task_entry', e])).length, 0, '驳回后认领已释放')
    // 作者重投（挂上已发布作品）→ 第二轮通过 → 认领再次释放，无旧占用
    const pubNote = await mkNote(2, stamp + ' 重投作品')
    created.notes.push(pubNote)
    await q('UPDATE content_task_entry SET status=2, submitted_at=NOW(3), note_id=? WHERE id=?', [pubNote, e])
    ok(await call('review', 'POST', `/admin/review-queue/task_entry/${e}/claim`))
    ok(await call('review', 'POST', `/admin/task-entries/${e}/verdict`, { pass: true }))
    assert.equal((await q('SELECT id FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['task_entry', e])).length, 0, '通过后认领已释放（重投无旧占用）')
  })

  await test('S-01：一次下架完成的多条举报认领全部释放；直接下架也释放；无关认领不受影响', async () => {
    const reader2 = (await q("INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)", ['rqqa2-' + stamp, stamp + '读者乙'])).insertId
    created.users.push(reader2)
    // 两举报分别认领 → 通过举报判定下架笔记 → 两个认领都必须释放
    const n1 = await mkNote(2, stamp + ' S01-判定下架')
    created.notes.push(n1)
    const r1 = (await q("INSERT INTO content_report (note_id, user_id, city_code, reason) VALUES (?,?,?,'举报理由一四个字')", [n1, buyer.insertId, prod.city_code])).insertId
    const r2 = (await q("INSERT INTO content_report (note_id, user_id, city_code, reason) VALUES (?,?,?,'举报理由二四个字')", [n1, reader2, prod.city_code])).insertId
    created.reports.push(r1, r2)
    ok(await call('review', 'POST', `/admin/review-queue/report/${r1}/claim`))
    ok(await call('review', 'POST', `/admin/review-queue/report/${r2}/claim`))
    ok(await call('ops', 'POST', `/admin/content-cases/reports/${r2}/verdict`, { action: 'takedown', reason: stamp + ' 下架理由四个字' }))
    const active = await q("SELECT item_id FROM review_claim WHERE queue_kind='report' AND released_at IS NULL AND item_id IN (?)", [[r1, r2]])
    assert.equal(active.length, 0, '判定下架：两条举报认领都释放')
    // 直接下架路径：认领中的举报随笔记下架一并释放
    const n2 = await mkNote(2, stamp + ' S01-直接下架')
    created.notes.push(n2)
    const r3 = (await q("INSERT INTO content_report (note_id, user_id, city_code, reason) VALUES (?,?,?,'举报理由三四个字')", [n2, buyer.insertId, prod.city_code])).insertId
    created.reports.push(r3)
    ok(await call('review', 'POST', `/admin/review-queue/report/${r3}/claim`))
    ok(await call('ops', 'POST', `/admin/content/${n2}/takedown`, { reason: stamp + ' 直接下架理由四个字' }))
    const active2 = await q("SELECT item_id FROM review_claim WHERE queue_kind='report' AND released_at IS NULL AND item_id = ?", [r3])
    assert.equal(active2.length, 0, '直接下架：举报认领已释放')
    // 不会误清仍待审的无关认领
    const n3 = await mkNote(1, stamp + ' S01-无关待审')
    created.notes.push(n3)
    ok(await call('review', 'POST', `/admin/review-queue/note/${n3}/claim`))
    const still = await q("SELECT id FROM review_claim WHERE queue_kind='note' AND item_id = ? AND released_at IS NULL", [n3])
    assert.equal(still.length, 1, '无关待审认领不受影响')
  })

  await test('R-03 批量审批：预检列异常、逐笔结果、角色与并发', async () => {
    // note 批量通过：3 条待审（1 条先被处理制造预检异常）+ ops 无权
    const b1 = await mkNote(1, stamp + ' 批量A1')
    const b2 = await mkNote(1, stamp + ' 批量A2')
    const b3 = await mkNote(2, stamp + ' 已处理不可批量')
    created.notes.push(b1, b2, b3)
    const rb = ok(await call('review', 'POST', '/admin/review-queue/batch-verdict', { kind: 'note', itemIds: [b1, b2, b3, 99999999], action: 'pass' }))
    assert.equal(rb.ok, 2, '两条通过')
    assert.equal(rb.fail, 0)
    assert.equal(rb.precheckFailed.length, 2, '已处理 + 不存在进预检异常清单')
    assert.ok(rb.precheckFailed.some((p) => Number(p.id) === b3 && /待审/.test(p.reason)), '预检异常带原因')
    const statuses = await q('SELECT id, status FROM content_note WHERE id IN (?)', [[b1, b2]])
    assert.ok(statuses.every((s) => Number(s.status) === 2), '批量通过后笔记已发布')
    const claims = await q("SELECT id FROM review_claim WHERE queue_kind='note' AND item_id IN (?) AND released_at IS NULL", [[b1, b2]])
    assert.equal(claims.length, 0, '批量通过释放认领')
    // 角色边界：ops 不能批量通过笔记；report 批量必须有统一意见
    assert.equal((await call('ops', 'POST', '/admin/review-queue/batch-verdict', { kind: 'note', itemIds: [b3], action: 'pass' })).code, 1003)
    const rp = (await q("INSERT INTO content_report (note_id, user_id, city_code, reason) VALUES (?,?,?,'批量举报理由四字')", [b3, buyer.insertId, prod.city_code])).insertId
    created.reports.push(rp)
    assert.equal((await call('ops', 'POST', '/admin/review-queue/batch-verdict', { kind: 'report', itemIds: [rp], action: 'dismiss', reason: '短' })).code, 1001, '意见太短')
    assert.equal((await call('ops', 'POST', '/admin/review-queue/batch-verdict', { kind: 'task_entry', itemIds: [1], action: 'pass' })).code, 1001, '约稿不进批量')
    // report 批量不成立：意见逐笔进审计
    ok(await call('ops', 'POST', '/admin/review-queue/batch-verdict', { kind: 'report', itemIds: [rp], action: 'dismiss', reason: stamp + ' 批量核实为误报' }))
    const rpt = await one('SELECT status, resolution FROM content_report WHERE id = ?', [rp])
    assert.equal(Number(rpt.status), 1, '举报不成立')
    assert.match(rpt.resolution, /批量核实为误报/)
    // 并发：同一批两条并发提交 → 每条待办只成功一次
    const cc1 = await mkNote(1, stamp + ' 并发批量1')
    const cc2 = await mkNote(1, stamp + ' 并发批量2')
    created.notes.push(cc1, cc2)
    const [x, y] = await Promise.all([
      call('review', 'POST', '/admin/review-queue/batch-verdict', { kind: 'note', itemIds: [cc1, cc2], action: 'pass' }),
      call('review', 'POST', '/admin/review-queue/batch-verdict', { kind: 'note', itemIds: [cc1, cc2], action: 'pass' }),
    ])
    const totalOk = (x.data?.ok || 0) + (y.data?.ok || 0)
    assert.equal(totalOk, 2, '并发下每条只成功一次：' + JSON.stringify([x.data?.results, y.data?.results]))
  })

  console.log(`\n${passed} 项审核工作队列（批次 F-3 + 批次 A 修复 + R-03 批量审批）回归通过`)
} finally {
  if (created.notes.length) {
    await q("DELETE FROM review_claim WHERE queue_kind = 'note' AND item_id IN (?)", [created.notes]).catch(() => {})
    await q('DELETE FROM content_task_review WHERE note_id IN (?)', [created.notes]).catch(() => {})
  }
  if (created.entries.length) {
    await q("DELETE FROM review_claim WHERE queue_kind = 'task_entry' AND item_id IN (?)", [created.entries]).catch(() => {})
    await q('DELETE FROM content_task_review WHERE entry_id IN (?)', [created.entries]).catch(() => {})
  }
  if (created.reports.length) await q("DELETE FROM review_claim WHERE queue_kind = 'report' AND item_id IN (?)", [created.reports]).catch(() => {})
  if (created.entries.length) await q('DELETE FROM content_task_entry WHERE id IN (?)', [created.entries]).catch(() => {})
  if (created.tasks.length) await q('DELETE FROM content_task WHERE id IN (?)', [created.tasks]).catch(() => {})
  if (created.reports.length) await q('DELETE FROM content_report WHERE id IN (?)', [created.reports]).catch(() => {})
  if (created.notes.length) await q('DELETE FROM content_note WHERE id IN (?)', [created.notes]).catch(() => {})
  if (created.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [created.users]).catch(() => {})
  await closeDb()
}
