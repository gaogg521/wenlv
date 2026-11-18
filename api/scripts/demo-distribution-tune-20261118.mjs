// D-05 演示指标分布修正 v2（零后台依赖）：全部走游客接口——
//   A 组一次性买家：下单 → /c/orders/:no/pay 触发 MOCK 自动出票（1.2s）→ 已支付（拉复购分母）
//   B 组未支付单：下单不支付 → 15 分钟后关单 job 自动置 90（拉转化分母）；名额波次控制防超占
// 幂等：按 contact_name 前缀统计补差。
// 用法：ALLOW_DESTRUCTIVE=1 DB_NAME=wanderlust API_BASE=http://127.0.0.1:8080 node scripts/demo-distribution-tune-20261118.mjs [--apply]
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'

const db = process.env.DB_NAME
if (!db || !process.env.ALLOW_DESTRUCTIVE) { console.error('[拒绝] 需显式 DB_NAME + ALLOW_DESTRUCTIVE=1'); process.exit(2) }
const APPLY = process.argv.includes('--apply')
const BASE = process.env.API_BASE || 'http://127.0.0.1:8080'
const PREFIX = '演示样例·分布1118-'
const TARGET_CONV = Number(process.env.TUNE_CONV ?? 0.88)
const TARGET_REBUY = Number(process.env.TUNE_REBUY ?? 0.30)
const TAG = '分布1118'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const rawApi = async (m, p, b, tok) => (await fetch(BASE + p, {
  method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
  body: b ? JSON.stringify(b) : undefined })).json()
// 8080 keepAliveTimeout 会复位长连接（ECONNRESET）：fetch 失败自动重试两次
const api = async (m, p, b, tok) => {
  let lastErr
  for (let t = 0; t < 3; t++) {
    try { return await rawApi(m, p, b, tok) } catch (e) { lastErr = e; await wait(300) }
  }
  throw lastErr
}
const ok = (r, what) => { assert.equal(r.code, 0, (what || '') + ' 失败: ' + (r.msg || '').slice(0, 100)); return r.data }
const pct = (a, b) => (b ? Math.round(Number(a) / Number(b) * 1000) / 10 + '%' : '—')

const metrics = await one(`SELECT COUNT(*) created, COALESCE(SUM(status BETWEEN 20 AND 70), 0) paid,
  (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status IN (20,30,40,50)) payers,
  (SELECT COUNT(*) FROM (SELECT user_id FROM orders WHERE status IN (20,30,40,50) GROUP BY user_id HAVING COUNT(*) > 1) t) rebuyers,
  (SELECT COALESCE(SUM(status IN (60,70)), 0) FROM orders) refunded,
  (SELECT COUNT(*) FROM orders WHERE status = 10) waiting FROM orders`)
console.log(`当前：下单 ${metrics.created} · 转化 ${pct(metrics.paid, metrics.created)} · 复购 ${pct(metrics.rebuyers, metrics.payers)}（${metrics.rebuyers}/${metrics.payers}）· 退款占 ${pct(metrics.refunded, metrics.created)} · 在途未支付 ${metrics.waiting}`)

const paid = Number(metrics.paid), created = Number(metrics.created)
const rebuyers = Number(metrics.rebuyers), payers = Number(metrics.payers)
const x = Math.max(0, Math.round(rebuyers / TARGET_REBUY - payers))
const closed = Math.max(0, Math.round((paid + x) / TARGET_CONV) - created - x)
console.log(`目标：转化 ${Math.round(TARGET_CONV * 100)}% · 复购 ${Math.round(TARGET_REBUY * 100)}% → 新增一次性买家已支付 ${x} 笔 · 未支付（自动关单）${closed} 笔`)

const hist = Object.fromEntries((await q(`SELECT status, COUNT(*) n FROM orders WHERE contact_name LIKE ? GROUP BY status`, [PREFIX + '%'])).map(r => [r.status, Number(r.n)]))
const paidDone = (hist[20] || 0) + (hist[30] || 0) + (hist[40] || 0) + (hist[50] || 0) + (hist[70] || 0)
// B 组序号按名称总数计（含已关闭的 90 单）——关单不改 contact_name，按 status 统计会重复用序号
let unpaidDone = Number((await one(`SELECT COUNT(*) n FROM orders WHERE contact_name LIKE ?`, [PREFIX + '未支付%'])).n)
console.log(`本脚本历史：已支付 ${paidDone} · 未支付序号已用 ${unpaidDone}`)

const sessions = await q(`SELECT s.id, s.quota - s.booked seats FROM tour_session s JOIN tour_product p ON p.id = s.product_id
  WHERE s.status = 1 AND p.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 2
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.profile, '$.sign_deadline')), '') = '' ORDER BY (s.quota - s.booked) DESC LIMIT 40`)
assert.ok(sessions.length, '无可报名团期')

if (!APPLY) { console.log('【预检模式】加 --apply 执行'); await closeDb(); process.exit(0) }

let seq = 0
const pickSession = () => sessions[seq++ % sessions.length]
async function newBuyer(i, kind) {
  const buyer = ok(await api('POST', '/c/auth/login', { code: 'mock-dt-' + TAG + '-' + kind + '-' + i }), '买家登录 ' + i)
  ok(await api('POST', '/c/consent', { scene: 'privacy', granted: true }, buyer.token), '隐私授权')
  const s = pickSession()
  const order = ok(await api('POST', '/c/orders', { sessionId: s.id, qty: 1, beanDeduct: 0,
    contactName: PREFIX + (kind === 'paid' ? '买家' : '未支付') + String(i).padStart(4, '0'),
    contactPhone: '138' + String(10000000 + Math.floor(Math.random() * 89999999)) }, buyer.token), '下单 ' + i)
  return { buyer, orderNo: order.orderNo }
}

// A 组：已支付（调 pay 触发 mock 自动出票，轮询最长 6s 确认）
for (let i = paidDone; i < x; i++) {
  const { buyer, orderNo } = await newBuyer(i, 'paid')
  await api('POST', '/c/orders/' + orderNo + '/pay', {}, buyer.token)
  let st = null
  for (let t = 0; t < 12; t++) {
    await wait(500)
    st = await one('SELECT status FROM orders WHERE order_no = ?', [orderNo])
    if (Number(st.status) >= 20) break
    if (t === 5) await api('POST', '/c/orders/' + orderNo + '/pay', {}, buyer.token) // 半程未出票重触发
  }
  if (Number(st.status) === 10) console.log('  [warn] 出票未确认：' + orderNo + '（将在下轮幂等补差处理）')
  await wait(120)
  if ((i + 1) % 50 === 0) console.log(`  A 组 ${i + 1}/${x}`)
}
console.log('A 组完成：' + x + ' 笔已支付')

// B 组：未支付单分波——每次下单前动态选余量最大的团期（避免轮转撞小余量团期报"名额不足"），
// 波间等关单 job 释放名额；两轮等待无进展则结束（等下一轮幂等补差）
// 波内每次下单前动态选当前最大余量团期——把全库余量吃掉约 85% 才进入等待，最大化单波吞吐
let wave = 0, lastProgress = -1, stallRounds = 0
while (unpaidDone < closed && stallRounds < 2) {
  const remain = Number((await one(`SELECT COUNT(*) n FROM orders WHERE contact_name LIKE ? AND status = 10`, [PREFIX + '%'])).n)
  const avail = Number((await one(`SELECT COALESCE(SUM(s.quota - s.booked), 0) v FROM tour_session s JOIN tour_product p ON p.id = s.product_id
    WHERE s.status = 1 AND p.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 2`)).v)
  console.log(`波 ${++wave}：在途未关 ${remain} · 全库可报名余量 ${avail}`)
  if (avail < 2) break
  const quota = Math.floor(Number(avail) * 0.85)
  let placed = 0, consecFail = 0
  while (unpaidDone < closed && placed < quota && consecFail < 5) {
    const top = await one(`SELECT s.id FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE s.status = 1 AND p.status = 1 AND s.depart_date >= CURDATE() AND s.quota - s.booked >= 2
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.profile, '$.sign_deadline')), '') = ''
      ORDER BY (s.quota - s.booked) DESC LIMIT 1`)
    if (!top) break
    try {
      const buyer = ok(await api('POST', '/c/auth/login', { code: 'mock-dt-' + TAG + '-unpaid-' + wave + '-' + placed }), '买家登录')
      ok(await api('POST', '/c/consent', { scene: 'privacy', granted: true }, buyer.token), '隐私授权')
      const order = ok(await api('POST', '/c/orders', { sessionId: top.id, qty: 1, beanDeduct: 0,
        contactName: PREFIX + '未支付' + String(unpaidDone).padStart(4, '0'),
        contactPhone: '138' + String(10000000 + Math.floor(Math.random() * 89999999)) }, buyer.token), '下单')
      unpaidDone++
      placed++
      consecFail = 0
      if (unpaidDone % 100 === 0) console.log(`  B 组在途 ${unpaidDone}/${closed}`)
    } catch (e) {
      consecFail++
      await wait(300)
    }
  }
  if (unpaidDone === lastProgress) { stallRounds++; console.log(`  两轮无进展（${stallRounds}/2），将结束`) } else stallRounds = 0
  lastProgress = unpaidDone
  if (unpaidDone >= closed) break
  console.log(`  本波放下 ${placed} 笔 · 等待 17 分钟关单 job 释放名额…`)
  await wait(17 * 60000)
}

const after = await one(`SELECT COUNT(*) created, COALESCE(SUM(status BETWEEN 20 AND 70), 0) paid,
  (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status IN (20,30,40,50)) payers,
  (SELECT COUNT(*) FROM (SELECT user_id FROM orders WHERE status IN (20,30,40,50) GROUP BY user_id HAVING COUNT(*) > 1) t) rebuyers,
  (SELECT COALESCE(SUM(status IN (60,70)), 0) FROM orders) refunded, (SELECT COUNT(*) FROM orders WHERE status = 10) waiting FROM orders`)
console.log(`\n执行后：下单 ${after.created} · 转化 ${pct(after.paid, after.created)} · 复购 ${pct(after.rebuyers, after.payers)} · 退款占 ${pct(after.refunded, after.created)} · 在途 ${after.waiting}（未关单将在 15 分钟内自动关闭）`)
await closeDb()
