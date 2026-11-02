// 腾讯云 TBaaS / 至信链
// 签名：腾讯云 API 3.0 TC3-HMAC-SHA256（公开算法，按规范实现）
// 用法：通过你已部署的合约方法落根（默认写入 bytes32 root / bytes32 prevRoot / uint64 bizDate）
// 能力：存证锚定 ✅ · 资产发行 ✅（若你部署了 NFT / ERC-1155 合约）
//
// 注：不同客户开通的 TBaaS 版本 Action / FuncName 不同，函数名与参数全部可配，不写死。
//     对接时只需按控制台里真实的合约方法填 4 个 env 即可。
//
// 两种形态（按配置自动区分，默认仍是原来的 Fabric 形态）：
//   · Fabric 形态：配 TBAAS_CHANNEL，FuncParam 是数组 [root, prevRoot, bizDate]。
//   · 长安链形态：配 TBAAS_CHAIN_ID（+ TBAAS_CONTRACT），FuncParam 是 key/value 都是字符串的 JSON 对象，
//     由 TBAAS_PARAM_TEMPLATE 描述；Action/Version/地域按腾讯云文档填，例如长安链体验网络：
//     Action=InvokeChainMakerDemoContract · Version=2018-04-16 · Region=ap-beijing（见 config/chains/腾讯TBaaS.env）。
// 响应：交易号既可能在 Response.Txid（旧），也可能在 Response.Result.TxId（长安链）；
//       Result.Code 不为 0 即合约执行失败，不能当成功。
import { E } from './conf.mjs'
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

// 同一进程内所有 TBaaS 请求共用队列；失败也占用间隔，不自动重发写交易。
let requestQueue = Promise.resolve(), nextRequestAt = 0
function scheduled(fn) {
  const pending = requestQueue.then(async () => {
    await delay(Math.max(0, nextRequestAt - Date.now()))
    nextRequestAt = Date.now() + 1100
    return await fn()
  })
  requestQueue = pending.catch(() => {})
  return pending
}
const isDemo = () => env().action === 'InvokeChainMakerDemoContract' && !!env().chainId
const isFormal = () => env().action === 'InvokeChainMakerContract' && !!env().chainId

const env = () => ({
  secretId: E.TBAAS_SECRET_ID || '',
  secretKey: E.TBAAS_SECRET_KEY || '',
  endpoint: (E.TBAAS_ENDPOINT || 'https://tbaas.tencentcloudapi.com').replace(/\/+$/, ''),
  region: E.TBAAS_REGION || 'ap-shanghai',
  action: E.TBAAS_ACTION || 'Invoke',
  version: E.TBAAS_VERSION || '2020-04-17',
  clusterId: E.TBAAS_CLUSTER_ID || '',
  channel: E.TBAAS_CHANNEL || '',
  chainId: E.TBAAS_CHAIN_ID || '',
  contract: E.TBAAS_CONTRACT || '',
  paramTpl: E.TBAAS_PARAM_TEMPLATE || '',
  rootFunc: E.TBAAS_ROOT_FUNC || 'writeRoot',
  mintFunc: E.TBAAS_MINT_FUNC || '',
  nftContract: E.TBAAS_NFT_CONTRACT || '',
})

function missing() {
  const e = env()
  const m = []
  if (!e.secretId) m.push('TBAAS_SECRET_ID')
  if (!e.secretKey) m.push('TBAAS_SECRET_KEY')
  if (!e.clusterId) m.push('TBAAS_CLUSTER_ID')
  if (!e.channel && !e.chainId) m.push('TBAAS_CHANNEL 或 TBAAS_CHAIN_ID')
  if (isFormal()) {
    if (!e.contract) m.push('TBAAS_CONTRACT')
    if (e.channel) m.push('正式长安链不得配置 TBAAS_CHANNEL')
    if (e.version !== '2018-04-16') m.push('TBAAS_VERSION=2018-04-16')
    if (e.region !== 'ap-beijing') m.push('TBAAS_REGION=ap-beijing')
    if (e.rootFunc !== 'writeRoot') m.push('TBAAS_ROOT_FUNC=writeRoot')
    try {
      const p = JSON.parse(e.paramTpl)
      if (Object.keys(p).length !== 3 || p.root !== '{root}' || p.prevRoot !== '{prevRoot}' || p.bizDate !== '{bizDate}') throw 0
    } catch { m.push('TBAAS_PARAM_TEMPLATE（正式落根合约模板）') }
  }
  return m
}

/** 长安链形态：把模板渲染成 key/value 都是字符串的对象（占位符 {root} {prevRoot} {bizDate}） */
export function renderParamTemplate(tpl, vars) {
  const filled = tpl.replace(/\{(root|prevRoot|bizDate)\}/g, (_, k) => String(vars[k]))
  const obj = JSON.parse(filled)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('TBAAS_PARAM_TEMPLATE 必须是 JSON 对象')
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]))
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
async function call(payload, action) {
  return scheduled(() => request(payload, action))
}
async function request(payload, action) {
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
      'X-TC-Action': action || e.action,
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
  if (!json?.Response) throw new Error('tbaas 响应缺少 Response')
  if (!res.ok || r.Error) {
    throw new Error(`tbaas ${res.status}: ${(r.Error && (r.Error.Code + ' ' + r.Error.Message)) || text.slice(0, 160)}`)
  }
  // 长安链：交易号与执行结果在 Response.Result 里；Code 不为 0 是合约执行失败（HTTP 与 Response.Error 都正常）
  const result = r.Result && typeof r.Result === 'object' ? r.Result : null
  if (result && result.Code != null && Number(result.Code) !== 0) {
    throw new Error(`tbaas 合约执行失败: Code ${result.Code} ${result.CodeMessage || result.Message || ''}`.trim())
  }
  return r
}

const invoke = (funcName, params, contract) => {
  const e = env()
  return call({
    ClusterId: e.clusterId,
    ...(e.channel ? { ChannelId: e.channel } : {}),
    ...(e.chainId ? { ChainId: e.chainId } : {}),
    FuncName: funcName,
    FuncParam: JSON.stringify(params),
    ...(contract ? { ContractName: contract } : {}),
  })
}

export default {
  id: 'tbaas',
  label: '腾讯云 TBaaS / 至信链',
  docs: '需已部署落根合约（默认 writeRoot）；资产发行需另配 TBAAS_MINT_FUNC / TBAAS_NFT_CONTRACT',
  get capabilities() { return { anchor: true, queryByRoot: false, assets: true, did: false, confirm: isDemo() || isFormal() } },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({
    provider: 'tbaas', mode: missing().length ? 'noop' : 'real', missing: missing(),
    note: 'TC3-HMAC-SHA256 签名；落根通过你的合约方法完成',
    assets: env().mintFunc ? '可发行（已配 TBAAS_MINT_FUNC）' : '未配置发行方法',
  }),
  async anchor({ root, prevRoot, bizDate }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const e = env()
    const biz = Number(String(bizDate || '').replace(/-/g, '')) || 0
    const prev = prevRoot || '0'.repeat(64)
    // 配了入参模板 → 长安链形态（字符串键值对象）；否则保持原来的数组形态
    const params = e.paramTpl ? renderParamTemplate(e.paramTpl, { root, prevRoot: prev, bizDate: biz }) : [root, prev, biz]
    const r = await invoke(e.rootFunc, params, e.contract || undefined)
    const txRef = r.Txid || r.TxId || r.txid || r.transactionId || r.Result?.TxId || r.Result?.Txid
    if (!txRef) throw new Error('tbaas 响应缺少 Txid')
    return { txRef, block: String(r.BlockNumber ?? r.blockNumber ?? ''), mode: 'real' }
  },
  /** 体验网络按交易 ID 查询回执。正式长安链与 Fabric 不套用体验网络协议。 */
  async queryTransaction(txRef) {
    if (!isDemo() && !isFormal()) throw new Error('交易回查目前仅支持长安链网络')
    if (!/^[0-9a-f]{64}$/i.test(txRef || '')) throw new Error('交易 ID 必须是 64 位十六进制')
    const e = env()
    const r = await call({ ClusterId: e.clusterId, ChainId: e.chainId, TxID: txRef }, isDemo() ? 'QueryChainMakerDemoTransaction' : 'QueryChainMakerTransaction')
    const receipt = r.Result
    if (!receipt || typeof receipt !== 'object' || receipt.Code == null) throw new Error('tbaas 交易回执缺少结果码')
    if (receipt.TxId !== txRef) throw new Error('tbaas 回执交易号不一致')
    return { txRef, block: receipt.BlockHeight, code: Number(receipt.Code), requestId: r.RequestId }
  },
  async confirm({ txRef, root, prevRoot, bizDate }) {
    const r = await this.queryTransaction(txRef)
    if (!Number.isSafeInteger(r.block) || r.block < 0) throw new Error('tbaas 回执区块高度无效')
    if (r.block === 0) return { final: false, reason: '等待出块', confirmations: 0 }
    if (isFormal()) {
      if (!root || !bizDate) throw new Error('正式网络确认需要批次根与业务日期')
      const e = env()
      const result = await call({ ClusterId: e.clusterId, ChainId: e.chainId, ContractName: e.contract,
        FuncName: 'readRoot', FuncParam: JSON.stringify({ root }) }, 'QueryChainMakerContract')
      if (result.Result?.Code !== 0 || typeof result.Result.Result !== 'string') throw new Error('落根合约读回格式无效')
      let record
      try { record = JSON.parse(Buffer.from(result.Result.Result, 'base64').toString('utf8')) } catch { throw new Error('落根合约读回不是有效 JSON') }
      const expectedDate = String(bizDate).slice(0, 10).replaceAll('-', '')
      if (record.root !== root || record.txId !== txRef || record.prevRoot !== (prevRoot || '0'.repeat(64)) || record.bizDate !== expectedDate) throw new Error('落根合约记录与批次或交易不一致')
    }
    return { final: true, block: String(r.block), confirmations: 1 }
  },
  /** 仅体验合约的 get；读回值不能作为该交易携带根的密码学证明。 */
  async readDemoValue(key, field) {
    if (!isDemo()) throw new Error('合约读回目前仅支持长安链体验网络')
    const e = env()
    const r = await call({ ClusterId: e.clusterId, ChainId: e.chainId, ContractName: e.contract,
      FuncName: 'get', FuncParam: JSON.stringify({ key: String(key), field: String(field) }) }, 'QueryChainMakerDemoContract')
    if (r.Result?.Code !== 0 || typeof r.Result.Result !== 'string') throw new Error('tbaas 查询结果格式无效')
    return { value: Buffer.from(r.Result.Result, 'base64').toString('utf8'), requestId: r.RequestId }
  },
  async probe() {
    if (!isDemo()) throw new Error('只读探测目前仅支持长安链体验网络')
    const r = await this.readDemoValue('wenlv-test-001', 'ticket_status')
    return { ok: true, detail: '体验网络只读查询成功，RequestId=' + r.requestId }
  },
  // TBaaS 没有"按根反查"的标准接口；幂等以本地 台账 + 上游 txRef 为准
  async queryByRoot() { return null },
  async issueAsset({ to, tokenId, uri, amount = 1 }) {
    const e = env()
    if (!e.mintFunc) throw new Error('TBaaS 未配置发行方法（TBAAS_MINT_FUNC）')
    const r = await invoke(e.mintFunc, [to, tokenId, amount, uri || ''], e.nftContract || undefined)
    const txRef = r.Txid || r.TxId || r.txid || r.transactionId || r.Result?.TxId || r.Result?.Txid
    if (!txRef) throw new Error('tbaas 响应缺少 Txid')
    return { txRef, contract: e.nftContract || null, tokenId, to }
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
