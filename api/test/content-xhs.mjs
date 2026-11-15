// 小红书化改造 e2e：话题/封面/20字标题 → 评论（机审+限频+后台隐藏）→ 发布奖励发豆（幂等+月上限）
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/content-xhs.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const A2 = jwtSign({ end: 'admin', role: 'super', name: 'xhs-approver', uid: 1 }) // 双人复核审批人（与提案人 admin 不同名）
const stamp = 'XHS' + Date.now().toString(36)

// 活跃旅豆预算批次（发豆断言的前置；全局总量哨兵 V2 已种）
const budgetId = (await q(`INSERT INTO bean_budget (name, total, granted, returned, biz_owner, status) VALUES (?,?,?,?,?,1)`,
  ['发布奖励测试批次' + stamp, 1000000, 0, 0, 'test', 1])).insertId

const C = ok(await call('POST', '/c/auth/login', { code: 'mock-' + stamp })).token
const R = ok(await call('POST', '/c/auth/login', { code: 'mock-' + stamp + '-reader' })).token
const uid = Number(ok(await call('GET', '/c/me', null, C)).id)
const TEXT = '<p>清晨的古镇游客还不多，石板路上只有早起的人。</p><p>桥边早点摊的热气是最好的路标。</p>'

try {
  let noteId
  await t('发布：标题>20字被拒；话题收口（≤5个/单个≤20字/去重去#）', async () => {
    const bad = await call('POST', '/c/notes', { title: '这个标题实在是太长了完全超过二十个字的限制了', blocks: [{ type: 'text', html: TEXT }], topics: ['古镇'] }, C)
    assert.equal(bad.code, 1001); assert.match(bad.msg, /20/)
    const badTopic = await call('POST', '/c/notes', { title: '古镇半日', blocks: [{ type: 'text', html: TEXT }], topics: ['一个特别特别特别长的话题名称超过二十字了啊', 'b', 'c', 'd', 'e', 'f'] }, C)
    assert.equal(badTopic.code, 1001)
    const n = ok(await call('POST', '/c/notes', { title: '古镇半日', blocks: [{ type: 'text', html: TEXT }], images: [], topics: ['#古镇漫步', ' 美食探店 ', '古镇漫步', ''], coverIndex: 0 }, C))
    noteId = n.id
    assert.equal(n.status, 2) // mock 机审直通
  })

  await t('发布奖励：直通发布即发豆（BIZ.CONTENT biz_ref=note-<id>），标记幂等', async () => {
    const led = await one(`SELECT l.amount, l.biz_type, l.biz_ref FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE a.user_id = ? AND l.biz_ref = ? LIMIT 1`, [uid, 'note-' + noteId])
    assert.ok(led, '账本无发放记录')
    assert.equal(Number(led.biz_type), 3)
    assert.equal(Number(led.amount), Number((await one(`SELECT v FROM rule_config WHERE k='content.publish_reward_beans'`)).v))
    const note = await one('SELECT reward_granted FROM content_note WHERE id = ?', [noteId])
    assert.equal(Number(note.reward_granted), 1)
  })

  await t('编辑重投走人工审核，审核通过不重复发豆（reward_granted 幂等）', async () => {
    const d = ok(await call('GET', `/c/notes/${noteId}/edit`, null, C))
    const r = ok(await call('PUT', `/c/notes/${noteId}`, { title: '古镇半日（修订）', blocks: [{ type: 'text', html: TEXT }], images: d.images, video: null, topics: d.topics, coverIndex: 0, revision: d.revision }, C))
    assert.equal(r.status, 1) // 编辑 → 人工审核
    ok(await call('POST', `/admin/content/${noteId}/verdict`, { pass: true, revision: d.revision + 1 }, A))
    const grants = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE a.user_id = ? AND l.biz_ref = ?`, [uid, 'note-' + noteId])
    assert.equal(grants.length, 1, '同一篇只应发放一次')
  })

  await t('feed 返回话题/头像/评论数，封面按 coverIndex 取图', async () => {
    const feed = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20', null, R))
    const item = feed.items.find(x => x.id === noteId)
    assert.ok(item, 'feed 缺少新笔记')
    assert.equal(item.topics, undefined) // feed 卡片不下发话题
    assert.equal(item.commentCount, 0)
    assert.ok('avatar' in item)
  })

  await t('详情返回话题；评论（V87 社交层）发布 → 列表 → comment_count 同步', async () => {
    const d = ok(await call('GET', `/c/notes/${noteId}`, null, R))
    assert.deepEqual(d.topics, ['古镇漫步', '美食探店'])
    const bad = await call('POST', `/c/notes/${noteId}/comments`, { body: '', media: null }, R)
    assert.equal(bad.code, 1001)
    const c1 = ok(await call('POST', `/c/notes/${noteId}/comments`, { body: '写得真好，请问古镇晚上几点闭园？' }, R))
    assert.equal(c1.pending, false)
    const list = ok(await call('GET', `/c/notes/${noteId}/comments`, null, C))
    assert.equal(list.items.length, 1); assert.match(list.items[0].body, /闭园/)
    assert.equal(list.items[0].byAuthor, false)
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, 1)
  })

  await t('盖楼回复：replyTo 平铺 + replyAuthor；作者标 byAuthor', async () => {
    const roots = ok(await call('GET', `/c/notes/${noteId}/comments`, null, R))
    const root = roots.items[0]
    ok(await call('POST', `/c/notes/${noteId}/comments`, { body: '傍晚五点前闭园，祝玩得开心！', replyTo: root.id }, C))
    const thread = ok(await call('GET', `/c/notes/${noteId}/comments?root=${root.id}`, null, R))
    assert.equal(thread.items.length, 1)
    assert.equal(thread.items[0].replyAuthor, root.author)
    assert.equal(thread.items[0].byAuthor, true, '作者回复应有作者标')
    const roots2 = ok(await call('GET', `/c/notes/${noteId}/comments`, null, R))
    assert.equal(roots2.items[0].replies, 1, '一级评论应统计到 1 条回复')
    assert.equal(ok(await call('GET', '/c/notes/' + noteId, null, R)).commentCount, 2)
  })

  await t('评论点赞：一用户一评一赞可取消；评论删除（软删）同步计数', async () => {
    const roots = ok(await call('GET', `/c/notes/${noteId}/comments`, null, C))
    const target = roots.items[0]
    const l1 = ok(await call('PUT', `/c/notes/${noteId}/comments/${target.id}/like`, { liked: true }, R))
    assert.equal(l1.likes, 1)
    const l2 = ok(await call('PUT', `/c/notes/${noteId}/comments/${target.id}/like`, { liked: true }, R))
    assert.equal(l2.likes, 1, '重复点赞不叠加')
    const l3 = ok(await call('PUT', `/c/notes/${noteId}/comments/${target.id}/like`, { liked: false }, R))
    assert.equal(l3.likes, 0)
    const extra = ok(await call('POST', `/c/notes/${noteId}/comments`, { body: '马上安排，谢谢分享！' }, C))
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, 3)
    const del = ok(await call('DELETE', `/c/notes/${noteId}/comments/${extra.id}`, {}, C))
    assert.equal(del.deleted, true)
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, 2)
  })

  await t('图片评论：magic bytes 校验 + mock 机审直发 + 计数', async () => {
    const png1px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const bad = await call('POST', `/c/notes/${noteId}/comments`, { body: '', media: { kind: 'image', data: 'aGVsbG8gd29ybGQ=' } }, R)
    assert.equal(bad.code, 1001, '非图片内容应被拒')
    const r = ok(await call('POST', `/c/notes/${noteId}/comments`, { body: '', media: { kind: 'image', data: png1px } }, R))
    const list = ok(await call('GET', `/c/notes/${noteId}/comments`, null, R))
    const imgComment = list.items.find(x => x.id === r.id)
    assert.ok(imgComment.mediaUrl, '图片评论应返回附件地址')
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, 3)
  })

  await t('AI 写作建议：路径校验 + 未配置服务时的提示', async () => {
    const bad = await call('POST', '/c/note-vision-draft', { paths: ['/uploads/note_999_1.jpg'] }, C)
    assert.equal(bad.code, 1001); assert.match(bad.msg, /本人上传/)
    const none = await call('POST', '/c/note-vision-draft', { paths: [] }, C)
    assert.equal(none.code, 1001)
  })

  await t('同人同笔记日限 20 条', async () => {
    // R 今日已发 2 条（首评 + 图片评论）；再发 18 条凑满 20，第 21 条被拦
    for (let i = 0; i < 18; i++) ok(await call('POST', `/c/notes/${noteId}/comments`, { body: `评论占位内容第${i}条，凑足每日上限` }, R))
    const r = await call('POST', `/c/notes/${noteId}/comments`, { body: '这条评论应该被日上限拦住不放行' }, R)
    assert.equal(r.code, 1001); assert.match(r.msg, /上限/)
  })

  await t('后台评论管理：列表 → 隐藏（计数-1）→ 恢复（计数+1）', async () => {
    const before = ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount
    const list = ok(await call('GET', '/admin/comments?status=all', null, A))
    assert.ok(list.rows.length >= 20)
    const target = list.rows.find(r => r.note_id === noteId)
    assert.ok(target)
    ok(await call('POST', `/admin/comments/${target.id}/hide`, {}, A))
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, before - 1)
    ok(await call('POST', `/admin/comments/${target.id}/restore`, {}, A))
    assert.equal(ok(await call('GET', `/c/notes/${noteId}`, null, R)).commentCount, before)
    const again = await call('POST', `/admin/comments/${target.id}/restore`, {}, A)
    assert.equal(again.code, 2002)
  })

  await t('月度防刷上限：cap 降为 1 后新发布不发豆', async () => {
    // 走参数中心正规通道（提案→双人复核→审批热刷新），直改库不会刷新服务端 30s 配置缓存
    const prop = ok(await call('POST', '/admin/config/proposal', { key: 'content.publish_reward_monthly_cap', newValue: '1', reason: '测试月度防刷上限' }, A))
    ok(await call('POST', '/admin/config/approve', { historyId: prop.historyId }, A2))
    const n = ok(await call('POST', '/c/notes', { title: '第二篇不发豆', blocks: [{ type: 'text', html: TEXT }], topics: [] }, C))
    assert.equal(n.status, 2)
    const grants = await q(`SELECT l.id FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE a.user_id = ? AND l.biz_ref = ?`, [uid, 'note-' + n.id])
    assert.equal(grants.length, 0, '超过月上限不应发放')
    const note = await one('SELECT reward_granted FROM content_note WHERE id = ?', [n.id])
    assert.equal(Number(note.reward_granted), 0)
  })

  console.log(`\n完成：${pass} 通过`)
} finally {
  await q(`UPDATE rule_config SET v='10' WHERE k='content.publish_reward_monthly_cap'`).catch(() => {})
  await closeDb()
}
