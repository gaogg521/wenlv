// 隐私授权（consent）：同意了哪一项、哪一版、什么时候撤回，都要有记录且入存证。
// 这是"用户知不知道规则"唯一拿得出手的证据 —— 只对隔离库跑。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/consent.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }

const stamp = Date.now().toString(36)
const me = ok(await call('POST', '/c/auth/login', { code: 'mock-consent-' + stamp }))
const C = me.token
const uid = Number(me.user.id)

console.log('== 隐私授权 ==')

await t('默认没有任何授权记录，但会给出当前协议版本', async () => {
  const d = ok(await call('GET', '/c/consent', null, C))
  assert.deepEqual(d.items, [], '新用户不该有授权记录')
  assert.ok(d.versions.privacy && d.versions.terms, '要告诉用户当前是哪一版')
})

await t('同意 → 落库 + 入存证（biz_ref 里带版本号）', async () => {
  const d = ok(await call('POST', '/c/consent', { scene: 'privacy', granted: true }, C))
  assert.equal(d.granted, true)
  const row = await one('SELECT granted, granted_at FROM user_privacy_consent WHERE user_id = ? AND scene = ?', [uid, 'privacy'])
  assert.equal(Number(row.granted), 1)
  assert.ok(row.granted_at, '要有同意时间')
  const ev = await one("SELECT biz_ref, canonical FROM attest_event WHERE biz_type = 'consent' AND biz_ref LIKE ?", ['consent-' + uid + '-privacy-%'])
  assert.ok(ev, '同意必须入存证')
  const c = typeof ev.canonical === 'string' ? JSON.parse(ev.canonical) : ev.canonical
  assert.equal(Number(c.userId), uid); assert.equal(c.scene, 'privacy'); assert.equal(c.granted, true)
  assert.ok(c.version, '存证里要记版本')
})

await t('撤回：同一项不新增记录，但 granted 归 0 且留撤回时间', async () => {
  ok(await call('POST', '/c/consent', { scene: 'privacy', granted: false }, C))
  const rows = await q('SELECT granted, revoked_at FROM user_privacy_consent WHERE user_id = ? AND scene = ?', [uid, 'privacy'])
  assert.equal(rows.length, 1, '一项只应有一行（uk_user_scene）')
  assert.equal(Number(rows[0].granted), 0)
  assert.ok(rows[0].revoked_at, '要有撤回时间')
  const evs = await q("SELECT version_no FROM attest_event WHERE biz_type = 'consent' AND biz_ref LIKE ?", ['consent-' + uid + '-privacy-%'])
  assert.ok(evs.some((x) => Number(x.version_no) === 2), '撤回也要留一片叶子（version_no=2）')
})

await t('换一版重新同意会产生新存证，不覆盖旧的那条', async () => {
  ok(await call('POST', '/c/consent', { scene: 'privacy', granted: true, version: '2027.01' }, C))
  const evs = await q("SELECT biz_ref FROM attest_event WHERE biz_type = 'consent' AND biz_ref LIKE ?", ['consent-' + uid + '-privacy-%'])
  assert.ok(evs.length >= 3, '换版本应新增叶子：' + JSON.stringify(evs))
  assert.ok(evs.some((x) => x.biz_ref.endsWith('2027.01')), '新版本要单独留痕')
})

await t('未知授权项直接拒绝（否则"同意过什么"无从核对）', async () => {
  const r = await call('POST', '/c/consent', { scene: 'whatever', granted: true }, C)
  assert.equal(r.code, 1001)
  assert.match(r.msg, /未知的授权项/)
})

await t('后台用户画像能看到授权项与时间', async () => {
  const admin = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const d = ok(await call('GET', '/admin/users/' + uid, null, admin))
  assert.ok(Array.isArray(d.consents), '画像里没有 consents 字段')
  const p = d.consents.find((x) => x.scene === 'privacy')
  assert.ok(p, '找不到 privacy 授权'); assert.equal(p.granted, true)
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
