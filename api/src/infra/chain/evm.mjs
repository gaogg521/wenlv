// 通用 EVM 链（Polygon / Base / BNB / 自建联盟 EVM）
//
// 两种模式，按你有没有自己的签名设施分：
//   A. 托管签名（推荐）：EVM_RELAYER_URL + EVM_RELAYER_TOKEN → POST {to,data,value} → {txHash}
//      适合企业已有 KMS / Fireblocks / Turnkey / 自建 relayer 的情况；私钥不进本服务。
//   B. 只读校验：EVM_RPC_URL 用于 eth_getTransactionReceipt / eth_call 校验
//
// 存证做法：把 32 字节 Merkle 根直接写进交易 input data（data = 0x + root），
//          任何区块浏览器都能看到该根，无需部署合约即可起步。
// 资产做法：ERC-1155 mint（需 relayer 已托管有 mint 权限的账户）。
//          calldata 用 src/infra/abi.mjs 真编码（含 4 字节选择器），签名可用 EVM_MINT_SIGNATURE 校准。
import { E } from './conf.mjs'
import { encodeCall, selectorOf, selfTest as abiSelfTest } from '../abi.mjs'

// 网络预置：选网络后 chainId / 浏览器 / 默认确认数自动带出（仍可用对应变量单独覆盖）
export const NETWORKS = {
  ethereum: { label: 'Ethereum 主网', chainId: 1, explorer: 'https://etherscan.io/tx/', confirmations: 12 },
  polygon: { label: 'Polygon PoS', chainId: 137, explorer: 'https://polygonscan.com/tx/', confirmations: 64 },
  base: { label: 'Base', chainId: 8453, explorer: 'https://basescan.org/tx/', confirmations: 12 },
  bnb: { label: 'BNB Smart Chain', chainId: 56, explorer: 'https://bscscan.com/tx/', confirmations: 15 },
  arbitrum: { label: 'Arbitrum One', chainId: 42161, explorer: 'https://arbiscan.io/tx/', confirmations: 12 },
  optimism: { label: 'OP Mainnet', chainId: 10, explorer: 'https://optimistic.etherscan.io/tx/', confirmations: 12 },
  conflux: { label: 'Conflux eSpace（树图·国内合规公链）', chainId: 1030, explorer: 'https://evm.confluxscan.io/tx/', confirmations: 50 },
  sepolia: { label: 'Sepolia 测试网', chainId: 11155111, explorer: 'https://sepolia.etherscan.io/tx/', confirmations: 3 },
  amoy: { label: 'Polygon Amoy 测试网', chainId: 80002, explorer: 'https://amoy.polygonscan.com/tx/', confirmations: 3 },
}
const net = () => NETWORKS[(E.EVM_NETWORK || '').toLowerCase()] || null

const env = () => ({
  relayer: (E.EVM_RELAYER_URL || '').replace(/\/+$/, ''),
  token: E.EVM_RELAYER_TOKEN || '',
  rpc: (E.EVM_RPC_URL || '').replace(/\/+$/, ''),
  chainId: E.EVM_CHAIN_ID || (net() ? String(net().chainId) : ''),
  contract: E.EVM_NFT_CONTRACT || '',      // ERC-1155 合约地址（资产发行用）
  to: E.EVM_ANCHOR_TO || '',              // 落根交易的目标地址（可以是自己的地址）
  explorer: (E.EVM_EXPLORER || (net() ? net().explorer : '')).replace(/\/+$/, '/'), // 例：https://polygonscan.com/tx/
  mintSig: E.EVM_MINT_SIGNATURE || 'mint(address,uint256,uint256,bytes)',
  confirmations: Math.max(1, Number(E.EVM_CONFIRMATIONS || (net() ? net().confirmations : 12))),
})

function missing() {
  const e = env()
  const m = []
  if (!e.relayer) m.push('EVM_RELAYER_URL')
  if (!e.token) m.push('EVM_RELAYER_TOKEN')
  // 没有 RPC 就无法核验回执与确认数：只能"发出去"，不能"证明上了链"，因此不算真实接入
  if (!e.rpc) m.push('EVM_RPC_URL')
  if (!e.to) m.push('EVM_ANCHOR_TO')
  return m
}

let rpcId = 0
async function rpc(method, params) {
  const e = env()
  const res = await fetch(e.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  const j = await res.json().catch(() => null)
  if (!res.ok || !j) throw new Error(`evm rpc ${method} HTTP ${res.status}`)
  if (j.error) throw new Error(`evm rpc ${method}: ${j.error.message || JSON.stringify(j.error)}`)
  return j.result
}

async function relay({ to, data, asset }) {
  const e = env()
  const res = await fetch(e.relayer + '/tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + e.token },
    body: JSON.stringify({ chainId: e.chainId, to, data, asset: asset || null }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`evm relayer ${res.status}: ${text.slice(0, 160)}`)
  const txHash = json?.txHash || json?.hash || json?.transactionHash || ''
  if (!txHash) throw new Error('evm relayer 响应缺少 txHash')
  return { txRef: txHash, block: String(json.blockNumber ?? ''), explorer: e.explorer ? e.explorer + txHash : null }
}

export default {
  id: 'evm',
  label: '通用 EVM 链（Polygon / Base / BNB / 自建）',
  docs: '需托管签名服务（relayer）。存证把 Merkle 根写进交易 input data；资产用 ERC-1155',
  capabilities: { anchor: true, queryByRoot: false, assets: true, did: true, confirm: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({
    provider: 'evm', mode: missing().length ? 'noop' : 'real', missing: missing(),
    note: `私钥不进入本服务：由 relayer/KMS 托管签名；回执成功且 ≥${env().confirmations} 个确认、交易内容等于 Merkle 根才记为已锚定`,
    chainId: env().chainId || '未配置',
    assets: env().contract ? '可发行（ERC-1155）' : '未配 NFT 合约',
  }),
  async anchor({ root }) {
    const e = env()
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    if (!e.to) throw new Error('EVM 未配置 EVM_ANCHOR_TO（落根交易的目标地址）')
    if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('EVM 存证要求 root 为 32 字节 hex')
    return await relay({ to: e.to, data: '0x' + root })
  },
  /**
   * 核验：①交易存在且 input 正是 0x+root、目标地址一致 ②回执 status=0x1 ③确认数达标
   * 不满足①②抛错（本次提交作废、可重试）；只差③返回 final=false 继续等
   */
  async confirm({ txRef, root }) {
    const e = env()
    if (!e.rpc) return { final: false, reason: '未配置 EVM_RPC_URL，无法核验回执' }
    const txn = await rpc('eth_getTransactionByHash', [txRef])
    if (!txn) return { final: false, confirmations: 0, reason: '交易尚未被节点看到（可能仍在内存池）' }
    if (String(txn.input || '').toLowerCase() !== '0x' + root) throw new Error('链上交易内容与 Merkle 根不一致')
    if (e.to && String(txn.to || '').toLowerCase() !== e.to.toLowerCase()) throw new Error('链上交易目标地址与 EVM_ANCHOR_TO 不一致')
    if (e.chainId && txn.chainId && BigInt(txn.chainId) !== BigInt(e.chainId)) throw new Error('链上交易 chainId 与 EVM_CHAIN_ID 不一致')
    const rc = await rpc('eth_getTransactionReceipt', [txRef])
    if (!rc || !rc.blockNumber) return { final: false, confirmations: 0, reason: '等待打包进块' }
    if (rc.status !== '0x1') throw new Error('链上交易执行失败（receipt.status=' + rc.status + '）')
    const head = BigInt(await rpc('eth_blockNumber', []))
    const block = BigInt(rc.blockNumber)
    const confirmations = Number(head - block + 1n)
    if (confirmations < e.confirmations) return { final: false, block: String(block), confirmations, reason: `确认数 ${confirmations}/${e.confirmations}` }
    return { final: true, block: String(block), confirmations }
  },
  async queryByRoot() { return null }, // 反查需索引器；以本地台账 + 浏览器为准
  /** 连通性探测（只读）：RPC 可达、chainId 与配置一致、当前块高 */
  async probe() {
    const e = env()
    if (!e.rpc) throw new Error('未配置 EVM_RPC_URL')
    const t0 = Date.now()
    const id = BigInt(await rpc('eth_chainId', []))
    const head = BigInt(await rpc('eth_blockNumber', []))
    if (e.chainId && BigInt(e.chainId) !== id) throw new Error(`RPC 返回 chainId=${id}，与配置 ${e.chainId} 不一致（可能接错网络）`)
    return { ok: true, detail: `chainId ${id} · 块高 ${head} · ${Date.now() - t0}ms` }
  },
  async issueAsset({ to, tokenId, amount = 1, uri }) {
    const e = env()
    if (!e.contract) throw new Error('EVM 未配置 NFT 合约（EVM_NFT_CONTRACT）')
    // 真 ABI 编码：selector(mint(address,uint256,uint256,bytes)) + to + tokenId + amount + bytes(空)
    // 若你的合约方法签名不同（如 safeTransferFrom），改 EVM_MINT_SIGNATURE 即可，无需改代码
    const data = '0x' + encodeCall(e.mintSig, [to, tokenId, amount, '0x']).toString('hex')
    return await relay({ to: e.contract, data, asset: { standard: 'ERC-1155', to, tokenId, amount, uri: uri || null } })
  },
  /** 离线自检：keccak/ABI 编码可用性 + 落根数据格式（不需要任何凭据） */
  selfTest() {
    const abi = abiSelfTest()
    const sig = env().mintSig
    let mint = { ok: false, detail: '编码失败' }
    try {
      const cd = encodeCall(sig, ['0x' + '11'.repeat(20), 1, 1, '0x'])
      mint = { ok: cd.length > 4, detail: `${sig} → ${selectorOf(sig)}，${cd.length} 字节` }
    } catch (err) { mint = { ok: false, detail: String(err.message) } }
    return {
      ok: abi.ok && mint.ok,
      detail: { keccak: abi.detail, mintCalldata: mint.detail, anchorData: '0x+32字节root 无需编码' },
    }
  },
}
