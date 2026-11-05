// M-02 收件确认：用 IMAP 检查测试邮件是否真实到达收件箱（只输出主题/时间等摘要，不输出密码与正文全文）。
// 教训：①飞书 IMAP 在 TLS 握手完成的瞬间写命令会被吞——首条命令要在收到问候后再延迟发出；
//      ②"* SEARCH ..." 与其 OK 行可能分属两个数据事件——看到 SEARCH 行立刻记录。
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'

const KEYFILE = process.env.KEYFILE || path.join(process.env.HOME || 'C:/Users/allenzhao', 'Desktop', '文旅项目', 'KEY.txt')
const raw = fs.readFileSync(KEYFILE, 'utf8')
const grab = (label) => { const m = raw.match(new RegExp(label + '[^\\n]*?[：:]\\s*[`"“]?([^`"”\\n]+)')); return m ? m[1].trim() : '' }
// 登录账号可用环境变量覆盖（默认=KEY.txt 邮箱地址；收件确认时可指定收件人账号）
const user = process.env.IMAP_USER || grab('邮箱地址'), pass = grab('IMAP\\/SMTP密码'), host = grab('IMAP地址') || 'imap.feishu.cn'
if (!user || !pass) { console.error('KEY.txt 缺 IMAP 字段'); process.exit(2) }

const sock = tls.connect({ host, port: 993, rejectUnauthorized: true })
let step = 0, gotGreeting = false, searchIds = null, heads = []
const send = (cmd, delay = 300) => setTimeout(() => sock.write('A' + step + ' ' + cmd + '\r\n'), delay)
const finish = (msg) => {
  console.log('== IMAP 收件检查 ==\n' + (heads.length ? heads.join('\n') + '\n' : '') + '结论：' + msg)
  sock.end(); process.exit(0)
}
sock.on('data', (d) => {
  const lines = d.toString('utf8').split('\r\n').filter((x) => x !== '')
  for (const line of lines) {
    const sm = line.match(/^\*\s+SEARCH\s+([\d ]+)/)
    if (sm) { searchIds = sm[1].trim(); continue }
    const hm = line.match(/^(Subject|Date|From|To):(.*)$/i)
    if (hm) { heads.push(hm[1] + ':' + hm[2].trim()); continue }
    if (!gotGreeting && /^\*\s+OK/.test(line)) {
      gotGreeting = true; step = 1
      send('LOGIN "' + user.replace(/"/g, '') + '" "' + pass.replace(/"/g, '') + '"', 300); continue
    }
    if (step === 1 && /^A1\s+OK/.test(line)) { step = 2; send('SELECT INBOX', 200); continue }
    if (step === 2 && /^A2\s+OK/.test(line)) {
      // SINCE 按 INTERNALDATE（服务器时区）判定会漏刚到的邮件——用 SEARCH ALL 取最新一封
      step = 3; send('SEARCH ALL', 200); continue
    }
    if (step === 3 && /^A3\s+OK/.test(line)) {
      if (!searchIds) finish('收件箱没有邮件（SMTP 受理成功但 IMAP 未见——请人工确认收件箱/垃圾箱）')
      else {
        const ids = searchIds.split(/\s+/); const last = ids[ids.length - 1]
        step = 4; send('FETCH ' + last + ' (BODY.PEEK[HEADER.FIELDS (SUBJECT DATE FROM TO)])', 200)
      }
      continue
    }
    if (step === 4 && /^A4\s+OK/.test(line)) finish('已检索到收件箱最新邮件（头部见上）——以 Date 头核对是否为本次测试邮件')
    if (/^A\d\s+(NO|BAD)/.test(line)) finish('失败：' + line.trim())
  }
})
sock.on('error', (e) => { console.error('IMAP 连接失败：' + e.message); process.exit(1) })
sock.setTimeout(25000, () => { console.error('IMAP 超时'); process.exit(1) })
