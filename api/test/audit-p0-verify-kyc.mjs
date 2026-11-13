// P0 核销与安全回归（全量检查 20261106）：A-04 暗号核销定位 / A-06 实名信息加密与校验
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/audit-p0-verify-kyc.mjs')
import assert from 'node:assert/strict'
import { q, one, tx } from '../src/db.mjs'
import * as order from '../src/domain/order.mjs'

const BASE = process.env.API_BASE || ('http://127.0.0.1:' + (process.env.PORT || 8080))
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, (r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }
let passN = 0
const t = async (name, fn) => { try { await fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const stamp = Date.now().toString(36)
const created = { sessions: [], orders: [], productIds: [] }

const cLogin = async (tag) => {
  const code = 'mock-audp0v-' + tag + '-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  return { token: r.token, id: Number(r.user.id), code }
}

const PHRASE_USER = '江南烟雨入梦来' + stamp
const PHRASE_MERCHANT = '灯下故人归' + stamp

// 暗号夹具商品：今天出发 + 明天出发各一条团期（同频道同价）
const mkFixture = async () => {
  const pid = await tx(async (c) => c.ins(`INSERT INTO tour_product (title, cat, city_code, merchant_id, price_from, bean_gift, days_desc, status, phrase_user, phrase_merchant, profile)
    VALUES (?, 'script', '310118', (SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1), 10000, 0, '1天', 1, ?, ?, ?)`,
    ['P0暗号夹具·' + stamp, PHRASE_USER, PHRASE_MERCHANT, JSON.stringify({ phrase_alts: ['烟雨入梦'], phrase_start: '2020-01-01', phrase_end: '2099-12-31' })]))
  created.productIds.push(Number(pid))
  const today = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, CURDATE(), 10, 0, 1, 10000, 1)', [pid])
  const tomorrow = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 10, 0, 1, 10000, 1)', [pid])
  created.sessions.push(Number(today.insertId), Number(tomorrow.insertId))
  const mid = Number((await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id)
  const staff = await cLogin('staff')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,2)', [mid, staff.id])
  const mTok = ok(await call('POST', '/m/auth/login', { code: staff.code, merchantId: mid })).token
  return { pid: Number(pid), today: Number(today.insertId), tomorrow: Number(tomorrow.insertId), mid, mTok }
}
const placePaidOn = async (uid, sid) => {
  const r = await order.place({ userId: uid, sessionId: sid, qty: 3, wantedBeans: 0, withInsurance: false })
  created.orders.push(r.orderNo)
  await order.acceptPayment(r.orderNo, 'P0V' + r.orderNo, true)
  return r.orderNo
}
const cleanup = async () => {
  for (const no of created.orders) {
    await q('DELETE v FROM verification_log v JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no])
    await q('DELETE tp FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no])
    await q('DELETE FROM payment WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM order_event WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no])
    await q('DELETE FROM orders WHERE order_no = ?', [no])
  }
  await q('DELETE FROM tour_session WHERE id IN (?)', [created.sessions.length ? created.sessions : [0]])
  await q('DELETE FROM tour_product WHERE id IN (?)', [created.productIds.length ? created.productIds : [0]])
  await q('DELETE FROM kyc_application WHERE real_name LIKE ?', ['P0KYC%' + stamp])
}

console.log('== A-04 暗号核销 ==')

await t('A04-1 暗号命中多张在途订单时必须二次确认，不下发对答句、不核销', async () => {
  const { today, mTok } = await mkFixture()
  const ua = await cLogin('a04a'); const ub = await cLogin('a04b')
  const noA = await placePaidOn(ua.id, today)
  const noB = await placePaidOn(ub.id, today)
  const r = await call('POST', '/m/verify/phrase', { phrase: PHRASE_USER }, mTok)
  assert.equal(r.data.ok, false, '多人同码不得直接核销')
  assert.equal(r.data.needConfirm, true, '应要求二次确认（订单号/联系人选择）')
  assert.ok(Array.isArray(r.data.candidates) && r.data.candidates.length >= 2, '应返回候选订单供选择')
  assert.ok(r.data.candidates.every((c) => c.orderNo && c.contactName !== undefined), '候选包含订单号与联系人')
  assert.ok(!r.data.counterPhrase, '确认前不得下发商户对答句（此前会直接核销最新一单）')
})

await t('A04-2 带订单号确认后只核销该单；流水按凭证逐条记本店与暗号方式', async () => {
  const { today, mid, mTok } = await mkFixture()
  const ua = await cLogin('a04c'); const ub = await cLogin('a04d')
  const noA = await placePaidOn(ua.id, today)
  const noB = await placePaidOn(ub.id, today)
  const r = await call('POST', '/m/verify/phrase', { phrase: PHRASE_USER, orderNo: noA }, mTok)
  assert.equal(r.data.ok, true, r.data.reason || '')
  assert.equal(r.data.verified, 3, '3 张凭证全部核销')
  const passesA = await q('SELECT tp.status FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [noA])
  const passesB = await q('SELECT tp.status FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [noB])
  assert.ok(passesA.every((p) => Number(p.status) === 2), 'A 单凭证已核销')
  assert.ok(passesB.every((p) => Number(p.status) === 1), 'B 单凭证不受影响')
  const logs = await q(`SELECT v.merchant_id, v.method, v.staff_id FROM verification_log v
    JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ? AND v.result = 1`, [noA])
  assert.equal(logs.length, 3, '每张凭证一条流水')
  assert.ok(logs.every((l) => Number(l.merchant_id) === mid), `流水必须记本店 merchant_id（此前写死 0）`)
  assert.ok(logs.every((l) => Number(l.method) === 4), '流水方式应记暗号（4），不能记人工')
})

await t('A04-3 已退款/已核销订单返回失败且不下发对答句', async () => {
  const { today, mTok } = await mkFixture()
  const u = await cLogin('a04e')
  const no = await placePaidOn(u.id, today)
  const oid = (await one('SELECT id FROM orders WHERE order_no = ?', [no])).id
  await q('UPDATE orders SET status = 70, close_reason = ? WHERE id = ?', ['group_cancel', oid])
  await q('UPDATE travel_pass SET status = 4 WHERE order_id = ?', [oid])
  const r = await call('POST', '/m/verify/phrase', { phrase: PHRASE_USER, orderNo: no }, mTok)
  assert.equal(r.data.ok, false, '已退款订单不得核销（此前返回 ok:true「已核销 0 张」）')
  assert.ok(!r.data.counterPhrase, '失败时不得下发对答句')
  const r2 = await call('POST', '/m/verify/phrase', { phrase: '完全对不上的暗号' + stamp }, mTok)
  assert.equal(r2.data.ok, false, '错误暗号失败')
  assert.ok(!r2.data.counterPhrase, '错误暗号不下发对答句')
})

await t('A04-4 只匹配当日可核销团期：明晚出发的订单不能被暗号核销', async () => {
  const { today, tomorrow, mid, mTok } = await mkFixture()
  const u = await cLogin('a04f')
  const noTomorrow = await placePaidOn(u.id, tomorrow)
  const r = await call('POST', '/m/verify/phrase', { phrase: PHRASE_USER, orderNo: noTomorrow }, mTok)
  assert.equal(r.data.ok, false, '非当日团期不得用暗号核销')
  assert.ok(!r.data.counterPhrase, '不下发对答句')
  const passes = await q('SELECT tp.status FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [noTomorrow])
  assert.ok(passes.every((p) => Number(p.status) === 1), '凭证未被改写（此前改写后订单 20 会抛非法流转）')
})

console.log('== A-06 实名信息（KYC） ==')

const ID = { enc: null, mask: null }
await t('A06-1 提交入口已下线：新提交被拒绝且不落库', async () => {
  const u = await cLogin('a06a')
  const r = await call('POST', '/c/kyc/submit', { realName: 'P0KYC张' + stamp, idNo: '11010119900307123X' }, u.token)
  assert.notEqual(r.code, 0, '实名入口下线后提交应被拒绝')
  assert.ok(/暂停|升级|下线/.test(r.msg || ''), '给出明确的下线提示')
  const row = await one('SELECT id FROM kyc_application WHERE real_name = ?', ['P0KYC张' + stamp])
  assert.ok(!row, '不得新建 KYC 档案')
})

await t('A06-2 身份证号校验：18 位校验码 + 出生日期；全 X 拒绝', async () => {
  const { validateIdNo } = await import('../src/infra/idcard.mjs')
  assert.equal(validateIdNo('11010119900307123X').ok, false, '校验码错误的号码拒绝（原实现放行）')
  assert.equal(validateIdNo('XXXXXXXXXXXXXXXXXX').ok, false, '全 X 拒绝')
  assert.equal(validateIdNo('110101199013071231').ok, false, '13 月拒绝（出生日期校验）')
  assert.equal(validateIdNo('110101199003071231').ok, false, '尾号与校验码不符拒绝')
  // 110101199003070 bonnes：构造一位校验码正确的号码 11010119900307077X? 用标准算法算出合法样例
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const m = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const base = '11010119900307123'
  const sum = base.split('').reduce((s, ch, i) => s + Number(ch) * w[i], 0)
  const valid = base + m[sum % 11]
  assert.equal(validateIdNo(valid).ok, true, '校验码正确的号码放行：' + valid)
  assert.equal(validateIdNo('1101011990030712').ok, false, '不足 18 位拒绝')
})

await t('A06-3 存量加密：id_no_enc 不再是明文；解密可还原；掩码与姓名保留', async () => {
  const u = await cLogin('a06c')
  const uid = u.id
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const m = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const base = '11010119880505456'
  const validId = base + m[base.split('').reduce((s, ch, i) => s + Number(ch) * w[i], 0) % 11]
  // 模拟存量明文行（旧实现 Buffer.from(id + '|' + name)）
  await q(`INSERT INTO kyc_application (user_id, real_name, id_no_enc, id_no_mask, status)
    VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE real_name = VALUES(real_name), id_no_enc = VALUES(id_no_enc), id_no_mask = VALUES(id_no_mask), status = 0, reject_note = NULL, reviewed_at = NULL`,
    [uid, 'P0KYC存量' + stamp, Buffer.from(validId + '|存量测试', 'utf8'), validId.slice(0, 3) + '***********' + validId.slice(-4)])
  const before = await one('SELECT id, id_no_enc FROM kyc_application WHERE user_id = ?', [uid])
  assert.ok(Buffer.from(before.id_no_enc).includes(Buffer.from(validId, 'utf8')), '夹具确实是明文存量')
  const { encryptLegacyIdCards } = await import('../scripts/encrypt-idcards.mjs')
  const n = await encryptLegacyIdCards()
  assert.ok(n >= 1, '至少加密 1 条存量')
  const after = await one('SELECT id_no_enc, id_no_mask, real_name FROM kyc_application WHERE user_id = ?', [uid])
  assert.ok(!Buffer.from(after.id_no_enc).includes(Buffer.from(validId, 'utf8')), '加密后不再是明文字节')
  assert.ok(!Buffer.from(after.id_no_enc).includes(Buffer.from('存量测试', 'utf8')), '姓名也不再明文')
  assert.equal(after.id_no_mask, validId.slice(0, 3) + '***********' + validId.slice(-4), '掩码不变')
  assert.equal(after.real_name, 'P0KYC存量' + stamp, '姓名列保留')
  const { openIdNo } = await import('../src/infra/idcard.mjs')
  ID.enc = after.id_no_enc
  ID.mask = after.id_no_mask
  const opened = openIdNo(after.id_no_enc)
  assert.ok(opened === validId, '授权方（审核）可解密还原号码')
  // 幂等：再跑一遍不重复加密、不损坏
  const again = await encryptLegacyIdCards()
  const final = await one('SELECT id_no_enc FROM kyc_application WHERE user_id = ?', [uid])
  assert.equal(Buffer.compare(Buffer.from(final.id_no_enc), Buffer.from(after.id_no_enc)), 0, '重复执行不改变已加密数据')
})

await t('A06-4 游客与后台只下发掩码，不出现完整号码或密文列', async () => {
  const row = await one("SELECT user_id FROM kyc_application WHERE real_name LIKE ? LIMIT 1", ['P0KYC存量' + stamp])
  assert.ok(row, '存在夹具档案')
  // 游客侧 mine：掩码可下发，完整号码/密文不可
  const uRows = await q('SELECT mini_a_openid FROM user_account WHERE id = ?', [row.user_id])
  const code = String(uRows[0].mini_a_openid || '').replace('mock-openid-', '')
  const mine = await call('GET', '/c/kyc/mine', null, ok(await call('POST', '/c/auth/login', { code })).token)
  const mineBody = JSON.stringify(mine)
  assert.ok(!/\d{17}[\dX]/.test(mineBody), '游客侧不下发完整号码')
  assert.ok(!mineBody.includes('id_no_enc'), '游客侧不下发密文列')
  // 后台用户画像：不得含密文列与完整号码
  const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const prof = await call('GET', '/admin/users/' + Number(row.user_id), null, A)
  const body = JSON.stringify(prof)
  assert.ok(!body.includes('id_no_enc'), '后台不下发密文列')
  assert.ok(!/\d{17}[\dX]/.test(body), '后台不出现完整号码')
})

await cleanup()
console.log(`\n${passN} 项通过`)
const { closeDb } = await import('../src/db.mjs')
await closeDb()
process.exit(process.exitCode || 0)
