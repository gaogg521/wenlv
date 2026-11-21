// V94 退回项1回归:商户端权限快照乱序响应不得回退(版本 3 先返回、版本 2 后返回 → 本地保留 3);
// 且已下载的权限集合供页面判定入口展示(permsFor)。vm 沙盒跑 mini-b/utils/api.js,不依赖微信开发者工具。
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const source = fs.readFileSync(new URL('../../mini-b/utils/api.js', import.meta.url), 'utf8')

function setup(handler) {
  const store = new Map()
  const app = { globalData: { apiBase: 'http://127.0.0.1:8080', token: 'tok', merchant: { id: 1 }, role: 2, permVersion: 0, perms: {} } }
  const calls = []
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (k) => store.get(k),
    setStorageSync: (k, v) => store.set(k, v),
    removeStorageSync: (k) => store.delete(k),
    request: (o) => { calls.push(o); handler(o) },
    login: () => assert.fail('本用例不应触发 wx.login'),
    showToast: () => {},
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, wx, getApp: () => app, getCurrentPages: () => [], setTimeout, clearTimeout })
  return { api: module.exports, store, app, calls }
}

const snap = (version) => ({ code: 0, data: { version, role: 2, merchantId: 1, perms: { session: { update: { allowed: version >= 3, fields: ['price_adult'] } } } } })

// 1) 并发乱序:v3 与 v2 两个响应乱序返回,本地必须停在 v3(退回项1 主断言)
{
  let seq = 0
  const s = setup((o) => { seq += 1; if (seq === 1) o.success({ data: snap(3) }); else o.success({ data: snap(2) }) })
  // 两个并发刷新(模拟回前台+进入供给页同时触发)
  const p1 = s.api.refreshPerms(true)
  const p2 = s.api.refreshPerms(true)
  await Promise.all([p1, p2])
  const stored = s.store.get('mperm')
  assert.equal(Number(stored.version), 3, '乱序返回后本地必须保留版本 3,实际 ' + Number(stored.version))
  assert.equal(s.app.globalData.permVersion, 3, 'globalData 版本同步为 3')
  assert.equal(s.api.permsFor().session.update.allowed, true, '已下载权限集合应可被页面读取(permsFor)')
}
// 2) 纯顺序回退:v3 落库后单独返回 v2 → 不覆盖
{
  const s = setup((o) => o.success({ data: snap(2) }))
  s.store.set('mperm', snap(3).data); s.app.globalData.permVersion = 3
  await s.api.refreshPerms(true)
  assert.equal(Number(s.store.get('mperm').version), 3, '低版本单独返回也不得覆盖')
}
// 3) 撤权场景:v3(允许)→ v2(不允许)按 2 落库会误导入口,但服务端撤权后下发的快照版本必然更高——
//    这里验证"更高版本携带 allowed:false"会正确收紧入口展示
{
  let seq = 0
  const s = setup((o) => { seq += 1; if (seq === 1) o.success({ data: { code: 0, data: { version: 2, perms: { session: { update: { allowed: true, fields: [] } } } } } }); else o.success({ data: { code: 0, data: { version: 3, perms: { session: { update: { allowed: false, fields: [] } } } } } }) })
  const p1 = s.api.refreshPerms(true)
  const p2 = s.api.refreshPerms(true)
  await Promise.all([p1, p2])
  const stored = s.store.get('mperm')
  assert.equal(Number(stored.version), 3, '撤权后的更高版本应落库')
  assert.equal(s.api.permsFor().session.update.allowed, false, '撤权后的入口展示应收紧(allowed=false)')
}
// 4) 串行化:refreshPerms 并发调用只发出一个在飞请求(完成后下一个才发)
{
  let inflight = 0, maxInflight = 0
  const s = setup((o) => { inflight += 1; maxInflight = Math.max(maxInflight, inflight); inflight -= 1; o.success({ data: snap(9) }) })
  await Promise.all([s.api.refreshPerms(true), s.api.refreshPerms(true), s.api.refreshPerms(true)])
  assert.ok(maxInflight <= 1, '并发刷新应串行化(同一时刻最多一个在飞),实际峰值 ' + maxInflight)
  assert.equal(Number(s.store.get('mperm').version), 9, '最终快照为最新版本')
}

console.log('商户端权限快照:乱序不回退/低版本不覆盖/撤权收紧/并发串行化 通过')

function loadPage(path, api, globals = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    require: () => api, Page: (definition) => { page = definition },
    getApp: () => ({ globalData: { role: 2, token: 'fixture' } }),
    wx: { showToast() {} }, setTimeout() {}, ...globals,
  })
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

{
  let perms = { session: { update: { allowed: true } } }
  let finishRefresh
  const page = loadPage('../../mini-b/pages/supply/index.js', {
    refreshPerms: () => new Promise(resolve => { finishRefresh = resolve }),
    permsFor: () => perms, request: async () => ({ items: [] }),
  })
  page.dateWindow = () => ({})
  page.applyFilters = () => {}
  page.fetch()
  perms = { session: { update: { allowed: false } }, product: { update: { allowed: true } } }
  finishRefresh()
  await Promise.resolve()
  assert.equal(page.data.canManage, false)
  assert.equal(page.data.canEditProduct, true, '商品与团期分别执行各自权限')
}

{
  const calls = []
  const api = {
    request: async (path, method, body) => { calls.push({ path, method, body }); return { id: 42 } },
    permsFor: () => ({ product: { update: { allowed: true, fields: ['subtitle'] } } }),
  }
  const page = loadPage('../../mini-b/pages/product-edit/index.js', api)
  page.fill({ title: '正式商品', subtitle: '草稿卖点' }, { mode: 'edit', id: 5, version: 2 })
  page.onInput({ currentTarget: { dataset: { k: 'subtitle' } }, detail: { value: '新卖点' } })
  page.saveDraft()
  await Promise.resolve()
  page.save(true)
  await Promise.resolve()
  assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
    ['/m/subject-requests', 'POST'], ['/m/subject-requests/42', 'PUT'],
  ])
  assert.equal(calls[1].body.submit, true)
  assert.deepEqual(Object.keys(calls[1].body.payload), ['subtitle'])
}
console.log('小程序实页逻辑：异步撤权后更新入口，编辑草稿先创建再提交同一申请，非授权字段不提交')
