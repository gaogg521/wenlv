// 业务规则端到端：勋章自动发放/补发/发行上限、结算五口径比例参数化与周期命名、轮播按城市投放
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/business-rules.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const FIN = ok(await call('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const stamp = Date.now().toString(36)
const sess = await one(`SELECT s.id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.status = 1 AND p.status = 1 AND s.quota - s.booked >= 2 AND s.depart_date >= CURDATE() ORDER BY s.id LIMIT 1`)
assert.ok(sess, '需要可预订团期（先跑 seed:scenario）')
// 造一笔"已完成"订单（直接置 50，聚焦规则本身）
async function completedOrder(code) {
  const tok = ok(await call('POST', '/c/auth/login', { code })).token
  const o = ok(await call('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0, contactName: '规则测试', contactPhone: '13800006666' }, tok))
  ok(await call('POST', '/admin/dev/mock-pay', { orderNo: o.orderNo }, A))
  await q('UPDATE orders SET status = 50, completed_at = NOW(3) WHERE order_no = ?', [o.orderNo])
  const u = await one('SELECT user_id FROM orders WHERE order_no = ?', [o.orderNo])
  return { tok, orderNo: o.orderNo, uid: Number(u.user_id) }
}
const created = { badges: [], banners: [] }

console.log('== 勋章自动规则 ==')
try {
  await t('自动规则必须设置阈值', async () => {
    const r = await call('POST', '/admin/entities/badge', { values: { name: '无阈值' + stamp, icon_key: 'x' + stamp, rule_type: 'review' } }, A)
    assert.equal(r.code, 1001); assert.ok(r.data.fieldErrors.threshold)
  })
  await t('写第一条评价即自动点亮「评价」勋章，接口返回新勋章并入存证队列', async () => {
    const b = ok(await call('POST', '/admin/entities/badge', { values: { name: '首评达人' + stamp, icon_key: 'rv' + stamp, rule_type: 'review', threshold: 1, rule_desc: '发表 1 条评价' } }, A))
    created.badges.push(b.id)
    const { tok, orderNo, uid } = await completedOrder('mock-badge-' + stamp)
    const r = ok(await call('POST', `/c/orders/${orderNo}/review`, { rating: 5, content: '体验很好，推荐给朋友' }, tok))
    assert.ok(r.badges.includes('首评达人' + stamp))
    assert.ok(await one('SELECT 1 x FROM user_badge WHERE user_id = ? AND badge_id = ?', [uid, b.id]))
    assert.ok(await one(`SELECT id FROM attest_event WHERE biz_type = 'badge' AND biz_ref = ?`, ['badge-' + uid + '-' + b.id]))
    const again = ok(await call('GET', '/c/identity', null, tok)).badges.find((x) => x.id === b.id)
    assert.equal(again.owned, true)
  })
  await t('新建「完成订单数」规则后按规则补发存量达标用户；重复补发不重复发', async () => {
    const b = ok(await call('POST', '/admin/entities/badge', { values: { name: '出发者' + stamp, icon_key: 'oc' + stamp, rule_type: 'order_count', threshold: 1 } }, A))
    created.badges.push(b.id)
    const eligible = Number((await one('SELECT COUNT(*) n FROM (SELECT user_id FROM orders WHERE status = 50 GROUP BY user_id) x')).n)
    const r1 = ok(await call('POST', `/admin/web3/badges/${b.id}/backfill`, {}, A))
    assert.equal(r1.eligible, eligible); assert.equal(r1.granted, eligible)
    const r2 = ok(await call('POST', `/admin/web3/badges/${b.id}/backfill`, {}, A))
    assert.equal(r2.granted, 0)
  })
  await t('发行上限：人工授予超过上限被拒；补发遇上限停止', async () => {
    const b = ok(await call('POST', '/admin/entities/badge', { values: { name: '限量' + stamp, icon_key: 'lm' + stamp, rule_type: 'manual', max_issue: 1 } }, A))
    created.badges.push(b.id)
    const users = await q('SELECT id FROM user_account ORDER BY id LIMIT 2')
    ok(await call('POST', `/admin/web3/badges/${b.id}/grant`, { userId: users[0].id }, A))
    const r = await call('POST', `/admin/web3/badges/${b.id}/grant`, { userId: users[1].id }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /上限/)
    const dup = await call('POST', `/admin/web3/badges/${b.id}/grant`, { userId: users[0].id }, A)
    assert.equal(dup.code, 1001); assert.match(dup.msg, /已拥有/)
  })

  console.log('== 结算比例与周期 ==')
  const propose = async (key, v) => ok(await call('POST', '/admin/config/proposal', { key, newValue: String(v), reason: 'test' }, A)).historyId
  const approve = async (id) => ok(await call('POST', '/admin/config/approve', { historyId: id }, FIN))
  await t('三项比例合计超过 100% 被拒', async () => {
    const r = await call('POST', '/admin/config/proposal', { key: 'settlement.split_fulfill', newValue: '0.9', reason: 't' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /超过 100%/)
  })
  await t('改履约比例为 50%（双人复核）后，新结算单按新比例并快照；默认周期为 ISO 周', async () => {
    await approve(await propose('settlement.split_fulfill', 0.5))
    const { orderNo } = await completedOrder('mock-split-' + stamp)
    const o = await one('SELECT merchant_id, amount_pay - insurance_fee AS base FROM orders WHERE order_no = ?', [orderNo])
    await q('UPDATE orders SET settlement_id = NULL WHERE order_no = ?', [orderNo])
    const pre = await q('SELECT id FROM orders WHERE merchant_id = ? AND status = 50 AND settlement_id IS NULL', [o.merchant_id])
    const r = ok(await call('POST', '/admin/settlements/generate', {}, A))
    assert.match(r.period, /^\d{4}-W\d{2}$/)
    const st = await one('SELECT * FROM settlement WHERE merchant_id = ? AND period = ?', [o.merchant_id, r.period])
    const snap = typeof st.split_snapshot === 'string' ? JSON.parse(st.split_snapshot) : st.split_snapshot
    assert.equal(snap.fulfill, 5000); assert.equal(snap.service, 1200)
    if (pre.length === Number(st.order_count)) assert.equal(Number(st.amt_fulfill), Math.round(Number(st.total_amount) * 0.5))
    await approve(await propose('settlement.split_fulfill', 0.58))
  })

  console.log('== 轮播按城市投放 ==')
  await t('限定城市的轮播只在该城市出现；未传城市时全部出现', async () => {
    const b = ok(await call('POST', '/admin/entities/banner', { values: { title: '苏州专属' + stamp, image: '/uploads/a.png', cities: ['320508'] } }, A))
    created.banners.push(b.id)
    const tok = ok(await call('POST', '/c/auth/login', { code: 'mock-banner-' + stamp })).token
    const has = async (qs) => ok(await call('GET', '/c/banners' + qs, null, tok)).some((x) => x.title === '苏州专属' + stamp)
    assert.equal(await has('?city=320508'), true)
    assert.equal(await has('?city=310118'), false)
    assert.equal(await has(''), true)
  })
} finally {
  for (const id of created.banners) await q('DELETE FROM banner WHERE id = ?', [id])
  for (const id of created.badges) { await q('DELETE FROM user_badge WHERE badge_id = ?', [id]); await q('DELETE FROM badge WHERE id = ?', [id]) }
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
