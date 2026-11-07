import automator from 'miniprogram-automator'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('audit-mini-walk')
const base = process.env.API_BASE
assert.ok(base && !base.includes(':8080'))
const call = async (path, body, token) => {
  const r = await (await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined })).json()
  assert.equal(r.code, 0, JSON.stringify(r)); return r.data
}
const { token } = await call('/c/auth/login', { code: 'mock-codex-mini-walk' })
await call('/c/consent', { scene: 'privacy', granted: true }, token)
const tours = await call('/c/tours?cat=all', null, token)
const product = tours[0]
const { q, closeDb } = await import('../src/db.mjs')
await q('UPDATE tour_product SET insurance_fee = 500 WHERE id = ?', [product.id])
const detail = await call('/c/tours/' + product.id, null, token)
const session = detail.sessions.find(x => Number(x.left_seats) > 0)
const order = await call('/c/orders', { sessionId: session.id, qty: 1, contactName: '模拟器验收', contactPhone: '13800001234', insurance: true }, token)
const admin = await call('/admin/login', { username: 'admin', password: 'admin123' })
await call('/admin/dev/mock-pay', { orderNo: order.orderNo }, admin.token)
await closeDb()
const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const errors = []
mini.on('console', m => { if(m.type === 'error') errors.push(m.args) })
mini.on('exception', e => errors.push(e))
await mini.evaluate((base, token) => { getApp().globalData.apiBase = base; getApp().globalData.token = token; wx.setStorageSync('token', token) }, base, token)
const out = 'test/evidence-p0-20261107/codex-final'
fs.mkdirSync(out, { recursive: true })
const pages = [
  ['home', '/pages/home/index'],
  ['booking', '/package-tour/pages/booking/index?id=' + product.id],
  ['create', '/package-content/pages/create/index'],
  ['square', '/package-content/pages/square/index'],
  ['pay-result', '/package-tour/pages/pay-result/index?orderNo=' + order.orderNo + '&mock=1'],
]
for (const [name, url] of pages) {
  const p = await mini.reLaunch(url)
  await new Promise(r => setTimeout(r, 1500))
  const data = await p.data()
  assert.ok(!data.error && !data.loadError, name + ': ' + JSON.stringify(data))
  if (name === 'booking') {
    assert.ok(data.p && data.priceSummary && data.p.hasInsurance, 'booking must load real insured product')
    await mini.evaluate(() => { const pages = getCurrentPages(); pages[pages.length - 1].toggleInsurance({ detail: { value: true } }) })
    assert.equal((await p.data()).priceSummary.insurance, '5.00')
  }
  if (name === 'home') assert.ok(!data.demo, 'home must load real isolated service')
  await mini.screenshot({ path: out + '/' + name + '.png' })
  if (name === 'booking') {
    await mini.evaluate(() => wx.pageScrollTo({ scrollTop: 10000, duration: 0 }))
    await new Promise(r => setTimeout(r, 200))
    await mini.screenshot({ path: out + '/booking-agreement.png' })
  }
  if (name === 'pay-result') {
    const labels = await Promise.all((await p.$$('.btn')).map(x => x.text()))
    assert.ok(labels.some(x => x.includes('订阅出行通知')), '订阅按钮应实际渲染')
  }
  console.log('OK', name, p.path)
}
fs.writeFileSync(out + '/console.json', JSON.stringify(errors, null, 2))
assert.equal(errors.length, 0, JSON.stringify(errors))
await mini.disconnect()
