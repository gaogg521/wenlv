// Web3 内核单元 + 集成测试（不依赖外网、不依赖真凭据）
//   A. Merkle v2：RFC 6962 域隔离、奇数提升、历史 v1 兼容、两个已知攻击被堵住
//   B. 业务日：按 Asia/Shanghai 切日
//   C. EVM 锚定终局：起一个本地假 relayer + 假 JSON-RPC，验证"txHash ≠ 已上链"
//      提交 → status 5 → 确认数不足保持 5 → 达标置 2；内容不符/回执失败 → 回到 3 可重试
// 运行：DB_NAME=<隔离库> node test/web3-core.mjs    （C 段会写 attest_batch，只能对隔离库运行）
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import * as merkle from '../src/domain/merkle.mjs'
import { bizDay } from '../src/infra/bizdate.mjs'

let pass = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 }
}
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

console.log('== A Merkle ==')
for (const n of [1, 2, 3, 5, 7, 8, 13, 64, 100]) {
  await t(`v2 ${n} 片叶子：每条 proof 都能重算回根`, () => {
    const leaves = Array.from({ length: n }, (_, i) => h('leaf' + i))
    const tree = merkle.buildTree(leaves)
    assert.equal(tree.version, 2)
    leaves.forEach((l, i) => assert.ok(merkle.verifyProof(l, merkle.proofFor(tree, i), tree.root, 2), 'leaf ' + i))
  })
}
await t('v2 堵住"复制末节点"碰撞：[a,b,c] 与 [a,b,c,c] 根不同', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(h)
  assert.notEqual(merkle.buildTree([a, b, c]).root, merkle.buildTree([a, b, c, c]).root)
  // 对照：v1 确实存在该碰撞（这正是要升级的原因）
  assert.equal(merkle.buildTree([a, b, c], 1).root, merkle.buildTree([a, b, c, c], 1).root)
})
await t('v2 堵住"内部节点冒充叶子"的第二原像', () => {
  const leaves = ['a', 'b', 'c', 'd'].map(h)
  const tree = merkle.buildTree(leaves)
  const inner = tree.levels[1][0] // 左子树根
  // 攻击者声称 inner 是一片叶子，兄弟是右子树根
  assert.equal(merkle.verifyProof(inner, [{ h: tree.levels[1][1], p: 'R' }], tree.root, 2), false)
  // 对照：v1 下同样的伪造会通过
  const t1 = merkle.buildTree(leaves, 1)
  assert.equal(merkle.verifyProof(t1.levels[1][0], [{ h: t1.levels[1][1], p: 'R' }], t1.root, 1), true)
})
await t('篡改任一叶 / 任一步兄弟 / 方向 → 验证失败', () => {
  const leaves = Array.from({ length: 9 }, (_, i) => h(i))
  const tree = merkle.buildTree(leaves)
  const p = merkle.proofFor(tree, 4)
  assert.equal(merkle.verifyProof(h('x'), p, tree.root, 2), false)
  assert.equal(merkle.verifyProof(leaves[4], p.map((s, i) => i === 0 ? { ...s, h: h('y') } : s), tree.root, 2), false)
  assert.equal(merkle.verifyProof(leaves[4], p.map((s, i) => i === 0 ? { ...s, p: s.p === 'R' ? 'L' : 'R' } : s), tree.root, 2), false)
})
await t('非法输入直接拒绝，而不是算出一个值', () => {
  assert.throws(() => merkle.buildTree([]))
  assert.throws(() => merkle.buildTree(['nothex']))
  assert.equal(merkle.verifyProof('zz', [], h(1), 2), false)
})
await t('v1 历史批次仍可验证（兼容）', () => {
  const leaves = Array.from({ length: 5 }, (_, i) => h('o' + i))
  const t1 = merkle.buildTree(leaves, 1)
  leaves.forEach((l, i) => assert.ok(merkle.verifyProof(l, merkle.proofFor(t1, i), t1.root, 1)))
})

console.log('== B 业务日 ==')
await t('UTC 23:30 = 北京次日 07:30，业务日取北京日期', () => {
  const now = new Date('2026-10-26T23:30:00Z')
  assert.equal(now.toISOString().slice(0, 10), '2026-10-26') // 旧实现会取到这个
  assert.equal(bizDay(0, now), '2026-10-27')
  assert.equal(bizDay(-1, now), '2026-10-26')
})

console.log('== C EVM 锚定终局 ==')
import { PROTECTED } from './_guard.mjs'
if ((!process.env.DB_NAME || PROTECTED.includes(process.env.DB_NAME)) && process.env.ALLOW_DESTRUCTIVE !== '1') {
  console.log('  - 跳过（需要 DB_NAME 指向隔离库，或一次性容器设 ALLOW_DESTRUCTIVE=1）')
} else {
  const ANCHOR_TO = '0x' + 'ab'.repeat(20)
  const chainState = { head: 100, txs: new Map(), failNext: false, tamperNext: false }
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {}
      const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
      if (req.url === '/tx') {
        const hash = '0x' + crypto.randomBytes(32).toString('hex')
        chainState.txs.set(hash, {
          input: chainState.tamperNext ? '0x' + 'ee'.repeat(32) : j.data, to: j.to,
          block: chainState.head + 1, ok: !chainState.failNext,
        })
        chainState.failNext = false; chainState.tamperNext = false
        return send({ txHash: hash })
      }
      const tx = chainState.txs.get(j.params?.[0])
      if (j.method === 'eth_blockNumber') return send({ jsonrpc: '2.0', id: j.id, result: '0x' + chainState.head.toString(16) })
      if (j.method === 'eth_getTransactionByHash') return send({ jsonrpc: '2.0', id: j.id, result: tx ? { input: tx.input, to: tx.to } : null })
      if (j.method === 'eth_getTransactionReceipt') {
        return send({ jsonrpc: '2.0', id: j.id, result: tx && chainState.head >= tx.block
          ? { blockNumber: '0x' + tx.block.toString(16), status: tx.ok ? '0x1' : '0x0' } : null })
      }
      send({ jsonrpc: '2.0', id: j.id, error: { message: 'unknown ' + j.method } })
    })
  })
  await new Promise((r) => srv.listen(0, r))
  const base = 'http://127.0.0.1:' + srv.address().port
  Object.assign(process.env, {
    CHAIN_PROVIDER: 'evm', EVM_RELAYER_URL: base, EVM_RELAYER_TOKEN: 't', EVM_RPC_URL: base,
    EVM_ANCHOR_TO: ANCHOR_TO, EVM_CONFIRMATIONS: '3',
  })
  const { q, one } = await import('../src/db.mjs')
  const attest = await import('../src/domain/attest.mjs')
  const mkBatch = async () => {
    const last = await one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
    const root = h('batch' + Math.random())
    const r = await q(`INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, merkle_version, status)
      VALUES (?,?,?,?,1,'test',2,1)`, [Number(last?.seq || 0) + 1, bizDay(), root, last?.merkle_root || null])
    return r.insertId
  }
  const st = async (id) => one('SELECT status, chain_tx_ref, confirmations, last_err FROM attest_batch WHERE id = ?', [id])
  const created = []

  await t('提交后只到"已提交·待确认"(5)，不是"已锚定"(2)', async () => {
    const id = await mkBatch(); created.push(id)
    const r = await attest.anchorToChain(id)
    assert.equal(r.submitted, true)
    const s = await st(id)
    assert.equal(Number(s.status), 5)
    assert.match(s.chain_tx_ref, /^0x[0-9a-f]{64}$/)
  })
  // confirmPending() 同样会处理全库 status=5 的批次；测试开始前库里不应有真实的待确认批次
  assert.equal(Number((await one(`SELECT COUNT(*) n FROM attest_batch WHERE status = 5 AND merkle_kind <> 'test'`)).n), 0, '库里存在真实的待确认批次，拒绝在此库上运行')
  await t('确认数不足保持 5；达标后置 2 并记录确认数', async () => {
    const id = created[0]
    chainState.head += 1 // 进块，1 个确认
    await attest.confirmPending()
    let s = await st(id)
    assert.equal(Number(s.status), 5)
    assert.equal(Number(s.confirmations), 1)
    chainState.head += 2 // 3 个确认
    await attest.confirmPending()
    s = await st(id)
    assert.equal(Number(s.status), 2)
    assert.equal(Number(s.confirmations), 3)
  })
  await t('链上内容与根不符 → 作废回到 3（可重试），绝不记为已锚定', async () => {
    const id = await mkBatch(); created.push(id)
    chainState.tamperNext = true
    await attest.anchorToChain(id)
    chainState.head += 5
    await attest.confirmPending()
    const s = await st(id)
    assert.equal(Number(s.status), 3)
    assert.equal(s.chain_tx_ref, null)
    assert.match(s.last_err, /不一致/)
  })
  await t('回执 status=0x0（交易执行失败）→ 回到 3', async () => {
    const id = await mkBatch(); created.push(id)
    chainState.failNext = true
    await attest.anchorToChain(id)
    chainState.head += 5
    await attest.confirmPending()
    assert.equal(Number((await st(id)).status), 3)
  })
  await t('失败批次重试后可正常锚定', async () => {
    const id = created[2]
    // 只重试本测试建的批次：reanchorPending() 会把库里所有待锚批次（含真实日终根）锚到假链上，污染数据
    await attest.anchorToChain(id)
    chainState.head += 5
    await attest.confirmPending()
    assert.equal(Number((await st(id)).status), 2)
  })
  await t('已锚定批次不可回退（数据库触发器）', async () => {
    await assert.rejects(q('UPDATE attest_batch SET status = 1 WHERE id = ?', [created[0]]), /不可回退/)
  })
  await t('缺 EVM_RPC_URL 时不算真实接入（只能发、不能证）', async () => {
    const saved = process.env.EVM_RPC_URL
    delete process.env.EVM_RPC_URL
    const { chainStatus } = await import('../src/infra/chain.mjs')
    const s = chainStatus()
    process.env.EVM_RPC_URL = saved
    assert.equal(s.mode, 'noop')
    assert.ok(s.missing.includes('EVM_RPC_URL'))
  })
  // 清理：测试批次不留在库里（已锚定的批次触发器禁止回退，但允许删除）
  await q(`DELETE FROM attest_batch WHERE merkle_kind = 'test'`)
  srv.closeAllConnections()
  await new Promise((resolve) => srv.close(resolve))
  const { closeDb } = await import('../src/db.mjs')
  await closeDb()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
// 正常释放句柄后自然退出；Windows上强制exit会触发libuv关闭断言。
