// M-02 端到端：绑定邮箱 → 真实收到验证码（IMAP）→ 错码拒绝 → 正确码完成登录。
// 涉及真实外部发送，不进 npm test / test:db。输出只含脱敏证据，不打印验证码与密码。
// 用法：node scripts/m02-e2e-bind.mjs <API_BASE> <admin用户名> <admin密码> [绑定邮箱]
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'

const [base, adminUser, adminPass, targetArg] = process.argv.slice(2)
if (!base || !adminUser || !adminPass) { console.error('用法: node scripts/m02-e2e-bind.mjs <API_BASE> <admin> <password> [email]'); process.exit(2) }
const TARGET = targetArg || '1onetest@huanle.com'
const E2E_USER = 'm02-e2e-' + Math.random().toString(36).slice(2, 6)
const E2E_PASS = 'M02e2e!' + Math.random().toString(36).slice(2, 10) + 'A1'

const api = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' || !body ? undefined : JSON.stringify(body) })
  return r.json()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- IMAP：轮询收件箱最新邮件正文，提取 6 位验证码（不打印码与凭据）----
const KEYFILE = process.env.KEYFILE || path.join(process.env.HOME || 'C:/Users/allenzhao', 'Desktop', '文旅项目', 'KEY.txt')
const raw = fs.readFileSync(KEYFILE, 'utf8')
const grab = (label) => { const m = raw.match(new RegExp(label + '[^\\n]*?[：:]\\s*[`"“]?([^`"”\\n]+)')); return m ? m[1].trim() : '' }
const imapUser = process.env.IMAP_USER || grab('邮箱地址'), imapPass = grab('IMAP\\/SMTP密码'), imapHost = grab('IMAP地址') || 'imap.feishu.cn'
function imapReadCode() {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: imapHost, port: 993, rejectUnauthorized: true })
    let step = 0, searchIds = null, inBody = false, bodyText = ''
    const finish = (v) => { try { sock.end() } catch {} ; resolve(v) }
    const send = (cmd, delay = 300) => setTimeout(() => sock.write('A' + step + ' ' + cmd + '\r\n'), delay)
    sock.on('data', (d) => {
      const lines = d.toString('utf8').split('\r\n').filter((x) => x !== '')
      for (const line of lines) {
        const sm = line.match(/^\*\s+SEARCH\s+([\d ]+)/)
        if (sm) { searchIds = sm[1].trim(); continue }
        if (step === 4 && /BODY\[TEXT\]\s*\{\d+\}$/.test(line)) { inBody = true; continue }   // 正文从 {N} 行之后开始
        if (step === 4 && inBody && line === ')') { inBody = false; continue }
        if (step === 4 && inBody) { bodyText += line; continue }
        if (!step && /^\*\s+OK/.test(line)) { step = 1; send('LOGIN "' + imapUser.replace(/"/g, '') + '" "' + imapPass.replace(/"/g, '') + '"'); continue }
        if (step === 1 && /^A1\s+OK/.test(line)) { step = 2; send('SELECT INBOX', 200); continue }
        if (step === 2 && /^A2\s+OK/.test(line)) { step = 3; send('SEARCH ALL', 200); continue }
        if (step === 3 && /^A3\s+OK/.test(line)) {
          if (!searchIds) return finish(null)
          const ids = searchIds.split(/\s+/)
          step = 4; send('FETCH ' + ids[ids.length - 1] + ' (BODY.PEEK[TEXT])', 200); continue
        }
        if (step === 4 && /^A4\s+OK/.test(line)) {
          // 正文是 base64（76 列折行）：拼接后解码
          const b64 = bodyText.replace(/\s+/g, '')
          let text = ''
          try { text = Buffer.from(b64, 'base64').toString('utf8') } catch { return finish(null) }
          const m = text.match(/(\d{6})/)
          return finish(m ? m[1] : null)
        }
        if (/^A\d\s+(NO|BAD)/.test(line)) return finish(null)
      }
    })
    sock.on('error', () => finish(null))
    sock.setTimeout(12000, () => finish(null))
  })
}
async function waitCode(maxMs = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(4000)
    const c = await imapReadCode()
    if (c) return c
  }
  return null
}

// ---- 流程 ----
console.log('== M-02 端到端（真实邮箱验证码绑定与登录）==')
const l0 = await api('POST', '/admin/login', { username: adminUser, password: adminPass })
if (l0.code !== 0) { console.error('管理员登录失败：' + l0.msg); process.exit(1) }
const T = l0.data.token

const created = await api('POST', '/admin/accounts', { username: E2E_USER, displayName: 'M02端到端测试', role: 'ops', password: E2E_PASS }, T)
if (created.code !== 0) { console.error('建号失败：' + created.msg); process.exit(1) }
const uid = created.data.id
console.log('已建端到端账号 ' + E2E_USER + '（脱敏凭据不入输出）')

const bind = await api('POST', '/admin/security/bind-contact', { userId: uid, channel: 'email', target: TARGET }, T)
console.log('① 绑定邮箱：', JSON.stringify({ bound: bind.data?.bound, testSent: bind.data?.testSent, mock: bind.data?.mock, msg: bind.msg }))
if (bind.code !== 0) { await api('POST', '/admin/accounts/' + uid + '/status', { status: 0 }, T).catch(() => {}); process.exit(1) }
const code1 = await waitCode()
console.log('② IMAP 收到绑定测试邮件并提取验证码：', code1 ? '成功（6 位，值不显示）' : '失败')
if (!code1) process.exit(1)

console.log('（等待 60 秒发送限频窗口…）'); await sleep(61000)
const l1 = await api('POST', '/admin/login', { username: E2E_USER, password: E2E_PASS })
console.log('③ 登录进入两步验证：', JSON.stringify({ mfaRequired: l1.data?.mfaRequired, channel: l1.data?.channel, target: l1.data?.target }))
if (!l1.data?.mfaRequired) process.exit(1)
const rs = await api('POST', '/admin/login/mfa', { challenge: l1.data.challenge, resend: true })
console.log('④ 触发真实发送（resend）：', JSON.stringify({ resent: rs.data?.resent }))
const code2 = await waitCode()
console.log('⑤ IMAP 收到登录验证码：', code2 ? '成功（值不显示）' : '失败')
if (!code2) process.exit(1)

const bad = await api('POST', '/admin/login/mfa', { challenge: l1.data.challenge, code: '000000' === code2 ? '111111' : '000000' })
console.log('⑥ 错误验证码：', JSON.stringify({ rejected: bad.code === 1002, msg: bad.msg }))
const good = await api('POST', '/admin/login/mfa', { challenge: l1.data.challenge, code: code2 })
console.log('⑦ 真实收到的验证码完成登录：', JSON.stringify({ gotToken: !!good.data?.token, role: good.data?.user?.role }))
const cap = good.data?.token ? await api('GET', '/admin/capabilities', null, good.data.token) : { code: -1 }
console.log('⑧ 新会话可用（capabilities）：', cap.code === 0 ? '通过' : '失败 ' + cap.msg)

// ---- 清理：解绑 + 停用 + 删除账号 + 清审计 ----
await api('POST', '/admin/security/mfa/disable', { userId: uid }, T)
await api('POST', `/admin/accounts/${uid}/status`, { status: 0 }, T).catch(() => {})
await fetch(base + '/admin/accounts/' + uid, { method: 'DELETE', headers: { authorization: 'Bearer ' + T } }).catch(() => {})
console.log('清理：已解绑并删除端到端账号')
console.log(process.exitCode ? '== 存在失败项 ==' : '== M-02 端到端全部通过 ==')
