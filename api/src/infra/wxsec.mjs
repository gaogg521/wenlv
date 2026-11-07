// 内容安全（微信 msgSecCheck）：配置 AppID/Secret → 真实检测；未配置 → MOCK 放行（联调）
// access_token 统一走 wxapi（官方 stable_token 接口），本文件不再自取
import { callWx, demoIdentity } from '../domain/wxapi.mjs'

/** @returns {{pass: boolean, mock: boolean, label?: string}} */
export async function msgSecCheck(text, openid) {
  if (demoIdentity(openid)) return { pass: true, mock: true }
  const r = await callWx('/wxa/msg_sec_check', { content: String(text).slice(0, 2500), openid, version: 2, scene: 2 })
  if (!r) return { pass: true, mock: true }
  if (r.errcode === 0) return { pass: r.result?.suggest === 'pass', mock: false, label: r.result?.suggest || '检测结果不完整，转人工复核' }
  if (r.errcode === 87014) return { pass: false, mock: false, label: '内容含违规风险' }
  throw new Error('微信文本审核失败，错误码 ' + (r.errcode || 'unknown'))
}
