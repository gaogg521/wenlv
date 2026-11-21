// 主体资源审批 · 全量回归隔离库预置(退回项6:一条命令可复现完整 test:db 环境)
// 用法:node scripts/qa-prep-subject-approval.mjs <源库> <目标库>
//   例:node scripts/qa-prep-subject-approval.mjs wanderlust_qa_fix1106m wanderlust_qa_check_glm
// 做完之后:
//   服务与回归统一环境:JWT_SECRET=dev PASS_SECRET=dev ADMIN_INIT_PASSWORD=admin123 CHAIN_ENDPOINT=1
//   DB_NAME=<目标库> PORT=18242 API_BASE=http://127.0.0.1:18242,并 unset WX_APPID/WX_SECRET
//   (member-badge 用非 mock code,配置真实微信凭据时会走真实 code2Session 必失败)
// 守卫:目标库必须 wanderlust_qa_*(test/_guard.mjs 同款口径)。
import { execSync } from 'node:child_process'

const [, , from, to] = process.argv
if (!from || !to || !to.startsWith('wanderlust_qa_') || to === from) {
  console.error('用法:node scripts/qa-prep-subject-approval.mjs <源库> <目标库(wanderlust_qa_*,且≠源库)>')
  process.exit(2)
}

console.log('[1/6] dump 源库 → 重建目标库')
execSync(`mysql -uroot -proot -e "DROP DATABASE IF EXISTS ${to}; CREATE DATABASE ${to} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"`, { stdio: 'inherit' })
execSync(`mysqldump -uroot -proot --single-transaction ${from} | mysql -uroot -proot ${to}`, { stdio: 'inherit' })

console.log('[2/6] 迁移 V94-V97')
execSync(`node scripts/migrate.mjs`, { stdio: 'inherit', env: { ...process.env, DB_NAME: to } })

console.log('[3/6] 隔离夹具(链历史保留/当日借贷对/团期让位)')
execSync(`node scripts/isolated-db-fixture.mjs`, { stdio: 'inherit', env: { ...process.env, DB_NAME: to } })

// 以下对齐统一在 dev 派生主密钥口径下执行(与服务/回归一致)
process.env.DB_NAME = to
process.env.JWT_SECRET = 'dev'
process.env.PASS_SECRET = 'dev'
delete process.env.SECRETS_KEY

console.log('[4/6] 口令统一 + 清链/微信/SMTP 凭据 + 现封 VC 发行密钥')
await (async () => {
  const { q, closeDb } = await import('../src/db.mjs')
  const { hashPassword } = await import('../src/auth.mjs')
  const secrets = await import('../src/infra/secrets.mjs')
  const crypto = await import('node:crypto')
  await q('UPDATE admin_user SET password_hash = ?, must_change_pwd = 0 WHERE role IN ("super","ops","finance","review","risk","readonly","sre","dev")', [hashPassword('admin123')])
  await q('UPDATE admin_user SET password_hash = ? WHERE username = ?', [hashPassword('city123'), 'city310118'])
  await q('UPDATE admin_user SET password_hash = ? WHERE username = ?', [hashPassword('mer123'), 'mer310118'])
  await q('UPDATE admin_user SET password_hash = ? WHERE username = ?', [hashPassword('sce123'), 'sce310118'])
  await q('DELETE FROM app_secret WHERE k LIKE "ANTOPEN_%" OR k = "CHAIN_PROVIDER" OR k LIKE "WX_%" OR k LIKE "SMTP_%"')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const issuer = JSON.stringify({ kid: 'qa-' + to + '-1', did: 'did:cn:wl:issuer-main',
    priv: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    pubJwk: publicKey.export({ type: 'spki', format: 'jwk' }), createdAt: new Date().toISOString() })
  await secrets.setSecret('VC_ISSUER_KEY', issuer, 'qa-prep dev issuer')
  await secrets.setSecret('VC_DID_PEPPER', crypto.randomBytes(32).toString('hex'), 'qa-prep dev pepper')
  console.log('  口令/凭据/VC 密钥已对齐 dev 口径')
})()

console.log('[5/6] 团期让位 + 遗留不可解密密文清理 + 账本叶数对齐')
await (async () => {
  const { q, closeDb } = await import('../src/db.mjs')
  const { openMobile } = await import('../src/infra/mobile.mjs')
  await q('UPDATE tour_session SET depart_date = DATE_ADD(CURDATE(), INTERVAL 90 + id DAY) WHERE product_id = 1 AND id <> 1 AND depart_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)')
  for (const [t, col] of [['merchant', 'apply_mobile_enc'], ['orders', 'contact_phone_sealed'], ['user_account', 'mobile_enc']]) {
    const rows = await q(`SELECT id, ${col} v FROM ${t} WHERE ${col} IS NOT NULL`)
    let n = 0
    for (const r of rows) { let ok = false; try { ok = openMobile(r.v) != null } catch { ok = false }; if (!ok) { await q(`UPDATE ${t} SET ${col} = NULL${t === 'user_account' ? ', mobile_hmac = NULL' : ''} WHERE id = ?`, [r.id]); n++ } }
    console.log(`  ${t} 遗留密文清理 ${n}/${rows.length}`)
  }
  const r = await q('UPDATE bean_day_root SET leaf_count = (SELECT COUNT(*) FROM bean_ledger l WHERE DATE(l.created_at) = bean_day_root.biz_date)')
  console.log('  账本叶数对齐(演示库漂移 accommodation):', r.affectedRows, '个日根')
  // fix1106m 克隆可能缺「朱家角古镇」景区与 sce310118 演示账号(deep-polish-db 需要)
  let scenic = await q("SELECT id FROM scenic_spot WHERE name LIKE '朱家角古镇%' ORDER BY id LIMIT 1")
  if (!scenic.length) {
    const ins = await q("INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, status) VALUES ('310118', '朱家角古镇', '4A', '票务分成', 1)")
    scenic = [{ id: ins.insertId }]
  }
  const sce = await q("SELECT id FROM admin_user WHERE username = 'sce310118'")
  if (!sce.length) {
    const { hashPassword } = await import('../src/auth.mjs')
    await q('INSERT INTO admin_user (username, password_hash, role, display_name, subject_type, subject_id, status, token_epoch) VALUES ("sce310118", ?, "scenic_partner", "景区主体·朱家角古镇(演示)", "scenic", ?, 1, 1)', [hashPassword('sce123'), scenic[0].id])
    console.log('  sce310118 已补建(绑朱家角古镇)')
  }
  await closeDb()
})()

console.log('[6/6] 完成。起服务与跑回归:')
console.log(`  export DB_NAME=${to} PORT=18242 API_BASE=http://127.0.0.1:18242 JWT_SECRET=dev PASS_SECRET=dev ADMIN_INIT_PASSWORD=admin123 CHAIN_ENDPOINT=1`)
console.log('  unset WX_APPID WX_SECRET WX_B_APPID WX_B_SECRET')
console.log('  (node src/index.mjs &) && npm run test:db')
