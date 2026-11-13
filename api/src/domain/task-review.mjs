// 内容审核：把投稿（游记）还原成审核员能看的样子，并按约稿要求自动核对。
// 约稿任务和笔记审核共用；判定本身仍由人做，这里只负责"让人看得到、核得清"。
import { one, q } from '../db.mjs'
import { sanitizeRich } from '../infra/sanitize.mjs'
import { readValues } from './entity-schema.mjs'

const parseBody = (b) => {
  if (b == null) return {}
  if (typeof b === 'object') return b
  try { return JSON.parse(b) } catch { return { text: String(b) } }
}

/** 纯文本：去标签、还原常见实体、压缩空白 */
export function plainText(html) {
  return String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
/** 字数：按中文习惯计，去掉空白后的字符数 */
export const wordCount = (text) => String(text || '').replace(/\s+/g, '').length

/** 笔记 → 审核视图：清洗后的正文 HTML、纯文本、图片（编辑器内嵌图 + 附图）、字数 */
export function noteView(note, img = (u) => u) {
  const body = parseBody(note.body)
  const html = sanitizeRich(String(body.text || ''))
  const text = plainText(html)
  const inline = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1])
  const images = [...new Set([...(Array.isArray(body.images) ? body.images : []), ...inline])].filter(Boolean)
  return {
    id: Number(note.id), title: note.title || '', html: html.replace(/(<img[^>]+src=")([^"]+)"/gi, (_, a, u) => a + img(u) + '"'),
    text, images: images.map(img), video: body.video ? img(body.video) : null, revision: Number(note.revision || 1), wordCount: wordCount(text), imageCount: images.length,
    status: Number(note.status), publishedAt: note.published_at || null, createdAt: note.created_at || null,
    likeCount: Number(note.like_count || 0), rejectReason: note.reject_reason || null,
    machineCheck: note.sec_check_id === 'mock' ? '联调通道（未经真实机审）' : (note.sec_check_id ? '已过微信内容安全检测' : '—'),
  }
}

/** 按约稿要求逐项自动核对（只做机器能确定的事；审核标准由人逐条确认） */
export function autoChecks(req, view, submittedAt) {
  const hay = (view.title + '\n' + view.text).toLowerCase()
  const out = []
  if (req.min_words) out.push({ key: 'words', label: `字数 ≥ ${req.min_words}`, ok: view.wordCount >= req.min_words, detail: `实际 ${view.wordCount} 字` })
  if (req.min_images) out.push({ key: 'images', label: `图片 ≥ ${req.min_images} 张`, ok: view.imageCount >= req.min_images, detail: `实际 ${view.imageCount} 张` })
  for (const w of req.must_mention || []) out.push({ key: 'must:' + w, label: `提及「${w}」`, ok: hay.includes(String(w).toLowerCase()), detail: hay.includes(String(w).toLowerCase()) ? '已提及' : '未找到' })
  for (const w of req.forbidden || []) out.push({ key: 'ban:' + w, label: `不出现「${w}」`, ok: !hay.includes(String(w).toLowerCase()), detail: hay.includes(String(w).toLowerCase()) ? '出现了' : '未出现' })
  if (req.deadline && submittedAt) {
    const late = new Date(String(submittedAt).replace(' ', 'T')) > new Date(String(req.deadline).replace(' ', 'T'))
    out.push({ key: 'deadline', label: '截止前提交', ok: !late, detail: late ? '逾期提交' : '按时' })
  }
  out.push({ key: 'published', label: '作品仍在发布状态', ok: view.status === 2, detail: view.status === 2 ? '已发布' : '作品已下架或未发布' })
  return out
}

/** 约稿要求（来自任务资料，表单引擎维护） */
export function requirementsOf(t) {
  const v = readValues('task', t)
  return {
    brief: t.brief, rich_brief: t.rich_brief ? sanitizeRich(t.rich_brief) : '', category: t.category,
    must_mention: v.must_mention || [], forbidden: v.forbidden || [], review_rules: v.review_rules || [],
    min_words: Number(t.min_words) || 0, min_images: Number(t.min_images) || 0, deadline: v.deadline || null,
    reward_beans: Number(t.reward_beans) || 0, cash_reward: Number(t.cash_reward) || 0,
  }
}

/** 某位参与者的审核材料：约稿要求、当前投稿、作者、自动核对、该参与者的历次审核记录 */
export async function entryReviewPack(entryId, img) {
  const e = await one('SELECT * FROM content_task_entry WHERE id = ?', [entryId])
  if (!e) return null
  const t = await one('SELECT * FROM content_task WHERE id = ?', [e.task_id])
  const req = requirementsOf(t)
  const author = await one(`SELECT u.id, u.nickname, u.creator_tag,
      (SELECT COUNT(*) FROM content_note n WHERE n.user_id = u.id AND n.status = 2) published,
      (SELECT COUNT(*) FROM content_task_entry k WHERE k.user_id = u.id AND k.status = 3) done_tasks
    FROM user_account u WHERE u.id = ?`, [e.user_id])
  const note = e.note_id ? await one('SELECT * FROM content_note WHERE id = ?', [e.note_id]) : null
  const submission = note ? noteView(note, img) : null
  const product = t.product_id ? await one('SELECT id, title FROM tour_product WHERE id = ?', [t.product_id]) : null
  const history = await q('SELECT id, note_id, verdict, reason, reviewer, created_at FROM content_task_review WHERE entry_id = ? ORDER BY id DESC LIMIT 20', [e.id])
  return {
    task: { id: Number(t.id), task_no: t.task_no, title: t.title, status: Number(t.status) },
    entry: { id: Number(e.id), status: Number(e.status), claimed_at: e.claimed_at, submitted_at: e.submitted_at, finished_at: e.finished_at,
      reward_beans: Number(e.reward_beans), cash_reward: Number(e.cash_reward), cash_status: Number(e.cash_status), cash_ref: e.cash_ref, cash_paid_at: e.cash_paid_at },
    requirements: req, product, author, submission,
    checks: submission ? autoChecks(req, submission, e.submitted_at) : [],
    history,
  }
}
