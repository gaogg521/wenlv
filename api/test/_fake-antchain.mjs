// 蚂蚁链开放联盟链的测试替身：握手按公钥验签；DEPLOY / DEPOSIT / CALLCONTRACTBIZASYNC / QUERY* / PARSEOUTPUT；
// 里面跑一份和 WanderlustRootStore.sol 同规则的状态机（序号 +1、前根必须接上、同根幂等返回 false）。
// 离线测试（antchain-contract.mjs）与数据库端到端（chain-contract-e2e.mjs）共用。
//
// 回执与编码按真机（2026-11-05）：回执是扁平 JSON（result/output/gasUsed/blockNumber…），output = base64(每个返回值一个 32 字节 ABI 字)；
// PARSEOUTPUT 对 bytes32 返回 500（真机实测），适配器已不调用它。读调用也是交易，回滚时回执 output 为空（替身的约定，真机回滚的回执形态未见过）。
import http from 'node:http'
import crypto from 'node:crypto'

export const ZERO = '0'.repeat(64)
const send = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
// bytes32 入参：真机实测只认 base64（44 字符，解出 32 字节）；'0x…'/裸 hex 报 405 "value length must be 32"
const b32 = (v) => (/^[A-Za-z0-9+/]{43}=$/.test(String(v)) ? Buffer.from(String(v), 'base64').toString('hex') : null)
// 回滚回执：真机实测 result=10201，output 是标准 Error(string)
const errOut = (reason) => {
  const t = Buffer.from(reason, 'utf8'), pad = (h) => h.padEnd(Math.ceil(h.length / 64) * 64, '0')
  return Buffer.from('08c379a0' + (32).toString(16).padStart(64, '0') + t.length.toString(16).padStart(64, '0') + pad(t.toString('hex')), 'hex').toString('base64')
}
const REVERT = 10201

export async function startFake({ publicKey }) {
  const st = {
    // 合约状态
    seq: 0, lastRoot: ZERO, total: 0, roots: new Map(),
    // 链状态
    height: 1000, txs: new Map(), orders: new Map(), pending: [],
    // 开关
    autoMine: true, forceRevert: false, dropNext: false, getRootOverride: null, deployResult: 0, noReceipt: false,
    // 观测
    calls: [], handshakes: 0, deploys: [], deposits: [], expireNext: false,
    mine() { for (const tx of st.pending.splice(0)) apply(tx) },
  }
  const mkTx = (j, kind) => {
    const hash = crypto.createHash('sha256').update('fake|' + j.orderId).digest('hex')
    const tx = { hash, kind, j, block: 0, receipt: null }
    st.txs.set(hash, tx); st.orders.set(j.orderId, hash)
    return tx
  }
  const mined = (tx) => { tx.block = ++st.height }
  // 回执 output：和真机一致，每个返回值一个 32 字节 ABI 字（bool/uint 左补零，bytes32 原样），整体 base64（真机实测 head() 的 output 就是 3 个字）
  const word = (v) => {
    if (typeof v === 'boolean') return (v ? 1n : 0n).toString(16).padStart(64, '0')
    if (typeof v === 'number') return BigInt(v).toString(16).padStart(64, '0')
    return String(v).replace(/^0x/i, '').padStart(64, '0')        // bytes32：'0x' + 64 位 hex
  }
  const out = (vals) => Buffer.from(vals.map(word).join(''), 'hex').toString('base64')

  function apply(tx) {
    mined(tx)
    const j = tx.j
    if (tx.kind === 'deposit') { tx.receipt = null; return }       // DEPOSIT 没有回执（实测 211）
    const args = JSON.parse(j.inputParamListStr || '[]')
    const sig = j.methodSignature
    if (sig === 'head()') { tx.receipt = { result: 0, output: out([st.seq, '0x' + st.lastRoot, st.total]) }; return }
    if (sig === 'getRoot(bytes32)') {
      const r = st.roots.get(b32(args[0]))
      const v = st.getRootOverride ? st.getRootOverride(r) : (r ? [true, r.bizDate, r.leafCount, r.seq, r.at] : [false, 0, 0, 0, 0])
      tx.receipt = { result: 0, output: out(v) }; return
    }
    if (sig === 'writeRoot(bytes32,bytes32,uint64,uint32,uint32)') {
      const [root, prev, bizDate, leafCount, seq] = [b32(args[0]), b32(args[1]), args[2], args[3], args[4]]
      if (st.forceRevert) { st.forceRevert = false; tx.receipt = { result: REVERT, output: errOut('only owner') }; return }
      if (!root || !prev) { tx.receipt = { result: REVERT, output: errOut('bad bytes32') }; return }
      if (st.roots.has(root)) { tx.receipt = { result: 0, output: out([false]) }; return }          // 幂等：同根返回 false
      if (seq !== st.seq + 1) { tx.receipt = { result: REVERT, output: errOut('seq must be lastSeq+1') }; return }
      if (prev !== st.lastRoot) { tx.receipt = { result: REVERT, output: errOut('prevRoot mismatch') }; return } // 序号/前根对不上 → 回滚
      st.roots.set(root, { prev, bizDate, leafCount, seq, at: 1700000000 + st.height })
      st.seq = seq; st.lastRoot = root; st.total += 1
      tx.receipt = { result: 0, output: out([true]) }
    }
  }

  const srv = http.createServer((req, res) => {
    let b = ''
    req.on('data', (d) => (b += d))
    req.on('end', () => {
      const j = b ? JSON.parse(b) : {}
      if (req.url === '/api/contract/shakeHand') {
        const ok = crypto.verify('RSA-SHA256', Buffer.from(String(j.accessId) + String(j.time)), publicKey, Buffer.from(String(j.secret), 'hex'))
        if (!ok) return send(res, { success: false, code: '201', data: 'secret is not correct' })
        st.handshakes++
        return send(res, { success: true, code: '200', data: 'tok-' + st.handshakes + '-' + crypto.randomBytes(4).toString('hex') })
      }
      if (!String(j.token || '').startsWith('tok-') || st.expireNext) { st.expireNext = false; return send(res, { success: false, code: '202', data: 'input token is not correct' }) }
      st.calls.push({ url: req.url, method: j.method, sig: j.methodSignature || null, body: j })

      if (req.url === '/api/contract/chainCallForBiz') {
        if (j.method === 'PARSEOUTPUT') {
          // 真机：PARSEOUTPUT 不支持 bytes32（500），其它定长类型按字解析。适配器已不再调用它——测试里断言"没调用"
          let abi; try { abi = JSON.parse(j.abi) } catch { return send(res, { success: false, code: '500', data: 'bad abi' }) }
          const bad = abi.find((t) => t === 'bytes32')
          if (bad) return send(res, { success: false, code: '500', data: 'Unsupported function return type: ' + bad })
          const hex = String(j.content), vals = abi.map((t, i) => { const n = BigInt('0x' + hex.slice(i * 64, i * 64 + 64)); return t === 'bool' ? n === 1n : Number(n) })
          return send(res, { success: true, code: '200', data: JSON.stringify(vals) })
        }
        if (st.orders.has(j.orderId)) return send(res, { success: true, code: '200', data: st.orders.get(j.orderId) })   // 同 orderId：静默返回首次那笔（实测）
        if (j.method === 'DEPOSIT') { st.deposits.push(j); const tx = mkTx(j, 'deposit'); if (st.autoMine) apply(tx); else st.pending.push(tx); return send(res, { success: true, code: '200', data: tx.hash }) }
        if (j.method === 'DEPLOYCONTRACTFORBIZ') {
          st.deploys.push(j)
          return send(res, { success: true, code: '200', data: JSON.stringify({ txData: { data: { success: st.deployResult === 0, transactionReceipt: { result: st.deployResult, output: '' } } } }) })
        }
        if (j.method === 'CALLCONTRACTBIZASYNC') {
          if (String(j.account) !== 'acct' || !j.contractName) return send(res, { success: false, code: '204', data: 'account config invalid' })
          // bytes32 入参格式校验（真机行为）：写/按根读的 bytes32 必须是 base64，否则发交易阶段就被拒（还没上链、不耗 gas）
          const bargs = JSON.parse(j.inputParamListStr || '[]'), nb = { 'writeRoot(bytes32,bytes32,uint64,uint32,uint32)': 2, 'getRoot(bytes32)': 1 }[j.methodSignature] || 0
          if (bargs.slice(0, nb).some((x) => !b32(x))) return send(res, { success: false, code: '405', data: 'value length must be 32' })
          const tx = mkTx(j, 'call')
          const isWrite = j.methodSignature === 'writeRoot(bytes32,bytes32,uint64,uint32,uint32)'
          // 丢弃 / 延迟出块只针对写交易：读（head / getRoot）要立即可取，否则连"先读链头"都过不去
          if (isWrite && st.dropNext) { st.dropNext = false; tx.dropped = true; return send(res, { success: true, code: '200', data: tx.hash }) }   // 返回成功+哈希，但链上查无此笔
          if (st.autoMine || !isWrite) apply(tx); else st.pending.push(tx)
          return send(res, { success: true, code: '200', data: tx.hash })
        }
      }
      if (req.url === '/api/contract/chainCall') {
        if (j.method === 'QUERYLASTBLOCK') return send(res, { success: true, code: '200', data: JSON.stringify({ block: { blockHeader: { number: st.height } } }) })
        const tx = st.txs.get(j.hash)
        if (j.method === 'QUERYTRANSACTION') {
          if (!tx || !tx.block) return send(res, { success: false, code: '404', data: '' })
          return send(res, { success: true, code: '200', data: JSON.stringify({ blockNumber: tx.block, hash: tx.hash, transactionDO: { data: Buffer.from(String(tx.j.content ?? '')).toString('base64'), timestamp: 1 } }) })
        }
        if (j.method === 'QUERYRECEIPT') {
          if (!tx || !tx.block || !tx.receipt || st.noReceipt) return send(res, { success: false, code: '211', data: '' })   // 没出块 / DEPOSIT 无回执
          return send(res, { success: true, code: '200', data: JSON.stringify({ blockNumber: tx.block, gasUsed: 21500, result: tx.receipt.result, output: tx.receipt.output, logs: [] }) })
        }
      }
      send(res, { success: false, code: '500', data: 'unexpected ' + req.url + ' ' + j.method })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { st, url: `http://127.0.0.1:${srv.address().port}`, stop: () => { srv.closeAllConnections(); srv.close() } }
}
