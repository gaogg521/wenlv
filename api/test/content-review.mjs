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
  // 约稿：必须提及 放生桥/集合点，禁止 剧透结局，≥100 字，≥3 图，两条审核标准
  const task = ok(await call('POST', '/admin/entities/task', { values: { title: '审核测试约稿' + stamp, category: 'note', brief: '写一篇水乡一日游记',
    must_mention: ['放生桥', '集合点'], forbidden: ['剧透结局'], min_words: 100, min_images: 3, review_rules: ['原创', '图片清晰'], reward_beans: 50 } }, A))
  created.tasks.push(task.id)
  ok(await call('POST', `/c/tasks/${task.id}/claim`, {}, C))
  const submit = async (body) => {
    const n = ok(await call('POST', '/c/notes', { title: '水乡一日' + stamp, body }, C)); created.notes.push(n.id)
    ok(await call('POST', `/c/tasks/${task.id}/submit`, { noteId: n.id }, C)); return n.id
  }

  console.log('== 约稿投稿审核 ==')
  const bad = await submit(BODY_SHORT)
  await t('审核材料包含投稿全文、图片数、字数，并按要求逐项自动核对', async () => {
    const p = ok(await call('GET', `/admin/content-tasks/${task.id}/review`, null, A))
    assert.equal(p.submission.id, bad); assert.match(p.submission.text, /只写了一句话/)
    const by = Object.fromEntries(p.checks.map((c) => [c.key, c.ok]))
    assert.equal(by.words, false); assert.equal(by.images, false)
    assert.equal(by['must:放生桥'], false); assert.equal(by['ban:剧透结局'], false); assert.equal(by.published, true)
    assert.deepEqual(p.requirements.review_rules, ['原创', '图片清晰'])
  })
  await t('驳回必须写原因；原因不能含小程序禁用词', async () => {
    let r = await call('POST', `/admin/content-tasks/${task.id}/verdict`, { pass: false, reason: '' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /驳回原因/)
    r = await call('POST', `/admin/content-tasks/${task.id}/verdict`, { pass: false, reason: '请补充上链存证说明' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /不能出现/)
  })
  await t('驳回后任务退回进行中，作者在小程序看到原因，审核记录保留原投稿', async () => {
    ok(await call('POST', `/admin/content-tasks/${task.id}/verdict`, { pass: false, reason: '字数和图片不够，并且剧透了结局，请修改后重新提交' }, A))
    const row = await one('SELECT status, note_id FROM content_task WHERE id = ?', [task.id])
    assert.equal(Number(row.status), 1); assert.equal(row.note_id, null)
    const mine = ok(await call('GET', '/c/tasks', null, C)).mine.find((x) => x.id === task.id)
    assert.match(mine.rejectReason, /字数和图片不够/)
    assert.match(ok(await call('GET', `/c/tasks/${task.id}`, null, C)).rejectReason, /剧透/)
    const h = await one('SELECT note_id, verdict, reviewer FROM content_task_review WHERE task_id = ? ORDER BY id DESC LIMIT 1', [task.id])
    assert.equal(Number(h.note_id), bad); assert.equal(Number(h.verdict), 0); assert.match(h.reviewer, /^admin:/)
  })
  const good = await submit(BODY_OK)
  await t('重新投稿：自动核对全部通过；正文已清洗（脚本与事件属性被去掉）', async () => {
    const p = ok(await call('GET', `/admin/content-tasks/${task.id}/review`, null, A))
    assert.equal(p.submission.id, good)
    assert.ok(p.checks.every((c) => c.ok), JSON.stringify(p.checks.filter((c) => !c.ok)))
    assert.equal(p.submission.imageCount, 3)
    assert.ok(!/<script|onerror/i.test(p.submission.html))
    assert.equal(p.history.length, 1)
    assert.equal(ok(await call('GET', '/c/tasks', null, C)).mine.find((x) => x.id === task.id).rejectReason, null)
  })
  await t('审核标准未逐条确认不能通过；确认后通过并发放旅豆，记录两次审核', async () => {
    let r = await call('POST', `/admin/content-tasks/${task.id}/verdict`, { pass: true, rules: [true, false] }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /逐条确认/)
    r = ok(await call('POST', `/admin/content-tasks/${task.id}/verdict`, { pass: true, rules: [true, true], reason: '图文俱佳' }, A))
    assert.equal(r.rewarded, 50)
    assert.equal(Number((await one('SELECT status FROM content_task WHERE id = ?', [task.id])).status), 3)
    const hist = await q('SELECT verdict, reason FROM content_task_review WHERE task_id = ? ORDER BY id', [task.id])
    assert.deepEqual(hist.map((h) => Number(h.verdict)), [0, 1])
  })
  await t('已有人领取/完成的任务不能删除', async () => {
    const r = await call('POST', `/admin/content-tasks/${task.id}/delete`, {}, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /不能删除/)
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
  for (const id of created.tasks) { await q('DELETE FROM content_task_review WHERE task_id = ?', [id]); await q('DELETE FROM content_task WHERE id = ?', [id]) }
  for (const id of created.notes) await q('DELETE FROM content_note WHERE id = ?', [id])
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
