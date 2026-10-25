// 鉴权：JWT(HMAC-SHA256) + wx.login code2Session + 后台密码(scrypt)
import crypto from 'node:crypto'
import https from 'node:https'

const SECRET = process.env.JWT_SECRET || 'wanderlust-dev-jwt-secret-change-me'

function b64u(s) { return Buffer.from(s).toString('base64url') }

export function jwtSign(payload, ttlSec = 7200) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }))
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function jwtVerify(token) {
  if (!token || typeof token !== 'string') return null
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) return null
  const expect = crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url')
  if (expect !== s) return null
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null
    return p
  } catch { return null }
}

export function authUser(req) {
  const p = jwtVerify((req.headers.authorization || '').replace(/^Bearer /, ''))
  return p && p.uid ? p : null
}
export function requireUser(req) {
  const u = authUser(req)
  if (!u) throw Object.assign(new Error('未登录'), { code: 1002 })
  return u
}

/** wx.login → code2Session；未配置 appid 时返回 mock openid（开发联调模式） */
export async function code2Session(jsCode) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret || /^mock-/.test(jsCode)) {
    return { openid: 'mock-openid-' + jsCode, unionid: 'mock-union-' + jsCode }
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${jsCode}&grant_type=authorization_code`
  return await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

/** scrypt 密码散列：salt$hex */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex')
  return salt + '$' + hash
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split('$')
  if (!salt || !hash) return false
  const calc = crypto.scryptSync(pw, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))
}
