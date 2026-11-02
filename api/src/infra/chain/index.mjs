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
//   confirm?({txRef, root}) → {final, block, confirmations, reason}
//                    仅 capabilities.confirm=true 的链实现：提交返回的 txRef 只代表"已广播"，
//                    必须核验回执成功、确认数达标、交易内容就是这枚根，才算已锚定
//
// 铁律：
//   1. NOOP 永不返回伪 txRef —— "没有真实交易就没有交易号"是这套系统的底线
//   2. 生产环境禁用 mock provider
//   3. capabilities 不做的事，业务层必须明确报错，不许静默跳过
import { E } from './conf.mjs'
import noop from './noop.mjs'
import mock from './mock.mjs'
import chaingen from './chaingen.mjs'
import tbaas from './tbaas.mjs'
import antchain from './antchain.mjs'
import evm, { NETWORKS } from './evm.mjs'
import fisco from './fisco.mjs'
import gateway, { PRESETS as GATEWAY_PRESETS } from './gateway.mjs'

export const PROVIDERS = { noop, mock, chaingen, tbaas, antchain, fisco, gateway, evm }
export { NETWORKS, GATEWAY_PRESETS }

/**
 * 接入目录：后台「链接入中心」按此渲染。keys = 该链需要的配置项（secret=true 的只存密文、不回显）。
 * protocol 写清楚对方要提供什么、我方怎么签名、同步还是异步，商务对接时可直接截图给对方。
 */
const K = (key, label, o = {}) => ({ key, label, ...o })
export const CATALOG = {
  chaingen: { group: 'alliance', vendor: '上海数据集团', protocol: { transport: 'HTTPS REST', sign: 'HMAC-SHA256（METHOD\nPATH\nts\nbody）', mode: '同步出块', contract: '无需部署合约' },
    keys: [K('CHAIN_ENDPOINT', '接入地址', { required: true, ph: 'https://…' }), K('CHAIN_ACCOUNT', '接入账号', { required: true }), K('CHAIN_KEY', '签名密钥', { required: true, secret: true })] },
  tbaas: { group: 'alliance', vendor: '腾讯云', protocol: { transport: '腾讯云 API 3.0', sign: 'TC3-HMAC-SHA256', mode: '同步', contract: '需部署落根合约 writeRoot' },
    keys: [K('TBAAS_SECRET_ID', 'SecretId', { required: true }), K('TBAAS_SECRET_KEY', 'SecretKey', { required: true, secret: true }), K('TBAAS_CLUSTER_ID', '网络 ID', { required: true }),
      K('TBAAS_CHANNEL', '通道/群组', { required: true }), K('TBAAS_REGION', '地域', { ph: 'ap-shanghai' }), K('TBAAS_ROOT_FUNC', '落根方法', { ph: 'writeRoot' }),
      K('TBAAS_NFT_CONTRACT', '资产合约（可选）'), K('TBAAS_MINT_FUNC', '发行方法（可选）')] },
  antchain: { group: 'alliance', vendor: '蚂蚁集团', protocol: { transport: 'OpenAPI REST', sign: 'HMAC-SHA256 或 RSA-SHA256（可切换）', mode: '同步', contract: '存证服务或自有合约' },
    keys: [K('ANTCHAIN_ENDPOINT', '接入地址', { required: true }), K('ANTCHAIN_ACCESS_KEY', 'AccessKey', { required: true }), K('ANTCHAIN_ACCESS_SECRET', 'AccessSecret', { secret: true }),
      K('ANTCHAIN_PRIVATE_KEY', 'RSA 私钥（rsa 模式）', { secret: true, multiline: true }), K('ANTCHAIN_SIGN', '签名方式', { ph: 'hmac-sha256 / rsa-sha256' }),
      K('ANTCHAIN_BIZID', '链 BizId'), K('ANTCHAIN_ACCOUNT', '链上账户'), K('ANTCHAIN_COLLECTION_ID', '数字资产集合 ID（需资质）')] },
  fisco: { group: 'alliance', vendor: '微众银行 · 开源', protocol: { transport: 'WeBASE-Front REST', sign: '由 WeBASE 托管私钥签名', mode: '提交 → 回执确认（PBFT 即时终局）', contract: '需部署 writeRoot(bytes32,bytes32,uint64)' },
    keys: [K('FISCO_FRONT_URL', 'WeBASE-Front 地址', { required: true, ph: 'http://10.0.0.8:5002' }), K('FISCO_GROUP_ID', '群组', { ph: 'group0（3.x）/ 1（2.x）' }),
      K('FISCO_USER', '签名用户地址/ID', { required: true }), K('FISCO_CONTRACT_ADDRESS', '落根合约地址', { required: true }), K('FISCO_CONTRACT_NAME', '合约名', { ph: 'RootAnchor' }),
      K('FISCO_AUTH_HEADER', '网关鉴权头（可选）', { secret: true, ph: 'Authorization: Bearer …' })] },
  gateway: { group: 'alliance', vendor: '长安链 / 至信链 / BSN / 星火·链网 / 百度超级链 …', protocol: { transport: 'HTTPS REST（字段可配）', sign: 'HMAC-SHA256 / 国密 HMAC-SM3 / 无', mode: '同步或异步（回调 /callback/chain/gateway）', contract: '视对方而定' },
    keys: [K('GW_ENDPOINT', '网关地址', { required: true }), K('GW_APP_ID', 'AppId'), K('GW_SECRET', '签名密钥', { secret: true }), K('GW_SIGN_ALGO', '签名算法', { ph: 'hmac-sha256 / hmac-sm3 / none' }),
      K('GW_ANCHOR_PATH', '提交路径', { ph: '/v1/anchor' }), K('GW_BODY_TEMPLATE', '请求体模板', { multiline: true, ph: '{"root":"{root}","prevRoot":"{prevRoot}"}' }),
      K('GW_TX_PATH', '交易号字段路径', { ph: 'data.txId' }), K('GW_BLOCK_PATH', '块高字段路径'), K('GW_OK_PATH', '成功判定字段'), K('GW_OK_VALUE', '成功判定值'),
      K('GW_ASYNC', '异步模式', { ph: '1=异步' }), K('GW_RECEIPT_PATH', '回执查询路径', { ph: '/v1/tx/{txRef}' }), K('GW_FINAL_PATH', '终局判定字段'), K('GW_FINAL_VALUE', '终局判定值'),
      K('GW_SIGN_TEMPLATE', '签名原文模板', { ph: '{method}\\n{path}\\n{ts}\\n{nonce}\\n{body}' }), K('GW_HDR_APP', 'AppId 头名'), K('GW_HDR_TS', '时间戳头名'), K('GW_HDR_NONCE', '随机串头名'), K('GW_HDR_SIGN', '签名头名'),
      K('GW_PROBE_PATH', '只读探测路径（可选）')] },
  evm: { group: 'public', vendor: 'Ethereum / Polygon / Base / BNB / Arbitrum / Optimism / Conflux eSpace', protocol: { transport: 'JSON-RPC + 托管签名 relayer', sign: '私钥不进本服务（KMS / Fireblocks / 自建 relayer）', mode: '提交 → 回执 + 确认数 → 核验交易内容', contract: '存证无需合约（根写入交易 data）；资产用 ERC-1155' },
    keys: [K('EVM_NETWORK', '网络', { ph: Object.keys(NETWORKS).join(' / ') }), K('EVM_RPC_URL', 'RPC 节点', { required: true }), K('EVM_RELAYER_URL', 'Relayer 地址', { required: true }),
      K('EVM_RELAYER_TOKEN', 'Relayer 令牌', { required: true, secret: true }), K('EVM_ANCHOR_TO', '落根目标地址', { required: true, ph: '0x…' }), K('EVM_CHAIN_ID', 'chainId（覆盖网络预置）'),
      K('EVM_CONFIRMATIONS', '确认数（覆盖网络预置）'), K('EVM_EXPLORER', '浏览器交易链接前缀'), K('EVM_NFT_CONTRACT', 'ERC-1155 合约（可选）')] },
  mock: { group: 'dev', vendor: '内存自测链', protocol: { transport: '进程内', sign: '无', mode: '同步', contract: '—' }, keys: [] },
  noop: { group: 'dev', vendor: '未接入', protocol: { transport: '—', sign: '—', mode: '批次停在"已打包·待锚定"', contract: '—' }, keys: [] },
}
export const providerById = (id) => PROVIDERS[id] || null

const has = (...keys) => keys.every((k) => !!E[k])

/** 选择 provider：显式 CHAIN_PROVIDER 优先；否则按已有凭据自动推断 */
export function providerId() {
  const explicit = (E.CHAIN_PROVIDER || '').toLowerCase().trim()
  if (explicit) return explicit
  if (has('CHAIN_ENDPOINT', 'CHAIN_ACCOUNT', 'CHAIN_KEY')) return 'chaingen'
  if (has('TBAAS_SECRET_ID', 'TBAAS_SECRET_KEY')) return 'tbaas'
  if (has('ANTCHAIN_ENDPOINT', 'ANTCHAIN_ACCESS_KEY')) return 'antchain'
  if (has('FISCO_FRONT_URL', 'FISCO_CONTRACT_ADDRESS')) return 'fisco'
  if (has('GW_ENDPOINT')) return 'gateway'
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
    endpoint: E.CHAIN_ENDPOINT || '',
    account: E.CHAIN_ACCOUNT || '',
    keyConfigured: !!E.CHAIN_KEY,
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

/** 该链的提交结果是否需要后续确认（公链/EVM：txHash ≠ 已上链） */
export const needsConfirmation = () => !!active().capabilities.confirm

/** 核验一笔已提交的锚定交易：按批次提交时所用的链核验（切换当前链后，旧批次仍去旧链确认） */
export async function confirm(args) {
  const p = (args.provider && PROVIDERS[args.provider]) || active()
  if (!p.capabilities.confirm || typeof p.confirm !== 'function') return { final: true }
  return await p.confirm(args)
}

/** 发行链上资产（数字徽章 / 权益凭证 NFT / 藏品） */
export async function issueAsset(args) {
  const p = active()
  if (!p.capabilities.assets) throw new Error(`${p.label} 不支持资产发行（capabilities.assets=false）`)
  if (typeof p.issueAsset !== 'function') throw new Error(`${p.label} 未实现 issueAsset`)
  return await p.issueAsset(args)
}
