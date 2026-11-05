// 默认密码护栏：生产环境不种弱口令、不接受默认口令登录；开发 / 演示不受影响。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isForbiddenPassword, initialAdminPassword, isProduction } from '../src/auth.mjs'

let pass = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const PROD = { NODE_ENV: 'production' }, DEV = {}

console.log('== 默认密码护栏 ==')
t('生产环境拒绝默认口令，其他口令放行；开发 / 演示环境都放行', () => {
  for (const pw of ['admin123', 'city123']) { assert.equal(isForbiddenPassword(pw, PROD), true); assert.equal(isForbiddenPassword(pw, DEV), false) }
  assert.equal(isForbiddenPassword('S0me-Strong-Pwd', PROD), false)
  assert.equal(isForbiddenPassword('', PROD), false); assert.equal(isForbiddenPassword(undefined, PROD), false)
})
t('首次种账号：生产环境没配或配成默认口令就随机生成，每次不同；配了别的就用配的', () => {
  for (const env of [PROD, { ...PROD, ADMIN_INIT_PASSWORD: 'admin123' }]) {
    const a = initialAdminPassword(env), b = initialAdminPassword(env)
    assert.equal(a.generated, true); assert.notEqual(a.pw, 'admin123'); assert.notEqual(a.pw, b.pw); assert.ok(a.pw.length >= 16)
  }
  assert.deepEqual(initialAdminPassword({ ...PROD, ADMIN_INIT_PASSWORD: 'S0me-Strong-Pwd' }), { pw: 'S0me-Strong-Pwd', generated: false })
})
t('开发 / 演示：默认口令照旧，测试和本地不受影响', () => {
  assert.deepEqual(initialAdminPassword(DEV), { pw: 'admin123', generated: false })
  assert.deepEqual(initialAdminPassword({ ADMIN_INIT_PASSWORD: 'x' }), { pw: 'x', generated: false })
  assert.equal(isProduction(DEV), false); assert.equal(isProduction(PROD), true)
})
t('接线：登录路由查护栏；生产环境不种演示城市账号', () => {
  const route = fs.readFileSync(new URL('../src/routes/admin.mjs', import.meta.url), 'utf8')
  assert.match(route, /if \(isForbiddenPassword\(password\)\) throw new BizError/)
  const idx = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
  assert.match(idx, /if \(!isProduction\(\) \|\| process\.env\.CITY_PARTNER_PASSWORD\)/)
  assert.ok(!/ADMIN_INIT_PASSWORD \|\| 'admin123'/.test(idx), '种子不能再直接回退到默认口令')
})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
