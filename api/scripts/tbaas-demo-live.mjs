// 只针对体验网络和隔离库；凭据由负责人在同一隔离后台保存，不读取/回显明文文件。
// DB_NAME=<隔离库> JWT_SECRET=<与服务一致> node scripts/tbaas-demo-live.mjs [--write]
// 无 --write 只读；--write 仅创建并提交一个随机测试根，不扫全库，不读取业务载荷。
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { assertIsolatedDb } from '../test/_guard.mjs'
import { warmSecrets } from '../src/infra/secrets.mjs'
import { E } from '../src/infra/chain/conf.mjs'
import tbaas from '../src/infra/chain/tbaas.mjs'
import { q, one, closeDb } from '../src/db.mjs'
import { anchorToChain, confirmBatch } from '../src/domain/attest.mjs'
import { providerId } from '../src/infra/chain/index.mjs'

assertIsolatedDb('tbaas-demo-live')
// 即使有人设置 ALLOW_DESTRUCTIVE，也不允许对默认演示库执行。
if (!process.env.DB_NAME || process.env.DB_NAME === 'wanderlust') throw new Error('必须显式指定隔离库')
await warmSecrets()
const expected = { TBAAS_CLUSTER_ID: 'chainmaker-demo', TBAAS_CHAIN_ID: 'chain_demo', TBAAS_CONTRACT: 'ChainMakerDemo',
  TBAAS_ACTION: 'InvokeChainMakerDemoContract', TBAAS_VERSION: '2018-04-16', TBAAS_REGION: 'ap-beijing', TBAAS_ROOT_FUNC: 'save' }
try {
  for (const [k, v] of Object.entries(expected)) if (E[k] !== v) throw new Error('体验网络配置不符：' + k)
  if (E.TBAAS_ENDPOINT && E.TBAAS_ENDPOINT !== 'https://tbaas.tencentcloudapi.com') throw new Error('拒绝向非腾讯云标准地址发送凭据')
  if (E.TBAAS_CHANNEL) throw new Error('体验网络不应配置 Fabric Channel')
  const template = JSON.parse(E.TBAAS_PARAM_TEMPLATE || '{}')
  if (template.key !== '{root}' || template.field !== 'merkle_root' || template.value !== '{prevRoot}|{bizDate}') throw new Error('请使用交接文档规定的体验网络入参模板')
  if (tbaas.mode() !== 'real') throw new Error('缺少配置：' + tbaas.status().missing.join(', '))
  console.log(JSON.stringify({ stage: 'readonly', ...(await tbaas.probe()) }))
  console.log(JSON.stringify({ stage: 'historical', ...(await tbaas.queryTransaction('18e434fc6ce512aacabb57546b8e4b771d8619f230744d0386b5f13acfa17a0a')) }))
  if (process.argv.includes('--write')) {
    if (providerId() !== 'tbaas') throw new Error('隔离后台需先激活 tbaas（只影响隔离库）')
    const root = crypto.createHash('sha256').update('synthetic-tbaas-probe:' + crypto.randomUUID()).digest('hex')
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const last = await one('SELECT seq, merkle_root FROM attest_batch ORDER BY seq DESC LIMIT 1')
    const prev = last?.merkle_root || null
    const r = await q(`INSERT INTO attest_batch (seq,biz_date,merkle_root,prev_root,leaf_count,merkle_kind,merkle_version,status)
      VALUES (?,?,?,?,0,'tbaas-probe',2,1)`, [Number(last?.seq || 0) + 1, day, root, prev])
    const id = r.insertId
    console.log(JSON.stringify({ stage: 'created', batchId: id, root, synthetic: true }))
    const submitted = await anchorToChain(id)
    console.log(JSON.stringify({ stage: 'submitted', ...submitted }))
    if (!submitted.submitted || !submitted.txRef) throw new Error('测试批次未成功提交')
    const read = await tbaas.readDemoValue(root, 'merkle_root')
    if (read.value !== `${prev || '0'.repeat(64)}|${day.replaceAll('-', '')}`) throw new Error('合约读回值与随机测试载荷不一致')
    console.log(JSON.stringify({ stage: 'readback', match: true, requestId: read.requestId }))
    let confirmed
    for (let i = 0; i < 5; i++) {
      confirmed = await confirmBatch(id)
      if (confirmed.anchored || !confirmed.pending) break
      await delay(2000)
    }
    console.log(JSON.stringify({ stage: 'confirmed', ...confirmed }))
    if (!confirmed.anchored) throw new Error('测试批次尚未终局，保留现场；不重新提交')
    console.log('验收仅覆盖体验网络回执与键值读回；不证明交易载荷的密码学绑定，也不代表生产落根合约验收。')
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await closeDb()
}
