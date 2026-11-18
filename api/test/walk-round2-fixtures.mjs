// 二轮走查夹具（项1/项2/项6/项7）：纯游客 / 推广员(无数据) / 合作经办(主体无分润) 三种资格账号。
// 只允许指向隔离库服务（API_BASE 必须显式指定且非 8080；DB_NAME 不得为 wanderlust）。
// 幂等：重复执行只补缺失行。用法：node --env-file=<隔离env> test/walk-round2-fixtures.mjs
import mysql from 'mysql2/promise'
const BASE = process.env.API_BASE || ''
const DB = process.env.DB_NAME || ''
if (!BASE || BASE.includes(':8080')) { console.error('[拒绝] 需显式 API_BASE（隔离服务，不得指向 8080）'); process.exit(2) }
if (!DB || DB === 'wanderlust' || !DB.startsWith('wanderlust_qa_')) { console.error('[拒绝] 需显式 DB_NAME=wanderlust_qa_*'); process.exit(2) }

const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json()
  if (r.ok && j.code === 0) return j.data
  throw new Error(path + ': ' + JSON.stringify(j.msg || j))
}
const login = async (code) => (await call('POST', '/c/auth/login', { code })).token

const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASS || 'root', database: DB })
const q = (t, v) => c.query(t, v)
const uidOf = async (openid) => (await q('SELECT id FROM user_account WHERE mini_a_openid=?', [openid]))[0][0].id

// 1) 纯游客（登录即可，不挂任何资格）
const pureTok = await login('mock-pure1')
await call('POST', '/c/consent', { scene: 'privacy', granted: true }, pureTok).catch(() => {})
const pureUid = await uidOf('mock-openid-mock-pure1')

// 2) 推广员（tier1，无佣金/无授权产品）
const promoTok = await login('mock-promo1')
const promoUid = await uidOf('mock-openid-mock-promo1')
const reg = await q('SELECT user_id FROM promoter WHERE user_id=?', [promoUid])
if (!reg[0].length) {
  const admin = (await call('POST', '/admin/login', { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' })).token
  await call('POST', '/admin/promoters/register', { userId: promoUid, tier: 1 }, admin)
}

// 3) 合作经办（主体「青浦合作示范 · 演示」+ 门店资源，无分润）
await login('mock-coop1')
const coopUid = await uidOf('mock-openid-mock-coop1')
let sub = (await q("SELECT id FROM business_subject WHERE name='青浦合作示范 · 演示'"))[0][0]
if (!sub) sub = { insertId: (await q("INSERT INTO business_subject (name,status) VALUES ('青浦合作示范 · 演示',1)"))[0].insertId }
const subId = sub.id || sub.insertId
const merch = (await q('SELECT id FROM merchant ORDER BY id LIMIT 1'))[0][0].id
await q('INSERT IGNORE INTO subject_grant (user_id, subject_id, status, valid_from) VALUES (?, ?, 1, \'2026-01-01\')', [coopUid, subId])
await q('INSERT IGNORE INTO subject_resource (subject_id, kind, resource_id) VALUES (?, \'merchant\', ?)', [subId, merch])

for (const [k, code] of [['纯游客', 'mock-pure1'], ['推广员', 'mock-promo1'], ['合作经办', 'mock-coop1']]) {
  const t = await login(code)
  const ov = await call('GET', '/c/promote/overview', null, t).catch((e) => ({ promoter: 'err:' + e.message }))
  const wc = await call('GET', '/c/work-contexts', null, t).catch((e) => ({ subjects: 'err:' + e.message }))
  console.log(`${k}: uid=${k === '纯游客' ? pureUid : k === '推广员' ? promoUid : coopUid} overview.promoter=${ov.promoter} work.subjects=${wc.subjects?.length}`)
}
await c.end()
