// 把落根合约 WanderlustRootStore 部署到蚂蚁链开放联盟链（DEPLOYCONTRACTFORBIZ）。
//
//   node scripts/chain-antopen-deploy.mjs            # 只演练：检查产物与配置、打印将要发什么，不发任何交易
//   node scripts/chain-antopen-deploy.mjs --yes      # 真部署（不可逆：合约一旦部署不可修改，要换规则只能换新合约名）
//   可选：--name WanderlustRootStoreV2  --gas 2000000  --code-format hex|base64
//
// 凭据只从环境变量读（ANTOPEN_ACCESS_ID / ANTOPEN_ACCESS_KEY / ANTOPEN_ACCOUNT / ANTOPEN_KMS_ID / ANTOPEN_TENANT_ID，可选 ANTOPEN_BIZID），
// 输出一律脱敏。部署成功后把合约名填进后台「链接入中心 → 蚂蚁链开放联盟链 · 合约模式 → 合约名」，再「设为当前链」。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { antopenEnv, antopenMissing, antopenApi, scrub } from '../src/infra/chain/antchain-open.mjs'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'antchain-root')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'build', 'build.json'), 'utf8'))
const bin = fs.readFileSync(path.join(DIR, 'build', 'WanderlustRootStore.bin'), 'utf8').trim()
const src = fs.readFileSync(path.join(DIR, meta.sourceFile), 'utf8').replace(/\r\n/g, '\n')   // 与编译脚本一致：按 LF 算哈希
const problems = []
if (sha(src) !== meta.sourceSha256) problems.push('源码与编译产物对不上（sourceSha256 不一致）：先重新编译，别部署一份和源码不符的字节码')
if (sha(bin) !== meta.binSha256) problems.push('bin 与 build.json 里的哈希不一致，产物被改动过')
if (!/^[0-9a-f]+$/i.test(bin) || bin.length % 2) problems.push('bin 不是合法的 hex')
const miss = antopenMissing()
if (miss.length) problems.push('缺配置：' + miss.join('、'))

const name = opt('--name', 'WanderlustRootStoreV2')   // V1 已于 2026-11-05 部署且有缺陷（seq 读出 2087900645），换新名字
const gas = Number(opt('--gas', '2000000'))
const fmt = opt('--code-format', 'hex')
if (!['hex', 'base64'].includes(fmt)) problems.push('--code-format 只能是 hex 或 base64')
const code = fmt === 'base64' ? Buffer.from(bin, 'hex').toString('base64') : bin
const e = antopenEnv()

console.log('合约      :', name, `(${meta.contract}，solc ${meta.solc.split('+')[0]}，优化器 runs=${meta.optimizer.runs})`)
console.log('字节码    :', meta.binBytes, '字节，sha256', meta.binSha256.slice(0, 16) + '…，传参格式', fmt)
console.log('链 / 账户 :', e.bizid, '/', e.account || '(未配置)', '· 租户', e.tenant || '(未配置)', '· gas 上限', gas)
if (problems.length) { console.log('\n✗ 不能部署：\n  - ' + problems.join('\n  - ')); process.exit(1) }

if (!flag('--yes')) {
  console.log('\n演练完成：以上检查全部通过。**没有发送任何交易。** 要真部署（不可逆）请加 --yes。')
  process.exit(0)
}

console.log('\n→ 发送部署交易（不可逆）…')
const orderId = 'wldeploy_' + name.slice(0, 20) + '_' + Date.now().toString(36)
let j
try {
  j = await antopenApi('/api/contract/chainCallForBiz', (token) => ({
    orderId, bizid: e.bizid, account: e.account, contractName: name, contractCode: code, mykmsKeyId: e.kmsId,
    method: 'DEPLOYCONTRACTFORBIZ', accessId: e.accessId, token, gas, tenantid: e.tenant,
  }))
} catch (err) { console.log('✗ 部署请求失败：', scrub(err.message)); process.exit(2) }
let d = null
try { d = JSON.parse(j.data) } catch { /* 非 JSON */ }
const rc = d?.txData?.data?.transactionReceipt
const result = rc?.result
console.log('响应      : success =', j.success, '· code =', j.code)
console.log('回执 result:', result === undefined ? '(响应里没有 transactionReceipt.result)' : result, result === 0 ? '→ 部署成功' : '')
if (typeof j.data === 'string' && !d) console.log('data      :', scrub(j.data))
if (result !== 0) { console.log('✗ 未确认成功：不要假设合约已部署。检查燃料、gas、编译器版本，或换 --code-format base64 再演练。'); process.exit(3) }
console.log('✓ 已部署。下一步：在后台「链接入中心 → 合约模式」填合约名', name, '，点「连通性探测」确认合约可调用，再「设为当前链」。')
