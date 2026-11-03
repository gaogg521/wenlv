import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-operations.mjs')
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'
import { openMobile, isLegacyPlain } from '../src/infra/mobile.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super','ops','finance','review','risk','city_partner'].map(role => [role, jwtSign({ end: 'admin', role, name: '操作回归-' + role, scopeCity: role === 'city_partner' ? '999999' : null })]))
const call = async (role, method, path, body) => (await fetch(base + path, { method, headers: { authorization: 'Bearer ' + tokens[role], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const no = 'OPQA' + Date.now(), phone = '13800009999'
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
try {
  await test('服务端能力表按六类角色下发，与真实操作权限一致', async () => {
    for (const role of Object.keys(tokens)) {
      const c = await call(role, 'GET', '/admin/capabilities')
      assert.equal(c.code, 0); assert.equal(c.data.role, role)
      assert.equal(c.data.actions['note.review'].allowed, ['super','review'].includes(role))
      assert.equal(c.data.actions['task.cashPaid'].allowed, ['super','finance'].includes(role))
      assert.equal(c.data.actions['entity.product.edit'].allowed, ['super','ops'].includes(role))
      assert.equal(c.data.actions['entity.merchant.create'].allowed, role === 'super')
      assert.equal(c.data.actions['entity.task.edit'].allowed, ['super','ops','review'].includes(role))
    }
  })
  const row = await one('SELECT * FROM orders ORDER BY id LIMIT 1')
  assert(row, '隔离库需要场景订单')
  await q(`INSERT INTO orders (order_no,user_id,product_id,session_id,city_code,merchant_id,qty,amount_goods,amount_pay,status,contact_name)
    VALUES (?,?,?,?,?,?,?,?,?,20,?)`, [no,row.user_id,row.product_id,row.session_id,row.city_code,row.merchant_id,1,10000,10000,'原联系人'])
  await test('超级管理员修正联系人：加密存储、脱敏返回、原因和操作人留痕，忽略金额/状态等越权字段', async () => {
    const r = await call('super','POST',`/admin/orders/${no}/contact`,{name:'修正联系人',phone,reason:'游客确认联系方式填写错误',amount_pay:1,status:50})
    assert.equal(r.code,0); assert.equal(r.data.contactPhone,'138****9999')
    const o = await one('SELECT * FROM orders WHERE order_no=?',[no])
    assert.equal(openMobile(o.contact_phone_sealed),phone); assert(!isLegacyPlain(o.contact_phone_sealed)); assert.equal(o.contact_phone_enc,null)
    assert.equal(Number(o.amount_pay),10000); assert.equal(Number(o.status),20)
    const detail = await call('super','GET',`/admin/orders/${no}`)
    assert.equal(detail.data.contact_name,'修正联系人'); assert(!JSON.stringify(detail).includes(phone))
    assert(detail.data.serviceRecords.some(x=>x.action==='contact-update'&&x.actor.includes('操作回归-super')))
    const log = await one("SELECT after_val FROM audit_log WHERE biz_ref=? AND action='contact-update' ORDER BY id DESC LIMIT 1",[no])
    assert(!JSON.stringify(log).includes(phone))
  })
  await test('空手机号保留原号码；新号码校验和原因校验在保存前生效', async () => {
    assert.equal((await call('ops','POST',`/admin/orders/${no}/contact`,{name:'再次修正',phone:'',reason:'核对联系人姓名后修正'})).code,0)
    assert.equal(openMobile((await one('SELECT contact_phone_sealed FROM orders WHERE order_no=?',[no])).contact_phone_sealed),phone)
    assert.equal((await call('super','POST',`/admin/orders/${no}/contact`,{name:'修正',phone:'123',reason:'号码格式测试'})).code,1001)
    assert.equal((await call('super','POST',`/admin/orders/${no}/contact`,{name:'修正',phone:'',reason:''})).code,1001)
  })
  await test('客服备注保存并读回；敏感号码不进入备注；已核销订单拒绝联系人修改', async () => {
    assert.equal((await call('ops','POST',`/admin/orders/${no}/service-notes`,{note:'已联系游客确认集合时间，等待到店核销'})).code,0)
    const d=await call('super','GET',`/admin/orders/${no}`)
    assert(d.data.serviceRecords.some(x=>x.action==='service-note'))
    assert.equal((await call('super','POST',`/admin/orders/${no}/service-notes`,{note:'游客手机'+phone})).code,1001)
    await q('UPDATE orders SET status=40 WHERE order_no=?',[no])
    assert.equal((await call('super','POST',`/admin/orders/${no}/contact`,{name:'不应写入',reason:'已核销状态修改测试'})).code,2002)
  })
  await test('财务/审核/风控/城市角色不能修改联系人；跨城订单详情与退款均被拒绝', async () => {
    for (const role of ['finance','review','risk','city_partner']) assert.equal((await call(role,'POST',`/admin/orders/${no}/contact`,{name:'越权',reason:'权限边界测试'})).code,1003)
    assert.equal((await call('city_partner','GET',`/admin/orders/${no}`)).code,1003)
    assert.equal((await call('city_partner','POST',`/admin/orders/${no}/refund`,{})).code,1003)
    assert.equal((await call('ops','POST','/admin/content/0/verdict',{pass:true})).code,1003)
    assert.equal((await call('ops','POST','/admin/task-entries/0/cash-paid',{ref:'QA-NO-PAY'})).code,1003)
  })
  console.log(`\n${passed} 项后台操作回归通过`)
} finally {
  await q("DELETE FROM audit_log WHERE module='order' AND biz_ref=?",[no])
  await q('DELETE FROM orders WHERE order_no=?',[no])
  await closeDb()
}
