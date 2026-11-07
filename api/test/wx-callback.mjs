import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { decodeWxCallback } from '../src/infra/wx-callback.mjs'
const token = 'callback-test-token', appid = 'wx-test-app', aesKey = crypto.randomBytes(32).toString('base64').replace(/=$/, '')
const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'test-nonce'
const sign = (...parts) => crypto.createHash('sha1').update(parts.sort().join('')).digest('hex')
function encrypted(text, receiver = appid) {
  const key = Buffer.from(aesKey + '=', 'base64'), data = Buffer.from(text)
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
  const raw = Buffer.concat([crypto.randomBytes(16), size, data, Buffer.from(receiver)])
  const pad = 32 - raw.length % 32
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}
const message = { Event: 'wxa_media_check', appid, trace_id: 'trace-1', errcode: 0, result: { suggest: 'pass' } }
const content = encrypted(JSON.stringify(message))
const query = { timestamp, nonce, msg_signature: sign(token, timestamp, nonce, content) }
const input = { query, token, appid, aesKey, production: true, rawBody: JSON.stringify({ Encrypt: content }) }
assert.deepEqual(decodeWxCallback(input).message, message)
assert.deepEqual(decodeWxCallback({ ...input, rawBody: `<xml><Encrypt><![CDATA[${content}]]></Encrypt></xml>` }).message, message)
assert.throws(() => decodeWxCallback({ ...input, query: { ...query, msg_signature: '0'.repeat(40) } }))
assert.throws(() => decodeWxCallback({ ...input, now: Date.now() + 700_000 }))
const wrong = encrypted(JSON.stringify(message), 'wx-another-app')
assert.throws(() => decodeWxCallback({ ...input, query: { timestamp, nonce, msg_signature: sign(token, timestamp, nonce, wrong) }, rawBody: JSON.stringify({ Encrypt: wrong }) }))
const echo = encrypted('verified-echo')
assert.equal(decodeWxCallback({ ...input, query: { timestamp, nonce, echostr: echo, msg_signature: sign(token, timestamp, nonce, echo) } }).echo, 'verified-echo')
const plainQuery = { timestamp, nonce, signature: sign(token, timestamp, nonce) }
assert.throws(() => decodeWxCallback({ token, appid, production: true, query: plainQuery, rawBody: JSON.stringify(message) }))
assert.deepEqual(decodeWxCallback({ token, appid, production: false, query: plainQuery, rawBody: JSON.stringify(message) }).message, message)
console.log('微信回执：JSON/XML安全模式、签名篡改、超时、AppID绑定、URL验证及生产拒绝明文通过')
