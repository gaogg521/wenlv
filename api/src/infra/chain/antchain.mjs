// 蚂蚁链 AntChain（含鲸探数字藏品对接位）
//
// 两种典型用法，本适配器都留了口子：
//   1) 存证：把 Merkle 根写入你的合约/存证服务（ANTCHAIN_ROOT_METHOD）
//   2) 藏品/徽章：走鲸探或蚂蚁链数字资产服务。注意——鲸探发行需要**资质 + 内容审核 + 服务商接入**，
//      不是纯技术接口；所以这里只做"协议位"，配好凭据与集合 ID 才允许发行。
//
// 签名：AntChain OpenAPI 常见两种，本适配器按 ANTCHAIN_SIGN 切换（hmac-sha256 / rsa-sha256）。
//      字段名与签名串以对方最新文档为准 —— 这一行是刻意留的：不同版本 OpenAPI 字段会变，
//      写死反而更难对接。
import crypto from 'node:crypto'

const env = () => ({
  endpoint: (process.env.ANTCHAIN_ENDPOINT || '').replace(/\/+$/, ''),
  accessKey: process.env.ANTCHAIN_ACCESS_KEY || '',
  accessSecret: process.env.ANTCHAIN_ACCESS_SECRET || '',
  privateKey: process.env.ANTCHAIN_PRIVATE_KEY || '',       // rsa 模式：PEM
  sign: (process.env.ANTCHAIN_SIGN || 'hmac-sha256').toLowerCase(),
  bizId: process.env.ANTCHAIN_BIZID || '',
  account: process.env.ANTCHAIN_ACCOUNT || '',
  collectionId: process.env.ANTCHAIN_COLLECTION_ID || '',   // 鲸探/数字资产集合 ID
  rootPath: process.env.ANTCHAIN_ROOT_PATH || '/v1/attest/anchor',
  assetPath: process.env.ANTCHAIN_ASSET_PATH || '/v1/asset/issue',
})

function missing() {
  const e = env()
  const m = []
  if (!e.endpoint) m.push('ANTCHAIN_ENDPOINT')
  if (!e.accessKey) m.push('ANTCHAIN_ACCESS_KEY')
  if (e.sign === 'rsa-sha256' ? !e.privateKey : !e.accessSecret) m.push(e.sign === 'rsa-sha256' ? 'ANTCHAIN_PRIVATE_KEY' : 'ANTCHAIN_ACCESS_SECRET')
  if (!e.bizId) m.push('ANTCHAIN_BIZID')
  return m
}

function signHeaders(method, path, body) {
  const e = env()
  const ts = Date.now().toString()
  const payload = [method, path, ts, body || ''].join('\n')
  const signature = e.sign === 'rsa-sha256'
    ? crypto.createSign('RSA-SHA256').update(payload).sign(e.privateKey, 'base64')
    : crypto.createHmac('sha256', e.accessSecret).update(payload).digest('base64')
  return {
    'content-type': 'application/json',
    'x-acs-signature-method': e.sign,
    'x-acs-signature-nonce': crypto.randomBytes(8).toString('hex'),
    'x-acs-version': process.env.ANTCHAIN_VERSION || '1.0',
    'x-acs-accesskey': e.accessKey,
    'x-acs-timestamp': ts,
    'x-acs-signature': signature,
    'x-acs-bizid': e.bizId,
  }
}

async function call(method, path, body) {
  const e = env()
  const raw = body ? JSON.stringify(body) : ''
  const res = await fetch(e.endpoint + path, { method, headers: signHeaders(method, path, raw), body: raw || undefined, signal: AbortSignal.timeout(15_000) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`antchain ${res.status}: ${text.slice(0, 160)}`)
  if (json && json.success === false) throw new Error(`antchain: ${json.code || ''} ${json.message || ''}`)
  return json || {}
}

export default {
  id: 'antchain',
  label: '蚂蚁链 AntChain / 鲸探',
  docs: '存证走合约/存证服务；藏品与徽章走数字资产服务（鲸探需资质+内容审核+服务商接入）',
  capabilities: { anchor: true, queryByRoot: false, assets: true, did: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({
    provider: 'antchain', mode: missing().length ? 'noop' : 'real', missing: missing(),
    note: `签名方式 ${env().sign}；藏品发行需 ${env().collectionId ? '已配集合' : '未配 ANTCHAIN_COLLECTION_ID'}`,
  }),
  async anchor({ root, prevRoot, leafCount, bizDate, merkleKind }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const r = await call('POST', env().rootPath, {
      root, prevRoot: prevRoot || null, leafCount, bizDate, kind: merkleKind || 'mixed',
    })
    const txRef = r.txHash || r.txRef || r.transactionHash || ''
    if (!txRef) throw new Error('antchain 响应缺少 txHash')
    return { txRef, block: String(r.blockNumber ?? ''), mode: 'real' }
  },
  async queryByRoot() { return null },
  async issueAsset({ to, tokenId, uri, meta }) {
    const e = env()
    if (!e.collectionId) throw new Error('蚂蚁链未配置数字资产集合（ANTCHAIN_COLLECTION_ID）')
    const r = await call('POST', e.assetPath, {
      collectionId: e.collectionId, to: to || e.account, tokenId, uri: uri || null, meta: meta || null,
    })
    return { txRef: r.txHash || r.txRef || null, contract: e.collectionId, tokenId, to: to || e.account }
  },
  /** 离线自检：HMAC 签名与请求头齐备性（假密钥，不联网） */
  selfTest() {
    const sig = crypto.createHmac('sha256', 'dummy-secret').update(['POST', '/v1/attest/anchor', '1700000000000', '{}'].join('\n')).digest('base64')
    const h = signHeaders('POST', '/v1/attest/anchor', '{}')
    const need = ['x-acs-signature-method', 'x-acs-signature-nonce', 'x-acs-accesskey', 'x-acs-timestamp', 'x-acs-signature', 'x-acs-bizid']
    const absent = need.filter((k) => !(k in h))
    return {
      ok: !!sig && absent.length === 0,
      detail: { signAlgo: env().sign, headersMissing: absent, note: env().sign === 'rsa-sha256' ? '需 ANTCHAIN_PRIVATE_KEY(PEM)' : '需 ANTCHAIN_ACCESS_SECRET' },
    }
  },
}
