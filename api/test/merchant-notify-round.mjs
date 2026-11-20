// 商户端权限与到单提醒 · DB 断言回归（M-01/02/03/04/07 + M-13 T-01，隔离库 + 服务在跑）
// 严格断言：每项必过，不写「失败就跳过」（上轮教训：吞错会放过真缺陷）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/merchant-notify-round.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import * as notify from '../src/domain/notify.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (method, path, body, tok) => (await fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, '期望成功: ' + (r.msg || JSON.stringify(r))); return r.data }
const fail = async (r, code, msgPart) => { assert.equal(r.code, code, '期望失败码 ' + code + ' 实际 ' + r.code + ':' + r.msg); if (msgPart) assert.ok(String(r.msg).includes(msgPart), '文案应含「' + msgPart + '」: ' + r.msg); return r }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
const stamp = 'MNQA' + Math.random().toString(36).slice(2, 10)
const cleanUsers = [], cleanSessions = [], cleanOrders = []
let merchantId = null, prodId = null

try {
  /* ---------- 夹具：完全自建（商户+商品+团期+三岗位），不依赖种子数据 ---------- */
  merchantId = (await q(`INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118', ?, ?, 1)`,
    [stamp + '测试门店', 'MN' + stamp])).insertId
  prodId = (await q(`INSERT INTO tour_product (city_code, cat, title, price_from, merchant_id, status) VALUES ('310118','experience',?, 10000, ?, 1)`,
    [stamp + '测试线路', merchantId])).insertId
  const prod = { id: prodId, merchant_id: merchantId, city_code: '310118' }
  const depart = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const mkStaff = async (tag, role) => {
    const uid = (await q('INSERT INTO user_account (mini_b_openid, nickname) VALUES (?,?)',
      ['mock-openid-mn-' + stamp + '-' + tag, stamp + tag])).insertId
    cleanUsers.push(uid)
    const sid = (await q('INSERT INTO merchant_staff (merchant_id, user_id, role, status) VALUES (?,?,?,1)',
      [merchantId, uid, role])).insertId
    // code2Session 的 mock openid = 'mock-openid-' + code，code 用 'mn-…' 让 openid 与上面的插入值一致
    const login = ok(await call('POST', '/m/auth/login', { code: 'mn-' + stamp + '-' + tag, merchantId }))
    assert.equal(Number(login.role), role, '登录角色应为 ' + role)
    return { uid, staffRowId: sid, token: login.token, nickname: stamp + tag }
  }
  const V = await mkStaff('v', 1)   // 核销员
  const M = await mkStaff('m', 2)   // 店长
  const B = await mkStaff('b', 3)   // 老板
  const mkSession = async (price = 10000) => {
    const sid = (await q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status, version)
      VALUES (?,?,?,?,?,?,1,1)`, [prod.id, depart, 10, 0, 1, price])).insertId
    cleanSessions.push(sid)
    return sid
  }
  const resetSession = async (sid) => { await q('UPDATE tour_session SET price_adult = 10000, early_price = NULL, early_days = NULL, quota = 10, booked = 0, status = 1, version = version + 1 WHERE id = ?', [sid]) }

  /* ---------- M-01：三角色 × 五入口 + 改岗实时生效 ---------- */
  const s1 = await mkSession()
  const entries = [
    ['单个改价', (t) => call('POST', '/m/supply/' + s1, { action: 'price', value: 9900 }, t)],
    ['批量改价', (t) => call('POST', '/m/supply/batch', { ids: [s1], action: 'price', value: 9900 }, t)],
    ['早鸟', (t) => call('POST', '/m/supply/' + s1, { action: 'early', value: { price: 8800, days: 3 } }, t)],
    ['调名额', (t) => call('POST', '/m/supply/' + s1, { action: 'adjust_quota', value: 12 }, t)],
    ['停售', (t) => call('POST', '/m/supply/' + s1, { action: 'stop_sell' }, t)],
    ['恢复', (t) => call('POST', '/m/supply/' + s1, { action: 'resume_sell' }, t)],
  ]
  await test('M-01 核销员(role1) 五入口全部 1003', async () => {
    for (const [name, fn] of entries) {
      await resetSession(s1)
      await fail(await fn(V.token), 1003, '需要店长及以上权限')
    }
  })
  await test('M-01 店长(role2) 五入口全部通过（负责人 11-19 指令：店长与老板都能改价）', async () => {
    for (const [name, fn] of entries) {
      await resetSession(s1)
      ok(await fn(M.token))
    }
    await resetSession(s1)
  })
  await test('M-01 老板(role3) 五入口全部通过', async () => {
    for (const [name, fn] of entries) {
      await resetSession(s1)
      ok(await fn(B.token))
    }
    await resetSession(s1)
  })
  await test('M-01 价格必须整数分（两位小数由前端限制，后端拒非整数分）', async () => {
    await resetSession(s1)
    await fail(await call('POST', '/m/supply/' + s1, { action: 'price', value: 99.5 }, M.token), 1001, '正整数')
  })
  await test('M-01 改岗后同一 token 立即按新角色（降权即拒、升权即通、停用即 1003）', async () => {
    await resetSession(s1)
    // 店长降为核销员：同一 token 立即不能改价
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 1, status: 1, reason: '降权测试' }, B.token))
    await fail(await call('POST', '/m/supply/' + s1, { action: 'price', value: 9900 }, M.token), 1003)
    // 升回店长：同一 token 立即恢复
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 2, status: 1, reason: '恢复测试' }, B.token))
    ok(await call('POST', '/m/supply/' + s1, { action: 'price', value: 9900 }, M.token))
    // 停用：同一 token 立即失效
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 2, status: 0, reason: '停用测试' }, B.token))
    await fail(await call('GET', '/m/workbench', null, M.token), 1003)
    // 启用恢复
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 2, status: 1, reason: '启用测试' }, B.token))
    ok(await call('GET', '/m/workbench', null, M.token))
    await resetSession(s1)
  })

  await test('M-01 验收补充：升权/降权对「接口内部角色门槛」同样即时生效（回复评价、门店码、改价）', async () => {
    await resetSession(s1)
    // 升权：核销员 token（role=1）被老板升为店长后，同一 token 能改价——此前接口内部 requireUser 重新解析 token 拿到旧角色，仍被 1003
    ok(await call('POST', '/m/staff/' + V.staffRowId, { role: 2, status: 1, reason: '升权验收' }, B.token))
    ok(await call('POST', '/m/supply/' + s1, { action: 'price', value: 9700 }, V.token))
    // 降权：店长 token（role=2）被降为核销员后，不再能回复评价 / 调门店码（这两个入口不在网关 manager 正则里，只靠接口内部 u.role 判定）
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 1, status: 1, reason: '降权验收' }, B.token))
    await fail(await call('POST', '/m/reviews/99999999/reply', { content: 'x' }, M.token), 1003)
    await fail(await call('GET', '/m/qrcode', null, M.token), 1003)
    // 还原，避免影响后续用例
    ok(await call('POST', '/m/staff/' + M.staffRowId, { role: 2, status: 1, reason: '还原' }, B.token))
    ok(await call('POST', '/m/staff/' + V.staffRowId, { role: 1, status: 1, reason: '还原' }, B.token))
    await resetSession(s1)
  })

  /* ---------- M-07：团期卡最近改价（谁、几点、旧→新） ---------- */
  await test('M-07 改价后 /m/supply 返回 priceChange（操作人昵称 + 时间 + 旧→新）', async () => {
    await resetSession(s1)
    ok(await call('POST', '/m/supply/' + s1, { action: 'price', value: 9200 }, M.token))
    const d = ok(await call('GET', '/m/supply?paged=1&page=1&pageSize=60&history=1', null, M.token))
    const row = d.items.find((x) => Number(x.id) === Number(s1))
    assert(row, '团期应在列表里')
    assert(row.priceChange, '应有 priceChange')
    assert.equal(Number(row.priceChange.from), 10000)
    assert.equal(Number(row.priceChange.to), 9200)
    assert.equal(String(row.priceChange.by), M.nickname, '操作人应为店长昵称')
    assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(String(row.priceChange.at)), '时间应为 MM-DD HH:mm: ' + row.priceChange.at)
  })

  /* ---------- M-02/M-04：提醒偏好默认值 + 过滤 + notify_log 收件人角色 ---------- */
  await test('M-02 默认偏好：老板/店长三项开，核销员三项关', async () => {
    const pb = ok(await call('GET', '/m/notify/prefs', null, B.token))
    const pm = ok(await call('GET', '/m/notify/prefs', null, M.token))
    const pv = ok(await call('GET', '/m/notify/prefs', null, V.token))
    for (const k of ['newOrder', 'refundApply', 'settlementPending']) {
      assert.equal(pb[k], true, '老板 ' + k + ' 默认开')
      assert.equal(pm[k], true, '店长 ' + k + ' 默认开')
      assert.equal(pv[k], false, '核销员 ' + k + ' 默认关')
    }
    assert.equal(pb.onboarded, false, '引导未确认')
  })
  await test('M-02 偏好可自改：核销员开新订单提醒再关闭', async () => {
    ok(await call('POST', '/m/notify/prefs', { newOrder: true }, V.token))
    assert.equal(ok(await call('GET', '/m/notify/prefs', null, V.token)).newOrder, true)
    ok(await call('POST', '/m/notify/prefs', { newOrder: false }, V.token))
    assert.equal(ok(await call('GET', '/m/notify/prefs', null, V.token)).newOrder, false)
  })
  await test('M-02/M-04 notifyMerchant 按偏好过滤 + notify_log 记收件人角色', async () => {
    const bizRef = 'MNQA-' + stamp + '-no1'
    // 当前：老板(role3)/店长(role2) new_order 开，核销员关
    const r = await notify.notifyMerchant(merchantId, { scene: 'new_order', bizRef, data: {} })
    assert.equal(r.sent, 2, '应只发给老板+店长两人')
    const logs = await q(`SELECT recipient_role, recipient_user_id, scene FROM notify_log WHERE scene='new_order' AND biz_ref = ?`, [bizRef])
    assert.equal(logs.length, 2)
    const roles = logs.map((l) => Number(l.recipient_role)).sort()
    assert.deepEqual(roles, [2, 3], '收件人角色应为店长2+老板3，核销员1被过滤')
    for (const l of logs) assert.ok(l.recipient_user_id, '应记录收件人 user_id')
    // 店长关掉新订单提醒后：只剩老板
    ok(await call('POST', '/m/notify/prefs', { newOrder: false }, M.token))
    const bizRef2 = 'MNQA-' + stamp + '-no2'
    const r2 = await notify.notifyMerchant(merchantId, { scene: 'new_order', bizRef: bizRef2, data: {} })
    assert.equal(r2.sent, 1, '店长关闭后只剩老板')
    const logs2 = await q(`SELECT recipient_role FROM notify_log WHERE scene='new_order' AND biz_ref = ?`, [bizRef2])
    assert.deepEqual(logs2.map((l) => Number(l.recipient_role)), [3])
    ok(await call('POST', '/m/notify/prefs', { newOrder: true }, M.token)) // 还原店长偏好
  })
  await test('M-02 工作台轮询接口：/m/notify/poll 返回 latestId/newPaid/pendingVerify', async () => {
    const d = ok(await call('GET', '/m/notify/poll?after=0', null, M.token))
    assert.ok('latestId' in d && 'newPaid' in d && 'pendingVerify' in d, '应有 latestId/newPaid/pendingVerify')
    const dv = ok(await call('GET', '/m/notify/poll?after=0', null, V.token))
    assert.ok(!('newPaid' in dv), '核销员不返回 newPaid（新订单提醒默认与其无关）')
  })

  /* ---------- M-03：岗位说明与真实权限同源 ---------- */
  await test('M-03 roleGuide 文案与门槛同源（店长含门店码/邀请码；老板含角色管理）', async () => {
    const site = ok(await call('GET', '/m/site', null, V.token))
    const g = site.roleGuide
    assert.ok(g[1].includes('核销'), '核销员说明应含「核销」')
    assert.ok(g[2].includes('门店码') && g[2].includes('店员邀请码'), '店长说明应含门店码与店员邀请码')
    assert.ok(g[2].includes('邀请进来的默认是核销员'), '店长说明应写邀请默认核销员')
    assert.ok(g[2].includes('改价'), '店长说明应含改价')
    assert.ok(g[3].includes('店员角色管理'), '老板说明应含店员角色管理')
  })
  await test('M-03 行为同源：/m/qrcode 与 /m/invite 都是 role>=2（核销员 1003、店长通过）', async () => {
    await fail(await call('GET', '/m/qrcode', null, V.token), 1003, '需要店长及以上权限')
    ok(await call('GET', '/m/qrcode', null, M.token))
    await fail(await call('GET', '/m/invite', null, V.token), 1003)
    ok(await call('GET', '/m/invite', null, M.token))
  })
  await test('M-03 店员管理仅老板：/m/staff 核销员/店长 1003、老板通过且带加入时间', async () => {
    await fail(await call('GET', '/m/staff', null, V.token), 1003)
    await fail(await call('GET', '/m/staff', null, M.token), 1003)
    const list = ok(await call('GET', '/m/staff', null, B.token))
    const me = list.find((s) => Number(s.user_id) === Number(M.uid))
    assert(me, '员工列表应含店长')
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(me.joined_at)), '应返回加入时间 YYYY-MM-DD')
  })

  /* ---------- M-13 T-01：游客订单/旅豆流水分页 ---------- */
  await test('T-01 /c/orders 分页：55 单按页取全，无 page 保持旧数组形态', async () => {
    const t = ok(await call('POST', '/c/auth/login', { code: 'mock-mn-' + stamp + '-tourist' }))
    const uid = t.user.id
    cleanUsers.push(uid)
    const noList = []
    for (let i = 0; i < 55; i++) {
      const no = 'MN' + stamp + String(i).padStart(3, '0')
      noList.push(no)
      await q(`INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, city_code, status, qty, amount_goods, amount_pay, channel)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'main')`, [no, uid, prod.id, s1, merchantId, prod.city_code, 50, 1, 10000, 10000])
    }
    const p1 = ok(await call('GET', '/c/orders?page=1&pageSize=10', null, t.token))
    assert.equal(p1.total, 55, '总数应为 55')
    assert.equal(p1.items.length, 10)
    assert.equal(p1.hasMore, true)
    // 翻完 6 页收集全部单号：第 55 单（最老）必须出现在最后一页
    const seen = new Set(p1.items.map((o) => o.order_no))
    let page = 1
    while (page < 10) {
      page++
      const d = ok(await call('GET', '/c/orders?page=' + page + '&pageSize=10', null, t.token))
      for (const o of d.items) seen.add(o.order_no)
      if (!d.hasMore) break
    }
    assert.equal(seen.size, 55, '翻页应覆盖全部 55 单，实际 ' + seen.size)
    assert.ok(seen.has(noList[0]), '最老订单（第 1 单）应能翻到')
    const legacy = await call('GET', '/c/orders', null, t.token)
    assert.equal(legacy.code, 0)
    assert.ok(Array.isArray(legacy.data), '不带 page 保持旧数组形态')
    await q('DELETE FROM orders WHERE user_id = ?', [uid])
    cleanOrders.push(uid)
  })
  await test('T-01 /c/bean/ledger 分页：25 条流水，第一页 20 条 + hasMore，可翻到余下 5 条', async () => {
    const t = ok(await call('POST', '/c/auth/login', { code: 'mock-mn-' + stamp + '-tourist2' }))
    const uid = t.user.id
    cleanUsers.push(uid)
    // 幂等：同 openid 复跑时账号可能已存在（login 自动建 user_account）
    await q('INSERT INTO bean_account (user_id, balance) VALUES (?,0) ON DUPLICATE KEY UPDATE balance = balance', [uid])
    const acc = (await one('SELECT id FROM bean_account WHERE user_id = ?', [uid])).id
    for (let i = 0; i < 25; i++) {
      await q(`INSERT INTO bean_ledger (account_id, tx_no, direction, amount, after_bal, biz_type, biz_ref) VALUES (?,?,?,?,?,1,?)`,
        [acc, 'MNL' + stamp + String(i).padStart(3, '0'), i % 2 ? 2 : 1, 100 + i, 1000 + i, 'MNQA-' + stamp + '-' + i])
    }
    const p1 = ok(await call('GET', '/c/bean/ledger?page=1&pageSize=20', null, t.token))
    assert.equal(p1.total, 25)
    assert.equal(p1.items.length, 20)
    assert.equal(p1.hasMore, true)
    const p2 = ok(await call('GET', '/c/bean/ledger?page=2&pageSize=20', null, t.token))
    assert.equal(p2.items.length, 5)
    assert.equal(p2.hasMore, false)
    const legacy = await call('GET', '/c/bean/ledger', null, t.token)
    assert.ok(Array.isArray(legacy.data), '不带 page 保持旧数组形态')
    await q('DELETE FROM bean_ledger WHERE account_id = ?', [acc])
    await q('DELETE FROM bean_account WHERE id = ?', [acc])
  })

  console.log('\nmerchant-notify-round：' + passed + ' 组断言全部通过')
} finally {
  // 夹具清理（自建员工/团期/商品/门店/通知日志/版本簿），不清理库内既有数据
  for (const uid of cleanUsers) {
    await q('DELETE FROM merchant_staff WHERE user_id = ?', [uid]).catch(() => {})
    await q('DELETE FROM user_account WHERE id = ?', [uid]).catch(() => {})
  }
  for (const sid of cleanSessions) await q('DELETE FROM tour_session WHERE id = ?', [sid]).catch(() => {})
  await q(`DELETE FROM notify_log WHERE biz_ref LIKE 'MNQA-${stamp}%'`).catch(() => {})
  await q(`DELETE FROM master_data_version WHERE kind = 'session' AND ref_id IN (${cleanSessions.map(() => '?').join(',') || '0'})`, cleanSessions).catch(() => {})
  await q('DELETE FROM tour_product WHERE id = ?', [prodId]).catch(() => {})
  await q('DELETE FROM merchant WHERE id = ?', [merchantId]).catch(() => {})
  closeDb()
}
process.exit(0)
