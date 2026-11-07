import { one, tx } from '../db.mjs'

/** 仅处理已登记的trace；任一失败转人工，全图通过且文本已过才发布。 */
export async function applyMediaReview(message) {
  if (message.Event !== 'wxa_media_check') return { ignored: true }
  const trace = String(message.trace_id || '')
  if (!trace) throw new Error('图片回执缺少任务标识')
  const found = await one('SELECT note_id FROM content_media_check WHERE trace_id = ?', [trace])
  if (!found) throw new Error('图片回执任务尚未登记，请稍后重试')
  return tx(async c => {
    // 同一篇先锁笔记，所有回执采用相同锁序，避免多图并发死锁。
    const note = await c.one('SELECT id, status, body FROM content_note WHERE id = ? FOR UPDATE', [found.note_id])
    const check = await c.one('SELECT status FROM content_media_check WHERE trace_id = ? FOR UPDATE', [trace])
    if (!note || Number(check.status) !== 0) return { duplicate: true }
    const pass = Number(message.errcode) === 0 && message.result?.suggest === 'pass'
    await c.upd('UPDATE content_media_check SET status=?,suggest=?,error_code=?,decided_at=NOW(3) WHERE trace_id=?', [pass ? 1 : 2, String(message.result?.suggest || 'error').slice(0, 32), Number(message.errcode) || 0, trace])
    if (Number(note.status) !== 0) return { preserved: true }
    const counts = await c.one('SELECT SUM(status=0) pending,SUM(status=2) review FROM content_media_check WHERE note_id=?', [note.id])
    const body = typeof note.body === 'string' ? JSON.parse(note.body) : note.body
    if (Number(counts.review) > 0 || !body.textCheck?.pass) await c.upd('UPDATE content_note SET status=1 WHERE id=?', [note.id])
    else if (Number(counts.pending) === 0) await c.upd('UPDATE content_note SET status=2,published_at=NOW(3) WHERE id=?', [note.id])
    return { accepted: true }
  })
}
