// 凭据主密钥：来源判定、格式校验、加解密往返（不碰数据库）
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
const { resolveMasterKey, encWith, decWith } = await import('../src/infra/secrets.mjs')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ✓', name) }
t('未设置 SECRETS_KEY 时由 JWT_SECRET 派生', () => {
  const r = resolveMasterKey({ JWT_SECRET: 'abc' })
  assert.equal(r.source, 'derived'); assert.deepEqual(r.key, crypto.createHash('sha256').update('abc').digest())
})
t('设置合法 SECRETS_KEY 时优先使用', () => {
  const hex = 'a'.repeat(64); const r = resolveMasterKey({ SECRETS_KEY: hex, JWT_SECRET: 'abc' })
  assert.equal(r.source, 'env'); assert.equal(r.key.toString('hex'), hex)
})
t('SECRETS_KEY 格式错误直接报错，不静默回落', () => {
  for (const bad of ['abc', 'g'.repeat(64), 'a'.repeat(63)]) assert.throws(() => resolveMasterKey({ SECRETS_KEY: bad }), /64 位十六进制/)
})
t('"current" 输出的密钥设为 SECRETS_KEY 后可解开原有密文', () => {
  const derived = resolveMasterKey({ JWT_SECRET: 'prod-jwt' })
  const ct = encWith(derived.key, 'mch-secret-123')
  const viaEnv = resolveMasterKey({ SECRETS_KEY: derived.key.toString('hex'), JWT_SECRET: 'rotated-jwt' })
  assert.equal(decWith(viaEnv.key, ct), 'mch-secret-123')
})
t('换了密钥解不开（GCM 校验失败而不是返回乱码）', () => {
  const ct = encWith(crypto.randomBytes(32), 'x')
  assert.throws(() => decWith(crypto.randomBytes(32), ct))
})
console.log(`\n${n} 项通过`)
