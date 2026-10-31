// 风控告警外推：把 risk_event 里没人盯的严重告警推到外部 webhook。
// 扫描条件：severity >= 2 且 handled=0 且 notified_at IS NULL（V21 迁移）。
// 两种模式：
//   wecom（默认）= 企业微信群机器人格式 {"msgtype":"text","text":{"content":...}}
//   raw          = 直接 POST {text, level, events} 原始 JSON（飞书自定义机器人等自行适配）
// 未配置 ALERT_WEBHOOK_URL 时静默跳过——绝不因为告警通道缺失而影响主流程。
import { q } from '../db.mjs'

const WEBHOOK = process.env.ALERT_WEBHOOK_URL || ''
const MODE = (process.env.ALERT_WEBHOOK_MODE || 'wecom').toLowerCase()

export function notifyConfigured() {
  return !!WEBHOOK
}

async function post(text, events) {
  const body = MODE === 'wecom'
    ? { msgtype: 'text', text: { content: text } }
    : { text, level: 'severe', events }
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('webhook HTTP ' + res.status)
}

/** 每轮调用：推未通知的严重告警。同一事件只推一次（notified_at 落库），失败即停不重试风暴。 */
export async function tickRiskNotify(limit = 5) {
  if (!WEBHOOK) return { skipped: true, reason: 'ALERT_WEBHOOK_URL 未配置' }
  const rows = await q(
    `SELECT * FROM risk_event WHERE severity >= 2 AND handled = 0 AND notified_at IS NULL
     ORDER BY id ASC LIMIT ${Number(limit)}`)
  const sent = []
  for (const r of rows) {
    const detail = r.detail ? JSON.stringify(r.detail).slice(0, 500) : ''
    const text = `[文旅·风控告警] #${r.id} ${r.kind} 严重度=${r.severity}\n${detail}\n${new Date(r.created_at).toLocaleString('zh-CN')}`
    try {
      await post(text, rows)
      await q('UPDATE risk_event SET notified_at = NOW(3) WHERE id = ?', [r.id])
      sent.push(Number(r.id))
    } catch (e) {
      console.error('[notify:err]', r.id, e.message)
      break // 通道故障即停，下轮再试；未推送的下一轮仍会被扫到
    }
  }
  if (sent.length) console.log('[job:notify] sent', sent.join(','))
  return { checked: rows.length, sent }
}
