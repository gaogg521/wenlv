// 临时脚本：向隔离库补种城市合伙人演示账号（DB 重建后 bootstrap 不重跑的场景用）
import { hashPassword } from '../src/auth.mjs'
import { q, closeDb } from '../src/db.mjs'
await q(`INSERT INTO admin_user (username, password_hash, role, display_name, scope_city) VALUES
  ('city310118', ?, 'city_partner', '青浦城市合伙人·演示', '310118') ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
  [hashPassword(process.env.CITY_PARTNER_PASSWORD || 'city123')])
console.log('city310118 seeded')
await closeDb()
process.exit(0)
