// 实名身份证号加密存储（A-06，全量检查 20261106）
//   kyc_application.id_no_enc = AES-256-GCM（iv|tag|密文，与 mobile.mjs / 凭据保险箱同格式）
// 旧实现把 `身份证号|姓名` 的 UTF-8 明文直接塞进 id_no_enc（注释还写着"生产换 KMS"），
// scripts/encrypt-idcards.mjs 负责存量改密；本模块同时提供号码本身的有效性校验：
// 18 位校验码（GB 11643-1999 加权算法）+ 出生日期段合法性（拒绝 13 月、未来日期、全 X）。
// 日志与接口只允许出现 id_no_mask（前 3 + *** + 后 4），完整号码只在后台审核抽屉解密使用。
import crypto from 'node:crypto'
import { resolveMasterKey, encWith, decWith } from './secrets.mjs'

const sub = (master, label) => crypto.createHmac('sha256', master).update(label).digest()
export const idcardKeys = (master) => ({ enc: sub(master, 'idcard:enc') })
const K = idcardKeys(resolveMasterKey().key)

/** 历史明文：`号码|姓名` 或纯号码的 UTF-8 字节（encrypt-idcards.mjs 据此识别存量） */
export function isLegacyPlainId(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return false
  const s = buf.toString('utf8')
  if (/[^\x20-\x7e\u4e00-\u9fa5|]/.test(s)) return false
  return /^[0-9X]{15}([0-9X]{3})?(\|.*)?$/.test(s)
}

export const sealIdNoWith = (keys, idNo) => encWith(keys.enc, String(idNo))
export const sealIdNo = (idNo) => sealIdNoWith(K, idNo)

/** 读出身份证号明文；历史明文直接返回，解不开返回 null（列表页不能因一条坏数据整体失败） */
export function openIdNo(buf) {
  if (buf == null) return null
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (isLegacyPlainId(b)) {
    const s = b.toString('utf8')
    return s.includes('|') ? s.split('|')[0] : s
  }
  try { return decWith(K.enc, b) } catch { return null }
}

export const maskIdNo = (idNo) => String(idNo || '').length === 18
  ? String(idNo).slice(0, 3) + '***********' + String(idNo).slice(-4)
  : String(idNo || '').slice(0, 3) + '******' + String(idNo || '').slice(-4)

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

/** 18 位身份证号校验：格式 + 出生日期 + 校验码。返回 { ok, reason }。 */
export function validateIdNo(idNo) {
  const id = String(idNo || '').trim().toUpperCase()
  if (!/^\d{17}[0-9X]$/.test(id)) return { ok: false, reason: '身份证号需为 18 位（数字 + 校验位）' }
  const y = Number(id.slice(6, 10)), m = Number(id.slice(10, 12)), d = Number(id.slice(12, 14))
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, reason: '出生日期段不合法' }
  const daysInMonth = new Date(y, m, 0).getDate()
  if (d > daysInMonth) return { ok: false, reason: '出生日期不合法（该月无此日）' }
  const birth = new Date(y, m - 1, d)
  const today = new Date()
  if (birth > today) return { ok: false, reason: '出生日期不能晚于今天' }
  const sum = id.slice(0, 17).split('').reduce((s, ch, i) => s + Number(ch) * WEIGHTS[i], 0)
  if (CHECK[sum % 11] !== id[17]) return { ok: false, reason: '身份证校验码不正确' }
  return { ok: true }
}
