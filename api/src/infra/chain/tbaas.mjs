// 腾讯云 TBaaS / 至信链
// 签名：腾讯云 API 3.0 TC3-HMAC-SHA256（公开算法，按规范实现）
// 用法：通过你已部署的合约方法落根（默认写入 bytes32 root / bytes32 prevRoot / uint64 bizDate）
// 能力：存证锚定 ✅ · 资产发行 ✅（若你部署了 NFT / ERC-1155 合约）
//
// 注：不同客户开通的 TBaaS 版本 Action / FuncName 不同，函数名与参数全部可配，不写死。
//     对接时只需按控制台里真实的合约方法填 4 个 env 即可。
import crypto from 'node:crypto'

const env = () => ({
  secretId: process.env.TBAAS_SECRET_ID || '',
  secretKey: process.env.TBAAS_SECRET_KEY || '',
  endpoint: (process.env.TBAAS_ENDPOINT || 'https://tbaas.tencentcloudapi.com').replace(/\/+$/, ''),
  region: process.env.TBAAS_REGION || 'ap-shanghai',
  action: process.env.TBAAS_ACTION || 'Invoke',
  version: process.env.TBAAS_VERSION || '2020-04-17',
  clusterId: process.env.TBAAS_CLUSTER_ID || '',
  channel: process.env.TBAAS_CHANNEL || '',
  rootFunc: process.env.TBAAS_ROOT_FUNC || 'writeRoot',
  mintFunc: process.env.TBAAS_MINT_FUNC || '',
  nftContract: process.env.TBAAS_NFT_CONTRACT || '',
})

function missing() {
  const e = env()
  const m = []
  if (!e.secretId) m.push('TBAAS_SECRET_ID')
  if (!e.secretKey) m.push('TBAAS_SECRET_KEY')
  if (!e.clusterId) m.push('TBAAS_CLUSTER_ID')
  if (!e.channel) m.push('TBAAS_CHANNEL')
  return m
}

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex')
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest()

/** 腾讯云 API 3.0 TC3-HMAC-SHA256 签名（纯计算，不联网；抽出以便离线自测） */
function tc3Sign({ secretId, secretKey, host, body, ts }) {
  const date = new Date(ts * 1000).toISOString().slice(0, 10)
  const service = 'tbaas'
  const canonicalRequest = [
    'POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    sha256hex(body),
  ].join('\n')
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), `${date}/${service}/tc3_request`, sha256hex(canonicalRequest)].join('\n')
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  return {
    date, signature,
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
  }
}

/** 腾讯云 API 3.0 签名调用 */
async function call(payload) {
  const e = env()
  const host = new URL(e.endpoint).host
  const body = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const { authorization } = tc3Sign({ secretId: e.secretId, secretKey: e.secretKey, host, body, ts })

  const res = await fetch(e.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': e.action,
      'X-TC-Version': e.version,
      'X-TC-Timestamp': String(ts),
      'X-TC-Region': e.region,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  const r = json?.Response || {}
  if (!res.ok || r.Error) {
    throw new Error(`tbaas ${res.status}: ${(r.Error && (r.Error.Code + ' ' + r.Error.Message)) || text.slice(0, 160)}`)
  }
  const txRef = r.Txid || r.TxId || r.txid || r.transactionId || ''
  if (!txRef) throw new Error('tbaas 响应缺少 Txid')
  return { txRef, block: String(r.BlockNumber ?? r.blockNumber ?? ''), raw: r }
}

const invoke = (funcName, params, contract) => call({
  ClusterId: env().clusterId,
  ChannelId: env().channel,
  FuncName: funcName,
  FuncParam: JSON.stringify(params),
  ...(contract ? { ContractName: contract } : {}),
})

export default {
  id: 'tbaas',
  label: '腾讯云 TBaaS / 至信链',
  docs: '需已部署落根合约（默认 writeRoot）；资产发行需另配 TBAAS_MINT_FUNC / TBAAS_NFT_CONTRACT',
  capabilities: { anchor: true, queryByRoot: false, assets: true, did: false },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({
    provider: 'tbaas', mode: missing().length ? 'noop' : 'real', missing: missing(),
    note: 'TC3-HMAC-SHA256 签名；落根通过你的合约方法完成',
    assets: env().mintFunc ? '可发行（已配 TBAAS_MINT_FUNC）' : '未配置发行方法',
  }),
  async anchor({ root, prevRoot, bizDate }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const biz = Number(String(bizDate || '').replace(/-/g, '')) || 0
    const r = await invoke(env().rootFunc, [root, prevRoot || '0'.repeat(64), biz])
    return { txRef: r.txRef, block: r.block, mode: 'real' }
  },
  // TBaaS 没有"按根反查"的标准接口；幂等以本地 台账 + 上游 txRef 为准
  async queryByRoot() { return null },
  async issueAsset({ to, tokenId, uri, amount = 1 }) {
    const e = env()
    if (!e.mintFunc) throw new Error('TBaaS 未配置发行方法（TBAAS_MINT_FUNC）')
    const r = await invoke(e.mintFunc, [to, tokenId, amount, uri || ''], e.nftContract || undefined)
    return { txRef: r.txRef, contract: e.nftContract || null, tokenId, to }
  },
  /** 离线自检：TC3 签名可算出且确定性（同输入同结果），不需要真实密钥 */
  selfTest() {
    const a = tc3Sign({ secretId: 'AKIDdummy', secretKey: 'dummy-secret', host: 'tbaas.tencentcloudapi.com', body: '{"x":1}', ts: 1700000000 })
    const b = tc3Sign({ secretId: 'AKIDdummy', secretKey: 'dummy-secret', host: 'tbaas.tencentcloudapi.com', body: '{"x":1}', ts: 1700000000 })
    return {
      ok: /^[0-9a-f]{64}$/.test(a.signature) && a.signature === b.signature,
      detail: { signAlgo: 'TC3-HMAC-SHA256', deterministic: a.signature === b.signature, sample: a.signature.slice(0, 16) + '…', action: env().action, version: env().version },
    }
  },
}
