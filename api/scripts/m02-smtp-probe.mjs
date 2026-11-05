// M-02：SMTP 真实联调脚本（不在 npm test 内——涉及真实外部发送）。
// 从本机 KEY.txt 提取 SMTP 字段（只进内存，不打印值），经后台安全配置机制保存（AES-GCM 加密落库），
// 然后调用「安全中心 → 发送测试」真实发一封到授权测试收件人。输出只含脱敏目标与状态，不含任何秘密值。
// 用法：node scripts/m02-smtp-probe.mjs <API_BASE> <admin用户名> <admin密码> [收件目标]
import fs from 'node:fs'
import path from 'node:path'

const [base, user, pass, targetArg] = process.argv.slice(2)
if (!base || !user || !pass) { console.error('用法: node scripts/m02-smtp-probe.mjs <API_BASE> <admin> <password> [target]'); process.exit(2) }
const KEYFILE = process.env.KEYFILE || path.join(process.env.HOME || 'C:/Users/allenzhao', 'Desktop', '文旅项目', 'KEY.txt')
const TARGET = targetArg || 'allenzhao@huanle.com' // KEY.txt 中标注的邮箱接收人测试账号

// ---- 只提取字段名对应的值，绝不输出 ----
const raw = fs.readFileSync(KEYFILE, 'utf8')
const grab = (label) => {
  const re = new RegExp(label + '[^\\n]*?[：:]\\s*[`"“]?' + '([^`"”\\n]+)')
  const m = raw.match(re)
  return m ? m[1].trim().replace(/^"|"$/g, '') : ''
}
const host = grab('SMTP地址')
const portSsl = grab('SSL端口')
const smtpPass = grab('IMAP\\/SMTP密码')
const mailbox = grab('邮箱地址')
const need = { host, portSsl, smtpPass, mailbox }
const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k)
if (missing.length) { console.error('KEY.txt 缺字段：' + missing.join(', ') + '（不打印已有字段值）'); process.exit(2) }
console.log('KEY.txt 字段读取：SMTP地址 ✓ 端口 ✓ SMTP密码 ✓（长度 ' + smtpPass.length + '）邮箱账号 ✓（' + mailbox.replace(/^(.).*@/, '$1***@') + '）')

const api = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' || !body ? undefined : JSON.stringify(body) })
  return r.json()
}
const login = await api('POST', '/admin/login', { username: user, password: pass })
if (login.code !== 0) { console.error('登录失败：' + login.msg); process.exit(1) }
const T = login.data.token

// 1) 通过既有安全配置机制保存（集成中心同一套 setSecret：AES-256-GCM 加密落库）
const fields = { SMTP_HOST: host, SMTP_PORT: portSsl, SMTP_USER: mailbox, SMTP_PASS: smtpPass, SMTP_FROM: '向往的自由 <' + mailbox + '>' }
for (const [k, v] of Object.entries(fields)) {
  const r = await api('POST', '/admin/integrations/' + k, { value: v }, T)
  if (r.code !== 0) { console.error('保存 ' + k + ' 失败：' + r.msg); process.exit(1) }
  console.log('已安全保存 ' + k + '（加密落库，值不回显）')
}

// 2) 真实发送测试（授权测试收件人）
const probe = await api('POST', '/admin/security/channels/email/test', { target: TARGET }, T)
console.log('发送测试：', JSON.stringify({ sent: probe.data?.sent, state: probe.data?.state, msg: probe.msg }))
const st = await api('GET', '/admin/security/channels', T)
console.log('通道状态：', JSON.stringify({
  emailState: st.data?.email?.state,
  lastProbe: st.data?.email?.lastProbe ? { target: st.data.email.lastProbe.target_masked, result: Number(st.data.email.lastProbe.result) === 1 ? '受理成功' : '失败', detail: st.data.email.lastProbe.detail, at: st.data.email.lastProbe.created_at } : null,
}))
