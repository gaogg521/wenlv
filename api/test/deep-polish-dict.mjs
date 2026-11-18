// X-01/X-02 三端统一字典 · 静态断言（不依赖数据库）
// 1) 服务端字典覆盖订单状态机全部状态码；2) 三端不再有分散的状态文案表；
// 3) 城市/品类字典单一事实源（entity-schema.DICT），PC 不再出现「商城 SKU」字样。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url)) // api/test
const apiRoot = path.resolve(testDir, '..') // api/
const repoRoot = path.resolve(apiRoot, '..') // 仓库根（mini-a/mini-b 与 api 同级）
const readApi = (p) => fs.readFileSync(path.join(apiRoot, p), 'utf8')
const readRepo = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8')
const imp = (p) => import(pathToFileURL(path.join(apiRoot, p)))

const { ST } = await imp('src/domain/order.mjs')
const { ORDER_STATUS, dictsForClient } = await imp('src/domain/dict.mjs')
const { DICT } = await imp('src/domain/entity-schema.mjs')

// 1) 字典覆盖状态机全部状态码，且三视角文案齐全
const codes = Object.values(ST).map(Number).sort((a, b) => a - b)
assert.deepEqual(Object.keys(ORDER_STATUS).map(Number).sort((a, b) => a - b), codes,
  'ORDER_STATUS 必须覆盖订单状态机的全部状态码（X-01）')
for (const [code, row] of Object.entries(ORDER_STATUS)) {
  for (const k of ['c', 'm', 'a', 't', 'scene']) {
    assert.ok(row[k] && typeof row[k] === 'string', `状态 ${code} 缺少 ${k} 文案`)
  }
}
// 关键口径：30 后台叫「待出行」、商户带「待核销」副标；同一状态游客/商户/后台文案可一一对应（字典同源）
assert.equal(ORDER_STATUS[ST.CONFIRMED].a, '待出行')
assert.ok(ORDER_STATUS[ST.CONFIRMED].m.includes('待核销'))

// 2) 下发字典包含三端所需的全部映射
const d = dictsForClient()
for (const k of ['orderStatusTourist', 'orderStatusMerchant', 'orderStatusAdmin', 'orderStatusScene', 'orderStatusTimeline']) {
  assert.ok(d[k] && Object.keys(d[k]).length >= codes.length, `dictsForClient 缺少 ${k}`)
}
for (const k of ['cities', 'productCats', 'merchantKinds', 'supplierKinds']) {
  assert.ok(d[k] && Object.keys(d[k]).length > 0, `dictsForClient 缺少 ${k}`)
}
assert.equal(d.orderStatusTourist[String(ST.PAID)], ORDER_STATUS[ST.PAID].c)

// 3) 三端不再有分散的状态文案表：逐个文件断言旧硬编码模式已删除
const noStatusTable = [
  ['mini-a/package-order/pages/orders/index.js', /10\s*:\s*'待支付'[\s\S]*?90\s*:\s*'/],
  ['mini-a/package-order/pages/order-detail/index.js', /stName:\s*\{\s*10:/],
  ['mini-a/package-tour/pages/pay-result/index.js', /10\s*:\s*'订单待支付'/],
  ['mini-b/pages/orders/index.js', /statusText:\s*\(\{20\s*:\s*'已支付'/],
  ['mini-b/pages/order-detail/index.js', /statuses:\s*\{\s*10\s*:\s*'待支付'/],
  ['api/admin/core.js', /30:\s*'已确认'/],
]
for (const [file, re] of noStatusTable) {
  const content = file.startsWith('api/') ? readApi(file.slice(4)) : readRepo(file)
  assert.ok(!re.test(content), `${file} 仍存在硬编码状态文案表（X-01 要求删除）`)
}

// 4) 品类「商城 SKU」改名「商城好物」：唯一事实源 + PC 全部文案位
assert.equal(DICT.productCat.find(([k]) => k === 'shop')[1], '商城好物')
const miniappJs = readApi('admin/miniapp.js')
assert.ok(!miniappJs.includes('商城 SKU'), 'admin/miniapp.js 仍出现「商城 SKU」（X-02）')
const catCore = readApi('admin/core.js')
assert.ok(catCore.includes("shop: '商城好物'") && !catCore.includes('商城 SKU'), 'admin/core.js CAT_CN 未更新为「商城好物」')

// 5) 服务端订单接口下发 statusText：游客/商户/后台三处拼装点都存在
for (const [file, marker] of [
  ['src/routes/tourist.mjs', "orderStatusText(o.status, 'c')"],
  ['src/routes/merchant.mjs', "orderStatusText(r.status, 'm')"],
  ['src/routes/admin.mjs', "orderStatusText(o.status, 'a')"],
]) {
  assert.ok(readApi(file).includes(marker), `${file} 未接入统一状态字典（X-01）`)
}

// 6) PC 城市合伙人首页不再出现裸城市码拼「口径」
assert.ok(!/cityTag\}\}口径/.test(readApi('admin/pages/dashboard.js')), 'dashboard.js 仍出现「…口径」裸码口径（X-02/P-02）')
assert.ok(readApi('admin/pages/dashboard.js').includes('CITY_CN[k.scopeCity]'), 'dashboard.js cityTag 未接城市字典（X-02）')

console.log('deep-polish-dict: X-01/X-02 静态断言全部通过')
