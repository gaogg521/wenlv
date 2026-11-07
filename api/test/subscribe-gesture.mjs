import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
let page, insideTap = false, opened = false
const api = { getNotifyTemplates: async () => ({ payOk: 'pay-template', groupCancel: 'cancel-template' }) }
const wx = { requestSubscribeMessage: ({ tmplIds }) => {
  assert.equal(insideTap, true, '订阅必须在点击调用栈内，不能先等网络')
  assert.equal(tmplIds.length, 2); opened = true
}, showToast() {} }
vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/package-tour/pages/pay-result/index.js', import.meta.url), 'utf8'), { require: () => api, Page: p => { page = p }, wx })
page.data = structuredClone(page.data)
page.setData = v => Object.assign(page.data, v)
// 加载阶段预取；点击阶段不得重新请求模板。
if (page.loadSubscribeTemplates) await page.loadSubscribeTemplates()
insideTap = true
const pending = page.askSubscribe()
insideTap = false
await pending
assert.equal(opened, true)
console.log('订阅模板预取、同步点击授权通过')
