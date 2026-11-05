// 链上资产发行（数字徽章 / 权益凭证 NFT / 藏品）
//
// 两道闸门，缺一不可：
//   1. 渠道闸门：channel='wechat' 直接拒绝（D10 红线，库里还有 CHECK 约束兜底）
//   2. 能力闸门：provider.capabilities.assets 必须为 true，否则明确报错
//
// 第三道是语义闸门：NOOP/未配凭据时**只落台账、status=0 待发行**，绝不写假 txRef。
import { q, one } from '../db.mjs'
import * as chain from '../infra/chain.mjs'

export const KINDS = {
  badge: { label: '数字徽章', note: '荣誉性质，不可交易' },
  pass_nft: { label: '权益凭证 NFT', note: '含具体权益（折扣/优先预订），仅境外或生态侧' },
  collectible: { label: '数字藏品', note: '需资质与内容审核；微信内禁止' },
}

export const CHANNELS = {
  wechat: { allowed: false, label: '微信小程序', reason: 'D10：微信生态内永久不做藏品发行 / 交易 / 转赠' },
  ecosystem: { allowed: true, label: '生态内（H5 / 合作方）', reason: '' },
  antchain_collectible: { allowed: true, label: '鲸探 / 蚂蚁链藏品', reason: '需资质、内容审核与服务商接入' },
  evm: { allowed: true, label: 'EVM 公链（境外）', reason: '仅境外业务，需当地合规' },
}

const assertChannel = (ch) => {
  const rule = CHANNELS[ch]
  if (!rule) throw new Error(`未知渠道：${ch}（可选 ${Object.keys(CHANNELS).join(' / ')}）`)
  if (!rule.allowed) throw new Error(`渠道 ${rule.label} 禁止发行：${rule.reason}`)
  return rule
}

/**
 * 发行一件链上资产
 * @param {object} p
 * @param {'badge'|'pass_nft'|'collectible'} p.kind
 * @param {number} p.userId
 * @param {string} p.channel  渠道（wechat 会被拒）
 * @param {object} p.meta     { name, image, desc, rights } —— 不含 PII
 * @param {string} [p.to]     链上接收地址（EVM 必填；联盟链可留空由平台代持）
 */
export async function issue({ kind, userId, channel = 'ecosystem', meta = {}, to = null, tokenId = null }) {
  if (!KINDS[kind]) throw new Error(`未知资产类型：${kind}`)
  assertChannel(channel)
  const u = await one('SELECT id, nickname, did_ref FROM user_account WHERE id = ?', [Number(userId)])
  if (!u) throw new Error('用户不存在')

  // 幂等：同一 (类型 + 用户 + tokenId) 已发行过就直接返回，不重复上链
  if (tokenId) {
    const exist = await one('SELECT * FROM asset_issue WHERE kind = ? AND user_id = ? AND token_id = ?',
      [kind, Number(userId), tokenId])
    if (exist && Number(exist.status) === 1) {
      return { id: Number(exist.id), skipped: true, status: 1, txRef: exist.tx_ref, tokenId, provider: exist.provider, note: '该资产已发行过' }
    }
  }

  const provider = chain.chainStatus()
  const caps = provider.capabilities || {}
  const row = {
    kind, channel, provider: provider.provider, user_id: Number(userId),
    token_id: tokenId, meta: JSON.stringify(meta), to,
  }

  // 能力闸门：这条链压根不支持发资产 → 明确报错（不许"看起来发了"）
  if (!caps.assets) {
    await record({ ...row, status: 2, err: `${provider.label} 不支持资产发行` })
    throw new Error(`${provider.label} 不支持资产发行（capabilities.assets=false）；请到「链接入中心」切换到支持资产的链（腾讯云 TBaaS / 蚂蚁链鲸探 / EVM）`)
  }

  // 未配凭据：落台账待发行，不造假
  if (provider.mode !== 'real') {
    const id = await record({ ...row, status: 0, err: null })
    return { id, queued: true, status: 0, note: '已入待发行队列：链凭据到位后由「重试发行」上链', provider: provider.provider }
  }

  try {
    const r = await chain.issueAsset({ to, tokenId, meta, uri: meta.image || null })
    const id = await record({ ...row, status: 1, token_id: r.tokenId || tokenId, contract: r.contract, tx_ref: r.txRef })
    return { id, queued: false, status: 1, txRef: r.txRef, contract: r.contract, tokenId: r.tokenId || tokenId, provider: provider.provider }
  } catch (e) {
    const id = await record({ ...row, status: 2, err: String(e.message).slice(0, 250) })
    return { id, queued: false, status: 2, err: String(e.message), provider: provider.provider }
  }
}

async function record(r) {
  // q() 对 INSERT 返回的是 ResultSetHeader，必须取 insertId，不能把整个 header 当 id（曾踩坑）
  const res = await q(
    `INSERT INTO asset_issue (kind, channel, provider, user_id, token_id, contract, tx_ref, status, meta, err, issued_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, IF(? = 1, NOW(3), NULL))`,
    [r.kind, r.channel, r.provider, r.user_id, r.token_id || null, r.contract || null, r.tx_ref || null,
      r.status, r.meta || '{}', r.err || null, r.status])
  return Number(res.insertId)
}

/** 重试待发行 / 失败的记录（凭据到位后一键补发） */
export async function retry(id) {
  const a = await one('SELECT * FROM asset_issue WHERE id = ?', [id])
  if (!a) throw new Error('记录不存在')
  if (Number(a.status) === 1) return { skipped: true, reason: '已发行' }
  const provider = chain.chainStatus()
  if (!(provider.capabilities || {}).assets) throw new Error(`${provider.label} 不支持资产发行`)
  if (provider.mode !== 'real') return { skipped: true, reason: '链凭据未就绪（NOOP），保持待发行' }
  try {
    const r = await chain.issueAsset({ to: null, tokenId: a.token_id, meta: JSON.parse(a.meta || '{}') })
    await q(`UPDATE asset_issue SET status = 1, tx_ref = ?, contract = ?, token_id = ?, err = NULL, issued_at = NOW(3) WHERE id = ?`,
      [r.txRef, r.contract || null, r.tokenId || a.token_id, a.id])
    return { id: a.id, status: 1, txRef: r.txRef }
  } catch (e) {
    await q('UPDATE asset_issue SET status = 2, err = ? WHERE id = ?', [String(e.message).slice(0, 250), a.id])
    return { id: a.id, status: 2, err: String(e.message) }
  }
}

export async function list(limit = 50) {
  return await q(`SELECT a.*, u.nickname FROM asset_issue a JOIN user_account u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ${Number(limit)}`)
}

export async function stats() {
  const agg = await one(`SELECT COUNT(*) total,
    SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) issued,
    SUM(CASE WHEN status=2 THEN 1 ELSE 0 END) failed FROM asset_issue`)
  const byProvider = await q('SELECT provider, status, COUNT(*) n FROM asset_issue GROUP BY provider, status')
  return {
    total: Number(agg.total) || 0, pending: Number(agg.pending) || 0,
    issued: Number(agg.issued) || 0, failed: Number(agg.failed) || 0,
    byProvider,
    chain: chain.chainStatus(),
    providers: chain.listProviders(),
    channels: Object.entries(CHANNELS).map(([k, v]) => ({ id: k, ...v })),
    kinds: Object.entries(KINDS).map(([k, v]) => ({ id: k, ...v })),
  }
}
