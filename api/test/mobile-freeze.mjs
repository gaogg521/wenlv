// 手机号加密落库 + 冻结即暂停佣金放行与提现打款
// 会写库，只能对隔离库运行；需服务在跑（同一 JWT_SECRET）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/mobile-freeze.mjs')
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { q, one, tx, BizError } from '../src/db.mjs'
import { bindMobile, isLegacyPlain, openMobile, sealMobile } from '../src/infra/mobile.mjs'
import * as promo from '../src/domain/promo.mjs'
import * as bean from '../src/domain/bean.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

const stamp = Date.now().toString(36)
const mk = async (tag) => {
  const code = `mock-mf-${tag}-${stamp}`
  const token = ok(await call('POST', '/c/auth/login', { code })).token
  const id = Number((await one('SELECT id FROM user_account WHERE mini_a_openid LIKE ?', ['%' + code])).id)
  return { token, id }
}
const U1 = await mk('a'), U2 = await mk('b'), U3 = await mk('c')
const uids = [U1.id, U2.id, U3.id]
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const phone1 = '139' + rnd(), phone3 = '137' + rnd()
const fakeOrder = 900_000_000 + Math.floor(Math.random() * 1e7)
const created = { commission: [], withdraw: [], merchant: [] }

try {
  console.log('== 手机号加密 ==')
  await t('小程序绑定手机号：落库是密文 + 盲索引，不是明文', async () => {
    ok(await call('POST', '/c/auth/phone', { code: 'whatever' }, U1.token)) // 联调环境返回随机号码
    const row = await one('SELECT mobile_enc, mobile_hmac FROM user_account WHERE id = ?', [U1.id])
    assert.ok(row.mobile_enc && !isLegacyPlain(row.mobile_enc), '不应是 11 位明文')
    assert.match(row.mobile_hmac, /^[0-9a-f]{64}$/)
    assert.match(openMobile(row.mobile_enc), /^1\d{10}$/)
  })
  await t('后台按完整手机号精确查找命中，响应里没有完整号码，画像只给脱敏值', async () => {
    await tx((c) => bindMobile(c, U1.id, phone1, BizError))
    const list = ok(await call('GET', '/admin/users?kw=' + phone1, null, A))
    assert.ok(list.rows.some((r) => r.id === U1.id), '应命中')
    assert.ok(!JSON.stringify(list).includes(phone1), '列表响应不应出现完整号码')
    const prof = ok(await call('GET', '/admin/users/' + U1.id, null, A))
    assert.equal(prof.user.mobile, phone1.slice(0, 3) + '****' + phone1.slice(7))
    assert.ok(!JSON.stringify(prof).includes(phone1))
  })
  await t('同一手机号不能绑到第二个账号（给业务错误，不是 500）', async () => {
    await assert.rejects(tx((c) => bindMobile(c, U2.id, phone1, BizError)), (e) => e instanceof BizError && /已绑定其他账号/.test(e.message))
    assert.equal((await one('SELECT mobile_hmac FROM user_account WHERE id = ?', [U2.id])).mobile_hmac, null)
  })
  await t('历史明文账号：未迁移前仍可被找到并脱敏；迁移脚本加密后依然可找，且重跑为 0', async () => {
    await q('UPDATE user_account SET mobile_enc = ?, mobile_hmac = NULL WHERE id = ?', [Buffer.from(phone3, 'utf8'), U3.id])
    let list = ok(await call('GET', '/admin/users?kw=' + phone3, null, A))
    assert.ok(list.rows.some((r) => r.id === U3.id), '明文行应兜底命中')
    const run = () => { try { return execFileSync(process.execPath, ['scripts/encrypt-mobiles.mjs'], { encoding: 'utf8', env: process.env }) } catch (e) { return String(e.stdout || '') } }
    run()
    const row = await one('SELECT mobile_enc, mobile_hmac FROM user_account WHERE id = ?', [U3.id])
    assert.ok(!isLegacyPlain(row.mobile_enc) && row.mobile_hmac, '应已加密')
    assert.equal(openMobile(row.mobile_enc), phone3)
    list = ok(await call('GET', '/admin/users?kw=' + phone3, null, A))
    assert.ok(list.rows.some((r) => r.id === U3.id), '加密后仍可按号码查找')
    assert.match(run(), /已加密 0 行/)
  })

  console.log('== 商户申请电话与订单联系电话（V38）==')
  const mask = (p) => p.slice(0, 3) + '****' + p.slice(7)
  const runEncrypt = () => { try { return execFileSync(process.execPath, ['scripts/encrypt-mobiles.mjs'], { encoding: 'utf8', env: process.env }) } catch (e) { return String(e.stdout || '') } }
  const mPlain = '136' + rnd(), mSealed = '135' + rnd(), mApplied = '137' + rnd()
  await t('商户提交入驻申请：电话落库是密文，旧明文列为空', async () => {
    const tok = ok(await call('POST', '/m/auth/login', { code: `mock-m-mf-${stamp}` })).token
    ok(await call('POST', '/m/apply', { name: 'MF申请' + stamp, contact: '测试', mobile: mApplied }, tok))
    const row = await one('SELECT id, apply_mobile, apply_mobile_enc FROM merchant WHERE name = ?', ['MF申请' + stamp])
    created.merchant.push(row.id)
    assert.equal(row.apply_mobile, null, '新申请不再写明文列')
    assert.ok(row.apply_mobile_enc && !Buffer.from(row.apply_mobile_enc).toString('utf8').includes(mApplied), '库里不是明文')
    assert.equal(openMobile(row.apply_mobile_enc), mApplied)
  })
  await t('后台商户列表与导出：历史明文和密文都只给脱敏值，不下发完整号码与密文列', async () => {
    created.merchant.push((await q(`INSERT INTO merchant (city_code, name, merchant_no, status, apply_contact, apply_mobile) VALUES ('310118', ?, ?, 0, '测试', ?)`, ['MF旧' + stamp, 'MFA' + stamp, mPlain])).insertId,
      (await q(`INSERT INTO merchant (city_code, name, merchant_no, status, apply_contact, apply_mobile_enc) VALUES ('310118', ?, ?, 0, '测试', ?)`, ['MF新' + stamp, 'MFB' + stamp, sealMobile(mSealed).enc])).insertId)
    const rows = ok(await call('GET', '/admin/merchants', null, A))
    const raw = JSON.stringify(rows)
    for (const p of [mPlain, mSealed, mApplied]) assert.ok(!raw.includes(p), '列表响应不应出现完整号码')
    assert.equal(rows.find((r) => r.name === 'MF旧' + stamp).apply_mobile, mask(mPlain))
    const sealedRow = rows.find((r) => r.name === 'MF新' + stamp)
    assert.equal(sealedRow.apply_mobile, mask(mSealed)); assert.equal(sealedRow.apply_mobile_enc, undefined, '密文列不下发')
  })
  await t('加密脚本：历史明文搬进密文列并清空旧列，脱敏值不变，重跑为 0', async () => {
    runEncrypt()
    const row = await one('SELECT apply_mobile, apply_mobile_enc FROM merchant WHERE name = ?', ['MF旧' + stamp])
    assert.equal(row.apply_mobile, null); assert.equal(openMobile(row.apply_mobile_enc), mPlain)
    assert.equal(ok(await call('GET', '/admin/merchants', null, A)).find((r) => r.name === 'MF旧' + stamp).apply_mobile, mask(mPlain))
    assert.match(runEncrypt(), /商户申请电话：已加密 0 行；订单联系电话：已加密 0 行/)
  })
  await t('订单联系电话：历史明文（不要求 11 位）被加密迁移，旧列清空，可还原', async () => {
    const ord = await one('SELECT id, contact_phone_enc, contact_phone_sealed FROM orders ORDER BY id LIMIT 1')
    assert.ok(ord, '隔离库需先 seed:scenario，库里应有订单')
    try {
      await q('UPDATE orders SET contact_phone_enc = ?, contact_phone_sealed = NULL WHERE id = ?', [Buffer.from('021-66668888', 'utf8'), ord.id])
      assert.match(runEncrypt(), /订单联系电话：已加密 [1-9]\d* 行/)
      const row = await one('SELECT contact_phone_enc, contact_phone_sealed FROM orders WHERE id = ?', [ord.id])
      assert.equal(row.contact_phone_enc, null); assert.equal(openMobile(row.contact_phone_sealed), '021-66668888')
      assert.ok(!Buffer.from(row.contact_phone_sealed).toString('utf8').includes('66668888'), '库里是密文')
    } finally {
      await q('UPDATE orders SET contact_phone_enc = ?, contact_phone_sealed = ? WHERE id = ?', [ord.contact_phone_enc, ord.contact_phone_sealed, ord.id])
    }
  })
  await t('secrets-key check 覆盖联系电话新列，且全部可解密', async () => {
    const out = execFileSync(process.execPath, ['scripts/secrets-key.mjs', 'check'], { encoding: 'utf8', env: process.env })
    assert.match(out, /已加密联系电话（商户申请 \/ 订单）\d+ 条；可解密 \d+ 条/); assert.ok(!/无法解密/.test(out), out)
  })

  console.log('== 冻结后暂停佣金与提现 ==')
  await q('INSERT INTO promoter (user_id, tier, rate_bp, status) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE status = 1', [U1.id, 1, 500])
  const addCommission = async (offset, amount) => {
    const r = await q('INSERT INTO commission (order_id, promoter_id, base_amount, rate_bp, amount, status, payable_at) VALUES (?,?,?,?,?,0, NOW() - INTERVAL 1 DAY)',
      [fakeOrder + offset, U1.id, amount * 20, 500, amount])
    created.commission.push(r.insertId)
    return r.insertId
  }
  const cstatus = async (id) => Number((await one('SELECT status FROM commission WHERE id = ?', [id])).status)
  await t('冻结期间到期佣金不放行；解冻后下一次放行才转为可提现', async () => {
    const c1 = await addCommission(1, 12000)
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 0, reason: '测试冻结暂停佣金' }, A))
    await promo.settleDue()
    assert.equal(await cstatus(c1), 0, '冻结中仍应是观察期')
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 1 }, A))
    await promo.settleDue()
    assert.equal(await cstatus(c1), 1, '解冻后应放行')
  })
  await t('冻结期间新产生的佣金照常累计，只是不放行（不丢失）', async () => {
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 0, reason: '测试冻结继续累计' }, A))
    const c2 = await addCommission(2, 8000)
    await promo.settleDue()
    assert.equal(await cstatus(c2), 0)
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 1 }, A))
  })
  await t('冻结中的提现申请：后台不能"通过打款"，可以驳回；解冻后可通过', async () => {
    const w1 = (await q('INSERT INTO promoter_withdraw (promoter_id, amount, proposer_note) VALUES (?,?,?)', [U1.id, 12000, 'test-freeze'])).insertId
    const w2 = (await q('INSERT INTO promoter_withdraw (promoter_id, amount, proposer_note) VALUES (?,?,?)', [U1.id, 8000, 'test-freeze'])).insertId
    created.withdraw.push(w1, w2)
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 0, reason: '测试冻结暂停提现' }, A))
    const list = ok(await call('GET', '/admin/withdrawals', null, A)).rows // T03：提现列表改分页契约
    assert.equal(Number(list.find((w) => w.id === w1).user_status), 0, '列表应带出冻结状态')
    const blocked = await call('POST', `/admin/withdrawals/${w1}/verdict`, { pass: true, payRef: 'TESTREF0001' }, A)
    assert.notEqual(blocked.code, 0); assert.match(blocked.msg, /冻结/)
    assert.equal(Number((await one('SELECT status FROM promoter_withdraw WHERE id = ?', [w1])).status), 0, '仍应是待审')
    ok(await call('POST', `/admin/withdrawals/${w2}/verdict`, { pass: false }, A)) // 驳回不受限
    assert.equal(Number((await one('SELECT status FROM promoter_withdraw WHERE id = ?', [w2])).status), 2)
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 1 }, A))
    ok(await call('POST', `/admin/withdrawals/${w1}/verdict`, { pass: true, payRef: 'TESTREF0001' }, A))
    assert.equal(Number((await one('SELECT status FROM promoter_withdraw WHERE id = ?', [w1])).status), 1)
  })
  await t('冻结期间旅豆：订单返豆记为待补发、不能抵扣；解冻后补发一次，重跑不重复', async () => {
    const src = await one('SELECT id, order_no, user_id, status, amount_pay, bean_rebate_deferred FROM orders WHERE amount_pay > 0 ORDER BY id LIMIT 1')
    assert.ok(src, '隔离库需先 seed:scenario，库里应有已支付订单')
    const ledger = async () => Number((await one(`SELECT COUNT(*) n FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE a.user_id = ? AND l.biz_type = 1 AND l.direction = 1 AND l.biz_ref = ?`, [U1.id, src.order_no])).n)
    try {
      await q('UPDATE orders SET user_id = ?, status = 50, bean_rebate_deferred = 0 WHERE id = ?', [U1.id, src.id])
      const before = await bean.balance(U1.id)
      ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 0, reason: '测试冻结暂停旅豆' }, A))
      assert.equal(await bean.rebateOrder({ order_no: src.order_no, user_id: U1.id, amount_pay: src.amount_pay }), 0)
      assert.equal(Number((await one('SELECT bean_rebate_deferred d FROM orders WHERE id = ?', [src.id])).d), 1, '应记为待补发')
      assert.equal(await ledger(), 0, '冻结期间不应发放')
      await assert.rejects(bean.deduct(U1.id, 1, bean.BIZ.DEDUCT, 'test-frozen-deduct'), /旅豆暂停使用/)
      const r = ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 1 }, A))
      assert.equal(r.beanRebatesReleased, 1)
      assert.equal(Number((await one('SELECT bean_rebate_deferred d FROM orders WHERE id = ?', [src.id])).d), 0)
      assert.equal(await ledger(), 1)
      assert.equal(await bean.balance(U1.id), before + await bean.rebateOf(Number(src.amount_pay)))
      assert.equal(await bean.releaseDeferredRebates(U1.id), 0, '重跑不应重复发放')
      assert.equal(await ledger(), 1)
    } finally {
      await q('UPDATE orders SET user_id = ?, status = ?, bean_rebate_deferred = ? WHERE id = ?', [src.user_id, src.status, src.bean_rebate_deferred, src.id])
      await q('UPDATE user_account SET status = 1 WHERE id = ?', [U1.id])
    }
  })
  await t('冻结账号自己发起提现：被拒绝（含已登录会话）', async () => {
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 0, reason: '测试冻结拒绝提现' }, A))
    const r = await call('POST', '/c/promote/withdraw', { note: 'x' }, U1.token)
    assert.notEqual(r.code, 0)
    assert.equal(await promo.isUserFrozen(U1.id), true)
    ok(await call('POST', `/admin/users/${U1.id}/status`, { status: 1 }, A))
    assert.equal(await promo.isUserFrozen(U1.id), false)
  })
} finally {
  if (created.commission.length) await q('DELETE FROM commission WHERE id IN (?)', [created.commission])
  if (created.withdraw.length) {await q('DELETE FROM promoter_pay_ref WHERE withdraw_id IN (?)',[created.withdraw]);await q('DELETE FROM promoter_withdraw WHERE id IN (?)', [created.withdraw])}
  if (created.merchant.length) await q('DELETE FROM merchant WHERE id IN (?)', [created.merchant])
  await q('DELETE FROM promoter WHERE user_id = ?', [U1.id])
  await q('UPDATE user_account SET status = 1, mobile_enc = NULL, mobile_hmac = NULL WHERE id IN (?)', [uids])
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
