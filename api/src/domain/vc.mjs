// 数字身份（VC-JWT，Ed25519）：可携出、他方可验、最小披露
//
// 为什么这么做（不是玩具）：
//   1. 凭证内容只有"旅行事实"，没有姓名/手机号/身份证/订单号/金额 —— 即使 JWT 全文公开也泄露不了什么
//   2. 签名私钥在平台，公钥公开发布（/open/vc/issuer），任何一方都能离线验签，不需要回调我方接口
//   3. 有效期短 + 可吊销（吊销即时生效：验签时会回查 vc_issue）
//   4. DID 由 HMAC 派生，不可反推账号；换 DID 等于重新绑定身份
//
// 边界：DID/VC 只在 B/G 端与生态对外场景使用；微信小程序内不出现"数字身份凭证"字样（D6 双层口径）。
import crypto from 'node:crypto'
import { q, one } from '../db.mjs'
import { attest } from './attest.mjs'
import { getSecret, setSecret, setSecretIfAbsent, secretStatus } from '../infra/secrets.mjs'
import * as member from './member.mjs'

const KEY_NAME = 'VC_ISSUER_KEY'
const PEPPER_NAME = 'VC_DID_PEPPER'
const DEFAULT_ISSUER = 'did:cn:wl:issuer-main'
const VC_TTL_DAYS = Number(process.env.VC_TTL_DAYS || 30)

const b64u = (b) => Buffer.from(b).toString('base64url')
// 成长值区间的披露口径：只给所在等级的区间（如「2千–1万」），不给精确值；等级名与门槛来自参数中心 member.levels
const fmtPts = (n) => (n >= 10000 ? n / 10000 + '万' : n >= 1000 ? n / 1000 + '千' : String(n))
async function levelBand(lv) {
  const lvs = await member.levels()
  const cur = lvs.find((l) => l.lv === lv) || lvs[0], next = lvs.find((l) => l.lv === cur.lv + 1)
  const lo = Math.floor(cur.min / 100), hi = next ? Math.floor(next.min / 100) : null
  return { name: cur.name, band: hi == null ? fmtPts(lo) + '以上' : lo === 0 ? fmtPts(hi) + '以内' : fmtPts(lo) + '–' + fmtPts(hi) }
}

/** 取（或首次生成并加密落库）issuer 私钥。私钥只在服务端，永不出接口 */
async function issuerKey() {
  // 三种情况必须分开（P-15）：库里确实没有 → 首次生成；有但解不开 / 解开但结构无效 → 失败关闭，绝不覆盖。
  // 浏览数字身份页、公开读公钥（/open/vc/issuer）、常规重启都会走到这里，不能因此隐式轮换已有密钥。
  const st = await secretStatus(KEY_NAME)
  if (st === 'undecryptable') throw new Error(KEY_NAME + ' 已存在但无法用当前主密钥解密：请检查 JWT_SECRET / SECRETS_KEY 是否与历史一致。已拒绝自动生成新密钥，原密文未改动')
  if (st === 'ok') {
    const raw = await getSecret(KEY_NAME)
    try {
      const k = JSON.parse(raw)
      return {
        kid: k.kid,
        did: k.did,
        priv: crypto.createPrivateKey({ key: Buffer.from(k.priv, 'base64'), format: 'der', type: 'pkcs8' }),
        pubJwk: k.pubJwk,
        createdAt: k.createdAt,
      }
    } catch { throw new Error(KEY_NAME + ' 已解密但结构无效：已拒绝自动生成新密钥覆盖，请人工检查（原密文未改动）') }
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const did = process.env.VC_ISSUER_DID || DEFAULT_ISSUER
  const kid = did + '#key-1'
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
  const pubJwk = publicKey.export({ format: 'jwk' })
  const payload = { priv, pubJwk, kid, did, createdAt: new Date().toISOString() }
  // 并发首次初始化（P-15）：插入只在该键确实不存在时生效，先落库者获胜；输者丢弃自己的候选钥匙、
  // 沿用插入后库里实际存着的密钥——保证任何时刻对外签名用的都是最终落库的那把，不会签出无人能验的凭证。
  const stored = await setSecretIfAbsent(KEY_NAME, JSON.stringify(payload), 'system:vc')
  let k
  try { k = JSON.parse(stored) } catch {
    throw new Error(KEY_NAME + ' 并发初始化后无法读取已落库的密钥：已拒绝覆盖，请人工检查主密钥配置')
  }
  if (k.kid !== kid) console.log('[vc] issuer 密钥已由并发初始化先行落库，沿用已存在密钥（kid=' + k.kid + '）')
  return {
    kid: k.kid,
    did: k.did,
    priv: crypto.createPrivateKey({ key: Buffer.from(k.priv, 'base64'), format: 'der', type: 'pkcs8' }),
    pubJwk: k.pubJwk,
    createdAt: k.createdAt,
  }
}

/** DID 派生盐：稳定、独立于 JWT_SECRET（改 JWT 密钥不应让全体 DID 失效） */
async function pepper() {
  const st = await secretStatus(PEPPER_NAME)
  if (st === 'undecryptable') throw new Error(PEPPER_NAME + ' 已存在但无法用当前主密钥解密：已拒绝重新生成（重新生成会让全体 DID 变化），原密文未改动')
  let p = await getSecret(PEPPER_NAME)
  if (!p) {
    // 并发首次初始化（P-15）：与 issuerKey 相同的原子首写；输者沿用先落库的盐，绝不回退用自己的候选值（否则 DID 不稳定）
    const stored = await setSecretIfAbsent(PEPPER_NAME, crypto.randomBytes(32).toString('hex'), 'system:vc')
    if (!stored) throw new Error(PEPPER_NAME + ' 并发初始化后无法读取已落库的盐：已拒绝覆盖，请人工检查主密钥配置')
    p = stored
  }
  return p
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
function base32(buf) {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

/** 由 userId 派生稳定 DID 并落库（首次调用时写入 user_account.did_ref） */
export async function userDid(userId) {
  const u = await one('SELECT id, did_ref FROM user_account WHERE id = ?', [userId])
  if (!u) return null
  if (u.did_ref) return u.did_ref
  const mac = crypto.createHmac('sha256', await pepper()).update('wl-did-v1:' + Number(userId)).digest().subarray(0, 16)
  const did = 'did:cn:wl:' + base32(mac)
  await q('UPDATE user_account SET did_ref = ? WHERE id = ? AND (did_ref IS NULL OR did_ref = "")', [did, Number(userId)])
  const again = await one('SELECT did_ref FROM user_account WHERE id = ?', [userId])
  return again.did_ref || did
}

/** 会员事实（最小披露）：只给"旅行事实"，不给身份信息与金额 */
async function claimsOf(userId, scope) {
  const u = await one(`SELECT member_level, growth_value, created_at FROM user_account WHERE id = ?`, [userId])
  const lv = Number(u.member_level || 1)
  const lb = await levelBand(lv)
  const base = {
    level: lb.name,
    levelNo: lv,
    growthBand: lb.band,
    memberSince: String(u.created_at || '').slice(0, 7),
    scope,
  }
  if (scope !== 'travel') return base
  const trips = await one(`SELECT COUNT(*) n, COUNT(DISTINCT city_code) c FROM orders WHERE user_id = ? AND status IN (40,50)`, [userId])
  const badges = await q(`SELECT b.name FROM user_badge ub JOIN badge b ON b.id = ub.badge_id WHERE ub.user_id = ? LIMIT 10`, [userId])
  return {
    ...base,
    trips: Number(trips.n) || 0,
    cities: Number(trips.c) || 0,
    badges: badges.map((b) => b.name),
  }
}

/**
 * 签发一张 VC（VC-JWT）
 * @param {number} userId
 * @param {'basic'|'travel'} scope basic=等级与入会时间；travel=再加行程数/城市数/徽章
 */
export async function issue(userId, scope = 'travel', ttlDays = VC_TTL_DAYS) {
  const k = await issuerKey()
  const did = await userDid(userId)
  if (!did) throw new Error('用户不存在')
  const claims = await claimsOf(userId, scope)
  const now = Math.floor(Date.now() / 1000)
  const ttlSec = Math.max(1, Math.round(Number(ttlDays) * 86400))   // 支持亚天级 TTL（自测过期用）
  const exp = now + ttlSec
  const jti = crypto.randomBytes(12).toString('hex')

  const header = { alg: 'EdDSA', typ: 'JWT', kid: k.kid }
  const payload = {
    iss: k.did,
    sub: did,
    iat: now,
    nbf: now,
    exp,
    jti,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://wanderlust.local/contexts/travel-v1.json'],
      type: ['VerifiableCredential', scope === 'travel' ? 'WanderlustTravelCredential' : 'WanderlustMemberCredential'],
      credentialSubject: claims,
      // 声明"这是平台签发的旅行事实"，不含任何 PII
      credentialSchema: { id: 'https://wanderlust.local/schemas/travel-v1', type: 'JsonSchema' },
    },
  }
  const signingInput = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(payload))
  const sig = crypto.sign(null, Buffer.from(signingInput), k.priv)
  const jwt = signingInput + '.' + b64u(sig)

  // 凭证签发放进存证队列：证明"这份凭证是平台在某刻对某个 DID 签的"，不涉任何 PII
  await attest('did_issue', 'vc-' + jti, {
    userId: Number(userId), did, scope, jti, expiresAt: exp * 1000,
  })
  await q(`INSERT INTO vc_issue (user_id, did, scope, jti, jwt_hash, claims, expires_at)
           VALUES (?,?,?,?,?,?,FROM_UNIXTIME(?))`,
    [Number(userId), did, scope, jti, crypto.createHash('sha256').update(jwt).digest('hex'),
      JSON.stringify(claims), exp])

  return { jwt, did, jti, claims, expiresAt: new Date(exp * 1000).toISOString(), issuer: k.did, kid: k.kid }
}

/** 验签（不依赖我方可达性：先本地验签，再回查吊销） */
export async function verify(jwt) {
  const parts = String(jwt || '').trim().split('.')
  if (parts.length !== 3) return { valid: false, reason: '格式错误（需 JWT 三段式）' }
  let header, payload
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch { return { valid: false, reason: '头或载荷不是合法 JSON' } }

  const k = await issuerKey()
  if (header.alg !== 'EdDSA') return { valid: false, reason: '签名算法不符（应为 EdDSA）' }
  if (header.kid !== k.kid) return { valid: false, reason: '签发者密钥不匹配（可能非本平台签发）', kid: header.kid }

  const pub = crypto.createPublicKey(k.priv)
  const okSig = crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), pub, Buffer.from(parts[2], 'base64url'))
  if (!okSig) return { valid: false, reason: '签名校验失败（内容被改动或非本平台签发）' }

  const now = Math.floor(Date.now() / 1000)
  if (payload.nbf && now < payload.nbf) return { valid: false, reason: '凭证尚未生效' }
  // RFC 7519：当前时间必须严格早于 exp；now === exp 即视为过期
  if (payload.exp && now >= payload.exp) return { valid: false, reason: '凭证已过期', expiredAt: new Date(payload.exp * 1000).toISOString() }

  const rec = await one('SELECT id, revoked_at, revoke_reason FROM vc_issue WHERE jti = ?', [payload.jti])
  if (rec && rec.revoked_at) return { valid: false, reason: '凭证已被吊销：' + (rec.revoke_reason || '未注明'), revokedAt: rec.revoked_at }

  // 账号被停用 → 凭证随之失效（用户端封号要能传导到凭证）
  const u = await one('SELECT status FROM user_account WHERE did_ref = ?', [payload.sub])
  if (u && Number(u.status) !== 1) return { valid: false, reason: '账号已停用，凭证失效' }

  return {
    valid: true, reason: '签名有效、未过期、未吊销',
    issuer: payload.iss, subject: payload.sub, jti: payload.jti,
    issuedAt: new Date((payload.iat || 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp || 0) * 1000).toISOString(),
    claims: payload.vc?.credentialSubject || {},
    types: payload.vc?.type || [],
    disclosed: ['会员等级', '成长区间', '入会年月', '行程数', '城市数', '徽章名'],
    notDisclosed: ['姓名', '手机号', '身份证号', '订单号', '任何金额'],
  }
}

/** 公钥发布（JWKS 风格）：第三方拿这个就能离线验签，不必回调我方接口 */
export async function issuerJwks() {
  const k = await issuerKey()
  return {
    issuer: k.did,
    kid: k.kid,
    keys: [{ ...k.pubJwk, kid: k.kid, use: 'sig', alg: 'EdDSA' }],
    createdAt: k.createdAt,
    usage: 'VC-JWT 的 header.kid 与此处 kid 对应；签名算法 EdDSA(Ed25519)，签名输入为 base64url(header)+"."+base64url(payload)',
    privacy: '凭证只含旅行事实，不含姓名/手机号/身份证号/订单号/金额',
  }
}

export async function revoke(issueId, reason, by) {
  const rec = await one('SELECT id, revoked_at FROM vc_issue WHERE id = ?', [issueId])
  if (!rec) throw new Error('凭证不存在')
  if (rec.revoked_at) return { revoked: false, reason: '已吊销' }
  await q('UPDATE vc_issue SET revoked_at = NOW(3), revoke_reason = ? WHERE id = ? AND revoked_at IS NULL',
    [String(reason || '').slice(0, 120) || ('by ' + (by || 'admin')), issueId])
  return { revoked: true, id: Number(issueId) }
}

/**
 * 身份档案列表：一个用户 = 一个数字身份(DID) = 至多一个旅豆账户 + 若干徽章 / 行程 / 凭证。
 * 数字身份与旅豆账户以 user_id 一一关联；列表里把两边放在同一行，避免"台账里 24 个账户、数字身份里 0 个持有人"这种脱节。
 * DID 由 HMAC 稳定派生（幂等），本页用到的用户在这里顺手确保已派生。
 */
export async function identities({ q: kw = '', page = 1, size = 20 } = {}) {
  page = Math.max(1, Number(page) || 1); size = Math.min(100, Math.max(1, Number(size) || 20))
  const where = [], args = []
  kw = String(kw || '').trim()
  if (kw) {
    if (/^\d+$/.test(kw)) { where.push('(u.id = ? OR u.nickname LIKE ?)'); args.push(Number(kw), '%' + kw + '%') }
    else { where.push('(u.nickname LIKE ? OR u.did_ref = ?)'); args.push('%' + kw + '%', kw) }
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = Number((await one(`SELECT COUNT(*) n FROM user_account u ${w}`, args)).n) || 0
  const rows = await q(`SELECT u.id, u.nickname, u.avatar_url, u.did_ref, u.member_level, u.growth_value, u.status, u.created_at,
      b.balance, b.lifetime,
      (SELECT COUNT(*) FROM user_badge ub WHERE ub.user_id = u.id) badges,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status IN (40,50)) trips,
      (SELECT COUNT(*) FROM vc_issue v WHERE v.user_id = u.id AND v.revoked_at IS NULL AND v.expires_at > NOW(3)) vc_active,
      (SELECT MAX(v.issued_at) FROM vc_issue v WHERE v.user_id = u.id) vc_last
    FROM user_account u LEFT JOIN bean_account b ON b.user_id = u.id ${w} ORDER BY u.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)
  const lvs = await member.levels()
  const out = []
  for (const r of rows) {
    const did = r.did_ref || await userDid(r.id)
    out.push({
      userId: Number(r.id), nickname: r.nickname || ('用户' + r.id), avatar: r.avatar_url || null, did,
      levelNo: Number(r.member_level || 1), levelName: (lvs.find((l) => l.lv === Number(r.member_level || 1)) || lvs[0]).name,
      growth: Number(r.growth_value) || 0, status: Number(r.status),
      beanBalance: r.balance == null ? null : Number(r.balance), beanLifetime: r.lifetime == null ? null : Number(r.lifetime),
      badges: Number(r.badges) || 0, trips: Number(r.trips) || 0, vcActive: Number(r.vc_active) || 0, vcLast: r.vc_last || null,
    })
  }
  const agg = await one(`SELECT (SELECT COUNT(*) FROM user_account) users, (SELECT COUNT(*) FROM bean_account WHERE user_id < 999999000000) bean_accounts,
    (SELECT COUNT(DISTINCT user_id) FROM vc_issue WHERE revoked_at IS NULL AND expires_at > NOW(3)) vc_holders`)
  return { total, page, size, rows: out, summary: { users: Number(agg.users), beanAccounts: Number(agg.bean_accounts), vcHolders: Number(agg.vc_holders) } }
}

/** 单个身份的完整档案（后台可看；凭证本身仍只含最小披露字段）：等级 / 行程 / 城市 / 徽章 / 旅豆账户与流水 / 凭证记录 */
export async function identityDetail(userId) {
  userId = Number(userId)
  const u = await one('SELECT id, nickname, member_level, growth_value, status, created_at FROM user_account WHERE id = ?', [userId])
  if (!u) throw new Error('用户不存在')
  const did = await userDid(userId)
  const claims = await claimsOf(userId, 'travel')
  const lvs = await member.levels()
  const cur = lvs.find((l) => l.lv === Number(u.member_level || 1)) || lvs[0], next = lvs.find((l) => l.lv === cur.lv + 1)
  const acct = await one('SELECT id, balance, lifetime FROM bean_account WHERE user_id = ?', [userId])
  const ledger = acct ? await q(`SELECT tx_no, direction, amount, after_bal, biz_type, biz_ref, memo, created_at FROM bean_ledger
      WHERE account_id = ? ORDER BY id DESC LIMIT 12`, [acct.id]) : []
  const trips = await q(`SELECT o.order_no, o.status, o.city_code, p.title, COALESCE(o.completed_at, o.paid_at) at FROM orders o
      JOIN tour_product p ON p.id = o.product_id WHERE o.user_id = ? AND o.status IN (40,50) ORDER BY o.id DESC LIMIT 20`, [userId])
  const cities = await q(`SELECT city_code, COUNT(*) n FROM orders WHERE user_id = ? AND status IN (40,50) GROUP BY city_code ORDER BY n DESC`, [userId])
  const badges = await q(`SELECT b.name, b.rule_desc, ub.granted_at, ub.ref FROM user_badge ub JOIN badge b ON b.id = ub.badge_id
      WHERE ub.user_id = ? ORDER BY ub.granted_at DESC`, [userId])
  const vcs = await q('SELECT id, scope, issued_at, expires_at, revoked_at FROM vc_issue WHERE user_id = ? ORDER BY id DESC LIMIT 10', [userId])
  return {
    userId, nickname: u.nickname || ('用户' + userId), did, claims,
    level: { no: cur.lv, name: cur.name, growth: Number(u.growth_value) || 0, from: cur.min, to: next ? next.min : null, nextName: next ? next.name : null },
    memberSince: u.created_at,
    bean: acct ? { balance: Number(acct.balance), lifetime: Number(acct.lifetime), ledger } : null,
    trips, cities, badges, vcs,
  }
}

/** 后台概览 */
export async function stats() {
  const k = await issuerKey()
  const agg = await one(`SELECT COUNT(*) total,
    SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) revoked,
    SUM(CASE WHEN expires_at > NOW(3) AND revoked_at IS NULL THEN 1 ELSE 0 END) active,
    COUNT(DISTINCT user_id) holders FROM vc_issue`)
  const eligible = await one('SELECT COUNT(*) n FROM user_account')   // 可签发用户：与旅豆账户数、凭证持有人是三个口径，后台页分别标注
  const recent = await q(`SELECT v.id, v.user_id, v.did, v.scope, v.claims, v.issued_at, v.expires_at, v.revoked_at,
      u.nickname FROM vc_issue v JOIN user_account u ON u.id = v.user_id ORDER BY v.id DESC LIMIT 20`)
  return {
    issuer: k.did, kid: k.kid,
    keyFingerprint: crypto.createHash('sha256').update(JSON.stringify(k.pubJwk)).digest('hex').slice(0, 32),
    total: Number(agg.total) || 0, active: Number(agg.active) || 0,
    revoked: Number(agg.revoked) || 0, holders: Number(agg.holders) || 0, eligible: Number(eligible.n) || 0,
    recent,
    policy: '有效期 ' + VC_TTL_DAYS + ' 天 · 可即时吊销 · 最小披露（不含 PII）',
  }
}
