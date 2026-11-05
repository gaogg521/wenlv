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
console.log('== 卡面体系的数据 ==')
await t('卡面等级清单：旅行者人数合计 = 用户数；推广 / 创作者 3 级，等级名来自配置', async () => {
  const s = ok(await call('GET', '/admin/web3/vc', null, A)).cardScale
  const users = Number((await one('SELECT COUNT(*) n FROM user_account')).n)
  assert.equal(s.traveler.levels.reduce((a, l) => a + l.n, 0), users, '等级被配置改小时这里会暴露')
  assert.equal(s.promoter.levels.length, 3); assert.equal(s.creator.levels.length, 3); assert.ok(s.merchant.levels.length >= 1)
  const active = Number((await one('SELECT COUNT(*) n FROM promoter WHERE status = 1')).n)
  assert.equal(s.promoter.levels.reduce((a, l) => a + l.n, 0), active, '只数生效的推广服务商')
})
await t('有其他角色的用户：列表带角色标记，档案带对应身份卡；卡上不出现手机号', async () => {
  const p = await one('SELECT user_id FROM promoter WHERE status = 1 AND user_id IN (SELECT id FROM user_account) LIMIT 1')
  const m = await one('SELECT user_id FROM merchant_staff WHERE status = 1 AND user_id IN (SELECT id FROM user_account) LIMIT 1')
  assert.ok(p || m, '需要至少一个推广服务商或商户店员（先 seed）')
  for (const [row, role] of [[p, 'promoter'], [m, 'merchant']]) {
    if (!row) continue
    const uid = Number(row.user_id)
    const d = ok(await call('GET', '/admin/web3/identity/' + uid, null, A))
    const c = d.roleCards.find((x) => x.role === role)
    assert.ok(c, role + ' 身份卡缺失'); assert.ok(c.rank >= 1 && c.rank <= c.total); assert.ok(c.levelName); assert.equal(c.stats.length, 3)
    assert.ok(!/1[3-9]\d{9}/.test(JSON.stringify(c)), '身份卡不能带手机号')
    const r = ok(await call('GET', '/admin/web3/identities?size=5&q=' + uid, null, A))
    assert.ok(r.rows.find((x) => x.userId === uid).roles.includes(role), '列表没标 ' + role)
  }
  const plain = await one(`SELECT u.id FROM user_account u WHERE u.creator_tag = 'none'
    AND NOT EXISTS (SELECT 1 FROM promoter p WHERE p.user_id = u.id AND p.status = 1) AND NOT EXISTS (SELECT 1 FROM merchant_staff s WHERE s.user_id = u.id AND s.status = 1)
    AND NOT EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id AND c.status = 2) LIMIT 1`)
  if (plain) assert.deepEqual(ok(await call('GET', '/admin/web3/identity/' + plain.id, null, A)).roleCards, [], '纯旅行者不该多出身份卡')
})
await t('旅豆台账按业务汇总：用户侧入账 / 出账 / 笔数与账本一致，且不含预算 / 平台户', async () => {
  const pa = ok(await call('GET', '/admin/web3/point-assets', null, A))
  const rows = await q(`SELECT l.biz_type, SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE 0 END) i, SUM(CASE WHEN l.direction = 2 THEN l.amount ELSE 0 END) o, COUNT(*) n
    FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id < 999999000000 GROUP BY l.biz_type`)
  for (const x of pa.byBiz) {
    const r = rows.find((y) => Number(y.biz_type) === Number(x.biz_type))
    assert.equal(x.userIn, r ? Number(r.i) : 0); assert.equal(x.userOut, r ? Number(r.o) : 0); assert.equal(x.entries, r ? Number(r.n) : 0)
  }
  const bal = await one('SELECT COALESCE(SUM(balance), 0) b, COALESCE(SUM(lifetime), 0) l FROM bean_account WHERE user_id < 999999000000')
  assert.equal(pa.userBalance, Number(bal.b)); assert.equal(pa.userLifetime, Number(bal.l))
})
console.log('== 角色凭证与批量签发 ==')
await t('角色凭证：有身份才能签；验签通过、不含金额与手机号；失去身份后验签失败', async () => {
  const row = await one('SELECT p.user_id, p.tier, p.status FROM promoter p JOIN user_account u ON u.id = p.user_id WHERE p.status = 1 AND u.status = 1 LIMIT 1')
  assert.ok(row, '需要一个生效的推广服务商（先 seed）')
  const uid = Number(row.user_id)
  const v = ok(await call('POST', '/admin/web3/vc/issue', { userId: uid, scope: 'promoter' }, A))
  assert.equal(v.claims.role, 'promoter'); assert.equal(v.claims.levelNo, Math.min(Number(row.tier), 3))
  assert.ok(!/gmv|rate|score|mobile|phone|¥/i.test(JSON.stringify(v.claims)), '推广凭证不能带业绩、佣金和手机号')
  const r1 = ok(await call('POST', '/open/vc/verify', { jwt: v.jwt })); assert.equal(r1.valid, true, r1.reason)
  assert.ok(r1.notDisclosed.includes('佣金比例')); assert.ok(r1.types.includes('WanderlustRoleCredential'))
  await q('UPDATE promoter SET status = 2 WHERE user_id = ?', [uid])
  try {
    const r2 = ok(await call('POST', '/open/vc/verify', { jwt: v.jwt }))
    assert.equal(r2.valid, false); assert.match(r2.reason, /不再具备该身份/)
  } finally { await q('UPDATE promoter SET status = ? WHERE user_id = ?', [row.status, uid]) }
  const plain = await one(`SELECT u.id FROM user_account u WHERE NOT EXISTS (SELECT 1 FROM merchant_staff s WHERE s.user_id = u.id AND s.status = 1) LIMIT 1`)
  const bad = await call('POST', '/admin/web3/vc/issue', { userId: plain.id, scope: 'merchant' }, A)
  assert.equal(bad.code, 1001); assert.match(bad.msg, /没有商户身份/)
})
await t('批量签发：预览数 = 实际签发数；再查为 0；已有有效凭证的不重复签；范围不合法被拒', async () => {
  assert.equal((await call('GET', '/admin/web3/vc/batch?scope=xx', null, A)).code, 1001)
  assert.equal((await call('POST', '/admin/web3/vc/batch', { scope: 'xx' }, A)).code, 1001)
  const p = ok(await call('GET', '/admin/web3/vc/batch?scope=promoter', null, A))
  const before = Number((await one("SELECT COUNT(*) n FROM vc_issue WHERE scope = 'promoter'")).n)
  const r = ok(await call('POST', '/admin/web3/vc/batch', { scope: 'promoter' }, A))
  assert.equal(r.issued, Math.min(p.pending, p.max)); assert.deepEqual(r.failed, [])
  assert.equal(Number((await one("SELECT COUNT(*) n FROM vc_issue WHERE scope = 'promoter'")).n), before + r.issued)
  assert.equal(ok(await call('GET', '/admin/web3/vc/batch?scope=promoter', null, A)).pending, r.remaining)
  const again = ok(await call('POST', '/admin/web3/vc/batch', { scope: 'promoter' }, A))
  if (!r.remaining) assert.equal(again.issued, 0, '第二次不该重复签')
  assert.notEqual((await call('POST', '/admin/web3/vc/batch', { scope: 'promoter' })).code, 0, '未登录要拒绝')
})
await t('存证中心默认 20 批，batchLimit 可放大但有上限', async () => {
  const total = Number((await one('SELECT COUNT(*) n FROM attest_batch')).n)
  assert.equal(ok(await call('GET', '/admin/attest/center', null, A)).batches.length, Math.min(total, 20))
  assert.equal(ok(await call('GET', '/admin/attest/center?batchLimit=9999', null, A)).batches.length, Math.min(total, 200))
  assert.equal(ok(await call('GET', '/admin/attest/center?batchLimit=-1', null, A)).batches.length, Math.min(total, 20))
})
await t('小程序身份接口带卡种：只有卡种和系列名，与等级规则一致，不含存证用语', async () => {
  const { cardTierOf, TIER_NAMES } = await import('../src/domain/card-tier.mjs')
  const u = await one("SELECT id, mini_a_openid, member_level FROM user_account WHERE mini_a_openid LIKE 'mock-openid-%' LIMIT 1")
  const tok = ok(await call('POST', '/c/auth/login', { code: String(u.mini_a_openid).replace(/^mock-openid-/, '') })).token
  const card = ok(await call('GET', '/c/identity', null, tok)).profile.card
  const total = (ok(await call('GET', '/admin/web3/vc', null, A)).cardScale).traveler.levels.length
  const lv = Number((await one('SELECT member_level FROM user_account WHERE id = ?', [u.id])).member_level)
  assert.equal(card.tier, cardTierOf(lv, total)); assert.equal(card.tierName, TIER_NAMES[card.tier]); assert.equal(card.series, '行者系列')
  assert.deepEqual(Object.keys(card).sort(), ['series', 'tier', 'tierName'])
})
await t('错误输入：不存在的用户 → 1004；非法 id → 1001；未登录 → 拒绝', async () => {
  assert.equal((await call('GET', '/admin/web3/identity/99999999', null, A)).code, 1004)
  assert.equal((await call('GET', '/admin/web3/identity/abc', null, A)).code, 1001)
  assert.notEqual((await call('GET', '/admin/web3/identities')).code, 0); assert.notEqual((await call('GET', '/admin/web3/identity/1')).code, 0)
})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
