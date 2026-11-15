// UGC 三期 e2e：①话题/景区聚合 feed → 云草稿（V89 乐观锁+发布原子清理）→ 私密媒体（V88 门禁 404+跨可见范围冲突）→ 语音评论
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/content-xhs3.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const raw = async (m, p, t) => fetch(BASE + p, { method: m, headers: t ? { authorization: 'Bearer ' + t } : {}, redirect: 'manual' })
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const stamp = 'X3' + Date.now().toString(36)

// 1x1 png（合法图片头，走 /c/upload/note-image 真实上传）
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// 合法 MP3 头（ID3）最小体（≥16 字节）
const MP3 = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(20, 0)]).toString('base64')
const TEXT = '<p>清晨的朱家角游客还不多，石板路上只有早起的人。</p><p>放生桥边早点摊的热气是最好的路标。</p>'

const C = ok(await call('POST', '/c/auth/login', { code: 'mock-' + stamp })).token          // 作者
const R = ok(await call('POST', '/c/auth/login', { code: 'mock-' + stamp + '-reader' })).token // 读者
const uid = Number(ok(await call('GET', '/c/me', null, C)).id)
const rid = Number(ok(await call('GET', '/c/me', null, R)).id)
assert.notEqual(uid, rid)

// 景区（话题聚合按 scenic_id 过滤的锚点）
const scenicId = (await q(`INSERT INTO scenic_spot (city_code, name, status, created_at, updated_at) VALUES ('SH','朱家角古镇测试景区',1,NOW(3),NOW(3))`)).insertId

async function uploadImage(token) {
  const up = ok(await call('POST', '/c/upload/note-image', { data: PNG, ext: 'png' }, token))
  assert.ok(up.url && up.access, '上传返回 url+access ticket')
  return up
}

let pubNote, privNote, privImg

await t('私密发布（V88）：visibility=private 落库，feed 不收录，返回 visibility', async () => {
  const up = await uploadImage(C)
  privImg = up.url
  const n = ok(await call('POST', '/c/notes', { title: '私密的后院茶席', blocks: [{ type: 'text', html: TEXT }],
    images: [privImg], topics: ['茶席手记'], visibility: 'private', coverIndex: 0 }, C))
  privNote = n.id
  assert.equal(n.visibility, 'private')
  const row = await one('SELECT visibility FROM content_note WHERE id=?', [n.id])
  assert.equal(row.visibility, 'private')
  const feed = ok(await call('GET', '/c/notes/feed?page=1&pageSize=50', null, R))
  assert.ok(!feed.items.some(x => Number(x.id) === Number(privNote)), '私密笔记不得进 feed')
})

await t('私密详情门禁：作者可读，他人 1004；点赞/举报被拒', async () => {
  const own = await call('GET', '/c/notes/' + privNote, null, C)
  assert.equal(own.code, 0)
  assert.equal(own.data.visibility, 'private')
  const other = await call('GET', '/c/notes/' + privNote, null, R)
  assert.equal(other.code, 1004)
  const like = await call('POST', `/c/notes/${privNote}/like`, {}, R)
  assert.equal(like.code, 1004)
  const report = await call('POST', `/c/notes/${privNote}/report`, { reason: '测试举报私密笔记的四字以上理由' }, R)
  assert.equal(report.code, 1004)
})

await t('媒体门禁：私密素材匿名/他人 404，作者 200，ticket 直读 200', async () => {
  const anon = await raw('GET', '/uploads/' + privImg.split('/').pop())
  assert.equal(anon.status, 404)
  const reader = await raw('GET', '/uploads/' + privImg.split('/').pop(), R)
  assert.equal(reader.status, 404)
  const owner = await raw('GET', '/uploads/' + privImg.split('/').pop(), C)
  assert.equal(owner.status, 200)
  const access = ok(await call('POST', '/c/note-media/access', { paths: [privImg] }, C))
  // 门禁语义：note-editor 票据不能放大为「仅私密引用素材」的读取权（防票据在 URL 中泄露扩散）
  const viaTicket = await raw('GET', access[privImg])
  assert.equal(viaTicket.status, 404, '私密素材不吃 editor ticket')
  // 篡改 ticket 路径 → 404（票据绑定 path）
  const tampered = await raw('GET', access[privImg].replace(/media=/, 'media=x') + 'x')
  assert.equal(tampered.status, 404)
})

await t('素材跨可见范围冲突：同图发公开笔记被拒', async () => {
  const r = await call('POST', '/c/notes', { title: '公开版重复用图', blocks: [{ type: 'text', html: TEXT }],
    images: [privImg], topics: ['古镇漫步'], coverIndex: 0 }, C)
  assert.equal(r.code, 1001)
  assert.match(r.msg, /不同可见范围/)
})

await t('公开笔记 + 关联景区发布成功，feed 话题/景区过滤精确', async () => {
  const up = await uploadImage(C)
  const n = ok(await call('POST', '/c/notes', { title: '朱家角半日漫步', blocks: [{ type: 'text', html: TEXT }],
    images: [up.url], topics: ['朱家角漫步', '古镇漫步'], scenicId, coverIndex: 0 }, C))
  pubNote = n.id
  assert.equal(n.status, 2)
  const byTopic = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20&topic=' + encodeURIComponent('朱家角漫步'), null, R))
  assert.ok(byTopic.items.some(x => Number(x.id) === Number(pubNote)), '话题命中公开笔记')
  assert.ok(!byTopic.items.some(x => Number(x.id) === Number(privNote)), '话题过滤下也不含私密')
  assert.ok(byTopic.items.every(x => (x.topics || []).includes('朱家角漫步')), '每条都带该话题')
  const miss = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20&topic=' + encodeURIComponent('不存在话题' + stamp), null, R))
  assert.equal(miss.items.length, 0)
  const byScenic = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20&scenic=' + scenicId, null, R))
  assert.ok(byScenic.items.some(x => Number(x.id) === Number(pubNote)))
  const hit = byScenic.items.find(x => Number(x.id) === Number(pubNote))
  assert.equal(hit.scenicName, '朱家角古镇测试景区')
  const all = ok(await call('GET', '/c/notes/feed?page=1&pageSize=50', null, R))
  assert.ok(all.items.some(x => Number(x.id) === Number(pubNote)), '无过滤时公开笔记可见')
})

await t('云草稿（V89）：建/读/列表 + 乐观锁 revision 冲突 2002', async () => {
  const made = ok(await call('POST', '/c/note-drafts', { content: { title: '云端的第一稿', blocks: [{ type: 'text', html: '<p>草稿正文</p>' }] } }, C))
  assert.ok(made.id && made.revision === 1)
  const stale = await call('POST', '/c/note-drafts', { id: made.id, revision: 0, content: { title: '旧版本写入', blocks: [{ type: 'text', html: '<p>x</p>' }] } }, C)
  assert.equal(stale.code, 2002, '过期 revision 必须被乐观锁拦下')
  const next = ok(await call('POST', '/c/note-drafts', { id: made.id, revision: 1, content: { title: '云端的第二稿', blocks: [{ type: 'text', html: '<p>草稿正文二</p>' }] } }, C))
  assert.equal(next.revision, 2)
  const got = ok(await call('GET', '/c/note-drafts/' + made.id, null, C))
  assert.equal(got.revision, 2)
  assert.equal(got.content.title, '云端的第二稿')
  const list = ok(await call('GET', '/c/note-drafts', null, C))
  assert.ok(list.some(d => Number(d.id) === Number(made.id)))
  // 他人不可见
  const thief = await call('GET', '/c/note-drafts/' + made.id, null, R)
  assert.equal(thief.code, 1004)
  // 校验：缺 blocks / 缺 title / 超长
  const noBlocks = await call('POST', '/c/note-drafts', { content: { title: 'x' } }, C)
  assert.equal(noBlocks.code, 1001)
  const big = await call('POST', '/c/note-drafts', { content: { title: 'x', blocks: [{ type: 'text', html: '<p>' + '字'.repeat(231000) + '</p>' }] } }, C)
  assert.equal(big.code, 1001)
  // 删除乐观锁
  const delStale = await call('DELETE', '/c/note-drafts/' + made.id, { revision: 1 }, C)
  assert.equal(delStale.code, 2002)
  ok(await call('DELETE', '/c/note-drafts/' + made.id, { revision: 2 }, C))
  const gone = await call('GET', '/c/note-drafts/' + made.id, null, C)
  assert.equal(gone.code, 1004)
})

await t('发布原子清云草稿：draftId+draftRevision 提交即删，过期草稿拒绝发布', async () => {
  const d1 = ok(await call('POST', '/c/note-drafts', { content: { title: '待发布草稿', blocks: [{ type: 'text', html: '<p>正文</p>' }] } }, C))
  // 用过期 revision 发布 → 服务端拒绝（乐观锁防双设备重复发布）
  const stalePub = await call('POST', '/c/notes', { title: '过期草稿发布', blocks: [{ type: 'text', html: TEXT }],
    topics: ['古镇漫步'], draftId: d1.id, draftRevision: 99 }, C)
  assert.equal(stalePub.code, 2002)
  // 正确 revision 发布 → 草稿在发布事务内被删
  const pub = ok(await call('POST', '/c/notes', { title: '从云草稿发布', blocks: [{ type: 'text', html: TEXT }],
    topics: ['古镇漫步'], draftId: d1.id, draftRevision: d1.revision }, C))
  assert.ok(pub.id)
  const after = await one('SELECT id FROM content_note_draft WHERE id=?', [d1.id])
  assert.ok(!after, '发布成功即原子清理云草稿')
})

await t('私密编辑回填：edit 返回 visibility/scenicName/mediaAccess 票据（私密素材按设计走 owner 鉴权读取）', async () => {
  const d = ok(await call('GET', '/c/notes/' + privNote + '/edit', null, C))
  assert.equal(d.visibility, 'private')
  assert.ok(d.mediaAccess && d.mediaAccess[privImg], 'edit 下发素材票据')
  const viaTicket = await raw('GET', d.mediaAccess[privImg])
  assert.equal(viaTicket.status, 404, '私密素材不吃 editor ticket（防票据泄露扩散），须走 owner 鉴权下载')
  const viaOwner = await raw('GET', '/uploads/' + privImg.split('/').pop(), C)
  assert.equal(viaOwner.status, 200)
})

await t('语音评论（三期）：合法 mp3 随评发送→直展示；坏头 1001；他人播放地址下发', async () => {
  const c1 = ok(await call('POST', `/c/notes/${pubNote}/comments`, { body: '听听我录的晨间集市', media: { kind: 'audio', data: MP3 } }, R))
  assert.ok(c1.id)
  const list = ok(await call('GET', `/c/notes/${pubNote}/comments`, null, C))
  const hit = list.items.find(x => Number(x.id) === Number(c1.id))
  assert.ok(hit, '语音评论在列表中')
  assert.equal(hit.media_kind, 'audio')
  assert.equal(Number(hit.media_state), 1, 'mock 通道直展示')
  assert.ok(hit.mediaUrl, '播放地址已下发')
  const audioLoc = hit.mediaUrl.startsWith('http') ? hit.mediaUrl : BASE + hit.mediaUrl
  const played = await fetch(audioLoc, { headers: { authorization: 'Bearer ' + C } })
  assert.equal(played.status, 200, '评论语音可读（不受笔记门禁影响）')
  const bad = await call('POST', `/c/notes/${pubNote}/comments`, { body: '坏头语音', media: { kind: 'audio', data: Buffer.alloc(24, 1).toString('base64') } }, R)
  assert.equal(bad.code, 1001)
})

await t('话题校验（搬运后口径）：超 20 字/非法字符被拒；小写归一', async () => {
  const bad = await call('POST', '/c/notes', { title: '话题校验', blocks: [{ type: 'text', html: TEXT }], topics: ['一个特别特别特别长的话题名称超过二十字了啊'] }, C)
  assert.equal(bad.code, 1001)
  const badChar = await call('POST', '/c/notes', { title: '话题校验', blocks: [{ type: 'text', html: TEXT }], topics: ['含 空格 话题'] }, C)
  assert.equal(badChar.code, 1001)
  const n = ok(await call('POST', '/c/notes', { title: '话题归一', blocks: [{ type: 'text', html: TEXT }], topics: ['CamelCase'] }, C))
  const row = await one(`SELECT JSON_EXTRACT(body,'$.topics') topics FROM content_note WHERE id=?`, [n.id])
  const got = typeof row.topics === 'string' ? JSON.parse(row.topics) : row.topics
  assert.deepEqual(got, ['camelcase'])
})

await t('批量通过收紧（配套）：修订版笔记不走批量直通', async () => {
  const d = ok(await call('GET', `/c/notes/${pubNote}/edit`, null, C))
  const r = ok(await call('PUT', `/c/notes/${pubNote}`, { title: '朱家角半日漫步（修订）', blocks: [{ type: 'text', html: TEXT }],
    images: d.images, video: null, topics: d.topics, scenicId, coverIndex: 0, revision: d.revision }, C))
  assert.equal(r.status, 1)
  const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const batch = ok(await call('POST', '/admin/review-queue/batch-verdict', { kind: 'note', action: 'pass', itemIds: [pubNote] }, A))
  const hit = (batch.results || []).find(x => Number(x.id) === Number(pubNote))
  assert.ok(hit && hit.ok === false, '批量直通对修订版（revision>1）必须逐笔失败')
  ok(await call('POST', `/admin/content/${pubNote}/verdict`, { pass: true, revision: d.revision + 1 }, A))
})

console.log(`\n内容三期：${pass} 项通过`)
await closeDb()
