// 存证核心：事件入队 → 批量 Merkle 打包（含 inclusion proof）→ 链式前根 → 锚定 → 补锚 → 对账
//
// 关键不变式（改动前先读）：
//   I1 叶子哈希只由 canonical 决定；canonical 只放白名单字段，绝不含 PII
//   I2 每批 prev_root = 上一批 merkle_root（存证链，防整批替换）
//   I3 每片叶子在批次内有唯一 leaf_index，且落 leaf_path 可在链下独立重算
//   I4 status 单向：0待打包 → 1已打包 → 2已锚定；3/4 只影响锚定，不影响业务
//   I5 NOOP 模式下批次永远停在 1，绝不写 status=2（否则对外一查就穿帮）
//   I6 旅豆日终根必须借贷恒等（Σ借=Σ贷）才允许打包
import crypto from 'node:crypto'
import { q, one, tx } from '../db.mjs'
import * as chain from '../infra/chain.mjs'

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

/** Merkle 树：奇数层复制末节点补偶；返回每层，便于取 proof */
export function buildTree(leafHashes) {
  if (!leafHashes.length) return { root: sha('empty'), levels: [] }
  let level = leafHashes.map((h, i) => ({ hash: h, pos: i }))
  const levels = [level.slice()]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]
      const b = level[i + 1]
      next.push({ hash: sha(a.hash + (b ? b.hash : a.hash)), pos: next.length })
    }
    level = next
    levels.push(level.slice())
  }
  return { root: level[0].hash, levels }
}

/** 取某叶子的 inclusion proof：[{h, p, dup}] */
export function proofFor(levels, leafPos) {
  const path = []
  let pos = leafPos
  for (let i = 0; i < levels.length - 1; i++) {
    const lv = levels[i]
    const sib = lv[pos % 2 === 0 ? pos + 1 : pos - 1]
    path.push({ h: sib ? sib.hash : lv[pos].hash, p: pos % 2 === 0 ? 'R' : 'L', dup: !sib })
    pos = Math.floor(pos / 2)
  }
  return path
}

/** 链下独立重算：任何一方拿到 payload_hash + leaf_path 都能算出根（对外验证的核心） */
export function verifyProof(payloadHash, path, root) {
  let cur = payloadHash
  for (const step of path || []) {
    cur = step.p === 'R' ? sha(cur + step.h) : sha(step.h + cur)
  }
  return cur === root
}

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
    const { root, levels } = buildTree(rows.map((r) => r.payload_hash))
    const bizDate = opts.bizDate || new Date().toISOString().slice(0, 10)

    const batchId = await c.ins(
      `INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, status)
       VALUES (?,?,?,?,?,?,1)`,
      [seq, bizDate, root, prevRoot, rows.length, opts.merkleKind || 'mixed'])

    // 批内顺序即叶子顺序：leaf_index 必须与 levels 中的 pos 严格对应
    for (let i = 0; i < rows.length; i++) {
      await c.upd(
        'UPDATE attest_event SET batch_id = ?, leaf_index = ?, leaf_path = ?, status = 1 WHERE id = ?',
        [batchId, i, JSON.stringify(proofFor(levels, i)), rows[i].id])
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
  const day = bizDate || new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const exist = await one('SELECT * FROM bean_day_root WHERE biz_date = ?', [day])
  if (exist) {
    // 历史日封存后不可变；当日允许重封（对账快照），且旧批次必须还没上链
    if (day < today) return { skipped: true, bizDate: day, reason: '历史日已封存，不可变' }
    if (!opts.force) return { skipped: true, bizDate: day, reason: '当日已封存（如需重封请带 force）' }
    const old = exist.batch_id ? await one('SELECT status FROM attest_batch WHERE id = ?', [exist.batch_id]) : null
    if (old && Number(old.status) === 2) throw new Error('该日根已上链，不允许重封')
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
    const { root } = buildTree(leaves)
    const batchId = await c.ins(
      `INSERT INTO attest_batch (seq, biz_date, merkle_root, prev_root, leaf_count, merkle_kind, is_day_close, status)
       VALUES (?,?,?,?,?,?,1,1)`, [seq, day, root, prevRoot, leaves.length, 'bean_day'])
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
 * - 真实：先按根查重（幂等）→ 提交 → 成功置 2；失败置 3 并计数，超 5 次置 4 进人工队列
 */
export async function anchorToChain(batchId) {
  const b = await one('SELECT * FROM attest_batch WHERE id = ?', [batchId])
  if (!b) throw new Error('批次不存在')
  if (Number(b.status) === 2) return { batchId, skipped: true, reason: '已锚定' }
  if (chain.chainMode() === 'noop') {
    return { batchId, anchored: false, mode: 'noop', reason: '未配置链：存证停留在已打包' }
  }

  try {
    const existed = await chain.queryByRoot(b.merkle_root)
    const r = existed || await chain.submit({
      root: b.merkle_root, prevRoot: b.prev_root, leafCount: b.leaf_count,
      bizDate: b.biz_date, merkleKind: b.merkle_kind,
    })
    return await tx(async (c) => {
      await c.upd(
        `UPDATE attest_batch SET status = 2, chain_tx_ref = ?, chain_block = ?, anchored_at = NOW(3), last_err = NULL
         WHERE id = ?`, [r.txRef, r.block || null, batchId])
      await c.q('UPDATE attest_event SET status = 2 WHERE batch_id = ? AND status = 1', [batchId])
      return { batchId, anchored: true, txRef: r.txRef, block: r.block, reused: !!existed }
    })
  } catch (e) {
    const attempt = Number(b.attempt || 0) + 1
    const status = attempt >= 5 ? 4 : 3
    await q('UPDATE attest_batch SET attempt = ?, last_err = ?, status = ? WHERE id = ?',
      [attempt, String(e.message).slice(0, 255), status, batchId])
    if (status === 4) {
      await q(`INSERT INTO risk_event (kind, severity, detail, handled) VALUES ('attest_anchor_failed', 2, ?, 0)`,
        [JSON.stringify({ batchId, attempt, err: String(e.message).slice(0, 200) })])
    }
    return { batchId, anchored: false, attempt, status, err: String(e.message) }
  }
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

  // 按"旅豆事务号"计，不按流水行数计：一笔发放/抵扣都是双分录两行，用行数会误判成漏埋点
  const missed = await one(`
    SELECT (SELECT COUNT(DISTINCT tx_no) FROM bean_ledger) ledger,
           (SELECT COUNT(*) FROM attest_event WHERE biz_type IN ('bean_grant','bean_deduct')) attested`)
  const ratio = Number(missed.ledger) === 0 ? 1 : Number(missed.attested) / Number(missed.ledger)
  checks.push({ id: 'I6', name: '旅豆流水均有存证(≥95%)', ok: ratio >= 0.95,
    detail: { ledger: Number(missed.ledger), attested: Number(missed.attested), ratio: Number(ratio.toFixed(3)) } })

  const failed = checks.filter((x) => !x.ok)
  if (failed.length) {
    await q(`INSERT INTO risk_event (kind, severity, detail, handled) VALUES ('attest_reconcile_failed', 2, ?, 0)`,
      [JSON.stringify(failed)])
  }
  return { at: new Date().toISOString(), ok: failed.length === 0, checks }
}
