// 存证核心：事件入队 → 批量 Merkle 打包（含 inclusion proof）→ 链式前根 → 锚定 → 补锚 → 对账
//
// 关键不变式（改动前先读）：
//   I1 叶子哈希只由 canonical 决定；canonical 只放白名单字段，绝不含 PII
//   I2 每批 prev_root = 上一批 merkle_root（存证链，防整批替换）
//   I3 每片叶子在批次内有唯一 leaf_index，且落 leaf_path 可在链下独立重算（算法见 merkle.mjs，按批次 merkle_version）
//   I4 status 单向：0待打包 → 1已打包 →（5已提交待确认）→ 2已锚定；3/4 只影响锚定，不影响业务
//      txHash 不等于已上链：需要确认的链（EVM）必须核验回执、确认数和交易内容后才置 2
//   I5 NOOP 模式下批次永远停在 1，绝不写 status=2（否则对外一查就穿帮）
//   I6 旅豆日终根必须借贷恒等（Σ借=Σ贷）才允许打包
import crypto from 'node:crypto'
import { q, one, tx } from '../db.mjs'
import * as chain from '../infra/chain.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import * as merkle from './merkle.mjs'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** 稳定序列化：键按字典序，剔除 null/undefined，保证同一对象永远同一哈希 */
export function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(canonicalize)
  const out = {}
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k]
    if (v === undefined || v === null) continue
    out[k] = canonicalize(v)
  }
  return out
}

export const hashOf = (canonical) => sha(JSON.stringify(canonical))

/** 链下独立重算（version 取批次的 merkle_version；历史批次为 1） */
export const verifyProof = (payloadHash, path, root, version = 1) => merkle.verifyProof(payloadHash, path, root, version)

/**
 * 事件入队（幂等）
 * @param conn 可选事务连接。**在 tx() 内部的调用必须传 c**，否则与业务不同事务，
 *             会出现"钱记了、存证丢了"且无人发现的静默缺口。
 */
export async function attest(bizType, bizRef, canonical, conn, versionNo = 1) {
  const c = canonicalize(canonical || {})
  const sql = `INSERT IGNORE INTO attest_event (biz_type, biz_ref, version_no, payload_hash, canonical)
               VALUES (?,?,?,?,?)`
  const args = [bizType, bizRef, versionNo, hashOf(c), JSON.stringify(c)]
  if (conn) return conn.q(sql, args)
  return q(sql, args)
}

/** 批次 seq/prev_root：锁最后一批，保证链式不并发错乱 */
async function nextSeq(c) {
  const last = await c.one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1 FOR UPDATE')
  return { seq: Number(last ? last.seq : 0) + 1, prevRoot: last ? last.merkle_root : null }
}

/**
 * 打包一批待锚事件（小时级任务 / 手动触发）
 * 只做本地根，**不做上链**；上链由 anchorToChain 负责。
 */
export async function packBatch(opts = {}) {
  const limit = Math.min(Number(opts.limit || 500), 2000)
  return await tx(async (c) => {
    const rows = await c.q(
      `SELECT id, payload_hash FROM attest_event WHERE status = 0 ORDER BY id LIMIT ${limit} FOR UPDATE`)
    if (!rows.length) return { batchId: 0, leaves: 0, root: null, seq: 0, prevRoot: null }

    const { seq, prevRoot } = await nextSeq(c)
    const tree = merkle.buildTree(rows.map((r) => r.payload_hash))
    const root = tree.root
    const bizDate = opts.bizDate || bizDay()

    const batchId = await c.ins(
      `INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, merkle_version, status)
       VALUES (?,?,?,?,?,?,?,1)`,
      [seq, bizDate, root, prevRoot, rows.length, opts.merkleKind || 'mixed', tree.version])

    // 批内顺序即叶子顺序：leaf_index 必须与树中位置严格对应；写入前自检每条 proof
    for (let i = 0; i < rows.length; i++) {
      const path = merkle.proofFor(tree, i)
      if (!merkle.verifyProof(rows[i].payload_hash, path, root, tree.version)) throw new Error(`proof 自检失败 event=${rows[i].id}`)
      await c.upd(
        'UPDATE attest_event SET batch_id = ?, leaf_index = ?, leaf_path = ?, status = 1 WHERE id = ?',
        [batchId, i, JSON.stringify(path), rows[i].id])
    }
    return { batchId, leaves: rows.length, root, seq, prevRoot }
  })
}

/**
 * 旅豆账本日终根（D6 原文：旅豆账本日终 Merkle 根）
 * 叶 = 当日全部 bean_ledger 流水；根上链 = "严禁超发"的唯一外部证明
 * @param opts.force 仅对"当日"有效：当日账本还在增长，允许重封（历史日一旦封存即不可变）
 */
export async function closeBeanDay(bizDate, opts = {}) {
  const day = bizDate || bizDay(-1)
  const today = bizDay()
  const exist = await one('SELECT * FROM bean_day_root WHERE biz_date = ?', [day])
  if (exist) {
    // 历史日封存后不可变；当日允许重封（对账快照），且旧批次必须还没上链
    if (day < today) return { skipped: true, bizDate: day, reason: '历史日已封存，不可变' }
    if (!opts.force) return { skipped: true, bizDate: day, reason: '当日已封存（如需重封请带 force）' }
    const old = exist.batch_id ? await one('SELECT status FROM attest_batch WHERE id = ?', [exist.batch_id]) : null
    if (old && [2, 5].includes(Number(old.status))) throw new Error('该日根已提交上链，不允许重封')
    // 只删日终根索引，不删旧批次：删批次会在 seq 链上留洞，旧批次留作历史（无事件、不上链）
    await q('DELETE FROM bean_day_root WHERE biz_date = ?', [day])
  }

  const rows = await q(
    `SELECT id, tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref
       FROM bean_ledger WHERE DATE(created_at) = ? ORDER BY id`, [day])
  // 空日不封存：没有流水的根没有任何证明力，只会在后台多出"0 叶"噪声
  if (!rows.length && !opts.force) return { skipped: true, bizDate: day, reason: '当日无旅豆流水，不封存空日' }
  const creditSum = rows.filter((r) => Number(r.direction) === 1).reduce((s, r) => s + Number(r.amount), 0)
  const debitSum = rows.filter((r) => Number(r.direction) === 2).reduce((s, r) => s + Number(r.amount), 0)
  if (creditSum !== debitSum) {
    return { ok: false, bizDate: day, creditSum, debitSum, reason: '借贷不平，拒绝封存' }
  }

  const leaves = rows.map((r) => hashOf(canonicalize({
    id: Number(r.id), txNo: r.tx_no, accountId: Number(r.account_id), direction: Number(r.direction),
    amount: Number(r.amount), afterBal: Number(r.after_bal), bizType: Number(r.biz_type), bizRef: r.biz_ref,
  })))

  const out = await tx(async (c) => {
    const { seq, prevRoot } = await nextSeq(c)
    const tree = merkle.buildTree(leaves)
    const root = tree.root
    const batchId = await c.ins(
      `INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, merkle_version, is_day_close, status)
       VALUES (?,?,?,?,?,?,?,1,1)`, [seq, day, root, prevRoot, leaves.length, 'bean_day', tree.version])
    await c.q(
      `INSERT INTO bean_day_root (biz_date, leaf_count, debit_sum, credit_sum, merkle_root, prev_root, batch_id)
       VALUES (?,?,?,?,?,?,?)`, [day, leaves.length, debitSum, creditSum, root, prevRoot, batchId])
    return { batchId, root, seq, prevRoot, leaves: leaves.length }
  })
  return { ok: true, bizDate: day, creditSum, debitSum, ...out }
}

/**
 * 锚定一批到链上
 * - NOOP：直接返回，不改状态（**不消耗重试次数**）
 * - 真实：先按根查重（幂等）→ 提交
 *   - 链返回即终局（联盟链同步出块）→ 置 2
 *   - 链需要等确认（EVM 等公链：txHash ≠ 已上链）→ 置 5「已提交·待确认」，由 confirmPending() 核验后才置 2
 *   失败置 3 并计数，超 5 次置 4 进人工队列
 */
export async function anchorToChain(batchId) {
  const b = await one('SELECT * FROM attest_batch WHERE id = ?', [batchId])
  if (!b) throw new Error('批次不存在')
  if (Number(b.status) === 2) return { batchId, skipped: true, reason: '已锚定' }
  if (Number(b.status) === 5) return { batchId, skipped: true, reason: '已提交，等待链上确认' }
  // 合约模式同理：人工状态可能是"根其实已写进合约、只是这笔交易不是写入它的那笔"，自动重提会让合约序号错位
  if (Number(b.status) === 4 && ['tbaas', 'antchaincontract'].includes(chain.providerId())) return { batchId, skipped: true, reason: '需人工核对原交易，禁止自动重新提交' }
  if (chain.chainMode() === 'noop') {
    return { batchId, anchored: false, mode: 'noop', reason: '未配置链：存证停留在已打包' }
  }

  let r, existed
  try {
    existed = await chain.queryByRoot(b.merkle_root)
    r = existed || await chain.submit({
      root: b.merkle_root, prevRoot: b.prev_root, leafCount: b.leaf_count,
      bizDate: b.biz_date, merkleKind: b.merkle_kind,
    })
    if (!r || !r.txRef) throw new Error('链适配器未返回交易号')
  } catch (e) {
    // 提交是否抵达云端可能未知；缺交易号时转人工，不能自动补锚造成重复写入。
    if (chain.providerId() === 'tbaas') return await markFailed({ ...b, attempt: 4 }, e)
    return await markFailed(b, e)
  }
  // 提交已成功：此后的数据库异常不能记成"提交失败"，否则重试会重复上链
  const needConfirm = chain.needsConfirmation() && !existed
  // 上链原文原样落库：v2 原文含毫秒时间戳与平台签名，重算不可能复现，确认时必须拿这一串比对
  const content = r.content || null, tsMs = r.ts || null
  if (needConfirm) {
    await q(`UPDATE attest_batch SET status = 5, chain_tx_ref = ?, chain_provider = ?, chain_content = ?, chain_ts_ms = ?,
      submitted_at = NOW(3), last_err = NULL WHERE id = ?`,
      [r.txRef, chain.providerId(), content, tsMs, batchId])
    return { batchId, anchored: false, submitted: true, txRef: r.txRef, signed: !!r.signed, reason: '已提交，等待链上确认' }
  }
  await q('UPDATE attest_batch SET chain_provider = ?, chain_content = ?, chain_ts_ms = ? WHERE id = ?',
    [chain.providerId(), content, tsMs, batchId])
  return await markAnchored(batchId, r.txRef, r.block, null, !!existed)
}

async function markAnchored(batchId, txRef, block, confirmations, reused = false) {
  return await tx(async (c) => {
    await c.upd(
      `UPDATE attest_batch SET status = 2, chain_tx_ref = ?, chain_block = ?, confirmations = ?, anchored_at = NOW(3), last_err = NULL
       WHERE id = ?`, [txRef, block || null, confirmations, batchId])
    await c.q('UPDATE attest_event SET status = 2 WHERE batch_id = ? AND status = 1', [batchId])
    return { batchId, anchored: true, txRef, block, confirmations, reused }
  })
}

// 这些问题重试不会变好：同一笔会得到同一结果，白重试 5 次只是把问题藏起来 → 直接转人工
// 合约模式（antchaincontract）的几类同理：合约拒绝写入 / 根已在合约里 / 合约里的记录与批次不符 / 缺提交时的状态
const TERMINAL_CHAIN_ERR = new Set(['CONTENT_MISMATCH', 'TX_HASH_MISMATCH', 'NOT_ON_CHAIN', 'CONTRACT_REVERT', 'ROOT_ALREADY_ANCHORED', 'ROOT_STATE_MISMATCH', 'BAD_STATE'])

async function markManual(b, e) {
  await q('UPDATE attest_batch SET status = 4, last_err = ? WHERE id = ?', [String(e.message).slice(0, 255), b.id])
  await q(`INSERT INTO risk_event (kind, severity, detail, handled) VALUES ('attest_manual_review', 2, ?, 0)`,
    [JSON.stringify({ batchId: b.id, txRef: b.chain_tx_ref || null, code: e.code || null, err: String(e.message).slice(0, 200) })])
  return { batchId: b.id, anchored: false, manual: true, status: 4, err: String(e.message) }
}

async function markFailed(b, e) {
  const attempt = Number(b.attempt || 0) + 1
  const status = attempt >= 5 ? 4 : 3
  await q('UPDATE attest_batch SET attempt = ?, last_err = ?, status = ?, chain_tx_ref = NULL, submitted_at = NULL WHERE id = ?',
    [attempt, String(e.message).slice(0, 255), status, b.id])
  if (status === 4) {
    await q(`INSERT INTO risk_event (kind, severity, detail, handled) VALUES ('attest_anchor_failed', 2, ?, 0)`,
      [JSON.stringify({ batchId: b.id, attempt, err: String(e.message).slice(0, 200) })])
  }
  return { batchId: b.id, anchored: false, attempt, status, err: String(e.message) }
}

/**
 * 确认"已提交·待确认"的批次：交易成功 + 确认数达标 + 交易内容确实是这枚根，才算已锚定。
 * - 交易被回滚/内容不符 → 置 3（可重试，重新提交）
 * - 还没够确认数 → 保持 5
 */
/** 外部回调确认（异步链）：对方推送"某交易已上链"，核对交易号与根一致后置为已锚定 */
export async function confirmByCallback({ provider, txRef, root, block }) {
  const b = await one('SELECT * FROM attest_batch WHERE chain_tx_ref = ? AND status = 5', [txRef])
  if (!b) return { matched: false, reason: '无待确认批次对应该交易号' }
  if (b.chain_provider && b.chain_provider !== provider) return { matched: false, reason: '交易号属于其他链' }
  if (root && root !== b.merkle_root) return { matched: false, reason: '回调中的根与批次不一致' }
  return { matched: true, ...(await markAnchored(b.id, txRef, block || null, null)) }
}

/** 指定批次确认：联调只传自己创建的 ID，不扫描或处理其他批次。 */
export async function confirmBatch(batchId) {
  const b = await one('SELECT * FROM attest_batch WHERE id = ?', [batchId])
  if (!b) throw new Error('批次不存在')
  if (Number(b.status) !== 5) return { batchId: b.id, anchored: Number(b.status) === 2, reason: '批次不在待确认状态' }
  return (await confirmRows([b]))[0]
}

export async function confirmPending(limit = 50) {
  const rows = await q(`SELECT * FROM attest_batch WHERE status = 5 ORDER BY seq ASC LIMIT ${Number(limit)}`)
  return await confirmRows(rows)
}

async function confirmRows(rows) {
  const out = []
  for (const b of rows) {
    try {
      const c = await chain.confirm({ txRef: b.chain_tx_ref, root: b.merkle_root, prevRoot: b.prev_root, bizDate: b.biz_date,
        provider: b.chain_provider, submittedAt: b.submitted_at, content: b.chain_content || undefined, leafCount: b.leaf_count })
      if (c.final) out.push(await markAnchored(b.id, b.chain_tx_ref, c.block, c.confirmations ?? null))
      else {
        await q('UPDATE attest_batch SET confirmations = ?, last_err = ? WHERE id = ?',
          [c.confirmations ?? null, c.reason ? String(c.reason).slice(0, 255) : null, b.id])
        out.push({ batchId: b.id, anchored: false, pending: true, confirmations: c.confirmations ?? null, reason: c.reason || null })
      }
    } catch (e) {
      // 重试必然重演（内容不符 / 一直查无此交易）→ 停在这里等人看，不要耗光 5 次重试再报
      if (TERMINAL_CHAIN_ERR.has(e.code)) { out.push(await markManual(b, e)); continue }
      // TBaaS 查询失败或记录不匹配不能证明原交易不存在；保留交易号以免重试造成重复提交。
      if (b.chain_provider === 'tbaas') {
        const reason = String(e.message || e).slice(0, 255)
        await q('UPDATE attest_batch SET last_err = ? WHERE id = ? AND status = 5', [reason, b.id])
        out.push({ batchId: b.id, anchored: false, pending: true, reason })
        continue
      }
      // 交易失败、被替换、或链上内容与根不符：这次提交作废，回到可重试
      out.push(await markFailed(b, e))
    }
  }
  return out
}

/** 补锚：按 seq 升序回放 1/3 批次（链恢复后调用），保证 prev_root 链连续 */
export async function reanchorPending(limit = 50) {
  const rows = await q(
    `SELECT id FROM attest_batch WHERE status IN (1,3) AND attempt < 5 ORDER BY seq ASC LIMIT ${Number(limit)}`)
  const out = []
  for (const r of rows) out.push(await anchorToChain(r.id))
  return out
}

/**
 * 六条不变式对账（每日 04:00）
 * 只读 + 写 risk_event 报警，绝不改业务数据
 */
export async function reconcile() {
  const checks = []

  // I1 逐日校验（只对历史日）：已封存的根，其叶子数必须等于该日账本流水数。
  // 当日不校验——当日账本还在增长，商品/订单随时进来，无法用同一根覆盖
  const dayMismatch = await one(`
    SELECT COUNT(*) n FROM bean_day_root r
     WHERE r.biz_date < CURDATE()
       AND r.leaf_count <> (SELECT COUNT(*) FROM bean_ledger l WHERE DATE(l.created_at) = r.biz_date)`)
  const sealedDays = await one('SELECT COUNT(*) n FROM bean_day_root')
  checks.push({ id: 'I1', name: '历史日根的叶数与账本一致', ok: Number(dayMismatch.n) === 0,
    detail: { mismatch: Number(dayMismatch.n), sealedDays: Number(sealedDays.n) } })

  const imbalanced = await one('SELECT COUNT(*) n FROM bean_day_root WHERE debit_sum <> credit_sum')
  checks.push({ id: 'I2', name: '日终根借贷恒等', ok: Number(imbalanced.n) === 0, detail: { bad: Number(imbalanced.n) } })

  const stuck = await one('SELECT COUNT(*) n FROM attest_event WHERE status = 0 AND created_at < NOW() - INTERVAL 2 HOUR')
  checks.push({ id: 'I3', name: '存证队列不堵塞(>2h)', ok: Number(stuck.n) === 0, detail: { stuck: Number(stuck.n) } })

  const broken = await one(`
    SELECT COUNT(*) n FROM attest_batch b JOIN attest_batch p ON b.seq = p.seq + 1
     WHERE b.prev_root IS NOT NULL AND b.prev_root <> p.merkle_root`)
  checks.push({ id: 'I4', name: '存证链不断(prev_root)', ok: Number(broken.n) === 0, detail: { broken: Number(broken.n) } })

  const fake = await one(`
    SELECT COUNT(*) n FROM attest_batch WHERE status = 2 AND (chain_tx_ref IS NULL OR chain_tx_ref LIKE 'NOOP%')`)
  checks.push({ id: 'I5', name: '无假上链记录', ok: Number(fake.n) === 0, detail: { fake: Number(fake.n) } })

  const unconfirmed = await one(`SELECT COUNT(*) n FROM attest_batch WHERE status = 5 AND submitted_at < NOW() - INTERVAL 6 HOUR`)
  checks.push({ id: 'I7', name: '已提交批次 6 小时内得到链上确认', ok: Number(unconfirmed.n) === 0, detail: { stale: Number(unconfirmed.n) } })

  // 按"旅豆事务号"计，不按流水行数计：一笔发放/抵扣都是双分录两行，用行数会误判成漏埋点
  const missed = await one(`
    SELECT COUNT(*) ledger, COALESCE(SUM(EXISTS (
      SELECT 1 FROM attest_event e WHERE e.biz_type IN ('bean_grant','bean_deduct')
        AND e.biz_ref = CONCAT('bt-', l.tx_no)
        AND JSON_UNQUOTE(JSON_EXTRACT(e.canonical, '$.txNo')) = l.tx_no
    )),0) attested FROM (SELECT DISTINCT tx_no FROM bean_ledger) l`)
  const ratio = Number(missed.ledger) === 0 ? 1 : Number(missed.attested) / Number(missed.ledger)
  checks.push({ id: 'I6', name: '旅豆流水均有存证(≥95%)', ok: ratio >= 0.95,
    detail: { ledger: Number(missed.ledger), attested: Number(missed.attested), missing: Number(missed.ledger)-Number(missed.attested), ratio: Number(ratio.toFixed(3)) } })

  const failed = checks.filter((x) => !x.ok)
  if (failed.length) {
    await q(`INSERT INTO risk_event (kind, severity, detail, handled) VALUES ('attest_reconcile_failed', 2, ?, 0)`,
      [JSON.stringify(failed)])
  }
  return { at: new Date().toISOString(), ok: failed.length === 0, checks }
}
