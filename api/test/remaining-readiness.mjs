import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('remaining-readiness')
import assert from 'node:assert/strict'
import http from 'node:http'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { c, cNotes } from '../src/routes/tourist.mjs'
import { applyMediaReview } from '../src/domain/media-review.mjs'
import { mediaCheckAsync, getUnlimitedQRCode } from '../src/domain/wxapi.mjs'
import { requireProductionLegal, legalVersions } from '../src/domain/legal.mjs'
import * as order from '../src/domain/order.mjs'
let sequence = 0, failImage = false, reviewText = false
const received = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}'); received.push({ path: req.url.split('?')[0], body })
  res.setHeader('content-type', 'application/json')
  if (req.url.startsWith('/wxa/getwxacodeunlimit')) { res.setHeader('content-type', 'image/png'); res.end(Buffer.from([137,80,78,71,255,128,0,254])) }
  else if (req.url.startsWith('/cgi-bin/stable_token')) res.end(JSON.stringify({ access_token: 'test-local-token', expires_in: 7200 }))
  else if (req.url.startsWith('/wxa/msg_sec_check')) res.end(JSON.stringify({ errcode: 0, result: { suggest: reviewText ? 'review' : 'pass' } }))
  else res.end(JSON.stringify(failImage ? { errcode: 40013, errmsg: 'invalid appid' } : { errcode: 0, trace_id: 'remaining-' + ++sequence }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
process.env.WX_API_BASE = 'http://127.0.0.1:' + server.address().port
process.env.WX_APPID = 'test-app'; process.env.WX_SECRET = 'test-secret'
const user = await q('INSERT INTO user_account (mini_a_openid,nickname) VALUES (?,?)', ['openid-real-shape-' + Date.now(), '审核夹具'])
const uid = Number(user.insertId), notes = []
const headers = { authorization: 'Bearer ' + jwtSign({ uid, end: 'c' }), host: 'media.example.org', 'x-forwarded-proto': 'https' }
const savedSite = await one('SELECT profile FROM site_config WHERE id=1')
const postNote = body => cNotes['POST /c/notes']({ headers, body })
try {
  const note = await postNote({ title: '两张图片', body: '测试多图审核链路', images: ['/uploads/first.jpg', '/uploads/second.jpg'] }); notes.push(note.id)
  assert.equal(note.status, 0)
  const textCall = received.find(x => x.path === '/wxa/msg_sec_check')
  assert.equal(textCall.body.openid, (await one('SELECT mini_a_openid FROM user_account WHERE id=?', [uid])).mini_a_openid)
  assert.equal(textCall.body.version, 2)
  assert.ok(received.filter(x => x.path === '/wxa/media_check_async').every(x => x.body.media_url.startsWith('https://media.example.org/') && x.body.openid === textCall.body.openid))
  const checks = await q('SELECT trace_id FROM content_media_check WHERE note_id=? ORDER BY trace_id', [note.id])
  assert.deepEqual((await getUnlimitedQRCode('test')).buffer, Buffer.from([137,80,78,71,255,128,0,254]), '小程序码应保留原始图片字节')
  assert.equal(checks.length, 2)
  const result = (trace, suggest = 'pass') => ({ Event: 'wxa_media_check', trace_id: trace, errcode: 0, result: { suggest } })
  await applyMediaReview(result(checks[0].trace_id))
  assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?', [note.id])).status), 0, '不能首张通过就公开')
  await applyMediaReview(result(checks[1].trace_id))
  assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?', [note.id])).status), 2)
  assert.equal((await applyMediaReview(result(checks[1].trace_id, 'risky'))).duplicate, true)
  const edit = cNotes['PUT /c/notes/:id']
  const revised = await edit({ headers, params:{id:note.id}, body:{title:'修订待审',body:'编辑后必须再次人工审核',images:['/uploads/updated.jpg'],revision:1} })
  assert.equal(revised.status,0)
  const current = await one('SELECT body FROM content_note WHERE id=?',[note.id])
  const currentBody = typeof current.body === 'string' ? JSON.parse(current.body) : current.body
  await applyMediaReview(result(currentBody.imgSec[0].traceId))
  assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?',[note.id])).status),1,'图片通过后仍需人工复审')
  await assert.rejects(() => edit({headers,params:{id:note.id},body:{title:'旧版本',body:'旧内容',revision:1}}),/状态已变化/)
  const concurrent = await postNote({ title: '并发多图', body: '最后两张并发通过也必须发布', images: ['/uploads/a.jpg', '/uploads/b.jpg'] }); notes.push(concurrent.id)
  const parallel = await q('SELECT trace_id FROM content_media_check WHERE note_id=?', [concurrent.id])
  await Promise.all(parallel.map(x => applyMediaReview(result(x.trace_id))))
  assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?', [concurrent.id])).status), 2)
  await assert.rejects(() => applyMediaReview(result('unknown-task')))
  reviewText = true
  const review = await postNote({ title: '文字需复核', body: '测试文本不能被图片放行', images: ['/uploads/third.jpg'] }); notes.push(review.id)
  const check = await one('SELECT trace_id FROM content_media_check WHERE note_id=?', [review.id])
  await applyMediaReview(result(check.trace_id))
  assert.equal(Number((await one('SELECT status FROM content_note WHERE id=?', [review.id])).status), 1)
  reviewText = false; failImage = true
  const before = await one('SELECT COUNT(*) n FROM content_note WHERE user_id=?', [uid])
  await assert.rejects(() => postNote({ title: '提交失败', body: '失败不能冒充审核已提交', images: ['/uploads/fourth.jpg'] }), /40013/)
  assert.equal(Number((await one('SELECT COUNT(*) n FROM content_note WHERE user_id=?', [uid])).n), Number(before.n))
  await assert.rejects(() => mediaCheckAsync('http://127.0.0.1/private.png', textCall.body.openid), /公网HTTPS/)
  const req = { headers, body: { scene: 'privacy', granted: true } }
  await c['POST /c/consent'](req)
  await c['POST /c/consent']({ ...req, body: { scene: 'privacy', granted: false } })
  await c['POST /c/consent'](req)
  const events = await q("SELECT version_no FROM attest_event WHERE biz_type='consent' AND biz_ref LIKE ? ORDER BY version_no", ['consent-' + uid + '-privacy-%'])
  assert.deepEqual(events.map(x => Number(x.version_no)), [1, 2, 3], '重新同意不得被首次同意的幂等键吞掉')
  assert.ok((await one('SELECT version FROM user_privacy_consent WHERE user_id=? AND scene=?', [uid, 'privacy'])).version)
  process.env.NODE_ENV = 'production'
  await assert.rejects(() => order.place({ withInsurance: true }), /承保服务尚未接通/)
  await assert.rejects(() => requireProductionLegal(uid), /协议/)
  await assert.rejects(() => c['POST /c/consent'](req), /协议/)
  await q("UPDATE site_config SET profile=JSON_SET(COALESCE(profile,JSON_OBJECT()),'$.user_agreement',?,'$.privacy_policy',?) WHERE id=1", ['<p>隔离测试服务条款</p>', '<p>隔离测试隐私政策</p>'])
  const versions = await legalVersions()
  await c['POST /c/consent']({ headers, body: { scene: 'terms', granted: true, version: versions.terms } })
  await requireProductionLegal(uid)
  await q("UPDATE user_privacy_consent SET version='stale' WHERE user_id=? AND scene='privacy'", [uid])
  await assert.rejects(() => requireProductionLegal(uid), /协议已更新/)
  await assert.rejects(() => c['POST /c/consent']({ headers, body: { scene: 'privacy', granted: true, version: 'stale' } }), /协议已更新/)
  delete process.env.NODE_ENV
  console.log('真实身份/公开图片URL/多图回执/文本复核/失败不建单/重复授权留痕/生产保险与空协议拦截：通过')
} finally {
  delete process.env.NODE_ENV
  await q('UPDATE site_config SET profile=? WHERE id=1', [typeof savedSite.profile === 'string' ? savedSite.profile : JSON.stringify(savedSite.profile)])
  if (notes.length) { await q('DELETE FROM content_media_check WHERE note_id IN (?)', [notes]); await q('DELETE FROM content_note WHERE id IN (?)', [notes]) }
  await q("DELETE FROM attest_event WHERE biz_type='consent' AND biz_ref LIKE ?", ['consent-' + uid + '-%'])
  await q('DELETE FROM user_privacy_consent WHERE user_id=?', [uid]); await q('DELETE FROM user_account WHERE id=?', [uid])
  await new Promise(resolve => server.close(resolve)); await closeDb()
}
