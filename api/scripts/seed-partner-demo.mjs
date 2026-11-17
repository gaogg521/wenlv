// R-03：主体方演示账号种子（幂等，随时可重跑）——绑定到「当前库里」的安麓大夫第商户与朱家角古镇景区。
// 放在 scenario-populate 之后执行（scenario 会重建演示数据，boot 期绑定的主体 id 可能已变）。
// 守卫：隔离库与开发库均可跑；生产环境直接拒绝（演示账号口令进了 DEFAULT_PASSWORDS 黑名单）。
import { assertIsolatedDb } from '../test/_guard.mjs'
assertIsolatedDb('scripts/seed-partner-demo.mjs')
if (process.env.NODE_ENV === 'production') { console.error('[拒绝] 生产环境不种演示主体账号'); process.exit(2) }
import { q, one, closeDb } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'

let m = await one("SELECT id, name FROM merchant WHERE name LIKE '安麓大夫第%' AND status = 1 ORDER BY id LIMIT 1")
if (!m) {
  // 场景库没有演示商户时补种一家（与 seed-content 同名同口径）
  const mno = 'M' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + 'DP01'
  m = { id: (await q(`INSERT INTO merchant (city_code, name, merchant_no, status, score) VALUES ('310118', '安麓大夫第 · 朱家角', ?, 1, 4.9)`, [mno])).insertId, name: '安麓大夫第 · 朱家角' }
  console.log('[补种] 演示商户 #' + m.id)
}
let sc = await one("SELECT id, name FROM scenic_spot WHERE name LIKE '朱家角古镇%' ORDER BY id LIMIT 1")
if (!sc) {
  sc = { id: (await q(`INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, status) VALUES ('310118', '朱家角古镇', '4A', '票务分成', 1)`)).insertId, name: '朱家角古镇' }
  console.log('[补种] 演示景区 #' + sc.id)
}

const merPw = process.env.MERCHANT_PARTNER_PASSWORD || 'mer123'
await q(`INSERT INTO admin_user (username, password_hash, role, display_name, subject_type, subject_id, status)
  VALUES ('mer310118', ?, 'merchant_partner', '商户主体·安麓大夫第（演示）', 'merchant', ?, 1)
  ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), subject_type = VALUES(subject_type), subject_id = VALUES(subject_id), status = 1`,
  [hashPassword(merPw), m.id])
console.log('mer310118 → 商户 #' + m.id + '（' + m.name + '）')

const scePw = process.env.SCENIC_PARTNER_PASSWORD || 'sce123'
await q(`INSERT INTO admin_user (username, password_hash, role, display_name, subject_type, subject_id, status)
  VALUES ('sce310118', ?, 'scenic_partner', '景区主体·朱家角古镇（演示）', 'scenic', ?, 1)
  ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), subject_type = VALUES(subject_type), subject_id = VALUES(subject_id), status = 1`,
  [hashPassword(scePw), sc.id])
console.log('sce310118 → 景区 #' + sc.id + '（' + sc.name + '）')

await closeDb()
