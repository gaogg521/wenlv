// 蚂蚁链「合约模式」端到端（数据库）：后台接口加密保存凭据 → 自检/探测 → 切换入口 → 提交 → 确认，
// 以及回滚转人工、人工状态不自动重提、延迟出块后确认。链用 _fake-antchain.mjs 的合约状态机替身。
// 只能对隔离库运行；必须先起服务（PORT / API_BASE 指向隔离服务）。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/chain-contract-e2e.mjs')
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { q, one, closeDb } from '../src/db.mjs'
import { warmSecrets, delSecret } from '../src/infra/secrets.mjs'
import { startFake, ZERO } from './_fake-antchain.mjs'

// 本进程里的适配器（anchorToChain / confirmPending）不必等 TPS 间隔，也不必等回执轮询间隔
process.env.ANTOPEN_MIN_INTERVAL_MS = '0'
process.env.ANTOPEN_CONTRACT_POLL_MS = '0'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const call = async (m, p, b, tk) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(tk ? { authorization: 'Bearer ' + tk } : {}) }, body: b == null ? undefined : JSON.stringify(b) })).json()
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ok = (r) => { assert.equal(r.code, 0, r.msg); return r.data }
const A = ok(await call('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const F = await startFake({ publicKey })
const st = F.st
const touched = ['CHAIN_PROVIDER', 'ANTOPEN_REST_URL', 'ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID', 'ANTOPEN_CONTRACT_NAME']
const before = await one('SELECT COUNT(*) n FROM attest_batch WHERE status = 5')
assert.equal(Number(before.n), 0, '库里已有待确认批次，拒绝运行（confirmPending 会处理全库）')
const mkBatch = async () => {
  const last = await one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
  const root = crypto.randomBytes(32).toString('hex')
  const r = await q(`INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, merkle_version, status) VALUES (?,?,?,?,7,'test',2,1)`,
    [Number(last?.seq || 0) + 1, '2026-11-05', root, last?.merkle_root || null])
  return { id: r.insertId, root, dbPrev: last?.merkle_root || null }
}
let b1   // 第一个合约模式批次：后面几条要引用它的根
const rowOf = (id) => one('SELECT status, chain_provider, chain_tx_ref, chain_content, last_err FROM attest_batch WHERE id = ?', [id])

console.log('== 蚂蚁链合约模式端到端 ==')
try {
  await t('后台「链接入中心」里出现合约入口，且与内置存证是两个独立入口（不同 id，共用同一批凭据字段）', async () => {
    const h = ok(await call('GET', '/admin/chain/hub', null, A))
    const ids = h.providers.map((p) => p.id)
    assert.ok(ids.includes('antchainopen') && ids.includes('antchaincontract'))
    const dep = h.providers.find((p) => p.id === 'antchainopen').keys.map((k) => k.key)
    const ctr = h.providers.find((p) => p.id === 'antchaincontract').keys.map((k) => k.key)
    for (const k of ['ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID']) assert.ok(dep.includes(k) && ctr.includes(k), '两个入口应共用 ' + k)
    assert.ok(ctr.includes('ANTOPEN_CONTRACT_NAME') && !dep.includes('ANTOPEN_CONTRACT_NAME'))
    assert.ok(dep.includes('ANTOPEN_GAS') && !ctr.includes('ANTOPEN_GAS'), 'DEPOSIT 的 gas 只属于内置存证入口')
  })
  await t('保存合约入口凭据：私钥与托管 ID 加密入库、不回显；缺合约名时不能设为当前链', async () => {
    const vals = { ANTOPEN_REST_URL: F.url, ANTOPEN_ACCESS_ID: 'ak-ce', ANTOPEN_ACCESS_KEY: PEM, ANTOPEN_ACCOUNT: 'acct', ANTOPEN_KMS_ID: 'kms-ce-secret-1', ANTOPEN_TENANT_ID: 'TEN' }
    ok(await call('POST', '/admin/chain/creds/antchaincontract', { values: vals }, A))
    const r = await call('POST', '/admin/chain/activate', { provider: 'antchaincontract', confirm: 'antchaincontract' }, A)
    assert.equal(r.code, 1001); assert.match(r.msg, /缺少.*ANTOPEN_CONTRACT_NAME|ANTOPEN_CONTRACT_NAME/)
    ok(await call('POST', '/admin/chain/creds/antchaincontract', { values: { ANTOPEN_CONTRACT_NAME: 'WanderlustRootStore' } }, A))
    const h = ok(await call('GET', '/admin/chain/hub', null, A))
    const keys = h.providers.find((p) => p.id === 'antchaincontract').keys
    for (const k of ['ANTOPEN_ACCESS_KEY', 'ANTOPEN_KMS_ID']) { const x = keys.find((y) => y.key === k); assert.equal(x.value, null, k); assert.equal(x.configured, true, k) }
    assert.ok(!JSON.stringify(h).includes('kms-ce-secret-1') && !JSON.stringify(h).includes('BEGIN PRIVATE KEY'))
    const raw = await one("SELECT enc_value FROM app_secret WHERE k = 'ANTOPEN_ACCESS_KEY'")
    assert.ok(!Buffer.from(raw.enc_value).toString('utf8').includes('BEGIN PRIVATE KEY'), '库里是密文')
  })
  await t('离线自检通过；连通性探测：握手 + 块高 + 读合约链头（只读合约，不写）', async () => {
    assert.equal(ok(await call('POST', '/admin/chain/selftest/antchaincontract', {}, A)).ok, true)
    st.calls.length = 0
    const pr = ok(await call('POST', '/admin/chain/probe/antchaincontract', {}, A))
    assert.equal(pr.ok, true); assert.match(pr.detail, /合约链头 seq=0/)
    assert.equal(st.calls.filter((c) => c.sig && c.sig.startsWith('writeRoot')).length, 0, '探测不该写合约')
  })
  await t('设为当前链后提交：先读链头再写合约；批次记下 chain_provider=antchaincontract 与 chain_content（合约名/序号/前根/根）', async () => {
    ok(await call('POST', '/admin/chain/activate', { provider: 'antchaincontract', confirm: 'antchaincontract' }, A))
    await warmSecrets()
    const attest = await import('../src/domain/attest.mjs')
    const b = await mkBatch()
    const r = await attest.anchorToChain(b.id)
    assert.equal(r.submitted, true)
    const row = await rowOf(b.id)
    assert.equal(Number(row.status), 5); assert.equal(row.chain_provider, 'antchaincontract'); assert.match(row.chain_tx_ref, /^[0-9a-f]{64}$/)
    assert.equal(row.chain_content, `wl-contract/1|WanderlustRootStore|1|${ZERO}|${b.root}`)
    assert.equal(st.seq, 1)
    // 库里这一批的 prev_root 是上一批的根（若有），合约链独立起链、前根是 0：这正是合约模式的设计点
    assert.ok(b.dbPrev === null || b.dbPrev !== ZERO)
    b1 = b
  })
  await t('确认：回执成功 + getRoot 反查一致 → 已锚定，且 chain_provider 仍是合约入口', async () => {
    const attest = await import('../src/domain/attest.mjs')
    await attest.confirmPending()
    const row = await rowOf(b1.id)
    assert.equal(Number(row.status), 2); assert.equal(row.chain_provider, 'antchaincontract')
    const ev = await one('SELECT COUNT(*) n FROM attest_event WHERE batch_id = ? AND status <> 2', [b1.id])
    assert.equal(Number(ev.n), 0)
  })
  await t('第二批接在合约自己的链头后面：序号 2、前根 = 第一批的根（链上强制）', async () => {
    const attest = await import('../src/domain/attest.mjs')
    const b = await mkBatch(); await attest.anchorToChain(b.id); await attest.confirmPending()
    const row = await rowOf(b.id)
    assert.equal(Number(row.status), 2); assert.equal(row.chain_content, `wl-contract/1|WanderlustRootStore|2|${b1.root}|${b.root}`)
    assert.equal(st.roots.get(b.root).prev, b1.root)
  })
  await t('延迟出块：确认时保持待确认（不当成失败），出块后才变已锚定', async () => {
    const attest = await import('../src/domain/attest.mjs')
    st.autoMine = false
    const b = await mkBatch(); await attest.anchorToChain(b.id)
    await attest.confirmPending()
    assert.equal(Number((await rowOf(b.id)).status), 5, '没出块就不该已锚定')
    st.mine(); st.autoMine = true
    await attest.confirmPending()
    assert.equal(Number((await rowOf(b.id)).status), 2)
  })
  await t('合约回滚：确认阶段直接转人工（status=4 + risk_event，保留交易号），不进 5 次重试；人工状态不会被自动重提', async () => {
    const attest = await import('../src/domain/attest.mjs')
    st.forceRevert = true
    const b = await mkBatch(); await attest.anchorToChain(b.id)
    const sub = await rowOf(b.id)
    await attest.confirmPending()
    const row = await rowOf(b.id)
    assert.equal(Number(row.status), 4); assert.equal(row.chain_tx_ref, sub.chain_tx_ref, '要保留原交易号供人工核对'); assert.match(row.last_err, /合约拒绝/)
    const ev = await one(`SELECT detail FROM risk_event WHERE kind = 'attest_manual_review' ORDER BY id DESC LIMIT 1`)
    const det = typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail   // JSON 列：驱动可能已解析成对象
    assert.equal(det.code, 'CONTRACT_REVERT'); assert.equal(det.batchId, b.id)
    const writesBefore = st.calls.filter((c) => c.sig && c.sig.startsWith('writeRoot')).length
    const again = await attest.anchorToChain(b.id)
    assert.equal(again.skipped, true); assert.match(again.reason, /人工/)
    assert.equal(st.calls.filter((c) => c.sig && c.sig.startsWith('writeRoot')).length, writesBefore, '人工状态不该自动重新提交')
  })
  await t('链上状态与批次对不上（合约里叶数不符）→ ROOT_STATE_MISMATCH 转人工，不置为已锚定', async () => {
    const attest = await import('../src/domain/attest.mjs')
    const b = await mkBatch(); await attest.anchorToChain(b.id)
    st.getRootOverride = (r) => [true, 20261105, 999, r.seq, r.at]
    await attest.confirmPending(); st.getRootOverride = null
    const row = await rowOf(b.id)
    assert.equal(Number(row.status), 4); assert.match(row.last_err, /叶数/)
  })
} finally {
  await q(`DELETE FROM attest_batch WHERE merkle_kind = 'test'`)
  for (const k of touched) await delSecret(k)
  F.stop()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
await closeDb().catch(() => {})
