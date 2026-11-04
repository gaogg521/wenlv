// 蚂蚁链开放联盟链（antdigital.com/docs/11 · 蚂蚁链开放联盟链 · HTTP 方式接入）
//
// 注意：这和 antchain.mjs（蚂蚁链 OpenAPI / 鲸探数字资产）不是同一个产品，接口完全不同，不要混用。
// 本适配器按 2026-11-04 在真实开放联盟链上「握手 → DEPOSIT 存证 → QUERYTRANSACTION 读回」实测通过的形态实现。
//
// 流程：
//   1. 握手 POST {rest}/api/contract/shakeHand  { accessId, time, secret }
//        secret = Hex( SHA256withRSA( accessId + 13位毫秒时间戳 ) )，私钥是控制台下载的 access.key（PKCS8）
//        返回 { success, code:'200', data: token }，token 有效期 30 分钟（本适配器缓存 25 分钟）
//   2. 存证 POST {rest}/api/contract/chainCallForBiz  method=DEPOSIT
//        { orderId, bizid, account, content, mykmsKeyId, accessId, token, gas, tenantid } → data = 交易哈希（64 位 hex）
//   3. 回查 POST {rest}/api/contract/chainCall  method=QUERYTRANSACTION { bizid, hash, accessId, token }
//        → { blockNumber, hash, transactionDO: { data(base64 = 存证内容), timestamp } }；未上链返回 code 404
//   4. 探测 method=QUERYLASTBLOCK（只读，不产生交易）
//
// 限制（实测/文档）：
//   · HTTP 方式只支持「密钥托管账户」；账户必须先在控制台「燃料管理」里分配燃料，否则一律 204 account config invalid
//   · tenantid 不是文档里的 mytenant；取该账号控制台地址 projectName 参数（本账号为 QPPTAUFA）
//   · 免费版 TPS=1，本适配器串行发请求并留 1.1 秒间隔
//   · DEPOSIT 没有交易回执（QUERYRECEIPT 返回 211），确认只能靠 QUERYTRANSACTION 核对内容
//   · 开放联盟链是共享公开链：content 明文可见，只放 Merkle 根与业务日（铁律：不含个人信息）
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { E } from './conf.mjs'

const env = () => ({
  rest: (E.ANTOPEN_REST_URL || 'https://rest.baas.alipay.com').replace(/\/+$/, ''),
  accessId: E.ANTOPEN_ACCESS_ID || '',
  accessKey: E.ANTOPEN_ACCESS_KEY || '',
  account: E.ANTOPEN_ACCOUNT || '',
  kmsId: E.ANTOPEN_KMS_ID || '',
  tenant: E.ANTOPEN_TENANT_ID || '',
  bizid: E.ANTOPEN_BIZID || 'a00e36c5',
  gas: Number(E.ANTOPEN_GAS) > 0 ? Number(E.ANTOPEN_GAS) : 50000,
  gapMs: E.ANTOPEN_MIN_INTERVAL_MS != null && E.ANTOPEN_MIN_INTERVAL_MS !== '' ? Number(E.ANTOPEN_MIN_INTERVAL_MS) : 1100,
})

function missing() {
  const e = env(), m = []
  if (!e.accessId) m.push('ANTOPEN_ACCESS_ID')
  if (!e.accessKey) m.push('ANTOPEN_ACCESS_KEY')
  if (!e.account) m.push('ANTOPEN_ACCOUNT')
  if (!e.kmsId) m.push('ANTOPEN_KMS_ID')
  if (!e.tenant) m.push('ANTOPEN_TENANT_ID')
  return m
}

const HASH64 = /^[0-9a-f]{64}$/i
const dateNum = (d) => String(d || '').slice(0, 10).replaceAll('-', '')
/** 服务端报错可能回显请求路径里的令牌，凡是 24 位以上的字母数字串（64 位哈希除外）一律打码 */
const scrub = (s) => String(s ?? '').replace(/[A-Za-z0-9]{24,}/g, (m) => (HASH64.test(m) ? m : '<redacted>')).slice(0, 160)

/** access.key 在表单里常被粘成一行或带 \n 转义：统一还原成 PEM */
export function toPem(raw) {
  const s = String(raw || '').trim().replace(/\\n/g, '\n')
  if (!s) throw new Error('ANTOPEN_ACCESS_KEY 为空')
  if (s.includes('BEGIN')) return s
  const body = s.replace(/\s+/g, '')
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`
}

/** 握手签名：Hex(SHA256withRSA(accessId + time))。抽成纯函数以便离线自测 */
export function handshakeSecret({ accessId, time, privateKey }) {
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? crypto.createPrivateKey(toPem(privateKey)) : privateKey
  return crypto.sign('RSA-SHA256', Buffer.from(String(accessId) + String(time), 'utf8'), key).toString('hex')
}

/** 存证内容：确定性字符串，confirm 时据此重算并与链上读回逐字比对 */
export function contentOf({ root, prevRoot, bizDate }) {
  return ['wl-anchor/1', String(root), String(prevRoot || '0'.repeat(64)), dateNum(bizDate)].join('|')
}

// 同一进程内所有请求串行并留间隔（免费版 TPS=1）；失败也占用间隔
let queue = Promise.resolve(), nextAt = 0
function scheduled(fn) {
  const p = queue.then(async () => {
    await delay(Math.max(0, nextAt - Date.now()))
    try { return await fn() } finally { nextAt = Date.now() + env().gapMs }
  })
  queue = p.catch(() => {})
  return p
}

async function post(path, body) {
  const e = env()
  return await scheduled(async () => {
    const res = await fetch(e.rest + path, {
      method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let j = null
    try { j = JSON.parse(text) } catch { /* 非 JSON */ }
    if (!res.ok) throw new Error(`antchain-open ${res.status}: ${scrub(text)}`)
    return j || {}
  })
}

// token 缓存：键含地址、AccessId 与私钥指纹，后台改了凭据立即失效；并发握手只发一次
let tokenCache = null, tokenInflight = null
const TOKEN_TTL_MS = 25 * 60_000
const cacheKey = (e) => [e.rest, e.accessId, crypto.createHash('sha256').update(e.accessKey).digest('hex').slice(0, 12)].join('|')

async function getToken(force = false) {
  const e = env(), k = cacheKey(e)
  if (!force && tokenCache && tokenCache.k === k && tokenCache.exp > Date.now()) return tokenCache.token
  if (tokenInflight && tokenInflight.k === k) return await tokenInflight.p
  const p = (async () => {
    const time = String(Date.now())
    const j = await post('/api/contract/shakeHand', { accessId: e.accessId, time, secret: handshakeSecret({ accessId: e.accessId, time, privateKey: e.accessKey }) })
    if (!j.success || !j.data) throw new Error(`antchain-open 握手失败 ${j.code ?? ''}: ${scrub(j.data)}`)
    tokenCache = { k, token: String(j.data), exp: Date.now() + TOKEN_TTL_MS }
    return tokenCache.token
  })()
  tokenInflight = { k, p }
  try { return await p } finally { tokenInflight = null }
}

/**
 * 带 token 的业务调用。token 失效（code 202）时刷新后重试一次——token 错误是在执行前被拒的，重试不会重复上链。
 * soft=true 时业务失败不抛错，原样返回，由调用方按 code 判断（如 404=未上链）。
 */
async function api(path, makeBody, { soft = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken(attempt > 0)
    const j = await post(path, makeBody(token))
    if (j.success) return j
    if (attempt === 0 && String(j.code) === '202' && /token/i.test(String(j.data))) { tokenCache = null; continue }
    if (soft) return j
    throw new Error(`antchain-open ${j.code ?? '?'}: ${scrub(j.data)}`)
  }
}

export default {
  id: 'antchainopen',
  label: '蚂蚁链开放联盟链',
  docs: 'HTTP 方式接入，仅支持密钥托管账户；需先在控制台创建托管账户并分配燃料。与「蚂蚁链 / 鲸探」(antchain) 是不同产品',
  capabilities: { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => {
    const e = env()
    return {
      provider: 'antchainopen', mode: missing().length ? 'noop' : 'real', missing: missing(),
      note: `链 ${e.bizid} · 托管账户存证（DEPOSIT）· gas 上限 ${e.gas}；需已给账户分配燃料`,
    }
  },
  async anchor({ root, prevRoot, bizDate }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    if (!HASH64.test(root || '')) throw new Error('antchain-open 根必须是 64 位十六进制')
    const e = env()
    const content = contentOf({ root, prevRoot, bizDate })
    // orderId 是业务方唯一标识（官方：用于重试去重），按根派生：同一批重试得到同一个 orderId
    const orderId = 'wl_' + root.slice(0, 32).toLowerCase()
    const j = await api('/api/contract/chainCallForBiz', (token) => ({
      orderId, bizid: e.bizid, account: e.account, content, mykmsKeyId: e.kmsId,
      method: 'DEPOSIT', accessId: e.accessId, token, gas: e.gas, tenantid: e.tenant,
    }))
    const txRef = String(j.data || '')
    if (!HASH64.test(txRef)) throw new Error('antchain-open 响应缺少交易哈希')
    return { txRef: txRef.toLowerCase(), block: null, mode: 'real' }
  },
  /** 按交易哈希读回：未上链 → null；已上链 → {block, content, hash} */
  async queryTransaction(txRef) {
    if (!HASH64.test(txRef || '')) throw new Error('交易哈希必须是 64 位十六进制')
    const e = env()
    const j = await api('/api/contract/chainCall', (token) => ({ bizid: e.bizid, method: 'QUERYTRANSACTION', hash: txRef, accessId: e.accessId, token }), { soft: true })
    if (!j.success) {
      if (String(j.code) === '404') return null
      throw new Error(`antchain-open ${j.code ?? '?'}: ${scrub(j.data)}`)
    }
    let d
    try { d = JSON.parse(j.data) } catch { throw new Error('antchain-open 交易回查返回不是有效 JSON') }
    const b64 = d?.transactionDO?.data
    return {
      block: Number(d?.blockNumber), hash: String(d?.hash || ''),
      content: typeof b64 === 'string' ? Buffer.from(b64, 'base64').toString('utf8') : null,
    }
  },
  /** 终局确认：交易在块里、哈希一致、链上内容逐字等于本批次重算的内容。内容不一致是硬错误，不是"等一等" */
  async confirm({ txRef, root, prevRoot, bizDate }) {
    if (!root || !bizDate) throw new Error('antchain-open 确认需要批次根与业务日期')
    const r = await this.queryTransaction(txRef)
    if (!r) return { final: false, reason: '等待出块', confirmations: 0 }
    if (!Number.isSafeInteger(r.block) || r.block <= 0) return { final: false, reason: '等待出块', confirmations: 0 }
    if (r.hash.toLowerCase() !== String(txRef).toLowerCase()) throw new Error('antchain-open 回查交易哈希不一致')
    if (r.content !== contentOf({ root, prevRoot, bizDate })) throw new Error('antchain-open 链上内容与批次不一致')
    return { final: true, block: String(r.block), confirmations: 1 }
  },
  async queryByRoot() { return null },
  /** 连通性探测：握手 + 查最新块高，只读，不产生交易、不耗燃料 */
  async probe() {
    if (missing().length) throw new Error('未配置完整：' + missing().join('、'))
    const e = env()
    const j = await api('/api/contract/chainCall', (token) => ({ bizid: e.bizid, method: 'QUERYLASTBLOCK', accessId: e.accessId, token }))
    let n = null
    try { n = JSON.parse(j.data)?.block?.blockHeader?.number } catch { /* 忽略 */ }
    return { ok: true, detail: '握手成功' + (n != null ? '，当前块高 ' + n : '') }
  },
  /** 离线自检：现场生成一对 RSA 密钥，握手签名必须能用公钥验过；若已配私钥则再验它能解析。不联网、不需要凭据 */
  selfTest() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const secret = handshakeSecret({ accessId: 'selftest', time: '1700000000000', privateKey })
    const verified = crypto.verify('RSA-SHA256', Buffer.from('selftest1700000000000'), publicKey, Buffer.from(secret, 'hex'))
    let keyParse = '未配置'
    const raw = env().accessKey
    if (raw) { try { crypto.createPrivateKey(toPem(raw)); keyParse = '可解析' } catch { keyParse = '无法解析' } }
    const c = contentOf({ root: 'ab'.repeat(32), prevRoot: '', bizDate: '2026-11-04' })
    return {
      ok: verified && /^[0-9a-f]{512}$/.test(secret) && keyParse !== '无法解析' && c.endsWith('|20261104'),
      detail: { signAlgo: 'SHA256withRSA→Hex', verified, secretHexLen: secret.length, accessKey: keyParse, content: c.slice(0, 30) + '…' },
    }
  },
}
