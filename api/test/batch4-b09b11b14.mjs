// 第四批专项（隔离库）：B09 视频/结构化服务权益/受控预览数据、B11 渠道可见范围、B14 产品专属完成奖励。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('batch4-b09b11b14')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as bean from '../src/domain/bean.mjs'
import * as pkg from '../src/domain/package.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t, raw) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? (raw ? b : JSON.stringify(b)) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const token = uid => jwtSign({ end: 'c', uid })
const admin = jwtSign({ end: 'admin', role: 'super', name: 'b4-qa' })
const ops = jwtSign({ end: 'admin', role: 'ops', name: 'b4-ops' })
const date = offset => bizDay(offset)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()

let mid, pid, sid, uidA, uidB, tplSvc
try {
  await q('UPDATE promo_discount SET status = 0') // 定价清场
  mid = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'B4店' + stamp, 'travel', 'B4M' + stamp])).insertId
  for (const u of ['a', 'b']) {
    const r = await q('INSERT INTO user_account(nickname) VALUES(?)', ['b4-' + stamp + u]); const uid = r.insertId
    await q('INSERT INTO bean_account(user_id) VALUES(?)', [uid])
    if (u === 'a') uidA = uid; else uidB = uid
  }

  await check('B09：产品宣传视频（rich_desc.video）随详情下发；上传接口接受 mp4、拒绝 exe', async () => {
    pid = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','B4视频品',19900,?,1)", [mid])).insertId
    sid = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,19900,1)', [pid, date(60), 20, 1])).insertId
    await q("UPDATE tour_product SET rich_desc = ? WHERE id = ?", [JSON.stringify({ intro: '介绍', video: '/uploads/b4_video.mp4' }), pid])
    const det = ok(await call('GET', '/c/tours/' + pid, null, token(uidA)))
    const rich = typeof det.rich_desc === 'string' ? JSON.parse(det.rich_desc) : det.rich_desc
    assert.equal(rich.video, '/uploads/b4_video.mp4')
    // 上传接口：mp4 接受（小缓冲）、exe 拒绝、游客 403
    const mp4 = Buffer.from('AAAA').toString('base64')
    assert.equal((await call('POST', '/admin/uploads', { data: mp4, ext: 'mp4' }, null)).code, 1002)
    const up = ok(await call('POST', '/admin/uploads', { data: mp4, ext: 'mp4' }, admin))
    assert.ok(up.url.endsWith('.mp4'))
    assert.equal((await call('POST', '/admin/uploads', { data: mp4, ext: 'exe' }, admin)).code, 1001)
  })

  await check('B09：套餐项权益结构化——游客可见、订单项快照、商户待办展示（不含成本）', async () => {
    tplSvc = ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '深度讲解', kind: 2, merchantId: mid, unitPriceFen: 7900, qtyPerUnit: 1, benefitDesc: '含专业讲解 90 分钟', benefitRules: '出发前 24 小时可预约', reason: '隔离库权益配置' }, ops)).id
    ok(await call('POST', `/admin/products/${pid}/package-items`, { name: '门票项', kind: 1, merchantId: mid, unitPriceFen: 12000, qtyPerUnit: 1, benefitDesc: '成人门票一张', reason: '隔离库权益配置' }, ops))
    assert.equal((await call('POST', `/admin/products/${pid}/package-items`, { name: 'x', kind: 2, merchantId: mid, unitPriceFen: 1, qtyPerUnit: 1, benefitDesc: 'x'.repeat(501), reason: '隔离库权益校验' }, ops)).code, 1001)
    const tour = ok(await call('GET', '/c/tours/' + pid, null, token(uidA)))
    const svc = tour.packageItems.find(i => i.name === '深度讲解')
    assert.equal(svc.benefitDesc, '含专业讲解 90 分钟'); assert.equal(svc.benefitRules, '出发前 24 小时可预约')
    assert.ok(!JSON.stringify(tour.packageItems).includes('cost'))
    // 订单项快照
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'B4PAY-' + stamp, true)
    const it = await one('SELECT benefit_desc, benefit_rules FROM order_item WHERE order_id=(SELECT id FROM orders WHERE order_no=?) AND name=?', [r.orderNo, '深度讲解'])
    assert.equal(it.benefit_desc, '含专业讲解 90 分钟'); assert.equal(it.benefit_rules, '出发前 24 小时可预约')
    // 模板后改不改已售快照
    ok(await call('POST', `/admin/products/${pid}/package-items`, { id: tplSvc, name: '深度讲解', kind: 2, merchantId: mid, unitPriceFen: 7900, qtyPerUnit: 1, benefitDesc: '改后说明', reason: '改权益验证快照' }, ops))
    const it2 = await one('SELECT benefit_desc FROM order_item WHERE order_id=(SELECT id FROM orders WHERE order_no=?) AND name=?', [r.orderNo, '深度讲解'])
    assert.equal(it2.benefit_desc, '含专业讲解 90 分钟')
    global.b4Order = r.orderNo
  })

  await check('B11：visible_channels 限定渠道——非 main 渠道商品列表不可见、详情 1004；main 正常', async () => {
    const det = ok(await call('GET', '/c/tours/' + pid, null, token(uidA)))
    assert.equal(Number(det.id), Number(pid))
    await q("UPDATE tour_product SET profile = ? WHERE id = ?", [JSON.stringify({ visible_channels: ['pc'] }), pid])
    const list = ok(await call('GET', '/c/tours?cat=theme', null, token(uidA)))
    assert.ok(!list.some(x => Number(x.id) === Number(pid)), '限定 pc 渠道的商品不在游客列表')
    assert.equal((await call('GET', '/c/tours/' + pid, null, token(uidA))).code, 1004)
    await q("UPDATE tour_product SET profile = ? WHERE id = ?", [JSON.stringify({}), pid])
    const list2 = ok(await call('GET', '/c/tours?cat=theme', null, token(uidA)))
    assert.ok(list2.some(x => Number(x.id) === Number(pid)), '清空后恢复可见')
  })

  await check('B14：专属完成奖励——完成发额外豆、幂等只发一次、复完成不重复', async () => {
    await q("UPDATE tour_product SET profile = ? WHERE id = ?", [JSON.stringify({ reward_extra_beans: 200, reward_note: '完成加赠 200 豆' }), pid])
    const bbudget = (await q("INSERT INTO bean_budget(name,total,granted,returned,biz_owner,status) VALUES(?,?,0,0,'qa',1)", ['B4奖励预算', 1000000])).insertId
    await q('INSERT INTO bean_global_cap(id,cap_total,issued_sum,year) VALUES(1,100000000,0,YEAR(CURDATE())) ON DUPLICATE KEY UPDATE cap_total=cap_total', [])
    // 完成订单（观察期结束）
    await q('UPDATE travel_pass SET status = 2 WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)', [global.b4Order])
    await q("UPDATE order_item SET status = 1, service_done = 1 WHERE order_id = (SELECT id FROM orders WHERE order_no = ?) AND kind = 2", [global.b4Order])
    const oRow = await one('SELECT status FROM orders WHERE order_no = ?', [global.b4Order])
    if (Number(oRow.status) === 30) await order.fire(global.b4Order, 'VERIFY_ALL', 'b4-qa')
    const before = await bean.balance(uidA)
    const { completeOrder } = await import('../src/jobs.mjs')
    await completeOrder(global.b4Order)
    const after = await bean.balance(uidA)
    // 返豆（rebateOf 实付×10%）+ 专属 200
    const o = await one('SELECT amount_pay, insurance_fee FROM orders WHERE order_no=?', [global.b4Order])
    const expectRebate = Math.round((Number(o.amount_pay) - Number(o.insurance_fee || 0)) / 10 * 0.10)
    assert.equal(after - before, expectRebate + 200, `返豆${expectRebate}+专属200`)
    const led = await q("SELECT * FROM bean_ledger l JOIN bean_account a ON a.id=l.account_id WHERE a.user_id=? AND l.biz_ref LIKE ?", [uidA, 'PXTRA-' + global.b4Order])
    assert.equal(led.length, 1, '专属奖励账本一条（PXTRA-单号幂等）')
    // 手工再触发完成 → 不重复发
    await bean.productExtraReward({ ...(await one('SELECT * FROM orders WHERE order_no=?', [global.b4Order])) })
    assert.equal(await bean.balance(uidA), after, '幂等：重复完成不重复发')
    // 无配置产品：无额外奖励
    const pid2 = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','theme','B4无奖励品',9900,?,1)", [mid])).insertId
    const sid2 = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,9900,1)', [pid2, date(60), 20, 1])).insertId
    const r2 = await order.place({ userId: uidB, sessionId: sid2, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r2.orderNo, 'B4PAY2-' + stamp, true)
    const before2 = await bean.balance(uidB)
    await bean.productExtraReward({ ...(await one('SELECT * FROM orders WHERE order_no=?', [r2.orderNo])) })
    assert.equal(await bean.balance(uidB), before2, '无配置无额外发放')
  })

  console.log(`\n第四批专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
