import crypto from 'node:crypto'

const denied = () => { throw Object.assign(new Error('微信回调校验失败'), { statusCode: 403 }) }
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const tag = (xml, key) => {
  const text = String(xml).match(new RegExp('<' + key + '>([\\s\\S]*?)</' + key + '>'))?.[1] || ''
  return text.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim()
}
const parse = text => {
  if (text.trim().startsWith('{')) return JSON.parse(text)
  return { Event: tag(text, 'Event'), appid: tag(text, 'appid'), trace_id: tag(text, 'trace_id'), errcode: tag(text, 'errcode'), result: { suggest: tag(text, 'suggest'), label: tag(text, 'label') } }
}

/** 微信安全模式消息：验签、AES-CBC/PKCS7(32)解密及接收AppID绑定。 */
export function decodeWxCallback({ query, rawBody = '', token, aesKey, appid, now = Date.now(), production = process.env.NODE_ENV === 'production' }) {
  if (!token || !appid || !query.timestamp || !query.nonce || Math.abs(now / 1000 - Number(query.timestamp)) > 600 || !Number.isFinite(Number(query.timestamp))) denied()
  let encrypted = query.echostr || ''
  if (!query.echostr) {
    try { encrypted = JSON.parse(rawBody).Encrypt || '' } catch { encrypted = tag(rawBody, 'Encrypt') }
  }
  const signedEncryption = !!query.msg_signature
  if (!signedEncryption && (production || aesKey)) denied()
  const parts = [token, query.timestamp, query.nonce, ...(signedEncryption ? [encrypted] : [])]
  const signature = crypto.createHash('sha1').update(parts.map(String).sort().join('')).digest('hex')
  if (!equal(signature, signedEncryption ? query.msg_signature : query.signature)) denied()
  let plain = rawBody
  if (signedEncryption) {
    if (!aesKey || !encrypted || aesKey.length !== 43) denied()
    try {
      const key = Buffer.from(aesKey + '=', 'base64')
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)); decipher.setAutoPadding(false)
      let bytes = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()])
      const pad = bytes.at(-1)
      if (!pad || pad > 32 || !bytes.subarray(-pad).every(x => x === pad)) denied()
      bytes = bytes.subarray(0, -pad)
      const n = bytes.readUInt32BE(16)
      if (n > bytes.length - 20 || bytes.subarray(20 + n).toString() !== appid) denied()
      plain = bytes.subarray(20, 20 + n).toString()
    } catch { denied() }
  }
  if (query.echostr) return { echo: signedEncryption ? plain : query.echostr }
  const message = parse(plain)
  if (message.appid && message.appid !== appid) denied()
  return { message }
}
