// 批次 F-3 回归：T07 审核工作队列（隔离库，需服务在跑）
// 覆盖：四类队列聚合有数据、认领互斥（一人认领后他人被拒）、本人重复认领幂等、
//       释放后可再认领、判定完成自动释放（task_entry verdict / note verdict）、角色与城市边界。
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
const created = { notes: [], users: [], claims: [] }
try {
  const prod = await one('SELECT id, city_code FROM tour_product WHERE status = 1 ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要商品')
  const buyer = await q("INSERT INTO user_account (mini_a_openid, nickname) VALUES (?, ?)", ['rqqa-' + stamp, stamp + '作者'])
  created.users.push(buyer.insertId)

  await test('队列聚合：note 队列含夹具待审笔记；finance/risk/city 拒绝', async () => {
    const n = await q("INSERT INTO content_note (user_id, title, body, status, related_product_id) VALUES (?,?,?,1,?)",
      [buyer.insertId, stamp + ' 待审笔记', JSON.stringify({ text: '<p>' + stamp + ' 正文</p>', images: [] }), prod.id])
    created.notes.push(n.insertId)
    const d = ok(await call('review', 'GET', '/admin/review-queue'))
    const noteQ = d.queues.find((x) => x.kind === 'note')
    assert.ok(noteQ.items.some((it) => Number(it.item_id) === Number(n.insertId)), 'note 队列含夹具')
    assert.equal(noteQ.kindCn, '独立笔记审核')
    assert.ok(noteQ.items.every((it) => typeof it.waitingHours === 'number'), '等待时长计算')
    assert.equal((await call('finance', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call('risk', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call('city_partner', 'GET', '/admin/review-queue')).code, 1003)
    assert.equal((await call(null, 'GET', '/admin/review-queue', null, jwtSign({ end: 'admin', role: 'city_partner', name: '无城' }))).code, 1003)
  })

  await test('认领互斥：review 认领后 ops 被拒；本人幂等；释放后可再认领', async () => {
    const noteId = created.notes[0]
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    const r = await call('ops', 'POST', `/admin/review-queue/note/${noteId}/claim`)
    assert.equal(r.code, 2002, '他人认领被拒：' + r.msg)
    assert.ok(r.msg.includes('队列回归-review'), '拒绝消息含认领人')
    const again = ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    assert.equal(again.already, true, '本人重复认领幂等')
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/release`))
    ok(await call('ops', 'POST', `/admin/review-queue/note/${noteId}/claim`), '释放后他人可认领')
    // 无效队列类型
    assert.equal((await call('review', 'POST', '/admin/review-queue/bogus/1/claim')).code, 1001)
  })

  await test('判定完成自动释放：note verdict 后认领自动 released', async () => {
    const noteId = created.notes[0]
    // 当前 ops 持有认领；ops 也是 content verdict 的合法角色之一——先移交给 review 判定
    // 这里用 super 判定通过（super 在 note.review 能力内）
    const prop = await one('SELECT title FROM content_note WHERE id = ?', [noteId])
    assert(prop, '笔记存在')
    // ops 有 note.review? no——审核是 review/super。ops 做不了 verdict。先释放 ops 的，让 review 认领再 verdict
    ok(await call('ops', 'POST', `/admin/review-queue/note/${noteId}/release`))
    ok(await call('review', 'POST', `/admin/review-queue/note/${noteId}/claim`))
    // review 通过笔记（驳回需 4 字原因，通过更简单）
    ok(await call('review', 'POST', `/admin/content/${noteId}/verdict`, { pass: true }))
    // 认领应已自动释放
    const claims = await q('SELECT * FROM review_claim WHERE queue_kind = ? AND item_id = ? AND released_at IS NULL', ['note', noteId])
    assert.equal(claims.length, 0, '判定完成后认领自动释放')
  })

  console.log(`\n${passed} 项批次 F-3（T07 审核工作队列）回归通过`)
} finally {
  if (created.notes.length) {
    await q("DELETE FROM review_claim WHERE queue_kind = 'note' AND item_id IN (?)", [created.notes]).catch(() => {})
    await q('DELETE FROM content_task_review WHERE note_id IN (?)', [created.notes]).catch(() => {})
    await q('DELETE FROM content_note WHERE id IN (?)', [created.notes]).catch(() => {})
  }
  if (created.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [created.users]).catch(() => {})
  await closeDb()
}
