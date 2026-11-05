// 蚂蚁链开放联盟链的测试替身：握手按公钥验签；DEPLOY / DEPOSIT / CALLCONTRACTBIZASYNC / QUERY* / PARSEOUTPUT；
// 里面跑一份和 WanderlustRootStore.sol 同规则的状态机（序号 +1、前根必须接上、同根幂等返回 false）。
// 离线测试（antchain-contract.mjs）与数据库端到端（chain-contract-e2e.mjs）共用。
//
// 约定（替身自己的，真实链的编码以真机为准）：回执 output = base64(JSON.stringify(返回值数组))；
// PARSEOUTPUT 把 hex 还原成这个 JSON 原样返回。这样测的是适配器的"管道"（hex 转换、轮询、判定），不是 ABI 编码。
import http from 'node:http'
import crypto from 'node:crypto'

export const ZERO = '0'.repeat(64)
const send = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
const b32 = (v) => {                       // 三种 bytes32 表示都认，统一成 64 位小写 hex
  const s = String(v)
  if (/^0x[0-9a-f]{64}$/i.test(s)) return s.slice(2).toLowerCase()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  if (/^[A-Za-z0-9+/]{43}=$/.test(s)) return Buffer.from(s, 'base64').toString('hex')
  return null
}

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
  const out = (vals) => Buffer.from(JSON.stringify(vals)).toString('base64')

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
      if (st.forceRevert) { st.forceRevert = false; tx.receipt = { result: 1, output: '' }; return }
      if (!root || !prev) { tx.receipt = { result: 1, output: '' }; return }
      if (st.roots.has(root)) { tx.receipt = { result: 0, output: out([false]) }; return }          // 幂等：同根返回 false
      if (seq !== st.seq + 1 || prev !== st.lastRoot) { tx.receipt = { result: 1, output: '' }; return } // 序号/前根对不上 → 回滚
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
          let v; try { v = Buffer.from(String(j.content), 'hex').toString('utf8'); JSON.parse(v) } catch { return send(res, { success: false, code: '500', data: 'bad output' }) }
          return send(res, { success: true, code: '200', data: v })
        }
        if (st.orders.has(j.orderId)) return send(res, { success: true, code: '200', data: st.orders.get(j.orderId) })   // 同 orderId：静默返回首次那笔（实测）
        if (j.method === 'DEPOSIT') { st.deposits.push(j); const tx = mkTx(j, 'deposit'); if (st.autoMine) apply(tx); else st.pending.push(tx); return send(res, { success: true, code: '200', data: tx.hash }) }
        if (j.method === 'DEPLOYCONTRACTFORBIZ') {
          st.deploys.push(j)
          return send(res, { success: true, code: '200', data: JSON.stringify({ txData: { data: { success: st.deployResult === 0, transactionReceipt: { result: st.deployResult, output: '' } } } }) })
        }
        if (j.method === 'CALLCONTRACTBIZASYNC') {
          if (String(j.account) !== 'acct' || !j.contractName) return send(res, { success: false, code: '204', data: 'account config invalid' })
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
