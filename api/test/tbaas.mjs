// TBaaS 适配器（不碰数据库）：用本地假服务模拟腾讯云，验证两种形态的请求格式与响应解析。
// 响应样例来自 2026-11-02 在长安链体验网络的真实调用（Response.Result.TxId / Result.Code）。
import http from 'node:http'
import assert from 'node:assert/strict'
import tbaas, { renderParamTemplate } from '../src/infra/chain/tbaas.mjs'

let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

let reply = null
const seen = []
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (d) => (b += d))
  req.on('end', () => {
    seen.push({ h: req.headers, body: JSON.parse(b), at: Date.now() })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(reply))
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))

const KEYS = ['TBAAS_SECRET_ID', 'TBAAS_SECRET_KEY', 'TBAAS_ENDPOINT', 'TBAAS_CLUSTER_ID', 'TBAAS_CHANNEL', 'TBAAS_CHAIN_ID', 'TBAAS_CONTRACT',
  'TBAAS_PARAM_TEMPLATE', 'TBAAS_ACTION', 'TBAAS_VERSION', 'TBAAS_REGION', 'TBAAS_ROOT_FUNC']
const reset = () => { for (const k of KEYS) delete process.env[k] }
const base = () => Object.assign(process.env, { TBAAS_SECRET_ID: 'AKIDdummy', TBAAS_SECRET_KEY: 'dummy', TBAAS_CLUSTER_ID: 'chainmaker-demo', TBAAS_ENDPOINT: `http://127.0.0.1:${srv.address().port}` })
const ROOT = 'a'.repeat(64)
const TX = '18e434fc6ce512aacabb57546b8e4b771d8619f230744d0386b5f13acfa17a0a'

console.log('== TBaaS 适配器 ==')
try {
  await t('缺通道与链 ID 时不可用；配了任一个即可', () => {
    reset(); base()
    assert.equal(tbaas.mode(), 'noop'); assert.match(tbaas.status().missing.join(), /TBAAS_CHANNEL 或 TBAAS_CHAIN_ID/)
    process.env.TBAAS_CHANNEL = 'ch1'; assert.equal(tbaas.mode(), 'real')
    delete process.env.TBAAS_CHANNEL; process.env.TBAAS_CHAIN_ID = 'chain_demo'; assert.equal(tbaas.mode(), 'real')
  })
  await t('Fabric 形态（默认）：数组入参 + ChannelId，旧响应 Response.Txid 照常解析', async () => {
    reset(); base(); process.env.TBAAS_CHANNEL = 'ch1'; seen.length = 0
    reply = { Response: { RequestId: 'r', Txid: 'LEGACYTX', BlockNumber: 7 } }
    const r = await tbaas.anchor({ root: ROOT, prevRoot: null, bizDate: '2026-11-02' })
    assert.equal(r.txRef, 'LEGACYTX'); assert.equal(r.block, '7')
    const s = seen[0]
    assert.equal(s.h['x-tc-action'], 'Invoke'); assert.equal(s.h['x-tc-version'], '2020-04-17'); assert.equal(s.h['x-tc-region'], 'ap-shanghai')
    assert.equal(s.body.ChannelId, 'ch1'); assert.equal(s.body.ChainId, undefined); assert.equal(s.body.ContractName, undefined)
    assert.deepEqual(JSON.parse(s.body.FuncParam), [ROOT, '0'.repeat(64), 20261102])
  })
  await t('长安链形态：Action/版本/地域可配，入参是字符串键值对象，交易号取自 Response.Result.TxId', async () => {
    reset(); base(); seen.length = 0
    Object.assign(process.env, { TBAAS_CHAIN_ID: 'chain_demo', TBAAS_CONTRACT: 'ChainMakerDemo', TBAAS_ACTION: 'InvokeChainMakerDemoContract',
      TBAAS_VERSION: '2018-04-16', TBAAS_REGION: 'ap-beijing', TBAAS_ROOT_FUNC: 'save',
      TBAAS_PARAM_TEMPLATE: '{"key":"{root}","field":"merkle_root","value":"{prevRoot}|{bizDate}"}' })
    reply = { Response: { RequestId: 'r', Result: { Code: 0, CodeMessage: 'Success', Message: 'Success', TxId: TX } } }
    const r = await tbaas.anchor({ root: ROOT, prevRoot: 'b'.repeat(64), bizDate: '2026-11-02' })
    assert.equal(r.txRef, TX); assert.equal(r.mode, 'real')
    const s = seen[0]
    assert.equal(s.h['x-tc-action'], 'InvokeChainMakerDemoContract'); assert.equal(s.h['x-tc-version'], '2018-04-16'); assert.equal(s.h['x-tc-region'], 'ap-beijing')
    assert.equal(s.body.ChainId, 'chain_demo'); assert.equal(s.body.ContractName, 'ChainMakerDemo'); assert.equal(s.body.ChannelId, undefined)
    assert.equal(s.body.FuncName, 'save')
    assert.deepEqual(JSON.parse(s.body.FuncParam), { key: ROOT, field: 'merkle_root', value: 'b'.repeat(64) + '|20261102' })
  })
  await t('Result.Code 不为 0 视为合约执行失败，不记成功', async () => {
    reset(); base(); process.env.TBAAS_CHAIN_ID = 'chain_demo'
    reply = { Response: { RequestId: 'r', Result: { Code: 4, CodeMessage: 'CONTRACT_FAIL', Message: 'bad', TxId: TX } } }
    await assert.rejects(() => tbaas.anchor({ root: ROOT, bizDate: '2026-11-02' }), /合约执行失败: Code 4 CONTRACT_FAIL/)
  })
  await t('Response.Error 与缺交易号照旧报错', async () => {
    reset(); base(); process.env.TBAAS_CHAIN_ID = 'chain_demo'
    reply = { Response: { RequestId: 'r', Error: { Code: 'AuthFailure', Message: 'denied' } } }
    await assert.rejects(() => tbaas.anchor({ root: ROOT, bizDate: '2026-11-02' }), /AuthFailure denied/)
    reply = { Response: { RequestId: 'r', Result: { Code: 0 } } }
    await assert.rejects(() => tbaas.anchor({ root: ROOT, bizDate: '2026-11-02' }), /缺少 Txid/)
  })
  await t('入参模板：非对象报错，值一律转成字符串', () => {
    assert.throws(() => renderParamTemplate('[1,2]', { root: 'r', prevRoot: 'p', bizDate: 1 }), /JSON 对象/)
    assert.deepEqual(renderParamTemplate('{"n":{bizDate},"k":"{root}"}', { root: 'r', prevRoot: 'p', bizDate: 20261102 }), { n: '20261102', k: 'r' })
  })
  await t('离线自检仍通过', () => { assert.equal(tbaas.selfTest().ok, true) })
  const demo = () => {
    reset(); base(); Object.assign(process.env, { TBAAS_CHAIN_ID: 'chain_demo', TBAAS_CONTRACT: 'ChainMakerDemo',
      TBAAS_ACTION: 'InvokeChainMakerDemoContract', TBAAS_VERSION: '2018-04-16', TBAAS_REGION: 'ap-beijing' })
  }
  await t('体验网络按 TxID 回查并等待终局；Fabric 不声明确认能力', async () => {
    demo(); seen.length = 0
    assert.equal(tbaas.capabilities.confirm, true)
    reply = { Response: { RequestId: 'receipt-r', Result: { Code: 0, TxId: TX, BlockHeight: 277493 } } }
    assert.deepEqual(await tbaas.confirm({ txRef: TX }), { final: true, block: '277493', confirmations: 1 })
    assert.equal(seen[0].h['x-tc-action'], 'QueryChainMakerDemoTransaction')
    assert.deepEqual(seen[0].body, { ClusterId: 'chainmaker-demo', ChainId: 'chain_demo', TxID: TX })
    reply.Response.Result.BlockHeight = 0
    assert.equal((await tbaas.confirm({ txRef: TX })).final, false)
    reset(); base(); process.env.TBAAS_CHANNEL = 'ch1'
    assert.equal(tbaas.capabilities.confirm, false)
    await assert.rejects(() => tbaas.confirm({ txRef: TX }), /仅支持长安链体验网络/)
  })
  await t('错误回执不得记终局：失败、交易号错、缺 Code、无效块高', async () => {
    demo()
    for (const [result, error] of [
      [{ Code: 4, TxId: TX, BlockHeight: 1 }, /合约执行失败/],
      [{ Code: 0, TxId: 'b'.repeat(64), BlockHeight: 1 }, /交易号不一致/],
      [{ TxId: TX, BlockHeight: 1 }, /缺少结果码/],
      [{ Code: 0, TxId: TX, BlockHeight: -1 }, /区块高度无效/],
      [{ Code: 0, TxId: TX }, /区块高度无效/],
    ]) {
      reply = { Response: { Result: result } }
      await assert.rejects(() => tbaas.confirm({ txRef: TX }), error)
    }
    await assert.rejects(() => tbaas.queryTransaction('bad-id'), /64 位/)
  })
  await t('只读探测确实调用查询接口、base64 解码且不提交交易', async () => {
    demo(); seen.length = 0
    reply = { Response: { RequestId: 'query-r', Result: { Code: 0, Result: Buffer.from('test-issued').toString('base64') } } }
    assert.equal((await tbaas.readDemoValue('wenlv-test-001', 'ticket_status')).value, 'test-issued')
    assert.equal((await tbaas.probe()).ok, true)
    assert.ok(seen.every(s => s.h['x-tc-action'] === 'QueryChainMakerDemoContract'))
    assert.deepEqual(JSON.parse(seen[0].body.FuncParam), { key: 'wenlv-test-001', field: 'ticket_status' })
  })
  await t('并发请求间隔至少 1 秒，失败后队列仍可继续且不重发写交易', async () => {
    demo(); seen.length = 0
    reply = { Response: { Error: { Code: 'RequestLimitExceeded', Message: 'rate limited' } } }
    await assert.rejects(() => tbaas.anchor({ root: ROOT }), /RequestLimitExceeded/)
    reply = { Response: { Result: { Code: 0, TxId: TX, BlockHeight: 8 } } }
    await Promise.all([tbaas.confirm({ txRef: TX }), tbaas.confirm({ txRef: TX })])
    assert.equal(seen.length, 3)
    assert.equal(seen.filter(s => s.h['x-tc-action'] === 'InvokeChainMakerDemoContract').length, 1)
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].at - seen[i - 1].at >= 1000)
  })
  if (process.env.DB_NAME) {
    const { assertIsolatedDb } = await import('./_guard.mjs')
    assertIsolatedDb('test/tbaas.mjs')
    const { q, one } = await import('../src/db.mjs')
    const attest = await import('../src/domain/attest.mjs')
    const created = []
    const savedProvider = process.env.CHAIN_PROVIDER
    try {
      demo(); process.env.CHAIN_PROVIDER = 'tbaas'
      const last = await one('SELECT seq FROM attest_batch ORDER BY seq DESC LIMIT 1')
      for (let i = 1; i <= 2; i++) {
        const r = await q(`INSERT INTO attest_batch (seq,biz_date,merkle_root,leaf_count,merkle_kind,merkle_version,status)
          VALUES (?,CURDATE(),?,0,'tbaas-unit',2,1)`, [Number(last?.seq || 0) + i, String(i).repeat(64)])
        created.push(r.insertId)
      }
      await t('隔离库：提交仅进入 5；指定批次确认进入 2，另一批次保持 5', async () => {
        reply = { Response: { Result: { Code: 0, TxId: TX } } }
        for (const id of created) assert.equal((await attest.anchorToChain(id)).submitted, true)
        assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id=?', [created[0]])).status), 5)
        reply = { Response: { Result: { Code: 0, TxId: TX, BlockHeight: 277493 } } }
        assert.equal((await attest.confirmBatch(created[0])).anchored, true)
        assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id=?', [created[0]])).status), 2)
        assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id=?', [created[1]])).status), 5)
      })
      await t('隔离库：重复确认已终局批次不再发请求；待确认空块高保持 5', async () => {
        const n = seen.length
        assert.equal((await attest.confirmBatch(created[0])).anchored, true)
        assert.equal(seen.length, n)
        reply = { Response: { Result: { Code: 0, TxId: TX, BlockHeight: 0 } } }
        assert.equal((await attest.confirmBatch(created[1])).pending, true)
        assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id=?', [created[1]])).status), 5)
      })
      await t('隔离库：待确认期间改成不支持确认的配置，不得直接当成功', async () => {
        process.env.TBAAS_ACTION = 'Invoke'
        const r = await attest.confirmBatch(created[1])
        assert.equal(r.pending, true)
        assert.match(r.reason, /不支持回执确认/)
        assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id=?', [created[1]])).status), 5)
      })
    } finally {
      for (const id of created) await q('DELETE FROM attest_batch WHERE id=?', [id])
      if (savedProvider === undefined) delete process.env.CHAIN_PROVIDER
      else process.env.CHAIN_PROVIDER = savedProvider
      // mysql2 连接池在此进程内仍有连接；用正常关闭助手释放，避免 Windows 强制退出断言。
      const { closeDb } = await import('../src/db.mjs')
      await closeDb()
    }
  }
} finally {
  reset(); srv.closeAllConnections(); srv.close()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
