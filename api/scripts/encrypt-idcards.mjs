// A-06（全量检查 20261106）：kyc_application.id_no_enc 存量明文 → AES-256-GCM 加密
// 用法：node --env-file=.env scripts/encrypt-idcards.mjs（会先 dry-run 预览；--apply 才写入）
// 也可作为模块引入：encryptLegacyIdCards({ apply: true }) —— 测试里用。
// 规则与 scripts/encrypt-mobiles.mjs 相同：只识别明文行（infra/idcard.mjs isLegacyPlainId），已加密行不动；幂等。
import { q, one, closeDb } from '../src/db.mjs'
import { isLegacyPlainId, sealIdNo, maskIdNo, openIdNo } from '../src/infra/idcard.mjs'

export async function encryptLegacyIdCards({ apply = true } = {}) {
  const rows = await q('SELECT id, id_no_enc, id_no_mask FROM kyc_application ORDER BY id')
  let n = 0
  for (const r of rows) {
    const buf = Buffer.isBuffer(r.id_no_enc) ? r.id_no_enc : Buffer.from(r.id_no_enc || '')
    if (!isLegacyPlainId(buf)) continue
    const plain = openIdNo(buf) // 历史明文直接读出
    if (!plain) { console.warn('[idcard] 第', r.id, '行无法识别，跳过'); continue }
    if (!apply) { console.log('[idcard:dry] id', r.id, maskIdNo(plain), '→ 将加密'); n++; continue }
    await q('UPDATE kyc_application SET id_no_enc = ? WHERE id = ?', [sealIdNo(plain), r.id])
    n++
  }
  return n
}

const isDirect = process.argv[1] && process.argv[1].split('/').pop().split(String.fromCharCode(92)).pop() === 'encrypt-idcards.mjs'
if (isDirect) {
  const apply = process.argv.includes('--apply')
  const n = await encryptLegacyIdCards({ apply })
  console.log(apply ? `已加密 ${n} 条存量实名记录` : `dry-run：${n} 条待加密（加 --apply 执行）`)
  await closeDb()
}
