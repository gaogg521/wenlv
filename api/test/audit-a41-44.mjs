// A-41~A-44 回归（全量检查 20261106 §7 的代码部分）：订阅时机 / 保险入口 / UGC 闭环 / 隐私同意
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/audit-a41-44.mjs')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { q, one, tx } from '../src/db.mjs'
import * as order from '../src/domain/order.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, (r.msg || '') + ' ' + JSON.stringify(r.data || '')); return r.data }
let passN = 0
const t = async (name, fn) => { try { await fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const stamp = Date.now().toString(36)
const created = { sessions: [], orders: [], notes: [], products: [], users: [] }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const cLogin = async (tag) => {
  const code = 'mock-a4144-' + tag + '-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  created.users.push(Number(r.user.id))
  const tok = r.token
  await call('POST', '/c/consent', { scene: 'privacy', granted: true }, tok) // A-44：下单需隐私授权
  return { token: tok, id: Number(r.user.id), code }
}
const mkSession = async ({ days = 60, price = 10000, productId = 1, insurance = null } = {}) => {
  await q('DELETE FROM tour_session WHERE product_id = ? AND depart_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)', [productId, days]).catch(() => {})
  const r = await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 50, 0, 1, ?, 1)', [productId, days, price])
  const id = Number(r.insertId)
  created.sessions.push(id)
  return id
}
const mkProduct = async ({ insuranceFee = 0, insuranceNote = null } = {}) => {
  const pid = await tx(async (c) => c.ins(`INSERT INTO tour_product (title, cat, city_code, merchant_id, price_from, bean_gift, days_desc, status, insurance_fee, insurance_note)
    VALUES (?, 'script', '310118', (SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1), 10000, 0, '1天', 1, ?, ?)`,
    ['A41夹具·' + stamp, insuranceFee, insuranceNote]))
  created.products.push(Number(pid))
  return Number(pid)
}
const cleanup = async () => {
  for (const no of created.orders) {
    await q('DELETE v FROM verification_log v JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE tp FROM travel_pass tp JOIN orders o ON o.id = tp.order_id WHERE o.order_no = ?', [no]).catch(() => {})
    await q('DELETE FROM payment WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM order_event WHERE order_id IN (SELECT id FROM orders WHERE order_no = ?)', [no]).catch(() => {})
    await q('DELETE FROM orders WHERE order_no = ?', [no]).catch(() => {})
  }
  await q('DELETE FROM content_note_likes WHERE note_id IN (?)', [created.notes.length ? created.notes : [0]]).catch(() => {})
  await q('DELETE FROM content_note WHERE id IN (?)', [created.notes.length ? created.notes : [0]]).catch(() => {})
  await q('DELETE FROM tour_session WHERE id IN (?)', [created.sessions.length ? created.sessions : [0]]).catch(() => {})
  await q('DELETE FROM tour_product WHERE id IN (?)', [created.products.length ? created.products : [0]]).catch(() => {})
}
process.on('exit', () => {})

console.log('== A-41 订阅消息时机 ==')
await t('A41-1 /c/notify/templates 下发出票与未成团两类模板；pay-result 订阅由按钮触发而非 onLoad', async () => {
  const u = await cLogin('a41')
  const tpls = ok(await call('GET', '/c/notify/templates', null, u.token))
  assert.ok('payOk' in tpls, 'templates 应含 payOk 键')
  assert.ok('groupCancel' in tpls, 'templates 应含 groupCancel 键（未成团通知此前从未请求过订阅）')
  const js = read('mini-a/package-tour/pages/pay-result/index.js')
  const onLoadSeg = js.split('onLoad(')[1] ? js.split('onLoad(')[1].split('},')[0] : ''
  assert.ok(!onLoadSeg.includes('askSubscribe'), 'onLoad 不得自动调起订阅（微信会拒）: ' + onLoadSeg)
  const wxml = read('mini-a/package-tour/pages/pay-result/index.wxml')
  assert.ok(/订阅出行通知/.test(wxml), 'pay-result 应有「订阅出行通知」按钮')
})

console.log('== A-42 保险入口 ==')
await t('A42-1 后台配了保险费的线路：下单页可见保险卡片；勾选后费用并入实付', async () => {
  const pid = await mkProduct({ insuranceFee: 500, insuranceNote: '含旅行意外险 · 5 元/人' })
  const u = await cLogin('a42')
  const det = ok(await call('GET', `/c/tours/${pid}`, null, u.token))
  assert.equal(Number(det.insurance_fee), 500, '详情下发保险费')
  const sid = await mkSession({ productId: pid })
  const r = ok(await call('POST', '/c/orders', { sessionId: sid, qty: 2, beanDeduct: 0, contactName: '保险测试', contactPhone: '13800001234', insurance: true }, u.token))
  created.orders.push(r.orderNo)
  assert.equal(Number(r.insuranceFee), 1000, '保险费 = 500 × 2 人')
  assert.equal(Number(r.amountPay), 21000, '实付 = 20000 + 1000')
  const noIns = ok(await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '保险测试', contactPhone: '13800001234' }, u.token))
  created.orders.push(noIns.orderNo)
  assert.equal(Number(noIns.insuranceFee), 0, '不勾选不收保险费')
  const wxml = read('mini-a/package-tour/pages/booking/index.wxml')
  assert.ok(/insurance/.test(wxml), 'booking 页应有保险卡片（后台配了才显示）')
})

console.log('== A-43 UGC 闭环 ==')
await t('A43-1 笔记图片上传：文件头校验 + 版本文件名；非图片内容拒绝', async () => {
  const u = await cLogin('a43')
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024, 0x11)])
  const good = ok(await call('POST', '/c/upload/note-image', { data: jpeg.toString('base64'), ext: 'jpg' }, u.token))
  assert.ok(/^\/uploads\/note_\d+_\d+\.jpg$/.test(good.url), '版本文件名: ' + good.url)
  const fake = await call('POST', '/c/upload/note-image', { data: Buffer.from('<script>alert(1)</script>').toString('base64'), ext: 'jpg' }, u.token)
  assert.notEqual(fake.code, 0, '非图片内容必须被文件头校验拒绝')
})

await t('A43-2 带图笔记可发布（images 数组入正文）', async () => {
  const u = await cLogin('a43b')
  const r = ok(await call('POST', '/c/notes', { title: '带图笔记' + stamp, body: '图文内容', images: ['/uploads/note_1_1.jpg', '/uploads/note_1_2.jpg'] }, u.token))
  created.notes.push(r.id)
  const n = await one('SELECT status FROM content_note WHERE id = ?', [r.id])
  assert.equal(Number(n.status), 2, 'mock 机审直通已发布')
})

await t('A43-3 公开内容流：仅已发布笔记可見，带封面/作者/点赞数/关联线路', async () => {
  const u = await cLogin('a43c')
  const pub = ok(await call('POST', '/c/notes', { title: '广场笔记' + stamp, body: '公开内容流测试', images: ['/uploads/a.jpg'], relatedProductId: created.products[0] || 1 }, u.token))
  created.notes.push(pub.id)
  const draft = ok(await call('POST', '/c/notes', { title: '未过审草稿', body: '不该出现在广场', }, u.token))
  await q('UPDATE content_note SET status = 1 WHERE id = ?', [draft.id])
  const feed = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20', null, u.token))
  assert.ok(Array.isArray(feed.items) && feed.items.length >= 1, 'feed 有内容')
  const row = feed.items.find((x) => Number(x.id) === Number(pub.id))
  assert.ok(row, '已发布笔记在广场可见')
  assert.ok(!feed.items.some((x) => Number(x.id) === Number(draft.id)), '未过审笔记不可见')
  assert.ok(row.cover || row.images, '带封面/图片')
  assert.ok(row.author, '带作者昵称')
  assert.ok('likeCount' in row, '带点赞数')
  assert.ok('productTitle' in row, '带关联线路标题（可为 null）')
})

await t('A43-4 点赞：一用户一赞、可取消、计数准确', async () => {
  const u = await cLogin('a43d')
  const pub = ok(await call('POST', '/c/notes', { title: '点赞笔记' + stamp, body: '点赞测试' }, u.token))
  created.notes.push(pub.id)
  ok(await call('POST', `/c/notes/${pub.id}/like`, {}, u.token))
  const c1 = Number((await one('SELECT like_count FROM content_note WHERE id = ?', [pub.id])).like_count)
  assert.equal(c1, 1, '点赞后计数 1')
  const again = await call('POST', `/c/notes/${pub.id}/like`, {}, u.token)
  assert.notEqual(again.code, 0, '重复点赞被拒（或幂等提示）')
  assert.equal(Number((await one('SELECT like_count FROM content_note WHERE id = ?', [pub.id])).like_count), 1, '计数不重复累加')
  ok(await call('DELETE', `/c/notes/${pub.id}/like`, null, u.token))
  assert.equal(Number((await one('SELECT like_count FROM content_note WHERE id = ?', [pub.id])).like_count), 0, '取消点赞计数归零')
  // feed 的 liked 标记
  ok(await call('POST', `/c/notes/${pub.id}/like`, {}, u.token))
  const feed = ok(await call('GET', '/c/notes/feed?page=1&pageSize=20', null, u.token))
  const row = feed.items.find((x) => Number(x.id) === Number(pub.id))
  assert.equal(row.liked, true, 'feed 应带 liked 标记')
  const detail = ok(await call('GET', `/c/notes/${pub.id}`, null, u.token))
  assert.equal(detail.liked, true, '详情点赞态不能依赖广场前 50 条')
  assert.equal(detail.likeCount, 1)
})

await t('A43-5 创作页有图片选择与关联线路；广场页已登记 MINI_MAP', async () => {
  const createJs = read('mini-a/package-content/pages/create/index.js')
  assert.ok(/chooseMedia|chooseImage/.test(createJs), '创作页应有图片选择')
  assert.ok(/relatedProductId/.test(createJs), '创作页应支持关联线路')
  const appJson = JSON.parse(read('mini-a/app.json'))
  assert.ok(appJson.pages.concat((appJson.subPackages || []).flatMap((s) => s.pages.map((p) => s.root + '/' + p))).some((p) => p === 'package-content/pages/square/index'), 'app.json 应登记广场页')
  const map = read('api/admin/miniapp.js')
  assert.ok(/package-content\/pages\/square\/index/.test(map), 'MINI_MAP 应登记广场页')
})

console.log('== A-44 隐私同意 ==')
await t('A44-1 未授权隐私政策下单被拒；授权后可下单；撤回后再被拦', async () => {
  const code = 'mock-a4144-noconsent-' + stamp
  const r = ok(await call('POST', '/c/auth/login', { code }))
  const tok = r.token
  created.users.push(Number(r.user.id))
  const sid = await mkSession({ days: 46 })
  const deny = await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '未授权', contactPhone: '13800001234' }, tok)
  assert.equal(deny.code, 1001, '未授权必须被拒')
  assert.match(deny.msg || '', /隐私|同意/, '中文提示: ' + deny.msg)
  ok(await call('POST', '/c/consent', { scene: 'privacy', granted: true }, tok))
  const allow = ok(await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '已授权', contactPhone: '13800001234' }, tok))
  created.orders.push(allow.orderNo)
  ok(await call('POST', '/c/consent', { scene: 'privacy', granted: false }, tok))
  const after = await call('POST', '/c/orders', { sessionId: sid, qty: 1, beanDeduct: 0, contactName: '已撤回', contactPhone: '13800001234' }, tok)
  assert.equal(after.code, 1001, '撤回后再次被拦')
  assert.match(after.msg || '', /隐私|同意/, '中文提示: ' + after.msg)
})

await t('A44-2 下单页有协议勾选与链接；拒绝授权无法继续下单', async () => {
  const wxml = read('mini-a/package-tour/pages/booking/index.wxml')
  assert.ok(/已阅读并同意|隐私政策/.test(wxml), 'booking 页应有协议勾选')
  assert.ok(/goDoc|doc\/index\?type=/.test(wxml) && /服务条款|隐私政策/.test(wxml), '协议可点开查看')
  const js = read('mini-a/package-tour/pages/booking/index.js')
  assert.ok(/agree|agreeTerms|consent/i.test(js), 'submit 前校验勾选')
})

await cleanup()
console.log(`\n${passN} 项通过`)
const { closeDb } = await import('../src/db.mjs')
await closeDb()
process.exit(process.exitCode || 0)
