// P-15：凭据不可解密 / 结构无效时，数字身份相关读写必须失败关闭，不能自动生成并覆盖发行方密钥与 DID 盐。
// 方法：用不同的 JWT_SECRET（主密钥由它派生）开子进程访问同一个库——错误密钥 / 损坏密文 / 坏结构都应报错，
// 且 app_secret 里的原密文字节、kid、公钥、既有凭证验签全部保持不变；恢复正确配置后旧凭证照常可验。
// 只能对隔离库运行（DB_NAME 必须显式设置且不是演示库）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/vc-key-protect.mjs')
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { q, one, closeDb } from '../src/db.mjs'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
// 在子进程里用指定 JWT_SECRET 跑一段脚本，返回 { code, out }；SECRETS_KEY 一律清空，让主密钥由 JWT_SECRET 派生
const run = (jwt, body) => new Promise((resolve) => {
  const script = `import * as vc from './src/domain/vc.mjs'; import { closeDb } from './src/db.mjs'
    const out = {}; try { ${body} } catch (e) { out.err = String(e.message || e) } console.log('@@' + JSON.stringify(out)); await closeDb().catch(() => {}); process.exit(0)`
  execFile(process.execPath, ['--input-type=module', '-e', script], { cwd: API, env: { ...process.env, JWT_SECRET: jwt, SECRETS_KEY: '' }, timeout: 60000 }, (err, stdout, stderr) => {
    const m = String(stdout).match(/@@(.*)/)
    resolve({ code: err ? err.code : 0, out: m ? JSON.parse(m[1]) : null, stderr: String(stderr).slice(0, 300) })
  })
})
const raw = async (k) => { const r = await one('SELECT enc_value FROM app_secret WHERE k = ?', [k]); return r ? Buffer.from(r.enc_value).toString('hex') : null }

console.log('== 数字身份发行方密钥保护（P-15）==')
const user = await one('SELECT id FROM user_account ORDER BY id LIMIT 1')
assert.ok(user, '隔离库里没有用户')
const GOOD = 'p15-good-secret', BAD = 'p15-wrong-secret'
// 起点：干净状态——删掉这两项，用 GOOD 首次生成并签发一张凭证
await q("DELETE FROM app_secret WHERE k IN ('VC_ISSUER_KEY', 'VC_DID_PEPPER')")
await q('UPDATE user_account SET did_ref = NULL WHERE id = ?', [user.id])   // 已有 DID 的用户不会触发盐的生成；清掉它，让首次签发同时生成盐
let jwt, jwks
await t('库里确实没有 → 首次允许生成并签发（正常初始化不受影响）', async () => {
  const r = await run(GOOD, `const v = await vc.issue(${user.id}, 'basic'); out.jwt = v.jwt; out.jwks = await vc.issuerJwks()`)
  assert.ok(r.out && !r.out.err, JSON.stringify(r)); jwt = r.out.jwt; jwks = r.out.jwks
  assert.ok(await raw('VC_ISSUER_KEY') && await raw('VC_DID_PEPPER'))
})
const keyBefore = await raw('VC_ISSUER_KEY'), pepperBefore = await raw('VC_DID_PEPPER')
await t('错误主密钥（JWT_SECRET 不同）：后台统计 / 公开读公钥 / 签发 / 验签 全部失败，原密文字节不变', async () => {
  for (const [name, body] of [['stats', 'out.s = await vc.stats()'], ['jwks', 'out.j = await vc.issuerJwks()'], ['issue', `out.i = await vc.issue(${user.id}, 'basic')`], ['verify', `out.v = await vc.verify(${JSON.stringify(jwt)})`]]) {
    const r = await run(BAD, body)
    assert.ok(r.out && r.out.err, name + ' 应报错：' + JSON.stringify(r))
    assert.match(r.out.err, /无法用当前主密钥解密|已拒绝/, name + ' 错误信息应说明原因')
    assert.ok(!/BEGIN|priv|[A-Za-z0-9+/]{60,}/.test(r.out.err), name + ' 错误信息不能泄露密钥内容')
  }
  assert.equal(await raw('VC_ISSUER_KEY'), keyBefore, '发行方密钥密文被改动了')
  assert.equal(await raw('VC_DID_PEPPER'), pepperBefore, 'DID 盐密文被改动了')
})
await t('损坏密文（GCM 校验失败）同样失败关闭，不覆盖', async () => {
  const bytes = Buffer.from(keyBefore, 'hex'); bytes[bytes.length - 1] ^= 0xff
  await q('UPDATE app_secret SET enc_value = ? WHERE k = ?', [bytes, 'VC_ISSUER_KEY'])
  const r = await run(GOOD, 'out.j = await vc.issuerJwks()')
  assert.ok(r.out && r.out.err && /无法用当前主密钥解密/.test(r.out.err), JSON.stringify(r))
  assert.equal(await raw('VC_ISSUER_KEY'), bytes.toString('hex'), '损坏的密文不该被自动覆盖')
  await q('UPDATE app_secret SET enc_value = ? WHERE k = ?', [Buffer.from(keyBefore, 'hex'), 'VC_ISSUER_KEY'])   // 还原
})
await t('能解密但结构无效：失败关闭，不覆盖', async () => {
  const r = await run(GOOD, `const s = await import('./src/infra/secrets.mjs'); await s.setSecret('VC_ISSUER_KEY', 'not-json', 'test'); try { await vc.issuerJwks() } catch (e) { out.err = String(e.message) }`)
  assert.ok(r.out && /结构无效|已拒绝/.test(r.out.err || ''), JSON.stringify(r))
  const bad = await raw('VC_ISSUER_KEY'); assert.notEqual(bad, keyBefore)   // 这一步是测试自己写的坏值
  const r2 = await run(GOOD, 'out.j = await vc.issuerJwks()')
  assert.ok(r2.out && r2.out.err, '坏结构不应被后续访问悄悄重建：' + JSON.stringify(r2))
  assert.equal(await raw('VC_ISSUER_KEY'), bad, '坏结构的密文不该被自动覆盖')
  await q('UPDATE app_secret SET enc_value = ? WHERE k = ?', [Buffer.from(keyBefore, 'hex'), 'VC_ISSUER_KEY'])   // 还原
})
await t('恢复正确配置：kid / 公钥不变，旧凭证仍可验', async () => {
  const r = await run(GOOD, `out.j = await vc.issuerJwks(); out.v = await vc.verify(${JSON.stringify(jwt)})`)
  assert.ok(r.out && !r.out.err, JSON.stringify(r))
  assert.equal(r.out.j.kid, jwks.kid); assert.deepEqual(r.out.j.keys, jwks.keys)
  assert.equal(r.out.v.valid, true, JSON.stringify(r.out.v))
  assert.equal(await raw('VC_ISSUER_KEY'), keyBefore); assert.equal(await raw('VC_DID_PEPPER'), pepperBefore)
})
// P-15 验收补的并发场景：真正无密钥时多个进程同时首次初始化，必须原子——先落库者获胜，
// 输者沿用已落库密钥（不是覆盖它），因此并发期间签出的每张凭证都能被最终公钥验签。
await t('setSecretIfAbsent 语义：已存在时不改一字节，返回已落库值', async () => {
  const r = await run(GOOD, `const s = await import('./src/infra/secrets.mjs')
    out.a = await s.setSecretIfAbsent('VC_P15_PROBE', 'first-value', 'test')
    out.b = await s.setSecretIfAbsent('VC_P15_PROBE', 'second-value', 'test')
    await s.delSecret('VC_P15_PROBE')`)
  assert.ok(r.out && !r.out.err, JSON.stringify(r))
  assert.equal(r.out.a, 'first-value'); assert.equal(r.out.b, 'first-value')
})
await t('并发首次初始化：N 进程同时签发，kid 一致、密文唯一、每张凭证都能验', async () => {
  await q("DELETE FROM app_secret WHERE k IN ('VC_ISSUER_KEY', 'VC_DID_PEPPER')")
  await q('DELETE FROM vc_issue')
  const N = 4
  const rs = await Promise.all(Array.from({ length: N }, () =>
    run(GOOD, `out.i = await vc.issue(${user.id}, 'basic'); out.j = await vc.issuerJwks()`)))
  for (const [i, r] of rs.entries()) assert.ok(r.out && !r.out.err, '#' + i + ' 应成功：' + JSON.stringify(r))
  const kids = new Set(rs.map((r) => r.out.j.kid))
  assert.equal(kids.size, 1, '并发初始化后 kid 必须唯一：' + [...kids].join(','))
  const stored = await raw('VC_ISSUER_KEY')
  for (const [i, r] of rs.entries()) {
    const v = await run(GOOD, `out.v = await vc.verify(${JSON.stringify(r.out.i.jwt)})`)
    assert.ok(v.out && v.out.v && v.out.v.valid === true, '#' + i + ' 并发期间签出的凭证必须可验：' + JSON.stringify(v.out))
  }
  assert.ok(stored, '密文应已落库')
})

// 收尾：这个测试用自己的 JWT_SECRET 生成了发行方密钥；留在库里会让后面按默认密钥运行的套件（以及演示服务）解不开它。
// 清掉两项自动生成型密钥与已派生的 DID / 凭证记录，让后续套件按自己的密钥重新初始化（只在隔离库做，开头有守卫）。
await q("DELETE FROM app_secret WHERE k IN ('VC_ISSUER_KEY', 'VC_DID_PEPPER')")
await q('UPDATE user_account SET did_ref = NULL')
await q('DELETE FROM vc_issue')
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
