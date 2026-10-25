// 内容安全（微信 msgSecCheck）：配置 AppID/Secret → 真实检测；未配置 → MOCK 放行（联调）
// access_token 统一走 wxapi（官方 stable_token 接口），本文件不再自取
import { accessToken } from '../domain/wxapi.mjs'
import https from 'node:https'

/** @returns {{pass: boolean, mock: boolean, label?: string}} */
export async function msgSecCheck(text, openid) {
  const token = await accessToken()
  if (!token) return { pass: true, mock: true }
  const r = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: String(text).slice(0, 2500), ...(openid ? { openid } : {}) })
    const req = https.request({
      hostname: 'api.weixin.qq.com', path: '/wxa/msg_sec_check?access_token=' + token,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } }) })
    req.on('error', reject); req.write(body); req.end()
  })
  if (r.errcode === 0) return { pass: true, mock: false }
  if (r.errcode === 87014) return { pass: false, mock: false, label: '内容含违规风险' }
  throw new Error('msgSecCheck failed: ' + JSON.stringify(r))
}
