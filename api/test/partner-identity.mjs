// 商户/景区独立 PC 身份专项（V82，隔离库，需先起隔离 API 服务）：
//   主体方账号创建（绑定主体校验）→ 真实登录（令牌带 subject）→ 行级隔离：
//   商户主体方只看本店订单/结算/商品；景区主体方只看本景区订单/算账/关联商户结算；
//   越权（他店订单详情/他店结算调整/他景区算账）拒绝；平台模块（资金工作台/参数中心）默认未授权。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('partner-identity')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import * as order from '../src/domain/order.mjs'
import * as promo from '../src/domain/promo.mjs'
import { bizDay, settlementPeriod } from '../src/infra/bizdate.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + process.env.PORT
const call = async (m, p, b, t) => (await fetch(base + p, { method: m, headers: t ? { authorization: 'Bearer ' + t, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = r => { assert.equal(r.code, 0, r.msg); return r.data }
const admin = jwtSign({ end: 'admin', role: 'super', name: 'pi-qa' })
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name) }
const stamp = Date.now()

let midA, midB, scenicId, uidA
let noA, noB
let acctM, acctS, tokM, tokS

try {
  await q('UPDATE promo_discount SET status = 0')
  // ===== 布景：两商户（A 有订单+结算；B 有订单+结算），景区 S1 绑 A 的产品 =====
  midA = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'PI门票店' + stamp, 'travel', 'PIA' + stamp])).insertId
  midB = (await q('INSERT INTO merchant(city_code,name,kind,merchant_no,status) VALUES(?,?,?,?,1)', ['310118', 'PI食肆店' + stamp, 'catering', 'PIB' + stamp])).insertId
  scenicId = (await q("INSERT INTO scenic_spot(city_code,name,scenic_level,coop_mode,status) VALUES('310118','PI景区(隔离验证)','4A','票务分成',1)", [])).insertId
  uidA = (await q('INSERT INTO user_account(nickname) VALUES(?)', ['pi-u-' + stamp])).insertId
  await q('INSERT INTO bean_account(user_id) VALUES(?)', [uidA])
  const pA = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,scenic_id,status) VALUES('main','310118','theme','PI门票品',10000,?,?,1)", [midA, scenicId])).insertId
  const sA = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,10000,1)', [pA, bizDay(0), 20, 1])).insertId
  const pB = (await q("INSERT INTO tour_product(channel,city_code,cat,title,price_from,merchant_id,status) VALUES('main','310118','shop','PI食肆品',5000,?,1)", [midB])).insertId
  const sB = (await q('INSERT INTO tour_session(product_id,depart_date,quota,min_go,price_adult,status) VALUES(?,?,?,?,5000,1)', [pB, bizDay(0), 20, 1])).insertId
  for (const [no, sid] of [['PIA', sA], ['PIB', sB]]) {
    const r = await order.place({ userId: uidA, sessionId: sid, qty: 1, wantedBeans: 0 })
    await order.acceptPayment(r.orderNo, 'PIPAY-' + no + '-' + stamp, true)
    await q("UPDATE orders SET status=40 WHERE order_no=?", [r.orderNo])
    const jobs = await import('../src/jobs.mjs')
    assert.equal(await jobs.completeOrder(r.orderNo), true)
    if (no === 'PIA') noA = r.orderNo; else noB = r.orderNo
  }
  const period = settlementPeriod(new Date())
  const settleA = await promo.generateSettlement(midA, period)
  const settleB = await promo.generateSettlement(midB, period)
  assert.ok(Number(settleA) > 0 && Number(settleB) > 0)

  // ===== 账号创建：绑定主体校验 =====
  await check('账号创建·主体校验：主体方必须绑定存在且正常营业的主体；内部角色忽略 subjectId', async () => {
    const bad1 = await call('POST', '/admin/accounts', { username: 'pi-m-x' + stamp, displayName: 'x', role: 'merchant_partner', password: 'pi-password-1' }, admin)
    assert.equal(bad1.code, 1001, '商户主体方缺绑定主体拒绝')
    const bad2 = await call('POST', '/admin/accounts', { username: 'pi-m-x' + stamp, displayName: 'x', role: 'merchant_partner', subjectId: 99999999, password: 'pi-password-1' }, admin)
    assert.equal(bad2.code, 1004, '绑定不存在商户拒绝')
    acctM = ok(await call('POST', '/admin/accounts', { username: 'pi-m-' + stamp, displayName: 'PI商户主体方', role: 'merchant_partner', subjectId: midA, password: 'pi-password-1' }, admin)).id
    acctS = ok(await call('POST', '/admin/accounts', { username: 'pi-s-' + stamp, displayName: 'PI景区主体方', role: 'scenic_partner', subjectId: scenicId, password: 'pi-password-2' }, admin)).id
    assert.ok(acctM > 0 && acctS > 0, '两个主体方账号创建成功')
  })

  // ===== 真实登录：令牌带 subject（ver 会话链路） =====
  await check('真实登录·令牌带绑定主体：merchant_partner 登录后按主体隔离', async () => {
    const lm = ok(await call('POST', '/admin/login', { username: 'pi-m-' + stamp, password: 'pi-password-1' }, null))
    tokM = lm.token
    assert.equal(lm.user.role, 'merchant_partner', '角色回显')
    const ls = ok(await call('POST', '/admin/login', { username: 'pi-s-' + stamp, password: 'pi-password-2' }, null))
    tokS = ls.token
  })

  // ===== 商户主体方：订单/结算/商品只看本店；越权拒绝 =====
  await check('商户主体方·行级隔离：订单/结算/商品只看本店，他店订单详情与结算调整拒绝，平台模块未授权', async () => {
    const orders = ok(await call('GET', '/admin/orders', null, tokM))
void orders
    assert.ok((orders.rows || orders).every(o => Number(o.merchant_id) === Number(midA)), '订单列表只含本店')
    assert.ok((orders.rows || orders).some(o => o.order_no === noA), '本店订单在列')
    const others = ok(await call('GET', '/admin/settlements', null, tokM))
    assert.ok(others.every(s => Number(s.merchant_id) === Number(midA)), '结算列表只含本店')
    assert.equal((await call('GET', `/admin/orders/${noB}`, null, tokM)).code, 1003, '他店订单详情拒绝')
    assert.equal((await call('GET', `/admin/settlements/${settleB}/adjustments`, null, tokM)).code, 1003, '他店结算调整拒绝')
    const prods = ok(await call('GET', '/admin/products', null, tokM))
    assert.ok(prods.every(p => Number(p.merchant_id) === Number(midA)), '商品列表只含本店')
    assert.equal((await call('GET', '/admin/fund-workbench', null, tokM)).code, 1003, '资金工作台模块未授权（平台资金不暴露给主体方）')
    assert.equal((await call('GET', '/admin/config', null, tokM)).code, 1003, '参数中心模块未授权')
  })

  // ===== 景区主体方：本景区算账/订单；他景区拒绝；结算按关联商户 =====
  await check('景区主体方·主体映射：本景区算账可用、他景区拒绝、订单只含本景区商品、结算只含关联商户', async () => {
    const calc = ok(await call('POST', `/admin/scenics/${scenicId}/calculator`, { from: bizDay(-1), to: bizDay(1), inputs: { orders: 100, priceFen: 10000, revenueBp: 2000, variableBp: 900, equityBp: 200, fixedFen: 0 } }, tokS))
    assert.ok(calc.fingerprint, '本景区算账可用')
    const scenic2 = (await q("INSERT INTO scenic_spot(city_code,name,scenic_level,coop_mode,status) VALUES('310118','PI他景区(隔离验证)','3A','引流合作',1)", [])).insertId
    assert.equal((await call('POST', `/admin/scenics/${scenic2}/calculator`, { from: bizDay(-1), to: bizDay(1), inputs: { orders: 100, priceFen: 10000, revenueBp: 2000, variableBp: 900, equityBp: 200, fixedFen: 0 } }, tokS)).code, 1004, '他景区算账拒绝')
    const orders = ok(await call('GET', '/admin/orders', null, tokS))
    assert.ok((orders.rows || orders).every(o => Number(o.product_id) === Number(pA)), '订单列表只含本景区商品订单（B店品未挂景区不可见）')
    const settles = ok(await call('GET', '/admin/settlements', null, tokS))
    assert.ok(settles.some(s => Number(s.id) === Number(settleA)), '本景区关联商户（A店）结算可见')
    assert.ok(!settles.some(s => Number(s.id) === Number(settleB)), '无景区关联商户（B店）结算不可见')
    assert.equal((await call('GET', `/admin/settlements/${settleB}/adjustments`, null, tokS)).code, 1003, '非关联商户结算调整拒绝')
    const prods = ok(await call('GET', '/admin/products', null, tokS))
    assert.ok(prods.every(p => Number(p.scenic_id) === Number(scenicId)), '商品列表只含本景区商品')
  })

  // ===== 改绑主体：epoch+1 旧会话失效，改绑即生效 =====
  await check('改绑主体·会话失效：角色改绑后旧令牌失效，需重新登录', async () => {
    ok(await call('POST', `/admin/accounts/${acctM}/role`, { role: 'merchant_partner', subjectId: midB, reason: 'PI隔离测试改绑主体' }, admin))
    assert.equal((await call('GET', '/admin/orders', null, tokM)).code, 1002, '旧会话已失效')
    const lm2 = ok(await call('POST', '/admin/login', { username: 'pi-m-' + stamp, password: 'pi-password-1' }, null))
    const orders2 = ok(await call('GET', '/admin/orders', null, lm2.token))
    assert.ok((orders2.rows || orders2).every(o => Number(o.merchant_id) === Number(midB)), '改绑后只看新主体（B店）订单')
  })

  console.log(`\n商户/景区独立 PC 身份专项通过 ${passed} 项`)
} finally {
  await closeDb()
}
