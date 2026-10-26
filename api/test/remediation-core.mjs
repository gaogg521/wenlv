// 隔离验收库专用：不重置现有库；测试二维码可解码、真实签名/加密回调、门店边界与结算状态。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
if (!/^wanderlust_qa_/.test(process.env.DB_NAME || '')) throw new Error('仅允许隔离验收库')
const { q, one } = await import('../src/db.mjs')
const { setSecret, getSecret, delSecret } = await import('../src/infra/secrets.mjs')
const wxpay = await import('../src/domain/wxpay.mjs')
const { routes } = await import('../src/routes.mjs')
const { jwtSign } = await import('../src/auth.mjs')
const pass = await import('../src/domain/pass.mjs')
let count = 0
const ok = (name) => { count++; console.log('PASS', name) }
const req = (token, body = {}, params = {}) => ({ headers: { authorization: 'Bearer ' + token }, body, params, query: {} })
const admin = jwtSign({ uid: 1, end: 'admin', role: 'super', name: 'remediation-qa' })

// 从真正页面使用的编码函数渲染 PNG，再交给独立解码库；不能只比对生成器输出。
let page
globalThis.Page = p => { page = p }
const require = createRequire(import.meta.url)
require('../../mini-a/package-order/pages/pass-code/index.js')
const payload = pass.qrPayload(123, Math.floor(Date.now() / 60000))
const matrix = page.qrCells(payload), scale = 8, size = matrix.qrSize * scale
const png = new PNG({ width: size, height: size })
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4, black = matrix.cells[Math.floor(y / scale) * matrix.qrSize + Math.floor(x / scale)]
  png.data[i] = png.data[i + 1] = png.data[i + 2] = black ? 0 : 255; png.data[i + 3] = 255
}
assert.equal(jsQR(new Uint8ClampedArray(png.data), size, size)?.data, payload)
fs.mkdirSync('test/evidence-20261026', { recursive: true })
fs.writeFileSync('test/evidence-20261026/qr-roundtrip.png', PNG.sync.write(png)); ok('页面二维码 PNG 独立解码与 HMAC 载荷一致')

// 模拟微信 HTTPS 传输，真实执行 RSA 签名与 AES-GCM 解密，绝不调用外部支付。
const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const priv = key.privateKey.export({ type: 'pkcs8', format: 'pem' }), pub = key.publicKey.export({ type: 'spki', format: 'pem' })
const values = { WX_APPID: 'qa-app', WX_MCHID: 'qa-mch', WX_SERIAL: 'qa-serial', WX_PRIVATE_KEY: priv, WX_NOTIFY_URL: 'https://qa.invalid/callback/wxpay', WX_PLATFORM_PUBLIC_KEY: pub, WX_PLATFORM_SERIAL: 'qa-platform', WX_API_V3_KEY: '0123456789abcdef0123456789abcdef' }
const backup = Object.fromEntries(await Promise.all(Object.keys(values).map(async k => [k, await getSecret(k)])))
const originalRequest = https.request
try {
  for (const [k, v] of Object.entries(values)) await setSecret(k, v, 'remediation-test')
  wxpay.invalidateConfig()
  https.request = (options, cb) => {
    const emitter = new EventEmitter(); let body = ''
    emitter.write = v => { body += v }
    emitter.end = () => {
      const auth = options.headers.Authorization, ts = /timestamp="([^"]+)"/.exec(auth)[1], nonce = /nonce_str="([^"]+)"/.exec(auth)[1], sig = /signature="([^"]+)"/.exec(auth)[1]
      assert(crypto.verify('RSA-SHA256', Buffer.from(`${options.method}\n${options.path}\n${ts}\n${nonce}\n${body}\n`), pub, Buffer.from(sig, 'base64')))
      assert.equal(JSON.parse(body).notify_url, values.WX_NOTIFY_URL)
      const response = new EventEmitter(); response.statusCode = 200; cb(response)
      queueMicrotask(() => { response.emit('data', JSON.stringify({ prepay_id: 'qa-prepay' })); response.emit('end') })
    }
    return emitter
  }
  const payment = await wxpay.jsapiOrder({ orderNo: 'QA-CALLBACK', amountFen: 29800, openid: 'qa-openid', description: 'QA' })
  assert.equal(payment.mock, false)
  assert(crypto.verify('RSA-SHA256', Buffer.from(`qa-app\n${payment.timeStamp}\n${payment.nonceStr}\n${payment.package}\n`), pub, Buffer.from(payment.paySign, 'base64')))
  ok('真实支付下单签名、notify_url 与客户端 paySign')
  const transaction = { appid: values.WX_APPID, mchid: values.WX_MCHID, trade_state: 'SUCCESS', out_trade_no: 'QA-CALLBACK', transaction_id: 'qa-trans', amount: { total: 29800, currency: 'CNY' } }
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(values.WX_API_V3_KEY), Buffer.from('123456789012')); cipher.setAAD(Buffer.from('transaction'))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()])
  const raw = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: { algorithm: 'AEAD_AES_256_GCM', nonce: '123456789012', associated_data: 'transaction', ciphertext: encrypted.toString('base64') } })
  const ts = String(Math.floor(Date.now() / 1000)), nonce = 'qa-nonce'
  const headers = { 'wechatpay-timestamp': ts, 'wechatpay-nonce': nonce, 'wechatpay-serial': 'qa-platform', 'wechatpay-signature': crypto.sign('RSA-SHA256', Buffer.from(`${ts}\n${nonce}\n${raw}\n`), priv).toString('base64') }
  assert.deepEqual((await wxpay.verifyCallback(headers, raw)).transaction, transaction); ok('签名验证与 AES-GCM 回调解密')
  assert.equal((await wxpay.verifyCallback(headers, raw.replace('transaction', 'tampered'))).ok, false); ok('拒绝篡改回调')
  assert.equal((await wxpay.verifyCallback({}, JSON.stringify(transaction))).ok, false); ok('拒绝明文伪造支付通知')
} finally {
  https.request = originalRequest
  for (const [k, v] of Object.entries(backup)) { if (v) await setSecret(k, v, 'restore-qa'); else await delSecret(k) }
  wxpay.invalidateConfig()
}

const stamp = Date.now().toString()
const merchant = await one('SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1')
const login = await routes['POST /m/auth/login'](req('', { code: 'mock-qa-new-' + stamp }))
assert(login.unbound); ok('陌生商户登录获得未绑定会话')
await assert.rejects(() => routes['POST /m/auth/login'](req('', { code: 'mock-qa-new-' + stamp, merchantId: merchant.id })), /未绑定/)
ok('传门店 ID 无法自动入职')
const user = await one('SELECT id FROM user_account WHERE mini_b_openid = ?', ['mock-openid-mock-qa-new-' + stamp])
await q('INSERT INTO merchant_staff (merchant_id,user_id,role) VALUES (?,?,3)', [merchant.id, user.id])
const owner = await routes['POST /m/auth/login'](req('', { code: 'mock-qa-new-' + stamp, merchantId: merchant.id }))
await routes['GET /m/workbench'](req(owner.token)); ok('合法老板可访问工作台')
await assert.rejects(() => routes['GET /m/workbench'](req(jwtSign({ uid: user.id, end: 'c' }))), /商户账号/); ok('拒绝游客 JWT 跨端访问')
await q('UPDATE merchant_staff SET status = 0 WHERE merchant_id = ? AND user_id = ?', [merchant.id, user.id])
await assert.rejects(() => routes['GET /m/workbench'](req(owner.token)), /停用/); ok('停用店员后旧 JWT 立即失效')
await q('UPDATE merchant_staff SET status = 1 WHERE merchant_id = ? AND user_id = ?', [merchant.id, user.id])
const sid = (await q(`INSERT INTO settlement (merchant_id,period,order_count,total_amount,amt_fulfill,amt_service,amt_promoter,amt_beanbudget,amt_retained,status) VALUES (?, ?,1,29800,17280,3580,2380,1490,5070,0)`, [merchant.id, 'QA' + stamp.slice(-9)])).insertId
await assert.rejects(() => routes['POST /admin/settlements/:id/confirm'](req(admin, {}, { id: sid })), /商户已确认/); ok('财务不能跳过商户确认')
await routes['POST /m/settlements/:id/confirm'](req(owner.token, {}, { id: sid }))
await routes['POST /admin/settlements/:id/confirm'](req(admin, {}, { id: sid }))
assert.equal((await one('SELECT status FROM settlement WHERE id = ?', [sid])).status, 2); ok('复核后保持待支付，不伪装完成')
await assert.rejects(() => routes['POST /admin/settlements/:id/payment'](req(admin, { paymentRef: '', note: '' }, { id: sid })), /真实支付流水/); ok('无支付证据不能登记完成')
await routes['POST /admin/settlements/:id/payment'](req(admin, { paymentRef: 'QA-RECEIPT-' + stamp, note: '隔离验收用回单，不代表真实资金到账' }, { id: sid }))
assert.equal((await one('SELECT status FROM settlement WHERE id = ?', [sid])).status, 3); ok('回单登记与审计留痕')
await assert.rejects(() => routes['POST /admin/settlements/:id/confirm'](req(admin, {}, { id: sid })), /商户已确认/); ok('已完成结算不能重复复核')
const old = await pass.verifyScan({ merchantId: merchant.id, staffId: user.id, payload: pass.qrPayload(1, 1), cityCode: '310118' })
assert.equal(old.ok, false); ok('拒绝历史窗口签名码')
const order = await import('../src/domain/order.mjs')
const promo = await import('../src/domain/promo.mjs')
const session = await one('SELECT s.id FROM tour_session s JOIN tour_product p ON p.id=s.product_id WHERE p.merchant_id=? AND p.status=1 AND s.status=1 AND s.quota>s.booked LIMIT 1', [merchant.id])
const placed = await order.place({ userId:user.id, sessionId:session.id, qty:1, wantedBeans:0 })
await Promise.all(Array.from({length:8}, () => order.acceptPayment(placed.orderNo,'QA-TX-'+stamp,true)))
const paidOrder = await order.byNo(placed.orderNo)
assert.equal(paidOrder.status,30)
assert.equal(Number((await one('SELECT COUNT(*) c FROM payment WHERE order_id=?',[paidOrder.id])).c),1)
assert.equal(Number((await one('SELECT COUNT(*) c FROM travel_pass WHERE order_id=?',[paidOrder.id])).c),1)
ok('8 个并发支付回调只入账一次、出票一次且状态一致')
const ticket = await one('SELECT id FROM travel_pass WHERE order_id=?',[paidOrder.id])
const current = await pass.currentQr(ticket.id)
const foreign = await pass.verifyScan({merchantId:Number(merchant.id)+99999,staffId:user.id,payload:current.qr,cityCode:'310118'})
assert.equal(foreign.ok,false);assert.match(foreign.reason,/本店/);ok('异店无法核销有效二维码')
await assert.rejects(() => routes['GET /c/pass/:id/code'](req(jwtSign({uid:999999,end:'c'}),{},{id:ticket.id})), /凭证不存在/)
ok('其他游客无法获取该凭证的动态码')
const scans = await Promise.all(Array.from({length:8},()=>pass.verifyScan({merchantId:merchant.id,staffId:user.id,payload:current.qr,cityCode:'310118'})))
assert.equal(scans.filter(x=>x.ok).length,1);ok('8 次并发扫码仅一次成功')
await order.fire(placed.orderNo,'OBSERVE_END','qa')
const period='QR'+stamp.slice(-9), settlementId=await promo.generateSettlement(merchant.id,period)
await q('UPDATE settlement SET status=1 WHERE id=?',[settlementId])
assert.equal(await promo.generateSettlement(merchant.id,period),settlementId)
assert.equal((await one('SELECT status FROM settlement WHERE id=?',[settlementId])).status,1)
ok('重复出账不重建结算单、不抹除商户确认状态')
await q('UPDATE merchant_staff SET role=1 WHERE merchant_id=? AND user_id=?',[merchant.id,user.id])
const staffLogin = await routes['POST /m/auth/login'](req('',{code:'mock-qa-new-'+stamp}))
await assert.rejects(()=>routes['GET /m/settlements'](req(staffLogin.token)),/店长/);assert.equal((await routes['GET /m/workbench'](req(staffLogin.token))).todayGmv,'—');ok('核销员不能访问结算与门店流水')
await assert.rejects(()=>routes['GET /m/workbench'](req(owner.token)),/角色已变更/);ok('角色降级后旧高权限会话失效')
const beans=await import('../src/domain/bean.mjs')
const refunds=await import('../src/domain/refund.mjs')
const before=await one('SELECT booked FROM tour_session WHERE id=?',[session.id])
await assert.rejects(()=>order.place({userId:user.id,sessionId:session.id,qty:1,wantedBeans:10}),/余额不足/)
assert.equal((await one('SELECT booked FROM tour_session WHERE id=?',[session.id])).booked,before.booked)
ok('旅豆余额不足时订单与占位一起回滚')
const budget=await one('SELECT id FROM bean_budget WHERE status=1 LIMIT 1')
await beans.grant(user.id,100,beans.BIZ.TASK,'QA-GRANT-'+stamp,budget.id)
const withBeans=await order.place({userId:user.id,sessionId:session.id,qty:1,wantedBeans:10})
assert.equal(await beans.balance(user.id),90)
await q('UPDATE orders SET created_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE order_no=?',[withBeans.orderNo])
await order.closeTimeout()
assert.equal(await beans.balance(user.id),100)
await order.closeTimeout();assert.equal(await beans.balance(user.id),100)
ok('未支付订单超时返还抵扣豆，重复执行不重复返还')
const toRefund=await order.place({userId:user.id,sessionId:session.id,qty:1,wantedBeans:10})
await order.acceptPayment(toRefund.orderNo,'QA-REFUND-TX-'+stamp,true)
assert((await refunds.fullRefund({orderNo:toRefund.orderNo,reason:'QA退款',operator:'qa'})).refunded)
assert.equal((await order.byNo(toRefund.orderNo)).status,70)
assert.equal(await beans.balance(user.id),100)
ok('模拟支付后退款：订单、凭证、旅豆冲正一致')
const taskId=(await q('INSERT INTO content_task(task_no,title,brief,reward_beans,status,claimed_by) VALUES(?,?,?,200,2,?)',['QA-ATOMIC-'+stamp,'并发审核验收','QA',user.id])).insertId
const rewardBefore=await beans.balance(user.id)
const verdicts=await Promise.allSettled(Array.from({length:8},()=>routes['POST /admin/content-tasks/:id/verdict'](req(admin,{pass:true},{id:taskId}))))
assert.equal(verdicts.filter(v=>v.status==='fulfilled').length,1)
assert.equal(await beans.balance(user.id),rewardBefore+200)
assert.equal((await one('SELECT status FROM content_task WHERE id=?',[taskId])).status,3)
ok('8 次并发审核任务仅完成一次、奖励一次，同一事务提交')
fs.writeFileSync('test/evidence-20261026/core-result.json', JSON.stringify({ assertions: count, at: new Date().toISOString(), database: process.env.DB_NAME }, null, 2))
console.log('ALL PASS', count)
process.exit(0)
