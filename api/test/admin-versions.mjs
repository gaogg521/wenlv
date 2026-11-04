// 批次 F-2 回归：R-01 主数据版本化第一期（隔离库，需服务在跑）
// 覆盖：商品编辑/上下架入版本簿（只增不改、版本号递增）、乐观锁（expectedVersion 冲突 2002、
//       通过后正常）、版本历史 API（倒序、越权拒绝）、商户审核通过入版本簿、实体编辑器路径
//       （PUT /admin/entities/product）同样入簿。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-versions.mjs')
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '版本回归-' + role })]))
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'VERQA' + Math.random().toString(36).slice(2, 8)
const made = { products: [], merchants: [] }
try {
  const merchant = await one('SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1')
  assert(merchant, '隔离库需要商户')

  await test('商品编辑入版本簿：关键字段快照、版本号递增、乐观锁冲突拒绝', async () => {
    const p = (await q('INSERT INTO tour_product (title, cat, price_from, status, merchant_id, city_code, updated_version) VALUES (?,?,?,?,?,?,0)',
      [stamp + ' 版本化商品', 'script', 10000, 0, merchant.id, '310118'])).insertId
    made.products.push(p)
    // 发布预检需要：行程介绍/集合点/安全告知 + 可报名的未来团期
    await q('UPDATE tour_product SET rich_desc = ?, meeting_point = ?, safety_note = ? WHERE id = ?',
      [JSON.stringify({ intro: '<p>' + stamp + ' 行程介绍</p>' }), stamp + ' 集合地点', stamp + ' 安全告知', p])
    await q('INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult, status) VALUES (?, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 10, 0, 1, 10000, 1)', [p])
    // 第一改：不带 expectedVersion（兼容旧调用方）→ v0→v1，版本簿 v1
    const e1 = ok(await call('ops', 'PUT', `/admin/entities/product/${p}`, { values: { price_from: 128 } }))
    assert.equal(e1.version, 1, '保存返回新版本号')
    // 第二改：带正确 expectedVersion → 成功
    const e2 = ok(await call('ops', 'PUT', `/admin/entities/product/${p}`, { values: { price_from: 136 }, expectedVersion: 1 }))
    assert.equal(e2.version, 2)
    // 第三改：带过期 expectedVersion → 2002，且不产生新版本
    const e3 = await call('ops', 'PUT', `/admin/entities/product/${p}`, { values: { price_from: 99 }, expectedVersion: 1 })
    assert.equal(e3.code, 2002, '乐观锁冲突拒绝：' + e3.msg)
    const h = ok(await call('ops', 'GET', `/admin/master-versions?kind=product&refId=${p}`))
    assert.equal(h.rows.length, 2, '两次有效编辑产生两条版本')
    assert.equal(h.rows[0].versionNo, 2, '倒序：最新在前')
    const snap = typeof h.rows[0].snapshot === 'string' ? JSON.parse(h.rows[0].snapshot) : h.rows[0].snapshot
    assert.deepEqual(snap.changedFields, ['price_from'])
    assert.equal(snap.before.price_from, '12800', '快照记存储口径（分）')
    assert.equal(snap.after.price_from, '13600')
    const row = await one('SELECT price_from, updated_version FROM tour_product WHERE id = ?', [p])
    assert.equal(Number(row.price_from), 13600, '现值是最后写入的 136 元')
    assert.equal(Number(row.updated_version), 2, '乐观锁版本=2')
  })

  await test('商品上下架入版本簿；越权拒绝；detail 下发 version', async () => {
    const p = made.products[0]
    ok(await call('ops', 'POST', `/admin/products/${p}/status`, { status: 1 }))
    const h = ok(await call('ops', 'GET', `/admin/master-versions?kind=product&refId=${p}`))
    assert.equal(h.rows[0].versionNo, 3, '上下架是第 3 条版本')
    assert.deepEqual((typeof h.rows[0].snapshot === 'string' ? JSON.parse(h.rows[0].snapshot) : h.rows[0].snapshot).changedFields, ['status'])
    assert.equal((await call('finance', 'GET', `/admin/master-versions?kind=product&refId=${p}`)).code, 0, '财务可读')
    assert.equal((await call('review', 'GET', `/admin/master-versions?kind=product&refId=${p}`)).code, 1003, '审核不可读')
    assert.equal((await call('ops', 'GET', '/admin/master-versions?kind=bogus&refId=1')).code, 1001, 'kind 校验')
    const detail = ok(await call('ops', 'GET', `/admin/entities/product/${p}`))
    assert.equal(detail.version, 3, '详情带乐观锁版本')
  })

  await test('商户审核通过入版本簿；版本历史不被改写', async () => {
    const m = (await q('INSERT INTO merchant (city_code, name, kind, merchant_no, status) VALUES (?,?,?,?,0)',
      ['310118', stamp + ' 待审商户', 'ticket', 'MVER' + stamp, 0])).insertId
    made.merchants.push(m)
    ok(await call('super', 'POST', `/admin/merchants/${m}/approve`))
    const h = ok(await call('super', 'GET', `/admin/master-versions?kind=merchant&refId=${m}`))
    assert.equal(h.rows.length, 1, '审核通过产生一条版本')
    const snap = typeof h.rows[0].snapshot === 'string' ? JSON.parse(h.rows[0].snapshot) : h.rows[0].snapshot
    assert.equal(snap.after.status, 1, '准入状态快照')
    const cnt = Number((await one('SELECT COUNT(*) n FROM master_data_version WHERE kind=? AND ref_id=?', ['merchant', m])).n)
    assert.equal(cnt, 1, '历史只增不改（复核仍为 1 条）')
  })

  console.log(`\n${passed} 项批次 F-2（R-01 主数据版本化第一期）回归通过`)
} finally {
  for (const p of made.products) {
    await q('DELETE FROM master_data_version WHERE kind = ? AND ref_id = ?', ['product', p]).catch(() => {})
    await q('DELETE FROM tour_session WHERE product_id = ?', [p]).catch(() => {})
    await q('DELETE FROM tour_product WHERE id = ?', [p]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='product' AND biz_ref = ?", ['product-' + p]).catch(() => {})
  }
  for (const m of made.merchants) {
    await q('DELETE FROM master_data_version WHERE kind = ? AND ref_id = ?', ['merchant', m]).catch(() => {})
    await q('DELETE FROM merchant_staff WHERE merchant_id = ?', [m]).catch(() => {})
    await q('DELETE FROM merchant WHERE id = ?', [m]).catch(() => {})
    await q("DELETE FROM audit_log WHERE module='merchant' AND biz_ref = ?", ['merchant-' + m]).catch(() => {})
  }
  await q("DELETE FROM attest_event WHERE biz_type='product_change' AND biz_ref LIKE 'product-%' AND JSON_EXTRACT(canonical, '$.demo') = true").catch(() => {})
  await closeDb()
}
