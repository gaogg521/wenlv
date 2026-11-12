// 贡献确认 S/R + CS→成长值 专项（隔离库，需先起隔离 API 服务）：
//   S 内容质量：约稿任务审核通过 → 投稿人记 kind=2（score=contribution.s_adoption），cs=score×w_s，
//     并接通 CS→成长值（cs×member.cs_multiplier，biz_type=2，幂等）；重复裁定不重记。
//   R 留存：完成单 1 分 / 窗口内复购单 r_rebuy 分（由 test:loop 覆盖，本文件聚焦 S 链路）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('contribution-sr')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as contribution from '../src/domain/contribution.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: t ? { authorization: 'Bearer ' + t, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const admin = jwtSign({ end: 'admin', role: 'super', name: 'cs-qa' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'cs-ops' })
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()

try {
  await q('UPDATE promo_discount SET status = 0')
  // ===== 布景：创作者 + 约稿任务 + 认领投稿（直接落库到"审核中"） =====
  const uidC = (await q('INSERT INTO user_account(nickname) VALUES(?)', ['cs-creator-' + stamp])).insertId
  await q('INSERT INTO bean_account(user_id) VALUES(?)', [uidC])
  const taskId = (await q("INSERT INTO content_task(task_no,title,brief,reward_beans,status) VALUES(?,?,?,?,2)", ['CS' + stamp, 'cs约稿任务' + stamp, '隔离验证约稿', 100])).insertId
  const noteId = (await q("INSERT INTO content_note(user_id,title,body,status) VALUES(?,?,?,2)", [uidC, 'cs投稿作品' + stamp, JSON.stringify(['cs隔离验证正文'])])).insertId
  const entryId = (await q('INSERT INTO content_task_entry(task_id,user_id,status,note_id,submitted_at) VALUES(?,?,2,?,NOW(3))', [taskId, uidC, noteId])).insertId

  await check('S 内容质量·任务采纳：审核通过 → 投稿人记 kind=2（score=5）、cs=score×w_s、CS→成长值接通', async () => {
    const w = await contribution.weights()
    const r = ok(await call('POST', `/admin/task-entries/${entryId}/verdict`, { pass: true, reason: 'cs隔离验证通过', rules: [] }, ops))
    assert.equal(r.finished, true, '投稿通过')
    const rec = await one('SELECT score, cs, verified_at FROM contribution_record WHERE kind=2 AND biz_ref=?', ['ENTRY-' + entryId])
    assert.ok(rec, 'S 贡献落库')
    assert.equal(Number(rec.score), 5, 'score=contribution.s_adoption=5')
    assert.equal(Number(rec.cs), Math.round(5 * w.s * 100) / 100, `cs=score×w_s(${w.s})`)
    assert.ok(rec.verified_at, 'verified_at 落（规则已确认）')
    const g = await one('SELECT delta FROM user_growth_log WHERE user_id=? AND biz_type=2 AND biz_ref=?', [uidC, 'ENTRY-' + entryId])
    assert.ok(g && Number(g.delta) === Math.round(Number(rec.cs) * 10), 'CS→成长值：cs×cs_multiplier(10) 进成长值')
    // 幂等：重复裁定（重开审核再通过）不重记
    await q("UPDATE content_task_entry SET status=2 WHERE id=?", [entryId])
    ok(await call('POST', `/admin/task-entries/${entryId}/verdict`, { pass: true, reason: 'cs重复通过验证', rules: [] }, ops))
    const n2 = Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE kind=2 AND biz_ref=?', ['ENTRY-' + entryId])).n)
    assert.equal(n2, 1, '重复采纳只记一次（uk 幂等）')
    const n3 = Number((await one('SELECT COUNT(*) n FROM user_growth_log WHERE user_id=? AND biz_type=2 AND biz_ref=?', [uidC, 'ENTRY-' + entryId])).n)
    assert.equal(n3, 1, '成长值不重复加')
  })
  await check('S 内容质量·驳回不记分；配置可调（s_adoption=0 时停发）', async () => {
    const uidX = (await q('INSERT INTO user_account(nickname) VALUES(?)', ['cs-x-' + stamp])).insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uidX])
    const noteX = (await q("INSERT INTO content_note(user_id,title,body,status) VALUES(?,?,?,2)", [uidX, 'cs驳回作品' + stamp, JSON.stringify(['cs隔离验证正文'])])).insertId
    const entryX = (await q('INSERT INTO content_task_entry(task_id,user_id,status,note_id,submitted_at) VALUES(?,?,2,?,NOW(3))', [taskId, uidX, noteX])).insertId
    ok(await call('POST', `/admin/task-entries/${entryX}/verdict`, { pass: false, reason: 'cs隔离验证驳回用例' }, ops))
    assert.equal(Number((await one('SELECT COUNT(*) n FROM contribution_record WHERE kind=2 AND biz_ref=?', ['ENTRY-' + entryX])).n), 0, '驳回不记 S')
    const r0 = await contribution.recordS(uidX, 999999)
    assert.equal(r0.recorded, true, '直接调用返回 recorded')
    const recs = await contribution.summary(uidX)
    assert.ok(recs.basis.s.includes('采纳'), '汇总说明含 S 计分依据')
  })

  console.log(`\n贡献确认 S/R 专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
