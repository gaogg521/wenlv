import { E } from './conf.mjs'
// FISCO BCOS（微众银行开源联盟链，政务/金融联盟链常用底座）
//
// 接入方式：WeBASE-Front 的交易处理接口（官方组件，REST）
//   POST {FISCO_FRONT_URL}/WeBASE-Front/trans/handle
//     { groupId, user, contractName, contractAddress, funcName, funcParam, contractAbi }
//   → { transactionHash, blockNumber, status: "0x0", ... }
// 回执：GET {FISCO_FRONT_URL}/WeBASE-Front/{groupId}/web3/transactionReceipt/{txHash}
//
// 落根合约（对方链上部署一次即可，ABI 与下面 ROOT_ABI 一致）：
//   function writeRoot(bytes32 root, bytes32 prevRoot, uint64 bizDate) public
// PBFT 共识出块即终局：回执 status=0x0 即可视为已锚定；仍走"提交→核验回执"两步，与公链保持同一套状态机。
//
// 注意：WeBASE-Front 默认部署在内网、无鉴权；若对方在前面加了网关鉴权，填 FISCO_AUTH_HEADER（如 "Authorization: Bearer xxx"）。

const env = () => ({
  front: (E.FISCO_FRONT_URL || '').replace(/\/+$/, ''),
  group: E.FISCO_GROUP_ID || 'group0',               // 3.x 为 group0；2.x 为 1
  user: E.FISCO_USER || '',                            // WeBASE 私钥用户地址或 signUserId
  contract: E.FISCO_CONTRACT_ADDRESS || '',
  contractName: E.FISCO_CONTRACT_NAME || 'RootAnchor',
  func: E.FISCO_ROOT_FUNC || 'writeRoot',
  auth: E.FISCO_AUTH_HEADER || '',
})
const ROOT_ABI = [{ constant: false, inputs: [{ name: 'root', type: 'bytes32' }, { name: 'prevRoot', type: 'bytes32' }, { name: 'bizDate', type: 'uint64' }],
  name: 'writeRoot', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' }]

function missing() {
  const e = env(), m = []
  if (!e.front) m.push('FISCO_FRONT_URL')
  if (!e.user) m.push('FISCO_USER')
  if (!e.contract) m.push('FISCO_CONTRACT_ADDRESS')
  return m
}
async function http(method, path, body) {
  const e = env()
  const headers = { 'content-type': 'application/json' }
  if (e.auth && e.auth.includes(':')) headers[e.auth.split(':')[0].trim()] = e.auth.slice(e.auth.indexOf(':') + 1).trim()
  const res = await fetch(e.front + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) })
  const text = await res.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`fisco ${res.status}: ${text.slice(0, 160)}`)
  if (j && j.code && j.code !== 0 && !j.transactionHash) throw new Error(`fisco ${j.code}: ${j.message || j.errorMessage || ''}`)
  return j || {}
}
const b32 = (h) => '0x' + String(h || '').padStart(64, '0').slice(-64)
const dateNum = (d) => Number(String(d || '').slice(0, 10).replaceAll('-', '')) || 0

export default {
  id: 'fisco',
  label: 'FISCO BCOS（微众银行联盟链）',
  docs: '通过 WeBASE-Front REST 调用落根合约 writeRoot(bytes32,bytes32,uint64)；PBFT 出块即终局',
  capabilities: { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({ provider: 'fisco', mode: missing().length ? 'noop' : 'real', missing: missing(), note: '需对方先部署落根合约并提供 WeBASE-Front 地址与签名用户' }),
  async anchor({ root, prevRoot, bizDate }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const e = env()
    const r = await http('POST', '/WeBASE-Front/trans/handle', {
      groupId: e.group, user: e.user, contractName: e.contractName, contractAddress: e.contract,
      funcName: e.func, funcParam: [b32(root), b32(prevRoot || ''), dateNum(bizDate)], contractAbi: ROOT_ABI,
    })
    const txRef = r.transactionHash || r.txHash
    if (!txRef) throw new Error('fisco 响应缺少 transactionHash')
    if (r.status && r.status !== '0x0') throw new Error('fisco 交易执行失败 status=' + r.status)
    return { txRef, block: r.blockNumber != null ? String(parseInt(r.blockNumber, 16) || r.blockNumber) : null, mode: 'real' }
  },
  async confirm({ txRef }) {
    const e = env()
    const r = await http('GET', `/WeBASE-Front/${encodeURIComponent(e.group)}/web3/transactionReceipt/${encodeURIComponent(txRef)}`)
    if (!r || !r.blockNumber) return { final: false, reason: '等待出块' }
    if (r.status && r.status !== '0x0') throw new Error('fisco 回执失败 status=' + r.status)
    return { final: true, block: String(parseInt(r.blockNumber, 16) || r.blockNumber), confirmations: 1 }
  },
  async queryByRoot() { return null },
  /** 连通性探测：只读，查块高，不产生交易 */
  async probe() {
    const e = env()
    if (!e.front) throw new Error('未配置 FISCO_FRONT_URL')
    const r = await http('GET', `/WeBASE-Front/${encodeURIComponent(e.group)}/web3/blockNumber`)
    return { ok: true, detail: '当前块高 ' + (typeof r === 'object' ? JSON.stringify(r).slice(0, 40) : r) }
  },
  selfTest() {
    const p = [b32('ab'.repeat(32)), b32(''), dateNum('2026-11-02')]
    return { ok: p[0].length === 66 && p[1].length === 66 && p[2] === 20261102, detail: { funcParam: p.map(String).map((x) => x.slice(0, 18) + '…'), abi: 'writeRoot(bytes32,bytes32,uint64)' } }
  },
}
