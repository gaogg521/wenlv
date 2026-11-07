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
const note = await call('/c/notes', { title: '模拟器验收 · 江南的一天', body: '慢慢走过水乡，记录旅途里的好风景。', relatedProductId: product.id }, token)
await closeDb()
const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
let ready = false
for (let i = 0; i < 60 && !ready; i++) {
  try { ready = !!(await mini.currentPage()) && await mini.evaluate(() => typeof getApp === 'function' && !!getApp()) } catch {}
  if (!ready) await new Promise(r => setTimeout(r, 1000))
}
assert.ok(ready, '等待模拟器首屏与 App 就绪超时')
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
  ['note', '/package-content/pages/note/index?id=' + note.id],
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
  if (name === 'square') assert.ok(data.items.some(x => Number(x.id) === Number(note.id)), '已发布笔记必须出现在广场')
  if (name === 'note') {
    await (await p.$('.report-toggle')).tap()
    await new Promise(r => setTimeout(r, 300))
    assert.equal((await p.data()).liked, true, '详情点赞必须成功')
  }
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
if (process.env.ALL_PAGES === '1') {
  const config = JSON.parse(fs.readFileSync(new URL('../../mini-a/app.json', import.meta.url)))
  const paths = [...config.pages, ...config.subPackages.flatMap(s => s.pages.map(p => s.root + '/' + p))]
  for (const path of paths) {
    const page = await mini.reLaunch('/' + path)
    assert.equal(page.path, path)
    await new Promise(r => setTimeout(r, 400))
    console.log('REGISTERED', path)
  }
}
await mini.disconnect()
