// 把 user_account 里历史明文手机号一次性加密：node scripts/encrypt-mobiles.mjs
// 幂等：只处理"mobile_hmac 为空且 mobile_enc 是 11 位数字明文"的行，跑多少遍都一样；已加密的行不动。
// 同一手机号在多个账号上（历史上没有唯一约束）：保留 id 最小的账号，其余保持明文原样并在末尾列出，由运营决定怎么合并，脚本不替你删数据。
// 生产务必先用与服务相同的 SECRETS_KEY / JWT_SECRET 运行，否则服务读不出这些密文。
import { sealMobile, isLegacyPlain } from '../src/infra/mobile.mjs'
import { q, tx } from '../src/db.mjs'

const rows = await q('SELECT id, mobile_enc FROM user_account WHERE mobile_hmac IS NULL AND mobile_enc IS NOT NULL ORDER BY id')
const seen = new Map() // hmac -> 已占用它的账号 id
for (const r of await q('SELECT id, mobile_hmac FROM user_account WHERE mobile_hmac IS NOT NULL')) seen.set(r.mobile_hmac, r.id)
let done = 0
const dup = [], odd = []
await tx(async (c) => {
  for (const r of rows) {
    if (!isLegacyPlain(r.mobile_enc)) { odd.push(r.id); continue }
    const { enc, hmac } = sealMobile(r.mobile_enc.toString('utf8'))
    if (seen.has(hmac)) { dup.push([r.id, seen.get(hmac)]); continue }
    await c.q('UPDATE user_account SET mobile_enc = ?, mobile_hmac = ? WHERE id = ?', [enc, hmac, r.id])
    seen.set(hmac, r.id); done++
  }
})
console.log(`待处理 ${rows.length} 行：已加密 ${done} 行`)
if (dup.length) console.log(`手机号与其他账号重复，保持明文未处理 ${dup.length} 行（账号 → 已占用该号码的账号）：` + dup.map(([a, b]) => `${a}→${b}`).join('，'))
if (odd.length) console.log(`格式无法识别，未处理 ${odd.length} 行：账号 ${odd.join('，')}`)
process.exit(dup.length || odd.length ? 1 : 0)
