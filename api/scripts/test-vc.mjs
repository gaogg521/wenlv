// 数字身份（VC-JWT）自测：签发 / 验签 / 篡改 / 过期 / 吊销 / 封号 / 第三方离线验签 / 无 PII
// 用法：node scripts/test-vc.mjs
import crypto from 'node:crypto'
import { q, one } from '../src/db.mjs'
import * as vc from '../src/domain/vc.mjs'

let pass = 0
let fail = 0
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  PASS ', m) }
  else { fail++; console.log('  FAIL ', m, extra === undefined ? '' : JSON.stringify(extra)) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const u = await one(`SELECT id, nickname, mobile_enc, status FROM user_account ORDER BY id LIMIT 1`)
if (!u) { console.error('库里没有用户，先跑 npm run e2e'); process.exit(1) }
console.log(`被测用户 #${u.id}`)

console.log('== 1. DID 派生 ==')
const did1 = await vc.userDid(u.id)
const did2 = await vc.userDid(u.id)
ok(/^did:cn:wl:[a-z2-7]{20,}$/.test(did1), 'DID 形如 did:cn:wl:<base32>', did1)
ok(did1 === did2, '同一用户 DID 稳定不变')
ok(!did1.includes(String(u.id)), 'DID 不含明文用户 id（不可反推）')

console.log('== 2. 签发（最小披露）==')
const basic = await vc.issue(u.id, 'basic')
const travel = await vc.issue(u.id, 'travel')
const claimsBasic = JSON.parse(Buffer.from(basic.jwt.split('.')[1], 'base64url').toString('utf8')).vc.credentialSubject
ok(claimsBasic.level && claimsBasic.memberSince && !('trips' in claimsBasic) && !('badges' in claimsBasic),
  'basic 只给等级/成长区间/入会年月', claimsBasic)
ok('trips' in travel.claims && Array.isArray(travel.claims.badges), 'travel 额外给行程数/城市数/徽章', travel.claims)

console.log('== 3. 验签 ==')
const v1 = await vc.verify(travel.jwt)
ok(v1.valid === true, '正常凭证验签通过', v1.reason)
ok(v1.subject === did1 && v1.issuer === travel.issuer, '签发者与持有人对得上')

console.log('== 4. 篡改检测 ==')
const [h, p, s] = travel.jwt.split('.')
const tampered = h + '.' + Buffer.from(JSON.stringify({
  ...JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  vc: { credentialSubject: { level: '环球探索家', levelNo: 4 } },
})).toString('base64url') + '.' + s
ok((await vc.verify(tampered)).valid === false, '改 claims（等级提权）→ 验签失败')
const badSig = h + '.' + p + '.' + s.slice(0, -2) + (s.slice(-2) === 'AA' ? 'BB' : 'AA')
ok((await vc.verify(badSig)).valid === false, '改签名 → 验签失败')
ok((await vc.verify('not.a.jwt')).valid === false, '格式非法 → 拒绝')

console.log('== 5. 过期 ==')
const shortLived = await vc.issue(u.id, 'basic', 2 / 86400) // ≈2 秒
await sleep(2400)
const vExp = await vc.verify(shortLived.jwt)
ok(vExp.valid === false && /过期/.test(vExp.reason), '过期后拒绝', vExp.reason)

console.log('== 6. 吊销 ==')
const rec = await one('SELECT id FROM vc_issue WHERE jti = ?', [travel.jti])
const rv = await vc.revoke(rec.id, '自测吊销', 'test')
ok(rv.revoked === true, '吊销成功')
const vRv = await vc.verify(travel.jwt)
ok(vRv.valid === false && /吊销/.test(vRv.reason), '吊销后立即失效（验签回查库）', vRv.reason)
const rv2 = await vc.revoke(rec.id, 'x', 'test')
ok(rv2.revoked === false, '重复吊销幂等')

console.log('== 7. 封号传导 ==')
const live = await vc.issue(u.id, 'basic')
await q('UPDATE user_account SET status = 0 WHERE id = ?', [u.id])
const vBan = await vc.verify(live.jwt)
await q('UPDATE user_account SET status = 1 WHERE id = ?', [u.id])
ok(vBan.valid === false && /停用/.test(vBan.reason), '账号停用 → 凭证失效（封号能传导）', vBan.reason)
ok((await vc.verify(live.jwt)).valid === true, '恢复账号后凭证重新有效')

console.log('== 8. 第三方离线验签（只用公钥）==')
const jwks = await vc.issuerJwks()
const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwks.keys[0].x }, format: 'jwk' })
const [hh, pp, ss] = live.jwt.split('.')
const offlineOk = crypto.verify(null, Buffer.from(hh + '.' + pp), key, Buffer.from(ss, 'base64url'))
ok(offlineOk === true, '不调用我方任何接口，仅凭 JWKS 即可验签通过')
ok(jwks.keys[0].kty === 'OKP' && jwks.keys[0].crv === 'Ed25519', 'JWKS 是标准 OKP/Ed25519 结构')

console.log('== 9. 无 PII 泄漏 ==')
const body = Buffer.from(pp, 'base64url').toString('utf8')
const nick = u.nickname || ''
ok(!/1[3-9]\d{9}/.test(body), '不含手机号')
ok(!nick || !body.includes(nick), '不含昵称')
ok(!/WL\d{10,}|RF\d{8,}/.test(body), '不含订单号/退款单号')
ok(!/\d+\.\d{2}/.test(body), '不含金额')

console.log('== 10. 后台统计 ==')
const st = await vc.stats()
ok(st.total > 0 && st.holders > 0 && !!st.keyFingerprint, `已签发 ${st.total} 张 / 持有人 ${st.holders} / 有效 ${st.active}`, st.policy)

console.log(`\nVC IDENTITY: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
