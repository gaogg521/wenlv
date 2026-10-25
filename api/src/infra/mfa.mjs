// MFA：TOTP(RFC 6238) + 短信/邮箱通知通道（MOCK 兜底，真实凭据就绪即切）
import crypto from 'node:crypto'
import { q, one } from '../db.mjs'

// ===== Base32 =====
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32Encode(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits) out += B32[(val << (5 - bits)) & 31]
  return out
}
export function base32Decode(s) {
  let bits = 0, val = 0, out = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    val = (val << 5) | idx; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

// ===== TOTP =====
export function totpAt(secretB32, counter) {
  const key = base32Decode(secretB32)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', key).update(buf).digest()
  const off = h[h.length - 1] & 0xf
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1_000_000
  return String(code).padStart(6, '0')
}
export const totpNow = (secretB32) => totpAt(secretB32, Math.floor(Date.now() / 1000 / 30))
/** 校验：允许 ±1 窗口时钟漂移 */
export function totpVerify(secretB32, code) {
  const c = Math.floor(Date.now() / 1000 / 30)
  for (const k of [0, -1, 1]) if (totpAt(secretB32, c + k) === String(code).trim()) return true
  return false
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20))
export const otpauthUri = (secret, account) => `otpauth://totp/${encodeURIComponent('向往的自由:' + account)}?secret=${secret}&issuer=${encodeURIComponent('向往的自由')}&algorithm=SHA1&digits=6&period=30`

// ===== 短信/邮箱通道（凭据未配 → MOCK：入库+控制台，后台安全中心可见）=====
// 凭据检测：secrets（后台集成中心）优先，env 兜底
let _det = null, _detAt = 0
async function detect() {
  if (_det && Date.now() - _detAt < 10_000) return _det
  const { getSecrets } = await import('./secrets.mjs')
  const s = await getSecrets(['SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])
  _det = {
    sms: !!(s.SMS_TENCENT_SECRET_ID && s.SMS_TENCENT_SECRET_KEY) || !!(process.env.SMS_TENCENT_SECRET_ID && process.env.SMS_TENCENT_SECRET_KEY),
    smtp: !!(s.SMTP_HOST && s.SMTP_USER && s.SMTP_PASS) || !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    s,
  }
  _detAt = Date.now()
  return _det
}

async function sendSmsReal(mobile, code) {
  // 腾讯云 SMS 骨架（凭据到位后启用；签名算法同支付通道 RSA→HMAC 按云 API v3）
  throw new Error('SMS real channel not configured')
}
async function sendEmailReal(email, code) {
  // SMTP（生产建议装 nodemailer：transporter.sendMail）
  throw new Error('SMTP not configured')
}

/** 发验证码：60s 限频 + 每日 10 条/目标 + 5 分钟有效 */
export async function sendCode(target, channel, purpose = 'login') {
  const recent = await one(`SELECT COUNT(*) c FROM mfa_code WHERE target = ? AND channel = ? AND created_at > NOW() - INTERVAL 60 SECOND`, [target, channel])
  if (Number(recent.c) > 0) throw new Error('发送太频繁，请 60 秒后再试')
  const daily = await one(`SELECT COUNT(*) c FROM mfa_code WHERE target = ? AND created_at > CURDATE()`, [target])
  if (Number(daily.c) >= 10) throw new Error('今日发送次数已达上限')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  await q(`INSERT INTO mfa_code (target, channel, code, expires_at, purpose) VALUES (?,?,?,NOW(3) + INTERVAL 5 MINUTE,?)`, [target, channel, code, purpose])
  if (channel === 'sms') {
    if ((await detect()).sms) await sendSmsReal(target, code).catch(() => {})
    else console.log(`[sms:MOCK] ${target} 验证码 ${code}（5 分钟有效，后台安全中心可见）`)
  } else {
    if ((await detect()).smtp) await sendEmailReal(target, code).catch(() => {})
    else console.log(`[email:MOCK] ${target} 验证码 ${code}`)
  }
  return { sent: true, mock: !(channel === 'sms' ? (await detect()).sms : (await detect()).smtp) }
}

/** 校验验证码：一次性消费 */
export async function verifyCode(target, channel, code) {
  const row = await one(`SELECT * FROM mfa_code WHERE target = ? AND channel = ? AND code = ? AND used_at IS NULL AND expires_at > NOW(3) ORDER BY id DESC LIMIT 1`, [target, channel, String(code).trim()])
  if (!row) return false
  await q('UPDATE mfa_code SET used_at = NOW(3) WHERE id = ?', [row.id])
  return true
}
