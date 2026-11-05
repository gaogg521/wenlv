// 凭据保险箱：AES-256-GCM 加密落库（app_secret），后台集成中心读写，热缓存
// 密钥来源优先级：SECRETS_KEY 环境变量（hex32字节）> JWT_SECRET 派生（SHA-256）
// 读取链：缓存 → app_secret 表 → 环境变量兜底（迁移期兼容旧 .env）
import crypto from 'node:crypto'
import { q, one } from '../db.mjs'

/** 主密钥来源：'env'（SECRETS_KEY）或 'derived'（由 JWT_SECRET 派生，换 JWT_SECRET 会导致已存凭据无法解密） */
export function resolveMasterKey(env = process.env) {
  const hex = env.SECRETS_KEY
  if (hex) {
    // 设置了但格式不对时直接拒绝启动：静默回落到派生密钥，会让之后保存的凭据换了把钥匙
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('SECRETS_KEY 必须是 64 位十六进制（32 字节）。生成：node scripts/secrets-key.mjs new')
    return { key: Buffer.from(hex, 'hex'), source: 'env' }
  }
  return { key: crypto.createHash('sha256').update(env.JWT_SECRET || 'wanderlust-dev-jwt-secret-change-me').digest(), source: 'derived' }
}
const { key: master, source: keySource } = resolveMasterKey()
export { keySource }

let cache = null, loadedAt = 0, undecryptable = []
async function load(force = false) {
  if (!force && cache && Date.now() - loadedAt < 15_000) return cache
  let rows = []
  try { rows = await q('SELECT k, enc_value FROM app_secret') } catch { rows = [] }
  // 逐条解密：一条坏了不影响其他条；解不开的记下来，在运维控制台告警（通常是换了 JWT_SECRET / SECRETS_KEY）
  const next = {}, bad = []
  for (const r of rows) { try { next[r.k] = decWith(master, r.enc_value) } catch { bad.push(r.k) } }
  if (bad.length && bad.join() !== undecryptable.join()) console.warn(`[secrets] ${bad.length} 条凭据无法用当前主密钥解密：${bad.join(', ')}（检查 SECRETS_KEY / JWT_SECRET 是否被更换）`)
  cache = next; undecryptable = bad; loadedAt = Date.now()
  return cache
}
export function decWith(key, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const iv = b.subarray(0, 12), tag = b.subarray(12, 28), ct = b.subarray(28)
  const c = crypto.createDecipheriv('aes-256-gcm', key, iv)
  c.setAuthTag(tag)
  return Buffer.concat([c.update(ct), c.final()]).toString('utf8')
}
export function encWith(key, str) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(str, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}
const enc = (str) => encWith(master, str)

/** 运维控制台用：主密钥来源、已存条数、解不开的条目 */
export async function secretsHealth() {
  await load(true)
  return { keySource, stored: Object.keys(cache).length + undecryptable.length, undecryptable: [...undecryptable] }
}

/**
 * 某条凭据的状态：'ok' 能读到 / 'missing' 库里确实没有 / 'undecryptable' 库里有但当前主密钥解不开。
 * 区分后两种是为了"自动生成型"密钥（发行方签名密钥、DID 盐）：missing 才允许首次生成，
 * undecryptable 必须失败关闭——否则一次配置错误（换了 JWT_SECRET / SECRETS_KEY）就会把原密钥覆盖掉。
 */
export async function secretStatus(key) {
  const c = await load()
  if (key in c && c[key]) return 'ok'
  if (undecryptable.includes(key)) return 'undecryptable'
  return process.env[key] ? 'ok' : 'missing'
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

/** 同步读取（链适配器在同步代码里取配置用）：只读缓存，缓存由 warmSecrets() 启动预热并每 15 秒刷新 */
export function secretSync(key) { return cache && cache[key] ? cache[key] : '' }
let timer = null
export async function warmSecrets() {
  await load(true)
  if (!timer) { timer = setInterval(() => load(true).catch(() => {}), 15_000); timer.unref?.() }
}
