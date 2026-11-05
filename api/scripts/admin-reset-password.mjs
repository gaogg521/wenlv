// 重置后台账号密码（生产环境默认口令被拒登后的出路）：生成随机临时密码，只打印一次，所有会话失效，首次登录必须改。
// 用法：node --env-file=.env scripts/admin-reset-password.mjs <账号>
import crypto from 'node:crypto'
import { one, q, closeDb } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'

const username = process.argv[2]
if (!username) { console.error('用法：node --env-file=.env scripts/admin-reset-password.mjs <账号>'); process.exit(1) }
const u = await one('SELECT id FROM admin_user WHERE username = ?', [username])
if (!u) { console.error('账号不存在：' + username); await closeDb(); process.exit(1) }
const temp = crypto.randomBytes(12).toString('base64url')
await q('UPDATE admin_user SET password_hash = ?, must_change_pwd = 1, token_epoch = token_epoch + 1 WHERE id = ?', [hashPassword(temp), u.id])
console.log(username + ' 的临时密码（只显示这一次，登录后必须修改）：' + temp)
await closeDb()
process.exit(0)
