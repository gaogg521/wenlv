// C-06：腾讯云短信 API v3 真实发送器（TC3-HMAC-SHA256 签名，node:crypto + node:https，不引入 SDK）。
// 字段来源：集成中心 SMS_TENCENT_SECRET_ID/SECRET_KEY/SDKAPPID/SIGN/TEMPLATE_ID（mfa.mjs detect）。
// 测试可用 SMS_TENCENT_ENDPOINT 覆盖端点（本机假服务，支持 http:// 以便免证书）；失败必须抛错，
// 绝不静默成功或降级假成功；不把密钥/验证码写进日志或错误消息。
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'

const ENDPOINT = () => (process.env.SMS_TENCENT_ENDPOINT || 'https://sms.tencentcloudapi.com').replace(/\/+$/, '')
const SERVICE = 'sms'
const VERSION = '2021-01-11'
const ACTION = 'SendSms'

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest() }

/** TC3-HMAC-SHA256 签名（腾讯云 API v3 规范），返回 { headers, payload } */
export function buildRequest({ secretId, secretKey, sdkAppId, signName, templateId, mobile, code, ttlMinutes = 5 }, now = new Date()) {
  const e164 = mobile.startsWith('+') ? mobile : '+86' + mobile.replace(/\D/g, '')
  const payload = JSON.stringify({
    PhoneNumberSet: [e164],
    SmsSdkAppId: String(sdkAppId),
    SignName: String(signName),
    TemplateId: String(templateId),
    TemplateParamSet: [String(code), String(ttlMinutes)],
  })
  const date = now.toISOString().slice(0, 10)
  const ts = Math.floor(now.getTime() / 1000)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${ENDPOINT().replace(/^https?:\/\//, '')}\nx-tc-action:${ACTION.toLowerCase()}\n`
  const hashedRequestPayload = sha256Hex(payload)
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\ncontent-type;host;x-tc-action\n${hashedRequestPayload}`
  const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${date}/${SERVICE}/tc3_request\n${sha256Hex(canonicalRequest)}`
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, SERVICE)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: ENDPOINT().replace(/^https?:\/\//, ''),
    'X-TC-Action': ACTION,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(ts),
    'X-TC-Region': process.env.SMS_TENCENT_REGION || 'ap-guangzhou',
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`,
  }
  return { headers, payload }
}

export async function sendSms({ secretId, secretKey, sdkAppId, signName, templateId, mobile, code }) {
  if (!secretId || !secretKey || !sdkAppId || !signName || !templateId) throw new Error('短信凭据不完整（需要 SECRET_ID/SECRET_KEY/SDKAPPID/SIGN/TEMPLATE_ID）')
  const { headers, payload } = buildRequest({ secretId, secretKey, sdkAppId, signName, templateId, mobile, code })
  const body = await new Promise((resolve, reject) => {
    const mod = ENDPOINT().startsWith('http://') ? http : https
    const req = mod.request(ENDPOINT() + '/', { method: 'POST', headers, timeout: 10_000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('timeout', () => { req.destroy(new Error('短信网关请求超时（10s）')) })
    req.on('error', (e) => reject(e))
    req.end(payload)
  })
  let j
  try { j = JSON.parse(body) } catch { throw new Error('短信网关响应不是 JSON：' + String(body).slice(0, 120)) }
  if (j.Response && j.Response.Error) throw new Error('短信网关拒绝：[' + j.Response.Error.Code + '] ' + j.Response.Error.Message)
  const st = j.Response && j.Response.SendStatusSet && j.Response.SendStatusSet[0]
  if (!st || st.Code !== 'Ok') throw new Error('短信发送失败：' + (st ? '[' + st.Code + '] ' + st.Message : '响应缺少 SendStatusSet'))
  return { ok: true, sessionId: st.SessionId || null }
}
