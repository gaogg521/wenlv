// 凭据主密钥（SECRETS_KEY）工具。后台保存的支付/链/小程序凭据用它做 AES-256-GCM 加密。
//
//   node scripts/secrets-key.mjs new              生成一个新的随机主密钥（64 位十六进制）
//   node scripts/secrets-key.mjs current          打印"当前正在用"的主密钥（来自 SECRETS_KEY，或由 JWT_SECRET 派生）
//   node scripts/secrets-key.mjs check            用当前主密钥逐条试解密库里的凭据（需要数据库环境变量）
//   node scripts/secrets-key.mjs rotate <新密钥>   把库里全部凭据从当前主密钥重新加密到新密钥（同一事务，任一条解不开就整体放弃）
//
// 生产首次设置 SECRETS_KEY 的推荐做法：用与服务相同的 JWT_SECRET 运行 `current`，把输出原样设为 SECRETS_KEY。
// 这样已存凭据不需要重新加密，之后 JWT_SECRET 可以独立轮换。想换成全新密钥，再用 `rotate`，然后把服务的 SECRETS_KEY 改成新值并重启。
import crypto from 'node:crypto'
import { resolveMasterKey, encWith, decWith } from '../src/infra/secrets.mjs'

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
  if (cmd === 'rotate') {
    if (bad.length) { console.error('有凭据无法用当前主密钥解密，已放弃轮换（先确认 SECRETS_KEY / JWT_SECRET 与服务一致）'); process.exitCode = 1 }
    else {
      const next = Buffer.from(arg, 'hex')
      await tx(async (c) => { for (const [k, v] of plain) await c.q('UPDATE app_secret SET enc_value = ? WHERE k = ?', [encWith(next, v), k]) })
      console.log(`已用新密钥重新加密 ${plain.length} 条。现在把服务的 SECRETS_KEY 设为新密钥并重启。`)
    }
  } else if (bad.length) process.exitCode = 1
  await pool?.end?.()
  process.exit(process.exitCode || 0)
}
console.error('用法：node scripts/secrets-key.mjs new | current | check | rotate <新密钥>')
process.exit(2)
