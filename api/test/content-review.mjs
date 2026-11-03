// 内容审核端到端：审核员能看到投稿全文/图片并按约稿要求核对；驳回必须写原因且作者可见；审核标准逐条确认后才能通过
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/content-review.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const stamp = Date.now().toString(36)
const C = ok(await call('POST', '/c/auth/login', { code: 'mock-review-' + stamp })).token
const created = { tasks: [], notes: [] }

const BODY_OK = '<p>清晨从放生桥出发，在集合点和领队碰头。</p><p>' + '水乡的石板路很好走，'.repeat(12) + '</p><img src="/uploads/a.png"><img src="/uploads/b.png"><script>alert(1)</script><img src="/uploads/c.png" onerror="alert(2)">'
const BODY_SHORT = '<p>只写了一句话，还剧透结局了。</p>'

try {
  // 约稿：限 2 人、现金加奖 ¥10；必须提及 放生桥/集合点，禁止 剧透结局，≥100 字，≥3 图，两条审核标准
  const task = ok(await call('POST', '/admin/entities/task', { values: { title: '审核测试约稿' + stamp, category: 'note', brief: '写一篇水乡一日游记',
    must_mention: ['放生桥', '集合点'], forbidden: ['剧透结局'], min_words: 100, min_images: 3, review_rules: ['原创', '图片清晰'],
    reward_beans: 50, cash_reward: 10, max_participants: 2 } }, A))
  created.tasks.push(task.id)
  const C2 = ok(await call('POST', '/c/auth/login', { code: 'mock-review2-' + stamp })).token
  const C3 = ok(await call('POST', '/c/auth/login', { code: 'mock-review3-' + stamp })).token
  const entryOf = async (tok) => ok(await call('GET', '/c/tasks', null, tok)).mine.find((x) => x.id === task.id)
  const submitAs = async (tok, body) => {
    const n = ok(await call('POST', '/c/notes', { title: '水乡一日' + stamp, body }, tok)); created.notes.push(n.id)
    ok(await call('POST', `/c/tasks/${task.id}/submit`, { noteId: n.id }, tok)); return n.id
  }

  console.log('== 多人参与 ==')
  await t('名额 2：两人可领取，第三人提示名额已满且列表不再出现；同一人不能重复领取', async () => {
    ok(await call('POST', `/c/tasks/${task.id}/claim`, {}, C))
    ok(await call('POST', `/c/tasks/${task.id}/claim`, {}, C2))
    let r = await call('POST', `/c/tasks/${task.id}/claim`, {}, C3); assert.equal(r.code, 2002); assert.match(r.msg, /名额已满/)
    r = await call('POST', `/c/tasks/${task.id}/claim`, {}, C); assert.equal(r.code, 2002); assert.match(r.msg, /已领取/)
    assert.ok(!ok(await call('GET', '/c/tasks', null, C3)).open.some((x) => x.id === task.id))
    assert.equal(ok(await call('GET', `/c/tasks/${task.id}`, null, C3)).full, true)
  })
  await t('名额不能调到比已领取人数还少', async () => {
    const r = await call('PUT', `/admin/entities/task/${task.id}`, { values: { max_participants: 1 } }, A)
    assert.equal(r.code, 1001); assert.ok(r.data.fieldErrors.max_participants)
  })

  console.log('== 约稿投稿审核 ==')
  const bad = await submitAs(C, BODY_SHORT)
  const e1 = (await entryOf(C)).entry_id
  await t('审核材料包含投稿全文、图片数、字数，并按要求逐项自动核对', async () => {
    const p = ok(await call('GET', `/admin/task-entries/${e1}/review`, null, A))
    assert.equal(p.submission.id, bad); assert.match(p.submission.text, /只写了一句话/)
    const by = Object.fromEntries(p.checks.map((c) => [c.key, c.ok]))
    assert.equal(by.words, false); assert.equal(by.images, false)
    assert.equal(by['must:放生桥'], false); assert.equal(by['ban:剧透结局'], false); assert.equal(by.published, true)
    assert.deepEqual(p.requirements.review_rules, ['原创', '图片清晰'])
  })
  await t('驳回必须写原因；原因不能含小程序禁用词', async () => {
    let r = await call('POST', `/admin/task-entries/${e1}/verdict`, { pass: false, reason: '' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /驳回原因/)
    r = await call('POST', `/admin/task-entries/${e1}/verdict`, { pass: false, reason: '请补充上链存证说明' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /不能出现/)
  })
  await t('驳回后退回创作中，作者在小程序看到原因，审核记录保留原投稿', async () => {
    ok(await call('POST', `/admin/task-entries/${e1}/verdict`, { pass: false, reason: '字数和图片不够，并且剧透了结局，请修改后重新提交' }, A))
    const row = await one('SELECT status, note_id FROM content_task_entry WHERE id = ?', [e1])
    assert.equal(Number(row.status), 1); assert.equal(row.note_id, null)
    assert.match((await entryOf(C)).rejectReason, /字数和图片不够/)
    assert.match(ok(await call('GET', `/c/tasks/${task.id}`, null, C)).rejectReason, /剧透/)
    const h = await one('SELECT note_id, verdict, reviewer FROM content_task_review WHERE entry_id = ? ORDER BY id DESC LIMIT 1', [e1])
    assert.equal(Number(h.note_id), bad); assert.equal(Number(h.verdict), 0); assert.match(h.reviewer, /^admin:/)
  })
  const good = await submitAs(C, BODY_OK)
  await t('重新投稿：自动核对全部通过；正文已清洗（脚本与事件属性被去掉）', async () => {
    const p = ok(await call('GET', `/admin/task-entries/${e1}/review`, null, A))
    assert.equal(p.submission.id, good)
    assert.ok(p.checks.every((c) => c.ok), JSON.stringify(p.checks.filter((c) => !c.ok)))
    assert.equal(p.submission.imageCount, 3)
    assert.ok(!/<script|onerror/i.test(p.submission.html))
    assert.equal(p.history.length, 1)
    assert.equal((await entryOf(C)).rejectReason, null)
  })
  await t('审核标准未逐条确认不能通过；确认后通过、发放旅豆、现金进入待打款', async () => {
    let r = await call('POST', `/admin/task-entries/${e1}/verdict`, { pass: true, rules: [true, false] }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /逐条确认/)
    r = ok(await call('POST', `/admin/task-entries/${e1}/verdict`, { pass: true, rules: [true, true], reason: '图文俱佳' }, A))
    assert.equal(r.rewarded, 50); assert.equal(r.cashReward, 1000)
    const e = await one('SELECT status, reward_beans, cash_reward, cash_status FROM content_task_entry WHERE id = ?', [e1])
    assert.deepEqual([Number(e.status), Number(e.reward_beans), Number(e.cash_reward), Number(e.cash_status)], [3, 50, 1000, 1])
    const hist = await q('SELECT verdict FROM content_task_review WHERE entry_id = ? ORDER BY id', [e1])
    assert.deepEqual(hist.map((h) => Number(h.verdict)), [0, 1])
  })
  await t('第二位参与者独立投稿、独立通过', async () => {
    await submitAs(C2, BODY_OK)
    const e2 = (await entryOf(C2)).entry_id
    ok(await call('POST', `/admin/task-entries/${e2}/verdict`, { pass: true, rules: [true, true] }, A))
    const rows = ok(await call('GET', `/admin/content-tasks/${task.id}/entries`, null, A))
    assert.deepEqual(rows.map((x) => Number(x.status)).sort(), [3, 3])
    const lt = ok(await call('GET', '/admin/content-tasks', null, A)).find((x) => x.id === task.id)
    assert.equal(Number(lt.passed), 2); assert.equal(Number(lt.cash_pending), 2)
  })

  console.log('== 现金加奖打款 ==')
  await t('财务登记打款：流水号必填且唯一，不能重复登记', async () => {
    const pending = ok(await call('GET', '/admin/task-cash', null, A)).filter((x) => x.task_id === task.id && Number(x.cash_status) === 1)
    assert.equal(pending.length, 2)
    let r = await call('POST', `/admin/task-entries/${pending[0].id}/cash-paid`, { ref: '' }, A); assert.equal(r.code, 1001)
    const ref = 'PAY' + stamp
    ok(await call('POST', `/admin/task-entries/${pending[0].id}/cash-paid`, { ref }, A))
    r = await call('POST', `/admin/task-entries/${pending[1].id}/cash-paid`, { ref }, A); assert.equal(r.code, 2002); assert.match(r.msg, /已登记/)
    r = await call('POST', `/admin/task-entries/${pending[0].id}/cash-paid`, { ref: ref + 'X' }, A); assert.equal(r.code, 2002)
    const paid = await one('SELECT cash_status, cash_ref FROM content_task_entry WHERE id = ?', [pending[0].id])
    assert.equal(Number(paid.cash_status), 2); assert.equal(paid.cash_ref, ref)
  })
  await t('冻结用户的现金加奖不能登记打款（保持待打款）；解冻后可登记', async () => {
    const left = (await one('SELECT id, user_id FROM content_task_entry WHERE task_id = ? AND cash_status = 1', [task.id]))
    assert.ok(left, '应还剩一笔待打款')
    ok(await call('POST', `/admin/users/${left.user_id}/status`, { status: 0, reason: '测试冻结暂停现金加奖打款' }, A))
    try {
      const r = await call('POST', `/admin/task-entries/${left.id}/cash-paid`, { ref: 'FRZ' + stamp }, A)
      assert.equal(r.code, 6001); assert.match(r.msg, /冻结/)
      assert.equal(Number((await one('SELECT cash_status FROM content_task_entry WHERE id = ?', [left.id])).cash_status), 1, '仍是待打款')
    } finally {
      ok(await call('POST', `/admin/users/${left.user_id}/status`, { status: 1 }, A))
    }
    ok(await call('POST', `/admin/task-entries/${left.id}/cash-paid`, { ref: 'FRZ' + stamp }, A))
  })
  await t('有参与记录的任务不能删除；下线后非参与者看不到，参与者仍可查看', async () => {
    let r = await call('POST', `/admin/content-tasks/${task.id}/delete`, {}, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /不能删除/)
    ok(await call('POST', `/admin/content-tasks/${task.id}/status`, { status: 4 }, A))
    r = await call('GET', `/c/tasks/${task.id}`, null, C3); assert.equal(r.code, 1004)
    assert.equal(ok(await call('GET', `/c/tasks/${task.id}`, null, C)).status, 3)
  })

  console.log('== 笔记审核 ==')
  const uid = (await one('SELECT user_id FROM content_note WHERE id = ?', [good])).user_id
  const pendingId = (await q(`INSERT INTO content_note (user_id, title, body, status, sec_check_id) VALUES (?,?,?,1,'wx-sec')`,
    [uid, '待审笔记' + stamp, JSON.stringify({ text: '<p>加我微信领优惠</p><img src="/uploads/x.png">', images: [] })])).insertId
  created.notes.push(pendingId)
  await t('审核员能看到笔记全文、图片和作者信息', async () => {
    const p = ok(await call('GET', `/admin/content/${pendingId}`, null, A))
    assert.match(p.note.text, /加我微信/); assert.equal(p.note.imageCount, 1); assert.ok(p.author.nickname)
  })
  await t('笔记驳回必须写原因，作者在作品列表看到原因', async () => {
    const r = await call('POST', `/admin/content/${pendingId}/verdict`, { pass: false }, A)
    assert.equal(r.code, 1001)
    ok(await call('POST', `/admin/content/${pendingId}/verdict`, { pass: false, reason: '含站外导流联系方式，请删除后重新发布' }, A))
    const mine = ok(await call('GET', '/c/notes', null, C)).find((n) => n.id === pendingId)
    assert.equal(Number(mine.status), 3); assert.match(mine.reject_reason, /导流/)
    const again = await call('POST', `/admin/content/${pendingId}/verdict`, { pass: true }, A)
    assert.equal(again.code, 2002)
  })
} finally {
  for (const id of created.tasks) { await q('DELETE FROM content_task_review WHERE task_id = ?', [id]); await q('DELETE FROM content_task_entry WHERE task_id = ?', [id]); await q('DELETE FROM content_task WHERE id = ?', [id]) }
  for (const id of created.notes) await q('DELETE FROM content_note WHERE id = ?', [id])
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
