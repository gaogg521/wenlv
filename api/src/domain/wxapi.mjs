// 微信服务端 API 统一层（对照官方 OpenApiDoc）：
// getStableAccessToken / getUnlimitedQRCode / getPhoneNumber / subscribeMessage.send / mediaCheckAsync
// 凭据：后台集成中心（secrets）优先，.env 兜底；未配置 → MOCK 语义返回（联调不中断）
import https from 'node:https'
import { getSecrets } from '../infra/secrets.mjs'

const post = (url, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
    (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } }) })
  req.on('error', reject); req.write(data); req.end()
})
const get = (url) => new Promise((resolve, reject) => {
  https.get(url, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } }) }).on('error', reject)
})

let _tok = null, _tokExp = 0

/** 稳定版接口调用凭据（官方推荐：getStableAccessToken，force_refresh=false 自动续期） */
export async function accessToken(force = false) {
  if (!force && _tok && Date.now() < _tokExp) return _tok
  const s = await getSecrets(['WX_APPID', 'WX_SECRET'])
  const appid = s.WX_APPID || process.env.WX_APPID
  const secret = s.WX_SECRET || process.env.WX_SECRET
  if (!appid || !secret) return null // MOCK 模式
  const j = await post('https://api.weixin.qq.com/cgi-bin/stable_token',
    { grant_type: 'client_credential', appid, secret, force_refresh: false })
  if (!j.access_token) throw new Error('stable_token failed: ' + JSON.stringify(j))
  _tok = j.access_token
  _tokExp = Date.now() + (Number(j.expires_in) - 120) * 1000
  return _tok
}

/**
 * 获取不限制的小程序码（getUnlimitedQRCode）
 * @param scene 32 字符内参数；page 需已发布；MOCK 返回 null 由前端展示占位
 * @returns {{buffer:Buffer|null, mock:boolean}}
 */
export async function getUnlimitedQRCode(scene, page) {
  const token = await accessToken()
  if (!token) return { buffer: null, mock: true }
  const j = await post(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`,
    { scene: String(scene).slice(0, 32), page: page || 'pages/home/index', check_path: false, env_version: 'release', width: 430 })
  if (j.errcode) throw new Error('getUnlimitedQRCode failed: ' + JSON.stringify(j))
  return { buffer: Buffer.from(j), mock: false } // 返回的是图片二进制
}

/** 手机号快速验证：getPhoneNumber（前端 button open-type=getPhoneNumber 的 code 换手机号） */
export async function getPhoneNumber(code) {
  const token = await accessToken()
  if (!token) return { phoneNumber: '138' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), mock: true }
  const j = await post(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, { code })
  if (j.errcode !== 0) throw new Error('getPhoneNumber failed: ' + JSON.stringify(j))
  return { phoneNumber: j.phone_info.purePhoneNumber, mock: false }
}

/** 订阅消息发送（sendMessage）：一次性模板 */
export async function sendSubscribeMessage(openid, templateId, data, page) {
  if (!templateId || !openid) return { skipped: true }
  const token = await accessToken()
  if (!token) return { mock: true, accepted: true }
  const j = await post(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { touser: openid, template_id: templateId, page: page || 'pages/home/index', data })
  return { mock: false, accepted: j.errcode === 0, err: j.errcode ? j.errmsg : null }
}

/** 多媒体内容安全（mediaCheckAsync，异步回执）——P1 图片笔记审核 */
export async function mediaCheckAsync(mediaUrl, openid, scene = 2) {
  const token = await accessToken()
  if (!token) return { mock: true, traceId: 'mock-' + Date.now() }
  const j = await post(`https://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`,
    { media_url: mediaUrl, media_type: 2, version: 2, scene, openid })
  return { mock: false, traceId: j.trace_id }
}

/** 小程序访问趋势（数据分析 getDailyVisitTrend）——运营后台「小程序数据」卡片 */
export async function getDailyVisitTrend(days = 7) {
  const token = await accessToken()
  if (!token) {
    // MOCK：稳定伪随机，联调可见图
    const out = []
    let base = 120
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      base += Math.floor(Math.sin(i * 2.7) * 22)
      out.push({ date: d.toISOString().slice(0, 10), visitPv: base + 40, visitUv: Math.floor(base * 0.62) })
    }
    return { mock: true, list: out }
  }
  const out = []
  for (let i = days; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const j = await get(`https://api.weixin.qq.com/dataanalysis/getdailyvisittrend?access_token=${token}&begin_date=${ds}&end_date=${ds}`)
    if (j.list && j.list[0]) out.push({ date: ds, visitPv: Number(j.list[0].visit_pv), visitUv: Number(j.list[0].visit_uv) })
  }
  return { mock: false, list: out }
}
