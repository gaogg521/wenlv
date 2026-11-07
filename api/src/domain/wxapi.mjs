// 微信服务端 API 统一层（对照官方 OpenApiDoc）：
// getStableAccessToken / getUnlimitedQRCode / getPhoneNumber / subscribeMessage.send / mediaCheckAsync
// 凭据：后台集成中心（secrets）优先，.env 兜底；未配置 → MOCK 语义返回（联调不中断）
import https from 'node:https'
import http from 'node:http'
import { getSecrets } from '../infra/secrets.mjs'

const base = () => {
  const value = process.env.WX_API_BASE || 'https://api.weixin.qq.com'
  if (value !== 'https://api.weixin.qq.com') {
    const u = new URL(value)
    if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('微信测试接口只能指向本机隔离服务')
  }
  return value.replace(/\/$/, '')
}
const post = (url, body, binary = false) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const req = (url.startsWith('http:') ? http : https).request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
    (res) => {
      const chunks = []; let size = 0
      res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('微信响应过大')); else chunks.push(chunk) })
      res.on('end', () => {
        const bytes = Buffer.concat(chunks)
        if (binary && String(res.headers['content-type']).startsWith('image/')) return resolve(bytes)
        try { resolve(JSON.parse(bytes.toString())) } catch { reject(new Error('微信响应格式不正确')) }
      })
    })
  req.setTimeout(15000, () => req.destroy(new Error('微信接口请求超时')))
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
  if (!appid || !secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('微信接口凭据缺失，生产环境不允许模拟审核')
    return null
  }
  const j = await post(base() + '/cgi-bin/stable_token',
    { grant_type: 'client_credential', appid, secret, force_refresh: false })
  if (!j.access_token) throw new Error('微信凭据验证失败，错误码 ' + (j.errcode || 'unknown'))
  _tok = j.access_token
  _tokExp = Date.now() + (Number(j.expires_in) - 120) * 1000
  return _tok
}

/** 统一微信JSON请求；测试只能注入本机服务，不把凭据发往任意地址。 */
export async function callWx(path, body) {
  const token = await accessToken()
  if (!token) return null
  return post(base() + path + '?access_token=' + encodeURIComponent(token), body)
}

export const demoIdentity = openid => process.env.NODE_ENV !== 'production' && String(openid || '').startsWith('mock-openid-')

/**
 * 获取不限制的小程序码（getUnlimitedQRCode）
 * @param scene 32 字符内参数；page 需已发布；MOCK 返回 null 由前端展示占位
 * @returns {{buffer:Buffer|null, mock:boolean}}
 */
export async function getUnlimitedQRCode(scene, page) {
  const token = await accessToken()
  if (!token) return { buffer: null, mock: true }
  const j = await post(base() + `/wxa/getwxacodeunlimit?access_token=${token}`,
    { scene: String(scene).slice(0, 32), page: page || 'pages/home/index', check_path: false, env_version: 'release', width: 430 }, true)
  if (!Buffer.isBuffer(j)) throw new Error('微信小程序码生成失败，错误码 ' + (j.errcode || 'invalid_image'))
  return { buffer: j, mock: false }
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
  if (demoIdentity(openid)) return { mock: true, accepted: true }
  if (String(openid).startsWith('mock-')) throw new Error('生产通知不允许模拟微信身份')
  const token = await accessToken()
  if (!token) return { mock: true, accepted: true }
  const j = await post(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { touser: openid, template_id: templateId, page: page || 'pages/home/index', data })
  return { mock: false, accepted: j.errcode === 0, err: j.errcode ? j.errmsg : null }
}

/** 多媒体内容安全（mediaCheckAsync，异步回执）——P1 图片笔记审核 */
export async function mediaCheckAsync(mediaUrl, openid, scene = 2) {
  if (demoIdentity(openid)) return { mock: true, traceId: 'mock-' + Date.now() }
  if (!openid || String(openid).startsWith('mock-')) throw new Error('图片审核需要真实微信登录身份')
  const url = new URL(mediaUrl)
  if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(url.hostname)) throw new Error('图片审核需要微信可访问的公网HTTPS图片地址')
  const token = await accessToken()
  if (!token) return { mock: true, traceId: 'mock-' + Date.now() }
  const j = await post(base() + `/wxa/media_check_async?access_token=${token}`,
    { media_url: mediaUrl, media_type: 2, version: 2, scene, openid })
  if (Number(j.errcode) !== 0 || !j.trace_id) throw new Error('微信图片审核提交失败，错误码 ' + (j.errcode || 'missing_trace_id'))
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
