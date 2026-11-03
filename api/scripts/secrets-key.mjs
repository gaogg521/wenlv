// 凭据主密钥（SECRETS_KEY）工具。后台保存的支付/链/小程序凭据用它做 AES-256-GCM 加密。
//
//   node scripts/secrets-key.mjs new              生成一个新的随机主密钥（64 位十六进制）
//   node scripts/secrets-key.mjs current          打印"当前正在用"的主密钥（来自 SECRETS_KEY，或由 JWT_SECRET 派生）
//   node scripts/secrets-key.mjs check            用当前主密钥逐条试解密库里的凭据和用户手机号（需要数据库环境变量）
//   node scripts/secrets-key.mjs rotate <新密钥>   把库里全部凭据和已加密的用户手机号从当前主密钥重新加密到新密钥（同一事务，任一条解不开就整体放弃）
//
// 生产首次设置 SECRETS_KEY 的推荐做法：用与服务相同的 JWT_SECRET 运行 `current`，把输出原样设为 SECRETS_KEY。
// 这样已存凭据不需要重新加密，之后 JWT_SECRET 可以独立轮换。想换成全新密钥，再用 `rotate`，然后把服务的 SECRETS_KEY 改成新值并重启。
import crypto from 'node:crypto'
import { resolveMasterKey, encWith, decWith } from '../src/infra/secrets.mjs'
import { mobileKeys, openMobileWith, sealMobileWith } from '../src/infra/mobile.mjs'

const [cmd, arg] = process.argv.slice(2)
const HEX64 = /^[0-9a-fA-F]{64}$/

if (cmd === 'new') {
  console.log(crypto.randomBytes(32).toString('hex'))
  process.exit(0)
}
const cur = resolveMasterKey()
if (cmd === 'current') {
  console.error(`来源：${cur.source === 'env' ? 'SECRETS_KEY' : '由 JWT_SECRET 派生（请确认运行本命令时的 JWT_SECRET 与服务一致）'}`)
  console.log(cur.key.toString('hex'))
  process.exit(0)
}
if (cmd === 'check' || cmd === 'rotate') {
  if (cmd === 'rotate' && !HEX64.test(arg || '')) { console.error('用法：node scripts/secrets-key.mjs rotate <64 位十六进制新密钥>'); process.exit(2) }
  const { q, tx, pool } = await import('../src/db.mjs')
  const rows = await q('SELECT k, enc_value FROM app_secret ORDER BY k')
  const plain = [], bad = []
  for (const r of rows) { try { plain.push([r.k, decWith(cur.key, r.enc_value)]) } catch { bad.push(r.k) } }
  console.log(`共 ${rows.length} 条凭据；可解密 ${plain.length} 条${bad.length ? `；无法解密 ${bad.length} 条：${bad.join(', ')}` : ''}`)
  // 用户手机号同样由主密钥派生的子密钥加密，轮换时必须一并重写（历史明文行不动，等 encrypt-mobiles 处理）
  const curKeys = mobileKeys(cur.key)
  const mobiles = [], badMobile = []
  for (const r of await q('SELECT id, mobile_enc FROM user_account WHERE mobile_hmac IS NOT NULL')) {
    const p = openMobileWith(curKeys, r.mobile_enc)
    if (p == null) badMobile.push(r.id); else mobiles.push([r.id, p])
  }
  console.log(`已加密手机号 ${mobiles.length + badMobile.length} 条；可解密 ${mobiles.length} 条${badMobile.length ? `；无法解密 ${badMobile.length} 条：账号 ${badMobile.join(', ')}` : ''}`)
  // 商户申请电话、订单联系电话（V38）：新列非空即密文；同样由主密钥派生的子密钥加密，轮换时必须一并重写
  const sealed = [], badSealed = []
  for (const [table, col] of [['merchant', 'apply_mobile_enc'], ['orders', 'contact_phone_sealed']]) {
    for (const r of await q(`SELECT id, ${col} v FROM ${table} WHERE ${col} IS NOT NULL`)) {
      const p = openMobileWith(curKeys, r.v)
      if (p == null) badSealed.push(`${table}#${r.id}`); else sealed.push([table, col, r.id, p])
    }
  }
  console.log(`已加密联系电话（商户申请 / 订单）${sealed.length + badSealed.length} 条；可解密 ${sealed.length} 条${badSealed.length ? `；无法解密 ${badSealed.length} 条：${badSealed.slice(0, 20).join(', ')}` : ''}`)
  if (cmd === 'rotate') {
    if (bad.length || badMobile.length || badSealed.length) { console.error('有凭据或手机号无法用当前主密钥解密，已放弃轮换（先确认 SECRETS_KEY / JWT_SECRET 与服务一致）'); process.exitCode = 1 }
    else {
      const next = Buffer.from(arg, 'hex')
      const nextKeys = mobileKeys(next)
      await tx(async (c) => {
        for (const [k, v] of plain) await c.q('UPDATE app_secret SET enc_value = ? WHERE k = ?', [encWith(next, v), k])
        for (const [id, p] of mobiles) { const s = sealMobileWith(nextKeys, p); await c.q('UPDATE user_account SET mobile_enc = ?, mobile_hmac = ? WHERE id = ?', [s.enc, s.hmac, id]) }
        for (const [table, col, id, p] of sealed) await c.q(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [sealMobileWith(nextKeys, p).enc, id])
      })
      console.log(`已用新密钥重新加密凭据 ${plain.length} 条、手机号 ${mobiles.length} 条、联系电话 ${sealed.length} 条。现在把服务的 SECRETS_KEY 设为新密钥并重启。`)
    }
  } else if (bad.length || badMobile.length || badSealed.length) process.exitCode = 1
  await pool?.end?.()
  process.exit(process.exitCode || 0)
}
console.error('用法：node scripts/secrets-key.mjs new | current | check | rotate <新密钥>')
process.exit(2)
