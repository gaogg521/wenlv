// 链抽象层：一套契约 · N 个适配器 · 一个开关
//
// 为什么要这一层：客户现场的链不可能是唯一的——今天链数根，明天客户要腾讯云 TBaaS，
// 后天要蚂蚁链/鲸探，境外还要 Polygon/Base。业务代码（存证、资产、报告）**一行都不该动**。
//
// 契约（每个 provider 必须实现）：
//   id            唯一标识
//   label         中文名（后台/文档展示）
//   docs          一句话说明接入前提
//   capabilities  { anchor, queryByRoot, assets, did } —— 能力声明，业务侧据此判断能不能做
//   mode()        'real' | 'noop'（凭据齐备与否）
//   status()      脱敏状态（缺哪些 env、当前模式、备注）
//   anchor({root, prevRoot, leafCount, bizDate, merkleKind}) → {txRef, block}
//   queryByRoot(root) → {txRef, block} | null（无标准反查能力的返回 null，以本地台账为准）
//   issueAsset?({to, tokenId, amount, uri, meta}) → {txRef, contract, tokenId}
//
// 铁律：
//   1. NOOP 永不返回伪 txRef —— "没有真实交易就没有交易号"是这套系统的底线
//   2. 生产环境禁用 mock provider
//   3. capabilities 不做的事，业务层必须明确报错，不许静默跳过
import noop from './noop.mjs'
import mock from './mock.mjs'
import chaingen from './chaingen.mjs'
import tbaas from './tbaas.mjs'
import antchain from './antchain.mjs'
import evm from './evm.mjs'

export const PROVIDERS = { noop, mock, chaingen, tbaas, antchain, evm }

const has = (...keys) => keys.every((k) => !!process.env[k])

/** 选择 provider：显式 CHAIN_PROVIDER 优先；否则按已有凭据自动推断 */
export function providerId() {
  const explicit = (process.env.CHAIN_PROVIDER || '').toLowerCase().trim()
  if (explicit) return explicit
  if (has('CHAIN_ENDPOINT', 'CHAIN_ACCOUNT', 'CHAIN_KEY')) return 'chaingen'
  if (has('TBAAS_SECRET_ID', 'TBAAS_SECRET_KEY')) return 'tbaas'
  if (has('ANTCHAIN_ENDPOINT', 'ANTCHAIN_ACCESS_KEY')) return 'antchain'
  if (has('EVM_RELAYER_URL', 'EVM_RELAYER_TOKEN')) return 'evm'
  return 'noop'
}

/** 取当前生效的适配器（显式指定了不存在的 id 会抛错，避免"以为接了链其实没接"） */
export function active() {
  const id = providerId()
  const p = PROVIDERS[id]
  if (!p) throw new Error(`未知的 CHAIN_PROVIDER=${id}，可选：${Object.keys(PROVIDERS).join(' / ')}`)
  if (id === 'mock' && process.env.NODE_ENV === 'production') throw new Error('生产环境禁止使用 mock 链')
  return p
}

export const chainMode = () => active().mode()
export const capabilities = () => active().capabilities

/** 后台/对外展示用的链状态（绝不回显密钥） */
export function chainStatus() {
  const p = active()
  const st = p.status()
  return {
    ...st,
    provider: p.id,
    label: p.label,
    docs: p.docs,
    capabilities: p.capabilities,
    // 兼容老字段（后台存证页曾在用）
    endpoint: process.env.CHAIN_ENDPOINT || '',
    account: process.env.CHAIN_ACCOUNT || '',
    keyConfigured: !!process.env.CHAIN_KEY,
  }
}

/** 全部可选链（后台「链与资产」页用） */
export function listProviders() {
  const cur = providerId()
  return Object.values(PROVIDERS).map((p) => {
    const s = p.status()
    return {
      id: p.id, label: p.label, docs: p.docs, capabilities: p.capabilities,
      mode: s.mode, missing: s.missing || [], note: s.note || '', current: p.id === cur,
    }
  })
}

/** 提交一枚 Merkle 根 */
export async function submit(args) {
  const p = active()
  if (!p.capabilities.anchor) throw new Error(`${p.label} 不支持存证锚定`)
  const r = await p.anchor(args)
  return { ...r, mode: r.mode || p.mode() }   // 统一带上 mode，调用方无需知道是哪家链
}

/** 按根查重（幂等） */
export async function queryByRoot(root) {
  const p = active()
  if (!p.capabilities.queryByRoot) return null
  return await p.queryByRoot(root)
}

/** 发行链上资产（数字徽章 / 权益凭证 NFT / 藏品） */
export async function issueAsset(args) {
  const p = active()
  if (!p.capabilities.assets) throw new Error(`${p.label} 不支持资产发行（capabilities.assets=false）`)
  if (typeof p.issueAsset !== 'function') throw new Error(`${p.label} 未实现 issueAsset`)
  return await p.issueAsset(args)
}
