// C-06/C-07 真实发送器离线测试：假腾讯云 HTTP 端点 + 假 SMTP 服务器（不依赖数据库，纳入 npm test）
// 覆盖：TC3 签名请求形态（Authorization/Campaign 参数/E.164/模板参数 [验证码, 有效期]）、
//       网关错误/业务失败/非 JSON 必须抛错、SMTP 会话命令序列与 base64 主题/正文、错误密码抛错不静默。
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { buildRequest, sendSms } from '../src/infra/sms-tencent.mjs'
import { sendMail } from '../src/infra/smtp.mjs'

let pass = 0
const t = (name, fn) => fn().then(() => { pass++; console.log('  ✓', name) })

const CRED = { secretId: 'AKIDtest', secretKey: 'secret-test-key', sdkAppId: '1400000000', signName: '向往的自由', templateId: '2000001' }

console.log('== C-06 腾讯云短信 ==')
await t('TC3 签名请求形态：Authorization/动作/模板参数/E.164 手机号', async () => {
  const { headers, payload } = buildRequest({ ...CRED, mobile: '13800138000', code: '123456' })
  assert.match(headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDtest\/\d{4}-\d{2}-\d{2}\/sms\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/)
  assert.equal(headers['X-TC-Action'], 'SendSms')
  const body = JSON.parse(payload)
  assert.deepEqual(body.PhoneNumberSet, ['+8613800138000'])
  assert.deepEqual(body.TemplateParamSet, ['123456', '5'])
  assert.equal(body.SmsSdkAppId, '1400000000')
  assert.equal(body.SignName, '向往的自由')
})

const smsPort = 18081 + Math.floor(Math.random() * 500)
const smsHits = []
const smsServer = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    smsHits.push({ auth: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8'), mode: smsServer.mode })
    const mode = smsServer.mode
    if (mode === 'err') res.end(JSON.stringify({ Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: '签名不匹配' } } }))
    else if (mode === 'bizfail') res.end(JSON.stringify({ Response: { SendStatusSet: [{ Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: '当日已达上限' }] } }))
    else if (mode === 'badjson') res.end('<html>gateway</html>')
    else res.end(JSON.stringify({ Response: { SendStatusSet: [{ Code: 'Ok', Message: 'send success', SessionId: 'sess-1' }] }, RequestId: 'r1' }))
  })
})
await new Promise((r) => smsServer.listen(smsPort, '127.0.0.1', r))
process.env.SMS_TENCENT_ENDPOINT = `http://127.0.0.1:${smsPort}`

await t('真实发送：假端点收到 TC3 请求并返回 Ok', async () => {
  smsServer.mode = 'ok'
  const r = await sendSms({ ...CRED, mobile: '13900139000', code: '654321' })
  assert.equal(r.ok, true)
  assert.match(smsHits[0].auth, /^TC3-HMAC-SHA256 /)
  assert.ok(JSON.parse(smsHits[0].body).PhoneNumberSet[0].endsWith('13900139000'))
})
await t('网关错误必须抛错（不静默成功）', async () => {
  smsServer.mode = 'err'
  await assert.rejects(() => sendSms({ ...CRED, mobile: '13900139000', code: '1' }), /短信网关拒绝.*AuthFailure/)
})
await t('业务失败（超限等）必须抛错', async () => {
  smsServer.mode = 'bizfail'
  await assert.rejects(() => sendSms({ ...CRED, mobile: '13900139000', code: '1' }), /短信发送失败.*LimitExceeded/)
})
await t('非 JSON 响应必须抛错', async () => {
  smsServer.mode = 'badjson'
  await assert.rejects(() => sendSms({ ...CRED, mobile: '13900139000', code: '1' }), /不是 JSON/)
})
await t('凭据不完整直接抛错', async () => {
  await assert.rejects(() => sendSms({ ...CRED, secretKey: '', mobile: '13900139000', code: '1' }), /凭据不完整/)
})
smsServer.close()

console.log('== C-07 SMTP ==')
const smtpPort = 19081 + Math.floor(Math.random() * 500)
const smtpLog = []
const smtpServer = net.createServer((socket) => {
  socket.setEncoding('utf8')
  let stage = 0, dataBuf = ''
  socket.write('220 fake.local ESMTP ready\r\n')
  socket.on('data', (chunk) => {
    dataBuf += chunk
    let idx
    while ((idx = dataBuf.indexOf('\r\n')) >= 0) {
      const line = dataBuf.slice(0, idx); dataBuf = dataBuf.slice(idx + 2)
      smtpLog.push(line) // 空行也要记：信头与正文以空行分界
      if (stage === 0 && /^EHLO/i.test(line)) { stage = 1; socket.write('250-fake.local\r\n250-AUTH LOGIN\r\n250 OK\r\n') }
      else if (stage === 1 && line === 'AUTH LOGIN') { stage = 2; socket.write('334 VXNlcm5hbWU6\r\n') }
      else if (stage === 2) { stage = 3; socket.write('334 UGFzc3dvcmQ6\r\n') }
      else if (stage === 3) {
        if (smtpServer.badPass) socket.write('535 Authentication credentials invalid\r\n')
        else { stage = 4; socket.write('235 Authentication successful\r\n') }
      }
      else if (stage === 4 && /^MAIL FROM/i.test(line)) socket.write('250 OK\r\n')
      else if (stage === 4 && /^RCPT TO/i.test(line)) socket.write('250 OK\r\n')
      else if (line === 'DATA') { stage = 5; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n') }
      else if (stage === 5 && line === '.') { stage = 6; socket.write('250 Queued as 12345\r\n') }
      else if (line === 'QUIT') socket.end('221 bye\r\n')
      else socket.write('250 OK\r\n')
    }
  })
})
await new Promise((r) => smtpServer.listen(smtpPort, '127.0.0.1', r))

await t('SMTP 会话：AUTH LOGIN → 信封 → DATA（UTF-8 主题 base64、正文含验证码与有效期）', async () => {
  smtpLog.length = 0
  const r = await sendMail({ host: '127.0.0.1', port: smtpPort, user: 'noreply@x.com', pass: 'good', from: 'noreply@x.com', to: 'user@test.dev', code: '246810' })
  assert.equal(r.ok, true)
  assert.equal(smtpLog[0], 'EHLO wanderlust.local')
  assert.equal(smtpLog[1], 'AUTH LOGIN')
  assert.equal(Buffer.from(smtpLog[2], 'base64').toString(), 'noreply@x.com')
  assert.equal(Buffer.from(smtpLog[3], 'base64').toString(), 'good')
  assert.ok(smtpLog.some((l) => /^MAIL FROM:<noreply@x\.com>$/i.test(l)), 'MAIL FROM')
  assert.ok(smtpLog.some((l) => /^RCPT TO:<user@test\.dev>$/i.test(l)), 'RCPT TO')
  const dataCmd = smtpLog.indexOf('DATA')
  const headers = smtpLog.slice(dataCmd + 1, dataCmd + 8).join('\n')
  assert.match(headers, /Subject: =\?UTF-8\?B\?/, '主题用 UTF-8 base64 编码')
  const subj = headers.split('\n').find((l) => l.startsWith('Subject:'))
  assert.equal(Buffer.from(subj.match(/B\?([^?]*)\?=/)[1], 'base64').toString(), '【向往的自由】登录验证码')
  assert.ok(headers.includes('Content-Type: text/plain; charset=UTF-8'))
  const bodyB64 = smtpLog.slice(dataCmd + 8).filter((l) => l && l !== '.').join('')
  const body = Buffer.from(bodyB64, 'base64').toString()
  assert.ok(body.includes('246810'), '正文含验证码')
  assert.ok(body.includes('5 分钟内有效'), '正文含有效期')
  assert.ok(!/区块链|虚拟资产|Token|NFT/.test(body + headers), '文案无红线用语')
})
await t('错误密码必须抛错（不静默成功）', async () => {
  smtpServer.badPass = true
  smtpLog.length = 0
  await assert.rejects(() => sendMail({ host: '127.0.0.1', port: smtpPort, user: 'noreply@x.com', pass: 'WRONG', from: 'noreply@x.com', to: 'user@test.dev', code: '1' }), /SMTP 命令失败（AUTH）|535/)
  smtpServer.badPass = false
})
await t('连接拒绝必须抛错', async () => {
  await assert.rejects(() => sendMail({ host: '127.0.0.1', port: 1, user: 'a', pass: 'b', from: 'a@x.com', to: 'b@x.com', code: '1' }), /SMTP/)
})
await t('配置不完整直接抛错', async () => {
  await assert.rejects(() => sendMail({ host: '', port: 25, from: 'a@x.com', to: 'b@x.com', code: '1' }), /配置不完整/)
})
smtpServer.close()

console.log(`\n${pass} 项 C-06/C-07 发送器测试通过`)
process.exitCode = pass >= 11 ? 0 : 1
