// 数字身份 ↔ 旅豆账户打通（2026-11-05 用户反馈：台账 24 个账户、数字身份 0 个持有人，两边脱节）。
// 身份档案列表 / 详情必须以 user_id 把 DID、旅豆账户、徽章、行程、凭证关联起来，并与台账同口径（排除预算 / 平台哨兵户）。
// 只能对隔离库运行；需要服务在跑（PORT / API_BASE 指向隔离服务）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/identity-link.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, tk) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(tk ? { authorization: 'Bearer ' + tk } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

console.log('== 数字身份 ↔ 旅豆账户 ==')
await t('列表总数 = 用户数；汇总的旅豆账户数 = 真实用户户（不含预算 / 平台哨兵户），且与台账页「旅豆账户数」同口径', async () => {
  const r = ok(await call('GET', '/admin/web3/identities?size=5', null, A))
  const users = Number((await one('SELECT COUNT(*) n FROM user_account')).n)
  const real = Number((await one('SELECT COUNT(*) n FROM bean_account WHERE user_id < 999999000000')).n)
  const all = Number((await one('SELECT COUNT(*) n FROM bean_account')).n)
  assert.equal(r.total, users); assert.equal(r.summary.users, users); assert.equal(r.summary.beanAccounts, real)
  assert.ok(all >= real, '哨兵户存在时 all > real；此断言保证口径没写反')
  const pa = ok(await call('GET', '/admin/web3/point-assets', null, A)); assert.equal(pa.holders, real, '台账「旅豆账户数」应与身份档案同口径')
})
await t('每一行都有稳定的 DID（再取一次不变），旅豆余额 / 累计与 bean_account 一致，没账户的是 null', async () => {
  const r1 = ok(await call('GET', '/admin/web3/identities?size=30', null, A)); assert.ok(r1.rows.length > 0)
  const r2 = ok(await call('GET', '/admin/web3/identities?size=30', null, A))
  for (const x of r1.rows) {
    assert.match(x.did, /^did:cn:wl:[a-z2-7]+$/); assert.equal(r2.rows.find((y) => y.userId === x.userId).did, x.did, 'DID 必须稳定')
    const b = await one('SELECT balance, lifetime FROM bean_account WHERE user_id = ?', [x.userId])
    if (b) { assert.equal(x.beanBalance, Number(b.balance)); assert.equal(x.beanLifetime, Number(b.lifetime)) } else { assert.equal(x.beanBalance, null); assert.equal(x.beanLifetime, null) }
    const bd = Number((await one('SELECT COUNT(*) n FROM user_badge WHERE user_id = ?', [x.userId])).n); assert.equal(x.badges, bd)
    const did = (await one('SELECT did_ref FROM user_account WHERE id = ?', [x.userId])).did_ref; assert.equal(did, x.did, 'DID 要落到 user_account.did_ref，与账户一一对应')
  }
})
await t('分页不重叠；按用户 id / 昵称 / DID 都能查到同一个人', async () => {
  const total = ok(await call('GET', '/admin/web3/identities?size=1', null, A)).total; assert.ok(total >= 2, '隔离库里至少要有 2 个用户（先 seed:scenario）')
  const size = Math.max(1, Math.floor(total / 2))   // 保证第 2 页一定有数据，不依赖库里用户数
  const p1 = ok(await call('GET', '/admin/web3/identities?size=' + size + '&page=1', null, A)), p2 = ok(await call('GET', '/admin/web3/identities?size=' + size + '&page=2', null, A))
  const s1 = new Set(p1.rows.map((x) => x.userId)); assert.ok(p2.rows.length > 0 && p2.rows.every((x) => !s1.has(x.userId)))
  const one1 = p1.rows[0]
  assert.equal(ok(await call('GET', '/admin/web3/identities?q=' + one1.userId, null, A)).rows.some((x) => x.userId === one1.userId), true)
  assert.equal(ok(await call('GET', '/admin/web3/identities?q=' + encodeURIComponent(one1.nickname), null, A)).rows.some((x) => x.userId === one1.userId), true)
  assert.deepEqual(ok(await call('GET', '/admin/web3/identities?q=' + encodeURIComponent(one1.did), null, A)).rows.map((x) => x.userId), [one1.userId])
  assert.equal(ok(await call('GET', '/admin/web3/identities?q=zzzz-no-such-user', null, A)).total, 0)
})
await t('档案详情：行程 / 徽章 / 旅豆流水与库一致；流水首行余额 = 账户余额；卡片数字与明细数量对得上', async () => {
  const withBean = await one(`SELECT u.id FROM user_account u JOIN bean_account b ON b.user_id = u.id JOIN bean_ledger l ON l.account_id = b.id GROUP BY u.id ORDER BY COUNT(*) DESC LIMIT 1`)
  assert.ok(withBean, '隔离库里没有有旅豆流水的用户（先 seed:scenario）')
  const d = ok(await call('GET', '/admin/web3/identity/' + withBean.id, null, A))
  const acct = await one('SELECT balance, lifetime FROM bean_account WHERE user_id = ?', [withBean.id])
  assert.equal(d.bean.balance, Number(acct.balance)); assert.equal(d.bean.lifetime, Number(acct.lifetime)); assert.ok(d.bean.ledger.length > 0)
  assert.equal(Number(d.bean.ledger[0].after_bal), Number(acct.balance), '最新一笔流水后的余额应等于账户余额')
  const bd = Number((await one('SELECT COUNT(*) n FROM user_badge WHERE user_id = ?', [withBean.id])).n); assert.equal(d.badges.length, bd); assert.equal(d.claims.badges.length, Math.min(bd, 10))
  const trips = Number((await one('SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status IN (40,50)', [withBean.id])).n)
  assert.equal(d.claims.trips, trips); assert.equal(d.trips.length, Math.min(trips, 20))
  assert.equal(d.cities.reduce((s, c) => s + Number(c.n), 0), trips, '城市分布合计 = 行程数')
  assert.equal(d.did, (await one('SELECT did_ref FROM user_account WHERE id = ?', [withBean.id])).did_ref)
  const text = JSON.stringify(d.claims); assert.ok(!/mobile|phone|openid|unionid/i.test(text), '凭证声明里不能出现手机号 / openid 等')
})
await t('错误输入：不存在的用户 → 1004；非法 id → 1001；未登录 → 拒绝', async () => {
  assert.equal((await call('GET', '/admin/web3/identity/99999999', null, A)).code, 1004)
  assert.equal((await call('GET', '/admin/web3/identity/abc', null, A)).code, 1001)
  assert.notEqual((await call('GET', '/admin/web3/identities')).code, 0); assert.notEqual((await call('GET', '/admin/web3/identity/1')).code, 0)
})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
