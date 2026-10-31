// 商户 T1 可信记录自测：店长可取、核销员被拒、公开复核不泄金额
import { one } from '../src/db.mjs'
import { jwtSign } from '../src/auth.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  PASS ', m) } else { fail++; console.log('  FAIL ', m, extra === undefined ? '' : JSON.stringify(extra)) } }

const st = await one('SELECT id, merchant_id, total_amount FROM settlement ORDER BY id DESC LIMIT 1')
ok(!!st, '存在结算单 #' + (st && st.id))
if (!st) process.exit(1)

const boss = await one('SELECT user_id, role FROM merchant_staff WHERE merchant_id=? AND role>=2 AND status=1 LIMIT 1', [st.merchant_id])
ok(!!boss, '存在店长绑定')
if (!boss) process.exit(1)

const tBoss = jwtSign({ uid: boss.user_id, end: 'm', merchantId: st.merchant_id, role: boss.role })
const r1 = await fetch(`${API}/m/report/settlement/${st.id}`, { headers: { authorization: 'Bearer ' + tBoss } })
const b1 = Buffer.from(await r1.arrayBuffer())
ok(r1.status === 200 && (r1.headers.get('content-type') || '').includes('pdf') && b1.subarray(0, 5).toString() === '%PDF-',
  `店长可取《结算可信记录》PDF（${Math.round(b1.length / 1024)} KB）`, r1.status)

const clerk = await one('SELECT user_id FROM merchant_staff WHERE merchant_id=? AND role=1 AND status=1 LIMIT 1', [st.merchant_id])
if (clerk) {
  const t2 = jwtSign({ uid: clerk.user_id, end: 'm', merchantId: st.merchant_id, role: 1 })
  const r2 = await fetch(`${API}/m/report/settlement/${st.id}`, { headers: { authorization: 'Bearer ' + t2 } })
  const j2 = await r2.json()
  ok(j2.code === 1003, '核销员被拒（需店长及以上）', j2.msg)
} else {
  console.log('  SKIP  本商户暂无核销员，越权用例跳过')
}

// 公开复核：只能拿校验码，不能拿金额
const r3 = await fetch(`${API}/open/verify/settlement/${st.id}`).then((x) => x.json())
const d = r3.data || {}
const keys = Object.keys(d)
ok(d.found === true && !!d.merkleRoot, '公开复核可查校验码')
ok(!keys.some((k) => /amount|amt|total|price|merchantName/i.test(k)), '公开复核响应不含任何金额/商户名字段', keys)
ok(String(d.merkleRoot).length === 64, '返回 64 位校验码')
ok(!JSON.stringify(d).includes(String(st.total_amount)), '响应体不含结算总额数值')

console.log(`\nT1 SETTLEMENT: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
