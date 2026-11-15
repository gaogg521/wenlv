import { one, tx } from '../db.mjs'
import { grantPublishReward } from './content-reward.mjs'

/** 仅处理已登记的trace；任一失败转人工，全图通过且文本已过才发布。 */
export async function applyMediaReview(message) {
  if (message.Event !== 'wxa_media_check') return { ignored: true }
  const trace = String(message.trace_id || '')
  if (!trace) throw new Error('图片回执缺少任务标识')
  const found = await one('SELECT note_id FROM content_media_check WHERE trace_id = ?', [trace])
  if (!found) {
    // 评论附件（V87）：未登记到笔记机审表的 trace 按评论附件处理——过审转展示并同步计数
    const comment = await one('SELECT id, note_id FROM content_note_comment WHERE media_trace=?', [trace])
    if (!comment) throw new Error('媒体回执任务尚未登记，请稍后重试')
    const pass = Number(message.errcode) === 0 && message.result?.suggest === 'pass'
    return tx(async c => {
      const changed = await c.upd('UPDATE content_note_comment SET media_state=? WHERE id=? AND media_state=0', [pass ? 1 : 2, comment.id])
      if (changed === 1 && pass) await c.q('UPDATE content_note SET comment_count=GREATEST(comment_count+1,0) WHERE id=?', [comment.note_id])
      return { accepted: Boolean(changed) }
    })
  }
  return tx(async c => {
    // 同一篇先锁笔记，所有回执采用相同锁序，避免多图并发死锁。
    const note = await c.one('SELECT id, status, body, user_id FROM content_note WHERE id = ? FOR UPDATE', [found.note_id])
    const check = await c.one('SELECT status FROM content_media_check WHERE trace_id = ? FOR UPDATE', [trace])
    if (!note || Number(check.status) !== 0) return { duplicate: true }
    const pass = Number(message.errcode) === 0 && message.result?.suggest === 'pass'
    await c.upd('UPDATE content_media_check SET status=?,suggest=?,error_code=?,decided_at=NOW(3) WHERE trace_id=?', [pass ? 1 : 2, String(message.result?.suggest || 'error').slice(0, 32), Number(message.errcode) || 0, trace])
    if (Number(note.status) !== 0) return { preserved: true }
    const body = typeof note.body === 'string' ? JSON.parse(note.body) : note.body
    const active = (body.imgSec || []).filter(x => !x.mock).map(x => x.traceId)
    if (active.length && !active.includes(trace)) return { preserved: true }
    const counts = active.length
      ? await c.one('SELECT SUM(status=0) pending,SUM(status=2) review FROM content_media_check WHERE note_id=? AND trace_id IN (?)', [note.id,active])
      : await c.one('SELECT SUM(status=0) pending,SUM(status=2) review FROM content_media_check WHERE note_id=?', [note.id])
    if (Number(counts.review) > 0 || !body.textCheck?.pass) await c.upd('UPDATE content_note SET status=1 WHERE id=?', [note.id])
    else if (Number(counts.pending) === 0) {
      if (body.manualReview) await c.upd('UPDATE content_note SET status=1 WHERE id=?', [note.id])
      else {
        await c.upd('UPDATE content_note SET status=2,published_at=NOW(3) WHERE id=?', [note.id])
        // 三条发布路径之二：机审回执全过直发，发放发布奖励（失败静默，不阻断审核回执处理）
        await grantPublishReward(c, note.user_id, note.id)
      }
    }
    return { accepted: true }
  })
}
