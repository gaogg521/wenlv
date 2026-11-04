// 批次 A 回归：T01 共创分润打款闭环 + T00 能力/城市边界补漏（隔离库，需服务在跑）
// 覆盖：正常登记、缺回单、重复流水、合作停用、非待付、超付、越权、跨城、部分打款、
//       审批阈值（提案→他人复核）、冲正、作废、并发、台账/画像/对账三处读回一致。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/admin-coprofit.mjs')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { q, one, closeDb } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const base = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const tokens = Object.fromEntries(['super', 'ops', 'finance', 'review', 'risk', 'city_partner'].map((role) =>
  [role, jwtSign({ end: 'admin', role, name: '分润回归-' + role, scopeCity: role === 'city_partner' ? null : null })]))
const cityTokens = {} // 按城市生成（用例中确定本城/外城后补）
const cityToken = (city) => cityTokens[city] ||= jwtSign({ end: 'admin', role: 'city_partner', name: '分润回归-城市' + city, scopeCity: city })
const call = async (role, method, path, body, tok) => (await fetch(base + path, {
  method, headers: { authorization: 'Bearer ' + (tok || tokens[role]), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})).json()
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

const stamp = 'CPQA' + Date.now()
const created = { profits: [], coCreators: [], products: [], receiptFiles: [], audits: [] }
try {
  // ---- 夹具：产品（两个城市）+ 共创人 + 分润单 ----
  const prod = await one('SELECT id, city_code FROM tour_product ORDER BY id LIMIT 1')
  assert(prod, '隔离库需要场景商品')
  const otherCityProd = await one('SELECT id, city_code FROM tour_product WHERE city_code <> ? ORDER BY id LIMIT 1', [prod.city_code])
  const cityA = prod.city_code
  const cityB = otherCityProd ? otherCityProd.city_code : null
  const coIns = async (name, status = 1) => {
    const r = await q('INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct, status) VALUES (?,?,?,?,?,?,?,?)',
      [prod.id, 'PC' + stamp + name, stamp + name, '13800001111', 1, 100000, 1000, status])
    created.coCreators.push(r.insertId)
    return r.insertId
  }
  const pfIns = async (coId, amount, status = 0, paid = 0) => {
    const r = await q('INSERT INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount, status, paid_amount) VALUES (?,?,?,?,?,?,?,?)',
      [900000 + created.profits.length, coId, prod.id, '2099-W99', amount, amount, status, paid])
    created.profits.push(r.insertId)
    return r.insertId
  }
  const pay = (role, id, body) => call(role, 'POST', `/admin/co-profits/${id}/pay`, body)
  const basePay = (over = {}) => ({ payRef: stamp + '-R' + Math.random().toString(36).slice(2, 8), channel: 'bank', payDate: '2099-01-01', note: '分润回归登记', amount: 1000, ...over })

  await test('能力矩阵：coProfit.pay 仅超管/财务，coProfit.void 仅超管，导出能力按报表类型下发', async () => {
    for (const [role, expected] of [['super', true], ['finance', true], ['ops', false], ['review', false], ['risk', false], ['city_partner', false]]) {
      const c = ok(await call(role, 'GET', '/admin/capabilities'))
      assert.equal(c.actions['coProfit.pay'].allowed, expected, role + ' coProfit.pay')
      assert.equal(c.actions['coProfit.void'].allowed, role === 'super', role + ' coProfit.void')
    }
    const sup = ok(await call('super', 'GET', '/admin/capabilities')).actions
    assert.ok(sup['export.orders'].allowed && sup['export.settlements'].allowed)
    assert.equal(ok(await call('review', 'GET', '/admin/capabilities')).actions['export.orders'].allowed, false)
    assert.equal(ok(await call('review', 'GET', '/admin/capabilities')).actions['export.creators'].allowed, true)
  })

  await test('财务正常登记打款：结清、流水入账、操作人留痕，三处读回一致', async () => {
    const co = await coIns('结清'), pid = await pfIns(co, 5000)
    const r = ok(await pay('finance', pid, basePay({ amount: 5000 })))
    assert.equal(r.paid, true); assert.equal(r.settled, true)
    const cp = await one('SELECT * FROM co_profit WHERE id = ?', [pid])
    assert.equal(Number(cp.status), 1); assert.equal(Number(cp.paid_amount), 5000)
    assert.ok(String(cp.paid_by || '').includes('finance'), '登记人留痕：' + cp.paid_by)
    const y = await one('SELECT * FROM co_profit_pay WHERE co_profit_id = ? ORDER BY id DESC LIMIT 1', [pid])
    assert.equal(Number(y.status), 1); assert.equal(y.operator, 'admin:分润回归-finance')
    const log = await one("SELECT * FROM audit_log WHERE module = 'co-profit' AND biz_ref = ? AND action = 'pay' ORDER BY id DESC LIMIT 1", ['coprofit-' + pid])
    assert(log, '打款应写审计'); created.audits.push('coprofit-' + pid)
    // 台账 / 画像 / 对账三处同额
    const list = ok(await call('super', 'GET', '/admin/co-profits')).find((x) => Number(x.id) === Number(pid))
    assert.equal(Number(list.paid_amount), 5000); assert.equal(Number(list.status), 1)
    const prof = ok(await call('super', 'GET', `/admin/partners/cocreator/${co}`))
    assert.equal(Number(prof.paid), 5000)
    const rec = ok(await call('super', 'GET', `/admin/partner-reconciliation/cocreator/${co}`))
    assert.equal(Number(rec.summary.paid), 5000); assert.equal(Number(rec.summary.pending), 0)
  })

  await test('缺流水/金额非法/超付/重复流水/非待付/合作停用，全部在保存前拒绝', async () => {
    const co = await coIns('负向'), pid = await pfIns(co, 3000)
    assert.equal((await pay('finance', pid, basePay({ payRef: '短' }))).code, 1001)
    assert.equal((await pay('finance', pid, basePay({ amount: 0 }))).code, 1001)
    assert.equal((await pay('finance', pid, basePay({ amount: 10.5 }))).code, 1001)
    assert.equal((await pay('finance', pid, basePay({ amount: -100 }))).code, 1001)
    assert.equal((await pay('finance', pid, basePay({ amount: 999999 }))).code, 1001, '超付必须拒绝')
    const goodRef = stamp + '-DUP1'
    assert.equal((await pay('finance', pid, basePay({ amount: 1000, payRef: goodRef }))).code, 0)
    const pid2 = await pfIns(co, 3000)
    assert.equal((await pay('finance', pid2, basePay({ amount: 1000, payRef: goodRef }))).code, 2002, '重复流水全局拒绝')
    // 新流水补足剩余额度 → 结清；结清后再登记 → 非待付
    assert.equal((await pay('finance', pid, basePay({ amount: 2000 }))).code, 0)
    assert.equal(Number((await one('SELECT status FROM co_profit WHERE id = ?', [pid])).status), 1)
    assert.equal((await pay('finance', pid, basePay({ amount: 100 }))).code, 2002)
    const coOff = await coIns('停用合作', 0), pid3 = await pfIns(coOff, 3000)
    const r3 = await pay('finance', pid3, basePay({ amount: 1000 }))
    assert.equal(r3.code, 6001, '合作停用暂停打款')
  })

  await test('部分打款：两次登记累计结清，未结清期间状态保持待打款', async () => {
    const co = await coIns('部分'), pid = await pfIns(co, 5000)
    const r1 = await pay('finance', pid, basePay({ amount: 2000 }))
    assert.equal(r1.code, 0); assert.equal(r1.data.settled, false, '部分登记不结清')
    assert.equal(Number((await one('SELECT paid_amount FROM co_profit WHERE id = ?', [pid])).paid_amount), 2000)
    ok(await pay('finance', pid, basePay({ amount: 3000 })))
    const cp = await one('SELECT * FROM co_profit WHERE id = ?', [pid])
    assert.equal(Number(cp.paid_amount), 5000); assert.equal(Number(cp.status), 1)
    const ys = await q('SELECT amount FROM co_profit_pay WHERE co_profit_id = ? AND status = 1', [pid])
    assert.equal(ys.reduce((s, y) => s + Number(y.amount), 0), 5000)
  })

  await test('越权与登录边界：ops/review/risk/城市不能登记或作废，未登录/伪造 token 拒绝', async () => {
    const co = await coIns('越权'), pid = await pfIns(co, 3000)
    for (const role of ['ops', 'review', 'risk', 'city_partner']) assert.equal((await pay(role, pid, basePay({ amount: 100 }))).code, 1003, role)
    assert.equal((await call('ops', 'POST', `/admin/co-profits/${pid}/void`, { reason: '越权作废测试' })).code, 1003)
    assert.equal((await call('finance', 'POST', `/admin/co-profits/${pid}/void`, { reason: '财务不能作废' })).code, 1003)
    for (const role of ['review', 'risk']) assert.equal((await call(role, 'GET', '/admin/co-profits')).code, 1003, role + ' 台账')
    // 城市账号：分润是平台级资金，未绑定/已绑定都拒绝
    assert.equal((await call('city_partner', 'GET', '/admin/co-profits')).code, 1003)
    assert.equal((await call(null, 'GET', '/admin/co-profits', null, 'not-a-token')).code, 1002)
    assert.equal((await (await fetch(base + '/admin/co-profits')).json()).code, 1002, '未登录拒绝')
  })

  await test('作废：仅超管、仅未付单；作废后不能登记，部分已付走冲正', async () => {
    const co = await coIns('作废'), pid = await pfIns(co, 3000)
    ok(await call('super', 'POST', `/admin/co-profits/${pid}/void`, { reason: '重复生成的错单，整单作废' }))
    assert.equal(Number((await one('SELECT status FROM co_profit WHERE id = ?', [pid])).status), 2)
    assert.equal((await pay('finance', pid, basePay({ amount: 100 }))).code, 2002)
    assert.equal((await call('super', 'POST', `/admin/co-profits/${pid}/void`, { reason: '不能重复作废' })).code, 2002)
    const pid2 = await pfIns(co, 3000)
    ok(await pay('finance', pid2, basePay({ amount: 1000 })))
    assert.equal((await call('super', 'POST', `/admin/co-profits/${pid2}/void`, { reason: '已部分打款不能作废' })).code, 2002)
    assert.equal((await call('super', 'POST', `/admin/co-profits/${pid}/void`, { reason: '' })).code, 1001, '原因必填')
  })

  await test('审批阈值：超阈值登记进入待复核，登记人不能自批，通过/驳回后才生效；低于阈值直接生效', async () => {
    // 参数中心流程：超管提案 → 财务复核生效（阈值 30 元）
    const prop = ok(await call('super', 'POST', '/admin/config/proposal', { key: 'coprofit.pay_approve_min', newValue: 3000, reason: '分润回归：启用打款复核' }))
    ok(await call('finance', 'POST', '/admin/config/approve', { historyId: prop.historyId }))
    assert.equal(Number(await cfgValue()), 3000)
    const co = await coIns('审批'), pid = await pfIns(co, 8000)
    // 财务登记 4000 ≥ 阈值 → 待复核，台账不变
    const r = ok(await pay('finance', pid, basePay({ amount: 4000 })))
    assert.equal(r.pending, true, '达到阈值应进入待复核')
    let cp = await one('SELECT * FROM co_profit WHERE id = ?', [pid])
    assert.equal(Number(cp.status), 0); assert.equal(Number(cp.paid_amount), 0, '待复核不改变台账')
    const payId = r.payId
    assert.equal((await call('finance', 'POST', `/admin/co-profits/pays/${payId}/approve`, { pass: true })).code, 1003, '财务无复核权')
    // 超管登记 2000（低于阈值）直接生效；再登记 4000（≥ 阈值）进入待复核 → 自批被拒 → 驳回
    const direct = ok(await pay('super', pid, basePay({ amount: 2000 })))
    assert.equal(direct.paid, true, '低于阈值直接生效'); assert.equal(direct.settled, false)
    const supPay = ok(await pay('super', pid, basePay({ amount: 4000 })))
    assert.equal(supPay.pending, true)
    assert.equal((await call('super', 'POST', `/admin/co-profits/pays/${supPay.payId}/approve`, { pass: true })).code, 1003, '登记人不能自批')
    assert.equal((await call('super', 'POST', `/admin/co-profits/pays/${supPay.payId}/approve`, { pass: false, note: '自驳同样禁止' })).code, 1003, '登记人不能自驳')
    ok(await call('super', 'POST', `/admin/co-profits/pays/${supPay.payId}/withdraw`), '登记人撤回自己的待复核登记')
    assert.equal(Number((await one('SELECT status FROM co_profit_pay WHERE id = ?', [supPay.payId])).status), 4)
    assert.equal((await call('finance', 'POST', `/admin/co-profits/pays/${supPay.payId}/withdraw`)).code, 1003, '只能撤回本人登记')
    ok(await call('super', 'POST', `/admin/co-profits/pays/${payId}/approve`, { pass: true, note: '回单核对无误' }))
    cp = await one('SELECT * FROM co_profit WHERE id = ?', [pid])
    assert.equal(Number(cp.status), 0, '2000+4000 < 8000，部分结清仍待打款'); assert.equal(Number(cp.paid_amount), 6000)
    // 恢复阈值为 0（超管提案、财务复核），避免影响后续套件
    const prop2 = ok(await call('super', 'POST', '/admin/config/proposal', { key: 'coprofit.pay_approve_min', newValue: 0, reason: '分润回归：恢复关闭' }))
    ok(await call('finance', 'POST', '/admin/config/approve', { historyId: prop2.historyId }))
    assert.equal(Number(await cfgValue()), 0)
    ok(await pay('finance', pid, basePay({ amount: 2000 })))
    assert.equal(Number((await one('SELECT paid_amount FROM co_profit WHERE id = ?', [pid])).paid_amount), 8000)
    assert.equal(Number((await one('SELECT status FROM co_profit WHERE id = ?', [pid])).status), 1)
  })

  await test('冲正：负向流水抵扣、分润单回待打款、不可重复冲正；流水轨迹完整', async () => {
    const co = await coIns('冲正'), pid = await pfIns(co, 5000)
    const r = ok(await pay('finance', pid, basePay({ amount: 5000 })))
    const hist = ok(await call('finance', 'GET', `/admin/co-profits/${pid}/pays`))
    const eff = hist.find((y) => Number(y.direction) === 1 && Number(y.status) === 1)
    assert.equal((await call('ops', 'POST', `/admin/co-profits/pays/${eff.id}/reverse`, { payRef: stamp + '-REV', note: 'x' })).code, 1003)
    ok(await call('finance', 'POST', `/admin/co-profits/pays/${eff.id}/reverse`, { payRef: stamp + '-REV1', note: '流水登记错误，银行已冲正' }))
    const cp = await one('SELECT * FROM co_profit WHERE id = ?', [pid])
    assert.equal(Number(cp.paid_amount), 0); assert.equal(Number(cp.status), 0, '冲正后回待打款')
    assert.equal((await call('finance', 'POST', `/admin/co-profits/pays/${eff.id}/reverse`, { payRef: stamp + '-REV2', note: '重复冲正' })).code, 2002)
    assert.equal((await call('finance', 'POST', `/admin/co-profits/pays/${eff.id}/reverse`, { payRef: stamp + '-REV1', note: '冲正流水重复' })).code, 2002)
    // 再登记 → 重新结清；轨迹含 冲正(负) + 两笔正
    ok(await pay('finance', pid, basePay({ amount: 5000 })))
    const ys = await q('SELECT direction, amount, status FROM co_profit_pay WHERE co_profit_id = ? ORDER BY id', [pid])
    assert.equal(ys.filter((y) => Number(y.status) === 1).reduce((s, y) => s + Number(y.amount), 0), 5000)
    assert.equal(ys.some((y) => Number(y.direction) === 2 && Number(y.status) === 1 && Number(y.amount) === -5000), true, '冲正流水为负向金额')
    const revLog = await one("SELECT action FROM audit_log WHERE module = 'co-profit' AND biz_ref = ? AND action = 'pay-reverse'", ['coprofit-' + pid])
    assert(revLog, '冲正写审计')
  })

  await test('并发：两会话同时登记同一分润单，只有一笔生效，不重复支付', async () => {
    const co = await coIns('并发'), pid = await pfIns(co, 5000)
    const [a, b] = await Promise.all([
      pay('finance', pid, basePay({ amount: 5000 })),
      call('super', 'POST', `/admin/co-profits/${pid}/pay`, basePay({ amount: 5000 })),
    ])
    const codes = [a, b].map((r) => r.code).sort()
    assert.deepEqual(codes, [0, 2002], '一笔成功一笔状态冲突：' + JSON.stringify([a, b].map((r) => ({ code: r.code, msg: r.msg }))))
    assert.equal(Number((await one('SELECT paid_amount FROM co_profit WHERE id = ?', [pid])).paid_amount), 5000)
    const ys = await one("SELECT COUNT(*) n FROM co_profit_pay WHERE co_profit_id = ? AND status = 1 AND direction = 1", [pid])
    assert.equal(Number(ys.n), 1, '有效打款流水只有一笔')
  })

  await test('回单附件：上传、登记、受控下载（运营/财务/超管可看，审核/风控/城市不可）', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    assert.equal((await call('ops', 'POST', '/admin/co-profits/receipt-upload', { data: png, ext: 'png' })).code, 1003)
    const up = ok(await call('finance', 'POST', '/admin/co-profits/receipt-upload', { data: png, ext: 'png' }))
    created.receiptFiles.push(up.url)
    assert.ok(/^\/receipts\/receipt_\d+_\d+\.png$/.test(up.url), '回单存独立目录不进公开静态：' + up.url)
    assert.equal((await call('finance', 'POST', '/admin/co-profits/receipt-upload', { data: png, ext: 'exe' })).code, 1001)
    const co = await coIns('回单'), pid = await pfIns(co, 2000)
    ok(await pay('finance', pid, basePay({ amount: 2000, receiptUrl: up.url })))
    const hist = ok(await call('finance', 'GET', `/admin/co-profits/${pid}/pays`))
    const eff = hist.find((y) => Number(y.status) === 1)
    const rc = ok(await call('ops', 'GET', `/admin/co-profits/pays/${eff.id}/receipt`))
    assert.equal(rc.contentType, 'image/png'); assert.ok(rc.data.length > 10)
    for (const role of ['review', 'risk']) assert.equal((await call(role, 'GET', `/admin/co-profits/pays/${eff.id}/receipt`)).code, 1003, role)
    // 公网静态服务不覆盖 /receipts
    const pub = await fetch(base + up.url)
    assert.ok(pub.status >= 400, '/receipts 不应可公开访问：' + pub.status)
  })

  await test('T00 导出：城市账号一律拒绝，角色按报表类型校验，内容不越权', async () => {
    assert.equal((await call('city_partner', 'GET', '/admin/export/orders')).code, 1003)
    assert.equal((await call('ops', 'GET', '/admin/export/settlements')).code, 1003)
    assert.equal((await call('review', 'GET', '/admin/export/merchants')).code, 1003)
    const fin = ok(await call('finance', 'GET', '/admin/export/settlements'))
    assert.ok(fin.csv.length > 0)
    const op = ok(await call('ops', 'GET', '/admin/export/orders'))
    assert.ok(op.csv.includes('order_no'), '订单导出包含单号表头')
    const mh = ok(await call('ops', 'GET', '/admin/export/merchants'))
    assert.ok(!/1\d{10}/.test(mh.csv), '商户导出不得出现完整手机号')
  })

  await test('T00 城市边界：实体资料、商品数据/团期、协议、审计、风控、预算按角色与城市拒绝', async () => {
    const other = otherCityProd || prod
    const ownTok = cityToken(cityA)
    const otherProdId = other.city_code !== cityA ? other.id : prod.id
    if (otherCityProd && String(otherCityProd.city_code) !== String(cityA)) {
      assert.equal((await call(null, 'GET', `/admin/entities/product/${otherCityProd.id}`, null, ownTok)).code, 1003, '跨城商品资料')
      assert.equal((await call(null, 'GET', `/admin/products/${otherCityProd.id}/overview`, null, ownTok)).code, 1003, '跨城商品数据')
      assert.equal((await call(null, 'GET', `/admin/products/${otherCityProd.id}/sessions`, null, ownTok)).code, 1003, '跨城团期')
    }
    assert.equal((await call(null, 'GET', `/admin/entities/badge/${(await one('SELECT id FROM badge LIMIT 1')).id}`, null, ownTok)).code, 1003, '无城市维度实体对城市账号拒绝')
    assert.equal((await call(null, 'GET', '/admin/entities/merchant', null, ownTok)).code, 0)
    assert.equal((await call(null, 'GET', '/admin/agreements', null, ownTok)).code, 1003, '城市无协议菜单')
    assert.equal((await call('ops', 'GET', '/admin/risk')).code, 1003, '风控事件仅超管/风控')
    assert.equal((await call('review', 'GET', '/admin/audit-logs')).code, 1003, '审计仅超管/财务/风控')
    assert.equal((await call('risk', 'GET', '/admin/budgets')).code, 1003, '预算仅超管/运营/财务')
    assert.equal((await call('finance', 'GET', '/admin/content-tasks')).code, 1003, '约稿仅内容角色')
    assert.equal((await call('finance', 'POST', '/admin/content-tasks', { title: '越权', brief: '越权创建任务测试' })).code, 1003)
  })

  console.log(`\n${passed} 项批次 A（T01 共创分润闭环 + T00 能力边界）回归通过`)
} finally {
  // 清理夹具：流水→分润→共创人→审计→回单文件→参数恢复，不污染其他套件
  if (created.profits.length) {
    await q('DELETE FROM co_profit_pay WHERE co_profit_id IN (?)', [created.profits])
    await q('DELETE FROM co_profit WHERE id IN (?)', [created.profits])
  }
  if (created.coCreators.length) await q('DELETE FROM co_creator WHERE id IN (?)', [created.coCreators])
  await q("DELETE FROM audit_log WHERE module = 'co-profit'")
  await q("DELETE FROM audit_log WHERE module = 'config' AND biz_ref = 'coprofit.pay_approve_min'")
  await q("DELETE FROM config_history WHERE cfg_key = 'coprofit.pay_approve_min'")
  await q("UPDATE rule_config SET v = '0' WHERE k = 'coprofit.pay_approve_min'")
  for (const u of created.receiptFiles) { const p = path.join(import.meta.dirname, '..', 'static', u.replace(/^\//, '')); try { fs.unlinkSync(p) } catch { } }
  await closeDb()
}
async function cfgValue() {
  const r = await call('super', 'GET', '/admin/config')
  const row = (r.data || []).find((x) => x.k === 'coprofit.pay_approve_min')
  return row ? row.v : '0'
}
