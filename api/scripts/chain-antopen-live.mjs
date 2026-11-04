// 蚂蚁链开放联盟链真机联调 CLI（只读优先；不要放进日常定时任务）
//
// 用法：
//   node scripts/chain-antopen-live.mjs probe
//   node scripts/chain-antopen-live.mjs anchor [root]        ← 会消耗燃料，慎用
//   凭据走环境变量（ANTOPEN_ACCESS_ID / ANTOPEN_ACCESS_KEY / ANTOPEN_ACCOUNT / ANTOPEN_KMS_ID / ANTOPEN_TENANT_ID），
//   或 --key-file <path> 直接从控制台下载的 access.key 读私钥（文件内容不会出现在任何输出里）。
//
// 输出一律脱敏：只打成功与否、块高、哈希；不会打印私钥、令牌、托管 ID 全文。
import fs from 'node:fs'
import crypto from 'node:crypto'
import antopen from '../src/infra/chain/antchain-open.mjs'

const [cmd = 'probe', arg1] = process.argv.slice(2)
const keyFileIdx = process.argv.indexOf('--key-file')
if (keyFileIdx > -1 && process.argv[keyFileIdx + 1]) {
  process.env.ANTOPEN_ACCESS_KEY ||= fs.readFileSync(process.argv[keyFileIdx + 1], 'utf8')
}

const mask = (s) => (!s ? '(空)' : s.length <= 8 ? s.slice(0, 2) + '***' : s.slice(0, 4) + '***' + s.slice(-2))

const st = antopen.status()
if (st.missing.length) {
  console.error('配置不完整，缺少：' + st.missing.join('、'))
  console.error('提示：tenantid 取控制台地址里的 projectName，不是文档里的 mytenant')
  process.exit(2)
}
console.log('链 %s · 账户 %s · AccessId %s · KMS %s · gas %s',
  process.env.ANTOPEN_BIZID || 'a00e36c5', process.env.ANTOPEN_ACCOUNT, mask(process.env.ANTOPEN_ACCESS_ID),
  mask(process.env.ANTOPEN_KMS_ID), process.env.ANTOPEN_GAS || 50000)

if (cmd === 'probe') {
  const r = await antopen.probe()
  console.log('探测：%s', r.detail)
} else if (cmd === 'anchor') {
  const root = arg1 || crypto.createHash('sha256').update('live-' + Date.now()).digest('hex')
  const bizDate = new Date().toISOString().slice(0, 10)
  console.log('提交（注意：会消耗燃料）root=%s bizDate=%s', root, bizDate)
  const r = await antopen.anchor({ root, prevRoot: '', bizDate })
  console.log('已提交 txRef=%s', r.txRef)
  for (let i = 0; i < 10; i++) {
    const c = await antopen.confirm({ txRef: r.txRef, root, prevRoot: '', bizDate, submittedAt: new Date().toISOString() })
    console.log('  确认 →', c)
    if (c.final) break
    await new Promise((res) => setTimeout(res, 3000))
  }
} else {
  console.error('未知命令：' + cmd + '（可用：probe / anchor）')
  process.exit(2)
}
