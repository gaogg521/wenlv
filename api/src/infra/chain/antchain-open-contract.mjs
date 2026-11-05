// 蚂蚁链开放联盟链 · 合约模式（落根合约 WanderlustRootStore）
//
// 和 antchain-open.mjs（内置存证 DEPOSIT）是**同一条链、同一套凭据的两个并列入口**，生产环境再二选一：
//   · DEPOSIT：不用部署，链上是一笔存证交易，顺序/前根由我们的适配器保证（链不检查）。
//   · 合约  ：要先部署合约（不可逆），链**强制**序号 +1、前根必须接上、同根幂等，并能按根 getRoot 反查。
// 合约源码与编译产物：contracts/antchain-root/（build/ 里的 bin 与源码哈希绑定，改了源码不重编译测试会红）。
//
// 调用方式（文档 antdigital.com/docs/11/146925）：
//   写  CALLCONTRACTBIZASYNC  { orderId, bizid, account, contractName, methodSignature, inputParamListStr, outTypes, mykmsKeyId,
//                                accessId, token, gas, tenantid } → data = 交易哈希
//   读  没有独立的只读接口：同样发 CALLCONTRACTBIZASYNC（会产生交易、耗 gas）→ QUERYRECEIPT 取回执 output(base64)
//       → 本地按 32 字节字拆 output（decodeOutput）。真机：平台 PARSEOUTPUT 不支持 bytes32，所以不用它
//
// 与库里批次链的关系（重要）：合约创世时 lastRoot=0，且强制 prevRoot==lastRoot、seq==lastSeq+1。
// 库里的批次链在切到合约前已经有 DEPOSIT 时代的批次，它们的 prev_root 接不上合约的链头。
// 所以合约链**独立起链**：每次提交先读合约自己的 head()，用 seq=lastSeq+1、prevRoot=lastRoot 写入；
// 这一对值连同合约名记进 chain_content，确认时据此核对。旧的 DEPOSIT 批次仍按旧入口核验（chain_provider 不同）。
//
// ⚠ 以下几点文档没写清、离线无法验证，必须部署后在真实链上核对（见交接文档）：
//   1) bytes32 参数在 inputParamListStr 里怎么表示（"0x…" / 裸 hex / base64）→ ANTOPEN_CONTRACT_BYTES 可切换
//   2) QUERYRECEIPT 返回（真机已核对，2026-11-05）：扁平 JSON，字段 blockNumber/code/gasUsed/hash/logs/output/result/txFinish/txSuccess；
//      成功 = result===0，output 是 base64；txSuccess/txFinish 在读调用上恒为 false，不要用。仍兼容 transactionReceipt 嵌套
//   3) 同一 orderId 重复调用的行为（DEPOSIT 实测是静默返回首次那笔；这里 orderId 含 seq 与前根，换了状态就换号）
import { E } from './conf.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { antopenEnv, antopenMissing, antopenApi, hard, scrub, HASH64, dateNum } from './antchain-open.mjs'

export const SIG = {
  writeRoot: 'writeRoot(bytes32,bytes32,uint64,uint32,uint32)',
  getRoot: 'getRoot(bytes32)',
  head: 'head()',
}
export const OUT = {
  writeRoot: ['bool'],
  getRoot: ['bool', 'uint64', 'uint32', 'uint32', 'uint64'],
  head: ['uint32', 'bytes32', 'uint256'],
}
const ZERO = '0'.repeat(64)

const cenv = () => ({
  name: E.ANTOPEN_CONTRACT_NAME || '',
  gas: Number(E.ANTOPEN_CONTRACT_GAS) > 0 ? Number(E.ANTOPEN_CONTRACT_GAS) : 500000,
  strict: !['0', 'false', 'off'].includes(String(E.ANTOPEN_CONTRACT_STRICT ?? '1').toLowerCase()),
  bytes: ['0x', 'hex', 'base64'].includes(E.ANTOPEN_CONTRACT_BYTES) ? E.ANTOPEN_CONTRACT_BYTES : '0x',
  // 读调用等回执的轮询：次数 × 间隔（间隔另外受全局 TPS 队列约束）
  pollTries: Number(E.ANTOPEN_CONTRACT_POLL_TRIES) > 0 ? Number(E.ANTOPEN_CONTRACT_POLL_TRIES) : 8,
  pollMs: E.ANTOPEN_CONTRACT_POLL_MS != null && E.ANTOPEN_CONTRACT_POLL_MS !== '' ? Number(E.ANTOPEN_CONTRACT_POLL_MS) : 1500,
})

function missing() {
  const m = antopenMissing()
  if (!cenv().name) m.push('ANTOPEN_CONTRACT_NAME')
  return m
}

/** bytes32 入参的表示：文档没写清，三种都留着，部署后真机核对 */
export function fmtBytes32(hex64, fmt = '0x') {
  const h = String(hex64 || '')
  if (!HASH64.test(h)) throw new Error('bytes32 必须是 64 位十六进制：' + scrub(h))
  const low = h.toLowerCase()
  return fmt === 'hex' ? low : fmt === 'base64' ? Buffer.from(low, 'hex').toString('base64') : '0x' + low
}

/** writeRoot 的入参数组（JSON 串由调用处 stringify）；数值类参数用 number，字节类用字符串 */
export function writeRootArgs({ root, prevRoot, bizDate, leafCount, seq }, fmt = '0x') {
  const biz = Number(dateNum(bizDate))
  if (!Number.isInteger(biz) || biz < 20200101 || biz > 29991231) throw hard('BAD_ARGS', 'bizDate 必须是 yyyy-mm-dd（合约要求 2020~2999 年）')
  if (!Number.isInteger(leafCount) || leafCount <= 0) throw hard('BAD_ARGS', 'leafCount 必须是正整数')
  if (!Number.isInteger(seq) || seq <= 0 || seq > 0xffffffff) throw hard('BAD_ARGS', 'seq 必须是 1~2^32-1 的整数')
  return [fmtBytes32(root, fmt), fmtBytes32(prevRoot || ZERO, fmt), biz, leafCount, seq]
}

/** 记进 chain_content 的串：提交时的合约名 + 合约自己的序号与前根 + 根；确认阶段据此核对 */
export const contractContent = ({ name, seq, prev, root }) => ['wl-contract/1', name, seq, prev, root].join('|')
export function parseContractContent(s) {
  const p = String(s || '').split('|')
  if (p.length !== 5 || p[0] !== 'wl-contract/1') return null
  return { name: p[1], seq: Number(p[2]), prev: p[3], root: p[4] }
}

let rnd = 0
/** 发一次合约调用（写或读都是交易），返回交易哈希 */
async function callContract(sig, args, outs, { orderId }) {
  const e = antopenEnv(), c = cenv()
  const j = await antopenApi('/api/contract/chainCallForBiz', (token) => ({
    orderId, bizid: e.bizid, account: e.account, contractName: c.name, methodSignature: sig,
    inputParamListStr: JSON.stringify(args), outTypes: JSON.stringify(outs), mykmsKeyId: e.kmsId,
    method: 'CALLCONTRACTBIZASYNC', accessId: e.accessId, token, gas: c.gas, tenantid: e.tenant,
  }))
  const tx = String(j.data || '')
  if (!HASH64.test(tx)) throw new Error('antchain-contract 响应缺少交易哈希')
  return tx.toLowerCase()
}

/** 取回执：未出块/查无 → null；已出块 → { result, output(base64), block, gasUsed }。兼容 transactionReceipt 嵌套 */
async function getReceipt(txRef) {
  const e = antopenEnv()
  const j = await antopenApi('/api/contract/chainCall', (token) => ({ bizid: e.bizid, method: 'QUERYRECEIPT', hash: txRef, accessId: e.accessId, token }), { soft: true })
  if (!j.success) {
    if (['404', '211'].includes(String(j.code))) return null
    throw new Error(`antchain-contract ${j.code ?? '?'}: ${scrub(j.data)}`)
  }
  let d
  try { d = JSON.parse(j.data) } catch { throw new Error('antchain-contract 回执不是有效 JSON') }
  const r = d?.transactionReceipt && typeof d.transactionReceipt === 'object' ? d.transactionReceipt : d
  if (r == null || (r.result == null && r.output == null && r.blockNumber == null && d.blockNumber == null)) return null
  return { result: r.result == null ? null : Number(r.result), output: typeof r.output === 'string' ? r.output : '', block: Number(d.blockNumber ?? r.blockNumber), gasUsed: Number(r.gasUsed ?? d.gasUsed) }
}

/**
 * receipt.output(base64) → 返回值数组。本地按 ABI 静态类型拆，每个返回值占 32 字节一字。
 * 不用平台的 PARSEOUTPUT：真机实测它不支持 bytes32（500 "Unsupported function return type: bytes32"），
 * 而 head() 就返回 bytes32；这里只会用到 bool / uintN / bytes32，都是定长静态类型，拆字足够且可核对。
 * bool → true/false；uintN → Number（超出安全整数就报错，不静默丢精度）；bytes32 → '0x' + 64 位 hex。
 */
export function decodeOutput(outputB64, types) {
  const hex = Buffer.from(String(outputB64 || ''), 'base64').toString('hex')
  if (hex.length !== types.length * 64) throw new Error(`antchain-contract 返回值长度不对：期望 ${types.length} 个 32 字节字，实际 ${hex.length / 64} 个（output=${hex.length ? 'base64 ' + String(outputB64).slice(0, 40) : '空'}）`)
  return types.map((t, i) => {
    const w = hex.slice(i * 64, (i + 1) * 64)
    if (t === 'bytes32') return '0x' + w
    if (t === 'bool') {
      if (/^0{63}[01]$/.test(w)) return w.endsWith('1')
      throw new Error('antchain-contract bool 返回值不是 0/1：' + w.slice(-8))
    }
    if (/^uint(8|16|32|64|128|256)?$/.test(t)) {
      const n = BigInt('0x' + w)
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`antchain-contract ${t} 返回值超出安全整数范围`)
      return Number(n)
    }
    throw new Error('antchain-contract 不支持的返回类型：' + t)
  })
}

/** 读调用：发交易 → 轮询回执 → 解析返回值。回执 result≠0 说明合约拒绝了这次调用 */
async function readContract(sig, args, outs, tag) {
  const orderId = `wlr_${tag}_${Date.now().toString(36)}${(rnd++).toString(36)}`
  const tx = await callContract(sig, args, outs, { orderId })
  const c = cenv()
  let rc = null
  for (let i = 0; i < c.pollTries && !rc; i++) {
    if (i) await delay(c.pollMs)
    rc = await getReceipt(tx)
  }
  if (!rc) throw new Error(`antchain-contract 读调用 ${sig} 等回执超时（交易 ${tx}）`)
  if (rc.result !== 0) throw hard('CONTRACT_REVERT', `antchain-contract 读调用 ${sig} 被合约拒绝（result=${rc.result}）：合约名/部署/gas 是否正确`)
  return decodeOutput(rc.output, outs)
}

/** 合约自己的链头：{ seq, root(64hex), count } */
export async function readHead() {
  const r = await readContract(SIG.head, [], OUT.head, 'head')
  const root = String(r[1] || '').replace(/^0x/i, '').toLowerCase()
  if (!Array.isArray(r) || r.length < 3 || !(root === '' || HASH64.test(root))) throw new Error('antchain-contract head() 返回格式无效：' + scrub(JSON.stringify(r)))
  return { seq: Number(r[0]), root: root || ZERO, count: Number(r[2]) }
}

export async function readRoot(root) {
  const c = cenv()
  const r = await readContract(SIG.getRoot, [fmtBytes32(root, c.bytes)], OUT.getRoot, 'root')
  if (!Array.isArray(r) || r.length < 5) throw new Error('antchain-contract getRoot() 返回格式无效：' + scrub(JSON.stringify(r)))
  return { exists: r[0] === true, bizDate: Number(r[1]), leafCount: Number(r[2]), seq: Number(r[3]), anchoredAt: Number(r[4]) }
}

export default {
  id: 'antchaincontract',                     // ≤16 字符：attest_batch.chain_provider 是 VARCHAR(16)，迁移只增不改
  label: '蚂蚁链开放联盟链 · 合约模式',
  docs: '落根合约 WanderlustRootStore：链强制序号 +1 / 前根接上 / 同根幂等，可按根反查。需先部署合约（不可逆）；与「内置存证 DEPOSIT」共用凭据，生产再二选一',
  capabilities: { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => {
    const e = antopenEnv(), c = cenv()
    return {
      provider: 'antchaincontract', mode: missing().length ? 'noop' : 'real', missing: missing(),
      note: `链 ${e.bizid} · 合约 ${c.name || '（未配置）'} · gas 上限 ${c.gas} · 确认${c.strict ? '含 getRoot 反查（多一笔读调用）' : '仅看回执'}；合约须已部署`,
    }
  },
  async anchor({ root, leafCount, bizDate }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    if (!HASH64.test(root || '')) throw new Error('antchain-contract 根必须是 64 位十六进制')
    const c = cenv()
    // 先读合约自己的链头：序号与前根必须以它为准（见文件头的说明）
    const head = await readHead()
    const seq = head.seq + 1, prev = head.root
    const args = writeRootArgs({ root, prevRoot: prev, bizDate, leafCount: Number(leafCount), seq }, c.bytes)
    // orderId 含 seq 与前根：同一状态重试 → 同一 orderId（服务端按它去重）；链头变了 → 新 orderId，不会被首次失败的那笔吞掉
    const orderId = `wlc_${String(root).slice(0, 16).toLowerCase()}_${seq}_${prev.slice(0, 8)}`
    const txRef = await callContract(SIG.writeRoot, args, OUT.writeRoot, { orderId })
    // content / ts 原样落库（域层写 chain_content）：确认阶段拿"提交时的合约名与序号/前根"核对
    return { txRef, block: null, mode: 'real', content: contractContent({ name: c.name, seq, prev, root: String(root).toLowerCase() }), ts: Date.now(), signed: false }
  },
  /**
   * 终局确认：交易在块里 → 回执成功且 writeRoot 返回 true →（strict）合约里 getRoot 查得到且字段一致。
   * 硬错误（重试不会变好，域层转人工）：合约拒绝（序号/前根对不上、gas 不足）、根已存在（返回 false）、合约里的字段与批次不符、超时查无此交易。
   */
  async confirm({ txRef, root, bizDate, leafCount, content, submittedAt }) {
    if (!root || !bizDate) throw hard('BAD_ARGS', 'antchain-contract 确认需要批次根与业务日期')
    const exp = parseContractContent(content)
    if (!exp) throw hard('BAD_STATE', 'antchain-contract 缺少提交时记下的合约序号/前根（chain_content），无法核对，需人工')
    const e = antopenEnv(), c = cenv()
    const tx = await antopenApi('/api/contract/chainCall', (token) => ({ bizid: e.bizid, method: 'QUERYTRANSACTION', hash: txRef, accessId: e.accessId, token }), { soft: true })
    const waited = () => (submittedAt ? Date.now() - new Date(submittedAt).getTime() : 0)
    const pending = (why) => {
      if (submittedAt && waited() > e.waitMaxMs) {
        throw hard('NOT_ON_CHAIN', `antchain-contract 提交 ${Math.round(waited() / 60000)} 分钟仍无${why}（交易 ${txRef}），常见原因：gas 上限偏低或交易被丢弃；请核对燃料与 gas 后人工重提`)
      }
      return { final: false, reason: '等待出块', confirmations: 0 }
    }
    if (!tx.success) {
      if (String(tx.code) === '404') return pending('上链')
      throw new Error(`antchain-contract ${tx.code ?? '?'}: ${scrub(tx.data)}`)
    }
    let td
    try { td = JSON.parse(tx.data) } catch { throw new Error('antchain-contract 交易回查返回不是有效 JSON') }
    if (!Number.isSafeInteger(Number(td?.blockNumber)) || Number(td.blockNumber) <= 0) return pending('出块')
    if (String(td.hash || '').toLowerCase() !== String(txRef).toLowerCase()) throw hard('TX_HASH_MISMATCH', 'antchain-contract 回查交易哈希不一致')

    const rc = await getReceipt(txRef)
    if (!rc) return pending('回执')
    if (rc.result !== 0) {
      throw hard('CONTRACT_REVERT', `antchain-contract 合约拒绝了这笔写入（result=${rc.result}）：常见原因是链头已变（序号/前根对不上）或 gas 不足；重试会重新读链头，请人工确认后重提`)
    }
    const out = decodeOutput(rc.output, OUT.writeRoot)
    if (!Array.isArray(out) || out[0] !== true) {
      throw hard('ROOT_ALREADY_ANCHORED', 'antchain-contract 这枚根此前已写入合约（writeRoot 返回 false，本次是幂等空操作）：'
        + '根在链上，但这笔交易不是写入它的那笔，需人工核对原交易后处理')
    }
    if (c.strict) {
      const g = await readRoot(root)
      if (!g.exists) throw hard('ROOT_STATE_MISMATCH', 'antchain-contract 回执成功但合约里 getRoot 查无此根')
      const bad = []
      if (g.bizDate !== Number(dateNum(bizDate))) bad.push(`业务日 链上${g.bizDate} ≠ 批次${dateNum(bizDate)}`)
      if (leafCount != null && g.leafCount !== Number(leafCount)) bad.push(`叶数 链上${g.leafCount} ≠ 批次${leafCount}`)
      if (g.seq !== exp.seq) bad.push(`序号 链上${g.seq} ≠ 提交时${exp.seq}`)
      if (bad.length) throw hard('ROOT_STATE_MISMATCH', 'antchain-contract 合约里的记录与批次不一致：' + bad.join('；'))
    }
    return { final: true, block: String(td.blockNumber), confirmations: 1, signed: false, contractSeq: exp.seq }
  },
  async queryByRoot() { return null },
  /** 连通性探测：握手 + 查最新块高；配了合约名时再读一次合约链头（会耗约一笔交易的 gas，用来证明"合约确实部署了且能调"） */
  async probe() {
    if (missing().length) throw new Error('未配置完整：' + missing().join('、'))
    const e = antopenEnv()
    const j = await antopenApi('/api/contract/chainCall', (token) => ({ bizid: e.bizid, method: 'QUERYLASTBLOCK', accessId: e.accessId, token }))
    let n = null
    try { n = JSON.parse(j.data)?.block?.blockHeader?.number } catch { /* 忽略 */ }
    const h = await readHead()
    return { ok: true, detail: `握手成功${n != null ? '，当前块高 ' + n : ''}；合约链头 seq=${h.seq}，已写 ${h.count} 批（读调用耗一笔 gas）` }
  },
  /** 离线自检：入参编码三种格式、方法签名、返回类型与 .sol 里的函数一致；不联网 */
  selfTest() {
    const root = 'ab'.repeat(32)
    const a = writeRootArgs({ root, prevRoot: '', bizDate: '2026-11-05', leafCount: 12, seq: 1 })
    const ok = a.length === 5 && a[0] === '0x' + root && a[1] === '0x' + ZERO && a[2] === 20261105 && a[3] === 12 && a[4] === 1
      && fmtBytes32(root, 'hex') === root && Buffer.from(fmtBytes32(root, 'base64'), 'base64').toString('hex') === root
      && SIG.writeRoot.split(',').length === 5 && OUT.getRoot.length === 5 && OUT.head.length === 3
    return { ok, detail: { writeRoot: SIG.writeRoot, bytes32: cenv().bytes, contract: cenv().name || '（未配置）' } }
  },
}
