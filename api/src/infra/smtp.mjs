// C-07：最小 SMTP 客户端（不引入 nodemailer，规避离线部署负担）：465 隐式 TLS / 587 STARTTLS，
// AUTH LOGIN，UTF-8 主题 base64。凭据来自集成中心 SMTP_HOST/PORT/USER/PASS/FROM。
// 失败必须抛错（用户要看见"验证码发送失败"）；不把密码/验证码写进日志或错误消息。
import net from 'node:net'
import tls from 'node:tls'

const CRLF = '\r\n'

/** 单连接 SMTP 会话。持久读入器：数据始终累积到 acc，reply() 按帧完整性取走一段——
 *  避免"移除监听器期间到达的数据被丢"的经典丢帧问题。 */
async function smtpSession({ host, port, secure, user, pass, from, to, subject, text }) {
  return new Promise((resolve, reject) => {
    let sock = null
    let acc = ''
    let settled = false
    let pending = null // { res, rej, timer }
    const fail = (e) => {
      if (settled) return
      settled = true
      try { sock && sock.destroy() } catch { /* ignore */ }
      reject(e instanceof Error ? e : new Error(String(e)))
    }
    const isComplete = (s) => {
      if (!s) return false // 还没收到任何字节
      const lines = s.split(CRLF)
      const last = lines[lines.length - 2] || ''
      return !/^\d{3}-/.test(last) // "250-..." 续行未完
    }
    const trySettle = () => {
      if (!pending || !isComplete(acc)) return
      const { res, timer } = pending
      pending = null
      clearTimeout(timer)
      const out = acc
      acc = ''
      res(out)
    }
    const attach = () => {
      sock.on('data', (chunk) => { acc += chunk; trySettle() })
      sock.on('error', (e) => {
        if (pending) { const { rej, timer } = pending; pending = null; clearTimeout(timer); rej(e) }
        fail(new Error('SMTP 连接失败：' + (e && e.message)))
      })
    }
    const reply = () => new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (pending) { pending = null; rej(new Error('SMTP 响应超时')) }
      }, 15_000)
      pending = { res, rej, timer }
      trySettle() // 数据可能已经先到
    })
    const cmd = async (line, expect) => {
      sock.write(line + CRLF)
      const r = await reply()
      if (expect && !r.startsWith(expect)) {
        // 不回显命令参数（AUTH 行含 base64 密码）
        throw new Error('SMTP 命令失败（' + line.split(' ')[0] + '）：' + r.split(CRLF)[0].slice(0, 120))
      }
      return r
    }
    const onConnect = async (socket0) => {
      sock = socket0
      try {
        sock.setEncoding('utf8')
        attach()
        let r = await reply()
        if (!/^220/.test(r)) throw new Error('SMTP 连接被拒：' + r.split(CRLF)[0].slice(0, 120))
        const ehloName = 'wanderlust.local'
        let caps = await cmd('EHLO ' + ehloName, '250')
        if (!secure && /STARTTLS/i.test(caps)) {
          await cmd('STARTTLS', '220')
          sock.removeAllListeners('data')
          sock.removeAllListeners('error')
          sock = await new Promise((res, rej) => {
            const t = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => res(t))
            t.once('error', rej)
          })
          attach()
          caps = await cmd('EHLO ' + ehloName, '250')
        }
        if (user) {
          await cmd('AUTH LOGIN', '334')
          await cmd(Buffer.from(user).toString('base64'), '334')
          await cmd(Buffer.from(pass || '').toString('base64'), '235')
        }
        await cmd('MAIL FROM:<' + from + '>', '250')
        await cmd('RCPT TO:<' + to + '>', '250')
        await cmd('DATA', '354')
        const head = [
          `From: =?UTF-8?B?${Buffer.from('向往的自由').toString('base64')}?= <${from}>`,
          `To: <${to}>`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
        ].join(CRLF) + CRLF + CRLF // 信头与正文之间必须有空行（\r\n\r\n），否则正文会被当成信头解析
        const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1' + CRLF)
        sock.write(head + body + CRLF + '.' + CRLF)
        r = await reply()
        if (!r.startsWith('250')) throw new Error('SMTP 投递失败：' + r.split(CRLF)[0].slice(0, 120))
        sock.write('QUIT' + CRLF)
        sock.end()
        if (!settled) { settled = true; resolve({ ok: true }) }
      } catch (e) { fail(e) }
    }
    if (secure) {
      sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => onConnect(sock))
      sock.once('error', onError)
    } else {
      sock = net.connect({ host, port }, () => onConnect(sock))
      sock.once('error', onError)
    }
    function onError(e) { fail(new Error('SMTP 连接失败：' + (e && e.message))) }
  })
}

/** 发登录验证码邮件；主题含中文名，正文含有效期与安全提示；文案不含红线用语 */
export async function sendMail({ host, port, user, pass, from, to, code }) {
  if (!host || !port || !from) throw new Error('SMTP 配置不完整（需要 HOST/PORT/FROM）')
  if (!to) throw new Error('收件地址为空')
  const subject = '【向往的自由】登录验证码'
  const text = `你的登录验证码是：${code}\n\n5 分钟内有效。请勿转告他人；若非本人操作请忽略本邮件。`
  const secure = Number(port) === 465
  const addr = String(from).replace(/^.*<(.*)>.*$/, '$1') || String(from)
  return smtpSession({ host: String(host), port: Number(port), secure, user: user || null, pass: pass || null, from: addr, to: String(to), subject, text })
}
