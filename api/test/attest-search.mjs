// 存证统一检索（/admin/attest/search）：一个入口吃多种标识，别退化成"只能输订单号"
// 只对隔离库运行；数据取自库里已有的事实（订单 / 批次 / 载荷指纹 / 用户），不自己造。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/attest-search.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const search = async (v) => ok(await call('GET', '/admin/attest/search?q=' + encodeURIComponent(v), null, A))

// 取一条已入批的事件：未打包的事件没有 batch_id，验不出"带出所在批次"
const ev = await one('SELECT e.biz_type, e.biz_ref, e.payload_hash, e.batch_id FROM attest_event e WHERE e.batch_id IS NOT NULL ORDER BY e.id DESC LIMIT 1')
const batch = await one('SELECT id, seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
const ord = await one('SELECT order_no, user_id FROM orders ORDER BY id DESC LIMIT 1')

console.log('== 存证统一检索 ==')

await t('空查询直接拒绝，并提示能查什么（不许默默返回空）', async () => {
  const r = await call('GET', '/admin/attest/search?q=', null, A)
  assert.equal(r.code, 1001)
  assert.match(r.msg, /订单号|批次|哈希/)
})

await t('按批次查：#seq 命中批次，并把批内事件一起带出来', async () => {
  assert.ok(batch, '库里没有批次，先跑打包')
  const d = await search('#' + batch.seq)
  assert.ok(d.matched.includes('批次'), '没识别成批次')
  const b = d.batches.find((x) => Number(x.id) === Number(batch.id))
  assert.ok(b, '批次没命中')
  assert.ok(d.events.some((e) => Number(e.batch_id) === Number(batch.id)), '批内事件没带出来')
  assert.ok(d.events.every((e) => e.batch_id), '事件缺少所属批次')
})

await t('按载荷指纹查（64 位哈希）：命中那条事件与它所在批次', async () => {
  assert.ok(ev, '库里没有存证事件')
  const d = await search(ev.payload_hash)
  assert.ok(d.matched.includes('载荷哈希'), '没识别成载荷哈希')
  assert.ok(d.events.some((e) => e.payload_hash === ev.payload_hash), '事件没命中')
  assert.ok(d.batches.length >= 1, '没带出所在批次')
})

await t('按订单号查：命中订单事实，并带出这单的存证事件', async () => {
  assert.ok(ord, '库里没有订单')
  const d = await search(ord.order_no)
  assert.ok(d.matched.includes('订单号'))
  assert.equal(d.order.orderNo, ord.order_no)
  assert.ok(d.events.length >= 1, '订单的存证事件没带出来')
})

await t('按用户查：user:<id> 命中用户，DID 字段随结果返回（链上标识可追溯）', async () => {
  assert.ok(ord, '库里没有订单')
  const d = await search('user:' + Number(ord.user_id))
  assert.ok(d.matched.some((x) => x.includes('用户')), '没识别成用户')
  assert.equal(Number(d.user.id), Number(ord.user_id))
  assert.ok('did' in d.user, '结果里没有 did 字段')
})

await t('按业务单号查：凭证 / 旅豆流水等 biz_ref 直查得到命中', async () => {
  assert.ok(ev, '库里没有存证事件')
  const d = await search(ev.biz_ref)
  assert.ok(d.matched.includes('业务单号') || d.matched.includes('凭证'), '业务单号没识别')
  assert.ok(d.events.some((e) => e.biz_ref === ev.biz_ref), '按 biz_ref 没查到')
})

await t('查不到时返回空结果 + 能力说明（不报 500，也不假装命中）', async () => {
  const d = await search('ZZZ-NOT-EXIST-' + Date.now())
  assert.equal(d.batches.length, 0); assert.equal(d.events.length, 0)
  assert.equal(d.order, null); assert.equal(d.user, null)
  assert.ok(d.capability.canSearch.length >= 8, '能力清单太少')
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)

// 数据库连接池不会自己退出，closeDb 收尾后自然退出——直接 process.exit 会在 Windows 上
// 触发 libuv 句柄断言、退出码变 127，把 test:db 的 && 链打断（其他套件都这样收尾）
await closeDb().catch(() => {})
process.exitCode = process.exitCode || 0
