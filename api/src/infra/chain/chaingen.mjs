// 链数根（上海数据集团）联盟链存证
// 契约：POST /v1/attest/anchor 提交 Merkle 根 → 返回 txRef；GET /v1/attest/root/{root} 幂等查重
// 签名：HMAC-SHA256(key, `${METHOD}\n${PATH}\n${ts}\n${rawBody}`) → x-signature
// 能力：只做存证锚定（联盟链不对个人发资产），不支持 NFT 发行
import crypto from 'node:crypto'

const env = () => ({
  endpoint: (process.env.CHAIN_ENDPOINT || '').replace(/\/+$/, ''),
  account: process.env.CHAIN_ACCOUNT || '',
  key: process.env.CHAIN_KEY || '',
})

function missing() {
  const e = env()
  const m = []
  if (!e.endpoint) m.push('CHAIN_ENDPOINT')
  if (!e.account) m.push('CHAIN_ACCOUNT')
  if (!e.key) m.push('CHAIN_KEY')
  return m
}

async function call(method, path, body) {
  const e = env()
  const ts = Date.now().toString()
  const raw = body ? JSON.stringify(body) : ''
  const sig = crypto.createHmac('sha256', e.key).update([method, path, ts, raw].join('\n')).digest('hex')
  const res = await fetch(e.endpoint + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-account': e.account, 'x-timestamp': ts, 'x-signature': sig },
    body: raw || undefined,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`chaingen ${res.status}: ${text.slice(0, 160)}`)
  return json || {}
}

export default {
  id: 'chaingen',
  label: '链数根（上海数据集团 · 联盟链）',
  docs: '文旅票根/一网可信场景；只做存证锚定，不对个人发行资产',
  capabilities: { anchor: true, queryByRoot: true, assets: false, did: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({ provider: 'chaingen', mode: missing().length ? 'noop' : 'real', missing: missing(), note: '需三项凭据齐备才真实上链' }),
  async anchor({ root, prevRoot, leafCount, bizDate, merkleKind }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const r = await call('POST', '/v1/attest/anchor', {
      root, prevRoot: prevRoot || null, leafCount, bizDate, kind: merkleKind || 'mixed',
    })
    const txRef = r.txRef || r.tx_hash || r.transactionHash || ''
    if (!txRef) throw new Error('chaingen 响应缺少 txRef')
    return { txRef, block: String(r.blockHeight ?? r.block ?? ''), mode: 'real' }
  },
  async queryByRoot(root) {
    if (missing().length) return null
    const r = await call('GET', `/v1/attest/root/${encodeURIComponent(root)}`)
    if (!r || !r.found) return null
    return { txRef: r.txRef, block: String(r.blockHeight ?? '') }
  },
  /** 离线自检：用假密钥走一遍签名，不联网、不需要凭据 */
  selfTest() {
    const sig = crypto.createHmac('sha256', 'dummy-key').update(['POST', '/v1/attest/anchor', '1700000000000', '{"root":"x"}'].join('\n')).digest('hex')
    return {
      ok: /^[0-9a-f]{64}$/.test(sig),
      detail: { signAlgo: 'HMAC-SHA256(METHOD\\nPATH\\nts\\nbody)', sample: sig.slice(0, 16) + '…', headers: 'x-account / x-timestamp / x-signature' },
    }
  },
}
