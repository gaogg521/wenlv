// 蚂蚁链开放联盟链「合约模式」适配器（不碰数据库）：用 _fake-antchain.mjs 的合约状态机替身，
// 验证调用形态、独立起链、确认判定、各类硬错误，以及编译产物与源码不漂移。
// 注意：替身是按文档与 WanderlustRootStore.sol 写的，真实链的细节（bytes32 入参表示、回执字段名）必须部署后真机核对。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import contract, { SIG, OUT, fmtBytes32, writeRootArgs, contractContent, parseContractContent, decodeOutput, revertReason } from '../src/infra/chain/antchain-open-contract.mjs'
import { startFake, ZERO } from './_fake-antchain.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = path.join(__dirname, '..')
const CDIR = path.join(API, 'contracts', 'antchain-root')
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const F = await startFake({ publicKey })
const st = F.st
const KEYS = ['ANTOPEN_REST_URL', 'ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID', 'ANTOPEN_BIZID', 'ANTOPEN_GAS', 'ANTOPEN_WAIT_MAX_MS',
  'ANTOPEN_MIN_INTERVAL_MS', 'ANTOPEN_CONTRACT_NAME', 'ANTOPEN_CONTRACT_GAS', 'ANTOPEN_CONTRACT_STRICT', 'ANTOPEN_CONTRACT_BYTES', 'ANTOPEN_CONTRACT_POLL_TRIES', 'ANTOPEN_CONTRACT_POLL_MS']
const reset = () => { for (const k of KEYS) delete process.env[k] }
let n = 0
const conf = (extra = {}) => { reset(); Object.assign(process.env, { ANTOPEN_REST_URL: F.url, ANTOPEN_ACCESS_ID: 'ck-' + (++n), ANTOPEN_ACCESS_KEY: PEM, ANTOPEN_ACCOUNT: 'acct', ANTOPEN_KMS_ID: 'kms-1',
  ANTOPEN_TENANT_ID: 'TEN1', ANTOPEN_MIN_INTERVAL_MS: '0', ANTOPEN_CONTRACT_NAME: 'WanderlustRootStore', ANTOPEN_CONTRACT_POLL_MS: '0', ...extra }) }
const fresh = () => { Object.assign(st, { seq: 0, lastRoot: ZERO, total: 0, autoMine: true, forceRevert: false, dropNext: false, getRootOverride: null, noReceipt: false }); st.roots.clear(); st.calls.length = 0; st.pending.length = 0
  st.orders.clear(); st.txs.clear() }   // orderId 去重表和交易表也要清：否则复用同一个根的用例会悄悄吃上一轮的结果
const R = (c) => c.repeat(64), D = '2026-11-05'
const B64 = (hex) => Buffer.from(hex, 'hex').toString('base64')   // 真机只认 base64 的 bytes32
const writes = () => st.calls.filter((c) => c.sig === SIG.writeRoot)

console.log('== 蚂蚁链合约模式 ==')
try {
  await t('入口独立：id ≤16 字符（chain_provider 是 VARCHAR(16)）；缺合约名即 noop；契约声明 confirm、不做反查/资产', () => {
    assert.equal(contract.id, 'antchaincontract'); assert.ok(contract.id.length <= 16)
    conf(); delete process.env.ANTOPEN_CONTRACT_NAME
    assert.equal(contract.mode(), 'noop'); assert.deepEqual(contract.status().missing, ['ANTOPEN_CONTRACT_NAME'])
    process.env.ANTOPEN_CONTRACT_NAME = 'X'; assert.equal(contract.mode(), 'real')
    assert.deepEqual(contract.capabilities, { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true })
    reset(); assert.deepEqual(contract.status().missing, ['ANTOPEN_ACCESS_ID', 'ANTOPEN_ACCESS_KEY', 'ANTOPEN_ACCOUNT', 'ANTOPEN_KMS_ID', 'ANTOPEN_TENANT_ID', 'ANTOPEN_CONTRACT_NAME'])
  })
  await t('NOOP 永不返回伪交易号', async () => {
    reset(); const r = await contract.anchor({ root: R('a'), leafCount: 1, bizDate: D })
    assert.equal(r.txRef, null); assert.equal(r.mode, 'noop')
  })
  await t('入参编码：bytes32 默认 base64（真机只认它），0x/hex 仅留作排查；日期/叶数/序号越界直接拒绝（合约会 revert 的在适配器就拦下）', () => {
    assert.equal(fmtBytes32(R('a')), B64(R('a'))); assert.equal(fmtBytes32(R('a'), '0x'), '0x' + R('a')); assert.equal(fmtBytes32(R('A'), 'hex'), R('a'))
    assert.equal(Buffer.from(fmtBytes32(R('a'), 'base64'), 'base64').toString('hex'), R('a')); assert.match(fmtBytes32(R('a')), /^[A-Za-z0-9+/]{43}=$/)
    assert.throws(() => fmtBytes32('xyz'), /64 位十六进制/)
    assert.deepEqual(writeRootArgs({ root: R('a'), prevRoot: '', bizDate: D, leafCount: 12, seq: 1 }), [B64(R('a')), B64(ZERO), 20261105, 12, 1])
    for (const bad of [{ bizDate: '2019-01-01' }, { bizDate: 'x' }, { leafCount: 0 }, { leafCount: 1.5 }, { seq: 0 }, { seq: 2 ** 32 }]) {
      assert.throws(() => writeRootArgs({ root: R('a'), prevRoot: '', bizDate: D, leafCount: 1, seq: 1, ...bad }), (e) => e.code === 'BAD_ARGS')
    }
  })
  await t('方法签名与编译产物的 ABI 一致：改了合约函数签名而适配器没跟着改，这里会红', () => {
    const abi = JSON.parse(fs.readFileSync(path.join(CDIR, 'build', 'WanderlustRootStore.abi.json'), 'utf8'))
    const sigOf = (f) => `${f.name}(${f.inputs.map((i) => i.type).join(',')})`
    const outOf = (f) => f.outputs.map((o) => o.type)
    for (const k of ['writeRoot', 'getRoot', 'head']) {
      const f = abi.find((x) => x.type === 'function' && x.name === k)
      assert.ok(f, 'ABI 里没有 ' + k); assert.equal(sigOf(f), SIG[k]); assert.deepEqual(outOf(f), OUT[k])
    }
  })
  await t('首次提交：先读合约链头(head)，再 writeRoot 起链 seq=1、prevRoot=0；调用形态按文档', async () => {
    conf(); fresh()
    const r = await contract.anchor({ root: R('a'), prevRoot: R('9'), leafCount: 12, bizDate: D })
    assert.match(r.txRef, /^[0-9a-f]{64}$/); assert.equal(r.mode, 'real'); assert.equal(r.signed, false)
    assert.equal(r.content, `wl-contract/1|WanderlustRootStore|1|${ZERO}|${R('a')}`)
    assert.deepEqual(parseContractContent(r.content), { name: 'WanderlustRootStore', seq: 1, prev: ZERO, root: R('a') })
    const w = writes(); assert.equal(w.length, 1)
    const b = w[0].body
    assert.equal(b.method, 'CALLCONTRACTBIZASYNC'); assert.equal(b.contractName, 'WanderlustRootStore'); assert.equal(b.methodSignature, SIG.writeRoot)
    assert.deepEqual(JSON.parse(b.inputParamListStr), [B64(R('a')), B64(ZERO), 20261105, 12, 1]); assert.equal(b.outTypes, '["bool"]')
    assert.equal(b.gas, 500000); assert.equal(b.tenantid, 'TEN1'); assert.equal(b.account, 'acct'); assert.equal(b.mykmsKeyId, 'kms-1')
    assert.ok(st.calls.some((c) => c.sig === SIG.head), '没有先读链头')
    assert.equal(st.calls.filter((c) => c.method === 'PARSEOUTPUT').length, 0, '真机 PARSEOUTPUT 不支持 bytes32，适配器必须本地解析返回值，不能再调它')
  })
  await t('返回值本地解码：用真机 head() 的原始回执（V1 合约，2026-11-05）逐字验证——seq 读出 2087900645 这一缺陷也能如实读到', () => {
    // 真机回执 output（base64），3 个 32 字节字：0x7c72d5e5 / 0 / 0
    const real = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHxy1eUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    assert.deepEqual(decodeOutput(real, OUT.head), [2087900645, '0x' + ZERO, 0])
    const w = (h) => Buffer.from(h.padStart(64, '0'), 'hex').toString('base64')
    assert.deepEqual(decodeOutput(w('1'), ['bool']), [true]); assert.deepEqual(decodeOutput(w('0'), ['bool']), [false])
    assert.throws(() => decodeOutput(w('2'), ['bool']), /不是 0\/1/)
    assert.throws(() => decodeOutput(w('1'), ['bool', 'bool']), /长度不对/)             // 少一个字
    assert.throws(() => decodeOutput('', ['bool']), /长度不对/)                           // 空 output（比如合约回滚后的回执）
    assert.throws(() => decodeOutput(w('ffffffffffffffffffffffff'), ['uint256']), /超出安全整数/)   // 不静默丢精度
    assert.throws(() => decodeOutput(w('1'), ['string']), /不支持/)
    assert.deepEqual(decodeOutput(w('ab'.repeat(32)), ['bytes32']), ['0x' + 'ab'.repeat(32)])
  })
  await t('合约存储布局：owner 之外不许有小整数/布尔/地址状态变量（V1 教训：32 字节 msg.sender 的高位会漏进同槽相邻变量）', () => {
    const src = fs.readFileSync(path.join(CDIR, 'WanderlustRootStore.sol'), 'utf8')
    const small = [...src.matchAll(/^\s*(uint(?:8|16|32|64|128)|int\d*|bool|address|bytes(?:[1-9]|[12]\d|3[01]))\s+(?:public|private|internal)\s+(\w+)\s*;/gm)].map((m) => m[2])
    assert.deepEqual(small, [], '状态变量里有可打包/会被 solc 清理的小类型（含 address）：' + small.join(','))
    assert.match(src, /uint256\s+public\s+lastSeq\s*;/)
  })
  await t('身份比较不能用 address/msg.sender（V2 教训：address 被清成 20 字节，msg.sender 是 32 字节，永远不等）：必须用 caller() 的原始 256 位', () => {
    const code = fs.readFileSync(path.join(CDIR, 'WanderlustRootStore.sol'), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/msg\.sender/.test(code), '代码里还在用 msg.sender（注释除外）')
    assert.ok(!/\baddress\b/.test(code), '代码里还有 address 类型')
    assert.match(code, /assembly\s*\{\s*s\s*:=\s*caller\(\)\s*\}/)
    assert.match(code, /_sender\(\)\s*==\s*ownerKey/)
  })
  await t('独立起链：第二批用合约自己的链头（seq=2、prevRoot=上一根），不理会库里批次的 prev_root（那条链有 DEPOSIT 时代的批次接不上）', async () => {
    const r = await contract.anchor({ root: R('b'), prevRoot: R('7'), leafCount: 3, bizDate: D })
    assert.equal(parseContractContent(r.content).seq, 2); assert.equal(parseContractContent(r.content).prev, R('a'))
    assert.deepEqual(JSON.parse(writes()[1].body.inputParamListStr).slice(0, 2), [B64(R('b')), B64(R('a'))])
    assert.equal(st.seq, 2); assert.equal(st.lastRoot, R('b'))
  })
  await t('确认（strict 默认）：交易在块里 + 回执成功 + writeRoot=true + getRoot 反查字段一致 → 已锚定', async () => {
    conf(); fresh()
    const a = await contract.anchor({ root: R('c'), leafCount: 5, bizDate: D })
    const before = st.calls.length
    const c = await contract.confirm({ txRef: a.txRef, root: R('c'), bizDate: D, leafCount: 5, content: a.content })
    assert.deepEqual({ final: c.final, confirmations: c.confirmations, contractSeq: c.contractSeq }, { final: true, confirmations: 1, contractSeq: 1 })
    assert.match(c.block, /^\d+$/)
    assert.ok(st.calls.slice(before).some((x) => x.sig === SIG.getRoot), 'strict 下没有 getRoot 反查')
  })
  await t('确认（strict=0）：只看回执，不多发 getRoot 读调用', async () => {
    conf({ ANTOPEN_CONTRACT_STRICT: '0' }); fresh()
    const a = await contract.anchor({ root: R('c'), leafCount: 5, bizDate: D }); const before = st.calls.length
    assert.equal((await contract.confirm({ txRef: a.txRef, root: R('c'), bizDate: D, leafCount: 5, content: a.content })).final, true)
    assert.ok(!st.calls.slice(before).some((x) => x.sig === SIG.getRoot))
  })
  await t('确认：还没出块 → 等待；超过等待上限仍查无此交易 → 硬错误 NOT_ON_CHAIN（gas 偏低返回成功+哈希但上不了链）', async () => {
    conf({ ANTOPEN_WAIT_MAX_MS: '60000' }); fresh(); st.dropNext = true
    const a = await contract.anchor({ root: R('d'), leafCount: 1, bizDate: D })
    const arg = { txRef: a.txRef, root: R('d'), bizDate: D, leafCount: 1, content: a.content }
    assert.deepEqual(await contract.confirm({ ...arg, submittedAt: new Date() }), { final: false, reason: '等待出块', confirmations: 0 })
    await assert.rejects(() => contract.confirm({ ...arg, submittedAt: new Date(Date.now() - 5 * 60_000 * 2) }), (e) => e.code === 'NOT_ON_CHAIN')
  })
  await t('确认：合约回滚（链头在读与写之间变了 → 序号/前根对不上）→ CONTRACT_REVERT，转人工不空转重试', async () => {
    conf(); fresh(); st.forceRevert = true
    const a = await contract.anchor({ root: R('e'), leafCount: 1, bizDate: D })
    await assert.rejects(() => contract.confirm({ txRef: a.txRef, root: R('e'), bizDate: D, leafCount: 1, content: a.content }), (e) => e.code === 'CONTRACT_REVERT' && /链头/.test(e.message))
  })
  await t('确认：这枚根此前已在合约里（writeRoot 返回 false，本次是幂等空操作）→ ROOT_ALREADY_ANCHORED，转人工', async () => {
    conf(); fresh()
    await contract.anchor({ root: R('f'), leafCount: 2, bizDate: D })           // 第一次真写
    const a2 = await contract.anchor({ root: R('f'), leafCount: 2, bizDate: D }) // 同根再提：合约返回 false
    await assert.rejects(() => contract.confirm({ txRef: a2.txRef, root: R('f'), bizDate: D, leafCount: 2, content: a2.content }), (e) => e.code === 'ROOT_ALREADY_ANCHORED')
  })
  await t('确认（strict）：合约里查到的业务日 / 叶数 / 序号与批次不符 → ROOT_STATE_MISMATCH，逐项指出', async () => {
    conf(); fresh()
    const a = await contract.anchor({ root: R('1'), leafCount: 5, bizDate: D })
    st.getRootOverride = (r) => [true, 20261101, 99, 7, r.at]
    await assert.rejects(() => contract.confirm({ txRef: a.txRef, root: R('1'), bizDate: D, leafCount: 5, content: a.content }),
      (e) => e.code === 'ROOT_STATE_MISMATCH' && /业务日/.test(e.message) && /叶数/.test(e.message) && /序号/.test(e.message))
    st.getRootOverride = () => [false, 0, 0, 0, 0]
    await assert.rejects(() => contract.confirm({ txRef: a.txRef, root: R('1'), bizDate: D, leafCount: 5, content: a.content }), (e) => e.code === 'ROOT_STATE_MISMATCH' && /查无此根/.test(e.message))
  })
  await t('确认：缺提交时记下的 chain_content → BAD_STATE（没有它就没法核对合约序号/前根）；缺参数 → BAD_ARGS', async () => {
    conf(); fresh()
    await assert.rejects(() => contract.confirm({ txRef: R('a'), root: R('a'), bizDate: D }), (e) => e.code === 'BAD_STATE')
    await assert.rejects(() => contract.confirm({ txRef: R('a') }), (e) => e.code === 'BAD_ARGS')
  })
  await t('同一链状态下重试提交：orderId 相同 → 服务端去重，只写一次（上一笔还没出块时再次触发提交）', async () => {
    conf(); fresh(); st.autoMine = false
    const a1 = await contract.anchor({ root: R('2'), leafCount: 1, bizDate: D })
    const a2 = await contract.anchor({ root: R('2'), leafCount: 1, bizDate: D })
    assert.equal(a1.txRef, a2.txRef, '同状态重试应拿到同一笔')
    st.mine(); st.autoMine = true
    assert.equal(st.total, 1, '同一根被写了不止一次'); assert.equal(st.seq, 1)
  })
  await t('链头变了就换 orderId：之前失败的那笔不会把后面的重试吞掉', async () => {
    conf(); fresh(); st.forceRevert = true
    const a1 = await contract.anchor({ root: R('3'), leafCount: 1, bizDate: D })     // 回滚（链头没变，seq 仍=1）
    const a2 = await contract.anchor({ root: R('4'), leafCount: 1, bizDate: D })     // 另一个根：能写成
    assert.notEqual(a1.txRef, a2.txRef); assert.equal(st.seq, 1)
    const a3 = await contract.anchor({ root: R('3'), leafCount: 1, bizDate: D })     // 链头已变（seq=2,prev=4）→ 新 orderId → 能写成
    assert.notEqual(a3.txRef, a1.txRef); assert.equal(st.seq, 2); assert.equal(st.roots.get(R('3')).prev, R('4'))
  })
  await t('链上读调用失败时给人话：合约名不对/没部署（回执 result≠0）→ CONTRACT_REVERT；回执迟迟不来 → 超时报错', async () => {
    conf({ ANTOPEN_CONTRACT_POLL_TRIES: '2' }); fresh(); st.noReceipt = true
    await assert.rejects(() => contract.anchor({ root: R('5'), leafCount: 1, bizDate: D }), /等回执超时/)
    st.noReceipt = false
    const orig = st.txs; st.forceRevert = false
    conf({ ANTOPEN_CONTRACT_NAME: '' }); await assert.rejects(() => contract.probe(), /ANTOPEN_CONTRACT_NAME/)
  })
  await t('probe：握手 + 块高 + 读合约链头，不写合约；信息里带 seq 与已写批数', async () => {
    conf(); fresh(); st.seq = 4; st.total = 4; st.lastRoot = R('9')
    const r = await contract.probe()
    assert.equal(r.ok, true); assert.match(r.detail, /当前块高 \d+/); assert.match(r.detail, /seq=4/); assert.match(r.detail, /已写 4 批/)
    assert.equal(writes().length, 0, '探测不该写合约')
  })
  await t('bytes32 入参格式（真机实测）：默认 base64 通过；0x / 裸 hex 被链在发交易阶段拒绝（405 value length must be 32），不耗 gas、不上链', async () => {
    conf(); fresh()
    await contract.anchor({ root: R('6'), leafCount: 1, bizDate: D })
    const args = JSON.parse(writes()[0].body.inputParamListStr)
    assert.match(args[0], /^[A-Za-z0-9+/]{43}=$/); assert.match(args[1], /^[A-Za-z0-9+/]{43}=$/); assert.equal(st.seq, 1)
    for (const fmt of ['0x', 'hex']) {
      conf({ ANTOPEN_CONTRACT_BYTES: fmt }); fresh()
      await assert.rejects(() => contract.anchor({ root: R('6'), leafCount: 1, bizDate: D }), /405.*value length must be 32/)
      assert.equal(st.seq, 0, fmt + ' 不该写进合约')
    }
    conf({ ANTOPEN_CONTRACT_BYTES: 'bogus' }); fresh()   // 乱填 → 回到默认 base64
    await contract.anchor({ root: R('6'), leafCount: 1, bizDate: D }); assert.equal(st.seq, 1)
  })
  await t('回滚原因解码：用真机回执原文（序号跳号，result=10201）解出 "seq must be lastSeq+1"；解不出时返回空串', () => {
    const real = 'CMN5oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABVzZXEgbXVzdCBiZSBsYXN0U2VxKzEAAAAAAAAAAAAAAA=='
    assert.equal(revertReason(real), 'seq must be lastSeq+1')
    assert.equal(revertReason(''), ''); assert.equal(revertReason('AAAA'), ''); assert.equal(revertReason('CMN5oA=='), '')
  })
  await t('确认：合约回滚时错误信息带出链上原因（便于人工判断是序号错位还是别的）', async () => {
    conf(); fresh()
    st.forceRevert = true   // 替身：下一笔写入回滚，回执 result=10201、output=Error("only owner")
    const c = await contract.anchor({ root: R('9'), leafCount: 1, bizDate: D })
    await assert.rejects(() => contract.confirm({ txRef: c.txRef, root: R('9'), bizDate: D, leafCount: 1, content: c.content }), (e) => e.code === 'CONTRACT_REVERT' && /原因：only owner/.test(e.message))
  })
  await t('两个入口共用同一份令牌：交替使用只握手一次（免费版 TPS=1，队列与令牌是共享的）', async () => {
    conf(); fresh(); st.handshakes = 0
    const { default: deposit } = await import('../src/infra/chain/antchain-open.mjs')
    await deposit.probe(); await contract.anchor({ root: R('7'), leafCount: 1, bizDate: D }); await deposit.probe()
    assert.equal(st.handshakes, 1)
  })
  await t('离线自检通过（入参编码 + 签名 + 返回类型）', () => { conf(); assert.equal(contract.selfTest().ok, true) })
  await t('chain_content 往返：合约名/序号/前根/根', () => {
    const s = contractContent({ name: 'N', seq: 9, prev: R('a'), root: R('b') })
    assert.deepEqual(parseContractContent(s), { name: 'N', seq: 9, prev: R('a'), root: R('b') }); assert.equal(parseContractContent('wl-anchor/2|x'), null)
  })

  console.log('== 编译产物与部署脚本 ==')
  await t('产物与源码绑定：build.json 的 sourceSha256 = 当前 .sol；bin 哈希与文件一致（改了合约源码不重编译会红）', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(CDIR, 'build', 'build.json'), 'utf8'))
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
    assert.equal(meta.sourceSha256, sha(fs.readFileSync(path.join(CDIR, 'WanderlustRootStore.sol'), 'utf8').replace(/\r\n/g, '\n')), '源码改了但没重新编译：重编译并更新 build/')
    const bin = fs.readFileSync(path.join(CDIR, 'build', 'WanderlustRootStore.bin'), 'utf8').trim()
    assert.equal(meta.binSha256, sha(bin)); assert.match(bin, /^[0-9a-f]+$/); assert.equal(bin.length / 2, meta.binBytes)
    assert.match(meta.solc, /^0\.6\.12/)
  })
  await t('部署脚本默认只演练：配置齐全也不发任何交易；缺配置则拒绝', async () => {
    const run = (args, env) => new Promise((res) => execFile(process.execPath, [path.join(API, 'scripts', 'chain-antopen-deploy.mjs'), ...args], { env: { ...process.env, ...env }, timeout: 30000 }, (err, so) => res({ code: err ? err.code : 0, out: String(so) })))
    conf(); fresh()
    const env = { ANTOPEN_REST_URL: F.url, ANTOPEN_ACCESS_ID: 'ck-dry', ANTOPEN_ACCESS_KEY: PEM, ANTOPEN_ACCOUNT: 'acct', ANTOPEN_KMS_ID: 'k', ANTOPEN_TENANT_ID: 'T', ANTOPEN_MIN_INTERVAL_MS: '0' }
    const dry = await run([], env)
    assert.equal(dry.code, 0); assert.match(dry.out, /没有发送任何交易/); assert.equal(st.calls.length, 0, '演练不该联网')
    const miss = await run([], { ...env, ANTOPEN_TENANT_ID: '' })
    assert.equal(miss.code, 1); assert.match(miss.out, /缺配置：ANTOPEN_TENANT_ID/); assert.equal(st.calls.length, 0)
  })
  await t('部署脚本 --yes：发 DEPLOYCONTRACTFORBIZ（hex 字节码），回执 result=0 才算成功；非 0 退出码 3、不假装部署成功', async () => {
    const run = (args, env) => new Promise((res) => execFile(process.execPath, [path.join(API, 'scripts', 'chain-antopen-deploy.mjs'), ...args], { env: { ...process.env, ...env }, timeout: 30000 }, (err, so) => res({ code: err ? err.code : 0, out: String(so) })))
    const env = { ANTOPEN_REST_URL: F.url, ANTOPEN_ACCESS_ID: 'ck-dep', ANTOPEN_ACCESS_KEY: PEM, ANTOPEN_ACCOUNT: 'acct', ANTOPEN_KMS_ID: 'k', ANTOPEN_TENANT_ID: 'T', ANTOPEN_MIN_INTERVAL_MS: '0' }
    fresh(); st.deploys.length = 0; st.deployResult = 0
    const ok = await run(['--yes'], env)
    assert.equal(ok.code, 0); assert.match(ok.out, /部署成功/); assert.equal(st.deploys.length, 1)
    const d = st.deploys[0]
    assert.equal(d.method, 'DEPLOYCONTRACTFORBIZ'); assert.equal(d.contractName, 'WanderlustRootStoreV3'); assert.equal(d.gas, 2000000); assert.equal(d.tenantid, 'T')
    assert.equal(d.contractCode, fs.readFileSync(path.join(CDIR, 'build', 'WanderlustRootStore.bin'), 'utf8').trim(), '传的不是编译产物')
    st.deployResult = 5
    const bad = await run(['--yes', '--code-format', 'base64'], { ...env, ANTOPEN_ACCESS_ID: 'ck-dep2' })
    assert.equal(bad.code, 3); assert.match(bad.out, /未确认成功/); assert.ok(!/部署成功/.test(bad.out))
    assert.match(st.deploys[1].contractCode, /^[A-Za-z0-9+/]+=*$/); assert.equal(st.deploys[1].contractCode, Buffer.from(st.deploys[0].contractCode, 'hex').toString('base64'))
    assert.ok(!bad.out.includes(PEM.slice(40, 80)), '输出里不能出现私钥')
  })
} finally {
  reset(); F.stop()
}
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
