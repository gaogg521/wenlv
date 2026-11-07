import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const run = spawnSync(process.execPath, ['src/index.mjs'], { cwd: new URL('../', import.meta.url), timeout: 5000, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'dev', PASS_SECRET: 'dev', SECRETS_KEY: 'a'.repeat(64), DB_HOST: '127.0.0.1', DB_PORT: '9' } })
assert.equal(run.status, 1)
assert.match(run.stderr, /公开默认 JWT_SECRET/, '密钥守卫必须在bootstrap写库/连接数据库之前拒绝启动')
console.log('生产弱密钥在连接/写入数据库之前被拒绝：通过')
