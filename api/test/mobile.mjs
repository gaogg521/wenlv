// 手机号加密存储：加解密往返、盲索引、历史明文兼容、换主密钥（不碰数据库）
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
const M = await import('../src/infra/mobile.mjs')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ✓', name) }
const phone = '13812345678'

t('加密后往返一致，密文里找不到明文手机号', () => {
  const { enc } = M.sealMobile(phone)
  assert.equal(M.openMobile(enc), phone)
  assert.ok(!enc.toString('latin1').includes(phone) && !enc.toString('hex').includes(Buffer.from(phone).toString('hex')))
})
t('同一手机号每次密文不同（随机 IV），盲索引稳定且不同号码不同', () => {
  const a = M.sealMobile(phone), b = M.sealMobile(phone), c = M.sealMobile('13812345679')
  assert.notDeepEqual(a.enc, b.enc)
  assert.equal(a.hmac, b.hmac); assert.match(a.hmac, /^[0-9a-f]{64}$/); assert.notEqual(a.hmac, c.hmac)
})
t('历史明文仍可读取与脱敏；坏数据读不出来时返回 null 而不是抛错', () => {
  const legacy = Buffer.from(phone, 'utf8')
  assert.ok(M.isLegacyPlain(legacy)); assert.equal(M.openMobile(legacy), phone)
  assert.equal(M.maskMobile(legacy), '138****5678')
  assert.equal(M.openMobile(crypto.randomBytes(40)), null)
  assert.equal(M.maskMobile(crypto.randomBytes(40)), '已绑定')
  assert.equal(M.maskMobile(null), ''); assert.equal(M.maskMobile(''), '')
  assert.equal(M.maskMobile('13812345678'), '138****5678') // 商户申请表的联系电话是明文字符串，同样走这里脱敏
})
t('脱敏：加密数据也显示 138****5678，且结果里没有完整号码', () => {
  const m = M.maskMobile(M.sealMobile(phone).enc)
  assert.equal(m, '138****5678'); assert.ok(!m.includes(phone))
})
t('按手机号查找：盲索引优先，同时兜底未迁移的历史明文行', () => {
  const w = M.whereMobile(phone, 'x')
  assert.match(w.sql, /x\.mobile_hmac = \? OR \(x\.mobile_hmac IS NULL AND x\.mobile_enc = \?\)/)
  assert.equal(w.args[0], M.sealMobile(phone).hmac); assert.deepEqual(w.args[1], Buffer.from(phone))
})
t('换主密钥：旧密文解不开、盲索引随之变化（所以轮换时必须一并重写）', () => {
  const k1 = M.mobileKeys(crypto.randomBytes(32)), k2 = M.mobileKeys(crypto.randomBytes(32))
  const s = M.sealMobileWith(k1, phone)
  assert.equal(M.openMobileWith(k1, s.enc), phone); assert.equal(M.openMobileWith(k2, s.enc), null)
  assert.notEqual(M.hmacMobileWith(k2, phone), s.hmac)
})
t('加密密钥与盲索引密钥相互独立', () => {
  const k = M.mobileKeys(crypto.randomBytes(32))
  assert.notDeepEqual(k.enc, k.mac)
})
console.log(`\n${n} 项通过`)
