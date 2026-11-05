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
import * as merchantLevel from './merchant-level.mjs'

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
 * @param {'basic'|'travel'|'creator'|'promoter'|'merchant'} scope basic=等级与入会时间；travel=再加行程数/城市数/徽章；其余=该角色的身份与等级（必须真实持有该角色）
 */
export async function issue(userId, scope = 'travel', ttlDays = VC_TTL_DAYS) {
  if (!ALL_SCOPES.includes(scope)) throw new Error('未知的凭证范围：' + scope)
  const k = await issuerKey()
  const did = await userDid(userId)
  if (!did) throw new Error('用户不存在')
  const claims = ROLE_SCOPES.includes(scope) ? await roleClaims(userId, scope) : await claimsOf(userId, scope)
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
      type: ['VerifiableCredential', ROLE_SCOPES.includes(scope) ? 'WanderlustRoleCredential' : scope === 'travel' ? 'WanderlustTravelCredential' : 'WanderlustMemberCredential'],
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
  const u = await one('SELECT id, status FROM user_account WHERE did_ref = ?', [payload.sub])
  if (u && Number(u.status) !== 1) return { valid: false, reason: '账号已停用，凭证失效' }

  // 角色凭证：不再具备该身份（推广资格失效、离开门店等）即失效
  const subjectScope = payload.vc?.credentialSubject?.scope
  if (u && ROLE_SCOPES.includes(subjectScope)) {
    try { await roleClaims(u.id, subjectScope) } catch { return { valid: false, reason: '持有人已不再具备该身份，凭证失效' } }
  }

  return {
    valid: true, reason: '签名有效、未过期、未吊销',
    issuer: payload.iss, subject: payload.sub, jti: payload.jti,
    issuedAt: new Date((payload.iat || 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp || 0) * 1000).toISOString(),
    claims: payload.vc?.credentialSubject || {},
    types: payload.vc?.type || [],
    disclosed: disclosure(subjectScope).disclose,
    notDisclosed: disclosure(subjectScope).withheld,
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
  const rows = await q(`SELECT u.id, u.nickname, u.avatar_url, u.did_ref, u.creator_tag, u.member_level,
      (SELECT p.tier FROM promoter p WHERE p.user_id = u.id AND p.status = 1) promoter_tier,
      (SELECT m.level FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id WHERE s.user_id = u.id AND s.status = 1 ORDER BY s.role DESC LIMIT 1) merchant_level,
      EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id AND c.status = 2) has_notes, u.growth_value, u.status, u.created_at,
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
      roles: [...(isCreator(r.creator_tag, r.has_notes) ? ['creator'] : []), ...(r.promoter_tier != null ? ['promoter'] : []), ...(r.merchant_level != null ? ['merchant'] : [])],
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

/* ---- 角色凭证：持有人可向第三方证明"我是平台的 xx 商户 / 服务商 / 创作者"，最小披露，不含金额与联系方式 ---- */
export const ROLE_SCOPES = ['creator', 'promoter', 'merchant']
export const ALL_SCOPES = ['travel', 'basic', ...ROLE_SCOPES]
const ROLE_LABEL = { creator: '创作者', promoter: '推广服务商', merchant: '商户' }
const STAFF_ROLE = { 1: '核销员', 2: '店长', 3: '老板' }

/** 凭证披露范围：对外说清楚给了什么、没给什么 */
export function disclosure(scope) {
  const withheld = ['姓名', '手机号', '身份证号', '订单号', '任何金额']
  if (scope === 'creator') return { disclose: ['角色', '创作者等级', '已发布内容数', '已完成约稿数'], withheld }
  if (scope === 'promoter') return { disclose: ['角色', '服务商等级'], withheld: [...withheld, '佣金比例', '推广业绩'] }
  if (scope === 'merchant') return { disclose: ['角色', '经营等级', '门店名称', '在店职务'], withheld: [...withheld, '营业数据'] }
  if (scope === 'basic') return { disclose: ['会员等级', '成长区间', '入会年月'], withheld }
  return { disclose: ['会员等级', '成长区间', '入会年月', '行程数', '城市数', '徽章名'], withheld }
}

/** 角色凭证的声明。没有该身份直接报错：不能给没资格的人签 */
async function roleClaims(userId, scope) {
  const noRole = () => new Error(`该用户没有${ROLE_LABEL[scope]}身份，不能签发${ROLE_LABEL[scope]}凭证`)
  if (scope === 'promoter') {
    const p = await one('SELECT tier FROM promoter WHERE user_id = ? AND status = 1', [userId])
    if (!p) throw noRole()
    const rank = Math.min(Number(p.tier) || 1, PROMOTER_LEVELS.length)
    return { role: scope, level: PROMOTER_LEVELS[rank - 1].name, levelNo: rank, scope }
  }
  if (scope === 'merchant') {
    const s = await one('SELECT s.role, m.name, m.level FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id WHERE s.user_id = ? AND s.status = 1 ORDER BY s.role DESC LIMIT 1', [userId])
    if (!s) throw noRole()
    const lvs = await merchantLevel.levels(), lv = lvs.find((l) => l.lv === Number(s.level)) || lvs[0]
    return { role: scope, level: lv.name, levelNo: lv.lv, merchantName: String(s.name), position: STAFF_ROLE[s.role] || '店员', scope }
  }
  const u = await one('SELECT creator_tag FROM user_account WHERE id = ?', [userId])
  const c = await one(`SELECT (SELECT COUNT(*) FROM content_note n WHERE n.user_id = ? AND n.status = 2) notes,
    (SELECT COUNT(*) FROM content_task_entry t WHERE t.user_id = ? AND t.status = 3) tasks`, [userId, userId])
  if (!u || !isCreator(u.creator_tag, c.notes)) throw noRole()
  const rank = CREATOR_RANK[u.creator_tag] || 1
  return { role: scope, level: CREATOR_LEVELS[rank - 1].name, levelNo: rank, works: Number(c.notes), tasks: Number(c.tasks), scope }
}

/* ---- 批量签发：给符合条件、还没有有效凭证的人各签一张；每张都进存证队列，由下一次打包统一成一个根 ---- */
const batchWhere = (scope) => {
  const cond = ['u.status = 1', 'NOT EXISTS (SELECT 1 FROM vc_issue v WHERE v.user_id = u.id AND v.scope = ? AND v.revoked_at IS NULL AND v.expires_at > NOW(3))']
  if (scope === 'promoter') cond.push('EXISTS (SELECT 1 FROM promoter p WHERE p.user_id = u.id AND p.status = 1)')
  if (scope === 'merchant') cond.push('EXISTS (SELECT 1 FROM merchant_staff s WHERE s.user_id = u.id AND s.status = 1)')
  if (scope === 'creator') cond.push("(u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id AND c.status = 2))")
  return cond.join(' AND ')
}
export const BATCH_MAX = 200
export async function batchPreview(scope) {
  if (!ALL_SCOPES.includes(scope)) throw new Error('未知的凭证范围：' + scope)
  const r = await one(`SELECT COUNT(*) n FROM user_account u WHERE ${batchWhere(scope)}`, [scope])
  return { scope, pending: Number(r.n) || 0, max: BATCH_MAX }
}
export async function issueBatch(scope, limit = BATCH_MAX) {
  if (!ALL_SCOPES.includes(scope)) throw new Error('未知的凭证范围：' + scope)
  const n = Math.min(BATCH_MAX, Math.max(1, Number(limit) || BATCH_MAX))
  const rows = await q(`SELECT u.id FROM user_account u WHERE ${batchWhere(scope)} ORDER BY u.id LIMIT ${n}`, [scope])
  let issued = 0
  const failed = []
  for (const r of rows) {   // 逐个签：一个人失败不拖累其他人，失败原因如实带回
    try { await issue(Number(r.id), scope); issued++ } catch (e) { failed.push({ userId: Number(r.id), reason: String(e.message).slice(0, 120) }) }
  }
  const left = await batchPreview(scope)
  return { scope, issued, failed, remaining: left.pending }
}

/* ---- 卡面体系的数据：各角色的等级清单与人数（卡种由前端按「第几级 / 共几级」算），以及单个用户的其他角色身份 ---- */
const PROMOTER_LEVELS = [{ lv: 1, name: '基础服务商' }, { lv: 2, name: '优选服务商' }, { lv: 3, name: '金牌服务商' }]
const CREATOR_LEVELS = [{ lv: 1, name: '普通创作者' }, { lv: 2, name: '签约创作者' }, { lv: 3, name: '优质创作者' }]
const CREATOR_RANK = { none: 1, limited: 1, signed: 2, star: 3 }
const isCreator = (tag, hasNotes) => (tag && tag !== 'none') || !!Number(hasNotes)

export async function cardScale() {
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]))
  const withN = (levels, m) => levels.map((l) => ({ lv: l.lv, name: l.name, n: m[String(l.lv)] || 0 }))
  const creators = toMap(await q(`SELECT u.creator_tag k, COUNT(*) n FROM user_account u
    WHERE u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id AND c.status = 2) GROUP BY u.creator_tag`))
  const creatorByRank = {}
  for (const [tag, n] of Object.entries(creators)) creatorByRank[CREATOR_RANK[tag] || 1] = (creatorByRank[CREATOR_RANK[tag] || 1] || 0) + n
  return {
    traveler: { levels: withN(await member.levels(), toMap(await q('SELECT member_level k, COUNT(*) n FROM user_account GROUP BY member_level'))) },
    creator: { levels: withN(CREATOR_LEVELS, creatorByRank) },
    promoter: { levels: withN(PROMOTER_LEVELS, toMap(await q('SELECT tier k, COUNT(*) n FROM promoter WHERE status = 1 GROUP BY tier'))) },
    merchant: { levels: withN(await merchantLevel.levels(), toMap(await q('SELECT level k, COUNT(*) n FROM merchant WHERE status = 1 GROUP BY level'))) },
  }
}

/** 该用户除旅行者外的角色身份卡（后台展示；不写进可携出的凭证） */
async function roleCards(userId) {
  const cards = []
  const u = await one('SELECT creator_tag FROM user_account WHERE id = ?', [userId])
  const yuan = (fen) => { const y = Number(fen || 0) / 100; return '¥' + (y >= 10000 ? (y / 10000).toFixed(1).replace(/\.0$/, '') + '万' : y.toLocaleString('zh-CN', { maximumFractionDigits: 0 })) }
  const c = await one(`SELECT (SELECT COUNT(*) FROM content_note n WHERE n.user_id = ? AND n.status = 2) notes,
    (SELECT COUNT(*) FROM content_task_entry t WHERE t.user_id = ? AND t.status = 3) tasks,
    (SELECT COUNT(*) FROM review r WHERE r.user_id = ?) reviews`, [userId, userId, userId])
  if (isCreator(u && u.creator_tag, c.notes)) {
    const rank = CREATOR_RANK[u.creator_tag] || 1
    cards.push({ role: 'creator', rank, total: CREATOR_LEVELS.length, levelName: CREATOR_LEVELS[rank - 1].name, sub: u.creator_tag === 'limited' ? '内容创作身份 · 当前限流' : '内容创作身份',
      stats: [{ label: '发布内容', val: Number(c.notes) }, { label: '完成约稿', val: Number(c.tasks) }, { label: '真实评价', val: Number(c.reviews) }] })
  }
  const p = await one('SELECT tier, rate_bp, valid_gmv_90d, service_score FROM promoter WHERE user_id = ? AND status = 1', [userId])
  if (p) {
    const rank = Math.min(Number(p.tier) || 1, PROMOTER_LEVELS.length)
    cards.push({ role: 'promoter', rank, total: PROMOTER_LEVELS.length, levelName: PROMOTER_LEVELS[rank - 1].name, sub: '一级推广 · 无层级',
      stats: [{ label: '近 90 天 GMV', val: yuan(p.valid_gmv_90d) }, { label: '服务分', val: String(p.service_score) }, { label: '佣金比例', val: Number(p.rate_bp) / 100 + '%' }] })
  }
  const staff = await q('SELECT s.role, m.id, m.name, m.level FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id WHERE s.user_id = ? AND s.status = 1 ORDER BY s.role DESC LIMIT 3', [userId])
  if (staff.length) {
    const lvs = await merchantLevel.levels()
    const ROLE = { 1: '核销员', 2: '店长', 3: '老板' }
    for (const s of staff) {
      const met = await merchantLevel.metrics(s.id)
      const badge = await one('SELECT COUNT(*) n FROM merchant_badge WHERE merchant_id = ?', [s.id])
      const lv = lvs.find((l) => l.lv === Number(s.level)) || lvs[0]
      cards.push({ role: 'merchant', rank: lv.lv, total: lvs.length, levelName: lv.name, sub: String(s.name).slice(0, 18) + ' · ' + (ROLE[s.role] || '店员'),
        stats: [{ label: '完成订单', val: met.orders }, { label: '综合评分', val: met.rating10 ? (met.rating10 / 10).toFixed(1) : '—' }, { label: '商户徽章', val: Number(badge.n) }] })
    }
  }
  return cards
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
    roleCards: await roleCards(userId),
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
    cardScale: await cardScale(),
    policy: '有效期 ' + VC_TTL_DAYS + ' 天 · 可即时吊销 · 最小披露（不含 PII）',
  }
}
