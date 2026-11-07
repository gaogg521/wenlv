import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const load = (file, api, wx = {}) => {
  let page
  vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/' + file, import.meta.url), 'utf8'), { require: () => api, Page: p => { page = p }, wx })
  page.data = structuredClone(page.data)
  page.setData = (v, done) => { Object.assign(page.data, v); done?.() }
  return page
}
const calls = []
const api = { ensureLogin: async () => {}, request: async (...a) => { calls.push(a); return {} }, createOrder: async x => { calls.push(['order', x]); throw { msg: 'stop before payment' } } }
const wx = { showToast() {}, getStorageSync() {}, navigateTo: x => calls.push(['nav', x.url]) }
const p = load('package-tour/pages/booking/index.js', api, wx)
Object.assign(p.data, { p: { insurance_fee: 500, bookingRules: { beanDeductMaxPct: 0.1 } }, sessions: [{ id: 1, price_adult: 10000, left_seats: 5 }], qty: 2, beanBal: 200, contactName: '测试', contactPhone: '13800001234' })
p.updatePrice()
assert.equal(p.data.priceSummary.pay, '180.00')
p.toggleInsurance({ detail: { value: true } })
assert.equal(p.data.priceSummary.insurance, '10.00')
assert.equal(p.data.priceSummary.pay, '190.00')
assert.equal(p.data.priceSummary.showInsRow, true)
await p.submit()
assert.equal(calls.length, 0, '未勾选不得请求下单或同意授权')
p.toggleAgree({ detail: { value: ['agree'] } })
await p.submit()
assert.equal(calls[0][0], '/c/consent', '授权应在下单之前保存')
assert.equal(calls.find(x => x[0] === 'order')[1].insurance, true)
p.goDoc({ currentTarget: { dataset: { type: 'terms' } } })
assert.equal(calls.at(-1)[1], '/package-content/pages/doc/index?type=agreement')
const likes = []
const n = load('package-content/pages/note/index.js', { request: async (...a) => { likes.push(a); return { liked: true, likeCount: 1 } } }, wx)
n.onLoad({ id: '123' })
await n.toggleLike()
assert.equal(likes[0][0], '/c/notes/123/like')
console.log('booking 保险计价、授权顺序、协议跳转、详情点赞行为通过')
