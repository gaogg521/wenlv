// 上链分支端到端自测（不需要链数根凭据）：
// 起一个本地假链网关，把 chain.mjs 的真实调用路径跑一遍 —— HMAC 签名 / 提交拿交易号 /
// 按根幂等查重 / anchorToChain 置状态 / 报告与复核页消费 chainRef。
// 用"一次性批次"做样本，测完删除，不污染任何真实批次（也不触发不可回改触发器）。
// 用法：node scripts/test-chain-flow.mjs
import http from 'node:http'
import crypto from 'node:crypto'
import { q, one } from '../src/db.mjs'

const KEY = 'test-chain-key-' + Date.now()
const ACCOUNT = 'test-account'
const anchors = new Map() // root → { txRef, blockHeight }
let blockNo = 9000000
let badSign = 0

// ── 1. 假链网关：完全按《链数根对接接口说明》第 3 节的契约实现 ──
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  const url = new URL(req.url, 'http://x')
  const ts = req.headers['x-timestamp']
  const sig = req.headers['x-signature']
  const expect = crypto.createHmac('sha256', KEY).update([req.method, url.pathname, ts, raw].join('\n')).digest('hex')
  const okSign = sig === expect && req.headers['x-account'] === ACCOUNT
  if (!okSign) badSign++

  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (!okSign) return send(401, { message: 'bad signature' })

  if (req.method === 'POST' && url.pathname === '/v1/attest/anchor') {
    const b = JSON.parse(raw)
    if (!/^[0-9a-f]{64}$/.test(b.root || '')) return send(400, { message: 'root invalid' })
    if (anchors.has(b.root)) return send(200, anchors.get(b.root)) // 按根幂等
    const rec = { txRef: '0x' + crypto.randomBytes(24).toString('hex'), blockHeight: ++blockNo }
    anchors.set(b.root, rec)
    return send(200, rec)
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/attest/root/')) {
    const root = decodeURIComponent(url.pathname.split('/').pop())
    const rec = anchors.get(root)
    return send(200, rec ? { found: true, ...rec } : { found: false })
  }
  send(404, { message: 'not found' })
})

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))
process.env.CHAIN_ENDPOINT = `http://127.0.0.1:${port}`
process.env.CHAIN_ACCOUNT = ACCOUNT
process.env.CHAIN_KEY = KEY

// 必须在设置 env 之后动态 import：chain.mjs 的 endpoint() 是惰性读取的，但保持顺序更稳妥
const chain = await import('../src/infra/chain.mjs')
const attest = await import('../src/domain/attest.mjs')
const report = await import('../src/domain/report.mjs')

let pass = 0
let fail = 0
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  PASS ', m) }
  else { fail++; console.log('  FAIL ', m, extra === undefined ? '' : JSON.stringify(extra)) }
}

console.log('== 1. 接入模式 ==')
ok(chain.chainMode() === 'real', '三项 env 齐备即切 real', chain.chainMode())

console.log('== 2. 提交与幂等（HMAC 签名走真网络）==')
const root = crypto.randomBytes(32).toString('hex')
const r1 = await chain.submit({ root, prevRoot: null, leafCount: 1, bizDate: '2026-10-26', merkleKind: 'probe' })
ok(!!r1.txRef && r1.txRef.startsWith('0x'), '拿到真实交易号', r1.txRef)
ok(badSign === 0, '签名校验通过（0 次失败）', badSign)
const found = await chain.queryByRoot(root)
ok(found && found.txRef === r1.txRef, '按根可查回同一交易号（重试不会重复上链）')

console.log('== 3. anchorToChain 状态翻转（一次性批次）==')
const last = await one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
const seq = Number(last?.seq || 0) + 1
const probeRoot = crypto.randomBytes(32).toString('hex')
const batchId = await (await import('../src/db.mjs')).tx(async (c) => c.ins(
  `INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, status)
   VALUES (?,?,?,?,?,?,1)`, [seq, '2026-10-26', probeRoot, last?.merkle_root || null, 1, 'probe']))

const a1 = await attest.anchorToChain(batchId)
ok(a1.anchored === true && !!a1.txRef, 'anchorToChain 返回 anchored + txRef', a1)
const row = await one('SELECT status, chain_tx_ref, chain_block, anchored_at FROM attest_batch WHERE id = ?', [batchId])
ok(Number(row.status) === 2 && !!row.chain_tx_ref && !!row.anchored_at, '批次置为已锚定并回填 txRef/时间', row)
const a2 = await attest.anchorToChain(batchId)
ok(a2.skipped === true, '重复锚定被幂等跳过（不会二次上链）', a2)

console.log('== 4. 报告与复核页消费 chainRef ==')
const v = {
  found: true, bizType: 'order', bizRef: 'WL-TEST-0001', versionNo: 50,
  payloadHash: crypto.randomBytes(32).toString('hex'), merkleRoot: probeRoot,
  leafIndex: 0, leafPath: [{ h: crypto.randomBytes(32).toString('hex'), p: 'R', dup: false }],
  prevRoot: last?.merkle_root || null, leafCount: 1, proofValid: true,
  batchSeq: seq, chainRef: row.chain_tx_ref, chainBlock: row.chain_block, anchoredAt: row.anchored_at,
}
const doc = report.orderReportDoc(v, 'http://127.0.0.1:8080')
const svg = report.buildSvg(doc)
ok(svg.includes('已锚定（链上可查）'), '报告中锚定状态为「已锚定（链上可查）」')
ok(svg.includes(String(row.chain_tx_ref).slice(0, 8)), '报告写出链上编号')
const pdf = report.svgToPdf(svg)
ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 20000, 'PDF 可生成（' + Math.round(pdf.length / 1024) + ' KB）')

console.log('== 5. 清理（删除一次性批次，不留假交易号）==')
await q('DELETE FROM attest_batch WHERE id = ?', [batchId])
const gone = await one('SELECT COUNT(*) n FROM attest_batch WHERE id = ?', [batchId])
ok(Number(gone.n) === 0, '一次性批次已删除，库里不留任何假 txRef')
const fake = await one(`SELECT COUNT(*) n FROM attest_batch WHERE status = 2 AND (chain_tx_ref IS NULL OR chain_tx_ref LIKE 'NOOP%')`)
ok(Number(fake.n) === 0, '无假上链记录')

server.close()
console.log(`\nCHAIN FLOW: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
