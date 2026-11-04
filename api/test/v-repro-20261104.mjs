// V-01～V-08 + S-01 修复前复现脚本（统一交接台账批次 A）。
// 用法：DB_NAME=<隔离库> PORT=<隔离端口> JWT_SECRET=dev node test/v-repro-20261104.mjs
// 每项输出 REPRODUCED（缺陷仍可复现）或 FIXED（负向已被拒绝/行为正确）。
// 本脚本只建夹具、只清自己的夹具，不做任何全库操作。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/v-repro-20261104.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (tok, method, path, body) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const tk = (role, name, extra = {}) => jwtSign({ end: 'admin', role, name, ...extra })
const superTk = (name) => tk('super', name)
const stamp = 'VREP' + Math.random().toString(36).slice(2, 8)
const made = { users: [], notes: [], events: [], cases: [], entries: [], reports: [], claims: [], tasks: [] }
const out = []
const judge = async (id, name, expectBug) => {
  const r = await call(superTk(name), 'POST', '/admin/risk-cases/' + id + '/close', { note: stamp + ' 复核结案结论' })
  return expectBug ? r.code === 0 : r.code !== 0
}
try {
  const prod = await one('SELECT id, city_code FROM tour_product WHERE status=1 ORDER BY id LIMIT 1')
  const cityA = prod.city_code
  const orderA = await one('SELECT user_id FROM orders WHERE city_code=? AND status IN (40,50) ORDER BY id DESC LIMIT 1', [cityA])
  assert(orderA, '需要本城订单夹具')
  const cityUser = orderA.user_id
  const ghost = (await q('INSERT INTO user_account (mini_a_openid, nickname) VALUES (?,?)', ['vrepro-' + stamp, stamp + '无单用户'])).insertId
  made.users.push(ghost)

  // ---------- V-01 同 UID 改显示名自结案 ----------
  {
    const ev = (await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?,?,2,?)", [cityUser, 'refund_abuse', JSON.stringify({ reason: stamp + 'V01' })])).insertId
    made.events.push(ev)
    const c = await call(superTk(stamp + 'V01创建'), 'POST', '/admin/risk-cases', { sourceType: 'risk_event', sourceId: ev, objectType: 'user', userId: cityUser, title: stamp + ' V01', note: stamp + ' 研判说明内容' })
    made.cases.push(c.data.id)
    await call(tk('risk', stamp + 'V01责任人', { uid: 90001 }), 'POST', `/admin/risk-cases/${c.data.id}/judge`, { note: stamp + ' 研判受理' })
    await call(tk('risk', stamp + 'V01责任人', { uid: 90001 }), 'POST', `/admin/risk-cases/${c.data.id}/review`, { note: stamp + ' 提交复核' })
    const bug = await judge(c.data.id, stamp + 'V01责任人改名后', true) // 同 uid=90001，仅换显示名
    out.push(['V-01 同UID改显示名自结案', bug])
  }
  // ---------- V-02 城市建案绕过用户城市校验 ----------
  {
    const r = await call(tk('city_partner', stamp + 'V02城市', { scopeCity: String(cityA) }), 'POST', '/admin/risk-cases',
      { sourceType: 'city', objectType: 'user', userId: ghost, title: stamp + ' V02', note: stamp + ' 协查说明内容' })
    const bug = r.code === 0
    if (bug) made.cases.push(r.data.id)
    out.push(['V-02 城市建案关联无本城订单用户被接受', bug])
  }
  // ---------- V-03 城市借建案处置未授权 risk_event ----------
  {
    const ev = (await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?,?,2,?)", [ghost, 'verify_replay', JSON.stringify({ reason: stamp + 'V03' })])).insertId
    made.events.push(ev)
    const r = await call(tk('city_partner', stamp + 'V03城市', { scopeCity: String(cityA) }), 'POST', '/admin/risk-cases',
      { sourceType: 'risk_event', sourceId: ev, objectType: 'other', title: stamp + ' V03', note: stamp + ' 协查说明内容' })
    const evAfter = await one('SELECT handled FROM risk_event WHERE id=?', [ev])
    const bug = r.code === 0 && Number(evAfter.handled) === 1
    if (r.code === 0) made.cases.push(r.data.id)
    out.push(['V-03 城市建案把他人 risk_event 置为已处理', bug])
  }
  // ---------- V-04 done 清除他人待审认领 ----------
  {
    const n = (await q('INSERT INTO content_note (user_id,title,body,status,related_product_id) VALUES (?,?,?,1,?)',
      [cityUser, stamp + 'V04 笔记', JSON.stringify({ text: '<p>x</p>', images: [] }), prod.id])).insertId
    made.notes.push(n)
    await call(tk('review', stamp + 'V04审核'), 'POST', `/admin/review-queue/note/${n}/claim`)
    const r = await call(tk('ops', stamp + 'V04运营'), 'POST', `/admin/review-queue/note/${n}/done`)
    const claims = await q('SELECT id FROM review_claim WHERE queue_kind=? AND item_id=? AND released_at IS NULL', ['note', n])
    const bug = r.code === 0 && claims.length === 0
    out.push(['V-04 done 清除他人待审认领', bug])
  }
  // ---------- V-05 认领不存在的待办仍成功 ----------
  {
    const r = await call(tk('review', stamp + 'V05审核'), 'POST', '/admin/review-queue/note/99999999/claim')
    const bug = r.code === 0 && r.data.claimed
    out.push(['V-05 认领不存在待办返回成功', bug])
  }
  // ---------- V-06 约稿判定不释放认领 ----------
  {
    const t = (await q("INSERT INTO content_task (task_no,title,brief,product_id,status,reward_beans) VALUES (?,?,?,?,1,100)",
      ['TSK' + stamp, stamp + 'V06 任务', stamp + ' 任务简介', prod.id])).insertId
    made.tasks.push(t)
    const e = (await q('INSERT INTO content_task_entry (task_id,user_id,status,submitted_at) VALUES (?,?,2,NOW(3))', [t, cityUser])).insertId
    made.entries.push(e)
    await call(tk('review', stamp + 'V06审核'), 'POST', `/admin/review-queue/task_entry/${e}/claim`)
    const v = await call(tk('review', stamp + 'V06审核'), 'POST', `/admin/task-entries/${e}/verdict`, { pass: false, reason: stamp + ' 驳回原因测试四个字' })
    const claims = await q('SELECT id FROM review_claim WHERE queue_kind=? AND item_id=? AND released_at IS NULL', ['task_entry', e])
    const bug = v.code === 0 && claims.length > 0
    out.push(['V-06 约稿驳回后认领未释放', bug])
  }
  // ---------- V-07 队列总量=前20条长度 ----------
  {
    const ids = []
    for (let i = 0; i < 26; i++) {
      const n = (await q('INSERT INTO content_note (user_id,title,body,status,related_product_id) VALUES (?,?,?,1,?)',
        [cityUser, `${stamp}V07-${String(i).padStart(2, '0')} 待审`, JSON.stringify({ text: '<p>x</p>', images: [] }), prod.id])).insertId
      ids.push(n); made.notes.push(n)
    }
    const d = await call(tk('review', stamp + 'V07审核'), 'GET', '/admin/review-queue')
    const noteQ = d.data.queues.find((x) => x.kind === 'note')
    const bug = noteQ.total === 20 && noteQ.items.length === 20
    out.push(['V-07 队列把前20条当全部待办数(total=' + noteQ.total + ')', bug])
  }
  // ---------- V-08 冻结引用无关/已关闭案件 ----------
  {
    const ev = (await q("INSERT INTO risk_event (user_id, kind, severity, detail) VALUES (?,?,2,?)", [cityUser, 'refund_abuse', JSON.stringify({ reason: stamp + 'V08' })])).insertId
    made.events.push(ev)
    const c = await call(superTk(stamp + 'V08创建'), 'POST', '/admin/risk-cases', { sourceType: 'risk_event', sourceId: ev, objectType: 'user', userId: cityUser, title: stamp + ' V08', note: stamp + ' 研判说明内容' })
    made.cases.push(c.data.id)
    const r = await call(superTk(stamp + 'V08处置'), 'POST', `/admin/users/${ghost}/status`, { status: 0, reason: stamp + ' 冻结原因测试', caseId: c.data.id })
    const recs = await q('SELECT id FROM risk_case_record WHERE case_id=? AND action=?', [c.data.id, 'freeze'])
    const bug = r.code === 0 && recs.length > 0 // 案件关联的是 cityUser，却给 ghost 写入了时间线
    out.push(['V-08 冻结无关用户引用他人案件成功', bug])
  }
  // ---------- S-01 一次下架只释放当前举报认领 ----------
  {
    const n = (await q('INSERT INTO content_note (user_id,title,body,status,related_product_id) VALUES (?,?,?,2,?)',
      [cityUser, stamp + 'S01 笔记', JSON.stringify({ text: '<p>x</p>', images: [] }), prod.id])).insertId
    made.notes.push(n)
    const r1 = (await q("INSERT INTO content_report (note_id,user_id,city_code,reason) VALUES (?,?,?,'举报理由一四个字')", [n, ghost, cityA])).insertId
    const r2 = (await q("INSERT INTO content_report (note_id,user_id,city_code,reason) VALUES (?,?,?,'举报理由二四个字')", [n, cityUser, cityA])).insertId
    made.reports.push(r1, r2)
    await call(tk('review', stamp + 'S01审核1'), 'POST', `/admin/review-queue/report/${r1}/claim`)
    await call(tk('review', stamp + 'S01审核2'), 'POST', `/admin/review-queue/report/${r2}/claim`)
    await call(tk('ops', stamp + 'S01处理'), 'POST', `/admin/content-cases/reports/${r2}/verdict`, { action: 'takedown', reason: stamp + ' 下架理由四个字' })
    const active = await q("SELECT item_id FROM review_claim WHERE queue_kind='report' AND released_at IS NULL AND item_id IN (?)", [[r1, r2]])
    const bug = active.some((x) => Number(x.item_id) === Number(r1)) // 举报1已完成下架但其认领未被释放
    out.push(['S-01 下架批量完成举报但只释放当前认领', bug])
  }

  let repro = 0, fixed = 0
  for (const [name, bug] of out) {
    if (bug) { repro++; console.log('  ✗ REPRODUCED ' + name) } else { fixed++; console.log('  ✓ FIXED ' + name) }
  }
  console.log(`\n复现 ${repro} 项 / 已修 ${fixed} 项（共 ${out.length}）`)
  process.exitCode = repro > 0 ? 2 : 0
} finally {
  // 只清自己的夹具
  if (made.claims.length) await q('DELETE FROM review_claim WHERE id IN (?)', [made.claims]).catch(() => {})
  await q("DELETE FROM review_claim WHERE claimed_by LIKE 'admin:" + stamp + "%'").catch(() => {})
  if (made.reports.length) await q('DELETE FROM content_report WHERE id IN (?)', [made.reports]).catch(() => {})
  if (made.entries.length) await q('DELETE FROM content_task_review WHERE entry_id IN (?)', [made.entries]).catch(() => {})
  if (made.entries.length) await q('DELETE FROM content_task_entry WHERE id IN (?)', [made.entries]).catch(() => {})
  if (made.tasks.length) await q('DELETE FROM content_task WHERE id IN (?)', [made.tasks]).catch(() => {})
  if (made.notes.length) await q('DELETE FROM content_note WHERE id IN (?)', [made.notes]).catch(() => {})
  if (made.cases.length) {
    await q('DELETE FROM risk_case_record WHERE case_id IN (?)', [made.cases]).catch(() => {})
    await q('DELETE FROM risk_case WHERE id IN (?)', [made.cases]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='risk-case' AND biz_ref IN (?)", [made.cases.map((x) => 'case-' + x)]).catch(() => {})
  }
  if (made.events.length) await q('DELETE FROM risk_event WHERE id IN (?)', [made.events]).catch(() => {})
  if (made.users.length) await q('DELETE FROM user_account WHERE id IN (?)', [made.users]).catch(() => {})
  await closeDb()
}
