// 笔记发布奖励（小红书化改造）：status=2 正式发布时发旅豆，幂等 + 月度防刷上限
// 三条发布路径共用：saveNote 机审直通 / media-review 回执全过 / 人工审核 verdict 通过。
// 幂等双保险：content_note.reward_granted 标记 + bean_ledger biz_ref='note-<id>' 天然唯一。
// 发放失败不阻断发布：无预算/超上限/冻结用户一律静默跳过（下次发布路径重试时由标记防重）。
import { q, one } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { grant, BIZ } from './bean.mjs'
import { isUserFrozen } from './promo.mjs'

export async function grantPublishReward(c, userId, noteId) {
  try {
    const beans = Math.floor(await cfgNum('content.publish_reward_beans'))
    if (!(beans > 0)) return 0
    const note = await c.one('SELECT id, user_id, reward_granted FROM content_note WHERE id = ? FOR UPDATE', [noteId])
    if (!note || Number(note.user_id) !== Number(userId) || Number(note.reward_granted)) return 0
    if (await isUserFrozen(userId)) return 0
    const cap = Math.floor(await cfgNum('content.publish_reward_monthly_cap'))
    if (cap > 0) {
      const used = await q(`SELECT COUNT(*) n FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
        WHERE a.user_id = ? AND l.biz_type = ? AND l.direction = 1 AND l.biz_ref LIKE 'note-%'
          AND l.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [userId, BIZ.CONTENT])
      if (Number(used[0].n) >= cap) return 0
    }
    const budget = await one('SELECT id, total, granted, returned FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
    if (!budget) return 0
    if (Number(budget.granted) + beans > Number(budget.total) + Number(budget.returned)) return 0
    await grant(userId, beans, BIZ.CONTENT, 'note-' + noteId, budget.id, c)
    await c.upd('UPDATE content_note SET reward_granted = 1 WHERE id = ?', [noteId])
    return beans
  } catch {
    return 0
  }
}
