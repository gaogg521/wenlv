// 蚂蚁链开放联盟链适配器（不碰数据库）：本地假服务模拟握手验签 / DEPOSIT / QUERYTRANSACTION，
// 响应形状来自 2026-11-04 在真实开放联盟链上的实测（未上链 code=404、DEPOSIT 无回执、204 account config invalid）。
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import antopen, { toPem, contentOf, handshakeSecret } from '../src/infra/chain/antchain-open.mjs'

let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })

// ---------- 假服务 ----------
const st = { handshakes: 0, badSig: 0, tokens: new Set(), expireNext: false, txs: new Map(), deposits: [], depositCode: null, lastBlock: 185031200 }
const send = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (d) => (b += d))
  req.on('end', () => {
    const j = JSON.parse(b)
    if (req.url === '/api/contract/shakeHand') {
      const ok = crypto.verify('RSA-SHA256', Buffer.from(String(j.accessId) + String(j.time)), publicKey, Buffer.from(j.secret, 'hex'))
      if (!ok) { st.badSig++; return send(res, { success: false, code: '201', data: 'secret is not correct' }) }
      st.handshakes++
      const tok = 'tok-' + st.handshakes + '-' + crypto.randomBytes(4).toString('hex')
      st.tokens.add(tok)
      return send(res, { success: true, code: '200', data: tok })
    }
    if (!st.tokens.has(j.token) || st.expireNext) { st.expireNext = false; st.tokens.delete(j.token); return send(res, { success: false, code: '202', data: 'input token is not correct' }) }
    if (req.url === '/api/contract/chainCallForBiz') {
      st.deposits.push(j)
      if (st.depositCode) return send(res, { success: false, code: st.depositCode, data: 'account config invalid' })
      const hash = crypto.createHash('sha256').update(j.orderId + j.content).digest('hex')
      st.txs.set(hash, { block: 0, content: j.content })
      return send(res, { success: true, code: '200', data: hash })
    }
    if (req.url === '/api/contract/chainCall') {
      if (j.method === 'QUERYLASTBLOCK') return send(res, { success: true, code: '200', data: JSON.stringify({ block: { blockHeader: { number: st.lastBlock } } }) })
      if (j.method === 'QUERYTRANSACTION') {
        const tx = st.txs.get(j.hash)
        if (!tx) return send(res, { success: false, code: '404', data: '' })
        return send(res, { success: true, code: '200', data: JSON.stringify({ blockNumber: tx.block, hash: tx.hashOverride || j.hash, transactionDO: { data: Buffer.from(tx.content).toString('base64'), timestamp: 1, txType: 'DEPOSIT' } }) })
      }
    }
    send(res, { success: false, code: '500', data: 'unexpected ' + req.url })
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))

const KEYS = ['ANTOPEN_REST_URL', 'ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID', 'ANTOPEN_BIZID', 'ANTOPEN_GAS', 'ANTOPEN_MIN_INTERVAL_MS', 'ANTOPEN_WAIT_MAX_MS']
const reset = () => { for (const k of KEYS) delete process.env[k] }
let n = 0
const conf = (extra = {}) => { reset(); Object.assign(process.env, { ANTOPEN_REST_URL: `http://127.0.0.1:${srv.address().port}`, ANTOPEN_ACCESS_ID: 'ak-' + (++n), ANTOPEN_ACCESS_KEY: PEM, ANTOPEN_ACCOUNT: 'acct', ANTOPEN_KMS_ID: 'kms-id-1', ANTOPEN_TENANT_ID: 'TENANT1', ANTOPEN_MIN_INTERVAL_MS: '0', ...extra }) }
const ROOT = 'a'.repeat(64), PREV = 'b'.repeat(64)

console.log('== 蚂蚁链开放联盟链适配器 ==')
try {
  await t('缺任一必填项即 noop，列出缺项；配齐变 real；契约声明 confirm、不支持资产/反查', () => {
    reset(); assert.equal(antopen.mode(), 'noop'); assert.deepEqual(antopen.status().missing, ['ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID'])
    conf(); assert.equal(antopen.mode(), 'real'); assert.deepEqual(antopen.status().missing, [])
    assert.deepEqual(antopen.capabilities, { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true })
    delete process.env.ANTOPEN_TENANT_ID; assert.deepEqual(antopen.status().missing, ['ANTOPEN_TENANT_ID'])
  })
  await t('NOOP 永不返回伪交易号', async () => {
    reset(); const r = await antopen.anchor({ root: ROOT, bizDate: '2026-11-04' })
    assert.equal(r.txRef, null); assert.equal(r.mode, 'noop')
  })
  await t('握手签名 Hex(SHA256withRSA(accessId+time)) 能被公钥验过；私钥单行/\\n 转义/裸 base64 都能还原', () => {
    const s = handshakeSecret({ accessId: 'x', time: '123', privateKey: PEM })
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from('x123'), publicKey, Buffer.from(s, 'hex'))); assert.match(s, /^[0-9a-f]{512}$/)
    const bare = PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
    assert.equal(handshakeSecret({ accessId: 'x', time: '123', privateKey: PEM.replace(/\n/g, '\\n') }), s)
    assert.equal(handshakeSecret({ accessId: 'x', time: '123', privateKey: bare }), s)
    assert.throws(() => toPem(''), /为空/)
  })
  await t('anchor：DEPOSIT 请求体字段齐全；内容是确定性字符串；orderId 随根派生；token 缓存，同一进程只握手一次', async () => {
    conf(); Object.assign(st, { handshakes: 0, badSig: 0, depositCode: null }); st.deposits.length = 0
    const r = await antopen.anchor({ root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' })
    assert.match(r.txRef, /^[0-9a-f]{64}$/); assert.equal(r.mode, 'real'); assert.equal(st.badSig, 0)
    const d = st.deposits[0]
    assert.equal(d.method, 'DEPOSIT'); assert.equal(d.bizid, 'a00e36c5'); assert.equal(d.account, 'acct'); assert.equal(d.mykmsKeyId, 'kms-id-1')
    assert.equal(d.tenantid, 'TENANT1'); assert.equal(d.gas, 50000); assert.equal(d.orderId, 'wl_' + ROOT.slice(0, 32)); assert.ok(d.token && d.accessId)
    assert.equal(d.content, `wl-anchor/1|${ROOT}|${PREV}|20261104`)
    assert.equal(contentOf({ root: ROOT, prevRoot: '', bizDate: '2026-11-04' }), `wl-anchor/1|${ROOT}|${'0'.repeat(64)}|20261104`)
    await antopen.anchor({ root: 'c'.repeat(64), bizDate: '2026-11-04' })
    assert.equal(st.handshakes, 1, '第二次提交复用 token')
  })
  await t('gas / 链 ID 可配', async () => {
    conf({ ANTOPEN_GAS: '70000', ANTOPEN_BIZID: 'deadbeef' }); st.deposits.length = 0
    await antopen.anchor({ root: 'd'.repeat(64), bizDate: '2026-11-04' })
    assert.equal(st.deposits[0].gas, 70000); assert.equal(st.deposits[0].bizid, 'deadbeef')
  })
  await t('confirm：未上链(404) → 等待出块；上链后内容逐字一致 → final', async () => {
    conf()
    const r = await antopen.anchor({ root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' })
    const arg = { txRef: r.txRef, root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' }
    st.txs.get(r.txRef).block = 0
    assert.deepEqual(await antopen.confirm({ ...arg, txRef: 'f'.repeat(64) }), { final: false, reason: '等待出块', confirmations: 0 })
    assert.equal((await antopen.confirm(arg)).final, false, '块高 0 视为未出块')
    st.txs.get(r.txRef).block = 185031369
    assert.deepEqual(await antopen.confirm(arg), { final: true, block: '185031369', confirmations: 1 })
  })
  await t('confirm：链上内容与批次不一致 / 哈希不一致是硬错误，不是"再等等"', async () => {
    conf()
    const r = await antopen.anchor({ root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' })
    st.txs.get(r.txRef).block = 9
    await assert.rejects(() => antopen.confirm({ txRef: r.txRef, root: 'e'.repeat(64), prevRoot: PREV, bizDate: '2026-11-04' }),
      (e) => e.code === 'CONTENT_MISMATCH' && /链上内容与批次不一致/.test(e.message))
    await assert.rejects(() => antopen.confirm({ txRef: r.txRef, root: ROOT, prevRoot: 'e'.repeat(64), bizDate: '2026-11-04' }),
      (e) => e.code === 'CONTENT_MISMATCH')
    st.txs.get(r.txRef).hashOverride = '1'.repeat(64)
    await assert.rejects(() => antopen.confirm({ txRef: r.txRef, root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' }),
      (e) => e.code === 'TX_HASH_MISMATCH' && /哈希不一致/.test(e.message))
    await assert.rejects(() => antopen.confirm({ txRef: r.txRef }), /需要批次根与业务日期/)
  })
  // 实测：gas 偏低时接口返回 success + 哈希，但链上查无此交易。只当"等出块"会让批次永久卡在待确认。
  await t('confirm：查无此交易且已超过等待上限 → 硬错误 NOT_ON_CHAIN（转人工），未超时仍是等待出块', async () => {
    conf()
    const args = { txRef: 'f'.repeat(64), root: ROOT, prevRoot: PREV, bizDate: '2026-11-04' }
    assert.equal((await antopen.confirm({ ...args, submittedAt: new Date().toISOString() })).reason, '等待出块')
    await assert.rejects(() => antopen.confirm({ ...args, submittedAt: new Date(Date.now() - 11 * 60_000).toISOString() }),
      (e) => e.code === 'NOT_ON_CHAIN' && /仍未上链/.test(e.message) && /gas/.test(e.message))
  })
  await t('token 过期(202)：刷新后重试一次成功；不会重复上链多笔', async () => {
    conf(); st.handshakes = 0; st.deposits.length = 0
    await antopen.anchor({ root: '1'.repeat(64), bizDate: '2026-11-04' })
    st.expireNext = true
    const r = await antopen.anchor({ root: '2'.repeat(64), bizDate: '2026-11-04' })
    assert.match(r.txRef, /^[0-9a-f]{64}$/); assert.equal(st.handshakes, 2, '过期后重新握手一次')
    // 假服务在 token 校验处就拒绝过期请求（不会执行、不记账）：这个 orderId 只应落一笔，且重试用的就是同一个 orderId
    assert.equal(st.deposits.filter((d) => d.orderId === 'wl_' + '2'.repeat(32)).length, 1, '被拒的那次没有执行，只有重试那一笔入账')
    assert.equal(st.deposits.length, 2, '两次提交共两笔，没有重复')
  })
  await t('业务失败：204 抛错（带错误码），握手签名错误也抛错；报错里不回显长令牌', async () => {
    conf(); st.depositCode = '204'
    await assert.rejects(() => antopen.anchor({ root: '3'.repeat(64), bizDate: '2026-11-04' }), /antchain-open 204: account config invalid/)
    st.depositCode = null
    conf({ ANTOPEN_ACCESS_KEY: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) })
    await assert.rejects(() => antopen.anchor({ root: '4'.repeat(64), bizDate: '2026-11-04' }), /握手失败 201/)
    await assert.rejects(() => antopen.anchor({ root: 'xyz', bizDate: '2026-11-04' }), /64 位十六进制/)
  })
  await t('probe：握手 + 查最新块高（只读）；缺配置时报缺项', async () => {
    conf(); st.deposits.length = 0
    const r = await antopen.probe()
    assert.equal(r.ok, true); assert.match(r.detail, /当前块高 185031200/); assert.equal(st.deposits.length, 0, '探测不产生交易')
    reset(); await assert.rejects(() => antopen.probe(), /未配置完整/)
  })
  await t('离线自检通过；已配私钥无法解析时自检失败', () => {
    reset(); assert.equal(antopen.selfTest().ok, true)
    process.env.ANTOPEN_ACCESS_KEY = 'not a key!!'; assert.equal(antopen.selfTest().ok, false)
    process.env.ANTOPEN_ACCESS_KEY = PEM; assert.equal(antopen.selfTest().detail.accessKey, '可解析')
  })
} finally {
  reset(); srv.closeAllConnections(); srv.close()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
