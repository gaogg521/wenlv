import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const load = (file, context) => vm.runInNewContext(fs.readFileSync(new URL('../../mini-b/' + file, import.meta.url), 'utf8'), context)
let component, pages = [], calls = []
load('components/merchant-nav/index.js', { Component: c => { component = c }, getCurrentPages: () => pages, wx: {
  switchTab: x => calls.push(['tab', x.url]), navigateBack: x => { calls.push(['back', x.delta]); x.fail() },
} })
const nav = { properties: { tab: true } }
pages = [{ route: 'pages/orders/index' }]; component.methods.back.call(nav)
assert.deepEqual(calls.pop(), ['tab', '/pages/index/index'])
nav.properties.tab = false; pages.push({ route: 'pages/order-detail/index' })
component.methods.back.call(nav)
assert.deepEqual(calls.splice(0), [['back', 1], ['tab', '/pages/index/index']], '详情先返回上一页，失败再回工作台')
let tab, role = 2
load('custom-tab-bar/index.js', { Component: c => { tab = c }, getCurrentPages: () => [{ route: 'pages/supply/index' }], getApp: () => ({ globalData: { role } }) })
tab.setData = d => Object.assign(tab.data, d)
tab.methods.sync.call(tab); assert.equal(tab.data.role, 2); assert.equal(tab.data.selected, 2)
role = 1; tab.methods.sync.call(tab); assert.equal(tab.data.role, 1, '角色变更须刷新导航')
let page, requests = 0
load('pages/index/index.js', { Page: p => { page = p }, require: () => ({ request: () => { requests++; return Promise.resolve({}) } }), getApp: () => ({ globalData: { role: 0, token: '', merchant: null } }), wx: { getStorageSync() {} } })
page.data.wb = { todayGmv: '旧门店金额' }; page.data.stats = { week: [] }
page.setData = d => Object.assign(page.data, d)
page.onShow(); assert.equal(page.data.wb, null); assert.equal(page.data.stats, null); assert.equal(page.data.err, 'login'); assert.equal(requests, 0)
console.log('商户tab返回、详情返回失败兜底、角色导航同步和退出后清除旧经营数据：通过')
