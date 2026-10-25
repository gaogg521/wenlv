// 凭据保险箱：AES-256-GCM 加密落库（app_secret），后台集成中心读写，热缓存
// 密钥来源优先级：SECRETS_KEY 环境变量（hex32字节）> JWT_SECRET 派生（SHA-256）
// 读取链：缓存 → app_secret 表 → 环境变量兜底（迁移期兼容旧 .env）
import crypto from 'node:crypto'
import { q, one } from '../db.mjs'

const master = (() => {
  const hex = process.env.SECRETS_KEY
  if (hex && hex.length === 64) return Buffer.from(hex, 'hex')
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'wanderlust-dev-jwt-secret-change-me').digest()
})()

let cache = null, loadedAt = 0
async function load(force = false) {
  if (!force && cache && Date.now() - loadedAt < 15_000) return cache
  try { const rows = await q('SELECT k, enc_value FROM app_secret'); cache = Object.fromEntries(rows.map((r) => [r.k, dec(r.enc_value)])) }
  catch { cache = {} }
  loadedAt = Date.now()
  return cache
}
function dec(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const iv = b.subarray(0, 12), tag = b.subarray(12, 28), ct = b.subarray(28)
  const c = crypto.createDecipheriv('aes-256-gcm', master, iv)
  c.setAuthTag(tag)
  return Buffer.concat([c.update(ct), c.final()]).toString('utf8')
}
function enc(str) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', master, iv)
  const ct = Buffer.concat([c.update(str, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}

/** 读取：缓存→库→环境变量（.env 迁移兼容） */
export async function getSecret(key) {
  const c = await load()
  if (key in c && c[key]) return c[key]
  return process.env[key] || ''
}
export async function getSecrets(keys) {
  const out = {}
  for (const k of keys) out[k] = await getSecret(k)
  return out
}
export async function setSecret(key, value, by) {
  await q(`INSERT INTO app_secret (k, enc_value, hint, updated_by) VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE enc_value = VALUES(enc_value), hint = VALUES(hint), updated_by = VALUES(updated_by)`,
    [key, enc(value), value.length <= 4 ? '****' : '****' + value.slice(-4), by || ''])
  await load(true)
}
export async function delSecret(key) {
  await q('DELETE FROM app_secret WHERE k = ?', [key])
  await load(true)
}
export async function listSecretMeta() {
  return await q('SELECT k, hint, updated_by, updated_at FROM app_secret ORDER BY k')
}
