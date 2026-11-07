import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const module = { exports: {} }
vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/utils/api.js', import.meta.url), 'utf8'), { module, getApp: () => ({ globalData: { apiBase: 'https://api.test' } }) })
const api = module.exports
assert.equal(api.coverFor({ cat: 'shop', title: '安吉白茶', images: ['/uploads/demo-prod-5-1.svg'] }), '/assets/photos/tea.jpg')
assert.equal(api.coverFor({ cat: 'shop', title: '粽子礼盒', images: [] }), '/assets/photos/zongzi.jpg')
assert.equal(api.coverFor({ cat: 'shop', title: '扎染方巾', images: [] }), '/assets/photos/cloth.jpg')
assert.equal(api.coverFor({ cat: 'script', images: ['/uploads/customer.jpg'] }), 'https://api.test/uploads/customer.jpg')
assert.equal(api.productImages({ images: ['/uploads/scenic.svg', '/uploads/actual.png'] }).length, 1)
assert.ok(api.isReferencePhoto('/uploads/reference-kezhi-20261108.jpg'), '新批次摄影仍需标明参考图')
assert.ok(!api.isReferencePhoto('/uploads/supplier-actual.jpg'), '商家实拍不误标为参考图')
let page; const calls = []
vm.runInNewContext(fs.readFileSync(new URL('../../mini-a/pages/home/index.js', import.meta.url), 'utf8'), {
  require: p => { assert.ok(!p.endsWith('.json'), '小程序不能用require加载JSON配置'); return p.endsWith('api') ? api : { DEFAULT: {} } },
  Page: p => { page = p }, wx: { switchTab: o => calls.push(['tab', o.url]), navigateTo: o => calls.push(['navigate', o.url]) }
})
page.data = { banners: [{ link: '/pages/tour-list/index' }] }
page.tapBanner({ currentTarget: { dataset: { i: 0 } } })
assert.equal(calls[0][0], 'tab', '轮播链接到tab页不能用navigateTo')
console.log('商品摄影对应、实际上传优先、SVG业务占位替换与轮播tab跳转通过')
