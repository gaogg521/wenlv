// 存证打包：事件哈希 → Merkle 根 → attest_batch（P0 链=NOOP 记根；P1 换链数根适配器仅替换 anchor()）
import crypto from 'node:crypto'
import { q, one, tx } from '../db.mjs'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** Merkle 根（奇数层复制末节点补偶） */
export function merkleRoot(leaves) {
  if (!leaves.length) return sha('empty')
  let level = leaves.map((l) => l)
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] || level[i]
      next.push(sha(a + b))
    }
    level = next
  }
  return level[0]
}

/** 打包一批待锚事件（小时级任务/手动触发）：建批次 → 事件置已上链 → 回填链编号（NOOP 模式） */
export async function packBatch() {
  const events = await q('SELECT id, biz_type, biz_ref, payload_hash FROM attest_event WHERE status = 0 ORDER BY id LIMIT 500')
  if (!events.length) return { batchId: 0, leaves: 0 }
  const root = merkleRoot(events.map((e) => e.payload_hash))
  const bizDate = new Date().toISOString().slice(0, 10)
  return await tx(async (c) => {
    const batchId = await c.ins(
      'INSERT INTO attest_batch (biz_date, merkle_root, leaf_count, chain_tx_ref, chain_block, anchored_at, status) VALUES (?,?,?,?,?,NOW(3),2)',
      [bizDate, root, events.length, 'NOOP-' + root.slice(0, 24), 'noop', ])
    await c.q('UPDATE attest_event SET status = 2, batch_id = ? WHERE id IN (' + events.map((e) => e.id).join(',') + ')', [batchId])
    return { batchId, leaves: events.length, root }
  })
}

/** P1：链数根真实锚定（替换 NOOP 记录）——接口先行，凭据到位后实现 submit */
export async function anchorToChain(batchId) {
  const b = await one('SELECT * FROM attest_batch WHERE id = ?', [batchId])
  if (!b) throw new Error('batch not found')
  // TODO(P1)：调用链数根 SDK 提交 merkle_root，回填 chain_tx_ref/chain_block；失败置 status=3 重试
  return { batchId, mode: 'noop' }
}
