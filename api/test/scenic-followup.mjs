import assert from 'node:assert/strict'
import { assertIsolatedDb } from './_guard.mjs'
import { q, closeDb } from '../src/db.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'
import { example } from '../src/domain/scenic-calculator.mjs'

assertIsolatedDb('test/scenic-followup.mjs')
assert.ok(process.env.PORT && process.env.PORT !== '8080', '使用隔离 API 端口')
const origin = 'http://127.0.0.1:' + process.env.PORT
const request = async (method, path, body, token) => (await fetch(origin + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})).json()
async function call(...args) {
  const res = await request(...args)
  assert.equal(res.code, 0, JSON.stringify(res))
  return res.data
}
async function login(username, password = process.env.ADMIN_INIT_PASSWORD || 'admin123') {
  return (await call('POST', '/admin/login', { username, password })).token
}
async function rejected(...args) {
  assert.notEqual((await request(...args)).code, 0)
}

try {
  const admin = await login('admin'), finance = await login('finance'), ops = await login('ops')
  const city = await login('city310118', process.env.CITY_PARTNER_PASSWORD || 'city123')
  const { insertId: scenic } = await q("INSERT INTO scenic_spot(city_code,name) VALUES('310118','经营跟进·隔离验收')")
  const { insertId: other } = await q("INSERT INTO scenic_spot(city_code,name) VALUES('320508','外城·隔离验收')")
  const calculator = '/admin/scenics/' + scenic + '/calculator'
  const path = '/admin/scenics/' + scenic + '/followups'
  const data = { from: bizDay(), to: bizDay(), inputs: example }
  const calc = await call('POST', calculator, data, city)
  const review = await call('POST', calculator + '/reviews', { ...data, fingerprint: calc.fingerprint }, city)
  const body = { reviewId: review.reviewId, kind: 'budget', amountFen: 50000, purpose: '朱家角复盘后申请追加内容运营预算' }

  await rejected('POST', path, body, admin)
  await rejected('GET', '/admin/scenics/' + other + '/followups', null, city)
  await rejected('POST', path, { ...body, amountFen: 0 }, city)
  const submitted = await Promise.all([request('POST', path, body, city), request('POST', path, body, city)])
  assert.equal(submitted.filter(x => x.code === 0).length, 1)
  const { id } = submitted.find(x => x.code === 0).data
  const action = path + '/' + id + '/action'
  await rejected('POST', action, { action: 'approve', note: '申请方不得自行审批' }, city)
  await rejected('POST', action, { action: 'record', note: '未审批不可登记', reference: 'QA-000' }, ops)
  assert.equal((await call('POST', action, { action: 'approve', note: '本次隔离财务审批' }, finance)).status, 'approved')
  await rejected('POST', action, { action: 'reject', note: '终态审批不得覆盖' }, finance)
  const internalCalc = await call('POST', calculator, data, admin)
  const internalReview = await call('POST', calculator + '/reviews', { ...data, fingerprint: internalCalc.fingerprint }, admin)
  const own = await call('POST', path, { reviewId: internalReview.reviewId, kind: 'renewal', purpose: '超管发起续约审批验证' }, admin)
  await rejected('POST', path + '/' + own.id + '/action', { action: 'approve', note: '申请人不能审批本人单' }, admin)
  assert.equal((await call('POST', path + '/' + own.id + '/action', { action: 'reject', note: '本次续约资料尚不充分' }, finance)).status, 'rejected')
  assert.equal((await call('POST', action, { action: 'record', note: '完成隔离业务凭据登记', reference: 'QA-BUDGET-001' }, ops)).status, 'recorded')
  await rejected('POST', action, { action: 'record', note: '已登记不得重复办理', reference: 'QA-BUDGET-002' }, ops)
  const visible = await call('GET', path, null, city)
  assert.equal(visible.rows.length, 1)
  assert.equal(visible.rows[0].record_ref, 'QA-BUDGET-001')
  assert.equal(visible.rows[0].review_id, review.reviewId)
  const audit = await q("SELECT action FROM audit_log WHERE module='scenics' AND biz_ref=? AND action LIKE 'followup-%' ORDER BY id", [String(id)])
  assert.deepEqual(audit.map(row => row.action), ['followup-submit', 'followup-approve', 'followup-record'])
  console.log(JSON.stringify({ scenic, reviewId: review.reviewId, requestId: id, reference: 'QA-BUDGET-001' }))
  console.log('经营跟进：跨城与所有权、并发去重、本人审批拒绝、办理登记、退回与审计通过')
} finally {
  await closeDb()
}
