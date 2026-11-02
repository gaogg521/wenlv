// 链接入中心端到端：后台配置凭据（加密）→ 探测 → 切换 → 提交 → 回调/回执确认 → 跨链切换后旧批次回原链核验
// 用本地假服务同时模拟：通用联盟链网关、FISCO BCOS WeBASE-Front、EVM RPC。只能对隔离库运行。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/chain-hub.mjs')
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { q, one } from '../src/db.mjs'
import { warmSecrets, delSecret } from '../src/infra/secrets.mjs'
import { sign as gwSign } from '../src/infra/chain/gateway.mjs'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, t, h = {}) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), ...h }, body: b == null ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)) })).json()
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
const FIN = ok(await call('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

// ---------- 假服务 ----------
const seen = { gwSig: null, gwBody: null }
let fiscoHead = 100
const fiscoTx = new Map()
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/gw/health') return send({ code: 0 })
    if (req.url === '/gw/api/anchor') { seen.gwSig = req.headers['x-signature']; seen.gwBody = body; return send({ code: 0, data: { txId: 'GW' + crypto.randomBytes(8).toString('hex') } }) }
    if (req.url === '/WeBASE-Front/trans/handle') {
      const j = JSON.parse(body); const h = '0x' + crypto.randomBytes(32).toString('hex')
      fiscoTx.set(h, { root: j.funcParam[0] }); return send({ transactionHash: h, status: '0x0' })
    }
    if (req.url.startsWith('/WeBASE-Front/group0/web3/transactionReceipt/')) return send({ blockNumber: '0x' + (++fiscoHead).toString(16), status: '0x0' })
    if (req.url === '/WeBASE-Front/group0/web3/blockNumber') return send(fiscoHead)
    if (req.url === '/rpc') { const j = JSON.parse(body); return send({ jsonrpc: '2.0', id: j.id, result: j.method === 'eth_chainId' ? '0x1' : '0x10' }) }
    send({ code: 404 }, 404)
  })
})
await new Promise((r) => srv.listen(0, r))
const FAKE = 'http://127.0.0.1:' + srv.address().port
const SECRET = 'gw-secret-' + Date.now()
const touched = ['CHAIN_PROVIDER', 'GW_ENDPOINT', 'GW_SECRET', 'GW_APP_ID', 'GW_ANCHOR_PATH', 'GW_BODY_TEMPLATE', 'GW_TX_PATH', 'GW_OK_PATH', 'GW_OK_VALUE', 'GW_ASYNC', 'GW_SIGN_ALGO', 'GW_PROBE_PATH',
  'GW_BLOCK_PATH', 'GW_RECEIPT_PATH', 'GW_FINAL_PATH', 'GW_FINAL_VALUE', 'FISCO_FRONT_URL', 'FISCO_USER', 'FISCO_CONTRACT_ADDRESS', 'EVM_NETWORK', 'EVM_RPC_URL']
const before = await one('SELECT COUNT(*) n FROM attest_batch WHERE status = 5')
assert.equal(Number(before.n), 0, '库里已有待确认批次，拒绝运行')
const mkBatch = async () => {
  const last = await one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
  const root = crypto.randomBytes(32).toString('hex')
  const r = await q(`INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, merkle_version, status) VALUES (?,?,?,?,1,'test',2,1)`,
    [Number(last?.seq || 0) + 1, '2026-11-02', root, last?.merkle_root || null])
  return { id: r.insertId, root }
}

console.log('== 链接入中心 ==')
try {
  await t('目录包含联盟链（含 FISCO / 通用网关）与公链，网络与网关模板已预置', async () => {
    const h = ok(await call('GET', '/admin/chain/hub', null, A))
    const ids = h.providers.map((p) => p.id)
    for (const id of ['chaingen', 'tbaas', 'antchain', 'fisco', 'gateway', 'evm']) assert.ok(ids.includes(id), id)
    assert.ok(h.networks.conflux && h.networks.polygon); assert.ok(h.gatewayPresets.chainmaker && h.gatewayPresets.bsn)
  })
  await t('非超管不能访问；不属于该链的配置项与非法地址被拒', async () => {
    assert.equal((await call('GET', '/admin/chain/hub', null, FIN)).code, 1003)
    assert.equal((await call('POST', '/admin/chain/creds/gateway', { values: { WX_SECRET: 'x' } }, A)).code, 1001)
    assert.equal((await call('POST', '/admin/chain/creds/gateway', { values: { GW_ENDPOINT: 'ftp://x' } }, A)).code, 1001)
    assert.equal((await call('POST', '/admin/chain/creds/gateway', { values: { GW_BODY_TEMPLATE: '{bad' } }, A)).code, 1001)
  })
  await t('套用长安链模板 → 填写网关凭据（加密保存、密钥不回显）', async () => {
    ok(await call('POST', '/admin/chain/preset/gateway', { preset: 'chainmaker' }, A))
    const r = ok(await call('POST', '/admin/chain/creds/gateway', { values: { GW_ENDPOINT: FAKE + '/gw', GW_SECRET: SECRET, GW_APP_ID: 'wl-app', GW_ANCHOR_PATH: '/api/anchor',
      GW_BODY_TEMPLATE: '{"root":"{root}","prev":"{prevRoot}","date":"{bizDate}"}', GW_TX_PATH: 'data.txId', GW_OK_PATH: 'code', GW_OK_VALUE: '0', GW_ASYNC: '1', GW_SIGN_ALGO: 'hmac-sm3', GW_PROBE_PATH: '/health' } }, A))
    assert.equal(r.status.mode, 'real')
    const h = ok(await call('GET', '/admin/chain/hub', null, A))
    const k = h.providers.find((p) => p.id === 'gateway').keys.find((x) => x.key === 'GW_SECRET')
    assert.equal(k.value, null); assert.equal(k.configured, true)
    assert.ok(!JSON.stringify(h).includes(SECRET), '密钥不得出现在任何响应里')
    const raw = await one("SELECT enc_value FROM app_secret WHERE k = 'GW_SECRET'")
    assert.ok(!Buffer.from(raw.enc_value).toString('utf8').includes(SECRET), '库里是密文')
  })
  await t('离线自检与连通性探测', async () => {
    assert.equal(ok(await call('POST', '/admin/chain/selftest/gateway', {}, A)).ok, true)
    assert.equal(ok(await call('POST', '/admin/chain/probe/gateway', {}, A)).ok, true)
  })
  await t('切换当前链需输入链标识确认', async () => {
    assert.equal((await call('POST', '/admin/chain/activate', { provider: 'gateway', confirm: 'x' }, A)).code, 1001)
    assert.equal(ok(await call('POST', '/admin/chain/activate', { provider: 'gateway', confirm: 'gateway' }, A)).current, 'gateway')
  })
  let gwBatch
  await t('网关异步：提交后待确认；请求按国密 HMAC-SM3 签名、请求体按模板生成', async () => {
    await warmSecrets()
    const attest = await import('../src/domain/attest.mjs')
    gwBatch = await mkBatch()
    const r = await attest.anchorToChain(gwBatch.id)
    assert.equal(r.submitted, true)
    const b = await one('SELECT status, chain_provider, chain_tx_ref FROM attest_batch WHERE id = ?', [gwBatch.id])
    assert.equal(Number(b.status), 5); assert.equal(b.chain_provider, 'gateway')
    assert.equal(JSON.parse(seen.gwBody).root, gwBatch.root)
    assert.match(seen.gwSig, /^[0-9a-f]{64}$/)
    gwBatch.tx = b.chain_tx_ref
  })
  await t('回调：验签失败拒绝；验签通过且根一致才置为已锚定', async () => {
    const path = '/callback/chain/gateway'
    const body = JSON.stringify({ txId: gwBatch.tx, root: gwBatch.root, blockHeight: 88 })
    const bad = await call('POST', path, body, null, { 'x-timestamp': String(Date.now()), 'x-nonce': 'n1', 'x-signature': 'f'.repeat(64) })
    assert.equal(bad.code, 1003)
    const ts = String(Date.now())
    const wrongRoot = JSON.stringify({ txId: gwBatch.tx, root: 'ab'.repeat(32) })
    const s1 = gwSign({ algo: 'hmac-sm3', secret: SECRET, tpl: '{method}\\n{path}\\n{ts}\\n{nonce}\\n{body}', method: 'POST', path, ts, nonce: 'n2', body: wrongRoot })
    assert.equal(ok(await call('POST', path, wrongRoot, null, { 'x-timestamp': ts, 'x-nonce': 'n2', 'x-signature': s1 })).matched, false)
    const s2 = gwSign({ algo: 'hmac-sm3', secret: SECRET, tpl: '{method}\\n{path}\\n{ts}\\n{nonce}\\n{body}', method: 'POST', path, ts, nonce: 'n3', body })
    assert.equal(ok(await call('POST', path, body, null, { 'x-timestamp': ts, 'x-nonce': 'n3', 'x-signature': s2 })).matched, true)
    assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id = ?', [gwBatch.id])).status), 2)
  })
  await t('切到 FISCO BCOS：经 WeBASE-Front 提交，回执确认后已锚定', async () => {
    ok(await call('POST', '/admin/chain/creds/fisco', { values: { FISCO_FRONT_URL: FAKE, FISCO_USER: '0xabc', FISCO_CONTRACT_ADDRESS: '0xdef' } }, A))
    assert.equal(ok(await call('POST', '/admin/chain/probe/fisco', {}, A)).ok, true)
    ok(await call('POST', '/admin/chain/activate', { provider: 'fisco', confirm: 'fisco' }, A))
    await warmSecrets()
    const attest = await import('../src/domain/attest.mjs')
    const b = await mkBatch()
    await attest.anchorToChain(b.id)
    assert.equal(Number((await one('SELECT status FROM attest_batch WHERE id = ?', [b.id])).status), 5)
    await attest.confirmPending()
    const r = await one('SELECT status, chain_provider FROM attest_batch WHERE id = ?', [b.id])
    assert.equal(Number(r.status), 2); assert.equal(r.chain_provider, 'fisco')
    const tx = [...fiscoTx.values()].pop()
    assert.equal(tx.root, '0x' + b.root, '链上写入的是这枚根（bytes32）')
  })
  await t('切换后旧链批次仍回原链核验，不被新链误确认', async () => {
    ok(await call('POST', '/admin/chain/activate', { provider: 'gateway', confirm: 'gateway' }, A))
    await warmSecrets()
    const attest = await import('../src/domain/attest.mjs')
    const b = await mkBatch()
    await attest.anchorToChain(b.id) // 网关异步 → 5
    ok(await call('POST', '/admin/chain/activate', { provider: 'fisco', confirm: 'fisco' }, A))
    await warmSecrets()
    await attest.confirmPending() // 网关无回执路径：应保持待确认，而不是被 FISCO 去确认
    const r = await one('SELECT status, chain_provider FROM attest_batch WHERE id = ?', [b.id])
    assert.equal(Number(r.status), 5); assert.equal(r.chain_provider, 'gateway')
  })
  await t('EVM：选网络带出 chainId；RPC 实际 chainId 不一致时探测报错（防接错网络）', async () => {
    ok(await call('POST', '/admin/chain/preset/evm', { preset: 'polygon' }, A))
    ok(await call('POST', '/admin/chain/creds/evm', { values: { EVM_RPC_URL: FAKE + '/rpc' } }, A))
    const r = ok(await call('POST', '/admin/chain/probe/evm', {}, A))
    assert.equal(r.ok, false); assert.match(r.detail, /不一致/)
  })
  await t('凭据不完整的链不能设为当前链', async () => {
    const r = await call('POST', '/admin/chain/activate', { provider: 'tbaas', confirm: 'tbaas' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /缺少/)
  })
} finally {
  await q(`DELETE FROM attest_batch WHERE merkle_kind = 'test'`)
  for (const k of touched) await delSecret(k)
  srv.close()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
process.exit(process.exitCode || 0)
