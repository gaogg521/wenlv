// 主体管理：用户中心统计与列表口径一致、手机号脱敏、冻结即时生效、风险标记、商户全景的城市权限、商品数据
// 会写库，只能对隔离库运行
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/people.mjs')
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const stamp = Date.now().toString(36)
const code = 'mock-people-' + stamp
const C = ok(await call('POST', '/c/auth/login', { code })).token
const uid = Number((await one('SELECT id FROM user_account WHERE mini_a_openid LIKE ?', ['%' + code])).id)
const phone = '139' + String(Date.now()).slice(-8)
await q('UPDATE user_account SET mobile_enc = ? WHERE id = ?', [Buffer.from(phone, 'utf8'), uid])

try {
  console.log('== 用户中心 ==')
  await t('分群统计与列表筛选口径一致', async () => {
    const st = ok(await call('GET', '/admin/users/stats', null, A))
    for (const seg of ['buyer', 'creator', 'new7', 'frozen']) {
      const l = ok(await call('GET', '/admin/users?seg=' + seg, null, A))
      assert.equal(l.total, st.segments[seg], seg)
    }
    assert.equal(ok(await call('GET', '/admin/users', null, A)).total, st.total)
  })
  await t('客服可按 11 位手机号精确查到用户；画像里手机号只显示脱敏值', async () => {
    const l = ok(await call('GET', '/admin/users?kw=' + phone, null, A))
    assert.equal(l.total, 1); assert.equal(l.rows[0].id, uid)
    const raw = JSON.stringify(await call('GET', '/admin/users/' + uid, null, A))
    assert.ok(!raw.includes(phone), '画像不应包含完整手机号')
    assert.match(raw, new RegExp(phone.slice(0, 3) + '\\*\\*\\*\\*' + phone.slice(7)))
    assert.ok(!JSON.stringify(l).includes(phone))
  })
  await t('画像包含交易、旅豆、内容、成长、操作记录各段', async () => {
    const p = ok(await call('GET', '/admin/users/' + uid, null, A))
    for (const k of ['user', 'trade', 'orders', 'beans', 'content', 'growth', 'ops']) assert.ok(k in p, k)
    assert.equal(p.user.status, 1)
  })

  console.log('== 冻结与风险 ==')
  await t('冻结必须写原因', async () => {
    const r = await call('POST', `/admin/users/${uid}/status`, { status: 0 }, A)
    assert.equal(r.code, 1001)
  })
  await t('冻结后已登录会话立即失效、不能重新登录；解冻后恢复，操作留痕', async () => {
    ok(await call('GET', '/c/tasks', null, C))
    ok(await call('POST', `/admin/users/${uid}/status`, { status: 0, reason: '测试：批量刷单嫌疑' }, A))
    let r = await call('GET', '/c/tasks', null, C); assert.equal(r.code, 1003); assert.match(r.msg, /停用/)
    r = await call('POST', '/c/auth/login', { code }); assert.equal(r.code, 1003)
    ok(await call('POST', `/admin/users/${uid}/status`, { status: 1, reason: '核实无误' }, A))
    ok(await call('GET', '/c/tasks', null, C))
    const ops = ok(await call('GET', '/admin/users/' + uid, null, A)).ops.map((o) => o.action)
    assert.ok(ops.includes('freeze') && ops.includes('unfreeze'))
  })
  await t('风险标记需原因，标记后进入风险分群', async () => {
    assert.equal((await call('POST', `/admin/users/${uid}/risk`, { flag: true }, A)).code, 1001)
    ok(await call('POST', `/admin/users/${uid}/risk`, { flag: true, reason: '测试：异常退款' }, A))
    assert.ok(ok(await call('GET', '/admin/users?seg=risk', null, A)).rows.some((x) => x.id === uid))
    ok(await call('POST', `/admin/users/${uid}/risk`, { flag: false }, A))
  })

  console.log('== 商户全景 / 商品数据 ==')
  await t('商户全景：经营指标、商品、员工、结算齐全；进件电话脱敏', async () => {
    const m = await one('SELECT id FROM merchant ORDER BY id LIMIT 1')
    const p = ok(await call('GET', `/admin/merchants/${m.id}/overview`, null, A))
    for (const k of ['merchant', 'kpi', 'daily', 'products', 'staff', 'settle', 'reviews']) assert.ok(k in p, k)
    assert.ok(!/\d{11}/.test(String(p.merchant.apply_mobile || '')))
  })
  await t('城市合伙人只能看本城商户全景', async () => {
    const P = ok(await call('POST', '/admin/login', { username: 'city310118', password: process.env.CITY_PARTNER_PASSWORD || 'city123' })).token
    const mine = await one("SELECT id FROM merchant WHERE city_code = '310118' LIMIT 1")
    const other = await one("SELECT id FROM merchant WHERE city_code <> '310118' LIMIT 1")
    if (mine) ok(await call('GET', `/admin/merchants/${mine.id}/overview`, null, P))
    if (other) assert.equal((await call('GET', `/admin/merchants/${other.id}/overview`, null, P)).code, 1003)
    assert.equal((await call('GET', '/admin/users', null, P)).code, 1003)
  })
  await t('商品数据：成交、满座率、评分分布', async () => {
    const pr = await one('SELECT id FROM tour_product ORDER BY id LIMIT 1')
    const p = ok(await call('GET', `/admin/products/${pr.id}/overview`, null, A))
    assert.ok(p.kpi.fill_rate >= 0 && p.kpi.fill_rate <= 1); assert.ok(Array.isArray(p.dist))
  })
} finally {
  await q('UPDATE user_account SET status = 1, risk_flag = 0, mobile_enc = NULL WHERE id = ?', [uid])
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
