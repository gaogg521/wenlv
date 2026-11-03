// 用户手机号加密存储
//   user_account.mobile_enc  = AES-256-GCM（iv|tag|密文，与凭据保险箱同格式）
//   user_account.mobile_hmac = HMAC-SHA256 盲索引（64 位十六进制），只用于"按完整手机号精确查找"，不可逆
// 两把子密钥都从主密钥（SECRETS_KEY，或由 JWT_SECRET 派生）派生，换主密钥后需用 scripts/secrets-key.mjs rotate 一并重写。
// 兼容历史：迁移前存的是 11 位数字明文且 mobile_hmac 为空，读取与查找仍然认得，直到 scripts/encrypt-mobiles.mjs 跑完。
import crypto from 'node:crypto'
import { resolveMasterKey, encWith, decWith } from './secrets.mjs'

const sub = (master, label) => crypto.createHmac('sha256', master).update(label).digest()
export const mobileKeys = (master) => ({ enc: sub(master, 'mobile:enc'), mac: sub(master, 'mobile:hmac') })
const K = mobileKeys(resolveMasterKey().key)

export const isMobile = (s) => /^1\d{10}$/.test(String(s || ''))
/** 历史明文：整列就是 11 位数字的 ASCII */
export const isLegacyPlain = (buf) => Buffer.isBuffer(buf) && buf.length === 11 && /^\d{11}$/.test(buf.toString('utf8'))

export const hmacMobileWith = (keys, phone) => crypto.createHmac('sha256', keys.mac).update(String(phone)).digest('hex')
export const sealMobileWith = (keys, phone) => ({ enc: encWith(keys.enc, String(phone)), hmac: hmacMobileWith(keys, phone) })
export const sealMobile = (phone) => sealMobileWith(K, phone)

/** 读出手机号明文；历史明文直接返回，解不开返回 null（不抛错，列表页不能因为一条坏数据整体失败） */
export function openMobileWith(keys, buf) {
  if (buf == null) return null
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (isLegacyPlain(b)) return b.toString('utf8')
  try { return decWith(keys.enc, b) } catch { return null }
}
export const openMobile = (buf) => openMobileWith(K, buf)

/** 脱敏：138****1234；有值但读不出来时显示"已绑定" */
export function maskMobile(buf) {
  if (buf == null || buf.length === 0) return ''
  const s = openMobile(buf)
  return s && /^\d{11}$/.test(s) ? s.slice(0, 3) + '****' + s.slice(7) : '已绑定'
}
export const maskPhone = (s) => String(s).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')

/** 商户申请电话的脱敏值：apply_mobile_enc 密文优先，历史明文 apply_mobile 兜底（V38） */
export const maskApplyMobile = (m) => maskMobile(m.apply_mobile_enc || m.apply_mobile)

/** 按完整手机号查找的 SQL 片段（别名 alias 默认 user_account 的别名）：优先走盲索引，未迁移的历史明文行兜底 */
export function whereMobile(phone, alias = 'u') {
  return {
    sql: `(${alias}.mobile_hmac = ? OR (${alias}.mobile_hmac IS NULL AND ${alias}.mobile_enc = ?))`,
    args: [hmacMobileWith(K, phone), Buffer.from(String(phone), 'utf8')],
  }
}

/** 绑定手机号：加密落库。同一手机号只能绑一个账号（mobile_hmac 唯一索引），重复时给业务错误而不是 500 */
export async function bindMobile(conn, userId, phone, BizError) {
  const { enc, hmac } = sealMobile(phone)
  try { await conn.upd('UPDATE user_account SET mobile_enc = ?, mobile_hmac = ? WHERE id = ?', [enc, hmac, userId]) }
  catch (e) { if (e && e.code === 'ER_DUP_ENTRY') throw new BizError(1001, '该手机号已绑定其他账号'); throw e }
}
