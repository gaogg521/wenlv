// X-05 消息触达：订阅消息统一发送入口 + 下发记录。
// 场景 → 模板密钥的映射在这里集中维护；未配置模板时记 result=skipped 且不报错（外部条件：正式模板 ID 由负责人在安全中心录入）。
// MOCK 身份/无 access_token 时 wxapi 返回 {mock:true}，同样落 notify_log，保证「MOCK 下发记录可查」的验收口径。
import { q } from '../db.mjs'
import * as wxapi from './wxapi.mjs'

export const SCENES = {
  pay_ok:            { key: 'WX_TMPL_PAY_OK',          target: 'tourist'  },
  group_cancel:      { key: 'WX_TMPL_GROUP_CANCEL',    target: 'tourist'  },
  depart_reminder:   { key: 'WX_TMPL_DEPART_REMIND',   target: 'tourist'  },
  refund_done:       { key: 'WX_TMPL_REFUND_DONE',     target: 'tourist'  },
  note_review:       { key: 'WX_TMPL_NOTE_REVIEW',     target: 'tourist'  },
  new_order:         { key: 'WX_TMPL_NEW_ORDER',       target: 'merchant' },
  refund_apply:      { key: 'WX_TMPL_REFUND_APPLY',    target: 'merchant' },
  settlement_pending:{ key: 'WX_TMPL_SETTLE_PENDING',  target: 'merchant' },
}

async function logNotify({ scene, target, openid = null, templateId = null, bizRef = null, payload = null, result, error = null, mock = 0 }) {
  try {
    await q(`INSERT INTO notify_log (scene, target, openid, template_id, biz_ref, payload, mock, result, error)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [scene, target, openid || null, templateId || null, bizRef || null, payload ? JSON.stringify(payload) : null, mock, result, error ? String(error).slice(0, 250) : null])
  } catch (e) { console.error('[notify:log]', scene, e.message) }
}

/** 取某场景配置的模板 ID（密钥金库 → 环境变量兜底） */
export async function templateFor(scene) {
  const sc = SCENES[scene]
  if (!sc) return null
  const { getSecrets } = await import('../infra/secrets.mjs')
  const s = await getSecrets([sc.key])
  return s[sc.key] || process.env[sc.key] || null
}

/**
 * 统一发送：查模板 → 未配置记 skipped；发送结果（sent/mock/failed）都落 notify_log。
 * 永不抛错——消息触达失败不能阻断主链路。
 */
export async function sendScene({ scene, openid, bizRef = null, data = {}, page }) {
  const sc = SCENES[scene]
  const target = sc ? sc.target : 'tourist'
  try {
    const tpl = await templateFor(scene)
    if (!tpl || !openid) {
      await logNotify({ scene, target, openid, templateId: tpl, bizRef, payload: data, result: 'skipped' })
      return { skipped: true }
    }
    const r = await wxapi.sendSubscribeMessage(openid, tpl, data, page)
    const result = r.accepted ? (r.mock ? 'mock' : 'sent') : 'failed'
    await logNotify({ scene, target, openid, templateId: tpl, bizRef, payload: data, result, error: r.err || null, mock: r.mock ? 1 : 0 })
    return r
  } catch (e) {
    await logNotify({ scene, target, openid, bizRef, payload: data, result: 'failed', error: e.message })
    return { failed: true }
  }
}

/** 给门店全部在职员工发送某场景通知（X-05 商户侧：新订单/退款申请/结算待确认） */
export async function notifyMerchant(merchantId, { scene, bizRef = null, data = {}, page }) {
  const staff = await q(`SELECT DISTINCT u.mini_b_openid openid FROM merchant_staff s
    JOIN user_account u ON u.id = s.user_id WHERE s.merchant_id = ? AND s.status = 1`, [merchantId])
  for (const st of staff) await sendScene({ scene, openid: st.openid, bizRef, data, page })
  return { sent: staff.length }
}
