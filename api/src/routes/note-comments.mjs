// 小红书式评论（V87 社交层）：一级评论 + 回复平铺（「回复 @xx」）+ 评论点赞 + 图片评论 + 软删除
// 在 Codex 素材线实现基础上收敛：去掉私密 visibility 依赖、叠加治理 status 过滤、
// 同人同笔记日限 20 条防刷、content_note.comment_count 全程对账（feed/详情/创作中心共用）。
import { BizError, one, q, tx } from '../db.mjs'
import { requireUser } from '../auth.mjs'
import { msgSecCheck } from '../infra/wxsec.mjs'
import { mediaCheckAsync } from '../domain/wxapi.mjs'
import { apiImg } from './_shared.mjs'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const uploads = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')

function commentMedia(media) {
  if (media == null) return null
  const buffer = Buffer.from(typeof media.data === 'string' ? media.data : '', 'base64')
  const image = media.kind === 'image'
  const ext = image && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
    : image && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg'
    : media.kind === 'audio' && (buffer.toString('ascii', 0, 3) === 'ID3' ||
      (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0)) ? 'mp3' : ''
  if (!ext || buffer.length < 16 || buffer.length > 700 * 1024) throw new BizError(1001, '请选择 700 KB 内的 JPG、PNG 或 MP3')
  return { buffer, ext, kind: media.kind }
}

async function publishedNote(db, id, lock = false) {
  const note = await db.one('SELECT id,user_id FROM content_note WHERE id=? AND status=2' + (lock ? ' FOR UPDATE' : ''), [id])
  if (!note) throw new BizError(1004, '笔记不存在或未发布')
  return note
}

// 可见评论：未软删 + 管理未隐藏 + 附件过审（作者本人可看待审自己的）；回复要求其楼一层同样可见
async function visibleComment(db, noteId, id, owner = 0) {
  const row = await db.one(`SELECT c.id,c.user_id,c.root_id FROM content_note_comment c
    LEFT JOIN content_note_comment root ON root.id=c.root_id
    WHERE c.note_id=? AND c.id=? AND c.deleted_at IS NULL AND c.status=1 AND (c.media_state=1 OR c.user_id=?)
      AND (c.root_id IS NULL OR (root.deleted_at IS NULL AND root.status=1 AND root.media_state=1))`, [noteId, id, owner])
  if (!row) throw new BizError(1004, '评论已删除或不存在')
  return row
}

async function bumpCount(db, noteId, delta) {
  await db.q('UPDATE content_note SET comment_count=GREATEST(comment_count+?,0) WHERE id=?', [delta, noteId])
}

export const noteCommentRoutes = {
  // 评论列表：?root=0 拉一级评论流（cursor 分页），?root=<id> 展开该楼回复
  'GET /c/notes/:id/comments': async req => {
    const user = requireUser(req)
    const note = await publishedNote({ one }, req.params.id)
    const root = Number(req.query.root || 0)
    const before = Number(req.query.before || 0)
    if (![root, before].every(n => Number.isSafeInteger(n) && n >= 0)) throw new BizError(1002, '分页参数无效')
    if (root && (await visibleComment({ one }, note.id, root)).root_id) throw new BizError(1002, '请选择主评论')
    const rows = await q(`SELECT c.id,c.body,c.created_at,c.user_id,u.nickname author,u.avatar_url,
      c.media_kind,c.media_path,c.media_state,c.reply_to,
      CASE WHEN target.deleted_at IS NULL AND target.status=1 THEN tu.nickname END replyAuthor,
      (SELECT COUNT(*) FROM content_note_comment r WHERE r.note_id=c.note_id AND r.root_id=c.id AND r.deleted_at IS NULL AND r.status=1 AND (r.media_state=1 OR r.user_id=?)) replies,
      (SELECT COUNT(*) FROM content_note_comment_like l WHERE l.comment_id=c.id) likes,
      EXISTS(SELECT 1 FROM content_note_comment_like l WHERE l.comment_id=c.id AND l.user_id=?) liked
      FROM content_note_comment c JOIN user_account u ON u.id=c.user_id
      LEFT JOIN content_note_comment target ON target.id=c.reply_to
      LEFT JOIN user_account tu ON tu.id=target.user_id
      WHERE c.note_id=? AND c.root_id <=> ? AND c.deleted_at IS NULL AND c.status=1 AND (c.media_state=1 OR c.user_id=?) AND (?=0 OR c.id<?)
      ORDER BY c.id DESC LIMIT 21`, [user.uid, user.uid, note.id, root || null, user.uid, before, before])
    const total = await one(`SELECT COUNT(*) total FROM content_note_comment c
      LEFT JOIN content_note_comment root ON root.id=c.root_id
      WHERE c.note_id=? AND c.deleted_at IS NULL AND c.status=1 AND c.media_state=1 AND (c.root_id IS NULL OR (root.deleted_at IS NULL AND root.status=1 AND root.media_state=1))`, [note.id])
    const items = rows.slice(0, 20).map(({ user_id, media_path, avatar_url, ...row }) => ({
      ...row, avatar: avatar_url ? apiImg(avatar_url, req) : null,
      mediaUrl: media_path && Number(row.media_state) === 1 ? apiImg(media_path, req) : '',
      created_at: String(row.created_at).slice(0, 16), mine: Number(user_id) === Number(user.uid), byAuthor: Number(user_id) === Number(note.user_id),
    }))
    return { items, total: Number(total.total), next: rows.length > 20 ? items.at(-1).id : null }
  },

  // 发表评论 / 回复（body 与图片至少其一；文本机审前置；图片异步机审 pending 展示）
  'POST /c/notes/:id/comments': async req => {
    const user = requireUser(req)
    if (user.end !== 'c') throw new BizError(1003, '请使用游客账号')
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
    const media = commentMedia(req.body?.media)
    if ((!body && !media) || body.length > 500) throw new BizError(1001, '请输入评论或添加图片、语音')
    const replyTo = Number(req.body.replyTo || 0)
    if (!Number.isSafeInteger(replyTo) || replyTo < 0) throw new BizError(1002, '回复对象无效')
    const note = await publishedNote({ one }, req.params.id)
    const today = await one('SELECT COUNT(*) n FROM content_note_comment WHERE note_id=? AND user_id=? AND created_at >= CURDATE()', [note.id, user.uid])
    if (Number(today.n) >= 20) throw new BizError(1001, '今天在这篇笔记下的评论已达上限，明天再来吧')
    const account = await one('SELECT mini_a_openid FROM user_account WHERE id=?', [user.uid])
    let check
    try { check = body ? await msgSecCheck(body, account?.mini_a_openid) : { pass: true } }
    catch { throw new BizError(1001, '内容检测暂不可用，请稍后重试') }
    if (!check.pass) throw new BizError(1001, '评论未通过内容检测，请修改后重试')
    let file, mediaPath, review
    try {
      if (media) {
        const name = 'comment-' + randomUUID() + '.' + media.ext
        file = path.join(uploads, name)
        mediaPath = '/uploads/' + name
        await mkdir(uploads, { recursive: true })
        await writeFile(file, media.buffer, { flag: 'wx' })
        try { review = await mediaCheckAsync(apiImg(mediaPath, req), account?.mini_a_openid) }
        catch { throw new BizError(1001, '媒体审核暂不可用，请稍后重试') }
      }
      const pending = Boolean(review && !review.mock)
      return await tx(async db => {
        const locked = await publishedNote(db, req.params.id, true)
        const parent = replyTo ? await visibleComment(db, locked.id, replyTo) : null
        const rootId = parent ? parent.root_id || parent.id : null
        const id = await db.ins(`INSERT INTO content_note_comment
          (note_id,user_id,root_id,reply_to,body,media_kind,media_path,media_state,media_trace) VALUES(?,?,?,?,?,?,?,?,?)`,
          [locked.id, user.uid, rootId, parent?.id || null, body, media?.kind || null, mediaPath || null, pending ? 0 : 1, pending ? review.traceId : null])
        if (!pending) await bumpCount(db, locked.id, 1)
        return { id, rootId, pending }
      })
    } catch (error) {
      if (file) await unlink(file).catch(() => {})
      throw error
    }
  },

  // 评论点赞（一用户一评一赞，可取消）
  'PUT /c/notes/:id/comments/:commentId/like': async req => {
    const user = requireUser(req)
    const note = await publishedNote({ one }, req.params.id)
    const row = await visibleComment({ one }, note.id, req.params.commentId)
    if (req.body?.liked === true) await q('INSERT IGNORE INTO content_note_comment_like(comment_id,user_id) VALUES(?,?)', [row.id, user.uid])
    else await q('DELETE FROM content_note_comment_like WHERE comment_id=? AND user_id=?', [row.id, user.uid])
    return { liked: req.body?.liked === true, likes: Number((await one('SELECT COUNT(*) n FROM content_note_comment_like WHERE comment_id=?', [row.id])).n) }
  },

  // 作者删除自己的评论（软删，回复保留但列表过滤后不再展示楼一层时整楼折叠）
  'DELETE /c/notes/:id/comments/:commentId': async req => {
    const user = requireUser(req)
    return tx(async db => {
      const note = await publishedNote(db, req.params.id, true)
      const row = await visibleComment(db, note.id, req.params.commentId, user.uid)
      if (Number(row.user_id) !== Number(user.uid)) throw new BizError(1003, '仅评论本人可以删除')
      await db.q('UPDATE content_note_comment SET deleted_at=NOW() WHERE id=? AND user_id=?', [row.id, user.uid])
      await bumpCount(db, note.id, -1)
      return { deleted: true }
    })
  },
}
