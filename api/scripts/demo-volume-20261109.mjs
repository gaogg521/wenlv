// 演示大盘流水：让「今日 / 近 7 天 / 近 30 天 / 近一年」都有成规模、有起伏的数据。
// 做法与 demo-merchant-month-20261108 一致：全部走业务接口（下单→MOCK 支付→扫码核销→联调完成/全额退款），
// 只回填本批新订单的"业务展示日期"；不回填账本、日根、存证时间，不改既有订单，没有真实资金。
// 默认只预览；--apply 才执行。可重复执行：按"目标日单量 − 当日已有已支付单"补差，补够就新增 0。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import mysql from 'mysql2/promise'
import { q, one, tx, closeDb } from '../src/db.mjs'
import { getSecrets } from '../src/infra/secrets.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'
import { cfgNum } from '../src/config.mjs'

const base = process.env.API_BASE || 'http://127.0.0.1:8080', batch = 'VOL20261109'
const FROM_AGE = Number(process.env.VOL_FROM_AGE ?? 364), TO_AGE = Number(process.env.VOL_TO_AGE ?? 0)
const SCALE = Number(process.env.VOL_SCALE ?? 1)
const BUYERS = Number(process.env.VOL_BUYERS ?? 160)
const dateAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const rngOf = (str) => { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) } let a = h >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** 目标日有效（已支付、未全退）单量：近高远低，周末与节假日抬升，夏季旺季，叠加确定性的随机起伏 */
function targetOf(age, date) {
  const rnd = rngOf('t' + date)
  const dow = new Date(date + 'T00:00:00Z').getUTCDay(), md = date.slice(5)
  let f = 12 + 30 * Math.exp(-age / 70)
  if (dow === 6 || dow === 0) f *= 1.35; else if (dow === 5) f *= 1.15
  if (md >= '07-01' && md <= '08-31') f *= 1.25
  if (md >= '10-01' && md <= '10-07') f *= 1.5
  if (md >= '02-14' && md <= '02-22') f *= 1.3
  if (md >= '05-01' && md <= '05-05') f *= 1.3
  f *= 0.85 + 0.3 * rnd()
  return Math.max(4, Math.round(f * SCALE))
}

const today = bizDay()
const dates = []
for (let age = FROM_AGE; age >= TO_AGE; age--) dates.push({ age, date: bizDay(-age) })

const products = await q('SELECT id, merchant_id, title, price_from FROM tour_product WHERE status = 1 ORDER BY id')
assert.ok(products.length >= 10, '在售商品太少')
const existing = Object.fromEntries((await q(`SELECT DATE(paid_at) d, COUNT(*) n FROM orders WHERE status IN (20,30,40,50) AND paid_at >= ? GROUP BY d`, [dateAdd(today, -FROM_AGE - 1)])).map(r => [String(r.d).slice(0, 10), Number(r.n)]))
const already = Object.fromEntries((await q(`SELECT DATE(paid_at) d, COUNT(*) n FROM orders WHERE contact_name LIKE ? GROUP BY d`, ['演示样例·量1109-%'])).map(r => [String(r.d).slice(0, 10), Number(r.n)]))

const weights = products.map(p => 1 / Math.pow(Number(p.price_from) / 100, 0.4))
const pick = (rnd) => { const t = weights.reduce((a, b) => a + b, 0); let x = rnd() * t; for (let i = 0; i < products.length; i++) { x -= weights[i]; if (x <= 0) return products[i] } return products[0] }

const plan = []
for (const { age, date } of dates) {
  const have = already[date] || 0   // 本批已建（含退款单），只用来给订单标签续号，避免重名
  const target = age === 0 && process.env.VOL_TODAY_TARGET ? Number(process.env.VOL_TODAY_TARGET) : targetOf(age, date)
  const valid = Math.max(0, target - (existing[date] || 0))   // 已有有效单（含本批已建）算进去，补够就新增 0
  const refund = Math.round(valid * 0.17)
  const rnd = rngOf('p' + date)
  const hourMax = age === 0 ? Math.max(9, new Date().getHours() - 1) : 21
  for (let i = 0; i < valid + refund; i++) {
    const isRefund = i >= valid
    let kind = isRefund ? 'refund' : 'complete'
    if (!isRefund && age <= 2) { const r = rnd(); kind = r < 0.22 ? 'waiting' : r < 0.40 ? 'verified' : 'complete' }
    const r2 = rnd(), qty = r2 < 0.5 ? 1 : r2 < 0.85 ? 2 : 3
    const hourMin = age === 0 ? Number(process.env.VOL_HOUR_FROM || 8) : 8
    const hour = hourMin + Math.floor(Math.pow(rnd(), 0.8) * (hourMax - hourMin + 1)), minute = Math.floor(rnd() * 60)
    plan.push({ date, age, kind, qty, product: pick(rnd), hour: Math.min(hour, hourMax), minute, n: have + i })
  }
}
const summary = () => {
  const by = (lo, hi) => plan.filter(p => p.age >= lo && p.age <= hi)
  return { batch, from: dates[0].date, to: dates[dates.length - 1].date, newOrders: plan.length,
    today: by(0, 0).length, last7: by(0, 6).length, d8to30: by(7, 29).length, d31to365: by(30, 400).length,
    kinds: plan.reduce((r, p) => (r[p.kind] = (r[p.kind] || 0) + 1, r), {}) }
}

let lock, results = [], t0 = Date.now()
try {
  if (!process.argv.includes('--apply')) console.log(JSON.stringify({ apply: false, ...summary() }, null, 2))
  else {
    assert.equal(process.env.ALLOW_DEMO_VOLUME, '1', '必须明确放行演示流水')
    assert.notEqual(process.env.NODE_ENV, 'production'); assert.ok(process.env.ADMIN_PASSWORD)
    const db = process.env.DB_NAME || ''
    assert.ok(db === 'wanderlust' || db.startsWith('wanderlust_qa_'), '仅演示或隔离验证库')
    const url = new URL(base); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'http:')
    assert.equal(db === 'wanderlust', url.port === '8080', '演示库/隔离库端口不匹配')
    const keys = ['WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_API_V3_KEY'], secrets = await getSecrets(keys)
    assert.ok(keys.every(k => !secrets[k] && !process.env[k]) && !process.env.WX_PRIVATE_KEY_PATH, '支付凭据存在，禁止模拟流水')
    lock = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASS || 'root', database: db })
    const [locked] = await lock.query('SELECT GET_LOCK(?,0) ok', ['demo-volume:' + batch]); assert.equal(Number(locked[0].ok), 1, '同批生成器已在运行')
    const call = async (method, path, body, token) => {
      const r = await (await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })).json()
      if (r.code !== 0) throw new Error(path + ': ' + JSON.stringify(r.data || r.msg)); return r.data
    }
    const admin = await call('POST', '/admin/login', { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD })
    // 老板账号需要在商户 2、3 也有门店身份才能核销它们的订单；只补缺失的，已有的不动
    for (const mid of [...new Set(products.map(p => Number(p.merchant_id)))]) {
      if (mid === 1) continue
      await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role, status) SELECT ?, id, 2, 1 FROM user_account WHERE mini_b_openid = ?', [mid, 'mock-openid-mock-chenjie'])
    }
    const merchantTok = {}
    for (const mid of [...new Set(products.map(p => Number(p.merchant_id)))]) merchantTok[mid] = (await call('POST', '/m/auth/login', { code: 'mock-chenjie', merchantId: mid })).token
    // 买家池：避免所有订单都落在同一个用户名下
    const buyers = []
    for (let i = 0; i < BUYERS; i++) {
      const b = await call('POST', '/c/auth/login', { code: `mock-volume-${batch}-${i}` })
      const consent = await call('GET', '/c/consent', null, b.token)
      for (const scene of ['privacy', 'terms']) if (!consent.items.some(x => x.scene === scene && x.granted)) await call('POST', '/c/consent', { scene, granted: true, version: consent.versions[scene] }, b.token)
      buyers.push(b)
    }
    const observe = await cfgNum('order.observe_days')
    const freeDate = async (pid, want) => { for (let k = 0; k < 60; k++) for (const sign of k ? [-1, 1] : [0]) { const d = dateAdd(want, sign * k); if (!(await one('SELECT id FROM tour_session WHERE product_id=? AND depart_date=?', [pid, d]))) return d } throw new Error('找不到空闲团期日 ' + pid + ' ' + want) }
    const ensureSession = async (product, departDate, note) => {
      let s = await one("SELECT id FROM tour_session WHERE product_id=? AND JSON_UNQUOTE(JSON_EXTRACT(profile,'$.note'))=?", [product.id, note])
      if (s) {
        // 续跑时可能复用前一轮已关闭、已改回模拟日的团期：先重新打开到今天（今天的位置被他人占着就退回"挂靠他人团期"）
        const cur = await one('SELECT depart_date, status FROM tour_session WHERE id=?', [s.id])
        if (Number(cur.status) === 1 && String(cur.depart_date).slice(0, 10) === departDate) return { id: s.id, owned: true }
        const taken = await one('SELECT id FROM tour_session WHERE product_id=? AND depart_date=? AND id<>?', [product.id, departDate, s.id])
        if (!taken) { await q('UPDATE tour_session SET depart_date=?, status=1 WHERE id=?', [departDate, s.id]); return { id: s.id, owned: true } }
        return { id: taken.id, owned: false }
      }
      const exist = await one('SELECT id FROM tour_session WHERE product_id=? AND depart_date=?', [product.id, departDate])
      if (exist) return { id: exist.id, owned: false } // 当天已有他人的团期：订单挂上去，但不改它的日期
      const made = await call('POST', '/admin/entities/session', { parentId: product.id, values: { depart_date: departDate, quota: 999, min_go: 1, price_adult: Number(product.price_from) / 100, status: '1', note } }, admin.token)
      return { id: made.id, owned: true }
    }
    const doOrder = async (o, session, buyer) => {
      const label = `演示样例·量1109-${o.date.slice(5).replace('-', '')}-${o.n}`
      let row = await one('SELECT * FROM orders WHERE user_id=? AND contact_name=?', [buyer.user.id, label])
      if (!row) { const created = await call('POST', '/c/orders', { sessionId: session.id, qty: o.qty, contactName: label, contactPhone: '13800001234' }, buyer.token); row = await one('SELECT * FROM orders WHERE order_no=?', [created.orderNo]) }
      if (await one('SELECT id FROM order_event WHERE order_id=? AND actor=?', [row.id, 'demo:' + batch])) return null
      if (Number(row.status) === 10) await call('POST', '/admin/dev/mock-pay', { orderNo: row.order_no }, admin.token)
      let detail = await call('GET', '/c/orders/' + row.order_no, null, buyer.token)
      if (o.kind === 'refund') {
        if ([20, 30].includes(Number(detail.status))) await call('POST', '/admin/orders/' + row.order_no + '/refund', { mode: 'full', reason: '演示样例·' + batch + ' 模拟全额退款（无真实资金）' }, admin.token)
        detail = await call('GET', '/c/orders/' + row.order_no, null, buyer.token); assert.equal(Number(detail.status), 70, '模拟退款未完成')
      } else if (o.kind !== 'waiting') {
        for (const pass of detail.passes.filter(x => Number(x.status) === 1)) {
          const code = await call('GET', '/c/pass/' + pass.id + '/code', null, buyer.token)
          const v = await call('POST', '/m/verify/scan', { payload: code.qr }, merchantTok[Number(o.product.merchant_id)]); assert.ok(v.ok, v.reason)
        }
        detail = await call('GET', '/c/orders/' + row.order_no, null, buyer.token)
        if (o.kind === 'complete' && Number(detail.status) === 40) await call('POST', '/admin/dev/complete', { orderNo: row.order_no }, admin.token)
      }
      const wanted = { waiting: 30, verified: 40, complete: 50, refund: 70 }[o.kind]
      const hh = String(o.hour).padStart(2, '0'), mm = String(o.minute).padStart(2, '0')
      const paid = `${o.date} ${hh}:${mm}:00`, verified = `${o.date} ${String(Math.min(o.hour + 3, 21)).padStart(2, '0')}:${mm}:00`, completed = `${o.date} 21:30:00`
      const depart = o.date
      await tx(async c => {
        const r = await c.one('SELECT * FROM orders WHERE id=? AND user_id=? AND contact_name=? FOR UPDATE', [row.id, buyer.user.id, label])
        assert.ok(r); assert.equal(Number(r.status), wanted)
        const payment = await c.one('SELECT * FROM payment WHERE order_id=?', [r.id]); assert.ok(payment && String(payment.wx_trans_no).startsWith('MOCK'))
        const notify = typeof payment.raw_notify === 'string' ? JSON.parse(payment.raw_notify) : payment.raw_notify; assert.equal(notify.mock, true)
        await c.upd('UPDATE orders SET created_at=?,paid_at=?,completed_at=?,refund_deadline=DATE_ADD(?,INTERVAL ? DAY) WHERE id=?', [`${o.date} ${hh}:${mm}:00`, paid, wanted === 50 ? completed : null, paid, observe, r.id])
        await c.upd('UPDATE payment SET callback_at=? WHERE order_id=?', [paid, r.id])
        await c.upd('UPDATE travel_pass SET created_at=?,valid_from=?,valid_to=DATE_ADD(?,INTERVAL 2 DAY) WHERE order_id=?', [paid, depart, depart, r.id])
        await c.upd('UPDATE verification_log SET created_at=? WHERE pass_id IN (SELECT id FROM travel_pass WHERE order_id=?)', [verified, r.id])
        await c.upd('UPDATE refunds SET settled_at=? WHERE order_id=? AND status=2', [`${o.date} 22:00:00`, r.id])
        await c.q('INSERT INTO order_event(order_id,from_st,to_st,actor,detail) VALUES (?,?,?,?,?)', [r.id, wanted, wanted, 'demo:' + batch, JSON.stringify({ simulation: true, batch, businessDate: o.date, importedAt: new Date().toISOString(), ledgerClock: 'actual import time; historical roots unchanged' })])
        await c.q('INSERT INTO audit_log(actor,module,action,biz_ref,before_val,after_val) VALUES (?,?,?,?,?,?)', ['demo:' + batch, 'demo_history', 'import-volume-sample', r.order_no, JSON.stringify({ paid_at: r.paid_at, created_at: r.created_at }), JSON.stringify({ businessDate: o.date, simulation: true, originalRecordsUntouched: true })])
      })
      return { orderNo: row.order_no, date: o.date, status: wanted }
    }
    let done = 0, seq = 0
    for (const { date, age } of dates) {
      const day = plan.filter(p => p.date === date); if (!day.length) continue
      const byProd = new Map(); for (const p of day) (byProd.get(p.product.id) || byProd.set(p.product.id, []).get(p.product.id)).push(p)
      for (const [pid, list] of byProd) {
        const product = list[0].product
        {
          const grp = [...list.filter(p => p.kind !== 'refund'), ...list.filter(p => p.kind === 'refund')]
          // 同一商品同一天只能有一个团期：正常单与退款单共用，核销必须在"今天"，所以建在今天，做完再改回模拟日
          const s = await ensureSession(product, today, `${batch}|${date}|${pid}|n`)
          for (const o of grp) { const r = await doOrder(o, s, buyers[seq++ % buyers.length]); if (r) results.push(r) }
          if (s.owned) {
            const fin = await freeDate(pid, date)
            await q('UPDATE tour_session SET depart_date=?, status=3 WHERE id=?', [fin, s.id])
          }
          done += grp.length
        }
      }
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${date} +${day.length}（累计 ${done}/${plan.length}）`)
    }
    const report = { ...summary(), created: results.length, realMoneyTransferred: false, historicalLedgerOrSealTimesChanged: false, seconds: Math.round((Date.now() - t0) / 1000) }
    if (process.env.DEMO_REPORT) fs.writeFileSync(process.env.DEMO_REPORT, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
} catch (e) { if (process.env.DEMO_REPORT) fs.writeFileSync(process.env.DEMO_REPORT, JSON.stringify({ batch, partial: true, created: results.length, error: e.message }, null, 2)); throw e }
finally { if (lock) { await lock.query('SELECT RELEASE_LOCK(?)', ['demo-volume:' + batch]); await lock.end() } await closeDb() }
