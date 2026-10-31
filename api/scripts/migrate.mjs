// 迁移执行器：node scripts/migrate.mjs [文件或目录]
// 用法：
//   node scripts/migrate.mjs                 # 执行 db/migration 下所有 V*.sql（已执行的跳过）
//   node scripts/migrate.mjs V18__xxx.sql    # 只执行指定文件
// 已执行记录写入 schema_migration 表；本脚本只做"正向执行"，不提供回滚。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG_DIR = path.join(__dirname, '..', 'db', 'migration')

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'wanderlust',
  multipleStatements: true,
  charset: 'utf8mb4_0900_ai_ci',
})

await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration (
  version    VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='迁移执行记录'`)

const arg = process.argv[2]
const files = arg
  ? [arg]
  : fs.readdirSync(MIG_DIR).filter((f) => /^V\d+.*\.sql$/.test(f))
      .sort((a, b) => Number(a.match(/^V(\d+)/)[1]) - Number(b.match(/^V(\d+)/)[1]))

const [done] = await conn.query('SELECT version FROM schema_migration')
const applied = new Set(done.map((r) => r.version))

let n = 0
for (const f of files) {
  if (applied.has(f)) { console.log('skip  ', f); continue }
  const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8')
  try {
    await conn.query(sql)
    await conn.query('INSERT IGNORE INTO schema_migration (version) VALUES (?)', [f])
    console.log('apply ', f)
    n++
  } catch (e) {
    console.error('FAIL  ', f, '\n  ', e.code || '', e.message)
    process.exitCode = 1
    break
  }
}
console.log(n ? `完成 ${n} 个迁移` : '无新迁移')
await conn.end()
