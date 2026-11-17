// 走查数据种子（隔离库 wanderlust_qa_polish_20261117 专用）：A1/A2 笔记夹具 + B2 今日待办/结算调整夹具
// 用后不清理的部分会留在隔离库（不入演示库）
import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/polish-walk-seed.mjs')
import { q, one, closeDb } from '../src/db.mjs'

const BASE = process.env.API_BASE || 'http://127.0.0.1:18251'
assert.ok(new URL(BASE).port !== '8080', '禁止向演示端口写入走查夹具')
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg + ' ' + JSON.stringify(r.data || '')); return r.data }
import fs from 'node:fs'

const imgA = fs.readFileSync(new URL('../../mini-a/assets/photos/water-town.jpg', import.meta.url)).toString('base64')
const imgB = fs.readFileSync(new URL('../../mini-a/assets/photos/zongzi.jpg', import.meta.url)).toString('base64')

const W = ok(await call('POST', '/c/auth/login', { code: 'mock-polish-walk-writer' }))
const R = ok(await call('POST', '/c/auth/login', { code: 'mock-polish-walk-reader' }))

// 1) 走查景区 + 两个上传图 + 3 篇公开笔记（2 篇挂景区；其中 1 篇挂商品 1 线路；1 篇纯文字无封面走文字卡）
const scenicId = (await q(`INSERT INTO scenic_spot (city_code, name, status) VALUES ('310118','朱家角走查景区',1)`)).insertId
const up = async (data) => ok(await call('POST', '/c/upload/note-image', { data, ext: 'jpg' }, W.token))
const [uA, uB] = await Promise.all([up(imgA), up(imgB)])
const n1 = ok(await call('POST', '/c/notes', {
  title: '朱家角晨光里的石板路与早茶',
  blocks: [{ type: 'text', html: '<p>清晨的朱家角游客还不多，石板路上只有早起的人。放生桥边早点摊的热气是最好的路标。</p>' }],
  images: [uA.url, uB.url], topics: ['朱家角漫步', '古镇漫步'], visibility: 'public', scenicId, relatedProductId: 1, coverIndex: 0,
}, W.token))
const n2 = ok(await call('POST', '/c/notes', {
  title: '同景区的另一条巷子：北大街到手摇船埠',
  blocks: [{ type: 'text', html: '<p>避开主街，从北大街拐进小巷，尽头是手摇船埠，船娘正在擦船。</p>' }],
  images: [uB.url], topics: ['朱家角漫步'], visibility: 'public', scenicId, coverIndex: 0,
}, W.token))
const n3 = ok(await call('POST', '/c/notes', {
  title: '无图的纯文字手记：雨天的朱家角',
  blocks: [{ type: 'text', html: '<p>下雨的朱家角反而安静，屋檐滴水连成线，茶馆里坐一下午只花了二十块。</p>' }],
  topics: ['古镇漫步'], visibility: 'public', scenicId,
}, W.token))
const otherScenic = (await q("INSERT INTO scenic_spot (city_code, name, status) VALUES ('330523','安吉走查景区',1)")).insertId
const n4 = ok(await call('POST', '/c/notes', {
  title: '安吉山野午后', blocks: [{ type: 'text', html: '<p>循着竹林小径，走到山脚休息。</p>' }],
  images: [uA.url], visibility: 'public', scenicId: otherScenic,
}, W.token))
console.log('notes', n1.id, n2.id, n3.id, n4.id, 'scenics', scenicId, otherScenic)

// 2) 商品 1 加两个团期：今天出发（待接待/临近截止）与 3 天后（临近截止）
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const d3 = new Date(Date.parse(today + 'T00:00:00+08:00') + 2 * 86400000).toISOString().slice(0, 10)
const s1 = (await q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (1,?,30,6,1,29800,1)`, [today])).insertId
const s2 = (await q(`INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (1,?,30,2,1,29800,1)`, [d3])).insertId

// 3) 两笔真实下单（mock 支付）：一单留 20（今日出发待接待=1），一单拨 60（退款申请中=异常待处理 1）
const mkOrder = async () => {
  const cv = ok(await call('GET', '/c/consent', null, R.token))
  await call('POST', '/c/consent', { scene: 'privacy', granted: true, version: cv.versions.privacy }, R.token)
  await call('POST', '/c/consent', { scene: 'terms', granted: true, version: cv.versions.terms }, R.token)
  const o = ok(await call('POST', '/c/orders', { sessionId: s1, qty: 1, beanDeduct: 0, contactName: '走查游客', contactPhone: '13800001111', insurance: false }, R.token))
  const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  await call('POST', '/admin/dev/mock-pay', { orderNo: o.orderNo }, A)
  return o.orderNo
}
const ord1 = await mkOrder()
const ord2 = await mkOrder()
await q('UPDATE orders SET status = 60 WHERE order_no = ?', [ord2])
const abn = await one('SELECT order_no, status FROM orders WHERE order_no=?', [ord2])
console.log('orders', ord1, ord2, 'abnormal→', abn.status)

// 4) 商户 1 结算单（status=0 待确认）+ 一条按项退款调整（type=1，-1200 分待冲抵）
await q(`INSERT INTO settlement (merchant_id, period, order_count, total_amount, amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status)
  VALUES (1,'2026-W47WALK',2,10000,8000,500,300,200,1000,0)`).catch(async (e) => {
  console.log('settlement exists', e.message)
})
const st = await one("SELECT id FROM settlement WHERE merchant_id=1 AND period='2026-W47WALK'")
await q(`INSERT INTO settlement_adjustment (settlement_id, order_id, type, amount_fen, cost_fen, reason, operator) VALUES (?,?,1,-1200,0,'走查夹具：按项退款待冲抵','walk-seed')`, [st.id, (await one('SELECT id FROM orders WHERE order_no=?', [ord2])).id])
console.log('settlement', st.id, 'adjustment -1200')
console.log('WALK-SEED-DONE', JSON.stringify({ scenicId, notes: [n1.id, n2.id, n3.id, n4.id], sessions: [s1, s2], ord1, ord2, settlement: st.id }))
await closeDb()
