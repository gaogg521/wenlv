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
    seen.push({ h: req.headers, body: JSON.parse(b) })
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
} finally {
  reset(); srv.closeAllConnections(); srv.close()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
