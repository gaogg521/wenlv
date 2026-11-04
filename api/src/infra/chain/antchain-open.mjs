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
//
// 2026-11-04 真机实测（真实凭据，非假服务）补充的三条，直接决定业务处置：
//   · 同一 orderId 再提交 → 返回 success + **首次那笔的哈希**，新内容被静默丢弃（幂等是真的，但会"假成功"）
//     ⇒ 同一根重试安全、不会双写；内容不符则是该根此前用别的内容上过链 → 必须转人工
//   · gas 偏低（实测 10）→ 仍返回 success + 哈希，但链上查无此交易（404）
//     ⇒ 只把 404 当"等出块"会让批次永久卡住；超过 ANTOPEN_WAIT_MAX_MS 判定为交易被丢弃并抛硬错误
//   · orderId = 'wl_' + 根前 32 位（35 字符）可用
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
  // 提交后多久还没在链上查到，就判定"这笔交易被丢掉了"（gas 不足/被丢弃都会返回成功+哈希但查无此交易）
  waitMaxMs: Number(E.ANTOPEN_WAIT_MAX_MS) > 0 ? Number(E.ANTOPEN_WAIT_MAX_MS) : 10 * 60_000,
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
/** 重试不会改变结果的错误带上 code，域层据此转人工而不是白重试 5 次 */
const hard = (code, msg) => Object.assign(new Error(msg), { code })
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

/** 旧版（v1）存证内容：只有根/前根/业务日。保留只为兼容已锚定的历史批次 */
export function contentOf({ root, prevRoot, bizDate }) {
  return ['wl-anchor/1', String(root), String(prevRoot || '0'.repeat(64)), dateNum(bizDate)].join('|')
}

/** v1 原文解析（wl-anchor/1|root|prevRoot|bizDate）：确认时的行一致性比对用 */
export function parseContentV1(s) {
  const parts = String(s || '').split('|')
  if (parts.length !== 4 || parts[0] !== 'wl-anchor/1') return null
  return { version: 1, root: parts[1], prevRoot: parts[2], bizDate: parts[3] }
}

// ===== v2：按方案 §7.6「上链的只有 哈希指纹 + 时间戳 + 主体标识 + 签名」=====
// 实测（2026-11-04，真实链）：content 2000 字符内正常；4000 字符会"返回 success 但链上查无此交易"。
// v2 完整格式约 690 字符（主体 8 + 链 8 + 类型 + 两个 64 位根 + 13 位毫秒 + 512 位签名），留足余量。
const CONTENT_MAX = 2000

/** 签名原文（不含签名本身）：主体标识 + 链 + 类型 + 根 + 前根 + 时间戳 */
export function signPayload({ tenant, bizid, kind, root, prevRoot, ts }) {
  return ['wl-anchor/2', String(tenant), String(bizid), String(kind || 'biz'), String(root),
    String(prevRoot || '0'.repeat(64)), String(ts)].join('|')
}

/** v2 上链原文：四要素齐全，签名附在最后 */
export function contentV2({ tenant, bizid, kind, root, prevRoot, ts, sig }) {
  return signPayload({ tenant, bizid, kind, root, prevRoot, ts }) + '|' + String(sig)
}

/** 拆分 v2 原文，供确认阶段验签；不是 v2 返回 null（老批次走 v1 兼容路径） */
export function parseContentV2(s) {
  const parts = String(s || '').split('|')
  if (parts.length !== 8 || parts[0] !== 'wl-anchor/2') return null
  const [, tenant, bizid, kind, root, prevRoot, ts, sig] = parts
  return { tenant, bizid, kind, root, prevRoot, ts, sig }
}

/**
 * 展示用：把上链原文拆成"人话四要素"，给验证接口/对外页直接渲染。
 * 认不出格式就返回 {version:0}，绝不假装解析成功。
 */
export function describeContent(raw) {
  const str = String(raw || '')
  if (!str) return { version: 0, note: '该批次没有留存上链原文（v1 早期批次）' }
  const v2 = parseContentV2(str)
  if (v2) {
    return {
      version: 2, raw: str,
      subject: { tenant: v2.tenant, chainId: v2.bizid, kind: v2.kind },
      root: v2.root, prevRoot: v2.prevRoot,
      tsMs: Number(v2.ts), tsIso: new Date(Number(v2.ts)).toISOString(),
      signature: { algo: 'RSA-SHA256', value: v2.sig, length: v2.sig.length },
    }
  }
  if (str.startsWith('wl-anchor/1|')) {
    const [, , root, prevRoot, bizDate] = str.split('|')
    return { version: 1, raw: str, subject: null, root, prevRoot, bizDate,
      note: 'v1 早期格式：只有根/前根/业务日，没有主体标识与签名' }
  }
  return { version: 0, raw: str, note: '无法识别的上链原文格式' }
}

/** 用平台私钥对签名原文做 RSA-SHA256，返回 hex */
export function signWith(privateKey, payload) {
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? crypto.createPrivateKey(toPem(privateKey)) : privateKey
  return crypto.sign('RSA-SHA256', Buffer.from(String(payload), 'utf8'), key).toString('hex')
}

/** 由私钥导出公钥 PEM：第三方拿它可以独立验签，不需要我们的私钥 */
export function publicKeyPemOf(privateKey) {
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? crypto.createPrivateKey(toPem(privateKey)) : privateKey
  return crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' })
}

/** 验签：pubPem 缺省时用平台私钥导出（自校验，能抓损坏但不算独立第三方验证） */
export function verifyContentV2(content, pubPem) {
  const c = parseContentV2(content)
  if (!c) return { ok: false, reason: '不是 v2 格式' }
  const payload = signPayload({ tenant: c.tenant, bizid: c.bizid, kind: c.kind, root: c.root, prevRoot: c.prevRoot, ts: c.ts })
  try {
    const key = crypto.createPublicKey(pubPem || publicKeyPemOf(E.ANTOPEN_ACCESS_KEY))
    const ok = crypto.verify('RSA-SHA256', Buffer.from(payload, 'utf8'), key, Buffer.from(c.sig, 'hex'))
    return { ok, reason: ok ? '' : '签名与内容不匹配', payload }
  } catch (e) { return { ok: false, reason: '公钥不可用：' + e.message, payload } }
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
  async anchor({ root, prevRoot, bizDate, kind }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    if (!HASH64.test(root || '')) throw new Error('antchain-open 根必须是 64 位十六进制')
    const e = env()
    // §7.6 四要素：哈希指纹(根) + 时间戳(毫秒) + 主体标识(租户/链) + 签名(平台私钥 RSA-SHA256)
    const ts = Date.now()
    const prev = prevRoot || '0'.repeat(64)
    const payload = signPayload({ tenant: e.tenant, bizid: e.bizid, kind: kind || 'biz', root, prevRoot: prev, ts })
    let sig = 'nosig'
    try { sig = signWith(e.accessKey, payload) } catch { sig = 'nosig' } // 密钥不可用如实降级，绝不假装签过
    const content = contentV2({ tenant: e.tenant, bizid: e.bizid, kind: kind || 'biz', root, prevRoot: prev, ts, sig })
    if (content.length > CONTENT_MAX) throw hard('CONTENT_TOO_LONG', `上链原文 ${content.length} 字符，超过实测安全上限 ${CONTENT_MAX}`)
    // orderId 是业务方唯一标识（官方：用于重试去重），按根派生：同一批重试得到同一个 orderId
    const orderId = 'wl_' + root.slice(0, 32).toLowerCase()
    const j = await api('/api/contract/chainCallForBiz', (token) => ({
      orderId, bizid: e.bizid, account: e.account, content, mykmsKeyId: e.kmsId,
      method: 'DEPOSIT', accessId: e.accessId, token, gas: e.gas, tenantid: e.tenant,
    }))
    const txRef = String(j.data || '')
    if (!HASH64.test(txRef)) throw new Error('antchain-open 响应缺少交易哈希')
    // content / ts 一起回传，域层原样落库：确认阶段必须拿"提交时那一串"逐字比对，
    // 不能重算（重算复现不了同一毫秒），否则比对等于自欺
    return { txRef: txRef.toLowerCase(), block: null, mode: 'real', content, ts, signed: sig !== 'nosig' }
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
  /**
   * 终局确认：交易在块里、哈希一致、链上内容逐字等于本批次重算的内容。
   * 两类硬错误（重试不会变好，域层据此转人工）：
   *   · 内容/哈希不一致 —— 实测：同一 orderId 再提交不同内容，服务端**返回 success + 首次那笔的哈希**，
   *     新内容被静默丢弃。所以"内容不符"不是慢，是这笔根此前已用别的内容上过链，必须人看。
   *   · 超时仍未上链 —— 实测：gas 偏低时接口仍返回 success + 哈希，但链上查无此交易（404）。
   *     一直当"等待出块"会让批次永久停在待确认，对账上看不出来。
   */
  async confirm({ txRef, root, prevRoot, bizDate, submittedAt, content: expectContent }) {
    if (!root || !bizDate) throw hard('BAD_ARGS', 'antchain-open 确认需要批次根与业务日期')
    const r = await this.queryTransaction(txRef)
    if (!r) {
      const age = submittedAt ? Date.now() - new Date(submittedAt).getTime() : 0
      const max = env().waitMaxMs
      if (submittedAt && age > max) {
        throw hard('NOT_ON_CHAIN', `antchain-open 提交 ${Math.round(age / 60000)} 分钟仍未上链（交易 ${txRef} 查无此笔），`
          + '常见原因：gas 上限低于实际消耗或交易被丢弃；请核对燃料与 gas 后人工重提')
      }
      return { final: false, reason: '等待出块', confirmations: 0 }
    }
    if (!Number.isSafeInteger(r.block) || r.block <= 0) return { final: false, reason: '等待出块', confirmations: 0 }
    if (r.hash.toLowerCase() !== String(txRef).toLowerCase()) throw hard('TX_HASH_MISMATCH', 'antchain-open 回查交易哈希不一致')
    // 优先用提交时落库的原串比对（v2 带毫秒时间戳与签名，重算不可能一致）；
    // 老批次没有存原文时回退 v1 公式，保持向后兼容
    const expected = expectContent || contentOf({ root, prevRoot, bizDate })
    if (r.content !== expected) {
      throw hard('CONTENT_MISMATCH', 'antchain-open 链上内容与批次不一致：该根此前已用其它内容（前根/业务日）上过链，'
        + '同一 orderId 的重复提交会被服务端丢弃并返回首次那笔，需人工核对后再决定是否换根重提')
    }
    // 链上原文里的业务字段必须与批次当前行一致：提交后批次行的根/前根被改动（库内篡改或脏写）
    // 重试必然重演 → 转人工，不能照旧置为已锚定（确认语义：交易内容"确实是这枚根"）。
    // v1 原文带业务日一并比对；v2 原文只有根/前根（ts 是提交时刻，不是业务日）
    const onChainV2 = parseContentV2(r.content)
    const onChain = onChainV2 || parseContentV1(r.content)
    if (onChain) {
      const fieldsBad = onChain.root !== String(root) || String(onChain.prevRoot || '') !== String(prevRoot || '0'.repeat(64))
        || (!onChainV2 && Number(onChain.bizDate) !== Number(dateNum(bizDate)))
      if (fieldsBad) {
        throw hard('CONTENT_MISMATCH', 'antchain-open 链上内容与批次不一致（根/前根）：批次在提交后被改动，'
          + '同一根重提也会重演不一致，需人工核对决定是否换根重提')
      }
    }
    // v2 还要验签：链上那串里的签名，必须真的是平台私钥对"这串内容"的签名
    const v2 = parseContentV2(r.content)
    if (v2) {
      const v = verifyContentV2(r.content)
      if (!v.ok) throw hard('SIG_INVALID', 'antchain-open 链上原文签名校验失败：' + v.reason)
    }
    return { final: true, block: String(r.block), confirmations: 1, signed: v2 ? true : false, contentV2: !!v2 }
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
